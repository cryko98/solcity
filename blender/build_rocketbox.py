"""
A Microsoft Rocketbox avatar (MIT, github.com/microsoft/Microsoft-Rocketbox) as a game-ready GLB:
the avatar's FBX, its motion-captured clips from the library put on its own skeleton (same Bip01
bones, so no retargeting), textures cut down to 1K, specular maps folded into a roughness.

  blender -b --factory-startup -P blender/build_rocketbox.py -- <root> <Avatar> <out.glb> clip=name ...

<root>/vendor/rocketbox/<Avatar>/<Avatar>.fbx and Textures/, the clips in vendor/rocketbox/anims/
(the "motextr_xy" ones for locomotion: walked on the spot, the game moves the character).
Clips from other rigs: name=ual1:<clip> / ual2:<clip> (Quaternius) and name=cmu:<take>@<from>-<to> (CMU
motion capture, BVH): see below. blender/build_rb_hero.sh has the hero's full list.
"""
import bpy, math, os, sys

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
    im.pixels[0]  # (loaded lazily: its size reads 0 until then)
    if im.size[0] > TEX:
        im.scale(TEX, TEX)
    # (the exporter reads the file on disk unless told otherwise: write the small one out)
    im.filepath_raw = os.path.join(bpy.app.tempdir, os.path.splitext(name)[0] + ".png")
    im.file_format = "PNG"
    im.save()
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
        # (cloth: matte, a cotton shirt and denim; skin: a soft sheen at most)
        lo, hi = (0.58, 0.8) if part == "head" else (0.86, 1.0)
        px = list(spec.pixels)
        for i in range(0, len(px), 4):
            r = 1.0 - (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) * 0.8
            px[i] = px[i + 1] = px[i + 2] = max(lo, min(hi, r))
        spec.pixels = px
        spec.save()
        spec.colorspace_settings.name = "Non-Color"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = spec
        nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.4 if part == "head" else 0.15

# the clips. The library's animation files carry their own Bip01 skeleton, with the same bone
# lengths but a different rest pose (a T-pose, the avatars stand in an A-pose), so an action can't
# just be moved over: every bone of ours copies its bone's orientation in the world (the pelvis its
# position too), and the result is baked into a clip of our own.
for o in bpy.data.actions:
    bpy.data.actions.remove(o)
rig.animation_data_create()
keep = set()
for game_name, clip in ((g, c) for g, c in CLIPS.items() if ":" not in c):
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
# ------------------------------------------------------------------ clips from other rigs
# Quaternius's Universal Animation Libraries (CC0) fill in what the Rocketbox library hasn't (boxing,
# hits, falls and getting up, jumps, the roll, swimming, driving, sitting, the pistol). Their rigs are
# different (Rigify bones in UAL1, Unreal names in UAL2), so: both rigs stand in their idle pose
# (calibration: the turn from each source bone to its Rocketbox bone, in the world), then frame by
# frame every Rocketbox bone takes its source bone's world orientation turned by that, solved down
# the hierarchy into local rotations and keyed. The pelvis follows only up and down (the game moves
# the character about).
QDIR = os.path.join(ROOT, "vendor", "quaternius")
SOURCES = {
    "ual1": (os.path.join(QDIR, "ual1", "Animation Library[Standard]", "Godot", "AnimationLibrary_Godot_Standard.glb"), "Idle_Loop"),
    "ual2": (os.path.join(QDIR, "ual2", "Universal Animation Library 2 [Standard]", "Unreal-Godot", "UAL2_Standard.glb"), "Idle_No_Loop"),
}
def _map_ual1():
    m = {"Bip01 Pelvis": "DEF-hips", "Bip01 Spine": "DEF-spine.001", "Bip01 Spine1": "DEF-spine.002", "Bip01 Spine2": "DEF-spine.003",
         "Bip01 Neck": "DEF-neck", "Bip01 Head": "DEF-head"}
    for S, s in (("L", "L"), ("R", "R")):
        m.update({f"Bip01 {S} Clavicle": f"DEF-shoulder.{s}", f"Bip01 {S} UpperArm": f"DEF-upper_arm.{s}", f"Bip01 {S} Forearm": f"DEF-forearm.{s}",
                  f"Bip01 {S} Hand": f"DEF-hand.{s}", f"Bip01 {S} Thigh": f"DEF-thigh.{s}", f"Bip01 {S} Calf": f"DEF-shin.{s}",
                  f"Bip01 {S} Foot": f"DEF-foot.{s}", f"Bip01 {S} Toe0": f"DEF-toe.{s}"})
        for i, f in enumerate(("index", "middle", "ring", "pinky")):
            for j in range(3):
                m[f"Bip01 {S} Finger{i + 1}{j if j else ''}"] = f"DEF-f_{f}.0{j + 1}.{s}"
        for j in range(3):
            m[f"Bip01 {S} Finger0{j if j else ''}"] = f"DEF-thumb.0{j + 1}.{s}"
    return m
