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
import bpy, bmesh, math, sys, os, json
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from mathutils import noise as mnoise
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = os.path.abspath(ARGS[0]) if ARGS else os.getcwd()
VARIANT = ARGS[ARGS.index("--variant") + 1] if "--variant" in ARGS else "hero"
PREVIEW = "--preview" in ARGS
HERO, FEMALE, POLICE = VARIANT == "hero", VARIANT == "female", VARIANT == "police"
MALE = VARIANT in ("male", "police")  # the police officer is the male NPC in uniform
# CC0 MakeHuman outfits (vendor/makehuman, see README): street peds carry several, one shown per ped;
# everybody wears MakeHuman shoes. The hero keeps his tank top and jeans, the officer his uniform.
MH_OUTFITS = {"male": ["male_casualsuit03", "male_casualsuit04", "male_casualsuit05", "male_casualsuit06", "male_elegantsuit01"],
              "female": ["female_casualsuit01", "female_casualsuit02", "female_elegantsuit01", "female_sportsuit01"]}.get(VARIANT, [])
MH_SHOES = {"hero": ["shoes05"], "police": ["shoes04"]}.get(VARIANT, ["shoes01", "shoes02", "shoes03", "shoes04", "shoes05", "shoes06"])
if "--outfit" in ARGS:  # preview a single outfit (and the first shoes)
    MH_OUTFITS = [ARGS[ARGS.index("--outfit") + 1]]
    MH_SHOES = MH_SHOES[:1]
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
    tcomp = min(comps0, key=len) if len(comps0) >= 2 else None
    if tcomp is None:
        # a lighter mesh: the thumb doesn't come away as its own piece past the knuckles. It is the
        # part of the hand out on the front side (the arms hang with the thumbs forward)
        tsign = -float(np.sign(lat.y)) or 1.0
        cand = hand_zone & (lat_d * tsign > .03) & (ax_d < .06) & (ax_d > -.075)
        tcomp = np.where(cand)[0] if cand.sum() > 8 else None
    if tcomp is not None:
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
# the hero's dense mesh: bone heat (every finger has its own chain); the lighter NPC bodies:
# bone heat leaves most of their fingers on the palm bone (they wouldn't curl), so they get
# the measured hand weights
HAND_WEIGHTS = "--handweights" in ARGS or not HERO
for vi, ws in (FW.items() if HAND_WEIGHTS else ()):
    for g_ in body.vertex_groups:
        g_.remove([vi])
    for n_, w_ in ws.items():
        if w_ > 1e-4:
            body.vertex_groups[n_].add([vi], w_, "REPLACE")
print("GROUPS", len(body.vertex_groups), "hand verts", len(FW))

# the back and the chest stay on the chest bone: bone heat lets the upper-arm bones pull skin
# from between the shoulder blades (and off the pecs), so with the arms out in front (aiming,
# punching) the back caved in. Inward of the shoulder joint the upper arm's share goes over to the
# chest, fading in over the first few centimetres (more on the back than in front).
_chest = body.vertex_groups["chest"]
_moved = 0
for s_, sfx_ in ((1, ".L"), (-1, ".R")):
    S_ = BONES["upper_arm" + sfx_][0]
    ua_ = body.vertex_groups["upper_arm" + sfx_]
    for v_ in body.data.vertices:
        co = v_.co
        if co.x * s_ <= 0 or co.z > S_.z + .1 or co.z < S_.z - .32:
            continue
        inward = (S_.x - co.x) * s_  # > 0: nearer the spine than the shoulder joint
        if inward < -.005:
            continue
        try:
            w_ = ua_.weight(v_.index)
        except RuntimeError:
            continue
        if w_ <= 0:
            continue
        back = co.y > S_.y  # (the front is -y)
        k_ = _sm(-.005, .07, inward) * (.9 if back else .65)
        if k_ <= 0:
            continue
        move = w_ * k_
        ua_.add([v_.index], w_ - move, "REPLACE")
        try:
            cw = _chest.weight(v_.index)
        except RuntimeError:
            cw = 0.0
        _chest.add([v_.index], cw + move, "REPLACE")
        _moved += 1
print("SHOULDER BLADES", _moved, "verts eased onto the chest")

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
UV_NAME = body.data.uv_layers.active.name if body.data.uv_layers.active else "UVMap"


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
    # same UV layer name as the body: the join matches layers by name, a stray "UVMap"
    # would be dropped and every part built from scratch would lose its texture coordinates
    if len(me.uv_layers) == 1:
        me.uv_layers[0].name = UV_NAME
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
    front, side, back = (.072, -.04, -.085) if FEMALE else (.056, .02, -.07)
    if az < 1.2:
        tz = front + (side - front) * max(0, min(1, (az - .5) / .7))
    else:
        tz = side + (back - side) * max(0, min(1, (az - 1.5) / 1.1))
    f = rel.z / SCALE - tz
    ear_top = .02 if FEMALE else .095
    if abs(rel.x) > .062 * SCALE and -.08 < rel.z / SCALE < ear_top and -.03 < rel.y / SCALE < .06:
        f = min(f, -.02)  # keep the ears clear
    return f


def beard_mask(p, n):
    """short beard: jaw, chin and upper lip, fading up the cheeks (0 for women)"""
    if FEMALE:
        return 0.0
    front = sm(-.1, -.4, n.y)
    jaw = sm(MOUTH_Z + .03 * SCALE, MOUTH_Z + .004 * SCALE, p.z) * sm(.35, .0, n.y) * sm(EYE_Z - .2 * SCALE, EYE_Z - .17 * SCALE, p.z)
    lip = sm(.03 * SCALE, .022 * SCALE, abs(p.x)) * math.exp(-((p.z - (MOUTH_Z + .012 * SCALE)) / (.004 * SCALE)) ** 2) * front
    return max(jaw, lip)


def face_paint(v):
    p, n = v.co, v.normal
    if p.z < EYE_Z - .16 * SCALE:
        return V((1, 1, 1)), 0.0
    front = sm(-.1, -.4, n.y)
    hair = sm(-.003, .008, hair_field(p))
    u = (abs(p.x) - EYE_X * .98) / (.024 * SCALE)
    zc = EYE_Z + (.018 + .004 * (1 - u * u) - (.003 * u if not FEMALE else 0)) * SCALE
    brow = math.exp(-((p.z - zc) / ((.0028 if FEMALE else .0038) * SCALE * (1 - .4 * min(1, u * u)))) ** 2) * sm(1.15, .8, abs(u)) * front
    beard = (.75 if HERO else .55) * beard_mask(p, n)
    e = (p.x / (.025 * SCALE)) ** 2 + ((p.z - MOUTH_Z) / (.0098 * SCALE)) ** 2
    lips = sm(1.2, .75, e) * front * (1 if p.y < NOSE.y + .04 else 0)
    c = V((1, 1, 1)).lerp(LIP_TINT, lips)
    dark = max(hair * .8, brow * .85, beard * .45)
    return c.lerp(HAIR_TINT, dark), hair


def in_head(p):
    """the head by position, not by dominant bone: the base mesh weights some temple and
    scalp vertices to other head bones, which used to leave bald patches"""
    return abs(p.x) < .14 * SCALE and p.z > EYE_Z - .16 * SCALE


SKIN_I = mat_index("skin")
PAINTED = [0]
cl = bm.loops.layers.color.get("Col")
HAIRV = {}
HAIRF = {}
for v in bm.verts:
    if in_head(v.co):
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
CLOTH_PARTS = {}
CLOTH_RIM = {}


def smooth_rim(sb, n=10):
    """plane cuts through the body mesh leave a sawtooth edge: run it along its own loop"""
    rim = [v for v in sb.verts if v.is_boundary]
    for _ in range(n):
        new = {}
        for v in rim:
            nb = [o for e in v.link_edges if e.is_boundary for o in e.verts if o is not v]
            if len(nb) == 2:
                new[v] = v.co * .5 + (nb[0].co + nb[1].co) * .25
        for v, c in new.items():
            v.co = c


def garment(name, pick, key, loose, planes=(), keep=None, smooth=14, thick=.0045, folds=None, post=None):
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
    if post:
        post(sb)
    smooth_rim(sb)
    CLOTH_RIM[name] = [v.co.copy() for v in sb.verts if v.is_boundary]
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
if not MH_OUTFITS and not HERO:
    garment("Jeans", lambda f: base(face_dom(f)) in ("thigh", "shin") or torso_band(f, CUFF_Z - .03, BELT_Z + .03),
        "jeans", lambda p: .009 + .01 * sm(KNEE_Z + .1, CUFF_Z, p.z) + .006 * sm(BELT_Z - .2, BELT_Z - .05, p.z) * 0,
        planes=[((0, 0, BELT_Z + .01), (0, 0, 1)), ((0, 0, CUFF_Z), (0, 0, 1))],
        keep=lambda f, l: CUFF_Z < f.calc_center_median().z < BELT_Z + .01,
        folds=lambda p: sum(fn(p) for fn in jeans_folds))
for f in (bm.faces if not MH_OUTFITS and not HERO else ()):
    c = f.calc_center_median()
    b = base(face_dom(f))
    # only skin well inside the jeans goes (the waist band stays as a safety layer)
    if b in ("thigh", "shin") + TRUNK and CUFF_Z + .025 < c.z < BELT_Z - .07:
        HIDE.add(f.index)
# waistband + belt
belt_ring = [v.co for v in bm.verts if abs(v.co.z - BELT_Z) < .006 and base(VDOM[v.index]) in TRUNK]
if belt_ring and not MH_OUTFITS and not HERO:
    garment("Waistband", lambda f: torso_band(f, BELT_Z - .03, BELT_Z + .022),
            "jeans", .016, planes=[((0, 0, BELT_Z + .013), (0, 0, 1)), ((0, 0, BELT_Z - .022), (0, 0, 1))],
            keep=lambda f, l: BELT_Z - .022 < f.calc_center_median().z < BELT_Z + .013, smooth=10, thick=.005)

# ---- tops
neck_cut = ((0, TORSO_Y, NECK_Z - .012), (0, -.42, 1))  # crew neck dips at the front
# hero: white ribbed tank top (A-shirt): scoop neck front and back, deep armholes, straps over the shoulders
SH = REST["upper_arm.L"][0]
ARMPIT_Z = SH.z - .1
STRAP_X = abs(SH.x) - .055
TANK_NECK = ((0, TORSO_Y, NECK_Z - .05), (0, -.85, 1))  # deep scoop at the front
TANK_BACK = ((0, TORSO_Y, NECK_Z - .02), (0, .6, 1))  # shallower at the back


SCOOP_X = .058  # the neck scoops are this wide; the straps run between here and STRAP_X
TANK_HEM = BELT_Z - .005  # tucked under the jeans' waistband


SCOOP_TOP = NECK_Z + .04
SCOOP_FRONT, SCOOP_BACK = NECK_Z - .11, NECK_Z - .065  # bottoms of the U at the front / back


def scoop_z(x, front):
    """height of the U-shaped neckline edge at x (front or back)"""
    bottom = SCOOP_FRONT if front else SCOOP_BACK
    u = min(1.0, abs(x) / SCOOP_X)
    return bottom + (SCOOP_TOP - bottom) * (1 - math.sqrt(max(0.0, 1 - u * u)))


def scoop_planes(front):
    """the U as a polyline of cutting planes (extruded along Y)"""
    out, n = [], 8
    pts = [(SCOOP_X * math.sin(math.pi * (k / n - .5)), 0) for k in range(n + 1)]
    pts = [(x, scoop_z(x, front)) for x, _ in pts]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        dx, dz = x1 - x0, z1 - z0
        out.append(((x0, 0, z0), (-dz, 0, dx)))
    return out


def tank_side(c):
    """how far the point is inside the tank top's outline (negative = outside), metres"""
    if abs(c.x) > STRAP_X and c.z > ARMPIT_Z:
        return -1  # armhole
    if abs(c.x) < SCOOP_X:
        return scoop_z(c.x, c.y < TORSO_Y) - c.z
    return 1


def tank_keep(f, l):
    c = f.calc_center_median()
    return c.z > TANK_HEM and tank_side(c) > 0


def tank_pick(f):
    # by position: the shoulder blades and the armpits are weighted to the arms and would leave notches
    c = f.calc_center_median()
    b = base(face_dom(f))
    return BELT_Z - .05 < c.z < NECK_Z + .045 and b not in ("head",) + HANDS and (b not in NOT_TORSO or abs(c.x) < STRAP_X + .02)


