"""
Builds the game's people from Blender Studio's "Human Base Meshes" (CC0,
https://www.blender.org/download/demo/ -> vendor/human_base_meshes) and exports GLBs.

  hero    -> assets/models/protagonist.glb  (with all animations)
  male    -> assets/models/npc_male.glb     (no animations; plays the hero's clips)
  female  -> assets/models/npc_female.glb

Pipeline: append the realistic male/female body + eyes, bake the sculpt
(multires), fit a game skeleton to the anatomy (incl. finger and thumb bones
for fists), skin it with bone-heat weights, re-pose the A-pose arms down to
the game's rest pose, then dress it: painted clothing regions plus offset
shells for the leather jacket, shoes, hair, brows and beard.

  blender -b --factory-startup --disable-autoexec -P blender/build_character.py -- <root> --variant hero [--preview <dir>]
"""
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from mathutils import noise as mnoise

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
VARIANT = ARGS[ARGS.index("--variant") + 1] if "--variant" in ARGS else "hero"
PREVIEW = "--preview" in ARGS
HERO, FEMALE, POLICE = VARIANT == "hero", VARIANT == "female", VARIANT == "police"
MALE = VARIANT in ("male", "police")  # the police officer is the male NPC in uniform
SRC = os.path.join(ROOT, "vendor", "human_base_meshes", "extracted", "human-base-meshes-bundle-v1.4.1", "human_base_meshes_bundle.blend")
FPS = 30
V = Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ================================================================ textures
RNG = np.random.default_rng(7)


def vnoise(n, cells):
    g = RNG.random((cells, cells))
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int)
    f = x - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a, b, c, d = g[i0][:, i0], g[i0][:, i1], g[i1][:, i0], g[i1][:, i1]
    fy, fx = f[:, None], f[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(n, base, octaves=4):
    out, amp, tot = np.zeros((n, n)), 1.0, 0.0
    for o in range(octaves):
        out += vnoise(n, base * 2 ** o) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def image(name, rgb, noncolor=False):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    img.file_format = "PNG"
    img.pack()
    return img


def normal_map(name, height, strength):
    dx = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    dy = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return image(name, n * 0.5 + 0.5, noncolor=True)


def colorize(t, a, b):
    return hexrgb(a)[None, None, :] * (1 - t[..., None]) + hexrgb(b)[None, None, :] * t[..., None]


N = 512
X, Y = np.meshgrid(np.arange(N), np.arange(N))
twill = 0.5 + 0.5 * np.sin(2 * np.pi * (X + Y) / 5.0)
slub = vnoise(N, 64)
t = np.clip(0.35 * twill + 0.25 * slub + 0.55 * (fbm(N, 4) - 0.35), 0, 1)
# NPC textures are neutral grey so the game can tint every outfit
TEX_DENIM = image("denim", colorize(t, "1f3354", "5a7aa8") if HERO else colorize(t, "8a8a8a", "e6e6e6"))
NRM_DENIM = normal_map("denim_n", twill * 0.6 + slub * 0.4, 2.5)
knit = 0.5 + 0.5 * np.sin(2 * np.pi * X / 3.0)
t = np.clip(0.2 * knit + 0.5 * vnoise(N, 128) + 0.3 * fbm(N, 4), 0, 1)
TEX_COTTON = image("cotton", colorize(t, "d9d8d2", "f7f6f1"))
NRM_COTTON = normal_map("cotton_n", knit * 0.5 + vnoise(N, 128) * 0.5, 1.2)
blot = fbm(N, 6)
pores = vnoise(N, 220)
t = np.clip(0.55 * blot + 0.2 * pores + 0.1, 0, 1)
TEX_SKIN = image("skin", colorize(t, "9a6446", "c78d68") if HERO else colorize(t, "d8c2b4", "f6ece4"))
NRM_SKIN = normal_map("skin_n", pores * 0.5 + blot * 0.2, 1.1)
streak = np.repeat(RNG.random((1, N)), N, 0)
streak = np.clip(0.6 * streak + 0.4 * vnoise(N, 32), 0, 1)
TEX_HAIR = image("hair", colorize(streak, "0d0a08", "3a2a1e") if HERO else colorize(streak, "6a6a6a", "d0d0d0"))
NRM_HAIR = normal_map("hair_n", streak, 3.0)
t = np.clip(0.4 * fbm(N, 48, 2) + 0.4, 0, 1)
TEX_SNEAKER = image("sneaker", colorize(t, "dcdcd8", "fbfbf8"))
if HERO:
    grain = fbm(N, 96, 2)
    crease = np.abs(fbm(N, 6, 3) - 0.5)
    t = np.clip(0.3 * grain + 0.6 * (crease < 0.03) * 0.5 + 0.15 * fbm(N, 3), 0, 1)
    TEX_LEATHER = image("leather", colorize(t, "121315", "2e3035"))
    NRM_LEATHER = normal_map("leather_n", grain * 0.5 - (crease < 0.04) * 0.4, 3.0)


# ================================================================ materials
def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hexcol, rough=0.8, metal=0.0, tex=None, nrm=None, nstr=0.6, coat=0.0, vcol=False):
    rgb = [srgb_to_lin(c) for c in hexrgb(hexcol)]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if tex:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = tex
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    if vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    if nrm:
        nn = nt.nodes.new("ShaderNodeTexImage")
        nn.image = nrm
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstr
        nt.links.new(nn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    m.diffuse_color = (*rgb, 1)
    return m


MAT = {
    "skin": material("Skin", "c08560", 0.5, tex=TEX_SKIN, nrm=NRM_SKIN, nstr=0.3),
    "shirt": material("Shirt", "efefea", 0.92, tex=TEX_COTTON, nrm=NRM_COTTON, nstr=0.5),
    "jeans": material("Denim", "34507a", 0.9, tex=TEX_DENIM, nrm=NRM_DENIM, nstr=0.7),
    "hair": material("Hair", "1c1410", 0.5, tex=TEX_HAIR, nrm=NRM_HAIR, nstr=0.7),
    "shoe": material("Sneaker", "f4f4f4", 0.55, tex=TEX_SNEAKER),
}
if HERO:
    MAT.update({
        "jacket": material("Leather", "2b2f36", 0.62, tex=TEX_LEATHER, nrm=NRM_LEATHER, nstr=0.45),
        "sole": material("Sole", "3a3b3f", 0.9),
        "accent": material("Accent", "b3202a", 0.5),
        "eye": material("EyeWhite", "efece6", 0.15),
        "iris": material("Iris", "4a2c18", 0.1),
        "pupil": material("Pupil", "0a0a0a", 0.05),
        "lips": material("Lips", "8a5242", 0.4),
        "gold": material("Gold", "e2b04a", 0.22, 1.0),
        "glass": material("Shades", "0d0e11", 0.05, 0.5),
    })
else:
    # every small detail shares one vertex-coloured material (one draw call)
    detail = material("Detail", "ffffff", 0.5, vcol=True)
    for k in ("sole", "accent", "lips", "gold", "glass"):
        MAT[k] = detail
    MAT.update({
        "eye": material("EyeWhite", "efece6", 0.15),
        "iris": material("Iris", "3b2618", 0.1),
        "pupil": material("Pupil", "0a0a0a", 0.05),
    })
    if POLICE:
        MAT.update({
            "cap": material("Cap", "1a2234", 0.7),
            "visor": material("Visor", "0b0b0d", 0.22),
            "belt": material("Belt", "0f0f11", 0.45),
            "patch": detail,
        })
DETAIL_COLORS = {"sole": "3a3b3f", "accent": "b3202a", "eye": "efece6", "iris": "3b2618", "pupil": "0a0a0a",
                 "lips": "a0645a" if FEMALE else "8a5242", "gold": "e2b04a", "glass": "0d0e11", "patch": "c9a64e"}
MAT_LIST = []


def mat_index(key):
    m = MAT[key]
    if m not in MAT_LIST:
        MAT_LIST.append(m)
    return MAT_LIST.index(m)


# ================================================================ load the base mesh
src_name = "GEO-body_female_realistic" if FEMALE else "GEO-body_male_realistic"
wanted = [src_name, src_name + ".eye.L", src_name + ".eye.R"]
with bpy.data.libraries.load(SRC, link=False) as (data_from, data_to):
    data_to.objects = [n for n in data_from.objects if n in wanted]
objs = {ob.name: ob for ob in data_to.objects}
for ob in objs.values():
    scene.collection.objects.link(ob)
body = objs[src_name]
eyes = [objs[src_name + ".eye.L"], objs[src_name + ".eye.R"]]
bpy.context.view_layer.update()
WM = {ob: ob.matrix_world.copy() for ob in [body] + eyes}  # read before any re-parenting
for e in eyes:
    e.parent = None

# bake the sculpt detail: hero gets one multires level, NPCs the base cage
bpy.context.view_layer.objects.active = body
for m in list(body.modifiers):
    if m.type == "MULTIRES" and HERO:
        m.levels = 1
        bpy.ops.object.modifier_apply(modifier=m.name)
    else:
        body.modifiers.remove(m)

# centre on the origin, feet on the ground, game scale
SCALE = 1.05 if HERO else 1.0
dx = -body.location.x
for ob in [body] + eyes:
    ob.data.transform(Matrix.Diagonal((SCALE, SCALE, SCALE, 1)) @ Matrix.Translation((dx, 0, 0)) @ WM[ob])
    ob.location, ob.rotation_euler, ob.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
zmin = min(v.co.z for v in body.data.vertices)
for ob in [body] + eyes:
    ob.data.transform(Matrix.Translation((0, 0, -zmin)))

dec = body.modifiers.new("dec", "DECIMATE")
dec.ratio = 0.62 if HERO else 0.8
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in body.data.polygons:
    p.use_smooth = True

VS = np.array([v.co[:] for v in body.data.vertices])
H = VS[:, 2].max()
print("HEIGHT", round(H, 3), "VERTS", len(VS), "XR", VS[:, 0].min(), VS[:, 0].max(), "YR", VS[:, 1].min(), VS[:, 1].max(), "ZR", VS[:, 2].min())


# ================================================================ landmarks -> skeleton
def centroid(mask):
    sel = VS[mask]
    return V(sel.mean(axis=0)) if len(sel) else None


def slab(zc, half=.008, xmin=None, xmax=None):
    m = np.abs(VS[:, 2] - zc) < half
    if xmin is not None:
        m &= VS[:, 0] > xmin
    if xmax is not None:
        m &= VS[:, 0] < xmax
    return m


def arm_line(s):
    """centre line of the A-pose arm from shoulder to fingertip for side s (+1 = left)"""
    shoulder = V((s * .102 * H, 0, .815 * H))
    shoulder.y = centroid(slab(shoulder.z, .01, -.1, .1)).y
    side = VS[:, 0] * s
    tip_i = int(np.argmax(side))
    tip = V(VS[tip_i])
    axis = (tip - shoulder)
    L = axis.length
    axis.normalize()
    rel = VS - np.array(shoulder[:])
    proj = rel @ np.array(axis[:])
    perp = np.linalg.norm(rel - np.outer(proj, axis[:]), axis=1)

    def at(t, rad=.07):
        m = (np.abs(proj - t * L) < .012) & (perp < rad) & (side > .12)
        c = centroid(m)
        return c if c is not None else shoulder + axis * (t * L)
    return shoulder, tip, axis, L, at, proj, perp


BONES = {}
torso_c = lambda z: centroid(slab(z, .01, -.12, .12))
hip_z = .53 * H
BONES["hips"] = (V((0, torso_c(hip_z + .02 * H).y, hip_z)), V((0, torso_c(.6 * H).y, .6 * H)), None, False)
BONES["spine"] = (BONES["hips"][1], V((0, torso_c(.7 * H).y, .7 * H)), "hips", True)
neck_z = .835 * H
BONES["chest"] = (BONES["spine"][1], V((0, torso_c(neck_z - .03).y, neck_z)), "spine", True)
neck_top = .875 * H
BONES["neck"] = (BONES["chest"][1], V((0, centroid(slab(neck_top, .008, -.06, .06)).y, neck_top)), "chest", True)
BONES["head"] = (BONES["neck"][1], V((0, BONES["neck"][1].y, H)), "neck", True)
FINGER_NAMES = ("index", "middle", "ring", "pinky")
FW = {}  # vertex index -> hand/finger weights, applied after bone heat


_ev = np.zeros(len(body.data.edges) * 2, dtype=np.int64)
body.data.edges.foreach_get("vertices", _ev)
EDGES = _ev.reshape(-1, 2)


def connected_groups(idx):
    """split a vertex set into its connected pieces (edges of the body mesh)"""
    sel = set(int(i) for i in idx)
    adj = {i: [] for i in sel}
    m = np.isin(EDGES[:, 0], idx) & np.isin(EDGES[:, 1], idx)
    for a_, b_ in EDGES[m]:
        adj[int(a_)].append(int(b_))
        adj[int(b_)].append(int(a_))
    seen, out = set(), []
    for i in sel:
        if i in seen:
            continue
        stack, comp = [i], []
        seen.add(i)
        while stack:
            u = stack.pop()
            comp.append(u)
            for w in adj[u]:
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        out.append(np.array(comp))
    return out


def _sm(a, b, x):
    t_ = max(0.0, min(1.0, (x - a) / (b - a)))
    return t_ * t_ * (3 - 2 * t_)


for s, sfx in ((1, ".L"), (-1, ".R")):
    S, T, axis, L, at, proj, perp = arm_line(s)
    E, W, K1 = at(.42), at(.755, .05), at(.875, .045)
    BONES["upper_arm" + sfx] = (S, E, "chest", False)
    BONES["forearm" + sfx] = (E, W, "upper_arm" + sfx, True)
    BONES["hand" + sfx] = (W, K1, "forearm" + sfx, True)
    # digits: cut the hand at the knuckle line and the thumb is the separate piece left over;
    # further out (past the webbing) the four fingers separate too
    hand_c = at(.84, .06)
    fax = (T - K1).normalized()
    lat = fax.cross(V((-s, 0, 0))).normalized()
    rel = VS - np.array(K1[:])
    ax_d = rel @ np.array(fax[:])
    lat_d = rel @ np.array(lat[:])
    hand_zone = (np.linalg.norm(VS - np.array(W[:]), axis=1) < .2) & (proj > .74 * L) & (VS[:, 0] * s > .1)
    comps0 = [g_ for g_ in connected_groups(np.where(hand_zone & (ax_d > 0))[0]) if len(g_) > 8]
    thumb = None
    hm = np.zeros(len(VS), dtype=bool)
    if len(comps0) >= 2:
        tcomp = min(comps0, key=len)
        tsign = float(np.sign(lat_d[tcomp].mean()))
        hm = hand_zone & (lat_d * tsign > .034) & (ax_d < .03) & (ax_d > -.075)
        tip_t = V(VS[tcomp[int(np.argmax(ax_d[tcomp]))]])
        bsel = hm & (ax_d < -.05)
        base_t = V(VS[bsel].mean(axis=0)) if bsel.any() else W.lerp(K1, .4)
        msel = hm & (np.abs(ax_d + .005) < .008)
        mid_t = V(VS[msel].mean(axis=0)) if msel.any() else base_t.lerp(tip_t, .55)
        BONES["thumb1" + sfx] = (base_t, mid_t, "hand" + sfx, False)
        BONES["thumb2" + sfx] = (mid_t, tip_t, "thumb1" + sfx, True)
        thumb = (base_t, tip_t, V(VS[tcomp].mean(axis=0)))
    near = (np.linalg.norm(rel, axis=1) < .15) & (VS[:, 0] * s > .1)
    # past the webbing every finger is its own connected piece of surface
    groups = [g_ for g_ in connected_groups(np.where(near & ~hm & (ax_d > .026 * SCALE) & (np.abs(lat_d) < .07))[0]) if len(g_) > 12]
    if len(groups) >= 4:
        groups = sorted(groups, key=len, reverse=True)[:4]
    else:  # fall back to clustering by position across the knuckles
        fing = near & ~hm & (ax_d > .014) & (np.abs(lat_d) < .06)
        lv, fidx = lat_d[fing], np.where(fing)[0]
        cent = np.quantile(lv, [.125, .375, .625, .875])
        for _ in range(20):
            lab = np.argmin(np.abs(lv[:, None] - cent[None, :]), axis=1)
            cent = np.array([lv[lab == k].mean() if (lab == k).any() else cent[k] for k in range(4)])
        groups = [fidx[lab == k] for k in range(4)]
    print("FINGER GROUPS", sfx, [len(g_) for g_ in groups])
    cent = np.array([lat_d[g_].mean() for g_ in groups])
    member = {int(vi): k for k, g_ in enumerate(groups) for vi in g_}
    order = list(np.argsort(cent))
    thumb_lat = float((np.array(thumb[2][:]) - np.array(K1[:])) @ np.array(lat[:])) if thumb else -s
    if thumb_lat > cent.mean():
        order.reverse()  # the index finger sits next to the thumb
    joints = {}
    for fname, k in zip(FINGER_NAMES, order):
        P, a_ = VS[groups[k]], ax_d[groups[k]]
        Lf = a_.max()

        def c_at(fr, P=P, a_=a_, Lf=Lf):
            sel = np.abs(a_ - fr * Lf) < .006
            return V(P[sel].mean(axis=0)) if sel.any() else None
        # knuckle joint: centre of the hand cross-section at the knuckle line, at this finger lateral position
        tip = V(P[int(np.argmax(a_))])
        ks = hand_zone & (np.abs(ax_d - .002) < .009) & (np.abs(lat_d - float(cent[k])) < .009)
        root = V(VS[ks].mean(axis=0)) if ks.sum() > 3 else K1 + lat * float(cent[k])
        # phalanges ~ 1 : 0.6 : 0.45 (proximal : middle : distal)
        a0, a9 = (root - K1).dot(fax), (tip - K1).dot(fax)
        j1 = c_at((a0 + .49 * (a9 - a0)) / Lf) or root.lerp(tip, .49)
        j2 = c_at((a0 + .79 * (a9 - a0)) / Lf) or root.lerp(tip, .79)
        BONES[fname + "1" + sfx] = (root, j1, "hand" + sfx, False)
        BONES[fname + "2" + sfx] = (j1, j2, fname + "1" + sfx, True)
        BONES[fname + "3" + sfx] = (j2, tip, fname + "2" + sfx, True)
        joints[k] = (fname, (j1 - K1).dot(fax), (j2 - K1).dot(fax))
    # hand weights by hand (bone heat leaves most of the fingers on the palm bone)
    for vi in np.where(near | hm)[0]:
        if hm[vi] and thumb and int(vi) not in member:
            base_t, tip_t = thumb[0], thumb[1]
            along = (V(VS[vi]) - base_t).dot(tip_t - base_t) / max(1e-6, (tip_t - base_t).length_squared)
            w2 = _sm(.35, .65, along)
            FW[int(vi)] = {"thumb1" + sfx: 1 - w2, "thumb2" + sfx: w2}
            continue
        a_v = ax_d[vi]
        if a_v < -.035 * SCALE:
            continue
        fname, a1, a2 = joints[member.get(int(vi), int(np.argmin(np.abs(cent - lat_d[vi]))))]
        if a_v < .004:
            w = _sm(-.035 * SCALE, .004, a_v)
            FW[int(vi)] = {"hand" + sfx: 1 - w, fname + "1" + sfx: w}
            continue
        f1 = 1 - _sm(a1 - .006, a1 + .006, a_v)
        f3 = _sm(a2 - .006, a2 + .006, a_v)
        FW[int(vi)] = {fname + "1" + sfx: f1, fname + "2" + sfx: max(0.0, 1 - f1 - f3), fname + "3" + sfx: f3}
    # legs
    knee_z, ankle_z = .285 * H, .052 * H
    up = centroid(slab(.47 * H, .01, .0 if s > 0 else -.19, .19 if s > 0 else 0))
    hip = V((up.x, BONES["hips"][0].y, hip_z - .01 * H))
    knee = centroid(slab(knee_z, .008, .0 if s > 0 else -.25, .25 if s > 0 else 0))
    ankle = centroid(slab(ankle_z, .006, .0 if s > 0 else None, None if s > 0 else 0))
    ankle.y += .01
    fm = (VS[:, 2] < .03 * H) & (VS[:, 0] * s > 0)
    toe_y = VS[fm][:, 1].min()
    toe = V((ankle.x, toe_y + .045, .02))
    BONES["thigh" + sfx] = (hip, knee, "hips", False)
    BONES["shin" + sfx] = (knee, ankle, "thigh" + sfx, True)
    BONES["foot" + sfx] = (ankle, toe, "shin" + sfx, True)
BONE_NAMES = list(BONES)

arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new({"hero": "Protagonist", "male": "NpcMale", "female": "NpcFemale", "police": "NpcPolice"}[VARIANT], arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (h, t_, parent, connect) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail, eb.roll = h, t_, 0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = connect
bpy.ops.object.mode_set(mode="OBJECT")

# ================================================================ skin: bone-heat weights
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in BONE_NAMES:
    if b not in body.vertex_groups:
        body.vertex_groups.new(name=b)
HAND_WEIGHTS = "--handweights" in ARGS  # default: trust bone heat now that every finger has its own chain
for vi, ws in (FW.items() if HAND_WEIGHTS else ()):
    for g_ in body.vertex_groups:
        g_.remove([vi])
    for n_, w_ in ws.items():
        if w_ > 1e-4:
            body.vertex_groups[n_].add([vi], w_, "REPLACE")
print("GROUPS", len(body.vertex_groups), "hand verts", len(FW))

# ================================================================ re-pose: A-pose arms down to the game rest pose
REST_DIRS = {
    "upper_arm": V((.035, .09, -1)), "forearm": V((.04, -.12, -1)), "hand": V((.03, -.1, -1)),
    "thigh": V((.012, -.01, -1)), "shin": V((0, .045, -1)),
}
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")


def aim(bname, target):
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bname]
    head, tail = pb.head.copy(), pb.tail.copy()
    q = (tail - head).normalized().rotation_difference(target.normalized())
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix


for s, sfx in ((1, ".L"), (-1, ".R")):
    for b in ("upper_arm", "forearm", "hand", "thigh", "shin"):
        d = REST_DIRS[b].copy()
        d.x *= s
        aim(b + sfx, d)
bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.objects.active = body
arm_mod = next(m for m in body.modifiers if m.type == "ARMATURE")
bpy.ops.object.modifier_apply(modifier=arm_mod.name)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
REST = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}

