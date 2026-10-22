"""
Builds drivable car models in Blender (sedan + coupe) and exports GLBs.
Each car: Body mesh (paint / glass / trim / lights / interior), four wheel
objects (wheel_FL, wheel_FR, wheel_RL, wheel_RR) pivoting at the hub, and
empties marking the driver seat and the driver door.

  blender -b --factory-startup -P blender/build_car.py -- <project_root> [--preview <dir>]

Axes: car faces -Y (exports as +Z in three.js), left side = +X, Z up, origin on the ground.
"""
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
PREVIEW = "--preview" in ARGS
V = Vector


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return [srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def material(name, hexcol, rough=0.5, metal=0.0, coat=0.0, emit=None, emit_str=1.0, alpha=1.0, tex=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    rgb = hexlin(hexcol)
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.03
    if emit:
        b.inputs["Emission Color"].default_value = (*hexlin(emit), 1)
        b.inputs["Emission Strength"].default_value = emit_str
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
    if tex:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = tex
        nt.links.new(tn.outputs["Color"], b.inputs["Base Color"])
    m.diffuse_color = (*rgb, alpha)
    return m


def checker_texture():
    """2 x 2 black/white checks; strips repeat it along their length"""
    n = 32
    x = np.arange(n)
    c = ((x[:, None] // 16 + x[None, :] // 16) % 2).astype(np.float32) * 0.92 + 0.04
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = c
    img = bpy.data.images.new("checker", n, n)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def tread_texture():
    n = 256
    x = np.arange(n)
    u = (x[None, :] % 16) < 5
    v = (np.abs(((x[:, None] + x[None, :] // 2) % 32) - 16) < 3)
    val = 0.11 + 0.06 * np.random.default_rng(3).random((n, n))
    val = np.where(u | v, val * 0.45, val)
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = val
    img = bpy.data.images.new("tread", n, n)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


# ------------------------------------------------------------------ mesh helpers
def to_object(name, bm, mats, smooth=True, coll=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def section_loft(bm, stations, shape, segs, uvl, mat_index=0):
    """stations: list of y; shape(y) -> list of (x, z) closed polygon. Caps both ends."""
    rings = []
    for y in stations:
        rings.append([bm.verts.new((x, y, z)) for x, z in shape(y)])
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mat_index
            for loop, uv in zip(f.loops, ((i / segs, k / 8), ((i + 1) / segs, k / 8), ((i + 1) / segs, (k + 1) / 8), (i / segs, (k + 1) / 8))):
                loop[uvl].uv = uv
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        f = bm.faces.new(list(reversed(ring)) if flip else ring)
        f.material_index = mat_index
    return rings


def superellipse(n_pts, exp):
    pts = []
    for i in range(n_pts):
        a = 2 * math.pi * i / n_pts
        c, s = math.cos(a), math.sin(a)
        pts.append((math.copysign(abs(c) ** (2 / exp), c), math.copysign(abs(s) ** (2 / exp), s)))
    return pts


def interp(table, y):
    """table: list of (y, *values) sorted by y -> linearly interpolated values"""
    if y <= table[0][0]:
        return table[0][1:]
    for a, b in zip(table, table[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            t = t * t * (3 - 2 * t)
            return tuple(av + (bv - av) * t for av, bv in zip(a[1:], b[1:]))
    return table[-1][1:]


def prim(bm, kind, mat_index, matrix, **kw):
    if kind == "cube":
        r = bmesh.ops.create_cube(bm, size=1.0, matrix=matrix, calc_uvs=True)
    elif kind == "cyl":
        r = bmesh.ops.create_cone(bm, cap_ends=kw.get("caps", True), segments=kw.get("segs", 16), radius1=kw["r1"], radius2=kw.get("r2", kw["r1"]),
                                  depth=kw["depth"], matrix=matrix, calc_uvs=True)
    elif kind == "sphere":
        r = bmesh.ops.create_uvsphere(bm, u_segments=kw.get("segs", 16), v_segments=kw.get("rings", 8), radius=1.0, matrix=matrix, calc_uvs=True)
    elif kind == "torus":
        verts = []
        R, rr, n1, n2 = kw["R"], kw["r"], kw.get("n1", 24), kw.get("n2", 8)
        grid = [[bm.verts.new(matrix @ V(((R + rr * math.cos(b)) * math.cos(a), (R + rr * math.cos(b)) * math.sin(a), rr * math.sin(b))))
                 for b in [2 * math.pi * j / n2 for j in range(n2)]] for a in [2 * math.pi * i / n1 for i in range(n1)]]
        for i in range(n1):
            for j in range(n2):
                f = bm.faces.new((grid[i][j], grid[(i + 1) % n1][j], grid[(i + 1) % n1][(j + 1) % n2], grid[i][(j + 1) % n2]))
                f.material_index = mat_index
        return
    verts = r["verts"]
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = mat_index


def T(x, y, z, sx=1, sy=1, sz=1, rx=0, ry=0, rz=0):
    return (Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")
            @ Matrix.Diagonal((sx, sy, sz, 1)))


def make_text(name, text, size, matrix, mat):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.size = size
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.extrude = 0.0015
    cu.resolution_u = 2  # lettering is small: keep the curve tessellation low
    for fpath in ("C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        if os.path.exists(fpath):
            cu.font = bpy.data.fonts.load(fpath, check_existing=True)
            break
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    ob.data.transform(matrix)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


# ------------------------------------------------------------------ car builder
def build_car(name, P):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    paint = material("Paint", P["color"], 0.32, 0.55, coat=1.0)
    glass = material("Glass", "141a21", 0.03, 0.2, alpha=0.62)
    trim = material("Trim", "111214", 0.55)
    chrome = material("Chrome", "d8dadc", 0.12, 1.0)
    head = material("Headlight", "e8eef5", 0.05, 0.2, emit="fff6e0", emit_str=0.0)
    tail = material("Taillight", "8a0b0b", 0.15, 0.1, emit="ff1a10", emit_str=0.0)
    indic = material("Indicator", "d27a10", 0.2, 0.1)
    interior = material("Interior", "2a2b2e", 0.85)
    plate = material("Plate", "e9e4cf", 0.6)
    rubber = material("Tire", "1e1e1f", 0.9, tex=tread_texture())
    rim = material("Rim", P.get("rim", "c9ccd0"), 0.2, 1.0)
    disc = material("Brake", "4a4b4e", 0.5, 0.8)
    MATS = [paint, glass, trim, chrome, head, tail, indic, interior, plate]
    PAINT, GLASS, TRIM, CHROME, HEAD, TAIL, INDIC, INT, PLATE = range(len(MATS))
    POLICE = P.get("police", False)
    if POLICE:
        # livery is not tinted by the game; siren emission is animated in the game (0 in the file)
        MATS += [material("Livery", "f2f2ee", 0.32, 0.3, coat=1.0),
                 material("SirenRed", "7a0a0a", 0.15, 0.0, emit="ff1a10", emit_str=0.0),
                 material("SirenBlue", "0a1a7a", 0.15, 0.0, emit="1a3cff", emit_str=0.0),
                 material("Decal", "0d1a3a", 0.5)]
        LIVERY, SIREN_R, SIREN_B, DECAL = range(9, 13)
    TAXI, LUX, SUPER = P.get("taxi", False), P.get("lux", False), P.get("super", False)
    if TAXI:
        # checker band, roof sign body (lit by the game at night) and its lettering are not tinted
        CHECKER = len(MATS)
        MATS += [material("Checker", "ffffff", 0.45, tex=checker_texture()),
                 material("TaxiSign", "fff3c8", 0.35, emit="ffe7a0", emit_str=0.0),
                 material("Decal", "16171a", 0.5)]
        SIGN, DECAL = CHECKER + 1, CHECKER + 2
    if LUX:
        PAINT2 = len(MATS)
        MATS += [material("Paint2", P.get("color2", "16171b"), 0.3, 0.6, coat=1.0)]
    FL = P.get("floor", 0.0)  # raises (or lowers) the cabin floor, seats and seat marker
    CARGO = P.get("cargo", False)

    hw, L = P["half_width"], P["length"]
    front, rear = -L / 2, L / 2

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()

    # ---- lower body: rounded sections along Y
    segs = 26
    unit = superellipse(segs, 4.5)
    body = P["body"]  # (y, half_width_factor, z_bottom, z_top)
    ys = sorted(set([round(front + k * 0.1, 3) for k in range(int(L / 0.1) + 1)] + [b[0] for b in body]))

    def body_shape(y):
        f, zb, zt = interp(body, y)
        zc, hh = (zb + zt) / 2, (zt - zb) / 2
        out = []
        for u, v in unit:
            # sides tuck in toward the bottom (tumble-under) and top (shoulder)
            w = hw * f * (1 - 0.06 * max(0, -v) ** 2 - 0.05 * max(0, v) ** 3)
            out.append((u * w, zc + v * hh))
        return out

    def body_x(y, z):
        """half width of the body surface at (y, z)"""
        f, zb, zt = interp(body, y)
        zc, hh = (zb + zt) / 2, (zt - zb) / 2
        v = max(-0.999, min(0.999, (z - zc) / hh))
        u = (1 - abs(v) ** 4.5) ** (1 / 4.5)
        return u * hw * f * (1 - 0.06 * max(0, -v) ** 2 - 0.05 * max(0, v) ** 3)

    section_loft(bm, ys, body_shape, segs, uvl, PAINT)
    body_ob = to_object(name + "_body", bm, MATS)

    # wheel arches cut with booleans
    R = P["wheel_r"]
    for wy in (P["axle_f"], P["axle_r"]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=R + 0.075, depth=hw * 2 + 0.4, location=(0, wy, R + 0.01), rotation=(0, math.pi / 2, 0))
        cutter = bpy.context.active_object
        mod = body_ob.modifiers.new("arch", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        mod.solver = "EXACT"
        bpy.context.view_layer.objects.active = body_ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)
    if LUX:
        # two-tone: dark lower body below the chrome waist strip
        for p in body_ob.data.polygons:
            if p.center.z < P["split_z"]:
                p.material_index = PAINT2
    if POLICE:
        lo, hi = P["axle_f"] + R + 0.12, P["axle_r"] - R - 0.12
        for p in body_ob.data.polygons:
            c, n = p.center, p.normal
            if abs(n.x) > 0.35 and lo < c.y < hi and 0.27 < c.z < 0.97:
                p.material_index = LIVERY

    # ---- greenhouse + details in a second bmesh (joined afterwards)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    gh = P["cabin"]  # (y, z_bottom, z_top, half_w_bottom, half_w_top)
    g_unit = superellipse(20, 7)
    g_ys = [round(gh[0][0] + k * 0.07, 3) for k in range(int((gh[-1][0] - gh[0][0]) / 0.07) + 1)]

    def cabin_shape(y):
        zb, zt, wb, wt = interp(gh, y)
        out = []
        for u, v in g_unit:
            t = (v + 1) / 2
            out.append((u * (wb + (wt - wb) * t), zb - 0.06 + (zt - zb + 0.06) * t))
        return out

    section_loft(bm, g_ys, cabin_shape, 20, uvl, GLASS)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    roof0, roof1 = P["roof_span"]
    bpil = P.get("b_pillar")
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        zb, zt, wb, wt = interp(gh, c.y)
        if c.z < zb + 0.02:
            f.material_index = TRIM if abs(n.x) > 0.5 else PAINT
        elif n.z > 0.8 and roof0 < c.y < roof1:
            f.material_index = PAINT
        elif abs(n.x) > 0.55:
            if c.y < P["a_pillar_end"] or c.y > P["c_pillar_start"] or (bpil and bpil[0] < c.y < bpil[1]):
                f.material_index = PAINT if not (bpil and bpil[0] < c.y < bpil[1]) else TRIM
            elif c.z > zt - 0.04:
                f.material_index = PAINT
        elif 0.2 < abs(n.x) <= 0.55 and n.z > 0.3:
            if c.y < roof0 + 0.05 or c.y > roof1 - 0.05:
                f.material_index = PAINT  # A / C pillar edges framing the screens
        if CARGO and f.material_index == GLASS and (c.y > P["c_pillar_start"] or n.y > 0.5 or (n.z > 0.6 and c.y > roof0) or 0.4 < abs(n.x) < 0.93):
            f.material_index = PAINT
        if CARGO and f.material_index == GLASS and c.y < P["a_pillar_end"] and abs(c.x) > P["half_width"] * .78:
            f.material_index = PAINT  # straight A-pillars framing the windshield

    if LUX:
        # chrome window surrounds instead of black rubber
        for f in bm.faces:
            if f.material_index == TRIM and abs(f.normal.x) > 0.5:
                f.material_index = CHROME

    def strip(mat, y0, y1, z0, z1, off=0.004, uv_check=None):
        """band following the body surface on both sides between y0..y1, z0..z1"""
        ny = max(2, int((y1 - y0) / 0.08))
        zs = [z0 + (z1 - z0) * k / 3 for k in range(4)]
        for sd in (1, -1):
            grid = [[bm.verts.new((sd * (body_x(y0 + (y1 - y0) * i / ny, z) + off), y0 + (y1 - y0) * i / ny, z)) for z in zs] for i in range(ny + 1)]
            for i in range(ny):
                for k in range(3):
                    quad = (grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]) if sd < 0 else (grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k])
                    f = bm.faces.new(quad)
                    f.material_index = mat
                    for loop in f.loops:
                        co = loop.vert.co
                        sc = uv_check or 1.0
                        loop[uvl].uv = ((co.y - y0) / sc, (co.z - z0) / sc)

    if TAXI:
        cz0, cz1 = P["checker_z"]
        strip(CHECKER, P["checker_y"][0], P["checker_y"][1], cz0, cz1, uv_check=(cz1 - cz0))
        sy, sz = P["sign"]
        for sd in (1, -1):
            prim(bm, "cube", TRIM, T(sd * .2, sy, sz - .015, .05, .1, .05))  # roof clamps
        prim(bm, "cube", SIGN, T(0, sy, sz + .1, .58, .15, .17))
        prim(bm, "cube", TRIM, T(0, sy, sz + .012, .6, .17, .024))
    if LUX:
        strip(CHROME, P["axle_f"] + R + .1, P["axle_r"] - R - .1, P["split_z"] - .012, P["split_z"] + .012, off=0.005)

    # ---- lights, grille, bumpers, mirrors, plates, handles
    zf = interp(body, front + 0.06)
    for s in (1, -1):
        hx = s * hw * 0.68
        hy = front + P.get("head_y", 0.12)
        if P.get("head_style") == "slim":
            # thin LED strips swept back along the nose
            prim(bm, "cube", HEAD, T(s * hw * 0.66, hy, P["head_z"], .36, .1, .035, rz=-s * 0.32, rx=-0.25))
            prim(bm, "cube", TRIM, T(s * hw * 0.66, hy + .01, P["head_z"] - .02, .38, .1, .02, rz=-s * 0.32, rx=-0.25))
        else:
            prim(bm, "sphere", HEAD, T(hx, hy, P["head_z"], .2, .045, .06, rz=-s * 0.12), segs=10, rings=6)
            prim(bm, "sphere", CHROME, T(hx, hy + 0.01, P["head_z"], .21, .04, .065, rz=-s * 0.12), segs=10, rings=6)
        prim(bm, "cube", INDIC, T(s * hw * 0.9, hy + 0.08, P["head_z"] - 0.02, .08, .14, .05, rz=-s * 0.5))
        if P.get("tail_style") == "vertical":
            prim(bm, "cube", TRIM, T(s * hw * 0.86, rear + 0.005, P["tail_z"], .14, .03, .4))
            prim(bm, "cube", TAIL, T(s * hw * 0.86, rear + 0.02, P["tail_z"] + .06, .11, .03, .2))
            prim(bm, "cube", INDIC, T(s * hw * 0.86, rear + 0.02, P["tail_z"] - .1, .11, .03, .1))
        else:
            prim(bm, "sphere", TAIL, T(s * hw * 0.66, rear - 0.07, P["tail_z"], .24, .06, .06, rz=s * 0.1), segs=10, rings=6)
            prim(bm, "cube", TRIM, T(s * hw * 0.66, rear - 0.055, P["tail_z"], .5, .05, .13, rz=s * 0.1))
        # side mirror
        my, mz = P["mirror"]
        prim(bm, "cube", TRIM, T(s * (hw * 0.93), my, mz - 0.02, .12, .05, .04))
        prim(bm, "sphere", PAINT, T(s * (hw + 0.1), my + 0.02, mz, .1, .05, .065), segs=12, rings=8)
        prim(bm, "cube", GLASS, T(s * (hw + 0.115), my - 0.025, mz, .085, .004, .05))
        # door handles + seams
        for hy in P["handles"]:
            prim(bm, "cube", CHROME, T(s * (hw * 0.995), hy, P["handle_z"], .02, .14, .025))
        for sy in P["seams"]:
            prim(bm, "cube", TRIM, T(s * (hw * 1.0005), sy, (P["seam_z"][0] + P["seam_z"][1]) / 2, .006, .006, P["seam_z"][1] - P["seam_z"][0]))
        if P.get("upper_seams"):
            ux, uz0, uz1 = P["upper_seam_x"], P["upper_seam_z"][0], P["upper_seam_z"][1]
            for sy in P["upper_seams"]:
                prim(bm, "cube", TRIM, T(s * ux, sy, (uz0 + uz1) / 2, .006, .006, uz1 - uz0))
            # sliding-door track along the box
            prim(bm, "cube", TRIM, T(s * ux, (P["upper_seams"][0] + P["upper_seams"][-1]) / 2, uz1 - .12,
                                     .008, P["upper_seams"][-1] - P["upper_seams"][0], .012))
        # exhaust
        if P.get("quad_exhaust"):
            for ex in (.1, .24):
                prim(bm, "cyl", CHROME, T(s * ex, rear + 0.03, P["exhaust_z"], rx=math.pi / 2), r1=.042, depth=.14, segs=12)
        elif s == 1 or P.get("dual_exhaust"):
            prim(bm, "cyl", CHROME, T(s * hw * 0.55, rear + 0.02, 0.28, rx=math.pi / 2), r1=.045, depth=.16, segs=12)
        if SUPER:
            # side air intake in front of the rear wheel, set into the body side
            iy0, iy1 = P["intake_y"]
            for k in range(4):
                y = iy0 + (iy1 - iy0) * (k + .5) / 4
                z = .58 - k * .02
                prim(bm, "cube", TRIM, T(s * (body_x(y, z) - .005), y, z, .03, (iy1 - iy0) / 4 * .9, .26 - k * .03))
            prim(bm, "cube", PAINT, T(s * (body_x(iy0, .72) + .01), (iy0 + iy1) / 2, .72, .03, iy1 - iy0, .03, rz=s * .05))
    # grille + lower intake + bumpers
    gy = front + P.get("grille_y", 0.045)
    gstyle = P.get("grille_style", "bar")
    if gstyle == "tall":
        # upright chrome temple grille with vertical vanes and a bonnet mascot
        gz0, gz1, gw = P["grille_box"]
        prim(bm, "cube", CHROME, T(0, gy, (gz0 + gz1) / 2, gw, .08, gz1 - gz0))
        prim(bm, "cube", TRIM, T(0, gy - .045, (gz0 + gz1) / 2, gw - .08, .02, gz1 - gz0 - .08))
        for k in range(11):
            prim(bm, "cube", CHROME, T(-(gw - .12) / 2 + (gw - .12) * k / 10, gy - .055, (gz0 + gz1) / 2, .012, .02, gz1 - gz0 - .08))
        prim(bm, "cube", CHROME, T(0, gy + .03, gz1 + .025, gw + .03, .1, .04))
        prim(bm, "cube", CHROME, T(0, gy + .12, gz1 + .09, .03, .05, .09, rx=-.4))
    elif gstyle == "intake":
        # wide low intakes + splitter
        for sx in (-1, 1):
            prim(bm, "cube", TRIM, T(sx * hw * .5, gy + .02, P["grille_z"], hw * .62, .06, .12, rz=sx * .1))
        prim(bm, "cube", TRIM, T(0, gy + .03, P["grille_z"] - .02, hw * .5, .06, .08))
        prim(bm, "cube", TRIM, T(0, front + .06, .16, hw * 1.9, .2, .025))
    else:
        prim(bm, "cube", TRIM, T(0, gy, P["grille_z"], hw * 1.0, .06, .17))
        prim(bm, "cube", CHROME, T(0, gy - 0.025, P["grille_z"] + 0.09, hw * 1.02, .02, .018))
    bz = P.get("bumper_z", (0.3, 0.33))
    prim(bm, "cube", CHROME if LUX else TRIM, T(0, front + 0.08, bz[0], hw * 1.55, .14, .06 if LUX else .1))
    prim(bm, "cube", CHROME if LUX else TRIM, T(0, rear - 0.08, bz[1], hw * 1.6, .14, .06 if LUX else .1))
    if SUPER:
        # rear diffuser with fins, and a rear wing on two struts
        prim(bm, "cube", TRIM, T(0, rear - .12, .2, hw * 1.7, .3, .1, rx=.25))
        for k in range(-3, 4):
            prim(bm, "cube", TRIM, T(k * .2, rear - .1, .2, .015, .28, .14, rx=.25))
        wy, wz = P["wing"]
        prim(bm, "cube", PAINT, T(0, wy, wz, hw * 1.75, .3, .03, rx=.12))  # wing plane
        for sx in (-1, 1):
            prim(bm, "cube", PAINT, T(sx * hw * .87, wy, wz - .015, .02, .32, .1))  # end plates
            prim(bm, "cube", TRIM, T(sx * .42, wy + .05, wz - .1, .04, .1, .2, rx=-.2))  # struts
    prim(bm, "cube", PLATE, T(0, front + 0.005, 0.42, .52, .02, .12))
    prim(bm, "cube", PLATE, T(0, rear - 0.005, P.get("plate_rear_z", P["tail_z"] - 0.16), .52, .02, .12))
    if P.get("rear_doors"):
        rz0, rz1 = P["rear_doors"]
        prim(bm, "cube", TRIM, T(0, rear + 0.004, (rz0 + rz1) / 2, .012, .012, rz1 - rz0))
        for s in (1, -1):
            prim(bm, "cube", CHROME, T(s * .07, rear + 0.015, (rz0 + rz1) / 2 - .05, .025, .02, .16))
            prim(bm, "cube", TRIM, T(s * hw * .7, rear + 0.006, rz1 - .05, .08, .012, .025))  # hinges
            prim(bm, "cube", TRIM, T(s * hw * .7, rear + 0.006, rz0 + .1, .08, .012, .025))
    prim(bm, "cube", TRIM, T(0, rear - 0.04, P["tail_z"], hw * 0.7, .03, .08))
    # side skirts
    for s in (1, -1):
        prim(bm, "cube", TRIM, T(s * hw * 0.97, (P["axle_f"] + P["axle_r"]) / 2, 0.26, .06, P["axle_r"] - P["axle_f"] - 2 * R - 0.2, .1))
    if P.get("spoiler"):
        prim(bm, "cube", PAINT, T(0, rear - 0.18, P["body"][-3][3] + 0.07, hw * 1.6, .2, .025))
        for s in (1, -1):
            prim(bm, "cube", PAINT, T(s * hw * 0.6, rear - 0.16, P["body"][-3][3] + 0.03, .04, .1, .07))

    if POLICE:
        ly, lz = P["lightbar"]
        prim(bm, "cube", TRIM, T(0, ly, lz + .025, 1.18, .27, .05))
        for s in (1, -1):
            prim(bm, "cube", TRIM, T(s * .45, ly, lz - .01, .06, .2, .04))  # roof feet
        prim(bm, "cube", SIREN_R, T(.3, ly, lz + .09, .55, .23, .085))
        prim(bm, "cube", SIREN_B, T(-.3, ly, lz + .09, .55, .23, .085))
        prim(bm, "cube", CHROME, T(0, ly, lz + .09, .04, .24, .09))
        # push bar
        py = front - .1
        for s in (1, -1):
            prim(bm, "cube", TRIM, T(s * .33, py, .56, .06, .06, .52))
            prim(bm, "cube", TRIM, T(s * .33, py + .1, .42, .05, .2, .05))
        for z in (.46, .8):
            prim(bm, "cube", TRIM, T(0, py, z, .8, .055, .055))

    # ---- interior: floor, seats, dash, steering wheel
    seat_x = P["seat_x"]
    floor_back = P["rear_seat_y"] if P.get("rear_seat", True) else P["seat_y"] + .3
    prim(bm, "cube", INT, T(0, (P["dash_y"] + floor_back) / 2, max(0.34 + FL, P.get("floor_min", 0.0)), hw * 1.7, floor_back - P["dash_y"] + 0.4, .04))
    for sx, sy in ((seat_x, P["seat_y"]), (-seat_x, P["seat_y"])):
        prim(bm, "cube", INT, T(sx, sy, 0.39 + FL, .5, .52, .12))
        prim(bm, "cube", INT, T(sx, sy + 0.33, 0.72 + FL, .5, .12, .62, rx=-0.32))
        prim(bm, "cube", INT, T(sx, sy + 0.45, 1.06 + FL, .26, .1, .16, rx=-0.32))
    if P.get("rear_seat", True):
        prim(bm, "cube", INT, T(0, P["rear_seat_y"], 0.5, hw * 1.5, .5, .16))
        prim(bm, "cube", INT, T(0, P["rear_seat_y"] + 0.28, 0.8, hw * 1.5, .14, .6, rx=-0.25))
    elif P.get("bulkhead", True):
        # bulkhead between the cab and the cargo box
        prim(bm, "cube", INT, T(0, P["seat_y"] + .62, 1.3, hw * 1.72, .04, 1.36))
    else:
        # two-seater: firewall in front of the mid-mounted engine
        prim(bm, "cube", INT, T(0, P["seat_y"] + .58, .5, hw * 1.6, .05, .6))
    prim(bm, "cube", INT, T(0, P["dash_y"] + 0.08, 0.78 + FL, hw * 1.6, .36, .18))
    prim(bm, "cube", INT, T(0, (P["dash_y"] + P["seat_y"]) / 2 + 0.1, 0.55 + FL, .22, .9, .2))
    wheel_c = V((seat_x, P["dash_y"] + 0.3, 0.95 + FL))
    prim(bm, "torus", TRIM, T(*wheel_c, rx=math.radians(-62)), R=0.18, r=0.017, n1=16, n2=5)
    prim(bm, "cyl", TRIM, T(seat_x, P["dash_y"] + 0.22, 0.91 + FL, rx=math.radians(28)), r1=0.025, depth=0.25, segs=8)
    prim(bm, "cyl", TRIM, T(*wheel_c, rx=math.radians(28)), r1=0.05, depth=0.05, segs=12)

    detail_ob = to_object(name + "_details", bm, MATS)
    for p in detail_ob.data.polygons:
        if detail_ob.data.materials[p.material_index].name in ("Interior", "Plate", "Trim"):
            p.use_smooth = False

    # wheel arch liners
    bm = bmesh.new()
    bm.loops.layers.uv.verify()
    for wy in (P["axle_f"], P["axle_r"]):
        for s in (1, -1):
            prim(bm, "cyl", TRIM, T(s * (hw - 0.17), wy, R + 0.01, ry=math.pi / 2), r1=R + 0.07, depth=0.36, segs=18, caps=False)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < R - 0.05], context="VERTS")
    liner = to_object(name + "_liners", bm, MATS)
    m2 = liner.modifiers.new("flip", "SOLIDIFY")
    m2.thickness = 0.01

    # POLICE lettering on both front doors: thin real geometry, reading front-to-back from outside
    texts = []
    if POLICE:
        ty, tz = P["police_text"]
        for s in (1, -1):
            # text local X (reading direction) -> +Y on the left (+X) side, -Y on the right side;
            # local Y (up) -> +Z; local Z (facing) -> outward
            Mrot = Matrix(((0, 0, s, 0), (s, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
            texts.append(make_text("police_" + ("L" if s > 0 else "R"), "POLICE", .17,
                                   Matrix.Translation((s * (hw + .006), ty, tz)) @ Mrot, MATS[DECAL]))

    if TAXI:
        sy, sz = P["sign"]
        # front face (seen from ahead, reads left-to-right = +X) and back face (seen from behind = -X)
        Mf = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        Mb = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        texts.append(make_text("taxi_F", "TAXI", .13, Matrix.Translation((0, sy - .077, sz + .1)) @ Mf, MATS[DECAL]))
        texts.append(make_text("taxi_B", "TAXI", .13, Matrix.Translation((0, sy + .077, sz + .1)) @ Mb, MATS[DECAL]))

    # join body parts
    bpy.ops.object.select_all(action="DESELECT")
    for ob in (body_ob, detail_ob, liner, *texts):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = body_ob
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    body_ob.name = "Body"
    # flip liner normals inward visually: rely on double-sided-ish solidify

    # ---- driver door: cut out of the body (skin, window, handle, lettering) as its own object,
    # hinged on its front edge so the game can swing it open. The cutter is an L-shaped prism:
    # the lower part reaches in to 80% of the half width (clear of the seats and dash), the
    # window part stops just inside the side glass and just under the roof line.
    y0, y1 = P["seams"][0] + 0.004, P["seams"][1] - 0.004
    z0 = P["seam_z"][0] - 0.01
    x_low = hw * 0.8
    # slice the whole body along the door seams, then hand every face inside the door outline
    # (lower panel out to the skin, window part out from just inside the side glass) to the door
    bm = bmesh.new()
    bm.from_mesh(body_ob.data)
    for co, no in (((0, y0, 0), (0, 1, 0)), ((0, y1, 0), (0, 1, 0)), ((0, 0, z0), (0, 0, 1))):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)

    def in_door(f):
        c = f.calc_center_median()
        if not (y0 < c.y < y1 and c.z > z0 and c.x > 0):
            return False
        zb_, zt_, wb_, wt_ = interp(gh, c.y)
        if c.z < zb_ - 0.02:
            return c.x > x_low
        return c.z < zt_ - 0.035 and c.x > wt_ - 0.06

    door_faces = [f for f in bm.faces if in_door(f)]
    bm_door = bm.copy()
    keep = {f.index for f in door_faces}
    bm_door.faces.ensure_lookup_table()
    bmesh.ops.delete(bm_door, geom=[f for f in bm_door.faces if f.index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=door_faces, context="FACES")
    bm.to_mesh(body_ob.data)
    bm.free()
    door_me = bpy.data.meshes.new("Door_L")
    bm_door.to_mesh(door_me)
    bm_door.free()
    for m in body_ob.data.materials:
        door_me.materials.append(m)
    door_ob = bpy.data.objects.new("Door_L", door_me)
    scene.collection.objects.link(door_ob)
    # pivot on the hinge line (outer skin, front edge)
    hinge = V((hw - 0.02, y0, (z0 + interp(gh, y0)[0]) / 2))
    door_ob.data.transform(Matrix.Translation(-hinge))
    door_ob.name = "Door_L"
    door_ob.parent = body_ob
    door_ob.matrix_parent_inverse = Matrix()
    door_ob.location = hinge
    print("DOOR", name, len(door_ob.data.polygons), "faces")

    # ---- wheels
    for wid, wx, wy in (("FL", 1, P["axle_f"]), ("FR", -1, P["axle_f"]), ("RL", 1, P["axle_r"]), ("RR", -1, P["axle_r"])):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        tw = P["tire_w"] / 2
        prof = [(-tw, R * 0.66), (-tw * 0.98, R * 0.9), (-tw * 0.86, R * 0.985), (-tw * 0.6, R), (tw * 0.6, R),
                (tw * 0.86, R * 0.985), (tw * 0.98, R * 0.9), (tw, R * 0.66)]
        n = 20
        rings = []
        for k, (x, r) in enumerate(prof):
            rings.append([bm.verts.new((x, r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n))) for i in range(n)])
        for k, (a, b) in enumerate(zip(rings, rings[1:])):
            for i in range(n):
                j = (i + 1) % n
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                for loop, uv in zip(f.loops, ((i / n * 6, k / 7), ((i + 1) / n * 6, k / 7), ((i + 1) / n * 6, (k + 1) / 7), (i / n * 6, (k + 1) / 7))):
                    loop[uvl].uv = uv
        # rim face on the outer side, spokes, hub, brake disc
        out = wx * tw * 0.75
        prim(bm, "cyl", 1, T(out - wx * 0.02, 0, 0, ry=math.pi / 2), r1=R * 0.67, depth=0.03, segs=20)
        prim(bm, "cyl", 1, T(0, 0, 0, ry=math.pi / 2), r1=R * 0.64, depth=tw * 1.6, segs=20)
        prim(bm, "torus", 1, T(out, 0, 0, ry=math.pi / 2), R=R * 0.63, r=0.018, n1=20, n2=4)
        for k in range(P.get("spokes", 5)):
            a = 2 * math.pi * k / P.get("spokes", 5)
            prim(bm, "cube", 1, T(out + wx * 0.012, 0, 0, rx=a) @ Matrix.Translation((0, 0, R * 0.33)) @ Matrix.Diagonal((0.03, 0.055, R * 0.62, 1)))
        prim(bm, "cyl", 1, T(out + wx * 0.025, 0, 0, ry=math.pi / 2), r1=R * 0.17, depth=0.04, segs=16)
        prim(bm, "cyl", 2, T(-wx * 0.02, 0, 0, ry=math.pi / 2), r1=R * 0.55, depth=0.025, segs=14)
        wob = to_object("wheel_" + wid, bm, [rubber, rim, disc])
        wob.location = (wx * P["track"] / 2, wy, R)
    # ---- markers for the game
    for mname, loc in (("seat_driver", (seat_x, P["seat_y"], 0.45 + FL)), ("door_driver", (hw + 0.55, P["seat_y"] - 0.1, 0)),
                       ("cam_target", (0, 0, 1.2))):
        e = bpy.data.objects.new(mname, None)
        e.location = loc
        scene.collection.objects.link(e)

    root = bpy.data.objects.new(name, None)
    scene.collection.objects.link(root)
    for ob in list(scene.collection.objects):
        if ob is not root and ob.parent is None:
            ob.parent = root

    path = os.path.join(ROOT, "assets", "models", f"car_{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_image_format="JPEG", export_extras=True)
    print("EXPORTED", path, sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH"), "faces")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", f"car_{name}.blend"))

    if PREVIEW:
        out = ARGS[ARGS.index("--preview") + 1]
        os.makedirs(out, exist_ok=True)
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "TEXTURE"
        scene.render.resolution_x, scene.render.resolution_y = 800, 500
        # driver probe: hips land at seat + 0.09, head top 0.83 above the hips, head 0.14 behind the hips
        probe_h = 0.83
        bpy.ops.mesh.primitive_cube_add(size=1, location=(seat_x, P["seat_y"] + 0.07, 0.45 + FL + 0.09 + probe_h / 2))
        probe = bpy.context.active_object
        probe.name = "driver_probe"
        probe.scale = (0.3, 0.36, probe_h)
        probe.data.materials.append(material("Probe", "22cc44", 0.5))
        cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam.data.lens = 50
        for tag, loc in (("34", (4.2, -5.2, 2.0)), ("rear", (-3.8, 5.0, 1.8)), ("side", (7.5, 0, 1.0)), ("side_r", (-7.5, 0, 1.0)),
                         ("front", (0, -6.5, 1.5)), ("back", (0, 6.5, 1.5))):
            cam.location = loc
            cam.rotation_euler = (V((0, 0, 0.7)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(out, f"{name}_{tag}.png")
            bpy.ops.render.render(write_still=True)
        # door swung open (about its hinge, rear edge outward)
        door = bpy.data.objects.get("Door_L")
        if door:
            door.rotation_euler = (0, 0, -1.15)
            bpy.context.view_layer.update()
            for tag, loc in (("open34", (4.6, 3.0, 2.2)), ("openfront", (3.0, -5.0, 1.6))):
                cam.location = loc
                cam.rotation_euler = (V((0.6, 0, 0.7)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
                scene.render.filepath = os.path.join(out, f"{name}_{tag}.png")
                bpy.ops.render.render(write_still=True)
            door.rotation_euler = (0, 0, 0)


SEDAN = dict(
    color="9b1b23", length=4.72, half_width=0.92, wheel_r=0.34, tire_w=0.235, track=1.58,
    axle_f=-1.42, axle_r=1.42,
    body=[(-2.36, .80, .34, .64), (-2.33, .90, .27, .74), (-2.2, .96, .23, .8), (-1.9, .99, .22, .85), (-1.0, 1.0, .22, .93),
          (-.75, 1.0, .22, .97), (0.0, 1.0, .22, .99), (1.0, 1.0, .22, 1.0), (1.55, 1.0, .23, 1.02), (2.2, .97, .27, 1.0),
          (2.33, .9, .32, .93), (2.37, .8, .38, .82)],
    cabin=[(-.8, .955, .965, 0.800, 0.807), (-.45, .975, 1.17, 0.800, 0.722), (-.02, .99, 1.42, 0.800, 0.646), (.45, .995, 1.45, 0.800, 0.646),
           (.9, 1.0, 1.42, 0.800, 0.646), (1.25, 1.005, 1.2, 0.800, 0.703), (1.52, 1.015, 1.03, 0.800, 0.798)],
    roof_span=(-.02, .9), a_pillar_end=-.62, c_pillar_start=1.06, b_pillar=(.36, .46),
    head_z=.72, tail_z=.86, grille_z=.6, mirror=(-.62, 1.04), handles=(-.1, .78), handle_z=.88,
    seams=(-.6, .41, 1.3), seam_z=(.36, .95), seat_x=.38, seat_y=.15, rear_seat_y=.95, dash_y=-.62, spokes=5,
)
COUPE = dict(
    color="1d4fb3", length=4.5, half_width=0.94, wheel_r=0.35, tire_w=0.26, track=1.62, rim="2a2b2e",
    axle_f=-1.38, axle_r=1.3,
    body=[(-2.25, .80, .3, .58), (-2.22, .9, .24, .68), (-2.08, .97, .2, .74), (-1.7, 1.0, .2, .8), (-.9, 1.0, .2, .88),
          (-.55, 1.0, .2, .92), (0.2, 1.0, .2, .95), (1.0, 1.0, .21, .97), (1.6, .99, .23, .99), (2.1, .96, .27, .97),
          (2.22, .9, .32, .92), (2.26, .8, .38, .82)],
    cabin=[(-.6, .915, .925, 0.809, 0.817), (-.25, .935, 1.14, 0.809, 0.703), (.1, .95, 1.36, 0.800, 0.627), (.55, .96, 1.37, 0.800, 0.627),
           (1.05, .97, 1.2, 0.800, 0.684), (1.55, .985, .995, 0.800, 0.798)],
    roof_span=(.1, .6), a_pillar_end=-.45, c_pillar_start=.8, b_pillar=None,
    head_z=.66, tail_z=.82, grille_z=.5, mirror=(-.4, .98), handles=(.45,), handle_z=.84,
    seams=(-.45, .75), seam_z=(.34, .9), seat_x=.38, seat_y=.3, rear_seat_y=1.0, dash_y=-.45, spokes=10,
    spoiler=True, dual_exhaust=True,
)

POLICE = dict(SEDAN, color="15161a", police=True, lightbar=(.38, 1.45), police_text=(-.1, .62), rim="3a3b3e")
VAN = dict(
    color="e8e8e4", length=5.1, half_width=0.98, wheel_r=0.37, tire_w=0.23, track=1.72,
    axle_f=-1.72, axle_r=1.58,
    body=[(-2.55, .85, .38, .86), (-2.52, .93, .3, .95), (-2.4, .98, .26, 1.0), (-2.1, 1.0, .25, 1.04), (-1.75, 1.0, .25, 1.07),
          (2.42, 1.0, .25, 1.07), (2.52, .97, .28, 1.07), (2.55, .9, .32, 1.06)],
    cabin=[(-1.9, 1.02, 1.08, .9, .9), (-1.62, 1.03, 1.55, .93, .9), (-1.3, 1.04, 1.98, .94, .88), (-1.05, 1.04, 2.05, .95, .89),
           (2.42, 1.04, 2.05, .95, .89), (2.55, 1.04, 1.99, .94, .88)],
    roof_span=(-1.15, 2.6), a_pillar_end=-1.28, c_pillar_start=-.5, b_pillar=None, cargo=True,
    head_z=.82, tail_z=1.0, tail_style="vertical", plate_rear_z=.55, grille_z=.62, mirror=(-1.6, 1.42), handles=(-.72, .55), handle_z=1.0,
    seams=(-1.62, -.42, 1.35), seam_z=(.36, 1.04), upper_seams=(-.42, 1.35), upper_seam_x=.955, upper_seam_z=(1.06, 1.95),
    rear_doors=(.34, 1.97), head_y=0.0, grille_y=0.0, seat_x=.42, seat_y=-.85, rear_seat_y=.2, rear_seat=False, dash_y=-1.5, floor=.25, spokes=6,
)

TAXI = dict(SEDAN, color="f2c12e", taxi=True, rim="b8bcc2", checker_y=(-1.0, 1.05), checker_z=(.79, .85), sign=(.42, 1.455))
SUPER = dict(
    color="e8501c", length=4.55, half_width=1.0, wheel_r=0.36, tire_w=0.3, track=1.72, rim="2a2b2e",
    axle_f=-1.38, axle_r=1.36, super=True,
    body=[(-2.275, .78, .2, .42), (-2.24, .9, .16, .52), (-2.1, .97, .14, .6), (-1.8, 1.0, .14, .72), (-1.38, 1.0, .14, .84),
          (-.95, 1.0, .14, .86), (0.0, 1.0, .14, .87), (.6, 1.0, .14, .89), (1.3, 1.0, .15, .93), (1.9, .99, .18, .94),
          (2.2, .95, .24, .9), (2.275, .86, .32, .84)],
    cabin=[(-.95, .86, .88, .84, .84), (-.6, .865, 1.03, .84, .72), (-.2, .87, 1.18, .83, .62), (.35, .88, 1.21, .83, .6),
           (.85, .89, 1.1, .83, .66), (1.45, .93, .97, .83, .8), (1.75, .94, .95, .82, .82)],
    roof_span=(-.2, .6), a_pillar_end=-.55, c_pillar_start=.62, b_pillar=None,
    head_z=.5, head_y=.2, head_style="slim", grille_style="intake", grille_z=.3, tail_z=.72, plate_rear_z=.45, bumper_z=(.2, .3),
    mirror=(-.45, .96), handles=(.25,), handle_z=.76, seams=(-.55, .62), seam_z=(.3, .84),
    quad_exhaust=True, exhaust_z=.3, intake_y=(.62, 1.0), wing=(2.0, 1.16),
    seat_x=.4, seat_y=.15, rear_seat_y=.9, rear_seat=False, bulkhead=False, dash_y=-.55, floor=-.23, floor_min=.17, spokes=12,
)
LUX = dict(
    color="e9e5dc", length=5.4, half_width=0.98, wheel_r=0.37, tire_w=0.25, track=1.68, rim="e6e8ea",
    axle_f=-1.85, axle_r=1.78, lux=True, split_z=.62,
    body=[(-2.7, .86, .36, .86), (-2.67, .95, .3, .98), (-2.55, .99, .27, 1.04), (-2.0, 1.0, .26, 1.06), (-1.0, 1.0, .26, 1.07),
          (0.0, 1.0, .26, 1.08), (1.6, 1.0, .26, 1.09), (2.3, .99, .28, 1.08), (2.6, .95, .33, 1.02), (2.7, .85, .4, .9)],
    cabin=[(-.95, 1.06, 1.07, .85, .85), (-.6, 1.07, 1.3, .85, .77), (-.25, 1.08, 1.53, .85, .7), (1.2, 1.09, 1.55, .85, .7),
           (1.65, 1.09, 1.4, .85, .75), (1.95, 1.1, 1.14, .85, .84)],
    roof_span=(-.25, 1.25), a_pillar_end=-.75, c_pillar_start=1.45, b_pillar=(.32, .42),
    head_z=.82, head_y=.1, grille_style="tall", grille_box=(.5, 1.0, .62), grille_y=-.02, tail_z=.9,
    mirror=(-.75, 1.15), handles=(.05, .95), handle_z=.98, seams=(-.7, .37, 1.45), seam_z=(.4, 1.06),
    seat_x=.4, seat_y=0.0, rear_seat_y=1.1, dash_y=-.75, spokes=14, dual_exhaust=True,
)

MODELS = {"sedan": SEDAN, "coupe": COUPE, "police": POLICE, "van": VAN, "taxi": TAXI, "super": SUPER, "lux": LUX}
only = [a for a in ARGS[1:] if a in MODELS]
for name in only or MODELS:
    build_car(name, MODELS[name])