if HERO:
    pass  # MakeHuman tee cut into a tank top, see tank_from_tee
elif False:
    garment("Tank", tank_pick,
            "shirt", lambda p: .004 + .004 * sm(BELT_Z + .15, BELT_Z - .05, p.z),
            planes=[((0, 0, TANK_HEM), (0, 0, 1)), *scoop_planes(True), *scoop_planes(False), ((0, TORSO_Y, 0), (0, 1, 0)),
                    ((STRAP_X, 0, 0), (1, 0, 0)), ((-STRAP_X, 0, 0), (-1, 0, 0)), ((0, 0, ARMPIT_Z), (0, 0, 1))],
            keep=tank_keep, smooth=18, thick=.003,
            folds=lambda p: wrinkles(34, .0012)(p) + bunch(BELT_Z, .05, .0015, 90)(p))
elif MH_OUTFITS:
    pass
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
    if MH_OUTFITS or HERO:
        continue
    if b in TRUNK and c.z > BELT_Z + .08:
        if HERO:
            # only skin that is well inside the tank top's outline
            if c.z < NECK_Z - .06 and tank_side(c) > .03 and abs(c.x) < STRAP_X - .015:
                HIDE.add(f.index)
        elif MALE:
            if c.z < NECK_Z - .05:
                HIDE.add(f.index)
        elif BELT_Z + .1 < c.z < NECK_Z - .135:
            HIDE.add(f.index)
    if MALE and b == "upper_arm" and upper_arm_t(c, dom) < .3:
        HIDE.add(f.index)

# ---- jacket (hero): retired - the hero now wears the tank top (kept for reference, never built)
if False:
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
        if c.z < BELT_Z - .1 or (c - V(neck_plane[0])).dot(V(neck_plane[1]).normalized()) > 0:
            return False
        if c.z > VZ and c.y < TORSO_Y - .01 and abs(c.x) < .035 + .8 * (c.z - VZ):
            return False  # V-shaped opening at the throat
        return not (c.y < TORSO_Y and abs(c.x) < .16 and math.degrees(math.atan2(abs(c.x), -(c.y - TORSO_Y))) < 19)

    neck_plane = ((0, TORSO_Y, NECK_Z - .012), (0, -.45, 1))  # lower at the front, higher at the back
    VZ = NECK_Z - .1  # bottom of the V neckline: the collar turns into lapels down to here
    vee = [((.035, 0, VZ), (1, 0, -.8)), ((-.035, 0, VZ), (-1, 0, -.8))]
    planes = [((0, 0, BELT_Z - .1), (0, 0, 1)), neck_plane, *vee,
              ((0, TORSO_Y, 0), (math.cos(a), math.sin(a), 0)), ((0, TORSO_Y, 0), (math.cos(a), -math.sin(a), 0))]
    for sfx in (".L", ".R"):
        fd = (REST["forearm" + sfx][1] - REST["forearm" + sfx][0]).normalized()
        planes.append((WRIST[sfx] - fd * .07, fd))
    elbow_folds = []
    for sfx in (".L", ".R"):
        E = REST["forearm" + sfx][0]
        elbow_folds.append(lambda p, E=E: .004 * math.sin((p - E).length * 160) * math.exp(-((p - E).length / .06) ** 2))
    NK = REST["neck"][0]

    def jacket_collar(sb):
        """smooth the cut neckline, then grow the collar out of it: up the neck, then folded
        down over the shoulders - one piece with the jacket, no gap, no separate ring"""
        edges = [e for e in sb.edges if e.is_boundary and min(v.co.z for v in e.verts) > NECK_Z - .07
                 and abs(e.verts[0].co.z - e.verts[1].co.z) < .7 * e.calc_length()]
        eset = set(edges)
        verts = {v for e in edges for v in e.verts}
        for _ in range(10):
            new = {}
            for v in verts:
                nb = [o for e in v.link_edges if e in eset for o in e.verts if o is not v]
                if len(nb) == 2:
                    new[v] = v.co * .5 + (nb[0].co + nb[1].co) * .25
            for v, c in new.items():
                v.co = c

        def outward(v):
            return V((v.co.x - NK.x, v.co.y - NK.y, 0)).normalized()

        res = bmesh.ops.extrude_edge_only(sb, edges=edges)
        stand = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        backness = lambda v: sm(TORSO_Y - .03, TORSO_Y + .05, v.co.y)
        for v in stand:
            v.co += V((0, 0, .012 + .02 * backness(v))) + outward(v) * .002
        sset = set(stand)
        top = [g for g in res["geom"] if isinstance(g, bmesh.types.BMEdge) and all(x in sset for x in g.verts)]
        res2 = bmesh.ops.extrude_edge_only(sb, edges=top)
        for v in (g for g in res2["geom"] if isinstance(g, bmesh.types.BMVert)):
            b_ = backness(v)
            v.co += outward(v) * (.008 + .014 * b_) - V((0, 0, .01 + .016 * b_))
        sb.normal_update()

    garment("Jacket", jacket_pick, "jacket", lambda p: .018 if p.z < NECK_Z - .07 else .012, planes=planes, keep=jacket_keep,
            smooth=24, thick=.006, post=jacket_collar,
            folds=lambda p: wrinkles(18, .003)(p) + sum(fn(p) for fn in elbow_folds) + bunch(BELT_Z - .05, .05, .003, 80)(p))
    for f in bm.faces:
        dom = face_dom(f)
        if base(dom) in ("upper_arm", "forearm") and (f.calc_center_median() - WRIST[side_of(dom)]).length > .09:
            HIDE.add(f.index)


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
        if not all(in_head(v.co) for v in f.verts):
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
# ---- hair: a thin dark volume over the painted scalp, under the MakeHuman hair cards
CROWN = HEAD_C + V((0, .035 * SCALE, .1 * SCALE))


def hair_depth_at(p):
    """thickness of the hair volume over the scalp point p"""
    f = hair_field(p)
    rel = (p - HEAD_C).z / SCALE
    if FEMALE:
        return .0008 + .004 * sm(0, .03, f)
    top = .003
    return .0008 + top * sm(0, .06, f) * (.25 + .75 * sm(-.03, .07, rel))