# finger curl axes (toward the palm) and convergence axes in armature space
FINGER_AXIS, FINGER_CONV, FINGER_DL, PALM = {}, {}, {}, {}
for s, sfx in ((1, ".L"), (-1, ".R")):
    d = (REST["middle1" + sfx][1] - REST["middle1" + sfx][0]).normalized()
    # anatomical palm normal: with the fingers along d and the index on the side L (pinky -> index),
    # the palm faces s * (d x L) for the left (+1) and right (-1) hand
    Lv = (REST["index1" + sfx][0] - REST["pinky1" + sfx][0])
    Lv = (Lv - d * Lv.dot(d)).normalized()
    palm = (d.cross(Lv) * s).normalized()
    PALM[sfx] = palm
    ax = d.cross(palm).normalized()
    FINGER_AXIS[sfx] = tuple(ax)
    FINGER_CONV[sfx] = tuple(d.cross(ax).normalized())
    FINGER_DL[sfx] = {f: (REST[f + "1" + sfx][0] - REST["middle1" + sfx][0]).dot(ax) for f in FINGER_NAMES}

# ================================================================ dress the body
GROUPS = [g.name for g in body.vertex_groups]
bm = bmesh.new()
bm.from_mesh(body.data)
bm.normal_update()
dl = bm.verts.layers.deform.verify()
uvl = bm.loops.layers.uv.verify()


def dominant(v):
    best, bw = None, -1
    for gi, w in v[dl].items():
        if w > bw:
            best, bw = GROUPS[gi], w
    return best or "hips"


GI = {n: i for i, n in enumerate(GROUPS)}


def base(n):
    return n.split(".")[0]


def seg_dist(p, a, b):
    ab = b - a
    t_ = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t_ - p).length


def sm(a, b, x):
    t_ = max(0.0, min(1.0, (x - a) / (b - a)))
    return t_ * t_ * (3 - 2 * t_)


def set_weights(v, ws):
    for gi in list(v[dl].keys()):
        del v[dl][gi]
    for n, w in ws.items():
        if w > 1e-4:
            v[dl][GI[n]] = w


VDOM = {v.index: dominant(v) for v in bm.verts}


def face_dom(f):
    names = [VDOM[v.index] for v in f.verts]
    return max(set(names), key=names.count)




eye_c = [V(np.array([v.co[:] for v in e.data.vertices]).mean(axis=0)) for e in eyes]
EYE_Z = (eye_c[0].z + eye_c[1].z) / 2
EYE_X = abs(eye_c[0].x)
head_m = (VS[:, 2] > EYE_Z - .1) & (np.abs(VS[:, 0]) < .012)
nose_i = np.argmin(np.where(head_m & (VS[:, 2] < EYE_Z), VS[:, 1], 9))
NOSE = V(VS[nose_i])
MOUTH_Z = NOSE.z - .033 * SCALE
BELT_Z = REST["hips"][0].z + .055
NECK_Z = REST["neck"][0].z
WRIST = {sfx: REST["hand" + sfx][0] for sfx in (".L", ".R")}
TORSO_Y = REST["chest"][0].y
print("LANDMARKS eyeZ", round(EYE_Z, 3), "nose", [round(c, 3) for c in NOSE], "mouthZ", round(MOUTH_Z, 3), "belt", round(BELT_Z, 3), "neck", round(NECK_Z, 3))


def side_of(n):
    return n[-2:] if n.endswith((".L", ".R")) else ".L"


def region(f):
    return "skin"


for f in bm.faces:
    f.material_index = mat_index(region(f))


def paint(b_, key_of_face):
    cl = b_.loops.layers.color.get("Col") or b_.loops.layers.color.new("Col")
    for f in b_.faces:
        h = DETAIL_COLORS.get(key_of_face(f))
        col = (*[srgb_to_lin(c) for c in hexrgb(h)], 1) if h else (1, 1, 1, 1)
        for loop in f.loops:
            loop[cl] = col


KEY_OF_INDEX = lambda f: next((k for k, m in MAT.items() if MAT_LIST[f.material_index] is m and k in DETAIL_COLORS), None)
paint(bm, KEY_OF_INDEX)

PARTS = []


def to_object(name, b_):
    me = bpy.data.meshes.new(name)
    b_.to_mesh(me)
    b_.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for gname in GROUPS:
        ob.vertex_groups.new(name=gname)
    PARTS.append(ob)
    return ob


def shell(name, pick, offset, key, planes=(), keep=None, solid=0.0, per_face_key=None):
    """offset copy of the selected body faces; optional clean cuts with planes"""
    sb = bm.copy()
    sdl = sb.verts.layers.deform.verify()
    sb.verts.ensure_lookup_table()
    sb.faces.ensure_lookup_table()
    chosen = {f.index for f in bm.faces if pick(f)}
    bmesh.ops.delete(sb, geom=[f for f in sb.faces if f.index not in chosen], context="FACES")
    bmesh.ops.delete(sb, geom=[v for v in sb.verts if not v.link_faces], context="VERTS")
    sb.normal_update()
    for v in sb.verts:
        v.co += v.normal * (offset(v) if callable(offset) else offset)
    for co, no in planes:
        bmesh.ops.bisect_plane(sb, geom=sb.verts[:] + sb.edges[:] + sb.faces[:], plane_co=V(co), plane_no=V(no))
    if keep:
        bmesh.ops.delete(sb, geom=[f for f in sb.faces if not keep(f)], context="FACES")
        bmesh.ops.delete(sb, geom=[v for v in sb.verts if not v.link_faces], context="VERTS")
    sb.normal_update()
    for f in sb.faces:
        f.material_index = mat_index(per_face_key(f) if per_face_key else key)
    paint(sb, (lambda f: per_face_key(f)) if per_face_key else (lambda f: key))
    ob = to_object(name, sb)
    if solid:
        m = ob.modifiers.new("solid", "SOLIDIFY")
        m.thickness, m.offset = solid, -1.0
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


TRUNK = ("hips", "spine", "chest")

X, NY = (1, 0, 0), (0, -1, 0)
# ---- soft painted detail on the head skin: vertex colours multiply the skin texture,
#      so hairline, brows, beard and lips fade smoothly instead of stair-stepping
HC_Y = REST["head"][0].y
HAIR_TINT = V((.13, .1, .085)) if HERO else V((.22, .18, .15))
LIP_TINT = V((.84, .6, .58)) if not FEMALE else V((.86, .56, .58))


def hair_field(p):
    rel = p - V((0, HC_Y, EYE_Z))
    az = abs(math.atan2(rel.x, -rel.y))  # 0 = face, pi = back of the head
    front, side, back = (.075, -.02, -.085) if FEMALE else (.068, .025, -.07)
    if az < 1.2:
        tz = front + (side - front) * max(0, min(1, (az - .5) / .7))
    else:
        tz = side + (back - side) * max(0, min(1, (az - 1.5) / 1.1))
    f = rel.z / SCALE - tz
    if abs(rel.x) > .062 * SCALE and -.08 < rel.z / SCALE < .095 and -.04 < rel.y / SCALE < .07:
        f = min(f, -.02)  # keep the ears clear
    return f


