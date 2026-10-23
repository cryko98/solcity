"""
A Microsoft Rocketbox avatar (MIT, github.com/microsoft/Microsoft-Rocketbox) as a game-ready GLB:
the avatar's FBX, its motion-captured clips from the library put on its own skeleton (same Bip01
bones, so no retargeting), textures cut down to 1K, specular maps folded into a roughness.

  blender -b --factory-startup -P blender/build_rocketbox.py -- <root> <Avatar> <out.glb> clip=name ...

<root>/vendor/rocketbox/<Avatar>/<Avatar>.fbx and Textures/, the clips in vendor/rocketbox/anims/
(the "motextr_xy" ones for locomotion: walked on the spot, the game moves the character).
"""
import bpy, os, sys

args = sys.argv[sys.argv.index("--") + 1:]
ROOT, AVATAR, OUT = os.path.abspath(args[0]), args[1], os.path.abspath(args[2])
CLIPS = dict(a.split("=") for a in args[3:])  # game name -> library clip
RB = os.path.join(ROOT, "vendor", "rocketbox")
TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(RB, AVATAR, AVATAR + ".fbx"), automatic_bone_orientation=False)
rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
for o in list(bpy.context.scene.objects):
    if o.type == "EMPTY":  # (the Biped's footsteps helper)
        bpy.data.objects.remove(o)
rig.name = "Rocketbox"
body.name = "Body"

# materials: base colour + normal map, a roughness from the specular map (shiny = smooth), 1K
texdir = os.path.join(RB, AVATAR, "Textures")
def load(name):
    p = os.path.join(texdir, name)
    if not os.path.exists(p):
        return None
    im = bpy.data.images.load(p)
    if im.size[0] > TEX:
        im.scale(TEX, TEX)
    return im
for mat in body.data.materials:
    part = mat.name.split("_")[-1]  # body / head
    prefix = mat.name.rsplit("_", 1)[0]
    col, nor, spec = (load(f"{prefix}_{part}_{k}.tga") for k in ("color", "normal", "specular"))
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    if col:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = col
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if nor:
        nor.colorspace_settings.name = "Non-Color"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = nor
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    if spec:
        # roughness = 1 - specular: baked into the image itself (glTF needs a plain texture)
        px = list(spec.pixels)
        for i in range(0, len(px), 4):
            r = 1.0 - (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) * 0.8
            px[i] = px[i + 1] = px[i + 2] = max(0.6, min(0.95, r))  # (cloth and skin: never glossy)
        spec.pixels = px
        spec.colorspace_settings.name = "Non-Color"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = spec
        nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.4

# the clips. The library's animation files carry their own Bip01 skeleton, with the same bone
# lengths but a different rest pose (a T-pose, the avatars stand in an A-pose), so an action can't
# just be moved over: every bone of ours copies its bone's orientation in the world (the pelvis its
# position too), and the result is baked into a clip of our own.
for o in bpy.data.actions:
    bpy.data.actions.remove(o)
rig.animation_data_create()
keep = set()
for game_name, clip in CLIPS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(RB, "anims", clip + ".fbx"), automatic_bone_orientation=False)
    new = set(bpy.data.objects) - before
    src = next(o for o in new if o.type == "ARMATURE")
    f0, f1 = (int(round(x)) for x in src.animation_data.action.frame_range)
    for pb in rig.pose.bones:
        if pb.name not in src.pose.bones:
            continue
        c = pb.constraints.new("COPY_ROTATION")
        c.target, c.subtarget = src, pb.name
        if pb.parent is None:
            c = pb.constraints.new("COPY_LOCATION")
            c.target, c.subtarget = src, pb.name
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    rig.animation_data.action = None
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False, visual_keying=True, clear_constraints=True, use_current_action=False, bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    act = rig.animation_data.action
    act.name = game_name
    act.use_fake_user = True
    keep.add(act)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    for o in new:
        bpy.data.objects.remove(o)
    tr = rig.animation_data.nla_tracks.new()
    tr.name = game_name
    tr.strips.new(game_name, f0, act)
    tr.mute = True
    print("CLIP", game_name, clip, (f0, f1))
for a in list(bpy.data.actions):
    if a not in keep:
        bpy.data.actions.remove(a)

bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS",
    export_image_format="JPEG", export_jpeg_quality=88, export_skins=True, export_yup=True,
)
print("EXPORTED", OUT, os.path.getsize(OUT))