cap = shell("HairCap", lambda f: all(HAIRF.get(v.index, -1) > .004 for v in f.verts), lambda v: hair_depth_at(v.co), "hair")
bmc = bmesh.new()
bmc.from_mesh(cap.data)
# smooth the inside of the volume only: the edge stays flush with the scalp
inner = [v for v in bmc.verts if not v.is_boundary and hair_field(v.co) > .014]
for _ in range(12):
    bmesh.ops.smooth_vert(bmc, verts=inner, factor=.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# finer mesh: the groomed strands are projected onto it
bmesh.ops.subdivide_edges(bmc, edges=bmc.edges[:], cuts=1, use_grid_fill=True)
cdl_ = bmc.verts.layers.deform.verify()
for v in bmc.verts:
    for gi in list(v[cdl_].keys()):
        del v[cdl_][gi]
    v[cdl_][GI["head"]] = 1.0
bmc.normal_update()
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


SKIN_BVH = BVHTree.FromBMesh(bm)
_cb = bmesh.new()
_cb.from_mesh(cap.data)
CAP_BVH = BVHTree.FromBMesh(_cb)
_cb.free()
# the volume only guides the fit now: the MakeHuman cards are the hair, over the painted scalp
PARTS.remove(cap)
bpy.data.objects.remove(cap)


# ---- hair and brows: CC0 MakeHuman system assets (game-ready alpha hair cards, see README),
#      fitted to our head: the MakeHuman base head is matched to ours (eye height, skull
#      width, depth and crown height), then every hair vertex keeps its height above the
#      MakeHuman scalp, measured along the ray from the head centre, over our scalp.
MHDIR = os.path.join(ROOT, "vendor", "makehuman")


def read_obj(path):
    """MakeHuman OBJ (decimetres, Y up, facing +Z) -> our metres, Z up, facing -Y"""
    vs, vts, faces, groups, g = [], [], [], {}, None
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            w = line.split()
            if not w:
                continue
            if w[0] == "v":
                x, y, z = map(float, w[1:4])
                vs.append(V((x, -z, y)) * .1)
            elif w[0] == "vt":
                vts.append((float(w[1]), float(w[2])))
            elif w[0] == "g":
                g = w[1] if len(w) > 1 else None
            elif w[0] == "f":
                idx = []
                for t in w[1:]:
                    parts = (t.split("/") + ["", ""])[:2]
                    idx.append((int(parts[0]) - 1, int(parts[1]) - 1 if parts[1] else -1))
                groups.setdefault(g, []).append(len(faces))
                faces.append(idx)
    return vs, vts, faces, groups


MB_V, _, MB_F, MB_G = read_obj(os.path.join(MHDIR, "base.obj"))


def mb_ids(group):
    return {i for fi in MB_G[group] for i, _ in MB_F[fi]}


def mb_centre(group):
    ids = mb_ids(group)
    return sum((MB_V[i] for i in ids), V((0, 0, 0))) / len(ids)


MB_EYE = (mb_centre("joint-l-eye") + mb_centre("joint-r-eye")) / 2


def skull(points, eye_z):
    """crown height, and width / front / back of the skull a little above the eyes"""
    top = max(p.z for p in points)
    h = top - eye_z
    sl = [p for p in points if eye_z + .3 * h < p.z < eye_z + .6 * h]
    return top, max(p.x for p in sl) - min(p.x for p in sl), min(p.y for p in sl), max(p.y for p in sl)


_mb_head = [MB_V[i] for i in mb_ids("body") if abs(MB_V[i].x) < .12 and MB_V[i].z > MB_EYE.z - .05]
_our_head = [v.co.copy() for v in bm.verts if in_head(v.co) and abs(v.co.x) < .12]
MB_TOP, MB_W, MB_Y0, MB_Y1 = skull(_mb_head, MB_EYE.z)
OUR_TOP, OUR_W, OUR_Y0, OUR_Y1 = skull(_our_head, EYE_Z)
FIT = V(((OUR_W / MB_W), (OUR_Y1 - OUR_Y0) / (MB_Y1 - MB_Y0), (OUR_TOP - EYE_Z) / (MB_TOP - MB_EYE.z)))
print("hair fit scale", tuple(round(c, 3) for c in FIT))


def fit(p):
    return V((p.x * FIT.x, OUR_Y0 + (p.y - MB_Y0) * FIT.y, EYE_Z + (p.z - MB_EYE.z) * FIT.z))


def brow_placer(path):
    """brows go exactly over the painted brow line (inner end above the inner eye corner,
    tail past the outer one), keeping the asset's own arch, then are projected onto the
    skin from the front so no part sinks into the eye socket"""
    bound = read_mhclo(path[:-4] + ".mhclo") or read_obj(path)[0]
    side = [p for p in bound if p.x > 0]
    x0, x1 = min(p.x for p in side), max(p.x for p in side)
    zm = sum(p.z for p in side) / len(side)
    tx0, tx1 = EYE_X * .98 - .024 * SCALE, EYE_X * .98 + .025 * SCALE
    zc = EYE_Z + (.021 if not FEMALE else .022) * SCALE
    thick = FIT.z * (1.0 if FEMALE else 1.2)

    def place(p):  # p: the MakeHuman position of the vertex (from the .mhclo)
        u = (abs(p.x) - x0) / (x1 - x0)
        x = math.copysign(tx0 + u * (tx1 - tx0), p.x)
        z = zc + (p.z - zm) * thick
        loc, nrm, _, _ = SKIN_BVH.ray_cast(V((x, HC_Y - .3, z)), V((0, 1, 0)), .5)
        if loc is None:
            loc, nrm, _, _ = SKIN_BVH.find_nearest(V((x, HC_Y - .1, z)))
        return loc + nrm * .0018
    return place


_mb_faces = [[i for i, _ in fc] for fc in (MB_F[fi] for fi in MB_G["body"]) if all(MB_V[i].z > MB_EYE.z - .25 for i, _ in fc)]
MB_BVH = BVHTree.FromPolygons([fit(p) for p in MB_V], _mb_faces)


def read_mhclo(path):
    return [p for p, _ in read_mhclo_refs(path)]


def read_mhclo_refs(path):
    """where MakeHuman puts the asset on its base mesh: every vertex is bound to a base
    triangle (barycentric weights + an offset scaled by the base proportions); the raw OBJ
    coordinates are not on the head"""
    sc, out, on = {}, [], False
    raw = lambda p: (p.x * 10, p.z * 10, -p.y * 10)  # back to MakeHuman's own axes
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            w = line.split()
            if not w:
                continue
            if w[0] in ("x_scale", "y_scale", "z_scale"):
                ax = "xyz".index(w[0][0])
                sc[ax] = abs(raw(MB_V[int(w[1])])[ax] - raw(MB_V[int(w[2])])[ax]) / float(w[3])
            elif w[0] == "verts":
                on = True
            elif on:
                if len(w) == 1 and w[0].isdigit():
                    out.append((MB_V[int(w[0])].copy(), [(int(w[0]), 1.0)]))
                elif len(w) == 9:
                    i, wt, d = [int(x) for x in w[:3]], [float(x) for x in w[3:6]], [float(x) for x in w[6:9]]
                    p = sum((MB_V[k] * c for k, c in zip(i, wt)), V((0, 0, 0)))
                    dx, dy, dz = d[0] * sc.get(0, 1), d[1] * sc.get(1, 1), d[2] * sc.get(2, 1)
                    out.append((p + V((dx, -dz, dy)) * .1, list(zip(i, wt))))
                elif out:  # a keyword after the vertex block ends it (one before it, like material, does not)
                    on = False
    return out


def conform(p, clearance):
    """carry p over from the MakeHuman scalp to ours; never closer than clearance to the skin
    or the hair volume"""
    d = p - HEAD_C
    if d.length < 1e-6:
        return p
    d.normalize()
    ours = SKIN_BVH.ray_cast(HEAD_C, d, .3)
    theirs = MB_BVH.ray_cast(HEAD_C, d, .3)
    if ours[0] is not None and theirs[0] is not None:
        p = p + d * max(-.02, min(.02, ours[3] - theirs[3]))
    floor = max([h[3] for h in (ours, CAP_BVH.ray_cast(HEAD_C, d, .3)) if h[0] is not None] or [0])
    if floor and (p - HEAD_C).length < floor + clearance and (p - HEAD_C).dot(d) > 0:
        p = HEAD_C + d * (floor + clearance)
    return p


def hair_image(path, size, grey, dark=1.0):
    """the asset's diffuse+alpha, downsized for the game; NPC copies are made neutral grey
    (bright) so the per-ped hair colour tints them"""
    img = bpy.data.images.load(path)
    img.scale(size, size)
    if grey:
        px = np.array(img.pixels[:], np.float32).reshape(-1, 4)
        lum = px[:, :3] @ np.array([.3, .59, .11], np.float32)
        ref = np.percentile(lum[px[:, 3] > .5], 90) if (px[:, 3] > .5).any() else 1
        lum = np.clip(.25 + .7 * lum / max(ref, 1e-3), 0, 1)
        px[:, :3] = lum[:, None]
        img.pixels.foreach_set(px.ravel())
    elif dark != 1.0:
        px = np.array(img.pixels[:], np.float32).reshape(-1, 4)
        px[:, :3] *= dark
        img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def mh_asset(name, path, key, clearance, keep=None, weight=None, place=fit):
    vs, vts, faces, _ = read_obj(path)
    bound = read_mhclo(path[:-4] + ".mhclo")
    if len(bound) == len(vs):
        vs = bound
    else:
        print("WARNING", name, "mhclo has", len(bound), "verts for", len(vs))
    pts = [conform(place(p), clearance) if place is fit else place(p) for p in vs]
    b_ = bmesh.new()
    dl = b_.verts.layers.deform.verify()
    uvl = b_.loops.layers.uv.verify()
    bv = [b_.verts.new(p) for p in pts]
    for fc in faces:
        if keep and not keep([pts[i] for i, _ in fc]):
            continue
        try:
            nf = b_.faces.new([bv[i] for i, _ in fc])
        except ValueError:
            continue
        for loop, (_, ti) in zip(nf.loops, fc):
            if ti >= 0:
                loop[uvl].uv = vts[ti]
        nf.material_index = mat_index(key)
    bmesh.ops.delete(b_, geom=[v for v in b_.verts if not v.link_faces], context="VERTS")
    for v in b_.verts:
        for bn, wv in (weight(v.co) if weight else {"head": 1.0}).items():
            v[dl][GI[bn]] = wv
    paint(b_, lambda f: None)
    print("hair asset", name, len(b_.faces), "faces")
    return to_object(name, b_)


HAIR_STYLE = "short04" if HERO or POLICE else "ponytail01" if FEMALE else "short02"
BROW_STYLE = "eyebrow005" if FEMALE else "eyebrow001"
HAIR_CARD.node_tree.nodes["Image Texture"].image = hair_image(
    os.path.join(MHDIR, "hair", HAIR_STYLE, HAIR_STYLE + "_diffuse.png"), 1024 if HERO else 512, not HERO, .4)
MAT["brows"] = card_material("BrowCards", hair_image(os.path.join(MHDIR, "eyebrows", BROW_STYLE, BROW_STYLE + ".png"), 256, not HERO, .6))


def hair_weight(q):
    # long hair below the skull follows the neck and the upper back, not just the head
    t = sm(EYE_Z - .16 * SCALE, EYE_Z - .06 * SCALE, q.z)
    return {"head": t, "neck": (1 - t) * .7, "chest": (1 - t) * .3} if t < 1 else {"head": 1.0}


mh_asset("Hair", os.path.join(MHDIR, "hair", HAIR_STYLE, HAIR_STYLE + ".obj"), "cards", .0012,
         keep=(lambda ps: max(p.z - CAP_Z(p) for p in ps) < -.004) if POLICE else None, weight=hair_weight)
mh_asset("Brows", os.path.join(MHDIR, "eyebrows", BROW_STYLE, BROW_STYLE + ".obj"), "brows", .0007,
         place=brow_placer(os.path.join(MHDIR, "eyebrows", BROW_STYLE, BROW_STYLE + ".obj")))

# ---- MakeHuman clothes, fitted body part by body part. Every garment vertex is bound (.mhclo)
#      to the MakeHuman base mesh, whose skin weights say which body part carries it; for each
#      part the point is carried from the MakeHuman bone to ours (position along the bone,
#      offset turned with the bone, so A-pose arms come down to our rest pose), and its height
#      over the MakeHuman skin, measured from the bone outwards, is kept over our skin.
#      The parts' results are blended by the weights, then nothing may sit inside our skin.
MB_W = {}
for bn, lst in json.load(open(os.path.join(MHDIR, "default_weights.mhw"), encoding="utf-8"))["weights"].items():
    sfx = ".L" if bn.endswith(".L") else ".R" if bn.endswith(".R") else ""
    b0 = bn.split(".")[0]
    part = ("UA" if b0.startswith("upperarm") else "FA" if b0.startswith("lowerarm")
            else "HD" if b0.startswith(("wrist", "metacarpal", "finger")) else "TH" if b0.startswith("upperleg")
            else "SH" if b0.startswith("lowerleg") else "FT" if b0.startswith(("foot", "toe")) else "T")
    key = part + sfx if part != "T" else "T"
    for vi, wv in lst:
        d_ = MB_W.setdefault(vi, {})
        d_[key] = d_.get(key, 0) + wv

MB_BODY_BVH = BVHTree.FromPolygons(MB_V, [[i for i, _ in MB_F[fi]] for fi in MB_G["body"]])
# which way the MakeHuman face normals point (outward = +1): probe from inside the chest
_hit = MB_BODY_BVH.ray_cast(mb_centre("joint-spine-1"), V((0, -1, 0)), .5)
MB_SIGN = 1 if _hit[1] is not None and _hit[1].y < 0 else -1
SEGS = {}
for s_, sfx in (("l", ".L"), ("r", ".R")):
    sh_, el_, ha_ = mb_centre(f"joint-{s_}-shoulder"), mb_centre(f"joint-{s_}-elbow"), mb_centre(f"joint-{s_}-hand")
    ul_, kn_, an_, to_ = mb_centre(f"joint-{s_}-upper-leg"), mb_centre(f"joint-{s_}-knee"), mb_centre(f"joint-{s_}-ankle"), mb_centre(f"joint-{s_}-foot-2")
    SEGS["UA" + sfx] = (sh_, el_, *REST["upper_arm" + sfx])
    SEGS["FA" + sfx] = (el_, ha_, *REST["forearm" + sfx])
    SEGS["HD" + sfx] = (ha_, ha_ + (ha_ - el_).normalized() * .09, *REST["hand" + sfx])
    SEGS["TH" + sfx] = (ul_, kn_, *REST["thigh" + sfx])
    SEGS["SH" + sfx] = (kn_, an_, *REST["shin" + sfx])
    SEGS["FT" + sfx] = (an_, to_, *REST["foot" + sfx])


def _spine_at(z, a, b):
    t_ = (z - a.z) / (b.z - a.z)
    return a.lerp(b, t_)


_mb_hip = (mb_centre("joint-l-upper-leg") + mb_centre("joint-r-upper-leg")) / 2
_mb_sh = mb_centre("joint-l-shoulder")
_mb_neck, _mb_head = mb_centre("joint-neck"), mb_centre("joint-head")
MB_CHAIN = [V((0, mb_centre("joint-pelvis").y, _mb_hip.z)), V((0, mb_centre("joint-spine-1").y, _mb_sh.z)),
            V((0, _mb_neck.y, _mb_neck.z)), V((0, _mb_head.y, _mb_head.z)), V((0, _mb_head.y, MB_TOP))]
_our_hip = (REST["thigh.L"][0] + REST["thigh.R"][0]) / 2
OUR_CHAIN = [V((0, REST["hips"][0].y, _our_hip.z)), V((0, _spine_at(REST["upper_arm.L"][0].z, *REST["chest"]).y, REST["upper_arm.L"][0].z)),
             REST["neck"][0].copy(), REST["head"][0].copy(), REST["head"][1].copy()]


def _centre_y(tree, p):
    """the point halfway between the front and the back of the body at p's height
    (MakeHuman's spine joints sit near the back, ours in the middle)"""
    f_ = tree.ray_cast(p, V((0, -1, 0)), .5)
    b_ = tree.ray_cast(p, V((0, 1, 0)), .5)
    if f_[0] is None or b_[0] is None:
        return p
    return V((p.x, (f_[0].y + b_[0].y) / 2, p.z))


for k_ in range(3):
    MB_CHAIN[k_] = _centre_y(MB_BODY_BVH, MB_CHAIN[k_])
    OUR_CHAIN[k_] = _centre_y(SKIN_BVH, OUR_CHAIN[k_])



def _ray(tree, o, d):
    h = tree.ray_cast(o, d, .5)
    return h[3] if h[0] is not None else None


def _carry(off, c, C, d_mh, d_ours):
    """keep the height over the skin: shift by the difference of the two body radii"""
    r1, r2 = _ray(MB_BODY_BVH, c, d_mh), _ray(SKIN_BVH, C, d_ours)
    if r1 is None or r2 is None:
        return V((0, 0, 0))
    return d_ours * max(-.05, min(.05, r2 - r1))


def map_seg(p, key):
    a, b, A, B = SEGS[key]
    ax = b - a
    t_ = (p - a).dot(ax) / ax.length_squared
    c = a + ax * t_
    off = p - c
    R = ax.normalized().rotation_difference((B - A).normalized())
    C = A + (B - A) * t_
    o2 = R @ off
    if off.length > 1e-5:
        d_ = off.normalized()
        o2 += _carry(off, c, C, d_, R @ d_)
    return C + o2


def map_torso(p):
    k = 0
    while k < len(MB_CHAIN) - 2 and p.z > MB_CHAIN[k + 1].z:
        k += 1
    a, b, A, B = MB_CHAIN[k], MB_CHAIN[k + 1], OUR_CHAIN[k], OUR_CHAIN[k + 1]
    t_ = (p.z - a.z) / (b.z - a.z)
    c, C = a.lerp(b, t_), A.lerp(B, t_)
    off = p - c
    o2 = off.copy()
    hz = V((off.x, off.y, 0))
    if hz.length > 1e-5:
        o2 += _carry(off, c, C, hz.normalized(), hz.normalized())
    return C + o2


def map_body(p, refs):
    acc = {}
    for vi, wv in refs:
        for k, x in MB_W.get(vi, {"T": 1.0}).items():
            acc[k] = acc.get(k, 0) + wv * x
    tot = sum(x for x in acc.values() if x > .02)
    out = V((0, 0, 0))
    for k, x in acc.items():
        if x > .02:
            out += (map_torso(p) if k == "T" else map_seg(p, k)) * (x / tot)
    return out


def our_part(f_):
    b_ = base(face_dom(f_))
    sfx = face_dom(f_)[-2:] if face_dom(f_)[-2:] in (".L", ".R") else ""
    return {"upper_arm": "UA", "forearm": "FA", "thigh": "TH", "shin": "SH", "foot": "FT"}.get(
        b_, "HD" if b_ in HANDS else "T") + (sfx if b_ in ("upper_arm", "forearm", "thigh", "shin", "foot") or b_ in HANDS else "")


# our skin split by body part: a garment point only looks at the skin of the parts that carry
# it (a shirt hem next to a hanging hand must not take the hand's weights or be pushed off it)
bm.faces.ensure_lookup_table()
_pf = {}
for f_ in bm.faces:
    _pf.setdefault(our_part(f_), []).append(f_.index)
PART_BVH = {}
for k_, idx in _pf.items():
    vs_ = sorted({v.index for i in idx for v in bm.faces[i].verts})
    remap = {vi: n for n, vi in enumerate(vs_)}
    bm.verts.ensure_lookup_table()
    PART_BVH[k_] = (BVHTree.FromPolygons([bm.verts[vi].co for vi in vs_], [[remap[v.index] for v in bm.faces[i].verts] for i in idx]), idx)


def _centred(a, b, pts):
    """the limb's own axis: through the centres of its cross-sections near both ends
    (bones are not always in the middle of the flesh)"""
    ax = b - a
    near = lambda lo, hi: [p for p in pts if lo < (p - a).dot(ax) / ax.length_squared < hi]
    s0, s1 = near(.12, .28), near(.72, .88)
    if len(s0) < 8 or len(s1) < 8:
        return a, b
    c0 = sum(s0, V((0, 0, 0))) / len(s0)
    c1 = sum(s1, V((0, 0, 0))) / len(s1)
    u = (c1 - c0).normalized()
    return c0 + u * (a - c0).dot(u), c0 + u * (b - c0).dot(u)


_mb_part = {}
for vi in mb_ids("body"):
    ws_ = MB_W.get(vi)
    if ws_:
        _mb_part.setdefault(max(ws_, key=ws_.get), []).append(MB_V[vi])
for k_, (a_, b_, A_, B_) in list(SEGS.items()):
    ours_ = [bm.verts[v.index].co for i in _pf.get(k_, []) for v in bm.faces[i].verts]
    SEGS[k_] = (*_centred(a_, b_, _mb_part.get(k_, [])), *_centred(A_, B_, ours_))


def nearest_on(q, parts):
    """nearest skin point among the given body parts -> (location, normal, body face index)"""
    best = None
    for k_ in parts:
        if k_ not in PART_BVH:
            continue
        loc, nrm, fi, dist = PART_BVH[k_][0].find_nearest(q)
        if loc is not None and (best is None or dist < best[3]):
            best = (loc, nrm, PART_BVH[k_][1][fi], dist)
    if best is None:
        loc, nrm, fi, dist = SKIN_BVH.find_nearest(q)
        return loc, nrm, fi
    return best[:3]


def part_weights(refs):
    acc = {}
    for vi, wv in refs:
        for k, x in MB_W.get(vi, {"T": 1.0}).items():
            acc[k] = acc.get(k, 0) + wv * x
    return acc


def skin_weights(q, parts=None):
    """our skin's bone weights at the point nearest q (inverse-distance blend of the face corners)"""
    loc, _, fi = nearest_on(q, parts or ())
    bm.faces.ensure_lookup_table()
    acc = {}
    for v in bm.faces[fi].verts:
        k = 1 / ((v.co - loc).length + 1e-4)
        for gi, wv in v[dl].items():
            acc[gi] = acc.get(gi, 0) + wv * k
    top = sorted(acc.items(), key=lambda x: -x[1])[:4]
    tot = sum(x for _, x in top) or 1
    return {gi: x / tot for gi, x in top}


def push_out(q, parts, clearance):
    """out of every nearby body part's skin (hands and forearms only for their own sleeves/gloves,
    so a shirt hem is not shoved away from a hanging hand)"""
    for k_ in PART_BVH:
        if k_[:2] in ("HD", "FA") and k_ not in parts:
            continue
        loc, nrm, _, dist = PART_BVH[k_][0].find_nearest(q, .03)
        if loc is None:
            continue
        h = (q - loc).dot(nrm)
        if h < clearance:
            q = q + nrm * (clearance - h)
    return q


def mh_cloth(folder, name, key, clearance, size=512, cut_above=None, post=None):
    """one MakeHuman garment, fitted, weighted like the skin under it, with its own textured material"""
    d_ = os.path.join(MHDIR, "clothes", folder)
    obj = next(x for x in os.listdir(d_) if x.endswith(".obj"))
    mhmat = open(os.path.join(d_, next(x for x in os.listdir(d_) if x.endswith(".mhmat"))), encoding="utf-8").read()
    texname = next(l.split()[1] for l in mhmat.splitlines() if l.startswith("diffuseTexture"))
    vs, vts, faces, _ = read_obj(os.path.join(d_, obj))
    bound = read_mhclo_refs(os.path.join(d_, obj[:-4] + ".mhclo"))
    if len(bound) != len(vs):
        print("WARNING", folder, "mhclo has", len(bound), "verts for", len(vs))
        return None
    pts, parts_of, heights, armfrac = [], [], [], []
    mapped = []
    for p, refs in bound:
        q = map_body(p, refs)
        mapped.append(q.copy())
        pw = part_weights(refs)
        armfrac.append(sum(x for k_, x in pw.items() if k_[:2] in ("UA", "FA", "HD")) / (sum(pw.values()) or 1))
        parts = sorted((k for k, x in pw.items() if x > .05), key=lambda k: -pw[k]) or ["T"]
        parts_of.append(parts)
        # shrink-wrap: as high over our skin as it was over the MakeHuman skin (tight parts fit
        # exactly; parts that hang well off the body, like a skirt, keep their mapped shape)
        ml, mn_, _, _ = MB_BODY_BVH.find_nearest(p)
        h_mh = (p - ml).dot(mn_) * MB_SIGN
        heights.append(h_mh)
        if h_mh < .06:
            loc, nrm, _ = nearest_on(q, parts)
            q = (loc + nrm * max(clearance, h_mh + .002)).lerp(q, sm(.025, .06, h_mh))
        pts.append(push_out(q, parts, clearance))
    # the snapping to the nearest skin can jump between neighbouring points (armpits, seams):
    # smooth the correction over the garment, then make sure nothing ended up inside the skin
    nbr = [set() for _ in pts]
    for fc in faces:
        ids = [i for i, _ in fc]
        for a_, b_ in zip(ids, ids[1:] + ids[:1]):
            nbr[a_].add(b_)
            nbr[b_].add(a_)
    disp = [q - m for q, m in zip(pts, mapped)]
    for _ in range(6):
        disp = [d * .5 + (sum((disp[j] for j in nb), V((0, 0, 0))) / len(nb)) * .5 if nb else d for d, nb in zip(disp, nbr)]
    for i, (m, parts) in enumerate(zip(mapped, parts_of)):
        pts[i] = push_out(m + disp[i], parts, clearance)
    # relax what lies on the body: carrying A-pose shoulders down to our rest pose folds the
    # cloth there (flaps on the shoulder tops, creases at the armpits and the neckline). Each
    # point moves toward its neighbours and is put back at its own height over the skin; hems
    # and openings stay where they are.
    edge_n = {}
    for fc in faces:
        ids = [i for i, _ in fc]
        for a_, b_ in zip(ids, ids[1:] + ids[:1]):
            k_ = (min(a_, b_), max(a_, b_))
            edge_n[k_] = edge_n.get(k_, 0) + 1
    rim = {i for k_, n_ in edge_n.items() if n_ == 1 for i in k_}
    for _ in range(12):
        nxt = list(pts)
        for i, nb in enumerate(nbr):
            if not nb or i in rim or heights[i] > .03:
                continue
            avg = sum((pts[j] for j in nb), V((0, 0, 0))) / len(nb)
            q = pts[i].lerp(avg, .6)
            loc, nrm, _ = nearest_on(q, parts_of[i])
            nxt[i] = loc + nrm * max(clearance, heights[i] + .002)
        pts = nxt
    # openings (neckline, cuffs, hems): straighten along the edge loop and stand a little
    # further off the skin, so the coarser body mesh cannot poke through in teeth along it
    rim_nb = {i: [] for i in rim}
    for (a_, b_), n_ in edge_n.items():
        if n_ == 1:
            rim_nb[a_].append(b_)
            rim_nb[b_].append(a_)
    for _ in range(6):
        nxt = list(pts)
        for i, nb in rim_nb.items():
            if len(nb) == 2 and heights[i] < .03:
                q = pts[i] * .5 + (pts[nb[0]] + pts[nb[1]]) * .25
                loc, nrm, _ = nearest_on(q, parts_of[i])
                nxt[i] = loc + nrm * max(clearance * 2.5, heights[i] + .004)
        pts = nxt
    pts = [push_out(q, parts, clearance * (2.5 if i in rim else 1)) for i, (q, parts) in enumerate(zip(pts, parts_of))]
    img = bpy.data.images.load(os.path.join(d_, texname))
    img.scale(size, size)
    img.pack()
    MAT[key] = material(key, "ffffff", .85, tex=img)
    b_ = bmesh.new()
    dl_ = b_.verts.layers.deform.verify()
    uvl_ = b_.loops.layers.uv.verify()
    arm_l = b_.verts.layers.float.new("arm")  # (before any vertex exists: a new layer invalidates them)
    bv = [b_.verts.new(p) for p in pts]
    for v, a_ in zip(bv, armfrac):
        v[arm_l] = a_
    for v, parts in zip(bv, parts_of):
        # weighted like all the body parts under it (a strap over the shoulder follows torso and
        # upper arm both, as the skin does); never the hand, so a hem next to it stays put
        for gi, wv in skin_weights(v.co, [p_ for p_ in parts if p_[:2] != "HD"] or parts[:1]).items():
            v[dl_][gi] = wv
    partsets = []
    pid = b_.faces.layers.int.new("pid")
    for fc in faces:
        if cut_above is not None and min(pts[i].z for i, _ in fc) > cut_above:
            continue
        try:
            nf = b_.faces.new([bv[i] for i, _ in fc])
        except ValueError:
            continue
        partsets.append((set().union(*(parts_of[i] for i, _ in fc)), [parts_of[i][0] for i, _ in fc]))
        nf[pid] = len(partsets) - 1
        for loop, (_, ti) in zip(nf.loops, fc):
            if ti >= 0:
                loop[uvl_].uv = vts[ti]
        nf.material_index = mat_index(key)
    if post:
        # recut / restyle the garment (sees each face's body parts and texture colour)
        px = np.array(img.pixels[:], np.float32).reshape(size, size, 4)

        def colour(f_):
            u = sum((l[uvl_].uv.x for l in f_.loops)) / len(f_.loops)
            v = sum((l[uvl_].uv.y for l in f_.loops)) / len(f_.loops)
            return px[min(size - 1, max(0, int(v % 1 * size))), min(size - 1, max(0, int(u % 1 * size))), :3]
        cut = post(b_, lambda f_: partsets[f_[pid]], colour)
    if post and cut:
        bmesh.ops.delete(b_, geom=[v for v in b_.verts if not v.link_faces], context="VERTS")
        # the cut runs through faces that were never meant to be cut: collapse the slivers it
        # leaves along the edge, then straighten the edge
        bmesh.ops.dissolve_degenerate(b_, dist=.004, edges=b_.edges[:])
        smooth_rim(b_, 25)
        for v in b_.verts:
            if v.is_boundary:
                v.co = push_out(v.co, partsets[v.link_faces[0][pid]][1][:1] or ["T"], clearance * 2.5)
    bmesh.ops.delete(b_, geom=[v for v in b_.verts if not v.link_faces], context="VERTS")
    paint(b_, lambda f: None)
    print("cloth", folder, len(b_.faces), "faces")
    CLOTH_PARTS[name] = [partsets[f_[pid]][0] for f_ in b_.faces]
    CLOTH_RIM[name] = [v.co.copy() for v in b_.verts if v.is_boundary]
    return to_object(name, b_)


def covered_faces(ob, rim_gap=.04, reach=.035):
    """body faces with this garment right over them (within 3.5 cm along the skin normal), the
    garment there belonging to the same body part (not a shirt seen from the inside of the arm)"""
    fparts = CLOTH_PARTS.get(ob.name)
    # skin near an opening (neckline, sleeves, hems) stays: removing it there leaves the jagged
    # edge of the hole visible inside the opening
    from mathutils.kdtree import KDTree
    rim_pts = CLOTH_RIM.get(ob.name, [])
    kd = KDTree(max(1, len(rim_pts)))
    for i, p in enumerate(rim_pts):
        kd.insert(p, i)
    kd.balance()
    b_ = bmesh.new()
    b_.from_mesh(ob.data)
    tree = BVHTree.FromBMesh(b_)
    b_.free()
    out = set()
    for f_ in bm.faces:
        if base(face_dom(f_)) in ("head",) + HANDS:
            continue
        c = f_.calc_center_median()
        if rim_pts and kd.find(c)[2] < rim_gap:
            continue
        hit = tree.ray_cast(c + f_.normal * .001, f_.normal, reach)
        if hit[0] is not None and (our_part(f_) in fparts[hit[2]] if fparts else our_part(f_) == "T"):
            out.add(f_.index)
    return out


def uv_islands(b_):
    """the separate pieces of a garment: its UV islands (the mesh itself is often welded through)"""
    uvl = b_.loops.layers.uv.active

    def uv_at(f_, v):
        return next(l[uvl].uv for l in f_.loops if l.vert is v)

    def same_island(f_, g_, e):
        return all((uv_at(f_, v) - uv_at(g_, v)).length < 1e-4 for v in e.verts)

    seen, out = set(), []
    for f0 in b_.faces:
        if f0 in seen:
            continue
        comp, stack = [], [f0]
        seen.add(f0)
        while stack:
            f_ = stack.pop()
            comp.append(f_)
            for e in f_.edges:
                for g_ in e.link_faces:
                    if g_ not in seen and same_island(f_, g_, e):
                        seen.add(g_)
                        stack.append(g_)
        out.append(comp)
    return out


# street outfits whose top is a printed (logo) tee: the top becomes plain cotton the game tints
PLAIN_TOPS = {"male_casualsuit04", "male_casualsuit06", "female_casualsuit01", "female_casualsuit02", "female_sportsuit01"}


def plain_top(key):
    def post(b_, parts_of_face, colour):
        MAT[key + "__shirt"] = material(key + "__shirt", "f2f1ec", 0.9, tex=TEX_COTTON, nrm=NRM_COTTON, nstr=0.4)
        for comp in uv_islands(b_):
            zc = sum(f_.calc_center_median().z for f_ in comp) / len(comp)
            if zc > BELT_Z + .06:
                for f_ in comp:
                    f_.material_index = mat_index(key + "__shirt")
    return post


def tank_from_tee(b_, parts_of_face, colour):
    """the hero's white tank top cut out of a MakeHuman tee (the jeans stay as they are):
    sleeves off, deep armholes, scoop neck front and back, plain white ribbed cotton"""
    # which separate piece is the shirt: by the average colour of each connected piece (the
    # faded patches of the denim are light too, so single faces cannot tell)
    sid = b_.faces.layers.int.new("shirt")  # (a new layer invalidates face references: make it first)
    shirt = set()
    arm_l = b_.verts.layers.float.get("arm")
    sleeves = []
    for comp in uv_islands(b_):
        cs = [colour(f_) for f_ in comp]
        rr = sum(c[0] for c in cs) / len(cs)
        bb = sum(c[2] for c in cs) / len(cs)
        if not (bb > rr * 1.2):
            arm = sum(v[arm_l] for f_ in comp for v in f_.verts) / sum(len(f_.verts) for f_ in comp)
            print("TEE PIECE", len(comp), round(arm, 2))
            if arm > 0.3:
                sleeves.append(comp)  # a whole sleeve piece of the pattern: off it comes
            else:
                shirt.update(comp)
    for comp in sleeves:
        bmesh.ops.delete(b_, geom=comp, context="FACES")
    for f_ in shirt:
        f_[sid] = 1
    arm_l = b_.verts.layers.float.get("arm")
    shoulder_top = SH.z + .12

    def top(x):
        """upper outline of the tank seen from the front: scoop, straps, rounded armholes"""
        ax = abs(x)
        if ax <= SCOOP_X:
            return None
        if ax <= STRAP_X:
            return shoulder_top
        u = min(1.0, (ax - STRAP_X) / .03)
        return ARMPIT_Z + (shoulder_top - ARMPIT_Z) * math.sqrt(max(0.0, 1 - u * u))

    def phi(v):
        c = v.co
        t = top(c.x)
        if t is None:
            t = scoop_z(c.x, c.y < TORSO_Y)
            # blend into the strap so the corner of the U is round, not a step
            t += (shoulder_top - t) * sm(SCOOP_X * .8, SCOOP_X, abs(c.x))
        # the sleeve goes by its arm weighting, but only outside the straps (MakeHuman's upper
        # arm weights reach over the shoulder blades, which would punch holes in the back)
        side = sm(STRAP_X - .03, STRAP_X + .01, abs(c.x))
        return min(t - c.z, (.1 - v[arm_l]) * .12 * side + (1 - side))

    shirt_v = {v for f_ in b_.faces if f_[sid] for v in f_.verts}
    field_cut(b_, lambda v: phi(v) if v in shirt_v else 1.0, smooth=6)
    # scraps of sleeve the cut left floating at the armholes
    seen = set()
    for f0 in [f_ for f_ in b_.faces if f_[sid]]:
        if f0 in seen:
            continue
        comp, stack = [], [f0]
        seen.add(f0)
        while stack:
            f_ = stack.pop()
            comp.append(f_)
            for e in f_.edges:
                for g_ in e.link_faces:
                    if g_ not in seen and g_[sid]:
                        seen.add(g_)
                        stack.append(g_)
        if len(comp) < 60:
            bmesh.ops.delete(b_, geom=comp, context="FACES")
    for f_ in b_.faces:
        if f_[sid]:
            f_.material_index = mat_index("tank")
    return True  # cut: clean the new edges up


def field_cut(b_, phi, smooth=0):
    """cut the mesh exactly along phi = 0 and drop the phi < 0 side (a clean edge, however the
    faces of the mesh happen to run)"""
    val = {v: phi(v) for v in b_.verts}
    for _ in range(smooth):  # a noisy field gives a ragged edge
        val = {v: x * .4 + .6 * sum(val[e.other_vert(v)] for e in v.link_edges) / len(v.link_edges) if v.link_edges else x
               for v, x in val.items()}
    zero = set()
    for e in list(b_.edges):
        a_, b2 = e.verts
        fa, fb = val[a_], val[b2]
        if fa * fb < 0:
            t_ = fa / (fa - fb)
            _, nv = bmesh.utils.edge_split(e, a_, t_)
            val[nv] = 0.0
            zero.add(nv)
    for v, x in val.items():
        if x == 0:
            zero.add(v)
    for f_ in list(b_.faces):
        zs = [v for v in f_.verts if v in zero]
        if len(zs) == 2 and not any(set(e.verts) == set(zs) for e in f_.edges):
            try:
                bmesh.utils.face_split(f_, zs[0], zs[1])
            except Exception:
                pass
    drop = [f_ for f_ in b_.faces if sum(val.get(v, 0) for v in f_.verts) / len(f_.verts) < 0]
    bmesh.ops.delete(b_, geom=drop, context="FACES")


HERO_OUTFIT = "male_casualsuit06" if HERO else None
if HERO_OUTFIT:
    MAT["tank"] = material("Shirt", "f2f1ec", 0.92)
    ob_ = mh_cloth(HERO_OUTFIT, "HeroOutfit", "Jeans", .006, size=1024, post=tank_from_tee)  # (a little off the skin: it stretched thin at the sides)
    HIDE |= covered_faces(ob_, .01, .08)

_cover = None
COVERS = {}  # outfit -> the body faces it covers (the game hides them for whoever wears it)
for o_ in MH_OUTFITS:
    ob_ = mh_cloth(o_, "Outfit_" + o_, "Outfit_" + o_, .003, post=plain_top("Outfit_" + o_) if o_ in PLAIN_TOPS else None)
    if ob_:
        cv = covered_faces(ob_)
        COVERS[o_] = covered_faces(ob_, .016, .05)
        _cover = cv if _cover is None else _cover & cv
for s_ in MH_SHOES:
    # the MakeHuman shoes come with socks up the calf: cut them at the shoe collar (they would
    # show through trouser legs, which MakeHuman handles with render order)
    mh_cloth(s_, "Shoes_" + s_, "Shoes_" + s_, .003, cut_above=REST["foot.L"][0].z + .03)
# skin that every outfit covers goes (each ped wears one of them, so only the common part)
if _cover:
    HIDE |= _cover


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
for sfx in ((".L", ".R") if not MH_SHOES else ()):
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

# per outfit, a vertex attribute "_cov_<outfit>": 1 where every face round the vertex is under
# that outfit (the skin shader drops those triangles for the one being worn; exported to glTF)
for o_, cv in COVERS.items():
    lay = bm.verts.layers.float.new("_cov_" + o_)
    for v in bm.verts:
        v[lay] = 1.0 if v.link_faces and all(f_.index in cv for f_ in v.link_faces) else 0.0
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
    for _ in range(6):  # snapped to the nearest skin points: relax the zigzag out of it
        path = [path[i - 1] * .25 + path[i] * .5 + path[(i + 1) % n_pts] * .25 for i in range(n_pts)]
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
    k0 = curl / 95
    for sfx in (".L", ".R"):
        s = 1 if sfx == ".L" else -1
        ax, cv = FINGER_AXIS[sfx], FINGER_CONV[sfx]
        bends = {}
        for fname, conv, extra, relax in (("index", 5, 0, 12), ("middle", 0, 0, 17), ("ring", 4, 5, 22), ("pinky", 9, 10, 28)):
            # a relaxed hand is never flat: each finger curls a little more than the one before
            k = max(k0, relax / 95)
            # and the fingers lie together (a hand with every finger fanned out reads as a claw)
            pull = -math.copysign(conv, FINGER_DL[sfx][fname]) * max(.6, min(1, k))
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
        tk = min(1.0, (max(curl, 14) * .45 if thumb is None else thumb) / 55)
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


def unlean(pt, pitch_deg):
    """undo a forward lean of the trunk (about the hips) so a target stays put in the world"""
    th = math.radians(-pitch_deg)
    piv = REST["hips"][0]
    r = V(pt) - piv
    return piv + V((r.x, r.y * math.cos(th) - r.z * math.sin(th), r.y * math.sin(th) + r.z * math.cos(th)))


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


RUN_ST = .27  # the share of the cycle each foot is on the ground (the rest: swing; two flights)
RUN_F0, RUN_B0 = .34, .58  # ankle ahead of the hips at touch-down / behind them at toe-off
# where the ankle goes during the swing (u 0..1 from toe-off to touch-down): forward of the hips,
# height above the ground, toe-down pitch of the foot in degrees
RUN_SWING = [
    (0.00, -RUN_B0, .07, 34),
    (0.20, -0.50, .27, 50),   # the heel comes up behind (a runner's, not a cartoon butt-kick)
    (0.44, -0.16, .38, 28),   # folded under the hips
    (0.66, 0.24, .29, 4),     # the knee comes through, the shin swings out
    (0.85, 0.40, .11, -10),   # reaching
    (1.00, RUN_F0, .0, -8),   # pawing back onto the ground, heel first
]


def run_foot(tt):
    """the ankle through one running stride: (forward of the hips, height, foot pitch)"""
    if tt < RUN_ST:
        # planted: it slides straight back under the body (it is the body that moves)
        k = tt / RUN_ST
        pitch = -8 * (1 - smooth01(0, .25, k)) + 34 * smooth01(.6, 1, k)
        return RUN_F0 - (RUN_F0 + RUN_B0) * k, .13 * math.sin(math.radians(max(0.0, pitch))), pitch
    u = (tt - RUN_ST) / (1 - RUN_ST)
    keys = RUN_SWING
    vst = -(RUN_F0 + RUN_B0) / RUN_ST * (1 - RUN_ST)  # the stance speed, per unit of u
    for i in range(len(keys) - 1):
        u0, f0, h0, p0 = keys[i]
        u1, f1, h1, p1 = keys[i + 1]
        if u <= u1:
            w = u1 - u0
            x = (u - u0) / w

            def tan(j, c):
                if j == 0 and c == 1:
                    return vst
                if j == len(keys) - 1 and c == 1:
                    return vst
                a, b = keys[max(0, j - 1)], keys[min(len(keys) - 1, j + 1)]
                return (b[c] - a[c]) / ((b[0] - a[0]) or 1)

            def herm(c):
                y0, y1 = keys[i][c], keys[i + 1][c]
                m0, m1 = tan(i, c) * w, tan(i + 1, c) * w
                x2, x3 = x * x, x * x * x
                return y0 * (2 * x3 - 3 * x2 + 1) + m0 * (x3 - 2 * x2 + x) + y1 * (-2 * x3 + 3 * x2) + m1 * (x3 - x2)
            return herm(1), max(0.0, herm(2)), herm(3)
    return RUN_F0, 0.0, -8


def run_cycle(t_):
    """running, one stride (two steps), built from where the feet go: each foot is planted
    for a quarter of the cycle and slides straight back under the hips (so it never skids),
    rolls onto the ball and toes off, the heel comes up high behind, the knee drives forward
    and the foot reaches out and paws back onto the ground. Two flight phases: the hips are
    lowest at each mid-stance and highest in the air. The pelvis and the shoulders turn
    against each other, the trunk leans in from the ankles, the arms swing from the shoulder
    against the legs, the hands relaxed fists. Tall and driving, not crouched: the feet land
    under each hip (never on one line), the hips ride high, the body leans into the run, the
    arms come forward to chest height (elbow ~90) and back past the hip (elbow opening), carried
    a little off the body."""
    c1, s1 = math.cos(2 * math.pi * t_), math.sin(2 * math.pi * t_)
    # hips: lowest at mid-stance (left .13, right .63), highest in flight
    z = -.03 - .032 * math.cos(4 * math.pi * (t_ - RUN_ST / 2))
    sway = .007 * math.sin(2 * math.pi * (t_ - RUN_ST / 2))  # a touch over the planted foot
    pelvis_rot = 8 * -c1
    drop = 4 * -math.sin(2 * math.pi * (t_ - RUN_ST / 2 + .25))  # the swing side's hip dips in stance
    lean = 16
    p = {}
    p["hips"] = rot("hips", (ZA, pelvis_rot), (YA, drop), (XA, lean * .35))
    p["spine"] = rot("spine", (XA, lean * .35), (ZA, -pelvis_rot * 1.0))
    p["chest"] = rot("chest", (XA, lean * .2), (ZA, -pelvis_rot * 2.3 - 2 * c1), (YA, -drop * 1.1))
    p["neck"] = rot("neck", (XA, -lean * .4 + 2), (ZA, pelvis_rot * 1.1))
    p["head"] = rot("head", (XA, -lean * .5 + 3 * math.cos(4 * math.pi * (t_ - RUN_ST / 2))), (ZA, pelvis_rot * .7))
    ankle_h = REST["foot.L"][0].z
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, .5)):
        tt = (t_ + ph) % 1
        fwd, up, pitch = run_foot(tt)
        apply_pose(p)
        hip = pbones["thigh." + side].head
        target = V((sgn * .115 - sway, -fwd, ankle_h + up - z))
        foot0 = (REST["foot." + side][1] - REST["foot." + side][0]).normalized()
        flat = V((foot0.x, foot0.y, 0)).normalized()
        fdir = Matrix.Rotation(math.radians(pitch), 3, "X") @ V((flat.x, flat.y, foot0.z))
        solve_chain(p, "thigh." + side, "shin." + side, "foot." + side, target,
                    V((hip.x + sgn * .1, hip.y - 1.2, hip.z - .3)), fdir.normalized())
        # arms: against the legs, from the shoulder: forward to chest height with the elbow at ~90,
        # back past the hip with the elbow opening up
        c = math.cos(2 * math.pi * (tt - .04))
        sw = 40 * c + 4
        p["upper_arm." + side] = rot("upper_arm." + side, (YA, -sgn * 20), (XA, sw), (ZA, -sgn * 8))
        el = -(80 + 8 * max(0.0, -c) - 16 * max(0.0, c))
        p["forearm." + side] = rot("forearm." + side, (XA, el), (ZA, -sgn * 18))
        p["hand." + side] = rot("hand." + side, (XA, -10), (ZA, sgn * 6))
    hands(p, 78, 50)  # fists
    return p, (sway, 0, z)