def face_paint(v):
    p, n = v.co, v.normal
    if p.z < EYE_Z - .16 * SCALE:
        return V((1, 1, 1)), 0.0
    front = sm(-.1, -.4, n.y)
    hair = sm(-.003, .008, hair_field(p))
    u = (abs(p.x) - EYE_X * .98) / (.024 * SCALE)
    zc = EYE_Z + (.018 + .004 * (1 - u * u) - (.003 * u if not FEMALE else 0)) * SCALE
    brow = math.exp(-((p.z - zc) / ((.0028 if FEMALE else .0038) * SCALE * (1 - .4 * min(1, u * u)))) ** 2) * sm(1.15, .8, abs(u)) * front
    beard = 0.0
    if not FEMALE:
        # short stubble: jaw, chin and upper lip, fading up the cheeks
        jaw = sm(MOUTH_Z + .03 * SCALE, MOUTH_Z + .004 * SCALE, p.z) * sm(.35, .0, n.y) * sm(EYE_Z - .2 * SCALE, EYE_Z - .17 * SCALE, p.z)
        lip = sm(.03 * SCALE, .022 * SCALE, abs(p.x)) * math.exp(-((p.z - (MOUTH_Z + .012 * SCALE)) / (.004 * SCALE)) ** 2) * front
        beard = (.75 if HERO else .55) * max(jaw, lip)
    e = (p.x / (.025 * SCALE)) ** 2 + ((p.z - MOUTH_Z) / (.0098 * SCALE)) ** 2
    lips = sm(1.2, .75, e) * front * (1 if p.y < NOSE.y + .04 else 0)
    c = V((1, 1, 1)).lerp(LIP_TINT, lips)
    dark = max(hair * .8, brow * .85, beard * .45)
    return c.lerp(HAIR_TINT, dark), hair


SKIN_I = mat_index("skin")
PAINTED = [0]
cl = bm.loops.layers.color.get("Col")
HAIRV = {}
HAIRF = {}
for v in bm.verts:
    if base(VDOM[v.index]) in ("head", "neck"):
        col, hv = face_paint(v)
        HAIRV[v.index] = hv
        HAIRF[v.index] = hair_field(v.co)
    else:
        col = None
    if col is None:
        continue
    for loop in v.link_loops:
        if loop.face.material_index == SKIN_I:
            loop[cl] = (*col, 1)
            PAINTED[0] += min(col) < .9

TRUNK = ("hips", "spine", "chest")
NOT_TORSO = ("head", "upper_arm", "forearm", "hand", "thumb1", "thumb2") + tuple(f + str(k) for f in ("index", "middle", "ring", "pinky") for k in (1, 2, 3))


def torso_band(f, z0, z1):
    """a face of the torso surface between two heights, whatever bone weights it"""
    c = f.calc_center_median()
    return base(face_dom(f)) not in NOT_TORSO and z0 < c.z < z1


HANDS = ("hand", "thumb1", "thumb2") + tuple(f + str(k) for f in FINGER_NAMES for k in (1, 2, 3))
HIDE = set()  # body faces fully covered by clothes (deleted at the end)
KNEE_Z = REST["shin.L"][0].z