def _map_ual2():
    m = {"Bip01 Pelvis": "pelvis", "Bip01 Spine": "spine_01", "Bip01 Spine1": "spine_02", "Bip01 Spine2": "spine_03",
         "Bip01 Neck": "neck_01", "Bip01 Head": "Head"}
    for S, s in (("L", "l"), ("R", "r")):
        m.update({f"Bip01 {S} Clavicle": f"clavicle_{s}", f"Bip01 {S} UpperArm": f"upperarm_{s}", f"Bip01 {S} Forearm": f"lowerarm_{s}",
                  f"Bip01 {S} Hand": f"hand_{s}", f"Bip01 {S} Thigh": f"thigh_{s}", f"Bip01 {S} Calf": f"calf_{s}",
                  f"Bip01 {S} Foot": f"foot_{s}", f"Bip01 {S} Toe0": f"ball_{s}"})
        for i, f in enumerate(("index", "middle", "ring", "pinky")):
            for j in range(3):
                m[f"Bip01 {S} Finger{i + 1}{j if j else ''}"] = f"{f}_0{j + 1}_{s}"
        for j in range(3):
            m[f"Bip01 {S} Finger0{j if j else ''}"] = f"thumb_0{j + 1}_{s}"
    return m
MAPS = {"ual1": _map_ual1(), "ual2": _map_ual2()}

from mathutils import Quaternion as Q, Vector as Vec

def world_pose(arm):
    W = arm.matrix_world
    return {pb.name: ((W @ pb.matrix).to_quaternion().normalized(), W @ pb.head) for pb in arm.pose.bones}

ordered = sorted(rig.pose.bones, key=lambda pb: len(pb.parent_recursive))
for pb in ordered:
    pb.rotation_mode = "QUATERNION"
rest_rel = {pb.name: ((pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local) if pb.parent else pb.bone.matrix_local).to_quaternion() for pb in ordered}
rig_q = rig.matrix_world.to_quaternion()
idle_act = next(a for a in keep if a.name == "idle")

PEL = "Bip01 Pelvis"

def facing(P, left, right):
    v = P[left][1] - P[right][1]  # (towards the body's left)
    return math.atan2(v.y, v.x)