def gait(t_, run):
    """masculine gait (GTA street walk): a wider stance with the toes out, little hip sway but
    the shoulders rolling and turning against it, the arms carried off the body and swinging
    from the shoulder with the elbows bending on the way forward, loose fists, chest up"""
    p = {}
    legf = run_leg if run else walk_leg
    arm_amp, elbow_base, elbow_amp = (40, 85, 15) if run else (27, 20, 15)
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, .5)):
        tt = (t_ + ph) % 1
        hip, knee, ankle = legf(tt)
        p["thigh." + side] = rot("thigh." + side, (XA, hip), (YA, sgn * (1.5 if run else 3.2)), (ZA, sgn * (4 if run else 6)))
        p["shin." + side] = rot("shin." + side, (XA, knee))
        p["foot." + side] = rot("foot." + side, (XA, ankle), (ZA, sgn * (6 if run else 11)))
        c = math.cos(2 * math.pi * (tt - .05))
        sw = arm_amp * c - (8 if run else 4)
        p["upper_arm." + side] = rot("upper_arm." + side, (YA, -sgn * (8 if run else 13)), (XA, sw), (ZA, -sgn * (6 if run else 9)))
        el = -(elbow_base + elbow_amp * max(0.0, -math.cos(2 * math.pi * (tt - .12))))
        p["forearm." + side] = rot("forearm." + side, (XA, el), (ZA, -sgn * (14 if run else 10)))
        p["hand." + side] = rot("hand." + side, (XA, -8 if run else -4))
    c1, s1 = math.cos(2 * math.pi * t_), math.sin(2 * math.pi * t_)
    pelvis_rot = (6 if run else 4) * -c1
    oblique = (1.5 if run else 1.2) * -s1
    lean = 13 if run else 4
    roll = 0 if run else 2.6 * s1  # the walk's swagger: the shoulders dip toward the planted foot
    p["hips"] = rot("hips", (ZA, pelvis_rot), (YA, oblique), (XA, lean * .3))
    p["spine"] = rot("spine", (XA, lean * .35), (ZA, -pelvis_rot * 1.0))
    p["chest"] = rot("chest", (XA, lean * .2 - (0 if run else 4)), (ZA, -pelvis_rot * (2.2 if run else 2.6) - (2 if run else 4) * c1), (YA, -oblique * 1.2 + roll))
    p["neck"] = rot("neck", (XA, -lean * .35 + 2), (ZA, pelvis_rot * 1.2))
    p["head"] = rot("head", (XA, -lean * .45 + (1.5 if not run else 2.5) * math.cos(4 * math.pi * t_)), (ZA, pelvis_rot * .8))
    hands(p, 45 if run else 36)
    z = .035 * math.cos(4 * math.pi * (t_ - .4)) - .055 if run else -.026 * math.cos(4 * math.pi * t_) - .018
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
    """Orthodox guard (boxing basics): bladed stance, chin tucked, elbows in to cover the ribs,
    lead fist ~25cm in front of the face at cheekbone height, rear fist by the cheek.
    lead/cross 0..1 drive the jab/cross straight down the centre line to the other man's head
    (fighters square up ~1.1 m apart), the fist turning palm-down. The power comes up from the
    floor: the hips turn first, the shoulders follow, the arm snaps out last; on the cross the
    rear heel pivots out and the weight goes onto the lead leg, on the jab a short step in."""
    p = {}
    trunk = -26 + 62 * cross - 16 * lead
    hips_z, spine_z, chest_z = trunk * .45 + 8 * cross, trunk * .3, trunk * .35
    total = hips_z + spine_z + chest_z
    # tall in the guard, only a little forward over the lead leg (a boxer never leans back into
    # his guard, nor hunches over it); the punches lean in a touch more as the weight transfers
    hips_x, spine_x, chest_x = 5 + 4 * cross + 2 * lead, 4 + 7 * cross + 6 * lead, 2 - 12 * recoil
    p["hips"] = rot("hips", (ZA, hips_z), (XA, hips_x))
    p["spine"] = rot("spine", (XA, spine_x), (ZA, spine_z))
    p["chest"] = rot("chest", (XA, chest_x), (ZA, chest_z))
    p["neck"] = rot("neck", (XA, -15 * recoil), (ZA, -total * .45))
    p["head"] = rot("head", (XA, -2 - 22 * recoil), (ZA, -total * .45))
    face_y = NOSE.y
    pitch = hips_x + spine_x + chest_x

    def body(pt):
        # targets are given in the world (the other man's head): undo the trunk's lean, then its turn
        return to_torso(unlean(pt, pitch), total)

    # the hand that isn't punching comes back to the chin (the jab hand on a cross, and the other way);
    # the punches go out at the other man's face
    lead_w = V((.09, face_y - .27, EYE_Z - .11)).lerp(V((.01, face_y - .66, EYE_Z - .06)), lead)
    lead_w = lead_w.lerp(V((.07, face_y - .12, EYE_Z - .11)), cross)
    rear_w = V((-.095, face_y - .11, EYE_Z - .13)).lerp(V((.0, face_y - .68, EYE_Z - .06)), cross)
    p.update(arm_ik("L", body(lead_w), body(V((.32, -.05, BELT_Z + .05 + .3 * lead))), -78 * lead))
    p.update(arm_ik("R", body(rear_w), body(V((-.32, .02, BELT_Z + .05 + .3 * cross))), 78 * cross))
    # the feet stay planted on the floor (leg IK), shoulder width apart: the lead foot a short step
    # ahead, toes in a touch, the rear one behind and turned out. The jab steps the lead foot in
    # and drags the rear after it; on the cross the rear heel comes up and pivots out.
    off = (0, .02 + .05 * recoil - .14 * lead - .13 * cross, -.07 - .015 * bounce - .02 * cross)
    ankle_h = REST["foot.L"][0].z
    feet = (("L", 1, .13, -.17 - .12 * lead, -8, 0.0), ("R", -1, -.13, .21 - .06 * lead, 38 + 20 * cross, 30 * cross))
    for side, sgn, fx, fy, toe_out, heel in feet:
        apply_pose(p)
        hip = pbones["thigh." + side].head
        target = V((fx - off[0], fy - off[1], ankle_h + .13 * math.sin(math.radians(heel)) - off[2]))
        foot0 = (REST["foot." + side][1] - REST["foot." + side][0]).normalized()
        flat = V((foot0.x, foot0.y, 0)).normalized()
        fdir = Matrix.Rotation(math.radians(sgn * toe_out), 3, "Z") @ Matrix.Rotation(math.radians(heel), 3, "X") @ V((flat.x, flat.y, foot0.z))
        solve_chain(p, "thigh." + side, "shin." + side, "foot." + side, target,
                    V((hip.x + sgn * .12, hip.y - 1.2, hip.z - .3)), fdir.normalized())
    hands(p, 96, 55)
    return p, off


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