# ================================================================ real clothing geometry
def garment(name, pick, key, loose, planes=(), keep=None, smooth=14, thick=.0045, folds=None):
    """Cloth cut from the body surface: anatomy smoothed away, pushed out so it hangs
    loose, wrinkled, trimmed with clean plane cuts (hems) and given real thickness."""
    sb = bm.copy()
    sdl = sb.verts.layers.deform.verify()
    sb.faces.ensure_lookup_table()
    chosen = {f.index for f in bm.faces if pick(f)}
    bmesh.ops.delete(sb, geom=[f for f in sb.faces if f.index not in chosen], context="FACES")
    bmesh.ops.delete(sb, geom=[v for v in sb.verts if not v.link_faces], context="VERTS")
    sb.normal_update()
    orig = {v: (v.co.copy(), v.normal.copy()) for v in sb.verts}
    for _ in range(smooth):
        bmesh.ops.smooth_vert(sb, verts=sb.verts[:], factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in sb.verts:
        o, n = orig[v]
        target = loose(o) if callable(loose) else loose
        v.co += n * max(0.0, target - (v.co - o).dot(n))
        if folds:
            v.co += n * folds(o)
    for co, no in planes:
        bmesh.ops.bisect_plane(sb, geom=sb.verts[:] + sb.edges[:] + sb.faces[:], plane_co=V(co), plane_no=V(no))
    if keep:
        bmesh.ops.delete(sb, geom=[f for f in sb.faces if not keep(f, sdl)], context="FACES")
        bmesh.ops.delete(sb, geom=[v for v in sb.verts if not v.link_faces], context="VERTS")
    for f in sb.faces:
        f.material_index = mat_index(key)
    paint(sb, lambda f: key)
    ob = to_object(name, sb)
    m = ob.modifiers.new("solid", "SOLIDIFY")
    m.thickness, m.offset, m.use_rim = thick, -1.0, True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    for p_ in ob.data.polygons:
        p_.use_smooth = True
    return ob


def dom_of(f, layer):
    names = [max(((GROUPS[gi], w) for gi, w in v[layer].items()), key=lambda x: x[1], default=("hips", 0))[0] for v in f.verts]
    return max(set(names), key=names.count)


def wrinkles(scale, amp):
    return lambda p: amp * mnoise.noise(V((p.x * scale, p.y * scale, p.z * scale * 1.7)))


def bunch(z0, width, amp, freq):
    """horizontal folds that stack up around a joint (knees, elbows, ankles)"""
    return lambda p: amp * math.sin(p.z * freq + mnoise.noise(p * 40) * 2) * math.exp(-((p.z - z0) / width) ** 2)


def upper_arm_t(c, dom):
    S, E = REST[dom]
    return (c - S).dot((E - S).normalized()) / (E - S).length


# ---- jeans: straight-leg, waistband, stacked at the ankles
CUFF_Z = .125 * SCALE
jeans_folds = [wrinkles(26, .0026), bunch(KNEE_Z, .05, .0035, 120), bunch(CUFF_Z + .03, .05, .005, 150)]
garment("Jeans", lambda f: base(face_dom(f)) in ("thigh", "shin") or torso_band(f, CUFF_Z - .03, BELT_Z + .03),
        "jeans", lambda p: .009 + .01 * sm(KNEE_Z + .1, CUFF_Z, p.z) + .006 * sm(BELT_Z - .2, BELT_Z - .05, p.z) * 0,
        planes=[((0, 0, BELT_Z + .01), (0, 0, 1)), ((0, 0, CUFF_Z), (0, 0, 1))],
        keep=lambda f, l: CUFF_Z < f.calc_center_median().z < BELT_Z + .01,
        folds=lambda p: sum(fn(p) for fn in jeans_folds))
for f in bm.faces:
    c = f.calc_center_median()
    b = base(face_dom(f))
    # only skin well inside the jeans goes (the waist band stays as a safety layer)
    if b in ("thigh", "shin") + TRUNK and CUFF_Z + .025 < c.z < BELT_Z - .07:
        HIDE.add(f.index)
# waistband + belt
belt_ring = [v.co for v in bm.verts if abs(v.co.z - BELT_Z) < .006 and base(VDOM[v.index]) in TRUNK]
if belt_ring:
    garment("Waistband", lambda f: torso_band(f, BELT_Z - .03, BELT_Z + .022),
            "jeans", .016, planes=[((0, 0, BELT_Z + .013), (0, 0, 1)), ((0, 0, BELT_Z - .022), (0, 0, 1))],
            keep=lambda f, l: BELT_Z - .022 < f.calc_center_median().z < BELT_Z + .013, smooth=10, thick=.005)

# ---- tops
neck_cut = ((0, TORSO_Y, NECK_Z - .012), (0, -.42, 1))  # crew neck dips at the front
if HERO:
    garment("Shirt", lambda f: torso_band(f, BELT_Z - .09, NECK_Z + .03),
            "shirt", .007, planes=[((0, 0, BELT_Z - .075), (0, 0, 1)), neck_cut],
            keep=lambda f, l: f.calc_center_median().z > BELT_Z - .075 and (f.calc_center_median() - V(neck_cut[0])).dot(V(neck_cut[1])) < 0,
            folds=wrinkles(30, .002))
elif MALE:
    def tee_keep(f, l):
        c = f.calc_center_median()
        dom = dom_of(f, l)
        if base(dom) == "upper_arm":
            return upper_arm_t(c, dom) < .42 or abs(c.x) < abs(REST[dom][0].x) - .01
        return c.z > BELT_Z - .075 and (c - V(neck_cut[0])).dot(V(neck_cut[1])) < 0
    sleeve_planes = []
    for sfx in (".L", ".R"):
        S, E = REST["upper_arm" + sfx]
        sleeve_planes.append((S.lerp(E, .42), (E - S).normalized()))
    garment("Tee", lambda f: torso_band(f, BELT_Z - .09, NECK_Z + .03)
            or (base(face_dom(f)) == "upper_arm" and (upper_arm_t(f.calc_center_median(), face_dom(f)) < .5
                                                      or (abs(f.calc_center_median().x) < abs(REST[face_dom(f)][0].x) - .01
                                                          and BELT_Z < f.calc_center_median().z < NECK_Z))),
            "shirt", lambda p: .008 + .006 * sm(BELT_Z + .15, BELT_Z - .05, p.z),
            planes=[((0, 0, BELT_Z - .075), (0, 0, 1)), neck_cut] + sleeve_planes, keep=tee_keep,
            folds=lambda p: wrinkles(28, .0024)(p) + bunch(BELT_Z, .05, .002, 90)(p))
else:
    top_z = NECK_Z - .105
    def top_pick(f):
        # by position, not by bone weights: faces of the back near the shoulder blades are
        # weighted to the arms and would leave notches
        c = f.calc_center_median()
        b = base(face_dom(f))
        return BELT_Z + .04 < c.z < top_z + .03 and b not in ("head",) + HANDS and (b not in NOT_TORSO or (abs(c.x) < .11 and f.normal.y > .5))

    garment("Top", top_pick,
            "shirt", .006, planes=[((0, 0, BELT_Z + .06), (0, 0, 1)), ((0, 0, top_z), (0, 0, 1))],
            keep=lambda f, l: BELT_Z + .06 < f.calc_center_median().z < top_z, folds=wrinkles(30, .0016))
for f in bm.faces:
    c = f.calc_center_median()
    dom = face_dom(f)
    b = base(dom)
    if b in TRUNK and c.z > BELT_Z + .08:
        if HERO or MALE:
            if c.z < NECK_Z - .05:
                HIDE.add(f.index)
        elif BELT_Z + .1 < c.z < NECK_Z - .135:
            HIDE.add(f.index)
    if MALE and b == "upper_arm" and upper_arm_t(c, dom) < .3:
        HIDE.add(f.index)

# ---- jacket (hero): smoothed leather shell, open front, rolled cuffs, turned-down collar
if HERO:
    a = math.radians(21)

    def jacket_pick(f):
        c = f.calc_center_median()
        dom = face_dom(f)
        b = base(dom)
        if b in ("head", "shin", "foot") + HANDS:
            return False
        if b == "thigh":
            # the hips under the hem: the hem plane cuts it clean instead of the bone weights
            return c.z > BELT_Z - .17
        if b == "forearm":
            return (c - WRIST[side_of(dom)]).length > .05
        if b == "upper_arm":
            return True
        return base(dom) not in NOT_TORSO and BELT_Z - .12 < c.z < NECK_Z + .05

    def jacket_keep(f, l):
        c = f.calc_center_median()
        dom = dom_of(f, l)
        if base(dom) in ("upper_arm", "forearm"):
            return (c - WRIST[side_of(dom)]).length > .07
        if c.z < BELT_Z - .1 or c.z > NECK_Z + .004:
            return False
        return not (c.y < TORSO_Y and abs(c.x) < .16 and math.degrees(math.atan2(abs(c.x), -(c.y - TORSO_Y))) < 19)

    planes = [((0, 0, BELT_Z - .1), (0, 0, 1)), ((0, 0, NECK_Z + .004), (0, 0, 1)),
              ((0, TORSO_Y, 0), (math.cos(a), math.sin(a), 0)), ((0, TORSO_Y, 0), (math.cos(a), -math.sin(a), 0))]
    for sfx in (".L", ".R"):
        fd = (REST["forearm" + sfx][1] - REST["forearm" + sfx][0]).normalized()
        planes.append((WRIST[sfx] - fd * .07, fd))
    elbow_folds = []
    for sfx in (".L", ".R"):
        E = REST["forearm" + sfx][0]
        elbow_folds.append(lambda p, E=E: .004 * math.sin((p - E).length * 160) * math.exp(-((p - E).length / .06) ** 2))
    garment("Jacket", jacket_pick, "jacket", lambda p: .018 if p.z < NECK_Z - .07 else .012, planes=planes, keep=jacket_keep,
            smooth=24, thick=.006,
            folds=lambda p: wrinkles(18, .003)(p) + sum(fn(p) for fn in elbow_folds) + bunch(BELT_Z - .05, .05, .003, 80)(p))
    for f in bm.faces:
        dom = face_dom(f)
        if base(dom) in ("upper_arm", "forearm") and (f.calc_center_median() - WRIST[side_of(dom)]).length > .09:
            HIDE.add(f.index)

    # turned-down leather collar: a clean band round the neck, open at the front, covering the
    # cut edge of the jacket shell
    NK = REST["neck"][0]
    neck_pts = [v.co for v in bm.verts if abs(v.co.z - (NECK_Z - .005)) < .006 and math.hypot(v.co.x - NK.x, v.co.y - NK.y) < .085]
    if neck_pts:
        ncx = sum(p.x for p in neck_pts) / len(neck_pts)
        ncy = sum(p.y for p in neck_pts) / len(neck_pts)
        rx = max(abs(p.x - ncx) for p in neck_pts)
        ry = max(abs(p.y - ncy) for p in neck_pts)
        cb = bmesh.new()
        cdl = cb.verts.layers.deform.verify()
        cb.loops.layers.uv.verify()
        prof = ((NECK_Z - .022, .006), (NECK_Z + .008, .005), (NECK_Z + .011, .011), (NECK_Z - .008, .026), (NECK_Z - .018, .03))
        segs, gap = 28, math.radians(38)
        rings = []
        for k in range(segs + 1):
            ang = math.pi / 2 + gap + (2 * math.pi - 2 * gap) * k / segs  # from beside the throat round the back (+Y) to the other side
            ring = []
            for z_, grow in prof:
                v = cb.verts.new((ncx + math.cos(ang) * (rx + grow), ncy - math.sin(ang) * (ry + grow), z_))
                v[cdl][GI["neck"]] = .45
                v[cdl][GI["chest"]] = .55
                ring.append(v)
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for i in range(len(prof) - 1):
                cb.faces.new((ra[i], rb[i], rb[i + 1], ra[i + 1]))
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        for f in cb.faces:
            f.material_index = mat_index("jacket")
        paint(cb, lambda f: "jacket")
        col = to_object("Collar", cb)
        m = col.modifiers.new("solid", "SOLIDIFY")
        m.thickness, m.offset = .004, 0
        bpy.context.view_layer.objects.active = col
        bpy.ops.object.modifier_apply(modifier=m.name)

# ================================================================ hair cards
def strand_texture(name, base_hex, tip_hex):
    w, h = 256, 256
    rgba = np.zeros((h, w, 4), np.float32)
    bc, tc = hexrgb(base_hex), hexrgb(tip_hex)
    rng = np.random.default_rng(11)
    for _ in range(900):
        x = rng.uniform(0, w)
        top = rng.uniform(0, .25)  # strands end at different lengths
        wid = rng.uniform(.6, 1.8)
        shade = rng.uniform(.6, 1.15)
        ys = np.arange(int(top * h), h)
        xs = (x + np.sin(ys / h * rng.uniform(2, 8) + rng.uniform(0, 6)) * rng.uniform(0, 3)) % w
        for dx in range(-1, 2):
            cx = (xs.astype(int) + dx) % w
            a = np.clip(wid - abs(dx), 0, 1)
            t_ = (ys / h)[:, None]
            col = (bc[None, :] * t_ + tc[None, :] * (1 - t_)) * shade
            rgba[ys, cx, :3] = np.maximum(rgba[ys, cx, :3], col * a)
            rgba[ys, cx, 3] = np.maximum(rgba[ys, cx, 3], a)
    # image rows run bottom-up in Blender: v = 0 at the root
    rgba = rgba[::-1]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def card_material(name, img):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = img
    nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    clip = nt.nodes.new("ShaderNodeMath")
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = .4
    nt.links.new(tn.outputs["Alpha"], clip.inputs[0])
    nt.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = .45
    m.use_backface_culling = False
    m.diffuse_color = (.05, .04, .03, 1)
    return m


HAIR_CARD = card_material("HairCards", strand_texture("strands", "0c0907" if HERO else "6a6a6a", "2a1c12" if HERO else "c8c8c8"))
MAT["cards"] = HAIR_CARD
RNG_H = np.random.default_rng(5)


def scalp_faces(min_field):
    out = []
    for f in bm.faces:
        if base(face_dom(f)) not in ("head", "neck"):
            continue
        if all(HAIRF.get(v.index, -1) > min_field for v in f.verts):
            out.append(f)
    return out


def sample_faces(faces, n):
    areas = np.array([f.calc_area() for f in faces])
    idx = RNG_H.choice(len(faces), size=n, p=areas / areas.sum())
    pts = []
    for i in idx:
        f = faces[i]
        w = RNG_H.dirichlet(np.ones(len(f.verts)))
        p = sum((v.co * float(wi) for v, wi in zip(f.verts, w)), V((0, 0, 0)))
        pts.append((p, f.normal.copy()))
    return pts


def tangent(v, n):
    t_ = v - n * v.dot(n)
    return t_.normalized() if t_.length > 1e-6 else n.orthogonal().normalized()


def cards(name, roots, strand, width, segs=3, weight=None):
    """strand(p, n) -> list of points from root to tip; a ribbon card follows them"""
    cb = bmesh.new()
    cdl = cb.verts.layers.deform.verify()
    cuv = cb.loops.layers.uv.verify()
    for p, n in roots:
        pts = strand(p, n)
        u0 = RNG_H.integers(0, 4) / 4
        twist = RNG_H.uniform(-.5, .5)
        prev = None
        row = []
        for k, q in enumerate(pts):
            d = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            side = n.cross(d)
            side = (side * math.cos(twist) + n * math.sin(twist)).normalized()
            wk = width * (1 - .35 * k / (len(pts) - 1))
            a = cb.verts.new(q - side * wk / 2)
            b = cb.verts.new(q + side * wk / 2)
            ws = weight(q) if weight else {"head": 1.0}
            for vv in (a, b):
                for bn, wv in ws.items():
                    vv[cdl][GI[bn]] = wv
            row.append((a, b, k / (len(pts) - 1)))
        for (a0, b0, v0), (a1, b1, v1) in zip(row, row[1:]):
            f = cb.faces.new((a0, b0, b1, a1))
            for loop, uv in zip(f.loops, ((u0, v0), (u0 + .25, v0), (u0 + .25, v1), (u0, v1))):
                loop[cuv].uv = uv
    for f in cb.faces:
        f.material_index = mat_index("cards")
    paint(cb, lambda f: None)
    return to_object(name, cb)


HEAD_C = V((0, HC_Y, EYE_Z + .01))


def CAP_Z(p, dir_only=False):
    """height of the police cap band lower edge in the direction of p from the head axis
    (higher at the forehead, lower at the back)"""
    dx, dy = p.x, p.y - HC_Y
    fy = -dy / (math.hypot(dx, dy) or 1)
    return EYE_Z + SCALE * (.03 + .015 * fy)


scalp = scalp_faces(.004)
# ---- hair, the way game hair is built: a sculpted hair volume carries the shape of the cut
#      (with a strand texture projected from the crown), and a few layers of short, flat,
#      softly feathered cards lie on top of it to break up the surface and the silhouette.
CROWN = HEAD_C + V((0, .035 * SCALE, .1 * SCALE))


def hair_depth_at(p):
    """thickness of the hair volume over the scalp point p"""
    f = hair_field(p)
    rel = (p - HEAD_C).z / SCALE
    if FEMALE:
        return .002 + .013 * sm(0, .03, f) * (.55 + .45 * sm(-.04, .07, rel))
    top = .012 if HERO else .010
    return .0015 + top * sm(0, .035, f) * (.3 + .7 * sm(-.03, .07, rel))


cap = shell("HairCap", lambda f: all(HAIRF.get(v.index, -1) > .002 for v in f.verts), lambda v: hair_depth_at(v.co), "hair")
bmc = bmesh.new()
bmc.from_mesh(cap.data)
inner = [v for v in bmc.verts if not v.is_boundary]
for _ in range(5):
    bmesh.ops.smooth_vert(bmc, verts=inner, factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
uvc = bmc.loops.layers.uv.verify()
for fc in bmc.faces:
    uvs = []
    for loop in fc.loops:
        d = loop.vert.co - CROWN
        az = math.atan2(d.x, -d.y)
        pol = math.atan2(math.hypot(d.x, d.y), d.z)
        uvs.append([az / (2 * math.pi) * 5, pol * 1.6])
    # no seam smear where the azimuth wraps round at the back
    us = [u for u, _ in uvs]
    if max(us) - min(us) > 2.5:
        for uv in uvs:
            if uv[0] < 0:
                uv[0] += 5
    for loop, uv in zip(fc.loops, uvs):
        loop[uvc].uv = uv
bmc.to_mesh(cap.data)
bmc.free()


def clump_texture(name, base_hex, tip_hex):
    """strands grouped into clumps with soft edges and tapered tips: reads as hair, not as ribbons"""
    w, h = 256, 256
    rgba = np.zeros((h, w, 4), np.float32)
    bc, tc = hexrgb(base_hex), hexrgb(tip_hex)
    rng = np.random.default_rng(23)
    ys = np.arange(h)
    for _ in range(30):
        cx, cw, top = rng.uniform(0, w), rng.uniform(5, 12), rng.uniform(0, .3)
        for _ in range(16):
            x0 = cx + rng.normal(0, cw / 3)
            y0 = int((top + rng.uniform(0, .12)) * h)
            wig = rng.uniform(0, 2.5)
            xs = x0 + np.sin(ys / h * rng.uniform(2, 6) + rng.uniform(0, 6)) * wig
            shade = rng.uniform(.7, 1.15)
            for dx in range(-2, 3):
                cxs = (np.round(xs).astype(int) + dx) % w
                a = np.exp(-(dx / 1.1) ** 2) * np.clip((ys - y0) / 40.0, 0, 1)
                a[ys < y0] = 0
                t_ = (ys / h)[:, None]
                col = (bc[None, :] * t_ + tc[None, :] * (1 - t_)) * shade
                rgba[ys, cxs, :3] = np.where(a[:, None] > rgba[ys, cxs, 3:4], col, rgba[ys, cxs, :3])
                rgba[ys, cxs, 3] = np.maximum(rgba[ys, cxs, 3], a)
    rgba = rgba[::-1]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


HAIR_CARD.node_tree.nodes["Image Texture"].image = clump_texture("clumps", "0c0907" if HERO else "6a6a6a", "2a1c12" if HERO else "c8c8c8")


def on_cap(p, n):
    """a root on the hair volume surface instead of on the skin underneath it"""
    return p + n * (hair_depth_at(p) - .0005)


if FEMALE:
    TIE = HEAD_C + V((0, .105 * SCALE, .045))

    def to_tie(p, n):
        # pulled back to the tie, hugging the head all the way (radius blends from root to tie)
        p = on_cap(p, n)
        r0, r1 = (p - HEAD_C).length, (TIE - HEAD_C).length
        pts = []
        for s in (0, .25, .5, .75, 1):
            q = p.lerp(TIE, s * .97)
            r = r0 + (r1 - r0) * s + .0015 + .003 * math.sin(math.pi * s)
            pts.append(HEAD_C + (q - HEAD_C).normalized() * r)
        return pts

    cards("HairScalp", sample_faces(scalp, 700), to_tie, .016)

    def tail(p, n):
        ang = RNG_H.uniform(0, 2 * math.pi)
        r = RNG_H.uniform(0, .016)
        L = RNG_H.uniform(.18, .26)
        off = V((math.cos(ang) * r, math.sin(ang) * r * .7, 0))
        return [TIE + off * (1 + 1.4 * s) + V((0, .03 * s, -L * s)) for s in (0, .25, .5, .75, 1)]

    tie_w = lambda q: {"head": 1.0} if q.z > TIE.z - .06 else {"neck": .6, "chest": .4}
    cards("Ponytail", [(TIE, V((0, 1, 0)))] * 70, tail, .02, weight=tie_w)
else:
    # short textured cut: a little longer on top and combed back, cards lying close to the volume
    def short(p, n):
        top = sm(.02, .07, (p - HEAD_C).z)
        p = on_cap(p, n)
        L = (.01 + (.026 if HERO else .022) * top) * RNG_H.uniform(.75, 1.15)
        # combed back on top and at the front hairline, down at the sides and the back
        front = sm(HC_Y - .02, HC_Y - .07, p.y)
        lay = max(top, front)
        d = tangent(V((0, 1, .1)) * lay + V((0, .4, -1)) * (1 - lay) + V((RNG_H.normal() * .25, 0, 0)), n)
        lift = .0008 + .0022 * top
        # bend the card round the head so the tips stay on the hair instead of sticking out
        r0 = (p - HEAD_C).length
        return [HEAD_C + (p + d * L * s - HEAD_C).normalized() * (r0 + lift * math.sin(math.pi * s * .8)) for s in (0, .5, 1)]

    if POLICE:  # nothing under the cap
        scalp = [f for f in scalp if f.calc_center_median().z < CAP_Z(f.calc_center_median()) - .006]
    cards("Hair", sample_faces(scalp, 1100 if HERO else 750 if not POLICE else 300), short, .012, segs=2)

# eyebrows are painted into the skin (see face_paint): no floating cards
# ---- sneakers fitted to each foot
def loft_part(name, rings, key, segs, bone):
    b_ = bmesh.new()
    d_ = b_.verts.layers.deform.verify()
    uv_ = b_.loops.layers.uv.verify()
    loops = []
    for c, axis, rx, ry, ref in rings:
        axis = V(axis).normalized()
        ref = V(ref)
        u_ = (ref - axis * ref.dot(axis)).normalized()
        w_ = axis.cross(u_)
        ring = []
        for i in range(segs):
            ang = 2 * math.pi * i / segs
            vv = b_.verts.new(V(c) + u_ * math.cos(ang) * rx + w_ * math.sin(ang) * ry)
            vv[d_][GI[bone]] = 1.0
            ring.append(vv)
        loops.append(ring)
    for k, (ra, rb) in enumerate(zip(loops, loops[1:])):
        for i in range(segs):
            j = (i + 1) % segs
            f = b_.faces.new((ra[i], ra[j], rb[j], rb[i]))
            for loop, uv in zip(f.loops, ((i / segs, k / 6), ((i + 1) / segs, k / 6), ((i + 1) / segs, (k + 1) / 6), (i / segs, (k + 1) / 6))):
                loop[uv_].uv = uv
    b_.faces.new(list(reversed(loops[0])))
    b_.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(b_, faces=b_.faces)
    for f in b_.faces:
        f.material_index = mat_index(key)
    paint(b_, lambda f: key)
    return to_object(name, b_)


SHOE = [(.078, .068, .038, .043), (.05, .077, .048, .058), (.0, .072, .052, .056),
        (-.06, .057, .054, .041), (-.12, .046, .050, .028), (-.165, .041, .036, .02)]
for sfx in (".L", ".R"):
    fv = [v.co for v in bm.verts if VDOM[v.index] == "foot" + sfx]
    heel_y = max(p.y for p in fv)
    toe_y = min(p.y for p in fv)
    fx = sum(p.x for p in fv) / len(fv)
    fw = max(p.x for p in fv) - min(p.x for p in fv)
    ws = fw / .104 * 1.08

    def ymap(yr):
        tt = (.078 - yr) / .243
        return heel_y + .012 + (toe_y - .014 - heel_y - .012) * tt

    bone = "foot" + sfx
    loft_part("Sneaker", [(V((fx, ymap(y), z)), NY, rx * ws, ry, X) for y, z, rx, ry in SHOE], "shoe", 18, bone)
    loft_part("Sole", [(V((fx, ymap(y), .016)), NY, rx * ws + .006, .016, X) for y, z, rx, ry in SHOE], "sole", 18, bone)
    for side in (1, -1):
        loft_part("Stripe", [(V((fx + side * .053 * ws, ymap(.02), .05)), NY, .002, .009, X), (V((fx + side * .055 * ws, ymap(-.03), .062)), NY, .002, .011, X),
                             (V((fx + side * .051 * ws, ymap(-.08), .05)), NY, .002, .008, X)], "accent", 6, bone)
    for k in range(4):
        y0 = ymap(-.035 - k * .02)
        loft_part("Lace", [(V((fx - .02 * ws, y0, .1 - k * .011)), X, .003, .002, (0, 1, 0)), (V((fx + .02 * ws, y0, .1 - k * .011)), X, .003, .002, (0, 1, 0))], "shoe", 6, bone)

# bare feet stay hidden inside the shoes, covered skin under the clothes is removed
bmesh.ops.delete(bm, geom=[f for f in bm.faces if base(face_dom(f)) == "foot" or f.index in HIDE], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

# body mesh itself
to_object("Body", bm)
body_new = PARTS[-1]

# ---- eyes: sclera / iris / pupil by angle from the eye's forward axis
HEAD_I = GROUPS.index("head")
for e, c in zip(eyes, eye_c):
    eb = bmesh.new()
    eb.from_mesh(e.data)
    edl = eb.verts.layers.deform.verify()
    for v in eb.verts:
        v[edl][HEAD_I] = 1.0
    for f in eb.faces:
        d = (f.calc_center_median() - c).normalized()
        ang = math.degrees(math.acos(max(-1, min(1, -d.y))))
        f.material_index = mat_index("pupil" if ang < 13 else "iris" if ang < 30 else "eye")
    paint(eb, lambda f: None)
    to_object("Eye", eb)
    bpy.data.objects.remove(e)

# ---- extras
if POLICE:
    # ---- uniform: peaked cap, badges, shoulder patches, collar, duty belt
    from mathutils import kdtree
    bme = body_new.data
    HV = np.array([v.co[:] for v in bme.vertices])
    kd = kdtree.KDTree(len(bme.vertices))
    for i, v in enumerate(bme.vertices):
        kd.insert(v.co, i)
    kd.balance()

    def part(name, b_, key, ws, solid=0.0):
        d_ = b_.verts.layers.deform.verify()
        b_.loops.layers.uv.verify()
        for v in b_.verts:
            for bn, w in ws(v.co).items():
                v[d_][GI[bn]] = w
        bmesh.ops.recalc_face_normals(b_, faces=b_.faces)
        for f in b_.faces:
            f.material_index = mat_index(key)
        paint(b_, lambda f: key)
        ob = to_object(name, b_)
        if solid:
            m = ob.modifiers.new("solid", "SOLIDIFY")
            m.thickness, m.offset = solid, -1.0
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=m.name)
        return ob

    def rings_mesh(rows, closed=True, top=None):
        """rows: list of lists of points (same length); quads between rows, optional fan to a top point"""
        b_ = bmesh.new()
        vs = [[b_.verts.new(p) for p in row] for row in rows]
        n = len(rows[0])
        for ra, rb in zip(vs, vs[1:]):
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                b_.faces.new((ra[i], ra[j], rb[j], rb[i]))
        if top is not None:
            c = b_.verts.new(top)
            for i in range(n):
                b_.faces.new((vs[-1][i], vs[-1][(i + 1) % n], c))
        return b_

    def blob(center, radii, frame, segs=12, rings_=8):
        """ellipsoid; frame = 3x3 matrix whose columns are the local x, y, z axes"""
        b_ = bmesh.new()
        bmesh.ops.create_uvsphere(b_, u_segments=segs, v_segments=rings_, radius=1.0)
        for v in b_.verts:
            v.co = V(center) + frame @ V((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        return b_

    def box_(center, size, frame):
        b_ = bmesh.new()
        bmesh.ops.create_cube(b_, size=1.0)
        for v in b_.verts:
            v.co = V(center) + frame @ V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        return b_

    def frame_from(normal, up=V((0, 0, 1))):
        """columns: x = side, y = surface normal, z = up projected"""
        n = V(normal).normalized()
        u = (up - n * up.dot(n)).normalized()
        x = u.cross(n).normalized()
        return Matrix((x, n, u)).transposed()

    tee = next(o for o in PARTS if o.name.startswith("Tee")).data
    kdt = kdtree.KDTree(len(tee.vertices))
    for i, v in enumerate(tee.vertices):
        kdt.insert(v.co, i)
    kdt.balance()

    def surf(p, facing):
        """nearest outward-facing point of the shirt"""
        for co, idx, d in kdt.find_n(p, 60):
            if tee.vertices[idx].normal.dot(V(facing)) > .4:
                return co, tee.vertices[idx].normal.copy()
        co, idx, _ = kdt.find(p)
        return co, tee.vertices[idx].normal.copy()

    head_w = lambda p: {"head": 1.0}

    # -- cap: band follows the head just above the ears, crown flares out, flat top
    hs = HV[HV[:, 2] > EYE_Z - .05]
    hdx, hdy = hs[:, 0], hs[:, 1] - HC_Y
    hang = np.arctan2(hdy, hdx)
    hrad = np.hypot(hdx, hdy)

    def head_r(z0, z1, ang):
        m = (hs[:, 2] > z0) & (hs[:, 2] < z1) & (np.abs(np.angle(np.exp(1j * (hang - ang)))) < .22) & (hrad < .14)
        return float(hrad[m].max()) if m.any() else .095

    NA = 36
    angs = [2 * math.pi * i / NA for i in range(NA)]
    zb = [CAP_Z(V((math.cos(a), HC_Y + math.sin(a), 0)), dir_only=True) for a in angs]
    rb = [head_r(z, z + .06, a) + .012 for a, z in zip(angs, zb)]
    # smooth the band radius around the head
    rb = [max(rb[i], (rb[i - 1] + rb[(i + 1) % NA]) / 2) for i in range(NA)]
    crown_h = max(.1 * SCALE, (H + .016) - (EYE_Z + .03 * SCALE))
    pt = lambda a, r, z: V((math.cos(a) * r, HC_Y + math.sin(a) * r, z))
    band = rings_mesh([[pt(a, r, z) for a, r, z in zip(angs, rb, zb)],
                       [pt(a, r * 1.01, z + .04 * SCALE) for a, r, z in zip(angs, rb, zb)]])
    part("CapBand", band, "visor", head_w, solid=.004)
    rows = []
    for dz, k in ((.039, 1.0), (.05, 1.07), (.08, 1.17), (1.0, 1.21), (1.0, 1.21), (1.0, 1.0)):
        row = []
        for a, r, z in zip(angs, rb, zb):
            zz = z + (crown_h - .006 if dz == 1.0 else dz * SCALE)
            row.append(pt(a, r * k, zz))
        rows.append(row)
    # last two rows: rounded top edge then the flat top
    rows[4] = [p + V((0, 0, .006)) for p in rows[4]]
    rows[4] = [V((HC_Y * 0 + p.x * .93, HC_Y + (p.y - HC_Y) * .93, p.z)) for p in rows[4]]
    rows[5] = [V((p.x * .45, HC_Y + (p.y - HC_Y) * .45, p.z + .008)) for p in rows[4]]
    top = V((0, HC_Y, sum(p.z for p in rows[5]) / NA + .002))
    part("CapCrown", rings_mesh(rows, top=top), "cap", head_w, solid=.004)
    # visor (peak) over the forehead, sloping down
    front = -math.pi / 2
    va = [front + math.radians(-68 + 136 * i / 16) for i in range(17)]
    inner, outer = [], []
    for a in va:
        r = head_r(EYE_Z, EYE_Z + .08, a) + .012
        z = CAP_Z(V((math.cos(a), HC_Y + math.sin(a), 0)), dir_only=True) + .004
        f = 1 - .55 * ((a - front) / math.radians(68)) ** 2
        inner.append(pt(a, r, z))
        outer.append(pt(a, r + .07 * SCALE * f, z - .022 * f))
    part("CapVisor", rings_mesh([inner, outer], closed=False), "visor", head_w, solid=.005)
    rf = head_r(EYE_Z, EYE_Z + .08, front) + .012
    zf = CAP_Z(V((0, HC_Y - 1, 0)), dir_only=True)
    fr = frame_from(V((0, -1, .25)))
    part("CapBadge", blob(pt(front, rf * 1.13, zf + .066 * SCALE), (.014, .004, .017), fr), "gold", head_w)

    # -- chest badge (left chest) and name plate (right chest), on top of the shirt
    for sgn, key, size in ((1, "gold", (.019, .005, .024)), (-1, "gold", (.03, .004, .007))):
        co, n = surf(V((sgn * .085 * SCALE, TORSO_Y - .3, NECK_Z - .115 * SCALE)), facing=(0, -1, 0))
        n.z *= .3
        fr = frame_from(n)
        if key == "gold" and sgn > 0:
            b_ = blob(co + n.normalized() * .003, size, fr, 10, 8)
        else:
            b_ = box_(co + n.normalized() * .003, (size[0] * 2, size[1], size[2] * 2), fr)
        part("Badge" if sgn > 0 else "NamePlate", b_, key, lambda p: {"chest": 1.0})

    # -- shoulder patches on the sleeves
    for s, sfx in ((1, ".L"), (-1, ".R")):
        S_, E_ = REST["upper_arm" + sfx]
        co, n = surf(S_.lerp(E_, .22) + V((s * .1, 0, 0)), facing=(s, 0, 0))
        n = V((n.x, n.y * .5, 0)).normalized()
        fr = frame_from(n, up=(S_ - E_).normalized())
        part("Patch", blob(co + n * .002, (.026, .003, .032), fr, 12, 6), "patch", lambda p, b=("upper_arm" + sfx): {b: 1.0})

    # -- duty belt over the jeans waistband, with holster, radio and cuff pouches
    bz = BELT_Z - .004
    ring = HV[(np.abs(HV[:, 2] - bz) < .012) & (np.hypot(HV[:, 0], HV[:, 1] - TORSO_Y) < .2)]
    bcy = TORSO_Y
    bang = np.arctan2(ring[:, 1] - bcy, ring[:, 0])
    brad = np.hypot(ring[:, 0], ring[:, 1] - bcy)

    def belt_r(a):
        m = np.abs(np.angle(np.exp(1j * (bang - a)))) < .2
        return float(brad[m].max()) + .03 if m.any() else .17

    ba = [2 * math.pi * i / 40 for i in range(40)]
    br = [belt_r(a) for a in ba]
    br = [max(br[i], (br[i - 1] + br[(i + 1) % 40]) / 2) for i in range(40)]
    bpt = lambda a, r, z: V((math.cos(a) * r, bcy + math.sin(a) * r, z))
    belt = rings_mesh([[bpt(a, r, bz - .024) for a, r in zip(ba, br)], [bpt(a, r, bz + .024) for a, r in zip(ba, br)]])
    hips_w = lambda p: {"hips": 1.0}
    part("Belt", belt, "belt", hips_w, solid=.008)
    fb = frame_from(V((0, -1, 0)))
    part("Buckle", box_(bpt(-math.pi / 2, belt_r(-math.pi / 2) + .006, bz), (.05, .006, .036), fb), "gold", hips_w)

    def on_belt(a, size, dz=0.0, out=.0):
        r = belt_r(a) + size[1] / 2 + out
        return box_(bpt(a, r, bz + dz), size, frame_from(V((math.cos(a), math.sin(a), 0))))

    # holster on the right hip (-X), slightly behind; gun grip sticking out the top
    ha = math.pi + .25
    part("Holster", on_belt(ha, (.05, .055, .17), dz=-.07), "belt", lambda p: {"hips": .7, "thigh.R": .3})
    part("GunGrip", on_belt(ha, (.03, .04, .07), dz=.03, out=.006), "glass", hips_w)
    part("Radio", on_belt(-.6, (.045, .035, .08), dz=-.01), "belt", hips_w)
    part("CuffPouch", on_belt(math.pi / 2 + .5, (.06, .03, .045)), "belt", hips_w)
    part("MagPouch", on_belt(-math.pi / 2 + .45, (.05, .03, .06), dz=-.008), "belt", hips_w)
if HERO:
    # gold chain: a thin tube laid over the actual neck/chest surface (on top of the shirt)
    from mathutils import kdtree
    bme = body_new.data
    kd = kdtree.KDTree(len(bme.vertices))
    for i, v in enumerate(bme.vertices):
        kd.insert(v.co, i)
    kd.balance()
    ring_pts = [v.co for v in bme.vertices if abs(v.co.z - (NECK_Z + .01)) < .008 and abs(v.co.x) < .07]
    nx = max(abs(p.x) for p in ring_pts)
    ny0, ny1 = min(p.y for p in ring_pts), max(p.y for p in ring_pts)
    cy, ry = (ny0 + ny1) / 2, (ny1 - ny0) / 2
    path = []
    n_pts = 40
    for i in range(n_pts):
        ang = 2 * math.pi * i / n_pts
        sag = max(0.0, -math.sin(ang)) ** 2
        back = max(0.0, math.sin(ang))
        guess = V((math.cos(ang) * nx, cy + math.sin(ang) * ry, NECK_Z + .01 * back - .006 - .065 * sag))
        co, idx, _ = kd.find(guess)
        path.append(co + bme.vertices[idx].normal * (.0135 if math.sin(ang) < -.2 else .004))
    cb = bmesh.new()
    cdl = cb.verts.layers.deform.verify()
    cb.loops.layers.uv.verify()
    ci = GROUPS.index("chest")
    rings = []
    for i, p in enumerate(path):
        t_ = (path[(i + 1) % n_pts] - path[i - 1]).normalized()
        u_ = t_.orthogonal().normalized()
        w_ = t_.cross(u_)
        ring = []
        for k in range(6):
            ang = 2 * math.pi * k / 6
            v = cb.verts.new(p + (u_ * math.cos(ang) + w_ * math.sin(ang)) * .0028)
            v[cdl][ci] = 1.0
            ring.append(v)
        rings.append(ring)
    for i in range(n_pts):
        ra, rb = rings[i], rings[(i + 1) % n_pts]
        for k in range(6):
            cb.faces.new((ra[k], ra[(k + 1) % 6], rb[(k + 1) % 6], rb[k]))
    for f in cb.faces:
        f.material_index = mat_index("gold")
    paint(cb, lambda f: "gold")
    to_object("Chain", cb)
if FEMALE:
    pb_ = bmesh.new()
    pdl = pb_.verts.layers.deform.verify()
    puv = pb_.loops.layers.uv.verify()
    back = V((0, REST["head"][0].y + .1, EYE_Z + .03))
    rings = []
    for k, (dz, r) in enumerate(((0, .025), (-.06, .027), (-.13, .021), (-.2, .011))):
        ring = []
        for i in range(12):
            ang = 2 * math.pi * i / 12
            v = pb_.verts.new(back + V((math.cos(ang) * r, .02 * k + math.sin(ang) * r * .85, dz)))
            v[pdl][GROUPS.index("head" if k < 2 else "neck")] = 1.0
            ring.append(v)
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for i in range(12):
            j = (i + 1) % 12
            pb_.faces.new((ra[i], ra[j], rb[j], rb[i]))
    pb_.faces.new(list(reversed(rings[-1])))
    for f in pb_.faces:
        f.material_index = mat_index("hair")
    paint(pb_, lambda f: "hair")
    to_object("Ponytail", pb_)

# ================================================================ join + skin
bpy.data.objects.remove(body)
for ob in PARTS:
    for m in MAT_LIST:
        ob.data.materials.append(m)
bpy.ops.object.select_all(action="DESELECT")
for ob in PARTS:
    ob.select_set(True)
bpy.context.view_layer.objects.active = body_new
bpy.ops.object.join()
body = body_new
body.data.validate()
body.name = {"hero": "ProtagonistBody", "male": "NpcMaleBody", "female": "NpcFemaleBody", "police": "NpcPoliceBody"}[VARIANT]
body.parent = rig
am = body.modifiers.new("Armature", "ARMATURE")
am.object = rig
print("VERTS", len(body.data.vertices), "FACES", len(body.data.polygons), "MATS", [m.name for m in body.data.materials])

# ================================================================ animation
pbones = rig.pose.bones
for pb in pbones:
    pb.rotation_mode = "QUATERNION"


def rot(bone, *spec):
    if bone not in rig.data.bones:
        return Quaternion()
    Mi = rig.data.bones[bone].matrix_local.to_3x3().inverted()
    q = Quaternion()
    for axis, deg in spec:
        q = q @ Quaternion(Mi @ V(axis), math.radians(deg))
    return q


def key_pose(frame, pose, hips_off=(0, 0, 0)):
    for pb in pbones:
        pb.rotation_quaternion = pose.get(pb.name, Quaternion())
        pb.location = (0, 0, 0)
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    hp = pbones["hips"]
    hp.location = rig.data.bones["hips"].matrix_local.to_3x3().inverted() @ V(hips_off)
    hp.keyframe_insert("location", frame=frame)


XA, YA, ZA = (1, 0, 0), (0, 1, 0), (0, 0, 1)
# Sign notes (armature space, character faces -Y):
#   +X swings a down-pointing limb backward (knee flexion, plantarflexion = +),
#   an up-pointing bone forward. Left arm (+X side) abducts with -Y, right with +Y.
#   Rotating the trunk with -Z brings the left shoulder forward.


def rot_arm(bone, q):
    """armature-space rotation (as if the parent were at rest) -> pose quaternion"""
    Mi = rig.data.bones[bone].matrix_local.to_3x3().inverted()
    axis, ang = q.to_axis_angle()
    return Quaternion(Mi @ axis, ang)


FIST = (80, 95, 45)  # knuckle, middle and tip joint flexion of a closed fist (degrees)


def hands(p, curl, thumb=None):
    """curl: 0 = open hand ... 95 = closed fist. The knuckles bend ~80, the middle joints
    ~95 and the tips ~45 degrees; the thumb folds across the curled index/middle fingers."""
    k = curl / 95
    for sfx in (".L", ".R"):
        s = 1 if sfx == ".L" else -1
        ax, cv = FINGER_AXIS[sfx], FINGER_CONV[sfx]
        bends = {}
        for fname, conv, extra in (("index", 5, 0), ("middle", 0, 0), ("ring", 4, 5), ("pinky", 9, 10)):
            pull = -math.copysign(conv, FINGER_DL[sfx][fname]) * min(1, k)
            a1, a2, a3 = (FIST[0] + extra) * k, (FIST[1] + extra * .5) * k, FIST[2] * k
            bends[fname] = (a1, a2)
            # every phalanx hinges about (its own direction x palm normal)
            for j, ang in ((1, a1), (2, a2), (3, a3)):
                bn = fname + str(j) + sfx
                hd_, tl_ = REST[bn]
                hinge = tuple((tl_ - hd_).normalized().cross(PALM[sfx]).normalized())
                p[bn] = rot(bn, (cv, pull), (hinge, ang)) if j == 1 else rot(bn, (hinge, ang))
        if "thumb1" + sfx not in REST:
            continue
        tk = min(1.0, (curl * .45 if thumb is None else thumb) / 55)
        # where the middle phalanges of the index and middle fingers end up in this pose
        axv = V(ax)
        mids = []
        for fname in ("index", "middle"):
            r0, r1 = REST[fname + "1" + sfx]
            r2 = REST[fname + "2" + sfx][1]
            q1 = Quaternion(axv, math.radians(bends[fname][0]))
            q2 = q1 @ Quaternion(axv, math.radians(bends[fname][1]))
            p1 = r0 + q1 @ (r1 - r0)
            mids.append((p1 + p1 + q2 @ (r2 - r1)) / 2)
        hand_c = REST["hand" + sfx][0].lerp(REST["hand" + sfx][1], .6)
        target = (mids[0] + mids[1]) / 2
        target += (target - hand_c).normalized() * .014  # lie on the outside of the curled fingers
        t1h = REST["thumb1" + sfx][0]
        t_tip = REST["thumb2" + sfx][1]
        q = (t_tip - t1h).normalized().rotation_difference((target - t1h).normalized())
        qa, qang = q.to_axis_angle()
        p["thumb1" + sfx] = rot_arm("thumb1" + sfx, Quaternion(qa, qang * tk))
        p["thumb2" + sfx] = rot("thumb2" + sfx, (ax, 12 * tk))
    return p


def arm_ik(side, target, pole, twist):
    """two-bone IK in the torso's rest frame: wrist to target, elbow toward pole"""
    sfx = "." + side
    S, E0 = REST["upper_arm" + sfx]
    W0 = REST["forearm" + sfx][1]
    a, b = (E0 - S).length, (W0 - E0).length
    T, P = V(target), V(pole)
    dv = T - S
    d = min(max(dv.length, .05), (a + b) * .998)
    dn = dv.normalized()
    cos_al = max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d)))
    al = math.acos(cos_al)
    perp = (P - S) - dn * (P - S).dot(dn)
    perp.normalize()
    Ep = S + dn * (a * math.cos(al)) + perp * (a * math.sin(al))
    Tp = S + dn * d
    q1 = (E0 - S).normalized().rotation_difference((Ep - S).normalized())
    rest_f = (W0 - E0).normalized()
    q2w = (q1 @ rest_f).rotation_difference((Tp - Ep).normalized())
    q2 = q1.inverted() @ q2w @ q1
    hand_axis = (REST["hand" + sfx][1] - REST["hand" + sfx][0]).normalized()
    return {
        "upper_arm" + sfx: rot_arm("upper_arm" + sfx, q1),
        "forearm" + sfx: rot_arm("forearm" + sfx, q2),
        "hand" + sfx: rot("hand" + sfx, (tuple(hand_axis), twist)),
    }


def to_torso(pt, theta_deg):
    """undo the trunk's turn about the vertical axis so targets stay fixed relative to the face"""
    th = math.radians(-theta_deg)
    piv = V((0, TORSO_Y, 0))
    r = V(pt) - piv
    return piv + V((r.x * math.cos(th) - r.y * math.sin(th), r.x * math.sin(th) + r.y * math.cos(th), r.z))


def bump(t_, c, w):
    d = (t_ - c + .5) % 1 - .5
    return math.exp(-(d / w) ** 2)


def smooth01(a, b, x):
    t_ = max(0.0, min(1.0, (x - a) / (b - a)))
    return t_ * t_ * (3 - 2 * t_)


def walk_leg(t_):
    hip = -(6 + 19 * math.cos(2 * math.pi * t_))
    knee = 5 + 13 * bump(t_, .14, .07) + 58 * bump(t_, .72, .12)
    ankle = 5 * bump(t_, .07, .05) - 9 * bump(t_, .42, .12) + 18 * bump(t_, .61, .06) - 2 * bump(t_, .85, .1)
    return hip, knee, ankle


def run_leg(t_):
    hip = -15 - 31 * math.cos(2 * math.pi * (t_ - .9))
    knee = 18 + 24 * bump(t_, .14, .09) + 88 * bump(t_, .66, .15)
    ankle = -14 * bump(t_, .17, .09) + 30 * bump(t_, .42, .08) - 4
    return hip, knee, ankle


def gait(t_, run):
    """masculine gait: little hip sway, the shoulders drive the swing, arms held off the body"""
    p = {}
    legf = run_leg if run else walk_leg
    arm_amp, elbow_base, elbow_amp = (40, 85, 15) if run else (21, 18, 14)
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, .5)):
        tt = (t_ + ph) % 1
        hip, knee, ankle = legf(tt)
        p["thigh." + side] = rot("thigh." + side, (XA, hip), (YA, sgn * 1.5), (ZA, sgn * 4))
        p["shin." + side] = rot("shin." + side, (XA, knee))
        p["foot." + side] = rot("foot." + side, (XA, ankle), (ZA, sgn * 6))
        c = math.cos(2 * math.pi * (tt - .05))
        sw = arm_amp * c - (8 if run else 4)
        p["upper_arm." + side] = rot("upper_arm." + side, (YA, -sgn * (8 if run else 7)), (XA, sw), (ZA, -sgn * 6))
        el = -(elbow_base + elbow_amp * max(0.0, -math.cos(2 * math.pi * (tt - .12))))
        p["forearm." + side] = rot("forearm." + side, (XA, el), (ZA, -sgn * (14 if run else 10)))
        p["hand." + side] = rot("hand." + side, (XA, -8 if run else -4))
    c1, s1 = math.cos(2 * math.pi * t_), math.sin(2 * math.pi * t_)
    pelvis_rot = (6 if run else 3) * -c1
    oblique = (1.5 if run else 1.2) * -s1
    lean = 13 if run else 5
    p["hips"] = rot("hips", (ZA, pelvis_rot), (YA, oblique), (XA, lean * .3))
    p["spine"] = rot("spine", (XA, lean * .35), (ZA, -pelvis_rot * 1.0))
    p["chest"] = rot("chest", (XA, lean * .2 - (0 if run else 3)), (ZA, -pelvis_rot * 2.2 - (2 if run else 3) * c1), (YA, -oblique * 1.2))
    p["neck"] = rot("neck", (XA, -lean * .35 + 2), (ZA, pelvis_rot * 1.2))
    p["head"] = rot("head", (XA, -lean * .45 + (1.5 if not run else 2.5) * math.cos(4 * math.pi * t_)), (ZA, pelvis_rot * .8))
    hands(p, 45 if run else 22)
    z = .035 * math.cos(4 * math.pi * (t_ - .4)) - .055 if run else -.02 * math.cos(4 * math.pi * t_) - .016
    return p, ((.006 if run else .008) * s1, 0, z)