def retarget(game_name, src, bmap, C, pel0, hip_k, frames, G=Q()):
    """Key `game_name` on the Rocketbox rig from `src` at the given source frames (one per frame).
    G: a turn about the vertical applied to the source first (so it faces the way the rig does)."""
    act = bpy.data.actions.new(game_name)
    rig.animation_data.action = act
    prev = {}
    for fi, f in enumerate(frames):
        bpy.context.scene.frame_set(int(f), subframe=f - int(f))
        S = world_pose(src)
        A = {}
        for pb in ordered:
            n = pb.name
            Ap = A[pb.parent.name] if pb.parent else Q()
            if n in bmap:
                A[n] = rig_q.inverted() @ (G @ S[bmap[n]][0] @ C[n])
                basis = rest_rel[n].inverted() @ Ap.inverted() @ A[n]
            else:
                basis = Q()
                A[n] = Ap @ rest_rel[n]
            if n in prev and prev[n].dot(basis) < 0:
                basis.negate()  # (the short way round, so the keys don't flip)
            prev[n] = basis.copy()
            pb.rotation_quaternion = basis
            pb.keyframe_insert("rotation_quaternion", frame=fi + 1)
        # the pelvis: up and down only, scaled to this body
        pel = rig.pose.bones[PEL]
        dz = (S[bmap[PEL]][1].z - pel0) * hip_k
        want = rig.matrix_world.inverted() @ (R0[PEL][1] + Vec((0, 0, dz)))
        ML = pel.bone.matrix_local
        pel.location = ML.to_quaternion().inverted() @ (want - ML.translation)
        pel.keyframe_insert("location", frame=fi + 1)
    act.use_fake_user = True
    keep.add(act)
    rig.animation_data.action = None
    tr = rig.animation_data.nla_tracks.new()
    tr.name = game_name
    tr.strips.new(game_name, 1, act)
    tr.mute = True
    print("CLIP", game_name, src.name, (frames[0], frames[-1]))

# the Rocketbox rig standing at ease
rig.animation_data.action = idle_act
bpy.context.scene.frame_set(int(idle_act.frame_range[0]))
R0 = world_pose(rig)
rig.animation_data.action = None
rig_face = facing(R0, "Bip01 L Thigh", "Bip01 R Thigh")

for key in sorted({v.split(":")[0] for v in CLIPS.values() if ":" in v} - {"cmu"}):
    path, idle_name = SOURCES[key]
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = set(bpy.data.objects) - before
    src = next(o for o in new if o.type == "ARMATURE")
    src_acts = {a.name.split("|")[0] if "|" in a.name else a.name: a for a in set(bpy.data.actions) - acts_before}
    def act_of(name):
        return next(a for n, a in src_acts.items() if n == name or n.startswith(name))
    bmap = {rb: s for rb, s in MAPS[key].items() if rb in rig.pose.bones and s in src.pose.bones}
    # calibration, both standing at ease
    src.animation_data_create()
    sa = act_of(idle_name)
    src.animation_data.action = sa
    bpy.context.scene.frame_set(int(sa.frame_range[0]))
    S0 = world_pose(src)
    C = {rb: S0[s][0].inverted() @ R0[rb][0] for rb, s in bmap.items()}
    hip_k = R0[PEL][1].z / max(0.01, S0[bmap[PEL]][1].z)
    for game_name, spec in CLIPS.items():
        if not spec.startswith(key + ":"):
            continue
        sa = act_of(spec.split(":", 1)[1])
        src.animation_data.action = sa
        f0, f1 = (int(round(x)) for x in sa.frame_range)
        retarget(game_name, src, bmap, C, S0[bmap[PEL]][1].z, hip_k, list(range(f0, f1 + 1)))
    for o in new:
        bpy.data.objects.remove(o)

# CMU motion capture (mocap.cs.cmu.edu: free for any use), as BVH: cmu:<take>@<from>-<to> (frames at 120/s).
# Every take's skeleton rests in the same T-pose (frame 1), so one calibration, from a subject
# standing at ease, holds for all of them; each take is turned to face the way the rig does.
CDIR = os.path.join(ROOT, "vendor", "cmu")
CMU_CAL = ("90_18", 40)
def _map_cmu():
    m = {PEL: "Hips", "Bip01 Spine": "LowerBack", "Bip01 Spine1": "Spine", "Bip01 Spine2": "Spine1", "Bip01 Neck": "Neck", "Bip01 Head": "Head"}
    for S, s in (("L", "Left"), ("R", "Right")):
        m.update({f"Bip01 {S} Clavicle": f"{s}Shoulder", f"Bip01 {S} UpperArm": f"{s}Arm", f"Bip01 {S} Forearm": f"{s}ForeArm",
                  f"Bip01 {S} Hand": f"{s}Hand", f"Bip01 {S} Thigh": f"{s}UpLeg", f"Bip01 {S} Calf": f"{s}Leg",
                  f"Bip01 {S} Foot": f"{s}Foot", f"Bip01 {S} Toe0": f"{s}ToeBase"})
    return m