KD_ARM_OUT = 55.0

# how far each joint must stay above the ground (the flesh around it): ankles, wrists, the head
CLEARANCE = {"foot.L": .06, "foot.R": .06, "hand.L": .03, "hand.R": .03, "head": .1, "hips": .1}


def ground_lift(pose, off):
    """raise a root offset just enough that no joint of the pose sinks into the ground"""
    apply_pose(pose)
    pts = [(pbones[b].head.z, c) for b, c in CLEARANCE.items() if b in pbones]
    if "head" in pbones:
        pts.append((pbones["head"].tail.z, .04))  # the crown
    need = max(c - (z + off[2]) for z, c in pts)
    return (off[0], off[1], off[2] + max(0.0, need))


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
        p["upper_arm." + side] = rot("upper_arm." + side, (XA, -60 * s_back * (1 - fall)), (ZA, -sgn * (20 * s_back + KD_ARM_OUT * fall)))
        p["forearm." + side] = rot("forearm." + side, (XA, -40 * s_back * (1 - fall) - 18 * fall))
        lead = side == "L"
        p["thigh." + side] = rot("thigh." + side, (XA, (20 if lead else -15) * s_back * (1 - fall) - 10 * fall * (1 if lead else .3)), (ZA, sgn * 10 * fall))
        p["shin." + side] = rot("shin." + side, (XA, 45 * math.sin(math.pi * min(1, t_ / .65)) + (25 if lead else 5) * fall))
        p["foot." + side] = rot("foot." + side, (XA, 20 * fall), (ZA, sgn * 15))
    hands(p, 30)
    hip_h = REST["hips"][0].z
    return p, ground_lift(p, (0, .1 * s_back + .48 * fall, -(hip_h - .13) * fall + bounce))