def idle(t_):
    s = math.sin(2 * math.pi * t_)
    s2 = math.sin(4 * math.pi * t_)
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        p["upper_arm." + side] = rot("upper_arm." + side, (YA, -sgn * (8 + 1.2 * s2)), (XA, -3), (ZA, -sgn * 8))
        p["forearm." + side] = rot("forearm." + side, (XA, -14 - 2 * s2), (ZA, -sgn * 10))
        p["hand." + side] = rot("hand." + side, (XA, -6))
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * 6), (XA, -1.5 * s * sgn))
        p["shin." + side] = rot("shin." + side, (XA, 4 + 1.5 * s * sgn))
        p["foot." + side] = rot("foot." + side, (XA, -3), (YA, sgn * 1.5), (ZA, sgn * 7))
    p["hips"] = rot("hips", (YA, 1.2 * s), (ZA, 2 * s))
    p["spine"] = rot("spine", (XA, -1.5 + .8 * s2))
    p["chest"] = rot("chest", (XA, -3 - 1.4 * s2), (ZA, -1.5 * s))
    p["neck"] = rot("neck", (XA, 2), (ZA, 3 * math.sin(2 * math.pi * t_ + .7)))
    p["head"] = rot("head", (XA, 1 + .8 * s2), (ZA, 6 * math.sin(2 * math.pi * t_ + 1.1)))
    hands(p, 20 + 4 * s2)
    return p, (.004 * s, 0, -.012 - .003 * abs(s2))


