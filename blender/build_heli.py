"""
Builds a police helicopter (light single-engine utility type, AS350 / Bell 407
proportions) in Blender and exports assets/models/heli_police.glb.

  blender -b --factory-startup -P blender/build_heli.py -- <project_root> [--preview <dir>]

Axes as the cars: the nose faces -Y (exports as +Z in three.js), left side = +X, Z up,
origin on the ground under the main rotor mast.

Hierarchy (the game depends on it):
  heli (root empty)
    Body              fuselage, tail boom, fins, skids, windows, POLICE lettering
      rotor_main      origin on the mast, spins about local Z (three.js local Y)
      rotor_tail      origin on the tail rotor hub, spins about local X
      spot            searchlight lens (empty), under the nose
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
PREVIEW = "--preview" in ARGS
V = Vector

MAST = V((0, 0.15, 2.62))
TAIL_HUB = V((-0.28, 6.25, 1.95))
SPOT = V((0, -1.75, 0.62))
ROTOR_R = 5.3


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return [srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def material(name, hexcol, rough=0.5, metal=0.0, coat=0.0, emit=None, emit_str=1.0, alpha=1.0):
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
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    m.diffuse_color = (*rgb, 1)
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

PAINT_M = material("Paint", "141a2a", 0.3, 0.45, coat=1.0)
WHITE_M = material("White", "eceff2", 0.3, 0.1, coat=0.8)
TRIM_M = material("Trim", "1a1b1e", 0.6)
GLASS_M = material("Glass", "1c2733", 0.05, 0.3, alpha=0.75)
METAL_M = material("Metal", "8a8d92", 0.35, 0.9)
BLADE_M = material("Blade", "121314", 0.5, 0.2)
HEAD_M = material("Headlight", "f4f6f8", 0.05, 0.2, emit="fff6e0", emit_str=0.0)
RED_M = material("SirenRed", "6a0b0b", 0.2, emit="ff1a1a", emit_str=0.0)
BLUE_M = material("SirenBlue", "0b1a6a", 0.2, emit="2a5bff", emit_str=0.0)
MATS = [PAINT_M, WHITE_M, TRIM_M, GLASS_M, METAL_M, BLADE_M, HEAD_M, RED_M, BLUE_M]
PAINT, WHITE, TRIM, GLASS, METAL, BLADE, HEADL, RED, BLUE = range(len(MATS))


def _mark(bm, verts, mi):
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mi


def aligned(a, b):
    a, b = V(a), V(b)
    d = b - a
    q = V((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), d.length


def tube(bm, a, b, r, mi, segs=10, r2=None):
    M, L = aligned(a, b)
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=L, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def ellip(bm, c, radii, mi, segs=20, rings=12, rx=0.0):
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*radii, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def box(bm, c, size, mi, rx=0.0, ry=0.0, rz=0.0):
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((*size, 1))
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=M, calc_uvs=True)
    _mark(bm, res["verts"], mi)


def loft_y(bm, stations, mi, segs=24, exp=2.4):
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
    for ra, rb in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((ra[i], ra[j], rb[j], rb[i])).material_index = mi
    bm.faces.new(list(reversed(rings[0]))).material_index = mi
    bm.faces.new(rings[-1]).material_index = mi


def make_obj(name, bm, world, parent=None, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(world.inverted())
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
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
    e.empty_display_size = 0.1
    scene.collection.objects.link(e)
    place(e, Matrix.Translation(V(pos)), parent)
    return e


# ------------------------------------------------------------------ fuselage
bm = bmesh.new()
bm.loops.layers.uv.verify()
# pod: rounded nose, deep cabin, tapering into the boom (y, cx, cz, half width, half height)
loft_y(bm, [
    (-2.35, 0, 1.18, 0.12, 0.16),
    (-2.25, 0, 1.2, 0.42, 0.48),
    (-2.0, 0, 1.25, 0.66, 0.68),
    (-1.5, 0, 1.33, 0.8, 0.8),
    (-0.6, 0, 1.4, 0.86, 0.86),
    (0.5, 0, 1.45, 0.86, 0.86),
    (1.3, 0, 1.55, 0.72, 0.72),
    (1.95, 0, 1.75, 0.38, 0.4),
    (2.3, 0, 1.85, 0.2, 0.22),
], PAINT)
# white belly band (slightly proud of the skin)
loft_y(bm, [
    (-1.9, 0, 0.95, 0.69, 0.3),
    (-0.6, 0, 0.92, 0.875, 0.33),
    (0.5, 0, 0.95, 0.875, 0.33),
    (1.25, 0, 1.08, 0.7, 0.27),
], WHITE)
# tail boom + tail
tube(bm, (0, 2.2, 1.85), (0, 6.0, 1.98), 0.2, PAINT, segs=14, r2=0.1)
box(bm, (0, 6.15, 2.45), (0.06, 0.62, 1.05), PAINT, rx=-0.32)          # vertical fin
box(bm, (0, 6.0, 1.68), (0.05, 0.4, 0.5), PAINT, rx=0.35)              # lower fin
box(bm, (0, 5.2, 1.98), (1.7, 0.36, 0.05), PAINT)                       # horizontal stabiliser
for sx in (0.86, -0.86):
    box(bm, (sx, 5.22, 2.08), (0.04, 0.32, 0.22), WHITE)                # endplates
# engine cowling and rotor mast
loft_y(bm, [(-0.4, 0, 2.18, 0.05, 0.05), (-0.25, 0, 2.2, 0.45, 0.22), (0.9, 0, 2.18, 0.45, 0.24), (1.6, 0, 2.05, 0.2, 0.12)], PAINT)
tube(bm, (0, 0.15, 2.3), MAST, 0.07, METAL)
# exhaust
tube(bm, (0.22, 1.55, 2.1), (0.3, 2.0, 2.2), 0.09, TRIM)
# windows: wrap-around windscreen and side door glass
ellip(bm, (0, -1.55, 1.55), (0.84, 0.86, 0.62), GLASS, rx=0.25)
for sx in (0.83, -0.83):
    box(bm, (sx, -0.35, 1.62), (0.07, 1.25, 0.6), GLASS)
    box(bm, (sx * 0.98, 0.75, 1.62), (0.06, 0.65, 0.48), GLASS)
# skids
for sx in (1.0, -1.0):
    tube(bm, (sx, -1.7, 0.06), (sx, 1.6, 0.06), 0.045, METAL)
    tube(bm, (sx, -1.7, 0.06), (sx, -1.95, 0.22), 0.045, METAL)
    for y in (-0.9, 0.8):
        tube(bm, (sx, y, 0.06), (sx * 0.62, y, 0.75), 0.05, METAL)
# searchlight + strobes
tube(bm, SPOT + V((0, 0.12, 0.2)), SPOT, 0.11, TRIM, segs=12)
tube(bm, SPOT + V((0, 0, 0.02)), SPOT - V((0, 0.02, 0.02)), 0.1, HEADL, segs=12)
ellip(bm, (0, 6.32, 2.98), (0.06, 0.06, 0.06), RED, segs=8, rings=6)
ellip(bm, (0, 0.6, 0.6), (0.08, 0.12, 0.05), BLUE, segs=8, rings=6)
ellip(bm, (0, -0.4, 2.3), (0.08, 0.08, 0.05), RED, segs=8, rings=6)
body = make_obj("Body", bm, Matrix())

# POLICE lettering on both sides of the boom root / cabin
for side in (1, -1):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = "POLICE"
    cu.size = 0.42
    cu.extrude = 0.004
    cu.align_x = "CENTER"
    t = bpy.data.objects.new("txt", cu)
    scene.collection.objects.link(t)
    # text lies in its local XY plane: stand it up on the side, reading front to back
    t.matrix_world = Matrix.Translation((side * 0.885, 0.35, 0.86)) @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Rotation(side * math.pi / 2, 4, "Y")
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
    me.transform(t.matrix_world)
    me.materials.clear()
    for m in MATS:
        me.materials.append(m)
    for p in me.polygons:
        p.material_index = PAINT
    ob = bpy.data.objects.new("Lettering" + ("L" if side > 0 else "R"), me)
    scene.collection.objects.link(ob)
    place(ob, Matrix(), body)
    bpy.data.objects.remove(t)

# ------------------------------------------------------------------ rotors
bm = bmesh.new()
bm.loops.layers.uv.verify()
tube(bm, MAST - V((0, 0, 0.08)), MAST + V((0, 0, 0.12)), 0.17, METAL, segs=14)
for k in range(3):
    a = k * 2 * math.pi / 3
    d = V((math.cos(a), math.sin(a), 0))
    mid = MAST + d * (ROTOR_R / 2 + 0.15) + V((0, 0, 0.04))
    box(bm, mid, (ROTOR_R, 0.28, 0.035), BLADE, rz=a)
rotor = make_obj("rotor_main", bm, Matrix.Translation(MAST), body, smooth=False)

bm = bmesh.new()
bm.loops.layers.uv.verify()
tube(bm, TAIL_HUB + V((0.05, 0, 0)), TAIL_HUB - V((0.08, 0, 0)), 0.06, METAL)
for k in range(2):
    a = k * math.pi
    d = V((0, math.cos(a), math.sin(a)))
    box(bm, TAIL_HUB + d * 0.42, (0.025, 0.85, 0.12), BLADE, rx=-a)
tail = make_obj("rotor_tail", bm, Matrix.Translation(TAIL_HUB), body, smooth=False)

empty("spot", SPOT, body)
root = bpy.data.objects.new("heli", None)
scene.collection.objects.link(root)
place(body, Matrix(), root)

path = os.path.join(ROOT, "assets", "models", "heli_police.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_image_format="JPEG", export_extras=True)
print("EXPORTED", path, sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH"), "faces")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "heli_police.blend"))

if PREVIEW:
    out = ARGS[ARGS.index("--preview") + 1]
    os.makedirs(out, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 900, 560
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 40
    for tag, loc in (("34", (7.5, -8.5, 4.5)), ("side", (12, 1.5, 1.8)), ("rear", (-6, 11, 4)), ("front", (0.5, -9, 1.6))):
        cam.location = loc
        cam.rotation_euler = (V((0, 1.5, 1.4)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, f"heli_{tag}.png")
        bpy.ops.render.render(write_still=True)
