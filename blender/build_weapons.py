"""
Firearms for the game's characters: model builders plus the pose maths that puts
them in the hands (imported by build_character.py; nothing runs at import time).

Weapon local frame (Blender): barrel along -Y, up +Z, the gun's right side is -X.
The origin is the centre of the pistol grip where the middle finger wraps it, so
every gun relates to the firing hand the same way (see GRIP_* below).
"""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix, Quaternion


# ------------------------------------------------------------------ materials
def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _mat(name, hexcol, rough, metal):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    rgb = [_srgb_to_lin(int(hexcol[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m


def materials():
    return {
        "GunMetal": _mat("GunMetal", "2b2d31", 0.38, 0.85),
        "Polymer": _mat("Polymer", "16171a", 0.75, 0.0),
        "Wood": _mat("Wood", "6e3f20", 0.55, 0.0),
        "GunSteel": _mat("GunSteel", "7a7e84", 0.3, 1.0),
    }


# ------------------------------------------------------------------ mesh builder
class Part:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _tag(self, geom, m):
        idx = self._mi(m)
        faces = {f for v in geom for f in v.link_faces}
        for f in faces:
            f.material_index = idx

    def box(self, c, s, m, bevel=0.0, rot=None):
        """centre c, full size s; rot = (axis, degrees) about the centre"""
        mat = Matrix.Translation(V(c))
        if rot:
            mat = mat @ Matrix.Rotation(math.radians(rot[1]), 4, rot[0])
        mat = mat @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=mat)
        self._tag(r["verts"], m)  # bevel faces inherit the material
        if bevel:
            edges = list({e for v in r["verts"] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, affect="EDGES", profile=0.5)

    def cyl(self, p0, p1, r, m, segs=16, r2=None, caps=True):
        p0, p1 = V(p0), V(p1)
        d = p1 - p0
        q = V((0, 0, 1)).rotation_difference(d.normalized())
        mat = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=d.length, matrix=mat)
        self._tag(res["verts"], m)

    def rings(self, sections, m, n=12, exp=3.0):
        """sections: list of (centre, u, hu, v, hv); superellipse rings spanned by u/v, bridged
        in order and capped at both ends"""
        rings = []
        for c, u, hu, v, hv in sections:
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                ca, sa = math.cos(a), math.sin(a)
                x = math.copysign(abs(ca) ** (2 / exp), ca) * hu
                y = math.copysign(abs(sa) ** (2 / exp), sa) * hv
                ring.append(self.bm.verts.new(V(c) + V(u) * x + V(v) * y))
            rings.append(ring)
        idx = self._mi(m)
        for a_, b_ in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                f = self.bm.faces.new((a_[i], a_[j], b_[j], b_[i]))
                f.material_index = idx
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            f = self.bm.faces.new(list(reversed(ring)) if flip else ring)
            f.material_index = idx

    def loft(self, sections, m, n=10, exp=3.0):
        """sections: (centre, half_x, half_z) along the gun, cross sections perpendicular to Y"""
        X, Z = V((1, 0, 0)), V((0, 0, 1))
        self.rings([(c, X, hx, Z, hz) for c, hx, hz in sections], m, n, exp)

    def finish(self, name, origin):
        """origin: model-space point that becomes the object origin (the grip point)"""
        bmesh.ops.translate(self.bm, vec=-V(origin), verts=self.bm.verts)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for mm in self.mats:
            me.materials.append(mm)
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def _grip_axes(tilt):
    """down the grip (top -> bottom) and its 'back' direction, both in the YZ plane"""
    t = math.radians(tilt)
    return V((0, math.sin(t), -math.cos(t))), V((0, math.cos(t), math.sin(t)))


def _grip(P, top, tilt, length, depth, width, m, grooves=None):
    """raked grip from its top centre, cross sections perpendicular to its axis, palm swell in
    the middle; grooves: material for finger ridges on the front strap"""
    top = V(top)
    down, back = _grip_axes(tilt)
    X = V((1, 0, 0))
    secs = []
    for k in range(9):
        t = k / 8
        sw = 1 + 0.1 * math.sin(math.pi * t)
        secs.append((top + down * (length * t), X, width / 2 * sw, back, depth / 2 * sw))
    P.rings(secs, m, n=16, exp=3.2)
    if grooves:
        for k in (0.3, 0.5, 0.7):
            c = top + down * (length * k) - back * (depth / 2 * 1.08)
            P.box(c, (width * 0.8, 0.004, 0.005), grooves)
    return top + down * length


# grip rake (degrees back from vertical) per weapon; the firing hand's axis is perpendicular to it
GRIP_TILT = {"pistol": 18.0, "smg": 16.0, "shotgun": 50.0}


def _grip_point(top, tilt, depth=0.034):
    return V(top) + _grip_axes(tilt)[0] * depth


def build_pistol(M):
    """~19 cm polymer-frame semi-auto. Bore at z=0.052 above the grip point."""
    P = Part()
    bz = 0.052
    # slide with ejection port, rear serrations and front sight
    P.box((0, -0.042, 0.054), (0.025, 0.186, 0.028), M["GunMetal"], bevel=0.003)
    P.box((-0.0128, -0.03, 0.06), (0.002, 0.03, 0.012), M["Polymer"])  # ejection port (right side)
    for k in range(7):
        y = 0.028 + k * 0.0042
        for sx in (1, -1):
            P.box((sx * 0.0128, y, 0.054), (0.0012, 0.0016, 0.022), M["Polymer"])
    P.cyl((0, -0.135, bz), (0, -0.131, bz), 0.0055, M["Polymer"], segs=10)  # muzzle bore
    P.box((0, -0.128, 0.0705), (0.004, 0.006, 0.006), M["GunSteel"])  # front sight
    P.box((0, 0.042, 0.0705), (0.018, 0.007, 0.006), M["GunSteel"])  # rear sight
    # frame: dust cover with rail slots, trigger guard, trigger
    P.box((0, -0.06, 0.033), (0.022, 0.12, 0.016), M["Polymer"], bevel=0.002)
    for k in range(3):
        P.box((0, -0.095 + k * 0.011, 0.0235), (0.02, 0.004, 0.003), M["Polymer"])
    P.box((0, -0.062, 0.012), (0.008, 0.006, 0.026), M["Polymer"])
    P.box((0, -0.034, -0.002), (0.008, 0.058, 0.005), M["Polymer"])
    P.box((0, -0.006, 0.012), (0.008, 0.008, 0.02), M["Polymer"])
    P.box((0, -0.030, 0.018), (0.005, 0.005, 0.02), M["GunSteel"], rot=((1, 0, 0), -15))
    # grip, beavertail, magazine base
    tilt = GRIP_TILT["pistol"]
    top = V((0, 0.022, 0.03))
    bottom = _grip(P, top, tilt, 0.105, 0.048, 0.03, M["Polymer"], grooves=M["GunSteel"])
    P.box((0, 0.05, 0.036), (0.022, 0.016, 0.01), M["Polymer"], bevel=0.002)
    P.box(bottom + V((0, 0.0, -0.004)), (0.031, 0.054, 0.008), M["GunMetal"], bevel=0.002)
    o = _grip_point(top, tilt)
    ob = P.finish("Weapon_Pistol", o)
    info = {"muzzle": V((0, -0.137, bz)) - o, "bore_z": bz - o.z, "tilt": tilt, "sec": (0.0165, 0.0264),
            "trigger": V((0, -0.031, 0.016)) - o, "index_rest": V((-0.019, -0.098, 0.032)) - o,
            "thumb": V((0.022, -0.036, 0.034)) - o}
    return ob, info


def build_smg(M):
    """compact SMG, 53 cm with the retracting stock extended, 30-round magazine."""
    P = Part()
    bz = 0.06
    # receiver with top rail
    P.box((0, -0.04, 0.062), (0.044, 0.31, 0.05), M["GunMetal"], bevel=0.004)
    P.box((0, -0.04, 0.0905), (0.02, 0.27, 0.006), M["GunSteel"])
    for k in range(10):
        P.box((0, -0.16 + k * 0.026, 0.095), (0.022, 0.012, 0.004), M["GunSteel"])
    P.box((-0.0225, -0.005, 0.07), (0.002, 0.05, 0.014), M["Polymer"])  # ejection port
    P.cyl((0.023, -0.1, 0.075), (0.032, -0.1, 0.075), 0.005, M["GunSteel"], segs=8)  # cocking handle (left)
    # barrel + flash hider
    P.cyl((0, -0.195, bz), (0, -0.235, bz), 0.011, M["GunMetal"], segs=16)
    P.cyl((0, -0.235, bz), (0, -0.255, bz), 0.014, M["GunMetal"], segs=8)
    # handguard (support hand) under the front
    P.loft([((0, -0.2, 0.035), 0.023, 0.022), ((0, -0.12, 0.033), 0.025, 0.024), ((0, -0.06, 0.035), 0.023, 0.022)], M["Polymer"], n=16)
    # sights
    P.cyl((0, 0.09, 0.105), (0, 0.11, 0.105), 0.009, M["GunSteel"], segs=10)
    P.box((0, -0.182, 0.104), (0.016, 0.01, 0.022), M["GunSteel"])
    P.box((0, -0.182, 0.1), (0.003, 0.004, 0.014), M["GunMetal"])
    # magazine in front of the trigger guard, slight curve
    for k in range(5):
        P.box((0, -0.045 - k * 0.006, 0.02 - k * 0.036), (0.022, 0.034, 0.038), M["GunMetal"], bevel=0.0015)
    P.box((0, -0.072, -0.165), (0.026, 0.04, 0.008), M["Polymer"])
    # trigger group
    P.box((0, 0.004, 0.034), (0.03, 0.08, 0.016), M["Polymer"], bevel=0.002)
    P.box((0, -0.006, 0.016), (0.008, 0.04, 0.004), M["Polymer"])
    P.box((0, -0.024, 0.024), (0.006, 0.004, 0.018), M["Polymer"])
    P.box((0, -0.012, 0.026), (0.005, 0.005, 0.016), M["GunSteel"], rot=((1, 0, 0), -15))
    # pistol grip
    tilt = GRIP_TILT["smg"]
    top = V((0, 0.03, 0.03))
    _grip(P, top, tilt, 0.1, 0.044, 0.03, M["Polymer"], grooves=M["GunSteel"])
    # retractable stock (extended): two rods + butt plate
    for z in (0.072, 0.045):
        P.cyl((0, 0.11, z), (0, 0.262, z), 0.006, M["GunSteel"], segs=8)
    P.box((0, 0.262, 0.04), (0.04, 0.02, 0.11), M["Polymer"], bevel=0.004)
    P.box((0, 0.274, 0.04), (0.042, 0.006, 0.116), M["Polymer"])  # rubber pad
    o = _grip_point(top, tilt)
    ob = P.finish("Weapon_SMG", o)
    info = {"muzzle": V((0, -0.257, bz)) - o, "grip2": V((0, -0.13, 0.033)) - o, "grip2_r": 0.0245, "grip2_back": 0.04,
            "butt": V((0, 0.277, 0.045)) - o, "bore_z": bz - o.z, "tilt": tilt, "sec": (0.0162, 0.0242),
            "trigger": V((0, -0.013, 0.024)) - o, "index_rest": V((-0.031, -0.085, 0.045)) - o, "sight_z": 0.114 - o.z,
            "thumb": V((0.031, -0.01, 0.045)) - o}
    return ob, info


def build_shotgun(M):
    """pump-action shotgun, 96 cm, wood stock with a semi-pistol grip and wood pump."""
    P = Part()
    bz = 0.058
    # receiver
    P.box((0, 0.0, 0.048), (0.034, 0.2, 0.062), M["GunMetal"], bevel=0.003)
    P.box((-0.0172, -0.01, 0.056), (0.002, 0.06, 0.02), M["Polymer"])  # ejection port
    P.box((0, 0.0, 0.0805), (0.012, 0.19, 0.004), M["GunSteel"])
    # barrel with rib + bead, tube magazine with cap
    P.cyl((0, -0.1, bz), (0, -0.555, bz), 0.0115, M["GunMetal"], segs=16)
    P.box((0, -0.33, bz + 0.0125), (0.006, 0.45, 0.003), M["GunMetal"])
    P.cyl((0, -0.548, bz + 0.016), (0, -0.552, bz + 0.016), 0.0025, M["GunSteel"], segs=6)
    P.cyl((0, -0.1, 0.026), (0, -0.49, 0.026), 0.0115, M["GunMetal"], segs=16)
    P.cyl((0, -0.49, 0.026), (0, -0.51, 0.026), 0.013, M["GunSteel"], segs=12)
    P.box((0, -0.47, 0.042), (0.012, 0.016, 0.03), M["GunMetal"])  # barrel band
    # pump (wood) with grooves
    P.cyl((0, -0.3, 0.03), (0, -0.11, 0.03), 0.026, M["Wood"], segs=18)
    for k in range(7):
        P.cyl((0, -0.285 + k * 0.025, 0.03), (0, -0.278 + k * 0.025, 0.03), 0.0272, M["GunMetal"], segs=18)
    # trigger guard + trigger
    P.box((0, 0.058, 0.009), (0.012, 0.07, 0.006), M["GunMetal"])
    P.box((0, 0.026, 0.016), (0.012, 0.006, 0.02), M["GunMetal"])
    P.box((0, 0.09, 0.016), (0.012, 0.006, 0.02), M["GunMetal"])
    P.box((0, 0.058, 0.024), (0.005, 0.005, 0.018), M["GunSteel"], rot=((1, 0, 0), -12))
    # stock: semi-pistol-grip wrist, then the butt
    tilt = GRIP_TILT["shotgun"]
    top = V((0, 0.1, 0.045))
    _grip(P, top, tilt, 0.08, 0.042, 0.034, M["Wood"])
    secs = []
    for y, zt, zb, hx in ((0.11, 0.074, 0.034, 0.016), (0.17, 0.071, 0.0, 0.018), (0.26, 0.068, -0.036, 0.02),
                          (0.32, 0.066, -0.058, 0.021), (0.386, 0.063, -0.08, 0.022)):
        secs.append(((0, y, (zt + zb) / 2), hx, (zt - zb) / 2))
    P.loft(secs, M["Wood"], n=16, exp=2.6)
    P.box((0, 0.393, -0.009), (0.044, 0.014, 0.148), M["Polymer"], bevel=0.004)  # recoil pad
    o = _grip_point(top, tilt, 0.03)
    ob = P.finish("Weapon_Shotgun", o)
    info = {"muzzle": V((0, -0.556, bz)) - o, "grip2": V((0, -0.205, 0.03)) - o, "grip2_r": 0.027, "grip2_back": 0.07,
            "butt": V((0, 0.4, 0.014)) - o, "bore_z": bz - o.z, "tilt": tilt, "sec": (0.0185, 0.0228),
            "trigger": V((0, 0.056, 0.022)) - o, "index_rest": V((-0.026, -0.03, 0.03)) - o, "sight_z": 0.074 - o.z,
            "thumb": V((0.027, 0.095, 0.052)) - o}
    return ob, info


BUILDERS = {"pistol": build_pistol, "smg": build_smg, "shotgun": build_shotgun}
NAMES = {"pistol": "Pistol", "smg": "SMG", "shotgun": "Shotgun"}


# ------------------------------------------------------------------ hands <-> gun relations
def _unit(v):
    return V(v).normalized()


def gun_basis_firing(tilt):
    """firing (right) hand frame expressed in the gun frame: the hand axis is perpendicular to
    the grip (pointing forward-down by the grip rake), palm against the gun's right side,
    index side up the grip"""
    t = math.radians(tilt)
    d = V((0, -math.cos(t), -math.sin(t)))
    palm = V((1, 0, 0))
    lv = V((0, -math.sin(t), math.cos(t)))
    return d, palm, lv


FINGER_R = 0.0095  # finger bone to the surface it holds (half-thickness, plus slack for the chords)


class Holder:
    """pose maths bound to build_character's globals (rig, REST, PALM, rot helpers...)"""

    def __init__(self, g):
        self.g = g
        self.rig = g["rig"]
        self.pb = g["pbones"]
        self.REST = g["REST"]
        self.PALM = g["PALM"]
        self.guns = {}
        self.G = (V(), Matrix.Identity(3))  # current gun placement (armature space)
        self.err = {}

    # ---- anatomical frames
    def rest_basis(self, sfx):
        h, t = self.REST["hand" + sfx]
        d = (t - h).normalized()
        palm = self.PALM[sfx]
        palm = (palm - d * palm.dot(d)).normalized()
        s = 1 if sfx == ".L" else -1
        lv = (palm.cross(d) * s).normalized()
        return d, palm, lv, h

    @staticmethod
    def basis_matrix(d, palm, lv):
        return Matrix((d, palm, lv)).transposed()  # columns

    def hand_rotation(self, sfx, d, palm):
        """armature-space rotation of the hand bone that maps its rest anatomy onto (d, palm)"""
        s = 1 if sfx == ".L" else -1
        d = _unit(d)
        palm = (palm - d * palm.dot(d)).normalized()
        lv = (palm.cross(d) * s).normalized()
        d0, p0, l0, _ = self.rest_basis(sfx)
        R = self.basis_matrix(d, palm, lv) @ self.basis_matrix(d0, p0, l0).inverted()
        return R @ self.rig.data.bones["hand" + sfx].matrix_local.to_3x3()

    # ---- grip offsets (hand frame -> gun frame)
    # firing hand: grip point = wrist + d*A + palm*B + lv*C
    GRIP_A, GRIP_B, GRIP_C = 0.056, 0.032, -0.006

    def firing_wrist_in_gun(self, info):
        d, palm, lv = gun_basis_firing(info["tilt"])
        return -(d * self.GRIP_A + palm * self.GRIP_B + lv * self.GRIP_C), (d, palm, lv)

    def to_arm(self, q):
        Pg, Rg = self.G
        return Pg + Rg @ V(q)

    def to_gun(self, p):
        Pg, Rg = self.G
        return Rg.transposed() @ (V(p) - Pg)

    # ---- placement at rest + parenting
    def attach(self, ob, info, key):
        """put the gun in the right hand at the rest pose and parent it to hand.R"""
        d0, p0, l0, wrist0 = self.rest_basis(".R")
        wg, (dg, pg, lg) = self.firing_wrist_in_gun(info)
        # rotation gun->armature such that gun-frame hand axes map onto the rest hand axes
        Rg = self.basis_matrix(d0, p0, l0) @ self.basis_matrix(dg, pg, lg).inverted()
        Pg = wrist0 - Rg @ wg
        arm = self.rig.data
        prev = arm.pose_position
        arm.pose_position = "REST"  # parent against the rest pose, whatever animation is loaded
        ob.parent = self.rig
        ob.parent_type = "BONE"
        ob.parent_bone = "hand.R"
        bpy.context.view_layer.update()
        ob.matrix_world = self.rig.matrix_world @ (Matrix.Translation(Pg) @ Rg.to_4x4())
        bpy.context.view_layer.update()
        arm.pose_position = prev
        name = NAMES[key]
        for ename, local in (("Muzzle_" + name, info["muzzle"]), ("Grip2_" + name, info.get("grip2"))):
            if local is None:
                continue
            e = bpy.data.objects.new(ename, None)
            e.empty_display_size = 0.02
            bpy.context.scene.collection.objects.link(e)
            e.parent = ob
            e.location = local
        self.guns[key] = (ob, info)

    # ---- posing
    def place_hand(self, pose, sfx, wrist, d, palm, pole):
        g = self.g
        g["solve_chain"](pose, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, wrist, pole)
        g["apply_pose"](pose)
        pbh = self.pb["hand" + sfx]
        self.err[sfx] = (pbh.head - wrist).length  # > 0 when the arm can't reach
        M3 = self.hand_rotation(sfx, d, palm)
        pbh.matrix = Matrix.Translation(pbh.head) @ M3.to_4x4()
        bpy.context.view_layer.update()
        q = pbh.rotation_quaternion.copy()
        q.normalize()
        pose["hand" + sfx] = q
        pbh.location = (0, 0, 0)
        pbh.scale = (1, 1, 1)

    def firing_hand(self, pose, key, Pg, Rg, pole):
        ob, info = self.guns[key]
        self.G = (V(Pg), Rg.copy())
        wg, (dg, pg, lg) = self.firing_wrist_in_gun(info)
        self.place_hand(pose, ".R", Pg + Rg @ wg, Rg @ dg, Rg @ pg, pole)
        return info

    def support_hand(self, pose, mid, ds, ps, pole, A=0.07):
        """left hand: palm centre (wrist + d*A) at gun-frame `mid`, axis ds, palm normal ps"""
        ds = _unit(ds)
        ps = (V(ps) - ds * V(ps).dot(ds)).normalized()
        wrist_g = V(mid) - ds * A
        self.last_support = (wrist_g, ds, ps, ps.cross(ds).normalized())
        Rg = self.G[1]
        self.place_hand(pose, ".L", self.to_arm(wrist_g), Rg @ ds, Rg @ ps, pole)

    # ---- fingers
    def finger_curls(self, pose, sfx, bends):
        """bends: {finger: (a1, a2, a3)} degrees about each phalanx's own hinge"""
        REST, PALM, rot = self.REST, self.PALM, self.g["rot"]
        for fname, (a1, a2, a3) in bends.items():
            for j, ang in ((1, a1), (2, a2), (3, a3)):
                bn = fname + str(j) + sfx
                if bn not in REST:
                    continue
                hd_, tl_ = REST[bn]
                hinge = tuple((tl_ - hd_).normalized().cross(PALM[sfx]).normalized())
                pose[bn] = rot(bn, (hinge, ang))

    def wrap(self, pose, sfx, fingers, centre, u, v, hu, hv, sense, r=FINGER_R, exp=3.0):
        """curl fingers around a rounded section of the gun (gun frame): `centre` lies on the
        section's axis (u x v), u/v span it with half sizes hu/hv. Every finger stays in the
        section plane through its knuckle and walks along the surface, offset by the finger's
        half-thickness, in the direction `sense` (+1: from u toward v)."""
        g = self.g
        u, v = _unit(u), _unit(v)
        ax = u.cross(v).normalized()
        a, b = hu + r, hv + r

        def C(c0, th):
            ca, sa = math.cos(th), math.sin(th)
            return c0 + u * (math.copysign(abs(ca) ** (2 / exp), ca) * a) + v * (math.copysign(abs(sa) ** (2 / exp), sa) * b)

        for f in fingers:
            g["apply_pose"](pose)
            p = self.to_gun(self.pb[f + "1" + sfx].head)
            c0 = V(centre) + ax * (p - V(centre)).dot(ax)
            th = min((math.radians(k) for k in range(0, 360, 3)), key=lambda t2: (C(c0, t2) - p).length)
            for j in (1, 2, 3):
                bn = f + str(j) + sfx
                if bn not in self.REST:
                    break
                # the phalanx ends on the surface one phalanx length further round (a chord)
                L = (self.REST[bn][1] - self.REST[bn][0]).length
                th = min((th + sense * math.radians(k) for k in range(-60, 121, 2)), key=lambda t2: (C(c0, t2) - p).length)
                hit, best = None, (9.0, th)
                prev = (C(c0, th) - p).length
                for k in range(1, 240):
                    t2 = th + sense * math.radians(k)
                    dd = (C(c0, t2) - p).length
                    if prev < L <= dd:
                        hit = t2
                        break
                    if dd < best[0]:
                        best = (dd, t2)
                    prev = dd
                th = hit if hit is not None else best[1]
                target = C(c0, th)
                head = self.pb[bn].head.copy()
                g["aim_pose"](pose, bn, self.to_arm(target) - head)
                g["apply_pose"](pose)
                p = self.to_gun(self.pb[bn].tail)

    def ik2(self, pose, b1, b2, target, pole):
        """two phalanges: b2's tail lands on `target` (gun frame), the joint bends toward `pole`.
        Unlike the arm solver there is no minimum reach, so short targets fold the finger."""
        g = self.g
        g["apply_pose"](pose)
        S = self.to_gun(self.pb[b1].head)
        a = (self.REST[b1][1] - self.REST[b1][0]).length
        b = (self.REST[b2][1] - self.REST[b2][0]).length
        T, P = V(target), V(pole)
        d = min(max((T - S).length, abs(a - b) + 0.002), (a + b) * 0.999)
        dn = (T - S).normalized()
        al = math.acos(max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d))))
        perp = (P - S) - dn * (P - S).dot(dn)
        perp.normalize()
        E = S + dn * (a * math.cos(al)) + perp * (a * math.sin(al))
        Rg = self.G[1]
        g["aim_pose"](pose, b1, Rg @ (E - S))
        g["aim_pose"](pose, b2, Rg @ (S + dn * d - E))

    def reach(self, pose, sfx, finger, tip, direction, pole):
        """finger IK: the last phalanx ends at `tip` pointing along `direction`, the middle joint
        bends toward `pole` (all gun frame)"""
        f1, f2, f3 = (finger + str(j) + sfx for j in (1, 2, 3))
        L3 = (self.REST[f3][1] - self.REST[f3][0]).length
        dvec = _unit(direction)
        self.ik2(pose, f1, f2, V(tip) - dvec * L3, pole)
        self.g["aim_pose"](pose, f3, self.G[1] @ dvec)

    def thumb(self, pose, sfx, tip, pole):
        """thumb tip on `tip` (gun frame), its joint bending toward `pole`"""
        if "thumb1" + sfx in self.REST:
            self.ik2(pose, "thumb1" + sfx, "thumb2" + sfx, tip, pole)

    def hand_coords(self, info, q):
        """gun-frame point -> firing-hand frame coords (a, b, c)"""
        wg, (d, p, l) = self.firing_wrist_in_gun(info)
        v = V(q) - wg
        return v.dot(d), v.dot(p), v.dot(l)

    def support_coords(self, q):
        """gun-frame point -> support-hand frame coords (a, b, c) of the last support placement"""
        wg, d, p, l = self.last_support
        v = V(q) - wg
        return v.dot(d), v.dot(p), v.dot(l)