def guard_pose(bounce=0.0, lead=0.0, cross=0.0, recoil=0.0):
    """Orthodox guard (boxing basics): chin tucked, elbows low and in to cover the ribs,
    lead fist ~25cm in front of the face at cheek height, rear fist by the chin.
    lead/cross 0..1 drive the jab/cross straight down the centre line, the fist turning palm-down."""
    p = {}
    trunk = -24 + 44 * cross - 12 * lead
    hips_z, spine_z, chest_z = trunk * .45 + 6 * cross, trunk * .3, trunk * .35
    total = hips_z + spine_z + chest_z
    p["hips"] = rot("hips", (ZA, hips_z), (XA, 5))
    p["spine"] = rot("spine", (XA, 7 + 5 * cross + 3 * lead), (ZA, spine_z))
    p["chest"] = rot("chest", (XA, 5 - 12 * recoil), (ZA, chest_z))
    p["neck"] = rot("neck", (XA, 7 - 15 * recoil), (ZA, -total * .45))
    p["head"] = rot("head", (XA, 6 - 22 * recoil), (ZA, -total * .45))
    face_y = NOSE.y
    lead_w = V((.09, face_y - .27, EYE_Z - .18)).lerp(V((.015, face_y - .55, EYE_Z - .085)), lead)
    rear_w = V((-.095, face_y - .11, EYE_Z - .2)).lerp(V((.0, face_y - .55, EYE_Z - .085)), cross)
    p.update(arm_ik("L", to_torso(lead_w, total), to_torso(V((.32, -.05, BELT_Z + .05 + .3 * lead)), total), -78 * lead))
    p.update(arm_ik("R", to_torso(rear_w, total), to_torso(V((-.32, .02, BELT_Z + .05 + .3 * cross)), total), 78 * cross))
    p["thigh.L"] = rot("thigh.L", (XA, -20 - 6 * cross - 4 * lead), (ZA, 8))
    p["thigh.R"] = rot("thigh.R", (XA, 16 - 10 * cross), (ZA, -10), (YA, 14 * cross))
    p["shin.L"] = rot("shin.L", (XA, 24 + 4 * bounce + 6 * lead))
    p["shin.R"] = rot("shin.R", (XA, 20 + 4 * bounce + 10 * cross))
    p["foot.L"] = rot("foot.L", (XA, -6), (ZA, 15))
    p["foot.R"] = rot("foot.R", (XA, -6 + 22 * cross), (ZA, -25))
    hands(p, 96, 55)
    return p, (0, .02 + .05 * recoil - .06 * lead - .05 * cross, -.05 - .015 * bounce)


def guard(t_):
    return guard_pose(bounce=0.5 + 0.5 * math.sin(2 * math.pi * t_))


def env(t_, a, b, c):
    """0 -> 1 between a..b, then back to 0 by c"""
    if t_ < b:
        return smooth01(a, b, t_)
    return 1 - smooth01(b + (c - b) * .2, c, t_)


def punch_l(t_):
    return guard_pose(lead=env(t_, 0, .28, 1))


def punch_r(t_):
    return guard_pose(cross=env(t_, 0, .32, 1))


def hit(t_):
    r = math.exp(-((t_ - .22) / .16) ** 2)
    p, off = guard_pose(recoil=r)
    p["chest"] = p["chest"] @ rot("chest", (ZA, 14 * r), (YA, 8 * r))
    p["head"] = p["head"] @ rot("head", (ZA, 20 * r), (YA, 12 * r))
    hands(p, 96 - 50 * r, 55)
    return p, (off[0], off[1] + .06 * r, off[2])