GETUP_CACHE = {}


def feet_down(pose):
    """how far to lower the hips so the lower ankle of this pose sits at its standing height"""
    apply_pose(pose)
    low = min(pbones["foot.L"].head.z, pbones["foot.R"].head.z)
    rest = min(REST["foot.L"][0].z, REST["foot.R"][0].z)
    return rest - low


def get_up(t_):
    """from flat on the back (the end of KnockDown) back onto the feet: sit up with the hands
    behind on the ground, pull the feet in to a crouch, stand up. Key poses blended in turn."""
    key = round(t_, 3)
    if key in GETUP_CACHE:
        return GETUP_CACHE[key]
    hip_h = REST["hips"][0].z
    k0, o0 = knockdown(1.0)
    k1 = {"hips": rot("hips", (XA, -14)), "spine": rot("spine", (XA, 20)), "chest": rot("chest", (XA, 10)),
          "neck": rot("neck", (XA, 4)), "head": rot("head", (XA, -4))}
    k2 = {"hips": rot("hips", (XA, 30)), "spine": rot("spine", (XA, 16)), "chest": rot("chest", (XA, 8)),
          "neck": rot("neck", (XA, -8)), "head": rot("head", (XA, -10))}
    for side, sgn in (("L", 1), ("R", -1)):
        # sitting: legs out in front, knees a little up, hands propped behind
        k1["thigh." + side] = rot("thigh." + side, (XA, -112 if side == "R" else -76), (ZA, sgn * 8))
        k1["shin." + side] = rot("shin." + side, (XA, 100 if side == "R" else 6))
        k1["foot." + side] = rot("foot." + side, (XA, 12))
        k1["upper_arm." + side] = rot("upper_arm." + side, (XA, 38), (ZA, -sgn * 22))
        k1["forearm." + side] = rot("forearm." + side, (XA, -8))
        # crouch: feet under the hips, arms forward for balance
        k2["thigh." + side] = rot("thigh." + side, (XA, -100), (ZA, sgn * 12))
        k2["shin." + side] = rot("shin." + side, (XA, 118))
        k2["foot." + side] = rot("foot." + side, (XA, -16))
        k2["upper_arm." + side] = rot("upper_arm." + side, (XA, -40), (ZA, -sgn * 14))
        k2["forearm." + side] = rot("forearm." + side, (XA, -30))
    hands(k1, 25)
    hands(k2, 35)
    # sitting on the floor: the seat on the ground (not propped up on the bent leg), lifted only as
    # far as needed to keep the heels and hands out of it
    o1 = ground_lift(k1, (0, o0[1], .13 - hip_h))
    o2 = (0, o0[1] * .35, feet_down(k2))
    k3, o3 = idle(0.0)
    keys = ((0, k0, o0), (.3, k1, o1), (.66, k2, o2), (1, k3, o3))
    for (ta, ka, oa), (tb, kb, ob) in zip(keys, keys[1:]):
        if t_ <= tb:
            u = smooth01(ta, tb, t_)
            break
    p = {}
    for name in set(ka) | set(kb):
        p[name] = ka.get(name, Quaternion()).slerp(kb.get(name, Quaternion()), u)
    off = ground_lift(p, tuple(a + (b - a) * u for a, b in zip(oa, ob)))  # between key poses too
    GETUP_CACHE[key] = (p, off)
    return p, off


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
    return p, ground_lift(p, (0, 0, (h - hip_h) * tuck))


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