# ------------------------------------------------------------------ weapon actions
def define_actions(H, g):
    """returns [(name, frames, fn, step)] for the hero's weapon holds/aims"""
    rot, REST = g["rot"], H.REST
    XA, YA, ZA = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    X3, Z3 = V((1, 0, 0)), V((0, 0, 1))
    EYE_Z, NOSE, BELT_Z, TORSO_Y = g["EYE_Z"], g["NOSE"], g["BELT_Z"], g["TORSO_Y"]
    body = g["body"]
    I3 = Matrix.Identity(3)

    def Rx(deg):
        return Matrix.Rotation(math.radians(deg), 3, "X")

    # shoulder pocket: front surface of the (dressed) chest between shoulder joint and sternum
    sh = REST["upper_arm.R"][0]
    px, pz = sh.x * 0.62, sh.z + 0.012
    ys = [v.co.y for v in body.data.vertices if abs(v.co.x - px) < 0.025 and abs(v.co.z - pz) < 0.025]
    pocket_rest = V((px, (min(ys) if ys else TORSO_Y - 0.12) + 0.004, pz))

    def posed(bone, pt):
        pb = H.pb[bone]
        return (pb.matrix @ H.rig.data.bones[bone].matrix_local.inverted()) @ V(pt)

    def legs(p, wide=1.0):
        for side, sgn in (("L", 1), ("R", -1)):
            p["thigh." + side] = rot("thigh." + side, (YA, -sgn * 1.5 * wide), (ZA, sgn * 7))
            p["shin." + side] = rot("shin." + side, (XA, 5))
            p["foot." + side] = rot("foot." + side, (XA, -4), (ZA, sgn * 8))

    def trunk(p, s, lean=(4, 4), yaw=0.0, neck=(2, 2), roll=0.0, wide=1.0):
        p["hips"] = rot("hips", (ZA, yaw * 0.25))
        p["spine"] = rot("spine", (XA, lean[0] + 0.6 * s), (ZA, yaw * 0.35))
        p["chest"] = rot("chest", (XA, lean[1] - 0.5 * s), (ZA, yaw * 0.4))
        p["neck"] = rot("neck", (XA, neck[0]), (ZA, -yaw * 0.5), (YA, roll * 0.4))
        p["head"] = rot("head", (XA, neck[1]), (ZA, -yaw * 0.5), (YA, roll * 0.6))
        legs(p, wide)

    def firing_fingers(p, info, trigger=True):
        down, back = _grip_axes(info["tilt"])
        hu, hv = info["sec"]
        # middle/ring/pinky wrap the grip from its right side round the front strap
        H.wrap(p, ".R", ("middle", "ring", "pinky"), V((0, 0, 0)), X3, back, hu, hv, +1)
        if trigger:
            # pad of the last phalanx across the trigger face, the middle joint off the frame
            tip = info["trigger"] + V((0.004, -0.009, -0.002))
            H.reach(p, ".R", "index", tip, V((1, 0.3, -0.05)), info["trigger"] + V((-0.07, 0.02, -0.03)))
        else:
            # straight along the frame above the trigger guard
            H.reach(p, ".R", "index", info["index_rest"], V((0, -1, 0)), info["index_rest"] + V((-0.07, 0.03, 0.0)))
        # thumb over the top of the grip, tip forward on the gun's left side
        H.thumb(p, ".R", info["thumb"], info["thumb"] + V((0.03, 0.03, 0.03)))

    def relaxed_left(p, s):
        p["upper_arm.L"] = rot("upper_arm.L", (YA, -(8 + 1.0 * s)), (XA, -4), (ZA, -8))
        p["forearm.L"] = rot("forearm.L", (XA, -18), (ZA, -10))
        p["hand.L"] = rot("hand.L", (XA, -6))
        H.finger_curls(p, ".L", {f: (22, 28, 14) for f in ("index", "middle", "ring", "pinky")})

    def pistol_aim(t):
        s = math.sin(2 * math.pi * t)
        p = {}
        trunk(p, s, lean=(6, 7), neck=(-4, 2), wide=2.0)
        ob, info = H.guns["pistol"]
        # isosceles: both arms extended, gun at eye height on the line of the right eye
        bore = V((-0.03, NOSE.y - 0.42, EYE_Z - 0.035 + 0.002 * s))
        H.firing_hand(p, "pistol", bore - V((0, 0, info["bore_z"])), I3, V((-0.5, 0.15, BELT_Z - 0.1)))
        firing_fingers(p, info)
        # support hand fills the gap on the grip's left side, canted ~45 deg, its fingers wrapped
        # over the firing fingers and the thumb forward under the firing thumb
        down, back = _grip_axes(info["tilt"])
        hu, hv = info["sec"]
        H.support_hand(p, V((0.05, -0.018, -0.02)), V((-0.2, -0.72, -0.66)), V((-1, 0.1, 0)), V((0.5, 0.15, BELT_Z - 0.1)))
        H.wrap(p, ".L", ("index", "middle", "ring", "pinky"), V((0, 0, 0)), X3, back, hu + 0.016, hv + 0.016, -1)
        sthumb = info["thumb"] + V((0.0, -0.012, -0.017))
        H.thumb(p, ".L", sthumb, sthumb + V((0.04, 0.03, -0.02)))
        return p, (0, 0, 0)

    def pistol_hold(t):
        s = math.sin(2 * math.pi * t)
        p = {}
        trunk(p, s, lean=(2, 1), neck=(1, 1))
        ob, info = H.guns["pistol"]
        # low ready: muzzle forward-down ~30 deg, finger straight along the frame
        Pg = V((-0.15, TORSO_Y - 0.3, BELT_Z + 0.12 + 0.004 * s))
        H.firing_hand(p, "pistol", Pg, Rx(32), V((-0.45, 0.25, BELT_Z + 0.05)))
        firing_fingers(p, info, trigger=False)
        relaxed_left(p, s)
        return p, (0, 0, 0)

    def long_gun(key, aim):
        def fn(t):
            s = math.sin(2 * math.pi * t)
            p = {}
            ob, info = H.guns[key]
            if aim:
                trunk(p, s, lean=(4, 7), yaw=-24, neck=(20, 12), roll=-20, wide=2.0)
                Rg = I3
            else:
                trunk(p, s, lean=(3, 4), yaw=-18, neck=(4, 2), wide=1.5)
                Rg = Rx(34)
            g["apply_pose"](p)
            pocket = posed("chest", pocket_rest)
            H.firing_hand(p, key, pocket - Rg @ info["butt"], Rg, V((-0.55, 0.3, BELT_Z + 0.2)))
            firing_fingers(p, info, trigger=aim)
            # support hand on the fore-end's lower left, fingers pointing forward-down: thumb forward along
            # the left side, fingers under it and up the right side
            r = info["grip2_r"]
            mid = info["grip2"] + V((r + 0.012, 0.0, -0.014))
            for _ in range(3):
                H.support_hand(p, mid, V((-0.15, -0.75, -0.45)), V((-1, 0.0, 0.35)), V((0.3, -0.1, BELT_Z - 0.1)))
                if H.err[".L"] < 0.003:
                    break
                mid.y += min(H.err[".L"], info["grip2_back"] - (mid.y - info["grip2"].y))  # slide back along the fore-end
            # the fingers spiral forward round the fore-end: wrap in a plane tilted 40 deg off its
            # cross section (an ellipse r x r/cos40)
            be = math.radians(40)
            w = V((0, math.sin(be), math.cos(be)))
            hv = (r + FINGER_R) / math.cos(be) - FINGER_R
            H.wrap(p, ".L", ("index", "middle", "ring", "pinky"), info["grip2"], X3, w, r, hv, -1, exp=2.0)
            st = info["grip2"] + V((r + 0.008, -0.05, 0.004))
            H.thumb(p, ".L", st, st + V((0.05, 0.02, -0.02)))
            return p, (0, 0, 0)
        return fn

    # Walking and running with a gun (GTA style, not aiming): the body is the walk / run cycle
    # (the game plays these in step with the legs), the gun in "low ready". The pistol rides in
    # the right hand: by the thigh, muzzle down, swinging a little on the walk; at the hip, muzzle
    # forward-down, pumping with the stride on the run; the left arm swings / pumps free. A long
    # gun stays in both hands across the body, the butt in the shoulder pocket, and moves with the
    # chest as it turns against the hips.
    def moving(key, run):
        def fn(t):
            p = (g["run_cycle"](t) if run else g["gait"](t, False))[0]
            g["apply_pose"](p)
            ob, info = H.guns[key]
            fwd = math.cos(2 * math.pi * (t - .05))  # 1: the right arm's forward swing
            if key == "pistol":
                if run:
                    Pg = V((-0.18, TORSO_Y - 0.24 - 0.10 * fwd, BELT_Z + 0.07 + 0.03 * fwd))
                    H.firing_hand(p, "pistol", Pg, Rx(26 - 8 * fwd), V((-0.5, 0.3, BELT_Z + 0.1)))
                else:
                    Pg = V((-0.21, TORSO_Y - 0.10 - 0.06 * fwd, BELT_Z - 0.09))
                    H.firing_hand(p, "pistol", Pg, Rx(60 - 6 * fwd), V((-0.45, 0.35, BELT_Z + 0.15)))
                firing_fingers(p, info, trigger=False)
                return p, (0, 0, 0)
            # long guns: carried across the body ("port arms"), the butt at the right hip, the muzzle
            # up and over to the left, bobbing with the stride
            bob = 0.015 * math.cos(4 * math.pi * t) * (2 if run else 1)
            butt = V((-0.16, TORSO_Y - 0.07 - (0.03 if run else 0.0), BELT_Z + 0.0 + bob))
            Rg = Matrix.Rotation(math.radians(40), 3, "Z") @ Rx(-58 if run else -54)
            H.firing_hand(p, key, butt - Rg @ info["butt"], Rg, V((-0.55, 0.25, BELT_Z + 0.05)))
            firing_fingers(p, info, trigger=False)
            r = info["grip2_r"]
            mid = info["grip2"] + V((r + 0.012, 0.0, -0.014))
            for _ in range(3):
                H.support_hand(p, mid, V((-0.15, -0.75, -0.45)), V((-1, 0.0, 0.35)), V((0.3, -0.1, BELT_Z - 0.1)))
                if H.err[".L"] < 0.003:
                    break
                mid.y += min(H.err[".L"], info["grip2_back"] - (mid.y - info["grip2"].y))
            be = math.radians(40)
            w = V((0, math.sin(be), math.cos(be)))
            hv = (r + FINGER_R) / math.cos(be) - FINGER_R
            H.wrap(p, ".L", ("index", "middle", "ring", "pinky"), info["grip2"], X3, w, r, hv, -1, exp=2.0)
            st = info["grip2"] + V((r + 0.008, -0.05, 0.004))
            H.thumb(p, ".L", st, st + V((0.05, 0.02, -0.02)))
            return p, (0, 0, 0)
        return fn

    acts = []
    if "pistol" in H.guns:
        acts += [("PistolHold", 60, pistol_hold, 6), ("PistolAim", 60, pistol_aim, 6)]
    # (the same frame counts as Walk / Run: the game drives them with the gait phase)
    for key, nm in (("pistol", "Pistol"), ("smg", "SMG"), ("shotgun", "Shotgun")):
        if key in H.guns and g.get("run_cycle"):
            acts += [(nm + "Walk", 34, moving(key, False), 1), (nm + "Run", 21, moving(key, True), 1)]
    if "smg" in H.guns:
        acts += [("SMGHold", 60, long_gun("smg", False), 6), ("SMGAim", 60, long_gun("smg", True), 6)]
    if "shotgun" in H.guns:
        acts += [("ShotgunHold", 60, long_gun("shotgun", False), 6), ("ShotgunAim", 60, long_gun("shotgun", True), 6)]
    return acts