def knockdown(t_):
    """stagger back, legs give way, land flat on the back with the arms thrown out"""
    s_back = smooth01(0, .25, t_)
    fall = smooth01(.2, .62, t_)
    bounce = .03 * math.exp(-((t_ - .7) / .05) ** 2)
    p = {}
    p["hips"] = rot("hips", (XA, -8 * s_back - 80 * fall), (ZA, 12 * s_back))
    p["spine"] = rot("spine", (XA, -10 * s_back + 4 * fall))
    p["chest"] = rot("chest", (XA, -12 * s_back + 6 * fall), (ZA, 10 * s_back))
    p["neck"] = rot("neck", (XA, -20 * s_back + 22 * fall))
    p["head"] = rot("head", (XA, -25 * s_back + 10 * fall), (ZA, 25 * fall))
    for side, sgn in (("L", 1), ("R", -1)):
        p["upper_arm." + side] = rot("upper_arm." + side, (YA, -sgn * (35 * s_back + 40 * fall)), (XA, -60 * s_back + 40 * fall))
        p["forearm." + side] = rot("forearm." + side, (XA, -40 * s_back + 25 * fall))
        lead = side == "L"
        p["thigh." + side] = rot("thigh." + side, (XA, (20 if lead else -15) * s_back * (1 - fall) - 10 * fall * (1 if lead else .3)), (ZA, sgn * 10 * fall))
        p["shin." + side] = rot("shin." + side, (XA, 45 * math.sin(math.pi * min(1, t_ / .65)) + (25 if lead else 5) * fall))
        p["foot." + side] = rot("foot." + side, (XA, 20 * fall), (ZA, sgn * 15))
    hands(p, 30)
    hip_h = REST["hips"][0].z
    return p, (0, .1 * s_back + .48 * fall, -(hip_h - .13) * fall + bounce)


def roll(t_):
    """combat roll (dodge): dip, tuck into a ball, roll forward over the shoulders and come up
    in a low crouch. The hips joint is the centre of the roll; the game supplies the travel."""
    tuck = smooth01(0, .2, t_) * (1 - smooth01(.74, 1, t_))
    spin = 360 * smooth01(.12, .8, t_)
    p = {}
    p["hips"] = rot("hips", (XA, spin), (YA, 8 * tuck))
    p["spine"] = rot("spine", (XA, 28 * tuck))
    p["chest"] = rot("chest", (XA, 24 * tuck), (ZA, -6 * tuck))
    p["neck"] = rot("neck", (XA, 24 * tuck))
    p["head"] = rot("head", (XA, 18 * tuck))
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (XA, -110 * tuck - 10 * (1 - tuck) * smooth01(.8, 1, t_)), (ZA, sgn * 9 * tuck))
        p["shin." + side] = rot("shin." + side, (XA, 128 * tuck))
        p["foot." + side] = rot("foot." + side, (XA, 25 * tuck))
        p["upper_arm." + side] = rot("upper_arm." + side, (XA, -55 * tuck), (YA, -sgn * (14 * tuck + 6)), (ZA, -sgn * 10 * tuck))
        p["forearm." + side] = rot("forearm." + side, (XA, -105 * tuck), (ZA, -sgn * 12 * tuck))
        p["hand." + side] = rot("hand." + side, (XA, -10 * tuck))
    hands(p, 70 * tuck + 20)
    hip_h = REST["hips"][0].z
    # hip height over the contact point as the ball turns: head/shoulders (90), upper back (180),
    # seat (270), back onto the feet (360)
    table = ((0, .56), (90, .46), (180, .3), (270, .2), (330, .42), (360, .56))
    for (a0, h0), (a1, h1) in zip(table, table[1:]):
        if spin <= a1:
            h = h0 + (h1 - h0) * (spin - a0) / (a1 - a0)
            break
    return p, (0, 0, (h - hip_h) * tuck)


def drive(t_):
    s = math.sin(2 * math.pi * t_)
    p = {
        "hips": rot("hips", (XA, -24)),
        "spine": rot("spine", (XA, 5 + .6 * s)),
        "chest": rot("chest", (XA, 4 - .6 * s)),
        "neck": rot("neck", (XA, 9)),
        "head": rot("head", (XA, 7)),
        # legs stretched out to the pedals: knees a little up, feet resting above the cabin floor
        "thigh.L": rot("thigh.L", (XA, -72), (ZA, 7), (YA, -4)),
        "thigh.R": rot("thigh.R", (XA, -74), (ZA, -7), (YA, 4)),
        "shin.L": rot("shin.L", (XA, 34)),
        "shin.R": rot("shin.R", (XA, 30)),
        "foot.L": rot("foot.L", (XA, 8)),
        "foot.R": rot("foot.R", (XA, 10)),
        "upper_arm.L": rot("upper_arm.L", (XA, -56), (YA, 8), (ZA, -12)),
        "upper_arm.R": rot("upper_arm.R", (XA, -56), (YA, -8), (ZA, 12)),
        "forearm.L": rot("forearm.L", (XA, -36), (ZA, -10)),
        "forearm.R": rot("forearm.R", (XA, -36), (ZA, 10)),
        "hand.L": rot("hand.L", (YA, 20)),
        "hand.R": rot("hand.R", (YA, -20)),
    }
    hands(p, 70, 30)
    return p, (0, 0, 0)


def jump(t_):
    s = math.sin(2 * math.pi * t_)
    p = {
        "thigh.L": rot("thigh.L", (XA, -48 - 4 * s), (ZA, 4)), "shin.L": rot("shin.L", (XA, 62 + 4 * s)), "foot.L": rot("foot.L", (XA, 18)),
        "thigh.R": rot("thigh.R", (XA, 14 + 3 * s), (ZA, -4)), "shin.R": rot("shin.R", (XA, 55)), "foot.R": rot("foot.R", (XA, 25)),
        "upper_arm.L": rot("upper_arm.L", (YA, -28), (XA, 25 + 4 * s)), "upper_arm.R": rot("upper_arm.R", (YA, 28), (XA, -40 - 4 * s)),
        "forearm.L": rot("forearm.L", (XA, -40)), "forearm.R": rot("forearm.R", (XA, -55)),
        "spine": rot("spine", (XA, 8)), "chest": rot("chest", (XA, 4), (ZA, -6)), "head": rot("head", (XA, -8)),
    }
    hands(p, 35)
    return p, (0, 0, 0)


def apply_pose(pose):
    for pb in pbones:
        pb.rotation_quaternion = pose.get(pb.name, Quaternion())
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def aim_pose(pose, bone, direction, roll=0.0):
    """rotate `bone` (its parents already posed) so it points along `direction` (armature space);
    roll: extra twist in degrees about the bone's own axis"""
    pose[bone] = Quaternion()
    apply_pose(pose)
    M = pbones[bone].matrix.to_3x3()
    cur = V(M.col[1]).normalized()
    R = cur.rotation_difference(V(direction).normalized()).to_matrix()
    q = (M.inverted() @ R @ M).to_quaternion()
    if roll:
        q = q @ Quaternion((0, 1, 0), math.radians(roll))
    pose[bone] = q


def solve_chain(pose, upper, lower, end, target, pole, end_dir=None, roll=(0.0, 0.0, 0.0)):
    """two-bone IK on the posed skeleton: `end` bone's head lands on target, the middle joint
    bends toward pole; then the end bone is aimed along end_dir"""
    apply_pose(pose)
    S = pbones[upper].head.copy()
    a = (REST[upper][1] - REST[upper][0]).length
    b = (REST[lower][1] - REST[lower][0]).length
    T, P = V(target), V(pole)
    d = min(max((T - S).length, .05), (a + b) * .999)
    dn = (T - S).normalized()
    al = math.acos(max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d))))
    perp = (P - S) - dn * (P - S).dot(dn)
    perp.normalize()
    E = S + dn * (a * math.cos(al)) + perp * (a * math.sin(al))
    aim_pose(pose, upper, E - S, roll[0])
    aim_pose(pose, lower, (S + dn * d) - E, roll[1])
    if end_dir is not None:
        aim_pose(pose, end, end_dir, roll[2])


HIPS0 = REST["hips"][0].copy()
SEAT_GRIP = ((.36, -.52, .20), (-.36, -.52, .20))  # relative to the hips joint
SEAT_PEG = ((.19, .06, -.46), (-.19, .06, -.46))
_ride_cache = {}


def ride(t_):
    """sitting on the motorbike: the hips joint is the seat point; hands on the grips,
    feet on the pegs, leaning forward ~25 degrees, head up"""
    s = math.sin(2 * math.pi * t_)
    key = round(s, 3)
    if key in _ride_cache:
        return _ride_cache[key]
    p = {
        "hips": rot("hips", (XA, 10)),
        "spine": rot("spine", (XA, 11 + .8 * s)),
        "chest": rot("chest", (XA, 9 - .6 * s)),
        "neck": rot("neck", (XA, -14)),
        "head": rot("head", (XA, -14)),
    }
    for sfx, sgn, grip, peg in ((".L", 1, SEAT_GRIP[0], SEAT_PEG[0]), (".R", -1, SEAT_GRIP[1], SEAT_PEG[1])):
        g_ = HIPS0 + V(grip)
        hand_dir = V((sgn * .25, -.85, -.45)).normalized()
        wrist = g_ - hand_dir * .07 + V((sgn * .012, 0, .0))
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    HIPS0 + V((sgn * .55, .05, .05)), hand_dir, roll=(0, -sgn * 35, -sgn * 40))
        ankle = HIPS0 + V(peg)
        solve_chain(p, "thigh" + sfx, "shin" + sfx, "foot" + sfx, ankle,
                    HIPS0 + V((sgn * .1, -.9, .15)), V((sgn * .08, -1, -.18)))
    hands(p, 72, 45)
    _ride_cache[key] = (p, (0, 0, 0))
    return p, (0, 0, 0)


def hands_up(t_):
    """surrender: hands raised beside the head, palms forward, fingers spread"""
    s = math.sin(2 * math.pi * t_)
    p = {
        "spine": rot("spine", (XA, -2 + .6 * s)),
        "chest": rot("chest", (XA, -3 - .6 * s)),
        "neck": rot("neck", (XA, 3)),
        "head": rot("head", (XA, 4), (ZA, 4 * math.sin(2 * math.pi * t_ + .8))),
    }
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * 6))
        p["foot." + side] = rot("foot." + side, (ZA, sgn * 7))
    for sfx, sgn in ((".L", 1), (".R", -1)):
        wrist = V((sgn * .25, NOSE.y + .07, EYE_Z + .01 + .006 * s))
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sgn * .6, .1, NECK_Z - .15)), V((sgn * .05, -.12, 1)), roll=(0, 0, HANDSUP_ROLL * sgn))
    hands(p, 6)
    return p, (0, 0, 0)


HANDSUP_ROLL = 0.0


# ---------------------------------------------------------------- getting into cars
# The game stands the hero at the driver door facing the car. Car front is then on his LEFT
# (+X), the door handle ~0.55 m ahead and 0.15 m to the left at hip height; the door hinges
# 0.65 m to the left and its handle swings out towards him as it opens.
DOOR_CACHE = {}


def reach(p, sfx, sgn, target, hand_dir, out=.55, roll_=0.0):
    solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, HIPS0 + V(target),
                HIPS0 + V((sgn * out, .3, .15)), V(hand_dir).normalized(), roll=(0, 0, roll_))


def open_door(t_):
    """left hand to the handle, then pull the door open along its arc, leaning back a little"""
    key = round(t_, 3)
    if key in DOOR_CACHE.setdefault("od", {}):
        return DOOR_CACHE["od"][key]
    p, _ = idle(0.0)
    p = dict(p)
    a = smooth01(0, .3, t_)  # reach
    th = 1.15 * smooth01(.3, .85, t_)  # door angle
    # handle on its arc (car offsets mapped to the hero's armature frame)
    hx, hy = .65 - .5 * math.cos(th), -.55 + .5 * math.sin(th)
    rest = V((.22, -.05, -.2))
    reach(p, ".L", 1, rest.lerp(V((hx + .03, hy + .06, -.04)), a), (.2, -1, -.2), roll_=20)
    lean = smooth01(.3, .7, t_) * (1 - smooth01(.85, 1, t_))
    p["spine"] = rot("spine", (XA, 4 * a - 5 * lean), (ZA, -6 * a))
    p["chest"] = rot("chest", (XA, -3), (ZA, -8 * a - 6 * lean))
    p["head"] = rot("head", (XA, 6 * a), (ZA, 10 * a))
    p["thigh.L"] = rot("thigh.L", (XA, -8 * lean), (ZA, 6 + 8 * lean))
    hands(p, 20 + 60 * smooth01(.22, .32, t_))
    DOOR_CACHE["od"][key] = (p, (0, .04 * lean, -.015))
    return p, (0, .04 * lean, -.015)


def get_in(t_):
    """from standing at the open door to sitting at the wheel: step in, duck under the roof, sit.
    The game turns and carries the body from the door to the seat during the clip."""
    key = round(t_, 3)
    if key in DOOR_CACHE.setdefault("gi", {}):
        return DOOR_CACHE["gi"][key]
    a, _ = idle(0.0)
    b, _ = drive(0.0)
    s = smooth01(.2, .85, t_)
    p = {}
    for name in set(a) | set(b):
        qa, qb = a.get(name, Quaternion()), b.get(name, Quaternion())
        p[name] = qa.slerp(qb, s)
    duck = bump(t_, .5, .16)
    step = bump(t_, .32, .12)
    p["spine"] = p["spine"] @ rot("spine", (XA, 26 * duck))
    p["chest"] = p["chest"] @ rot("chest", (XA, 12 * duck))
    p["neck"] = p.get("neck", Quaternion()) @ rot("neck", (XA, 14 * duck))
    p["thigh.L"] = p["thigh.L"] @ rot("thigh.L", (XA, -55 * step))
    p["shin.L"] = p["shin.L"] @ rot("shin.L", (XA, 70 * step))
    hands(p, 30 + 40 * s)
    DOOR_CACHE["gi"][key] = (p, (0, 0, -.12 * duck))
    return p, (0, 0, -.12 * duck)


def jack_pull(t_):
    """reach into the car with both hands, grab the driver and yank him out behind you"""
    key = round(t_, 3)
    if key in DOOR_CACHE.setdefault("jp", {}):
        return DOOR_CACHE["jp"][key]
    p, _ = idle(0.0)
    p = dict(p)
    r = smooth01(0, .3, t_) * (1 - smooth01(.36, .62, t_))
    y = smooth01(.36, .62, t_) * (1 - smooth01(.8, 1, t_))
    into, back = V((.0, -.78, .2)), V((-.42, .25, .05))
    for sfx, sgn in ((".L", 1), (".R", -1)):
        rest = V((sgn * .22, -.05, -.2))
        tgt = rest.lerp(into + V((sgn * .12, 0, 0)), r) + (back + V((sgn * .1, 0, 0)) - rest) * y
        reach(p, sfx, sgn, tgt, (sgn * .1, -1, 0), roll_=-sgn * 40)
    p["spine"] = rot("spine", (XA, 18 * r - 6 * y), (ZA, 14 * y))
    p["chest"] = rot("chest", (XA, 10 * r - 4 * y), (ZA, 22 * y))
    p["neck"] = rot("neck", (ZA, -10 * y))
    p["thigh.R"] = rot("thigh.R", (XA, 18 * y), (ZA, -8))
    p["thigh.L"] = rot("thigh.L", (XA, -14 * r), (ZA, 8))
    p["shin.L"] = rot("shin.L", (XA, 18 * r))
    hands(p, 30 + 65 * smooth01(.28, .36, t_))
    DOOR_CACHE["jp"][key] = (p, (0, -.12 * r + .1 * y, -.03 * r))
    return p, (0, -.12 * r + .1 * y, -.03 * r)