def load_bvh(take):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=os.path.join(CDIR, take + ".bvh"), axis_forward="-Z", axis_up="Y",
                            update_scene_fps=False, use_fps_scale=False, rotate_mode="NATIVE")
    return next(o for o in set(bpy.data.objects) - before if o.type == "ARMATURE")

cmu_specs = {g: s.split(":", 1)[1] for g, s in CLIPS.items() if s.startswith("cmu:")}
if cmu_specs:
    cal = load_bvh(CMU_CAL[0])
    bmap = {rb: s for rb, s in _map_cmu().items() if rb in rig.pose.bones and s in cal.pose.bones}
    LT, RT = bmap["Bip01 L Thigh"], bmap["Bip01 R Thigh"]
    bpy.context.scene.frame_set(1)
    cal_t = world_pose(cal)[bmap[PEL]][1].z  # (its hips in the T-pose: the subject's size)
    bpy.context.scene.frame_set(CMU_CAL[1])
    S0 = world_pose(cal)
    G0 = Q((0, 0, 1), rig_face - facing(S0, LT, RT))
    C = {rb: (G0 @ S0[s][0]).inverted() @ R0[rb][0] for rb, s in bmap.items()}
    stand = S0[bmap[PEL]][1].z
    step = 120 / bpy.context.scene.render.fps
    turns = {}
    # (^like:<clip> takes that clip's turn, so it goes after it)
    for game_name, spec in sorted(cmu_specs.items(), key=lambda kv: "^like:" in kv[1]):
        take, rng = spec.split("@")
        rng, _, mode = rng.partition("^")
        aim = mode == "aim"
        f0, f1 = (int(x) for x in rng.split("-"))
        src = load_bvh(take)
        bpy.context.scene.frame_set(1)
        k = world_pose(src)[bmap[PEL]][1].z / cal_t  # (a taller subject stands higher)
        bpy.context.scene.frame_set(f0)
        G = Q((0, 0, 1), rig_face - facing(world_pose(src), LT, RT))
        if aim:
            # a boxer stands bladed, hips turned from his man: turned so that the punch lands straight
            # ahead (the fist that reaches furthest from the chest)
            best = Vec()
            for f in range(f0, f1 + 1, 4):
                bpy.context.scene.frame_set(f)
                P = world_pose(src)
                for hand in ("LeftHand", "RightHand"):
                    v = P[hand][1] - P["Spine1"][1]
                    v.z = 0
                    if v.length > best.length:
                        best = v
            G = Q((0, 0, 1), rig_face - (math.atan2(best.y, best.x) + math.pi / 2))
        elif mode.startswith("like:"):
            G = turns[mode[5:]]
        turns[game_name] = G
        frames = [f0 + i * step for i in range(int((f1 - f0) / step) + 1)]
        retarget(game_name, src, bmap, C, stand * k, R0[PEL][1].z / (stand * k), frames, G)
        bpy.data.objects.remove(src)
    bpy.data.objects.remove(cal)
for pb in rig.pose.bones:
    pb.matrix_basis.identity()

for a in list(bpy.data.actions):
    if a not in keep:
        bpy.data.actions.remove(a)

bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS",
    export_image_format="JPEG", export_jpeg_quality=88, export_skins=True, export_yup=True,
)
print("EXPORTED", OUT, os.path.getsize(OUT))
