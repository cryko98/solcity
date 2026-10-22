"""
Builds a street motorbike (standard / naked bike) in Blender and exports
assets/models/car_bike.glb.

  blender -b --factory-startup -P blender/build_bike.py -- <project_root> [--preview <dir>]

Axes as the cars: the bike faces -Y (exports as +Z in three.js), left side = +X, Z up,
origin on the ground under the centre.

Hierarchy (the game depends on it):
  bike (root empty)
    Body                frame, engine, tank, seat, side covers, exhaust, swingarm, tail
      fork              origin at the steering head; its local Z (glTF/three.js local Y)
                        is the steering axis -> steer by rotating about that axis
        wheel_F         origin at the front hub, spins about local X
        grip_L, grip_R  handlebar grips (move with the steering)
      wheel_R           origin at the rear hub, spins about local X
      seat_driver, door_driver, cam_target, peg_L, peg_R
"""
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
PREVIEW = "--preview" in ARGS
V = Vector

# layout (metres); the rider animation is authored against these numbers
HUB_F = V((0, -0.72, 0.31))
HUB_R = V((0, 0.73, 0.31))
WHEEL_R = 0.31
HEAD = V((0, -0.48, 0.95))
SEAT_TOP = 0.72  # under the rider; seat_driver (hips joint) stays at 0.82
GRIP = V((0.36, -0.40, 1.02))
PEG = V((0.19, 0.18, 0.36))
AXIS = (HEAD - HUB_F).normalized()  # steering axis, pointing up
RAKE = math.atan2(AXIS.y, AXIS.z)


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return [srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def material(name, hexcol, rough=0.5, metal=0.0, coat=0.0, emit=None, emit_str=1.0, tex=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
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
    if tex:
        tn = m.node_tree.nodes.new("ShaderNodeTexImage")
        tn.image = tex
        m.node_tree.links.new(tn.outputs["Color"], b.inputs["Base Color"])
    m.diffuse_color = (*rgb, 1)
    return m


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


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

PAINT_M = material("Paint", "b3202a", 0.3, 0.5, coat=1.0)
TRIM_M = material("Trim", "18191b", 0.55)
CHROME_M = material("Chrome", "d8dadc", 0.12, 1.0)
HEAD_M = material("Headlight", "e8eef5", 0.05, 0.2, emit="fff6e0", emit_str=0.0)
TAIL_M = material("Taillight", "8a0b0b", 0.15, 0.1, emit="ff1a10", emit_str=0.0)
TIRE_M = material("Tire", "1e1e1f", 0.9, tex=tread_texture())
RIM_M = material("Rim", "2a2b2e", 0.25, 0.9)
BRAKE_M = material("Brake", "8a8c90", 0.35, 0.9)
SEAT_M = material("Seat", "141414", 0.7)
MATS = [PAINT_M, TRIM_M, CHROME_M, HEAD_M, TAIL_M, TIRE_M, RIM_M, BRAKE_M, SEAT_M]
PAINT, TRIM, CHROME, HEADL, TAIL, TIRE, RIM, BRAKE, SEAT = range(len(MATS))


# ------------------------------------------------------------------ primitives (world space)
def _mark(bm, verts, mi):
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mi


def aligned(a, b):
    """matrix placing a unit Z-aligned primitive between points a and b"""
    a, b = V(a), V(b)
    d = b - a
    q = V((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), d.length


def tube(bm, a, b, r, mi, segs=10, r2=None):
    M, L = aligned(a, b)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=L, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def ellip(bm, c, radii, mi, segs=16, rings=10, rx=0.0):
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*radii, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def box(bm, c, size, mi, rx=0.0, rz=0.0):
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*size, 1))
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def disc_x(bm, c, r, depth, mi, segs=20):
    """cylinder along X"""
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=depth, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def loft_y(bm, stations, mi, segs=16, exp=2.6):
    """closed sections along Y: stations = (y, cx, cz, half_w, half_h); superellipse cross-section"""
    rings = []
    for y, cx, cz, hw, hh in stations:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            c, s = math.cos(a), math.sin(a)
            u = math.copysign(abs(c) ** (2 / exp), c)
            w = math.copysign(abs(s) ** (2 / exp), s)
            ring.append(bm.verts.new((cx + u * hw, y, cz + w * hh)))
        rings.append(ring)
    faces = []
    for ra, rb in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            faces.append(bm.faces.new((ra[i], ra[j], rb[j], rb[i])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = mi


def make_obj(name, bm, world, parent=None, smooth=True, mats=MATS):
    """bm is in world space; the object gets transform `world`"""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(world.inverted())
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    place(ob, world, parent)
    return ob


def place(ob, world, parent):
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix()
        ob.matrix_basis = parent.matrix_world.inverted() @ world
    else:
        ob.matrix_basis = world
    bpy.context.view_layer.update()


def empty(name, pos, parent):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    scene.collection.objects.link(e)
    place(e, Matrix.Translation(V(pos)), parent)
    return e


# ------------------------------------------------------------------ body
bm = bmesh.new()
bm.loops.layers.uv.verify()
PIVOT = V((0, 0.12, 0.44))
# frame: twin spars from the steering head to the swingarm pivot + head tube
tube(bm, HEAD - AXIS * 0.09, HEAD + AXIS * 0.09, 0.042, TRIM)
for s in (1, -1):
    a = HEAD + V((s * 0.04, 0.02, -0.02))
    m = V((s * 0.11, -0.12, 0.8))
    p = V((s * 0.1, PIVOT.y, PIVOT.z + 0.02))
    tube(bm, a, m, 0.026, TRIM)
    tube(bm, m, p, 0.026, TRIM)
    tube(bm, a + V((0, 0, -0.1)), V((s * 0.08, -0.2, 0.42)), 0.02, TRIM)  # down tube
    # subframe under the seat
    tube(bm, V((s * 0.09, -0.02, 0.64)), V((s * 0.07, 0.72, 0.78)), 0.016, TRIM)
    tube(bm, V((s * 0.1, 0.12, 0.5)), V((s * 0.075, 0.5, 0.78)), 0.014, TRIM)
    # swingarm + shock
    tube(bm, V((s * 0.085, PIVOT.y, PIVOT.z)), V((s * 0.085, HUB_R.y, HUB_R.z)), 0.024, TRIM, r2=0.018)
    tube(bm, V((s * 0.085, 0.52, 0.37)), V((s * 0.08, 0.36, 0.74)), 0.017, CHROME)
    tube(bm, V((s * 0.085, 0.47, 0.47)), V((s * 0.082, 0.42, 0.6)), 0.03, PAINT)  # spring
    # footpegs + brackets
    tube(bm, PEG * V((s, 1, 1)) - V((s * 0.04, 0, 0)), PEG * V((s, 1, 1)) + V((s * 0.04, 0, 0)), 0.016, TRIM, segs=8)
    tube(bm, V((s * 0.11, 0.1, 0.44)), PEG * V((s, 1, 1)) - V((s * 0.03, 0, 0)), 0.012, TRIM, segs=6)
    # side covers
    ellip(bm, (s * 0.105, 0.24, 0.58), (0.045, 0.17, 0.07), PAINT, 14, 8)
    # crankcase covers
    disc_x(bm, (s * 0.155, -0.05, 0.47), 0.1, 0.035, CHROME)
# engine: crankcase, cylinder block with fins, head, radiator
box(bm, (0, -0.08, 0.5), (0.28, 0.42, 0.24), TRIM)
box(bm, (0, -0.2, 0.68), (0.24, 0.2, 0.16), TRIM, rx=-0.25)
for k in range(5):
    box(bm, (0, -0.215 + k * 0.004, 0.62 + k * 0.03), (0.27, 0.22, 0.008), CHROME, rx=-0.25)
box(bm, (0, -0.25, 0.79), (0.22, 0.16, 0.06), CHROME, rx=-0.25)
box(bm, (0, -0.37, 0.64), (0.3, 0.035, 0.24), TRIM, rx=0.15)
box(bm, (0, -0.39, 0.64), (0.26, 0.01, 0.2), CHROME, rx=0.15)
# fuel tank
loft_y(bm, [(-0.43, 0, 0.94, 0.06, 0.05), (-0.4, 0, 0.94, 0.12, 0.09), (-0.32, 0, 0.94, 0.16, 0.12), (-0.2, 0, 0.93, 0.165, 0.125),
            (-0.08, 0, 0.9, 0.15, 0.11), (0.0, 0, 0.86, 0.11, 0.08), (0.03, 0, 0.84, 0.06, 0.05)], PAINT, segs=18)
tube(bm, (0, -0.24, 1.05), (0, -0.24, 1.075), 0.03, CHROME, segs=12)
# seat: rider pocket with the top surface at z 0.72 for y 0.05-0.25, rising to the tank and the pillion
loft_y(bm, [(-0.04, 0, 0.77, 0.07, 0.03), (0.02, 0, 0.725, 0.12, 0.03), (0.08, 0, 0.69, 0.14, 0.03), (0.18, 0, 0.69, 0.14, 0.03),
            (0.26, 0, 0.7, 0.13, 0.03), (0.36, 0, 0.75, 0.11, 0.035), (0.46, 0, 0.81, 0.09, 0.03), (0.5, 0, 0.83, 0.06, 0.02)], SEAT, segs=18)
# tail cowl, tail light, plate
loft_y(bm, [(0.42, 0, 0.8, 0.1, 0.04), (0.55, 0, 0.83, 0.1, 0.055), (0.7, 0, 0.86, 0.075, 0.045), (0.8, 0, 0.87, 0.045, 0.03)], PAINT, segs=14)
box(bm, (0, 0.8, 0.865), (0.09, 0.03, 0.04), TAIL)
tube(bm, (0, 0.74, 0.8), (0, 0.86, 0.66), 0.012, TRIM, segs=6)
box(bm, (0, 0.88, 0.62), (0.18, 0.012, 0.12), CHROME, rx=0.25)
for s in (1, -1):
    box(bm, (s * 0.07, 0.86, 0.69), (0.04, 0.02, 0.025), HEADL)  # rear indicators (amber-ish lens)
# exhaust: header from the cylinder, under the engine, muffler on the right side
pts = [V((-0.06, -0.33, 0.66)), V((-0.08, -0.38, 0.45)), V((-0.11, -0.2, 0.3)), V((-0.15, 0.2, 0.31)), V((-0.16, 0.34, 0.38))]
for a, b in zip(pts, pts[1:]):
    tube(bm, a, b, 0.024, CHROME, segs=10)
    ellip(bm, b, (0.024, 0.024, 0.024), CHROME, 10, 6)
tube(bm, (-0.16, 0.3, 0.37), (-0.165, 0.76, 0.52), 0.055, CHROME, segs=16, r2=0.048)
tube(bm, (-0.165, 0.76, 0.52), (-0.166, 0.79, 0.53), 0.046, TRIM, segs=16)
# chain + front sprocket cover
for dz in (0.03, -0.03):
    tube(bm, (0.11, 0.02, 0.42 + dz), (0.11, HUB_R.y, HUB_R.z + dz * 2.5), 0.007, TRIM, segs=6)
disc_x(bm, (0.12, 0.02, 0.42), 0.05, 0.02, TRIM, 14)
body = make_obj("Body", bm, Matrix())

# ------------------------------------------------------------------ fork (steers)
FORK_W = Matrix.Translation(HEAD) @ Matrix.Rotation(-RAKE, 4, "X")
bm = bmesh.new()
bm.loops.layers.uv.verify()
up = AXIS
top = HEAD + up * 0.07
for s in (1, -1):
    off = V((s * 0.085, 0, 0))
    lower_top = HUB_F + up * 0.28
    tube(bm, HUB_F + off - up * 0.02, lower_top + off, 0.03, TRIM, segs=12)  # slider
    tube(bm, lower_top + off, top + off, 0.021, CHROME, segs=12)  # stanchion
    # brake caliper on the left leg
    if s == 1:
        box(bm, HUB_F + V((0.06, 0.05, 0.12)), (0.03, 0.05, 0.1), CHROME)
# triple clamps
for z in (0.07, -0.1):
    c = HEAD + up * z
    box(bm, c, (0.24, 0.07, 0.025), TRIM, rx=-RAKE)
# handlebar: risers, bar, grips, levers
bar_c = V((0, -0.45, 1.04))
tube(bm, top, bar_c, 0.018, CHROME, segs=8)
for s in (1, -1):
    g = GRIP * V((s, 1, 1))
    bar_end = g - V((s * 0.06, 0.005, -0.002))
    tube(bm, bar_c + V((s * 0.04, 0, 0)), bar_end, 0.012, CHROME, segs=8)
    tube(bm, bar_c, bar_c + V((s * 0.04, 0, 0)), 0.014, CHROME, segs=8)
    tube(bm, g - V((s * 0.065, 0, 0)), g + V((s * 0.065, 0, 0)), 0.019, TRIM, segs=10)
    box(bm, g + V((-s * 0.02, -0.06, 0.005)), (0.12, 0.012, 0.008), CHROME, rz=s * 0.25)  # lever
    box(bm, g - V((s * 0.09, 0, -0.005)), (0.04, 0.035, 0.035), TRIM)  # switch gear
    # mirrors
    m0 = g - V((s * 0.1, 0.0, -0.01))
    m1 = V((s * 0.31, -0.45, 1.22))
    tube(bm, m0, m1, 0.006, CHROME, segs=6)
    ellip(bm, m1 + V((0, -0.005, 0.02)), (0.05, 0.012, 0.035), TRIM, 12, 6)
# instruments + headlight
tube(bm, (0, -0.5, 1.05), (0, -0.53, 1.09), 0.05, TRIM, segs=14)
ellip(bm, (0, -0.62, 0.9), (0.095, 0.075, 0.095), CHROME, 18, 10)
M, L = aligned((0, -0.69, 0.9), (0, -0.705, 0.9))
res = bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.082, radius2=0.08, depth=L, matrix=M, calc_uvs=True)
_mark(bm, res["verts"], HEADL)
for s in (1, -1):
    tube(bm, (s * 0.085, -0.56, 0.88), (s * 0.05, -0.6, 0.9), 0.01, TRIM, segs=6)  # headlight ears
    box(bm, (s * 0.12, -0.62, 0.95), (0.04, 0.025, 0.025), HEADL)  # front indicators
# front fender: a smooth curved shell over the tyre (outer + inner skin with closed edges)
uvl = bm.loops.layers.uv.verify()
rows = []
NF = 16
for i in range(NF + 1):
    am = math.radians(-30 + 95 * i / NF)
    row = []
    for r, x in ((WHEEL_R + 0.05, 0.05), (WHEEL_R + 0.05, -0.05), (WHEEL_R + 0.042, -0.046), (WHEEL_R + 0.042, 0.046)):
        row.append(bm.verts.new(HUB_F + V((x, -math.sin(am) * r, math.cos(am) * r))))
    rows.append(row)
for ra, rb in zip(rows, rows[1:]):
    for k in range(4):
        f = bm.faces.new((ra[k], ra[(k + 1) % 4], rb[(k + 1) % 4], rb[k]))
        f.material_index = PAINT
for row, flip in ((rows[0], True), (rows[-1], False)):
    f = bm.faces.new(list(reversed(row)) if flip else row)
    f.material_index = PAINT
for s in (1, -1):
    tube(bm, HUB_F + V((s * 0.085, 0, 0.12)), HUB_F + V((s * 0.05, -0.02, WHEEL_R + 0.045)), 0.008, TRIM, segs=6)  # fender stays
fork = make_obj("fork", bm, FORK_W, body)


# ------------------------------------------------------------------ wheels
def wheel(name, hub, tire_w, parent, front):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    R = WHEEL_R
    tw = tire_w / 2
    prof = [(-tw, R * 0.7), (-tw * 0.98, R * 0.86), (-tw * 0.8, R * 0.97), (-tw * 0.4, R), (tw * 0.4, R),
            (tw * 0.8, R * 0.97), (tw * 0.98, R * 0.86), (tw, R * 0.7)]
    n = 22
    rings = [[bm.verts.new(hub + V((x, r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)))) for i in range(n)] for x, r in prof]
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = TIRE
            for loop, uv in zip(f.loops, ((i / n * 6, k / 7), ((i + 1) / n * 6, k / 7), ((i + 1) / n * 6, (k + 1) / 7), (i / n * 6, (k + 1) / 7))):
                loop[uvl].uv = uv
    # cast rim: barrel, lip, five split spokes, hub
    disc_x(bm, hub, R * 0.7, tire_w * 0.85, RIM, 22)
    for k in range(5):
        a = 2 * math.pi * k / 5
        for da in (-0.09, 0.09):
            d = V((0, math.cos(a + da), math.sin(a + da)))
            tube(bm, hub + d * 0.05, hub + d * R * 0.66, 0.009, RIM, segs=6)
    disc_x(bm, hub, 0.055, tire_w * 0.9, CHROME, 14)
    if front:
        disc_x(bm, hub + V((0.06, 0, 0)), 0.15, 0.006, BRAKE, 24)
    else:
        disc_x(bm, hub + V((-0.065, 0, 0)), 0.11, 0.006, BRAKE, 20)
        disc_x(bm, hub + V((0.07, 0, 0)), 0.12, 0.008, TRIM, 20)  # sprocket
    return make_obj(name, bm, Matrix.Translation(hub), parent)


wheel_f = wheel("wheel_F", HUB_F, 0.12, fork, True)
wheel_r = wheel("wheel_R", HUB_R, 0.16, body, False)

# ------------------------------------------------------------------ markers
empty("seat_driver", (0, 0.12, 0.82), body)
empty("door_driver", (0.75, 0.1, 0), body)
empty("cam_target", (0, 0, 1.0), body)
empty("peg_L", PEG, body)
empty("peg_R", PEG * V((-1, 1, 1)), body)
empty("grip_L", GRIP, fork)
empty("grip_R", GRIP * V((-1, 1, 1)), fork)

root = bpy.data.objects.new("bike", None)
scene.collection.objects.link(root)
place(body, Matrix(), root)

path = os.path.join(ROOT, "assets", "models", "car_bike.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_image_format="JPEG", export_extras=True)
print("EXPORTED", path, sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH"), "faces", "rake", round(math.degrees(RAKE), 2))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "car_bike.blend"))

if PREVIEW:
    out = ARGS[ARGS.index("--preview") + 1]
    os.makedirs(out, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 800, 520
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    # steer the fork a little in one shot to check the pivot
    for tag, loc, steer in (("34", (2.2, -2.8, 1.4), 0.0), ("side", (3.6, 0, 0.7), 0.0), ("rear", (-1.8, 2.6, 1.3), 0.0),
                            ("steer", (1.6, -2.4, 1.8), 0.4)):
        fork.rotation_mode = "XYZ"
        base = (fork.parent.matrix_world.inverted() @ FORK_W)
        fork.matrix_basis = base @ Matrix.Rotation(steer, 4, "Z")
        bpy.context.view_layer.update()
        cam.location = loc
        cam.rotation_euler = (V((0, 0, 0.6)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, f"bike_{tag}.png")
        bpy.ops.render.render(write_still=True)