def loop_spline(keys, x):
    """closed Catmull-Rom through (time, Vector) keys on a 0..1 loop (times ascending)"""
    n = len(keys)
    for i in range(n):
        t0, p0 = keys[i]
        t1, p1 = keys[(i + 1) % n]
        span = (t1 - t0) % 1 or 1.0
        if (x - t0) % 1 <= span:
            u = ((x - t0) % 1) / span
            tm, pm = keys[i - 1]
            t2, p2 = keys[(i + 2) % n]
            # tangents scaled to this span (non-uniform Catmull-Rom)
            m0 = (p1 - pm) * (span / (((t1 - tm) % 1) or 1.0))
            m1 = (p2 - p0) * (span / (((t2 - t0) % 1) or 1.0))
            u2, u3 = u * u, u * u * u
            return p0 * (2 * u3 - 3 * u2 + 1) + m0 * (u3 - 2 * u2 + u) + p1 * (-2 * u3 + 3 * u2) + m1 * (u3 - u2)
    return keys[0][1].copy()


# hand path of one arm through a front-crawl stroke, relative to the shoulder, in the body's
# frame: (toward the head, down into the water, out to the side) in metres; phase 0 = entry
CRAWL_HAND = [
    (0.00, V((0.40, 0.10, 0.03))),    # entry: in front of the shoulder, fingertips first
    (0.10, V((0.60, 0.20, 0.05))),    # reach: arm long under the surface
    (0.22, V((0.48, 0.40, 0.09))),    # catch: the hand drops, the elbow stays high
    (0.36, V((0.10, 0.50, -0.07))),   # pull: under the chest toward the centre line
    (0.50, V((-0.30, 0.40, -0.01))),  # push: back past the hip
    (0.60, V((-0.55, 0.16, 0.09))),   # finish by the thigh
    (0.67, V((-0.48, -0.14, 0.15))),  # exit, little finger first
    (0.80, V((-0.10, -0.34, 0.24))),  # recovery: over the water, elbow high, the hand below it
    (0.92, V((0.26, -0.24, 0.14))),   # the hand swings past the head
]
SWIM_ROLL = 38.0  # body roll each way, degrees


def swim(t_):
    """front crawl, one full cycle (a stroke with each arm), the body flat under the surface:
    the body rolls ~40 degrees each way about its long axis with the strokes, each hand
    follows the real path (entry, reach, high-elbow catch, pull under the body, push to the
    thigh, exit, high-elbow recovery), the head turns to breathe on every second stroke and a
    six-beat flutter kick runs from the hips with pointed toes. The game puts the hips just
    under the waterline (the root offset lifts them from standing height)."""
    hip_h = REST["hips"][0].z
    roll = SWIM_ROLL * math.sin(2 * math.pi * (t_ - .05))
    breathe = bump(t_, .3, .1)  # head out to the right as the right arm recovers
    # the body's frame without the roll: the hands pull along the centre line while it rolls
    apply_pose({"hips": rot("hips", (XA, 82))})
    H = (pbones["neck"].head - pbones["hips"].head).normalized()
    L = V((1, 0, 0))
    F = L.cross(H).normalized()  # belly side: down into the water
    p = {"hips": rot("hips", (XA, 82), (ZA, roll))}
    p["spine"] = rot("spine", (XA, -3), (ZA, .15 * roll))
    p["chest"] = rot("chest", (XA, -3), (ZA, .1 * roll))
    p["neck"] = rot("neck", (XA, -22 + 6 * breathe), (ZA, -.25 * roll - 30 * breathe))
    p["head"] = rot("head", (XA, -14 + 8 * breathe), (ZA, -.2 * roll - 38 * breathe))
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, 0.5)):
        # six-beat kick: three kicks per leg per cycle, the knee bends just before each down-beat
        k = math.sin(6 * math.pi * t_ + (0 if side == "L" else math.pi))
        kb = max(0.0, math.sin(6 * math.pi * t_ + (0 if side == "L" else math.pi) + 1.3))
        p["thigh." + side] = rot("thigh." + side, (XA, -5 - 8 * k), (ZA, sgn * 3))
        p["shin." + side] = rot("shin." + side, (XA, 6 + 18 * kb))
        p["foot." + side] = rot("foot." + side, (XA, 48 + 8 * k), (ZA, -sgn * 6))
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, 0.5)):
        a = (t_ + ph) % 1
        apply_pose(p)
        S = pbones["upper_arm." + side].head.copy()
        out = L * sgn
        h = loop_spline(CRAWL_HAND, a)
        target = S + H * h.x + F * h.y + out * h.z
        rec = smooth01(.6, .7, a) - smooth01(.94, 1.0, a)  # the arm is out of the water
        pole = S + out * (.5 - .25 * rec) - F * (.5 + .7 * rec) + H * (.2 - .5 * rec)
        hand_dir = (H * (.6 - 1.2 * smooth01(.2, .55, a)) + F * (.8 - .9 * rec)).normalized()
        solve_chain(p, "upper_arm." + side, "forearm." + side, "hand." + side, target, pole, hand_dir, roll=(0, 0, -sgn * 70 * (1 - rec)))
    hands(p, 6, 8)
    return p, (0, 0, .25 - hip_h + .015 * abs(math.sin(2 * math.pi * t_)))


def tread(t_):
    """treading water, upright with the head out: the hands scull out and in just under the
    surface, the legs work a slow eggbeater (alternate circles from bent knees)"""
    hip_h = REST["hips"][0].z
    s1 = math.sin(2 * math.pi * t_)
    p = {"hips": rot("hips", (XA, 12))}
    p["spine"] = rot("spine", (XA, -4))
    p["chest"] = rot("chest", (XA, -6))
    p["neck"] = rot("neck", (XA, -4))
    p["head"] = rot("head", (XA, -3), (ZA, 4 * s1))
    for side, sgn, ph in (("L", 1, 0.0), ("R", -1, 0.5)):
        c = math.cos(2 * math.pi * (t_ + ph))
        p["thigh." + side] = rot("thigh." + side, (XA, -48 + 10 * c), (ZA, sgn * (24 + 8 * math.sin(2 * math.pi * (t_ + ph)))))
        p["shin." + side] = rot("shin." + side, (XA, 80 + 18 * c))
        p["foot." + side] = rot("foot." + side, (XA, -10 + 10 * c))
    apply_pose(p)
    for side, sgn in (("L", 1), ("R", -1)):
        S = pbones["upper_arm." + side].head
        sweep = .5 + .5 * math.sin(4 * math.pi * t_)  # two sculls a cycle: out, in
        target = V((S.x + sgn * (.22 + .2 * sweep), S.y - .25, S.z - .16))
        solve_chain(p, "upper_arm." + side, "forearm." + side, "hand." + side, target,
                    V((S.x + sgn * .8, S.y + .4, S.z - .2)), V((sgn * (.3 + .6 * sweep), -1, -.2)).normalized(), roll=(0, 0, -sgn * (60 - 120 * sweep)))
    hands(p, 6, 8)
    # the head just out of the water: the hips well below the swim depth
    return p, (0, 0, -.12 - hip_h + .025 * math.sin(4 * math.pi * t_))


def dance(t_):
    """club dance, four beats a cycle: a knee bounce on every beat, the hips sway and twist
    over the bar, the fists pump in front of the chest (left and right in turn), and for the
    second half of the bar both hands go up and pump overhead. The head nods on the beat."""
    b = .5 - .5 * math.cos(8 * math.pi * t_)  # 0 standing tall .. 1 knees bent, four times a cycle
    sw = math.sin(2 * math.pi * t_)
    up = smooth01(.42, .56, t_) - smooth01(.9, 1.0, t_)  # hands overhead in the second half
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        load = .5 + .5 * sgn * sw  # the weight goes onto this leg as the hips sway over it
        p["thigh." + side] = rot("thigh." + side, (XA, -10 * b - 4 * load), (YA, -sgn * 3), (ZA, sgn * 7))
        p["shin." + side] = rot("shin." + side, (XA, 20 * b + 8 * load))
        p["foot." + side] = rot("foot." + side, (XA, -10 * b - 4 * load), (ZA, sgn * 8))
    p["hips"] = rot("hips", (YA, 12 * sw), (ZA, 5 * sw))
    p["spine"] = rot("spine", (XA, 4 + 4 * b), (YA, -6 * sw))
    p["chest"] = rot("chest", (XA, 2 - 4 * up), (YA, -6 * sw), (ZA, -4 * sw))
    p["neck"] = rot("neck", (XA, 4 + 6 * b - 6 * up))
    p["head"] = rot("head", (XA, 3 + 8 * b - 6 * up), (ZA, 5 * sw))
    for sfx, sgn, ph in ((".L", 1, 0.0), (".R", -1, math.pi)):
        g = .5 + .5 * math.sin(8 * math.pi * t_ + ph)  # pump, alternating with the other fist
        low = V((sgn * .2, -.24, BELT_Z + .08))
        high = V((sgn * .17, -.34, BELT_Z + .42))
        front = low.lerp(high, g)
        top = V((sgn * (.2 + .04 * g), -.12, BELT_Z + .78 + .14 * g))
        wrist = front.lerp(top, up)
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sgn * .7, .3, BELT_Z + .1 + .5 * up)), V((sgn * .15, -1, .4 + .6 * up)).normalized(), roll=(0, 0, -sgn * 40))
    hands(p, 85)
    return p, (.035 * sw, 0, -.03 * b)