# ---------------------------------------------------------------- conversation (story cutscenes)
# Seated clips: hips joint ~0.1 m above a 0.47 m chair seat, table top 0.91 m (0.34 above the hips).
# The game places the body; these clips only bend it. Hands are solved with IK onto the table.
TALK_CACHE = {}


def seated_base(p, lean):
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (XA, -86), (ZA, sgn * 7), (YA, -sgn * 3))
        p["shin." + side] = rot("shin." + side, (XA, 84))
        p["foot." + side] = rot("foot." + side, (XA, -4), (ZA, sgn * 6))
    p["hips"] = rot("hips", (XA, -4))
    p["spine"] = rot("spine", (XA, 6 + lean * .5))
    p["chest"] = rot("chest", (XA, 4 + lean * .5))


def table_hand(p, sfx, sgn, lift, out, palm_up):
    """IK the hand onto the table top (lift 0) or up into a gesture (lift 1)"""
    rest = HIPS0 + V((sgn * .16, -.44, .31))
    gest = HIPS0 + V((sgn * (.2 + .05 * out), -.44, .5))
    wrist = rest.lerp(gest, lift)
    hand_dir = V((sgn * .15, -1, -.35 + .5 * lift)).normalized()
    solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                HIPS0 + V((sgn * .55, .25, .1)), hand_dir, roll=(0, 0, -sgn * (20 + 70 * palm_up)))


def sit_talk(t_):
    """talking at a table: leans in, the right hand comes up to make a point, then the left"""
    key = round(t_, 3)
    if key in TALK_CACHE.get("st", {}):
        return TALK_CACHE["st"][key]
    a = math.sin(2 * math.pi * t_)
    gR = bump(t_, .3, .14)  # right-hand gesture
    gL = bump(t_, .72, .12)  # left-hand gesture
    p = {}
    seated_base(p, 8 + 4 * max(gR, gL))
    p["chest"] = p["chest"] @ rot("chest", (ZA, 6 * gR - 6 * gL))
    p["neck"] = rot("neck", (XA, 4 + 3 * a), (ZA, -4 * gR + 4 * gL))
    p["head"] = rot("head", (XA, 3 + 5 * math.sin(4 * math.pi * t_)), (ZA, 5 * math.sin(2 * math.pi * t_ + .6)))
    table_hand(p, ".L", 1, gL, .5, gL)
    table_hand(p, ".R", -1, gR, .8, gR)
    hands(p, 30 - 20 * max(gR, gL))
    TALK_CACHE.setdefault("st", {})[key] = (p, (0, 0, 0))
    return p, (0, 0, 0)


def sit_listen(t_):
    """listening at a table: forearms on the table, hands loosely together, slow nods"""
    key = round(t_, 3)
    if key in TALK_CACHE.get("sl", {}):
        return TALK_CACHE["sl"][key]
    nod = bump(t_, .25, .06) + bump(t_, .33, .05) + .6 * bump(t_, .75, .07)
    p = {}
    seated_base(p, 5 + 1.5 * math.sin(2 * math.pi * t_))
    p["neck"] = rot("neck", (XA, 3 + 7 * nod))
    p["head"] = rot("head", (XA, 2 + 8 * nod), (ZA, 4 * math.sin(2 * math.pi * t_)))
    table_hand(p, ".L", 1, 0, 0, 0)
    table_hand(p, ".R", -1, 0, 0, 0)
    hands(p, 35)
    TALK_CACHE.setdefault("sl", {})[key] = (p, (0, 0, 0))
    return p, (0, 0, 0)


def stand_talk(t_):
    """standing, talking with the hands: weight shifts, both hands work in front of the chest"""
    key = round(t_, 3)
    if key in TALK_CACHE.get("tt", {}):
        return TALK_CACHE["tt"][key]
    s = math.sin(2 * math.pi * t_)
    gR, gL = bump(t_, .25, .15), bump(t_, .65, .15)
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * 6), (XA, -2 * s * sgn))
        p["shin." + side] = rot("shin." + side, (XA, 4 + 2 * s * sgn))
        p["foot." + side] = rot("foot." + side, (XA, -3), (ZA, sgn * 7))
    p["hips"] = rot("hips", (YA, 2 * s), (ZA, 3 * s))
    p["spine"] = rot("spine", (XA, 2 + 3 * max(gR, gL)))
    p["chest"] = rot("chest", (XA, -2), (ZA, 7 * gR - 7 * gL))
    p["neck"] = rot("neck", (XA, 3), (ZA, -5 * gR + 5 * gL))
    p["head"] = rot("head", (XA, 2 + 4 * math.sin(4 * math.pi * t_)), (ZA, 4 * s))
    for sfx, sgn, g in ((".L", 1, gL), (".R", -1, gR)):
        low = V((sgn * .2, -.12, BELT_Z - .12))
        high = V((sgn * (.22 + .1 * g), -.36, BELT_Z + .3))
        wrist = low.lerp(high, .25 + .75 * g)
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sgn * .6, .3, BELT_Z + .2)), V((sgn * .3, -1, .1 + .6 * g)).normalized(), roll=(0, 0, -sgn * (30 + 50 * g)))
    hands(p, 30 - 22 * max(gR, gL))
    TALK_CACHE.setdefault("tt", {})[key] = (p, (.004 * s, 0, -.01))
    return p, (.004 * s, 0, -.01)


def stand_listen(t_):
    """standing and listening: arms folded across the chest, weight on one leg, nodding"""
    key = round(t_, 3)
    if key in TALK_CACHE.get("tl", {}):
        return TALK_CACHE["tl"][key]
    s = math.sin(2 * math.pi * t_)
    nod = bump(t_, .3, .06) + .7 * bump(t_, .7, .07)
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * (8 if side == "L" else 3)))
        p["shin." + side] = rot("shin." + side, (XA, 3 if side == "L" else 9))
        p["foot." + side] = rot("foot." + side, (XA, -3), (ZA, sgn * 7))
    p["hips"] = rot("hips", (ZA, 4), (YA, 3 + s))
    p["spine"] = rot("spine", (XA, -2), (YA, -2))
    p["chest"] = rot("chest", (XA, -4 + .8 * s))
    p["neck"] = rot("neck", (XA, 2 + 7 * nod))
    p["head"] = rot("head", (XA, 2 + 8 * nod), (ZA, -5))
    # hands loosely clasped in front of the belt
    for sfx, sgn in ((".L", 1), (".R", -1)):
        wrist = V((sgn * .07, -.2, BELT_Z - .16 + .005 * s))
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sgn * .5, .2, BELT_Z + .1)), V((-sgn * .6, -.5, -.6)).normalized(), roll=(0, 0, -sgn * 10))
    hands(p, 40)
    TALK_CACHE.setdefault("tl", {})[key] = (p, (0, 0, -.01))
    return p, (0, 0, -.01)


def make_action(name, frames, fn, step=1):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(0, frames + 1, step):
        pose, off = fn(f / frames)
        key_pose(f, pose, off)
    return act


# ================================================================ weapons
# models + grip maths live in build_weapons.py; each gun is parented to hand.R (not skinned),
# with Muzzle_*/Grip2_* empties under it. The game shows one gun at a time.
sys.path.insert(0, os.path.join(ROOT, "blender"))
import build_weapons as BW

GUNS = ("pistol", "smg", "shotgun") if HERO else ("pistol",) if POLICE else ()
WH = BW.Holder(globals())
if GUNS:
    WM = BW.materials()
    for key in GUNS:
        gun, ginfo = BW.BUILDERS[key](WM)
        WH.attach(gun, ginfo, key)

rig.animation_data_create()
actions = []
if HERO or PREVIEW:
    actions = [
        make_action("Idle", 120, idle, 4),
        make_action("Walk", 34, lambda t_: gait(t_, False), 1),
        make_action("Run", 22, lambda t_: gait(t_, True), 1),
        make_action("Jump", 40, jump, 4),
        make_action("Drive", 90, drive, 6),
        make_action("Guard", 36, guard, 3),
        make_action("PunchL", 12, punch_l, 1),
        make_action("PunchR", 15, punch_r, 1),
        make_action("Hit", 16, hit, 1),
        make_action("KnockDown", 42, knockdown, 1),
        make_action("Ride", 72, ride, 6),
        make_action("HandsUp", 60, hands_up, 6),
        make_action("Roll", 24, roll, 1),
        make_action("SitTalk", 120, sit_talk, 3),
        make_action("SitListen", 120, sit_listen, 4),
        make_action("StandTalk", 120, stand_talk, 3),
        make_action("StandListen", 120, stand_listen, 4),
        make_action("OpenDoor", 27, open_door, 1),
        make_action("GetIn", 33, get_in, 1),
        make_action("JackPull", 30, jack_pull, 1),
    ]
    # PistolHold/Aim, SMGHold/Aim, ShotgunHold/Aim for the guns this variant carries
    actions += [make_action(*a) for a in BW.define_actions(WH, globals())]
for act in actions:
    track = rig.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, 0, act)
rig.animation_data.action = None
for pb in pbones:
    pb.rotation_quaternion = Quaternion()
    pb.location = (0, 0, 0)

# ================================================================ export
out_name = {"hero": "protagonist", "male": "npc_male", "female": "npc_female", "police": "npc_police"}[VARIANT]
os.makedirs(os.path.join(ROOT, "assets", "models"), exist_ok=True)
glb = os.path.join(ROOT, "assets", "models", out_name + ".glb")
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", export_animations=HERO, export_animation_mode="NLA_TRACKS",
    export_skins=True, export_yup=True, export_apply=False, export_image_format="WEBP", export_vertex_color="ACTIVE",
)
print("EXPORTED", glb)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", out_name + ".blend"))

# ================================================================ preview renders
if PREVIEW:
    out = ARGS[ARGS.index("--preview") + 1]
    os.makedirs(out, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 520, 720
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 70
    HZ = H / 1.8

    def shoot(fname, track, frame, loc, target=(0, 0, .95)):
        for tr in rig.animation_data.nla_tracks:
            tr.mute = tr.name != track
        scene.frame_set(frame)
        cam.location = loc
        cam.rotation_euler = (V(target) - V(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, f"{VARIANT}_{fname}")
        bpy.ops.render.render(write_still=True)

    def show_gun(key):
        for k in GUNS:
            bpy.data.objects["Weapon_" + BW.NAMES[k]].hide_render = k != key

    show_gun("pistol" if POLICE else None)
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
    scene.frame_set(0)
    cam.location = (0, -5.5, .95)
    cam.rotation_euler = (V((0, 0, .9)) - V(cam.location)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out, f"{VARIANT}_rest.png")
    bpy.ops.render.render(write_still=True)
    shoot("idle_34.png", "Idle", 30, (3.4, -3.8, 1.5), (0, 0, .9))
    scene.display.shading.color_type = "VERTEX"
    shoot("face_paint.png", "Idle", 0, (0.3, -1.0, EYE_Z + .02), (0, 0, EYE_Z - .02))
    scene.display.shading.color_type = "TEXTURE"
    shoot("face.png", "Idle", 0, (0.3, -1.0, EYE_Z + .02), (0, 0, EYE_Z - .02))
    shoot("back.png", "Idle", 0, (-1.6, 3.0, 1.6), (0, 0, 1.1))
    if HERO:
        shoot("walk_09.png", "Walk", 9, (4.0, -2.5, 1.1))
        shoot("guard.png", "Guard", 0, (2.2, -2.6, 1.4), (0, 0, 1.15))
        shoot("guard_hands.png", "Guard", 0, (0.6, -1.2, 1.45), (0, -.2, 1.35))
        shoot("fist_front.png", "Guard", 0, (-0.15, -1.0, 1.5), (0, -.3, 1.42))
        shoot("punchL.png", "PunchL", 3, (3.0, -1.2, 1.3), (0, -.2, 1.1))
        shoot("punchR.png", "PunchR", 5, (3.0, -1.2, 1.3), (0, -.2, 1.1))
        shoot("ko_end.png", "KnockDown", 42, (3.5, -1.5, 1.4), (0, .4, .2))
        for fr in (4, 8, 11, 14, 18, 22):
            shoot(f"roll_{fr:02d}.png", "Roll", fr, (3.6, -.4, 1.0), (0, 0, .55))
        for clip_, fr in (("OpenDoor", 8), ("OpenDoor", 22), ("GetIn", 16), ("GetIn", 30), ("JackPull", 9), ("JackPull", 18)):
            shoot(f"{clip_.lower()}_{fr}_34.png", clip_, fr, (-2.2, -2.6, 1.5), (0, -.2, .95))
        for clip_, fr in (("SitTalk", 36), ("SitTalk", 87), ("SitListen", 30), ("StandTalk", 30), ("StandListen", 36)):
            shoot(f"{clip_.lower()}_{fr}_34.png", clip_, fr, (2.2, -2.6, 1.5), (0, -.2, .95))
            shoot(f"{clip_.lower()}_{fr}_side.png", clip_, fr, (3.0, -.3, 1.2), (0, -.2, .9))
        shoot("drive.png", "Drive", 0, (3.4, -3.0, 1.3), (0, 0, .8))
        shoot("handsup.png", "HandsUp", 0, (0.6, -3.2, 1.4), (0, 0, 1.2))
        shoot("handsup_34.png", "HandsUp", 0, (2.2, -2.2, 1.6), (0, 0, 1.35))
        for key in GUNS:
            show_gun(key)
            for act in (BW.NAMES[key] + "Aim", BW.NAMES[key] + "Hold"):
                shoot(act.lower() + "_34.png", act, 0, (-1.6, -2.4, 1.6), (0, -.25, 1.3))
                shoot(act.lower() + "_side.png", act, 0, (2.2, -.35, 1.45), (0, -.35, 1.3))
        show_gun(None)
        # placeholder bike contact points (preview only, after export)
        marks = []
        for g_ in SEAT_GRIP:
            bpy.ops.mesh.primitive_cylinder_add(radius=.017, depth=.13, location=HIPS0 + V(g_), rotation=(0, math.pi / 2, 0))
            marks.append(bpy.context.active_object)
        for pg in SEAT_PEG:
            bpy.ops.mesh.primitive_cube_add(size=1, location=HIPS0 + V(pg) + V((0, -.02, -.06)), scale=(.08, .03, .015))
            marks.append(bpy.context.active_object)
        bpy.ops.mesh.primitive_cube_add(size=1, location=HIPS0 + V((0, .05, -.06)), scale=(.22, .45, .05))
        marks.append(bpy.context.active_object)
        hz = HIPS0.z
        shoot("ride_side.png", "Ride", 0, (3.2, -.3, hz + .1), (0, -.2, hz - .05))
        shoot("ride_34.png", "Ride", 0, (2.0, -2.6, hz + .5), (0, -.2, hz))
        shoot("ride_front.png", "Ride", 0, (0.3, -3.0, hz + .3), (0, -.2, hz))
        shoot("ride_hands.png", "Ride", 0, (.9, -1.3, hz + .45), (0, -.45, hz + .2))