def bench_press(t_):
    """lying on the gym bench, face up, pressing a bar: down to the chest, a short pause,
    then up until the arms are straight. The game sets him on the bench (the hips are lifted
    to bench height by the root offset) and moves the bar with his hands."""
    hip_h = REST["hips"][0].z
    k = smooth01(.0, .4, t_) - smooth01(.55, 1.0, t_)  # 0 bar on the chest .. 1 arms locked out
    p = {"hips": rot("hips", (XA, -90))}
    p["spine"] = rot("spine", (XA, 3))
    p["neck"] = rot("neck", (XA, 8))
    p["head"] = rot("head", (XA, 10 + 4 * (1 - k)))
    for side, sgn in (("L", 1), ("R", -1)):
        # thighs along the bench, knees over the end, feet flat on the floor either side
        p["thigh." + side] = rot("thigh." + side, (XA, 4), (ZA, sgn * 16))
        p["shin." + side] = rot("shin." + side, (XA, 88))
        p["foot." + side] = rot("foot." + side, (XA, -8))
    apply_pose(p)
    for sfx, sgn in ((".L", 1), (".R", -1)):
        sh = pbones["upper_arm" + sfx].head
        wrist = V((sh.x + sgn * .16, sh.y - .02, sh.z + .12 + .46 * k))
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sh.x + sgn * .8, sh.y - .1, sh.z - .3)), V((0, .15, 1)).normalized(), roll=(0, 0, -sgn * 90))
    hands(p, 80)
    # the back on the bench top (0.45 m): the spine sits ~0.13 m above it
    return p, (0, 0, .58 - hip_h)


def jump(t_):
    """in the air: knees drawn up (the leading one higher), arms up and out for balance,
    a slow drift so a long fall doesn't freeze"""
    s = math.sin(2 * math.pi * t_)
    p = {
        "thigh.L": rot("thigh.L", (XA, -62 - 4 * s), (ZA, 6)), "shin.L": rot("shin.L", (XA, 78 + 4 * s)), "foot.L": rot("foot.L", (XA, 20)),
        "thigh.R": rot("thigh.R", (XA, -28 + 3 * s), (ZA, -6)), "shin.R": rot("shin.R", (XA, 70)), "foot.R": rot("foot.R", (XA, 28)),
        "upper_arm.L": rot("upper_arm.L", (XA, -28 - 4 * s), (ZA, 6)), "upper_arm.R": rot("upper_arm.R", (XA, -22 + 4 * s), (ZA, -8)),
        "forearm.L": rot("forearm.L", (XA, -42), (ZA, -12)), "forearm.R": rot("forearm.R", (XA, -48), (ZA, 12)),
        "hips": rot("hips", (XA, 6)),
        "spine": rot("spine", (XA, 10)), "chest": rot("chest", (XA, 4)), "neck": rot("neck", (XA, -6)), "head": rot("head", (XA, -8)),
    }
    hands(p, 30)
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
JACK_FOREARM_ROLL = 70.0


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
    # The hero faces the open door (-Y), the car's rear is on his right (-X). Both hands go
    # in to the driver, grab, pull him up to the chest, then sling him out to the right and
    # back the way the game throws him; the hands always stay in front of the body.
    r = smooth01(0, .3, t_)  # reach in
    y = smooth01(.38, .58, t_)  # pull to the chest
    w = smooth01(.58, .78, t_)  # sling to the right
    b = smooth01(.82, 1, t_)  # let go, back to standing
    into = V((0, -.74, .24))
    pull = V((-.06, -.36, .4))
    sling = V((-.34, -.4, .4))
    for sfx, sgn in ((".L", 1), (".R", -1)):
        rest = V((sgn * .22, -.05, -.2))
        # side by side as they hold the driver; slinging, the left hand ends a little ahead
        held = into.lerp(pull, y).lerp(sling, w) + V((sgn * (.11 - .06 * w), -sgn * .06 * w, 0))
        tgt = rest.lerp(held, r).lerp(rest, b)
        # elbows back and down while pulling, down while slinging (the left arm crosses in front)
        pole = HIPS0 + V((sgn * .5, .3, -.1)).lerp(V((sgn * .1 - .2, -.1, -.45)), w)
        # the wrist stays in line with the forearm (no hand_dir: a fixed one bent it 90 degrees);
        # the forearm turns the palms down / in towards each other as they take hold of him
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, HIPS0 + tgt, pole, None,
                    roll=(0, JACK_FOREARM_ROLL * sgn * min(1, r + y), 0))
    k = 1 - b
    p["spine"] = rot("spine", (XA, (16 * r - 10 * y) * k), (YA, -12 * w * k))
    p["chest"] = rot("chest", (XA, (8 * r - 4 * y) * k), (YA, -18 * w * k))
    p["neck"] = rot("neck", (YA, 10 * w * k))
    p["thigh.R"] = rot("thigh.R", (XA, 16 * y * k), (ZA, -8))
    p["thigh.L"] = rot("thigh.L", (XA, -14 * r * (1 - y) * k), (ZA, 8))
    p["shin.L"] = rot("shin.L", (XA, 18 * r * (1 - y) * k))
    hands(p, 30 + 65 * smooth01(.28, .36, t_) * (1 - smooth01(.78, .84, t_)))  # fists full of his jacket
    off = (-.05 * w * k, (-.12 * r + .14 * y) * k, -.03 * r * (1 - y) * k)
    DOOR_CACHE["jp"][key] = (p, off)
    return p, off


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


def arcade(t_):
    """at an arcade cabinet: leaning in a little, the right hand on the joystick working it round,
    the left hand tapping the fire buttons, eyes on the screen"""
    s1, c1 = math.sin(2 * math.pi * t_), math.cos(2 * math.pi * t_)
    tap = max(0.0, math.sin(8 * math.pi * t_)) ** 3
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * 6), (XA, -3))
        p["shin." + side] = rot("shin." + side, (XA, 6))
        p["foot." + side] = rot("foot." + side, (XA, -3), (ZA, sgn * 7))
    p["hips"] = rot("hips", (XA, 4), (YA, 2 * s1))
    p["spine"] = rot("spine", (XA, 7))
    p["chest"] = rot("chest", (XA, 4), (ZA, -2 * s1))
    p["neck"] = rot("neck", (XA, 4))
    p["head"] = rot("head", (XA, 6), (ZA, 2 * c1))
    deck = BELT_Z + .02  # the control deck, just above the belt
    for sfx, sgn in ((".L", 1), (".R", -1)):
        if sgn < 0:  # the stick: small circles
            wrist = V((-.11 + .025 * c1, -.36 + .02 * s1, deck + .06))
        else:  # the buttons: quick taps
            wrist = V((.13, -.38, deck + .04 - .025 * tap))
        solve_chain(p, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist,
                    V((sgn * .6, .25, BELT_Z + .1)), V((sgn * .15, -1, -.35)).normalized(), roll=(0, 0, -sgn * 10))
    hands(p, 62, 40)
    return p, (0, 0, -.005)


def darts(t_):
    """darts: aim with the dart by the eye (a little wobble), draw the forearm back, throw (the
    elbow stays up, the forearm snaps forward and the hand follows through), back to aim"""
    s1 = math.sin(2 * math.pi * t_)
    draw = smooth01(.5, .62, t_) * (1 - smooth01(.62, .7, t_))
    throw = smooth01(.62, .72, t_) * (1 - smooth01(.8, 1.0, t_))
    p = {}
    for side, sgn in (("L", 1), ("R", -1)):
        p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5), (ZA, sgn * 7), (XA, -6 if side == "R" else 3))
        p["shin." + side] = rot("shin." + side, (XA, 4))
        p["foot." + side] = rot("foot." + side, (XA, -3), (ZA, sgn * 7))
    p["hips"] = rot("hips", (YA, 14), (XA, 3))
    p["spine"] = rot("spine", (XA, 5 + 4 * throw), (YA, -6))
    p["chest"] = rot("chest", (XA, 3 + 3 * throw), (YA, -6))
    p["neck"] = rot("neck", (XA, 2), (YA, -3))
    p["head"] = rot("head", (XA, 1), (YA, -2))
    shoulder_z = REST["upper_arm.R"][0].z
    aim = V((-.12 + .006 * s1, -.3, shoulder_z + .14 + .006 * math.cos(3 * math.pi * t_)))
    back = V((-.13, -.14, shoulder_z + .16))
    out = V((-.1, -.62, shoulder_z + .08))
    wrist = aim.lerp(back, draw).lerp(out, throw)
    solve_chain(p, "upper_arm.R", "forearm.R", "hand.R", wrist, V((-.55, .05, shoulder_z - .3)),
                V((.05, -1, .25 - .55 * throw)).normalized(), roll=(0, 0, 15))
    # the other arm hangs easy
    solve_chain(p, "upper_arm.L", "forearm.L", "hand.L", V((.24, -.12, BELT_Z - .12)), V((.6, .3, BELT_Z + .2)),
                V((.2, -.4, -1)).normalized(), roll=(0, 0, -20))
    hands(p, 58, 50)
    return p, (0, 0, 0)


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
        make_action("Run", 21, run_cycle, 1),
        make_action("Jump", 40, jump, 4),
        make_action("Drive", 90, drive, 6),
        make_action("Guard", 36, guard, 3),
        make_action("PunchL", 12, punch_l, 1),
        make_action("PunchR", 15, punch_r, 1),
        make_action("Hit", 16, hit, 1),
        make_action("KnockDown", 42, knockdown, 1),
        make_action("GetUp", 48, get_up, 1),
        make_action("Swim", 54, swim, 1),
        make_action("Tread", 60, tread, 2),
        make_action("Dance", 60, dance, 1),
        make_action("Arcade", 60, arcade, 2),
        make_action("Darts", 60, darts, 1),
        make_action("BenchPress", 60, bench_press, 2),
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
    export_attributes=True,  # the outfits' "_cov_*" skin masks
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
    shoot("head_34.png", "Idle", 0, (0.75, -0.75, EYE_Z + .12), (0, 0, EYE_Z + .02))
    shoot("head_back.png", "Idle", 0, (-.55, .8, EYE_Z + .25), (0, 0, EYE_Z + .02))
    shoot("neck_34.png", "Idle", 0, (0.32, -0.42, NECK_Z + .02), (0, 0, NECK_Z - .06))
    if HERO and "--quick" not in ARGS:
        shoot("walk_09.png", "Walk", 9, (4.0, -2.5, 1.1))
        shoot("guard.png", "Guard", 0, (2.2, -2.6, 1.4), (0, 0, 1.15))
        shoot("guard_hands.png", "Guard", 0, (0.6, -1.2, 1.45), (0, -.2, 1.35))
        shoot("fist_front.png", "Guard", 0, (-0.15, -1.0, 1.5), (0, -.3, 1.42))
        shoot("punchL.png", "PunchL", 3, (3.0, -1.2, 1.3), (0, -.2, 1.1))
        shoot("punchR.png", "PunchR", 5, (3.0, -1.2, 1.3), (0, -.2, 1.1))
        shoot("ko_end.png", "KnockDown", 42, (3.5, -1.5, 1.4), (0, .4, .2))
        for fr in (4, 8, 11, 14, 18, 22):
            shoot(f"roll_{fr:02d}.png", "Roll", fr, (3.6, -.4, 1.0), (0, 0, .55))
        for clip_, fr in (("OpenDoor", 8), ("OpenDoor", 22), ("GetIn", 16), ("GetIn", 30), ("JackPull", 9), ("JackPull", 14), ("JackPull", 18), ("JackPull", 21), ("JackPull", 24)):
            shoot(f"{clip_.lower()}_{fr}_34.png", clip_, fr, (-2.2, -2.6, 1.5), (0, -.2, .95))
        for fr in (9, 14, 18, 21):  # the hands up close: wrists, grip
            shoot(f"jackpull_{fr}_hands.png", "JackPull", fr, (-.9, -1.5, 1.45), (-.1, -.4, 1.15))
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
