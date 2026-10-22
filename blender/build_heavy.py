"""
Heavy and special vehicles: ambulance, firetruck, bus, truck (tractor) + trailer, towtruck,
boat and jetski. Shares the material / primitive / text helpers of build_car.py and keeps its
conventions (material names, wheel_* objects pivoting at the hub, Body, Door_L hinged on its
front edge, seat_driver / door_driver / cam_target markers).

  blender -b --factory-startup -P blender/build_heavy.py -- <project_root> [names...] [--preview <dir>]
  (build_car.py accepts the same names and hands them over to this file)

Axes as the cars: the front faces -Y (exports as +Z in three.js), left side = +X, Z up,
origin on the ground at mid-length. Boats: origin on the waterline (z = 0) at mid-length.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

_HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "blender")
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import build_car as C  # noqa: E402  (its own build loop only runs as __main__)

V = Vector
T = C.T
ARGS = C.ARGS
ROOT = C.ROOT
PREVIEW = "--preview" in ARGS


# ------------------------------------------------------------------ section shapes
def section_pts(hw, zb, zt, zbelt, hwt, rb, rt, nb, nt):
    """closed section: flat bottom with rounded corners, vertical sides up to the belt line,
    tumblehome to the roof (half width hwt) with rounded top corners. Same point count always."""
    rb = max(0.005, min(rb, (zt - zb) * 0.3, hw * 0.45))
    rt = max(0.005, min(rt, hwt * 0.45))
    zbelt = max(zbelt, zb + rb + 0.01)
    rt = min(rt, max(0.005, zt - zbelt - 0.01))
    zbelt = min(zbelt, zt - rt - 0.005)
    right = []
    for k in range(nb + 1):
        a = -math.pi / 2 + (math.pi / 2) * k / nb
        right.append((hw - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    right.append((hw, zbelt))
    for k in range(nt + 1):
        a = (math.pi / 2) * k / nt
        right.append((hwt - rt + rt * math.cos(a), zt - rt + rt * math.sin(a)))
    left = [(-x, z) for x, z in reversed(right)]
    return [(0.0, zb)] + right + [(0.0, zt)] + left


def stations(rows, step):
    ys = []
    for a, b in zip(rows, rows[1:]):
        ys.append(a[0])
        if tuple(a[1:]) != tuple(b[1:]):
            n = max(1, int(math.ceil((b[0] - a[0]) / step - 1e-6)))
            ys += [a[0] + (b[0] - a[0]) * k / n for k in range(1, n)]
    ys.append(rows[-1][0])
    return ys


def round_ends(rows, r_front, r_back=None):
    """bevel the two end caps of a (y, hw, zb, zt, zbelt, hwt) table into a rounded edge"""
    r_back = r_front if r_back is None else r_back

    def inset(row, d, y):
        _, hw, zb, zt, zbelt, hwt = row
        return (y, hw - d, zb + d * 0.6, zt - d, zbelt, hwt - d)
    out = list(rows)
    if r_front:
        r0, r = rows[0], r_front
        out = [inset(r0, r, r0[0]), inset(r0, 0.29 * r, r0[0] + 0.29 * r), inset(r0, 0, r0[0] + r)] + out[1:]
    if r_back:
        rn, r = out[-1], r_back
        out = out[:-1] + [inset(rn, 0, rn[0] - r), inset(rn, 0.29 * r, rn[0] - 0.29 * r), inset(rn, r, rn[0])]
    return out


def hermite(rows, y):
    """smooth (cubic Hermite, finite-difference tangents) interpolation of a (y, values...) table"""
    ys = [r[0] for r in rows]
    if y <= ys[0]:
        return rows[0][1:]
    if y >= ys[-1]:
        return rows[-1][1:]
    k = max(i for i in range(len(ys) - 1) if ys[i] <= y)
    h = ys[k + 1] - ys[k]
    t = (y - ys[k]) / h
    out = []
    for j in range(1, len(rows[0])):
        def slope(i):
            if i == 0:
                return (rows[1][j] - rows[0][j]) / (ys[1] - ys[0])
            if i == len(ys) - 1:
                return (rows[i][j] - rows[i - 1][j]) / (ys[i] - ys[i - 1])
            return (rows[i + 1][j] - rows[i - 1][j]) / (ys[i + 1] - ys[i - 1])
        p0, p1, m0, m1 = rows[k][j], rows[k + 1][j], slope(k) * h, slope(k + 1) * h
        t2, t3 = t * t, t * t * t
        out.append((2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1)
    return tuple(out)


def hull_pts(zk, xc, zc, hws, zs, crown):
    """planing hull section: keel, straight deadrise to a hard chine, flared topsides to the
    sheer, rounded deck edge and a crowned (or, with crown < 0, dished) deck"""
    right = []
    for t in (1 / 3, 2 / 3):
        right.append((xc * t, zk + (zc - zk) * t))
    right.append((xc, zc))
    for t in (1 / 3, 2 / 3):
        right.append((xc + (hws - xc) * t + 0.025 * math.sin(math.pi * t) * min(1.0, hws * 3), zc + (zs - zc) * t))
    right.append((hws, zs))
    right.append((hws - 0.04 * min(1.0, hws * 4), zs + 0.03 * min(1.0, hws * 4)))
    right.append((hws * 0.5, zs + 0.03 * min(1.0, hws * 4) + (crown - 0.03 * min(1.0, hws * 4)) * 0.75))
    left = [(-x, z) for x, z in reversed(right)]
    return [(0.0, zk)] + right + [(0.0, zs + crown)] + left


def deck_z(rows, y, x):
    """height of a hull deck (hull_pts) at (y, |x|)"""
    zk, xc, zc, hws, zs, crown = hermite(rows, y)
    e = 0.03 * min(1.0, hws * 4)
    pts = [(0.0, zs + crown), (hws * 0.5, zs + e + (crown - e) * 0.75), (hws - 0.04 * min(1.0, hws * 4), zs + e), (hws, zs)]
    x = abs(x)
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return z0 + (z1 - z0) * (x - x0) / max(1e-6, x1 - x0)
    return zs


def flat_text(name, text, size, matrix, mat, res=2):
    """as build_car.make_text, but a flat (unextruded) fill: a third of the triangles; the
    materials are double-sided, so it reads from either side"""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.size = size
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.extrude = 0.0
    cu.resolution_u = res
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
    return ob


def smooth_angle(ob, deg=35):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(deg))
    except Exception as e:  # older API
        print("WARN sharp edges:", e)


# ------------------------------------------------------------------ the kit
class Kit:
    """materials, a detail bmesh, shells (lofted body parts), texts and wheels for one vehicle"""

    def __init__(self, paint, rim="c9ccd0", extra=()):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.mats, self.ix = [], {}
        self.add("Paint", paint, 0.32, 0.55, coat=1.0)
        self.add("Glass", "141a21", 0.03, 0.2, alpha=0.62)
        self.add("Trim", "111214", 0.55)
        self.add("Chrome", "d8dadc", 0.12, 1.0)
        self.add("Headlight", "e8eef5", 0.05, 0.2, emit="fff6e0", emit_str=0.0)
        self.add("Taillight", "b0141c", 0.12, 0.1, emit="ff1a10", emit_str=0.0)
        self.add("Indicator", "d27a10", 0.2, 0.1)
        self.add("Interior", "2a2b2e", 0.85)
        self.add("Plate", "e9e4cf", 0.6)
        self.add("Tire", "1e1e1f", 0.9, tex=C.tread_texture())
        self.add("Rim", rim, 0.2, 1.0)
        self.add("Brake", "4a4b4e", 0.5, 0.8)
        for name, args, kw in extra:
            self.add(name, *args, **kw)
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.verify()
        self.shells, self.texts, self.wheels, self.arches = [], [], [], {}
        self.surf = None

    def add(self, name, *a, **k):
        self.ix[name] = len(self.mats)
        self.mats.append(C.material(name, *a, **k))

    def __getitem__(self, name):
        return self.ix[name]

    # ---- primitives into the detail mesh
    def box(self, mat, x, y, z, sx, sy, sz, rx=0, ry=0, rz=0):
        C.prim(self.bm, "cube", self[mat], T(x, y, z, sx, sy, sz, rx, ry, rz))

    def cyl(self, mat, x, y, z, r, depth, axis="z", segs=12, r2=None, caps=True, rx=0, ry=0, rz=0):
        if axis == "x":
            ry += math.pi / 2
        elif axis == "y":
            rx += math.pi / 2
        C.prim(self.bm, "cyl", self[mat], T(x, y, z, rx=rx, ry=ry, rz=rz), r1=r, r2=r if r2 is None else r2, depth=depth, segs=segs, caps=caps)

    def tube(self, mat, a, b, r, segs=8, r2=None):
        a, b = V(a), V(b)
        d = b - a
        q = V((0, 0, 1)).rotation_difference(d.normalized())
        M = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        C.prim(self.bm, "cyl", self[mat], M, r1=r, r2=r if r2 is None else r2, depth=d.length, segs=segs)

    def sphere(self, mat, x, y, z, sx, sy, sz, segs=12, rings=8, rx=0, rz=0):
        C.prim(self.bm, "sphere", self[mat], T(x, y, z, sx, sy, sz, rx=rx, rz=rz), segs=segs, rings=rings)

    def torus(self, mat, x, y, z, R, r, n1=16, n2=5, rx=0, ry=0, rz=0):
        C.prim(self.bm, "torus", self[mat], T(x, y, z, rx=rx, ry=ry, rz=rz), R=R, r=r, n1=n1, n2=n2)

    def loft_y(self, mat, rows, segs=16, exp=2.6):
        """bike-style closed loft: rows (y, cx, cz, half_w, half_h), superellipse sections"""
        rings = []
        for y, cx, cz, hw, hh in rows:
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                c, s = math.cos(a), math.sin(a)
                ring.append(self.bm.verts.new((cx + math.copysign(abs(c) ** (2 / exp), c) * hw, y, cz + math.copysign(abs(s) ** (2 / exp), s) * hh)))
            rings.append(ring)
        faces = []
        for ra, rb in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                faces.append(self.bm.faces.new((ra[i], ra[j], rb[j], rb[i])))
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        faces.append(self.bm.faces.new(rings[-1]))
        for f in faces:
            f.material_index = self[mat]

    def fender(self, mat, cx, cy, cz, r, w, a0, a1, th=0.03, n=14):
        """curved mudguard over a wheel: an arc band in the YZ plane (angle 0 = ahead of the hub,
        pi/2 = on top, pi = behind), w wide, th thick, centred on x = cx"""
        rows = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            row = []
            for rr, dx in ((r + th, w / 2), (r + th, -w / 2), (r, -w / 2), (r, w / 2)):
                row.append(self.bm.verts.new((cx + dx, cy - rr * math.cos(a), cz + rr * math.sin(a))))
            rows.append(row)
        for ra, rb in zip(rows, rows[1:]):
            for k in range(4):
                f = self.bm.faces.new((ra[k], ra[(k + 1) % 4], rb[(k + 1) % 4], rb[k]))
                f.material_index = self[mat]
        for row, flip in ((rows[0], True), (rows[-1], False)):
            f = self.bm.faces.new(list(reversed(row)) if flip else row)
            f.material_index = self[mat]

    def quad(self, mat, pts):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self[mat]
        return f

    # ---- lettering
    def text(self, s, size, pos, facing, mat="Decal", mirror=False):
        Ms = {"+x": ((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)),
              "-x": ((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)),
              "-y": ((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)),
              "+y": ((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))}
        M = Matrix.Translation(pos) @ Matrix(Ms[facing])
        if mirror:
            M = M @ Matrix.Diagonal((-1, 1, 1, 1))
        ob = flat_text("txt_%d" % len(self.texts), s, size, M, self.mats[self[mat]], res=2 if size < 0.5 else 3)
        self.texts.append(ob)
        return ob

    # ---- lofted shells
    def shell(self, name, rows, rb=0.1, rt=0.15, nb=3, nt=4, step=0.1, mat="Paint"):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        npts = len(section_pts(1, 0, 1, 0.5, 1, rb, rt, nb, nt))

        def shape(y):
            hw, zb, zt, zbelt, hwt = C.interp(rows, y)
            return section_pts(hw, zb, zt, zbelt, hwt, rb, rt, nb, nt)
        C.section_loft(bm, stations(rows, step), shape, npts, uvl, self[mat])
        ob = C.to_object(name, bm, self.mats)
        self.shells.append(ob)
        return ob

    def hull(self, name, rows, step=0.1, mat="Paint"):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        n = len(hull_pts(-0.3, 0.5, 0, 1, 0.5, 0.05))
        ys = [rows[0][0] + (rows[-1][0] - rows[0][0]) * k / int((rows[-1][0] - rows[0][0]) / step) for k in range(int((rows[-1][0] - rows[0][0]) / step) + 1)]
        seg = bm.faces.layers.int.new("seg")  # segment around the section: see HULL_* below
        C.section_loft(bm, ys, lambda y: hull_pts(*hermite(rows, y)), n, uvl, self[mat], seg_layer=seg)
        ob = C.to_object(name, bm, self.mats)
        self.shells.append(ob)
        return ob

    def arch(self, ob, y, R, clr=0.09, zc=None):
        """wheel arch cut through a shell (boolean, as the cars); its faces become Trim"""
        zc = R + 0.02 if zc is None else zc
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=R + clr, depth=8, location=(0, y, zc), rotation=(0, math.pi / 2, 0))
        cutter = bpy.context.active_object
        mod = ob.modifiers.new("arch", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        mod.solver = "EXACT"
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)
        self.arches.setdefault(ob.name, []).append((y, zc, R + clr))

    def paint(self, ob, rules):
        """slice a shell along every rule boundary, then give each face the material of the first
        rule it matches (windows, frames, stripes, panels are flush with the skin: no z-fighting)"""
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        def overlaps(f, r, tol=0.03):
            for axis, sgn, thr in r.get("n", ()):  # faces facing the wrong way are never painted
                comp = getattr(f.normal, axis)
                if (abs(comp) if sgn == 0 else comp * sgn) <= thr - 0.3:
                    return False
            for ax, key in ((0, "x"), (1, "y"), (2, "z")):
                rng = r.get(key)
                if not rng:
                    continue
                a0 = min(v.co[ax] for v in f.verts)
                a1 = max(v.co[ax] for v in f.verts)
                lo = -1e9 if rng[0] is None else rng[0]
                hi = 1e9 if rng[1] is None else rng[1]
                if ax == 0 and r.get("absx"):
                    if a1 < -hi - tol or a0 > hi + tol or (lo > 0 and a0 > -lo + tol and a1 < lo - tol):
                        return False
                elif a1 < lo - tol or a0 > hi + tol:
                    return False
            return True
        # cut only the faces near each rule's box (global cuts cost a lot of triangles)
        for r in rules:
            planes = set()
            for ax, key in ((0, "x"), (1, "y"), (2, "z")):
                for v in (r.get(key) or ()):
                    if v is None:
                        continue
                    for w in ((v, -v) if (ax == 0 and r.get("absx")) else (v,)):
                        if not (ax == 0 and r.get("absx") and abs(w) < 1e-6):
                            planes.add((ax, round(w, 4)))
            for ax, v in sorted(planes):
                faces = [f for f in bm.faces if overlaps(f, r)]
                if not faces:
                    continue
                geom = list({e for f in faces for e in f.edges}) + list({u for f in faces for u in f.verts}) + faces
                co, no = [0, 0, 0], [0, 0, 0]
                co[ax], no[ax] = v, 1
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
        bm.normal_update()
        arches = self.arches.get(ob.name, [])
        segl = bm.faces.layers.int.get("seg")
        for f in bm.faces:
            c, n, mi = f.calc_center_median(), f.normal, f.material_index
            sg = f[segl] if segl is not None else None
            new = None
            for ay, az, rc in arches:
                if abs(math.hypot(c.y - ay, c.z - az) - rc) < 0.02 and abs(n.x) < 0.5:
                    new = self["Trim"]
                    break
            if new is None:
                for r in rules:
                    if self._match(r, c, n, mi, sg):
                        new = self[r["mat"]]
                        break
            if new is not None:
                f.material_index = new
        bm.to_mesh(ob.data)
        bm.free()

    def _match(self, r, c, n, mi, sg=None):
        if "seg" in r and sg not in r["seg"]:
            return False
        only = r.get("only", ("Paint",))
        if only is not None and mi not in [self[o] for o in only]:
            return False
        for key, val in (("x", abs(c.x) if r.get("absx") else c.x), ("y", c.y), ("z", c.z)):
            rng = r.get(key)
            if rng:
                lo, hi = rng
                if (lo is not None and val < lo) or (hi is not None and val > hi):
                    return False
        for axis, sgn, thr in r.get("n", ()):
            comp = getattr(n, axis)
            if (abs(comp) if sgn == 0 else comp * sgn) <= thr:
                return False
        return True

    # ---- surface probe (ray casts against the shells, after the arches are cut)
    def probe(self):
        dg = bpy.context.evaluated_depsgraph_get()
        self._trees = [BVHTree.FromObject(o, dg) for o in self.shells]

    def _hit(self, o, d, dist=60):
        best = None
        for t in self._trees:
            h = t.ray_cast(V(o), V(d), dist)
            if h[0] is not None and (best is None or h[3] < best[3]):
                best = h
        return best

    def sx(self, y, z, side=1):
        h = self._hit((side * 8, y, z), (-side, 0, 0))
        return abs(h[0].x) if h else None

    def sfront(self, x, z):
        h = self._hit((x, -30, z), (0, 1, 0))
        return h[0].y if h else None

    def sback(self, x, z):
        h = self._hit((x, 30, z), (0, -1, 0))
        return h[0].y if h else None

    def stop(self, x, y):
        h = self._hit((x, y, 20), (0, 0, -1))
        return h[0].z if h else None

    # ---- common details
    def seam_v(self, y, z0, z1, sides=(1, -1), n=8):
        """vertical panel gap following the side (stops where the surface turns away)"""
        for s in sides:
            xs = [self.sx(y, z0 + (z1 - z0) * t, s) for t in (0.02, 0.5, 0.98)]
            if None not in xs and max(xs) - min(xs) < 0.006:  # flat side: one strip
                self.box("Trim", s * (xs[1] + 0.0005), y, (z0 + z1) / 2, 0.008, 0.007, z1 - z0)
                continue
            zs = [z0 + (z1 - z0) * k / n for k in range(n + 1)]
            pts = []
            for z in zs:
                x = self.sx(y, z, s)
                if x is None or (pts and abs(x - pts[-1].x * s) > 0.05):
                    break
                pts.append(V((s * (x + 0.002), y, z)))
            for a, b in zip(pts, pts[1:]):
                self.tube("Trim", a, b, 0.004, segs=4)

    def door_liner(self, y0, y1, z0, z1):
        """trim panel on the inside of the driver's door (cut out with the door)"""
        ym, zm = (y0 + y1) / 2, (z0 + z1) / 2
        x = self.sx(ym, zm, 1)
        self.box("Interior", x - 0.05, ym, zm, 0.03, y1 - y0 - 0.06, z1 - z0)
        self.box("Trim", x - 0.07, ym + (y1 - y0) * 0.25, zm + 0.1, 0.03, 0.14, 0.03)

    def seam_h(self, y0, y1, z, sides=(1, -1)):
        for s in sides:
            x = self.sx((y0 + y1) / 2, z, s)
            self.box("Trim", s * (x + 0.0005), (y0 + y1) / 2, z, 0.008, y1 - y0, 0.007)

    def outline(self, y0, y1, z0, z1, sides=(1, -1)):
        self.seam_v(y0, z0, z1, sides)
        self.seam_v(y1, z0, z1, sides)
        self.seam_h(y0, y1, z0, sides)
        self.seam_h(y0, y1, z1, sides)

    def handle(self, y, z, sides=(1, -1), mat="Chrome", length=0.16):
        for s in sides:
            x = self.sx(y, z, s)
            self.box(mat, s * (x + 0.01), y, z, 0.022, length, 0.03)

    def mirror_arm(self, side, base, head, size=(0.07, 0.14, 0.3)):
        self.tube("Trim", base, head, 0.018, segs=6)
        hx, hy, hz = head
        self.box("Trim", hx, hy, hz, *size)
        self.box("Glass", hx, hy + size[1] / 2 + 0.002, hz, size[0] * 0.8, 0.004, size[2] * 0.85)

    def cockpit(self, sx, sy, sz, floor_z, dash_front, half_w, passenger=True, headrest=True, dash_top=None, seat_mat="Interior",
                floor_back=None, cx=0.0, dash_mat="Interior"):
        """driver (+ passenger) seats, dash, steering wheel, laid out exactly like the cars relative
        to the driver's seat cushion top (sx, sy, sz) so the drive pose fits"""
        fb = sy + 0.55 if floor_back is None else floor_back
        self.box("Interior", cx, (dash_front + fb) / 2, floor_z - 0.02, half_w * 2, fb - dash_front, 0.04)
        for x in ((sx, -sx) if passenger else (sx,)):
            self.box(seat_mat, x, sy, sz - 0.06, .5, .52, .12)
            self.box(seat_mat, x, sy + 0.33, sz + 0.27, .5, .12, .62, rx=-0.32)
            if headrest:
                self.box(seat_mat, x, sy + 0.45, sz + 0.61, .26, .1, .16, rx=-0.32)
            ped = sz - 0.12 - floor_z
            if ped > 0.03:
                self.box("Trim", x, sy + 0.02, floor_z + ped / 2, .34, .36, ped)
        dt = sz + 0.42 if dash_top is None else dash_top
        d0, d1 = dash_front, sy - 0.51
        self.box(dash_mat, cx, (d0 + d1) / 2, (sz + 0.24 + dt) / 2, half_w * 2, d1 - d0, dt - sz - 0.24)
        self.box(dash_mat, cx, d0 + 0.03, (floor_z + sz + 0.24) / 2, half_w * 2, 0.06, sz + 0.24 - floor_z)
        for k in (-1, 1):  # gauges
            self.cyl("Chrome", sx + k * 0.08, d1 - 0.005, sz + 0.37, 0.035, 0.01, axis="y", segs=10)
        wc = (sx, sy - 0.47, sz + 0.5)
        self.torus("Trim", *wc, R=0.18, r=0.017, n1=16, n2=5, rx=math.radians(-62))
        self.cyl("Trim", sx, sy - 0.55, sz + 0.46, 0.025, 0.25, segs=8, rx=math.radians(28))
        self.cyl("Trim", *wc, 0.05, 0.05, segs=12, rx=math.radians(28))

    # ---- wheels
    def wheel(self, name, x, y, R, tw, dual=False, gap=0.04, lugs=8, rim_scale=0.6):
        side = 1 if x > 0 else -1
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        TI, RI, BR, TR = self["Tire"], self["Rim"], self["Brake"], self["Trim"]
        h = tw / 2
        centers = [side * (h + gap / 2), -side * (h + gap / 2)] if dual else [0.0]
        n = 18
        for xc in centers:
            prof = [(-h, R * 0.64), (-h * 0.98, R * 0.88), (-h * 0.86, R * 0.982), (-h * 0.6, R), (h * 0.6, R),
                    (h * 0.86, R * 0.982), (h * 0.98, R * 0.88), (h, R * 0.64)]
            rings = [[bm.verts.new((xc + px, r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n))) for i in range(n)] for px, r in prof]
            for k, (a, b) in enumerate(zip(rings, rings[1:])):
                for i in range(n):
                    j = (i + 1) % n
                    f = bm.faces.new((a[i], a[j], b[j], b[i]))
                    f.material_index = TI
                    for loop, uv in zip(f.loops, ((i / n * 6, k / 7), ((i + 1) / n * 6, k / 7), ((i + 1) / n * 6, (k + 1) / 7), (i / n * 6, (k + 1) / 7))):
                        loop[uvl].uv = uv
        s = R / 0.4
        rr = R * rim_scale
        out = centers[0] + side * h * 0.72          # outer rim face plane
        inner = centers[-1] - side * h * 0.72
        RX = math.pi / 2

        def c_(mat, xx, r, depth, segs=16, caps=True):
            C.prim(bm, "cyl", mat, T(xx, 0, 0, ry=RX), r1=r, depth=depth, segs=segs, caps=caps)
        c_(RI, (out + inner) / 2, rr * 0.97, abs(out - inner), 18, caps=False)   # barrel
        C.prim(bm, "torus", RI, T(out, 0, 0, ry=RX), R=rr * 0.97, r=0.016 * s, n1=18, n2=3)  # lip
        c_(RI, out - side * 0.03 * s, rr * 0.9, 0.02 * s, 18)                     # dished disc
        c_(RI, out - side * 0.005 * s, R * 0.24, 0.06 * s, 12)                    # hub
        c_(RI, out + side * 0.03 * s, R * 0.15, 0.05 * s, 10)                     # hub cap
        for k in range(lugs):
            a = 2 * math.pi * k / lugs
            C.prim(bm, "cyl", RI, T(out + side * 0.03 * s, R * 0.19 * math.cos(a), R * 0.19 * math.sin(a), ry=RX), r1=0.016 * s, depth=0.03 * s, segs=5)
        for k in range(5):  # vent holes in the disc
            a = 2 * math.pi * (k + 0.5) / 5
            C.prim(bm, "cyl", TR, T(out - side * 0.018 * s, R * 0.4 * math.cos(a), R * 0.4 * math.sin(a), ry=RX), r1=0.045 * s, depth=0.006, segs=6)
        c_(BR, (centers[0] + centers[-1]) / 2, R * 0.5, abs(centers[0] - centers[-1]) + h, 12, caps=False)  # drum
        ob = C.to_object(name, bm, self.mats)
        ob.location = (x, y, R)
        self.wheels.append(ob)
        return ob


# ------------------------------------------------------------------ assembly / export / preview
def rules_side(mat, y, z, side=0, thr=0.5, only=("Paint",)):
    return dict(mat=mat, y=y, z=z, n=(("x", side, thr),), only=only)


def rules_front(mat, x, z, y=None, thr=0.5, only=("Paint",), extra_n=()):
    return dict(mat=mat, x=x, y=y, z=z, absx=True, n=(("y", -1, thr),) + tuple(extra_n), only=only)


def rules_back(mat, x, z, y=None, thr=0.5, only=("Paint",)):
    return dict(mat=mat, x=x, y=y, z=z, absx=True, n=(("y", 1, thr),), only=only)


def framed(maker, f, glass="Glass", frame="Trim", **kw):
    """a window (or panel) plus a frame band f wide around it"""
    def grow(rng, absx=False):
        if rng is None:
            return None
        lo, hi = rng
        return (lo if (absx and lo == 0) else (None if lo is None else lo - f), None if hi is None else hi + f)
    inner = maker(glass, **kw)
    kw2 = dict(kw)
    for key in ("x", "y", "z"):
        if key in kw2:
            kw2[key] = grow(kw2[key], absx=(key == "x"))
    outer = maker(frame, **kw2)
    return [inner, outer]


def cut_door(body, y0, y1, z0, z1, xmin, hinge_x):
    """the driver door (left, +X): every face of the joined body inside the outline goes to Door_L,
    hinged on its front edge (as build_car.py)"""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for co, no in (((0, y0, 0), (0, 1, 0)), ((0, y1, 0), (0, 1, 0)), ((0, 0, z0), (0, 0, 1)), ((0, 0, z1), (0, 0, 1))):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)

    def in_door(f):
        c = f.calc_center_median()
        return y0 < c.y < y1 and z0 < c.z < z1 and c.x > xmin
    door_faces = [f for f in bm.faces if in_door(f)]
    bm_door = bm.copy()
    keep = {f.index for f in door_faces}
    bm_door.faces.ensure_lookup_table()
    bmesh.ops.delete(bm_door, geom=[f for f in bm_door.faces if f.index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=door_faces, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    me = bpy.data.meshes.new("Door_L")
    bm_door.to_mesh(me)
    bm_door.free()
    for m in body.data.materials:
        me.materials.append(m)
    door = bpy.data.objects.new("Door_L", me)
    bpy.context.scene.collection.objects.link(door)
    hinge = V((hinge_x, y0, (z0 + z1) / 2))
    door.data.transform(Matrix.Translation(-hinge))
    door.name = "Door_L"
    door.parent = body
    door.matrix_parent_inverse = Matrix()
    door.location = hinge
    print("DOOR", len(door.data.polygons), "faces")
    return door


def finish(K, name, seat=None, door_pos=None, door=None, empties=(), cam=(0, 0, 1.5), fork=None):
    """join the shells, details and lettering into Body, cut the driver door, add the markers,
    parent everything to a root empty and export car_<name>.glb (+ .blend)"""
    scene = bpy.context.scene
    det = C.to_object(name + "_details", K.bm, K.mats)
    bpy.ops.object.select_all(action="DESELECT")
    objs = K.shells + [det] + K.texts
    for ob in objs:
        ob.select_set(True)
    body = K.shells[0]
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = "Body"
    body.data.name = "Body"
    door_ob = cut_door(body, **door) if door else None
    for ob in [body] + ([door_ob] if door_ob else []) + K.wheels:
        smooth_angle(ob)
    if fork is not None:
        smooth_angle(fork)
        fork.parent = body
        fork.matrix_parent_inverse = Matrix()
    bpy.context.view_layer.update()
    marks = []
    if seat is not None:
        marks.append(("seat_driver", seat))
    if door_pos is not None:
        marks.append(("door_driver", door_pos))
    marks.append(("cam_target", cam))
    for mname, loc, *par in list(marks) + list(empties):
        e = bpy.data.objects.new(mname, None)
        e.empty_display_size = 0.1
        scene.collection.objects.link(e)
        if par and par[0] is not None:
            e.parent = par[0]
            e.matrix_parent_inverse = Matrix()
            e.matrix_world = Matrix.Translation(loc)
        else:
            e.location = loc
    for ob in scene.objects:
        if ob.type == "MESH" and "seg" in ob.data.attributes:
            ob.data.attributes.remove(ob.data.attributes["seg"])
    root = bpy.data.objects.new(name, None)
    scene.collection.objects.link(root)
    for ob in list(scene.collection.objects):
        if ob is not root and ob.parent is None:
            ob.parent = root
    path = os.path.join(ROOT, "assets", "models", f"car_{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_image_format="JPEG", export_extras=True)
    faces = sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH")
    print("EXPORTED", path, faces, "faces")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", f"car_{name}.blend"))
    return body, door_ob


def preview(name, L, W, H, seat=None, probe="car", door=None, water=False, close=None, z0=0.0):
    if not PREVIEW:
        return
    out = ARGS[ARGS.index("--preview") + 1]
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    scene.render.resolution_x, scene.render.resolution_y = 960, 600
    if seat is not None:
        sx_, sy_, sz_ = seat
        if probe == "car":  # hips 0.09 above the cushion, head top 0.83 above the hips
            bpy.ops.mesh.primitive_cube_add(size=1, location=(sx_, sy_ + 0.07, sz_ + 0.09 + 0.415))
            pr = bpy.context.active_object
            pr.scale = (0.3, 0.36, 0.83)
        else:  # bike: the marker is the hip joint
            bpy.ops.mesh.primitive_cube_add(size=1, location=(sx_, sy_ - 0.05, sz_ + 0.38))
            pr = bpy.context.active_object
            pr.scale = (0.3, 0.3, 0.76)
        pr.data.materials.append(C.material("Probe", "22cc44", 0.5))
    if water:
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
        wp = bpy.context.active_object
        wp.data.materials.append(C.material("Water", "2a6a8a", 0.3))
        wp.hide_render = True
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    tgt = V((0, 0, z0 + H * 0.45))
    r = 0.5 * math.sqrt(L * L + W * W + H * H)
    d34 = r / math.sin(math.radians(12.5)) * 0.68
    dside = (L / 2) / math.tan(math.radians(19.5)) * 1.25
    dfront = (max(W, H) / 2) / math.tan(math.radians(12.5)) * 1.25 + L / 2

    def shot(tag, loc, target=tgt):
        cam.location = loc
        cam.rotation_euler = (V(target) - V(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out, f"{name}_{tag}.png")
        bpy.ops.render.render(write_still=True)

    def dirv(x, y, z):
        return V((x, y, z)).normalized()
    shot("34", tgt + dirv(0.62, -0.72, 0.32) * d34)
    shot("rear34", tgt + dirv(-0.62, 0.72, 0.32) * d34)
    shot("side", tgt + V((dside, 0, 0.3)))
    shot("side_r", tgt + V((-dside, 0, 0.3)))
    shot("front", tgt + V((0, -dfront, 0.4)))
    shot("back", tgt + V((0, dfront, 0.4)))
    shot("top", tgt + dirv(0.35, -0.45, 1.0) * d34)
    if close is not None:
        c, off = close
        shot("close", V(c) + V(off), V(c))
    if water:
        wp.hide_render = False
        shot("water", tgt + dirv(0.7, -0.6, 0.18) * d34)
        wp.hide_render = True
    if door is not None:
        door.rotation_euler = (0, 0, -1.15)
        bpy.context.view_layer.update()
        hy = door.matrix_world.translation.y
        c = V((W * 0.35, hy + 0.4, z0 + H * 0.45))
        shot("open", c + dirv(0.8, 0.35, 0.3) * (max(W, H) * 2.6), c)
        door.rotation_euler = (0, 0, 0)


# ================================================================== models
SIREN = [("SirenRed", ("7a0a0a", 0.15, 0.0), dict(emit="ff1a10", emit_str=0.0)),
         ("SirenBlue", ("0a1a7a", 0.15, 0.0), dict(emit="1a3cff", emit_str=0.0))]


def lightbar(K, y, z, w=1.3, mats=("SirenRed", "SirenBlue"), depth=0.28):
    K.box("Trim", 0, y, z + 0.025, w, depth, 0.05)
    for s in (1, -1):
        K.box("Trim", s * w * 0.36, y, z - 0.01, 0.06, depth * 0.7, 0.04)  # feet
    K.box(mats[0], w * 0.25, y, z + 0.095, w * 0.47, depth * 0.85, 0.09)
    K.box(mats[1], -w * 0.25, y, z + 0.095, w * 0.47, depth * 0.85, 0.09)
    K.box("Chrome", 0, y, z + 0.095, 0.04, depth * 0.88, 0.095)


# ------------------------------------------------------------------ ambulance
def ambulance():
    K = Kit("f4f4f0", rim="c9ccd0", extra=[
        ("Livery", ("c8102e", 0.35, 0.2), dict(coat=1.0)),
        ("Livery2", ("f2861e", 0.35, 0.2), dict(coat=1.0)),
        ("Decal", ("b30d22", 0.5), {}),
        ("Cot", ("e9e6dc", 0.6), {})] + SIREN)
    F, B, R, AF, AR = -3.25, 3.25, 0.40, -2.25, 1.62
    cab = K.shell("cab", [
        (-3.25, .84, .42, .78, .70, .80), (-3.21, .94, .33, .90, .82, .90), (-3.08, .99, .29, .99, .92, .95),
        (-2.75, 1.0, .28, 1.07, 1.0, .96), (-2.12, 1.0, .28, 1.17, 1.10, .96), (-1.55, 1.0, .28, 2.08, 1.16, .90),
        (-1.35, 1.0, .28, 2.14, 1.16, .89), (-0.80, 1.0, .28, 2.14, 1.16, .89)], rb=0.1, rt=0.14)
    box = K.shell("box", round_ends([(-0.92, 1.13, .55, 2.82, 2.70, 1.12), (B, 1.13, .55, 2.82, 2.70, 1.12)], 0.07),
                  rb=0.05, rt=0.07, nb=2, nt=3)
    K.arch(cab, AF, R)
    K.arch(box, AR, R, clr=0.1)
    K.paint(cab, [
        *framed(rules_front, 0.04, x=(0, 0.78), z=(1.0, 2.2), y=(-2.07, -1.6), thr=0.25, extra_n=(("z", 1, 0.15),)),
        *framed(rules_side, 0.035, y=(-1.46, -1.04), z=(1.24, 1.94)),
        rules_side("Livery", (-3.05, -0.8), (0.86, 1.06), thr=0.6),
        rules_side("Livery2", (-3.05, -0.8), (1.09, 1.14), thr=0.6),
        rules_front("Livery", (0, 2), (0.8, 0.87), thr=0.6),
    ])
    K.paint(box, [
        rules_front("Interior", (0, 0.99), (0.5, 2.12), y=(None, -0.8)),
        *framed(rules_back, 0.035, x=(0.1, 0.86), z=(1.55, 2.25)),
        *framed(rules_side, 0.035, y=(0.18, 0.72), z=(1.55, 2.25), side=-1),
        *framed(rules_side, 0.035, y=(2.0, 2.55), z=(1.72, 2.25), side=1),
        rules_side("Livery", (None, None), (0.86, 1.06)),
        rules_side("Livery2", (None, None), (1.09, 1.14)),
        rules_back("Livery", (0, 1.2), (0.86, 1.06)),
        rules_back("Livery2", (0, 1.2), (1.09, 1.14)),
    ])
    K.probe()
    # ---- cab front: grille, lamps, bumper, plate, wipers, mirrors
    fy = K.sfront(0, 0.66)
    K.box("Trim", 0, fy + 0.012, 0.66, 1.0, 0.05, 0.22)
    K.box("Chrome", 0, fy - 0.01, 0.78, 1.04, 0.02, 0.025)
    for k in range(4):
        K.box("Chrome", 0, fy - 0.006, 0.585 + k * 0.045, 0.94, 0.015, 0.01)
    for s in (1, -1):
        hy = K.sfront(s * 0.7, 0.8)
        K.box("Chrome", s * 0.7, hy + 0.01, 0.8, 0.34, 0.05, 0.17, rz=-s * 0.12)
        K.box("Headlight", s * 0.7, hy - 0.006, 0.8, 0.3, 0.03, 0.13, rz=-s * 0.12)
        iy = K.sfront(s * 0.9, 0.62)
        K.box("Indicator", s * 0.9, iy + 0.005, 0.62, 0.12, 0.04, 0.07, rz=-s * 0.4)
        K.box("SirenRed" if s > 0 else "SirenBlue", s * 0.4, fy - 0.01, 0.52, 0.16, 0.03, 0.05)  # grille strobes
    K.box("Trim", 0, F + 0.06, 0.40, 1.92, 0.18, 0.18)
    K.box("Plate", 0, F - 0.04, 0.42, 0.52, 0.02, 0.12)
    for s in (1, -1):
        wz = K.stop(s * 0.3, -2.06)
        K.box("Trim", s * 0.32, -2.06, wz + 0.015, 0.62, 0.025, 0.015, rz=s * 0.05)
        x = K.sx(-1.62, 1.35, s)
        K.mirror_arm(s, (s * (x - 0.02), -1.62, 1.35), (s * (x + 0.2), -1.66, 1.52), size=(0.06, 0.14, 0.3))
    # cab doors, handles, seams (both sides; the left door is cut out below)
    K.seam_v(-1.55, 0.33, 1.98)
    K.seam_v(-0.98, 0.33, 1.98)
    K.handle(-1.12, 1.1)
    # ---- box module: warning lights, light bar, doors, compartments, step, lamps
    lightbar(K, -0.62, 2.82, w=1.4)
    for s in (1, -1):
        m = "SirenRed" if s > 0 else "SirenBlue"
        K.box(m, s * 0.9, -0.935, 2.6, 0.22, 0.04, 0.13)                 # front corners
        K.box(m, s * 1.135, -0.55, 2.62, 0.04, 0.22, 0.12)                # sides, front
        K.box(m, s * 1.135, 3.0, 2.62, 0.04, 0.22, 0.12)                  # sides, rear
        K.box(m, s * 0.9, B + 0.012, 2.62, 0.22, 0.04, 0.13)              # rear corners
        K.box("Indicator", s * 0.3, B + 0.01, 2.68, 0.1, 0.03, 0.06)
        # rear lamps: tail, indicator, reversing light in a chrome bezel
        K.box("Chrome", s * 0.98, B + 0.008, 0.92, 0.2, 0.03, 0.62)
        K.box("Taillight", s * 0.98, B + 0.02, 1.05, 0.16, 0.03, 0.26)
        K.box("Indicator", s * 0.98, B + 0.02, 0.80, 0.16, 0.03, 0.12)
        K.box("Headlight", s * 0.98, B + 0.02, 0.68, 0.16, 0.03, 0.07)
        K.box("Indicator", s * 1.13, -0.9, 0.7, 0.03, 0.08, 0.05)          # side markers
        K.box("Indicator", s * 1.13, B - 0.1, 0.7, 0.03, 0.08, 0.05)
    K.box("Indicator", 0, -0.92 - 0.012, 2.72, 0.5, 0.03, 0.05)
    # rear doors: centre seam, outline, handles, hinges; step bumper
    K.box("Trim", 0, B + 0.006, 1.6, 0.012, 0.012, 2.1)
    for s in (1, -1):
        K.box("Trim", s * 0.98, B + 0.006, 1.6, 0.012, 0.012, 2.1)
        K.box("Chrome", s * 0.08, B + 0.02, 1.45, 0.03, 0.025, 0.22)
        for z in (0.85, 2.35):
            K.box("Trim", s * 0.95, B + 0.012, z, 0.1, 0.02, 0.04)
    K.box("Trim", 0, B + 0.006, 2.62 - 0.07, 1.96, 0.012, 0.012)
    K.box("Chrome", 0, B + 0.17, 0.48, 1.9, 0.34, 0.06)
    K.box("Trim", 0, B + 0.05, 0.40, 1.9, 0.12, 0.14)
    K.box("Plate", 0, B + 0.115, 0.38, 0.52, 0.02, 0.12)
    # curb-side entry door (right) + left compartments
    K.outline(0.12, 0.78, 0.6, 2.32, sides=(-1,))
    K.handle(0.7, 1.45, sides=(-1,))
    K.tube("Chrome", (-1.16, 0.02, 1.1), (-1.16, 0.02, 2.0), 0.018)
    for a, b in ((-0.75, 0.25), (2.22, 3.08)):
        K.outline(a, b, 0.62, 1.62, sides=(1,))
        K.handle(b - 0.12, 1.5, sides=(1,), length=0.12)
    K.outline(-0.75, 0.25, 0.62, 1.62, sides=(-1,))
    K.handle(0.13, 1.5, sides=(-1,), length=0.12)
    # chassis under the box, fuel tank, mud flaps
    for s in (1, -1):
        K.box("Trim", s * 0.45, 1.1, 0.48, 0.12, 4.2, 0.16)
        K.box("Trim", s * 0.9, AR + 0.62, 0.38, 0.4, 0.02, 0.32)
    K.cyl("Trim", -0.6, 0.0, 0.42, 0.16, 0.7, axis="y", segs=12)
    # patient compartment (seen through the rear and side windows): floor, cabinets, bench, cot
    K.box("Interior", 0, 1.17, 0.62, 2.16, 4.1, 0.04)
    K.box("Interior", 0.88, 0.1, 1.6, 0.36, 1.8, 1.9)
    K.box("Chrome", 0.7, 0.1, 1.6, 0.005, 1.7, 0.012)
    K.box("Interior", 0.92, 2.0, 2.35, 0.3, 2.0, 0.5)
    K.box("Interior", -0.82, 1.9, 0.85, 0.42, 2.2, 0.42)
    K.box("Cot", -0.82, 1.9, 1.1, 0.4, 2.1, 0.08)
    K.box("Cot", -0.96, 1.9, 1.45, 0.08, 2.1, 0.5)
    K.box("Chrome", 0.2, 1.85, 0.85, 0.5, 1.9, 0.06)
    K.box("Cot", 0.2, 1.85, 0.95, 0.56, 1.95, 0.12)
    K.box("Cot", 0.2, 1.1, 1.08, 0.5, 0.4, 0.2, rx=-0.5)
    K.box("Cot", 0, 1.2, 2.77, 0.5, 1.2, 0.02)
    # lettering
    K.text("AMBULANCE", 0.34, V((K.sx(0.75, 1.85, 1) + 0.006, 0.75, 1.85)), "+x")
    K.text("AMBULANCE", 0.34, V((-(K.sx(2.0, 1.85, -1) + 0.006), 2.0, 1.85)), "-x")
    K.text("AMBULANCE", 0.22, V((0, B + 0.008, 2.42)), "+y")
    K.text("AMBULANCE", 0.24, V((0, -0.92 - 0.008, 2.42)), "-y", mirror=True)
    # cab interior
    seat = (0.45, -1.42, 0.82)
    K.cockpit(*seat, floor_z=0.62, dash_front=-2.02, half_w=0.9, dash_top=1.2)
    K.door_liner(-1.52, -1.01, 0.4, 1.18)
    for s in (1, -1):
        K.wheel("wheel_F" + ("L" if s > 0 else "R"), s * 0.85, AF, R, 0.235)
        K.wheel("wheel_R" + ("L" if s > 0 else "R"), s * 0.82, AR, R, 0.215, dual=True, gap=0.03)
    body, door = finish(K, "ambulance", seat=seat, door_pos=(1.55, seat[1] - 0.1, 0), cam=(0, 0, 1.6),
                        door=dict(y0=-1.546, y1=-0.984, z0=0.32, z1=2.0, xmin=0.86, hinge_x=K.sx(-1.55, 1.0) - 0.02))
    preview("ambulance", 6.5, 2.3, 2.9, seat=seat, door=door, close=((0.5, -1.6, 1.3), (3.0, -3.2, 1.2)))


# ------------------------------------------------------------------ fire engine
def firetruck():
    K = Kit("b3121c", rim="d4d6d9", extra=[
        ("Livery", ("f2f2ee", 0.3, 0.3), dict(coat=1.0)),
        ("Decal", ("e2b63c", 0.35, 0.6), {})] + SIREN)
    F, B, R, AF, AR = -4.6, 4.6, 0.52, -3.72, 1.75
    cab = K.shell("cab", round_ends([(F, 1.25, .48, 3.0, 1.72, 1.2), (-1.55, 1.25, .48, 3.0, 1.72, 1.2)], 0.08, 0.05),
                  rb=0.06, rt=0.18, nb=2, nt=4)
    app = K.shell("apparatus", round_ends([(-1.5, 1.25, .55, 2.4, 2.3, 1.24), (B, 1.25, .55, 2.4, 2.3, 1.24)], 0.05),
                  rb=0.04, rt=0.05, nb=2, nt=3)
    K.arch(cab, AF, R, clr=0.1)
    K.arch(app, AR, R, clr=0.1)
    win = []
    for s in (1, -1):
        win += framed(rules_side, 0.035, y=(-2.93, -2.22), z=(1.80, 2.74), side=s)
        win += framed(rules_side, 0.035, y=(-2.03, -1.72), z=(1.80, 2.74), side=s)
    K.paint(cab, [
        *framed(rules_front, 0.05, x=(0.045, 1.07), z=(1.80, 2.72)),
        *win,
        rules_front("Trim", (0, 0.62), (0.98, 1.52)),                # grille opening
        rules_side("Livery", (None, None), (1.05, 1.2)),
        rules_side("Decal", (None, None), (1.22, 1.25)),
        rules_front("Livery", (0, 2), (1.05, 1.2)),
    ])
    comps = [(-1.42, -0.62, 0.72, 2.22), (-0.55, 0.25, 0.72, 2.22), (0.32, 1.06, 0.72, 2.22), (1.14, 2.36, 1.30, 2.22),
             (2.44, 3.42, 0.72, 2.22), (3.5, 4.48, 0.72, 2.22)]
    rr = []
    for a, b, z0, z1 in comps:
        rr += framed(rules_side, 0.025, glass="Chrome", y=(a, b), z=(z0, z1))
    K.paint(app, rr + [
        *framed(rules_back, 0.025, glass="Chrome", x=(0, 0.95), z=(0.72, 2.22)),
        rules_side("Livery", (None, None), (0.58, 0.68)),
        rules_back("Livery", (0, 2), (0.58, 0.68)),
        rules_front("Trim", (0, 1.3), (0.5, 2.6)),
    ])
    K.probe()
    # roll-up shutters: horizontal ribs on every compartment except the pump panel
    for a, b, z0, z1 in comps[1:]:
        for s in (1, -1):
            x = K.sx((a + b) / 2, (z0 + z1) / 2, s)
            z = z0 + 0.1
            while z < z1 - 0.05:
                K.box("Trim", s * (x + 0.002), (a + b) / 2, z, 0.006, b - a - 0.04, 0.012)
                z += 0.13
            K.box("Chrome", s * (x + 0.015), (a + b) / 2, z0 + 0.06, 0.03, 0.18, 0.035)   # lift bar
    z = 0.82
    while z < 2.17:  # rear shutter
        K.box("Trim", 0, B + 0.004, z, 1.86, 0.006, 0.012)
        z += 0.13
    # pump panel: gauges, discharge caps, levers
    a, b = comps[0][0], comps[0][1]
    for s in (1, -1):
        x = K.sx(-1.0, 1.5, s) + 0.01
        for k, (gy, gz) in enumerate(((-1.25, 1.95), (-1.05, 1.95), (-0.85, 1.95), (-1.15, 1.75), (-0.95, 1.75))):
            K.cyl("Trim", s * x, gy, gz, 0.06, 0.03, axis="x", segs=14)
            K.cyl("Headlight", s * (x + 0.016), gy, gz, 0.048, 0.006, axis="x", segs=14)
        for gy in (-1.25, -0.8):
            K.cyl("Chrome", s * (x + 0.05), gy, 1.15, 0.075, 0.12, axis="x", segs=14)
            K.cyl("Trim", s * (x + 0.11), gy, 1.15, 0.085, 0.03, axis="x", segs=8)
        for k in range(4):
            K.box("Chrome", s * (x + 0.04), -1.32 + k * 0.17, 1.45, 0.08, 0.025, 0.025)
    # ---- cab front: windshield bar, grille bars, lamps, bumper, plate, mirrors, wipers
    for k in range(9):
        K.box("Chrome", -0.5 + k * 0.125, F - 0.012, 1.25, 0.03, 0.03, 0.52)
    for z in (0.97, 1.53):
        K.box("Chrome", 0, F - 0.015, z, 1.3, 0.04, 0.05)
    for s in (1, -1):
        for k, hx in enumerate((0.78, 1.0)):
            K.box("Chrome", s * hx, F - 0.01, 1.22, 0.2, 0.04, 0.17)
            K.box("Headlight", s * hx, F - 0.025, 1.22, 0.17, 0.02, 0.13)
        K.box("Indicator", s * 0.89, F - 0.02, 1.42, 0.36, 0.03, 0.07)
        K.box("SirenRed" if s > 0 else "SirenBlue", s * 1.05, F - 0.02, 0.95, 0.22, 0.03, 0.1)
        K.box("SirenRed" if s > 0 else "SirenBlue", s * 1.26, -4.2, 2.85, 0.03, 0.2, 0.12)   # cab side lights
        K.box("Trim", s * 0.5, F - 0.02, 1.77, 0.75, 0.03, 0.02, ry=-s * 0.03)              # wipers
        x = K.sx(-4.4, 2.2, s)
        K.mirror_arm(s, (s * (x - 0.02), -4.42, 2.25), (s * (x + 0.28), -4.46, 2.15), size=(0.08, 0.16, 0.38))
        K.tube("Chrome", (s * 1.27, -3.05, 1.0), (s * 1.27, -3.05, 2.5), 0.02)              # grab rails
        K.tube("Chrome", (s * 1.27, -1.6, 1.0), (s * 1.27, -1.6, 2.5), 0.02)
        K.box("Chrome", s * 1.17, -2.575, 0.4, 0.24, 0.8, 0.05)                              # steps
        K.box("Chrome", s * 1.17, -1.865, 0.4, 0.24, 0.45, 0.05)
    K.box("Chrome", 0, F - 0.14, 0.64, 2.55, 0.3, 0.24)
    K.box("Trim", 0, F - 0.14, 0.765, 2.5, 0.26, 0.012)
    K.box("Plate", 0, F - 0.295, 0.64, 0.52, 0.02, 0.12)
    K.seam_v(-3.0, 0.55, 2.86)
    K.seam_v(-2.15, 0.55, 2.86)
    K.seam_v(-1.62, 0.55, 2.86)
    K.handle(-2.3, 1.55)
    K.handle(-1.75, 1.55)
    lightbar(K, -4.3, 3.0, w=1.7, depth=0.3)
    # ---- ladders on the roof racks, hose bed rails
    for y, zb in ((-2.0, 3.0), (0.6, 2.4), (3.9, 2.4)):
        for s in (1, -1):
            K.box("Chrome", s * 0.9, y, (zb + 3.12) / 2, 0.06, 0.06, 3.12 - zb)
        K.box("Chrome", 0, y, 3.1, 1.86, 0.06, 0.05)
    y0, y1 = -4.1, 4.5
    for lx in (0.42, -0.42):
        for s in (1, -1):
            K.box("Chrome", lx + s * 0.26, (y0 + y1) / 2, 3.2, 0.05, y1 - y0, 0.11)
        y = y0 + 0.15
        while y < y1 - 0.1:
            K.cyl("Chrome", lx, y, 3.2, 0.018, 0.5, axis="x", segs=6)
            y += 0.3
    for s in (1, -1):
        K.box("Trim", s * 1.2, 1.5, 2.48, 0.05, 6.0, 0.16)  # hose bed side boards
    # ---- rear: lamps, step, rails, warning lights
    for s in (1, -1):
        K.box("Chrome", s * 1.1, B + 0.008, 1.0, 0.2, 0.03, 0.55)
        K.box("Taillight", s * 1.1, B + 0.02, 1.12, 0.16, 0.03, 0.22)
        K.box("Indicator", s * 1.1, B + 0.02, 0.92, 0.16, 0.03, 0.1)
        K.box("Headlight", s * 1.1, B + 0.02, 0.8, 0.16, 0.03, 0.06)
        K.box("SirenRed" if s > 0 else "SirenBlue", s * 1.1, B + 0.015, 2.3, 0.2, 0.04, 0.12)
        K.tube("Chrome", (s * 1.12, B + 0.06, 1.3), (s * 1.12, B + 0.06, 2.15), 0.02)
        K.box("Trim", s * 0.95, AR + 0.7, 0.45, 0.45, 0.02, 0.35)  # mud flaps
    K.box("Chrome", 0, B + 0.17, 0.52, 2.3, 0.36, 0.05)
    for s in (1, -1):
        K.box("Trim", s * 0.9, B + 0.1, 0.56, 0.08, 0.2, 0.08)
    # hose load in the bed
    for k in range(5):
        K.box("Trim", -0.8 + k * 0.4, 3.0, 2.5, 0.36, 2.6, 0.18)
        K.box("Livery", -0.8 + k * 0.4, 1.68, 2.5, 0.36, 0.04, 0.16)
    K.box("Plate", 0, B + 0.01, 0.72, 0.52, 0.02, 0.12)
    for s in (1, -1):
        K.box("Trim", s * 0.45, 0.0, 0.5, 0.2, 8.4, 0.22)  # frame rails
    # ---- lettering
    for s, f in ((1, "+x"), (-1, "-x")):
        x = K.sx(-2.575, 1.42, s)
        K.text("FIRE DEPT", 0.2, V((s * (x + 0.006), -2.575, 1.45)), f)
    K.text("FIRE DEPT", 0.15, V((0, F - 0.008, 1.64)), "-y")
    K.text("SOL CITY", 0.13, V((0, B + 0.008, 2.31)), "+y")
    # ---- cab interior: driver + officer, engine cover, crew seats
    seat = (0.6, -2.62, 1.55)
    K.door_liner(-2.97, -2.18, 0.6, 1.74)
    # under the cab floor: a two-step entry well behind the doors
    K.box("Interior", 0, -2.35, 0.67, 2.3, 1.5, 0.26)
    K.box("Interior", -0.15, -2.35, 0.95, 2.0, 1.5, 0.3)
    for y in (-2.575, -1.865):
        K.box("Chrome", 1.02, y, 0.81, 0.3, 0.7 if y < -2 else 0.4, 0.03)
    K.cockpit(*seat, floor_z=1.12, dash_front=-4.48, half_w=1.12, dash_top=1.97, floor_back=-1.6)
    K.box("Interior", 0, -3.0, 1.32, 0.5, 1.2, 0.4)
    for s in (1, -1):
        K.box("Interior", s * 0.6, -1.92, 1.49, 0.5, 0.48, 0.12)
        K.box("Interior", s * 0.6, -1.66, 1.8, 0.5, 0.1, 0.55, rx=-0.15)
        K.box("Trim", s * 0.6, -1.9, 1.28, 0.34, 0.36, 0.3)
    for s in (1, -1):
        K.wheel("wheel_F" + ("L" if s > 0 else "R"), s * 1.02, AF, R, 0.31, lugs=10, rim_scale=0.58)
        K.wheel("wheel_R" + ("L" if s > 0 else "R"), s * 0.9, AR, R, 0.29, dual=True, gap=0.04, lugs=10, rim_scale=0.58)
    body, door = finish(K, "firetruck", seat=seat, door_pos=(1.8, seat[1] - 0.1, 0), cam=(0, 0, 2.0),
                        door=dict(y0=-2.996, y1=-2.154, z0=0.52, z1=2.86, xmin=1.08, hinge_x=K.sx(-3.0, 1.6) - 0.02))
    preview("firetruck", 9.2, 2.6, 3.3, seat=seat, door=door, close=((0.7, -2.9, 2.0), (4.2, -4.6, 1.2)))


# ------------------------------------------------------------------ city bus
def bus():
    K = Kit("eeeeea", rim="c9ccd0", extra=[
        ("Livery", ("f28c1e", 0.32, 0.3), dict(coat=1.0)),
        ("Decal", ("f6f4ee", 0.45), {}),
        ("RouteSign", ("ffb020", 0.4, 0.0), dict(emit="ffa31a", emit_str=1.5))])
    F, B, R, AF, AR = -5.8, 5.8, 0.50, -3.05, 2.65
    sh = K.shell("bus", round_ends([(F, 1.27, .30, 3.02, 2.75, 1.2), (B, 1.27, .30, 3.02, 2.75, 1.2)], 0.12, 0.1),
                 rb=0.1, rt=0.28, nb=2, nt=5)
    K.arch(sh, AF, R, clr=0.1)
    K.arch(sh, AR, R, clr=0.1)
    rules = []
    # right side (-X): two double doors, glazed leaves
    for (a, b) in ((-5.56, -4.38), (-0.52, 0.76)):
        m = (a + b) / 2
        rules += [rules_side("Glass", (a + 0.05, m - 0.025), (0.45, 2.58), side=-1),
                  rules_side("Glass", (m + 0.025, b - 0.05), (0.45, 2.58), side=-1),
                  rules_side("Trim", (a, b), (0.36, 2.66), side=-1)]
    # left side: driver's window, then passenger windows
    rules += [rules_side("Glass", (-5.45, -4.35), (1.2, 2.58), side=1)]
    def panes(a, b, n, side):
        out, gap = [], 0.1
        w = (b - a - gap * (n - 1)) / n
        for k in range(n):
            out.append(rules_side("Glass", (a + k * (w + gap), a + k * (w + gap) + w), (1.14, 2.6), side=side))
        return out
    rules += panes(-4.18, 5.25, 7, 1)
    rules += panes(-4.2, -0.65, 3, -1) + panes(0.88, 5.25, 4, -1)
    rules += [rules_side("Trim", (-5.6, 5.4), (1.06, 2.68))]
    rules += [*framed(rules_front, 0.06, x=(0, 1.08), z=(0.95, 2.55)),
              rules_front("Trim", (0, 0.98), (2.66, 2.92)),
              *framed(rules_back, 0.05, x=(0, 0.98), z=(2.05, 2.62)),
              rules_back("Trim", (0, 0.92), (0.58, 1.12)),
              rules_side("Livery", (None, None), (0.56, 1.0)),
              rules_front("Livery", (0, 1.4), (0.56, 0.86)),
              rules_back("Livery", (0, 1.4), (1.2, 1.5))]
    K.paint(sh, rules)
    K.probe()
    # ---- front: route sign, lamps, bumper, plate, wipers, mirrors
    K.text("SOL CITY", 0.2, V((0.12, F - 0.004, 2.79)), "-y", mat="RouteSign")
    K.text("42", 0.18, V((-0.72, F - 0.004, 2.79)), "-y", mat="RouteSign")
    for s in (1, -1):
        fy = K.sfront(s * 0.86, 0.72)
        K.box("Trim", s * 0.86, fy + 0.01, 0.72, 0.42, 0.05, 0.18)
        K.box("Headlight", s * 0.80, fy - 0.01, 0.73, 0.22, 0.03, 0.12)
        K.box("Headlight", s * 1.0, fy - 0.01, 0.73, 0.1, 0.03, 0.1)
        iy = K.sfront(s * 1.08, 0.88)
        K.box("Indicator", s * 1.08, iy - 0.0, 0.88, 0.12, 0.04, 0.07)
        K.box("Trim", s * 0.45, F - 0.015, 0.99, 0.85, 0.025, 0.02, ry=-s * 0.06)
        # rabbit-ear mirrors
        K.tube("Trim", (s * 1.12, F + 0.05, 2.62), (s * 1.38, F - 0.32, 2.66), 0.022, segs=6)
        K.tube("Trim", (s * 1.38, F - 0.32, 2.66), (s * 1.42, F - 0.4, 2.3), 0.022, segs=6)
        K.box("Trim", s * 1.42, F - 0.4, 2.12, 0.09, 0.07, 0.36)
        K.box("Glass", s * 1.42, F - 0.4 + 0.037, 2.12, 0.07, 0.004, 0.3)
    K.box("Trim", 0, F + 0.02, 0.45, 2.48, 0.2, 0.28)
    K.box("Plate", 0, F - 0.085, 0.47, 0.52, 0.02, 0.12)
    # ---- rear: lamps, bumper, plate, grille slats, lettering
    for s in (1, -1):
        by = K.sback(s * 1.1, 1.0)
        K.box("Trim", s * 1.1, by - 0.005, 1.0, 0.16, 0.04, 0.68)
        K.box("Taillight", s * 1.1, by + 0.01, 1.14, 0.13, 0.03, 0.3)
        K.box("Indicator", s * 1.1, by + 0.01, 0.88, 0.13, 0.03, 0.12)
        K.box("Headlight", s * 1.1, by + 0.01, 0.74, 0.13, 0.03, 0.08)
        K.box("Taillight", s * 0.5, B + 0.002, 2.85, 0.12, 0.03, 0.05)
    for k in range(6):
        K.box("Chrome", 0, B + 0.005, 0.66 + k * 0.08, 1.7, 0.012, 0.012)
    K.box("Trim", 0, B - 0.02, 0.45, 2.48, 0.2, 0.28)
    K.box("Plate", 0, B + 0.085, 0.47, 0.52, 0.02, 0.12)
    K.text("SOL CITY", 0.2, V((0, B + 0.006, 1.35)), "+y", mat="Decal")
    # ---- side: lettering, door rails, markers
    K.text("SOL CITY TRANSIT", 0.36, V((K.sx(-0.2, 0.78, 1) + 0.005, -0.2, 0.78)), "+x")
    K.text("SOL CITY", 0.36, V((-(K.sx(-1.5, 0.78, -1) + 0.005), -1.5, 0.78)), "-x")
    for y in (-4.2, -1.0, 1.6, 4.4):
        for s in (1, -1):
            K.box("Indicator", s * (K.sx(y, 0.5, s) + 0.005), y, 0.5, 0.02, 0.08, 0.04)
    for a, b in ((-5.56, -4.38), (-0.52, 0.76)):
        x = K.sx((a + b) / 2, 1.5, -1)
        K.box("Trim", -(x + 0.002), (a + b) / 2, 1.5, 0.006, 0.012, 2.2)  # leaf split
        for yy in (a + 0.12, b - 0.12):
            K.tube("Chrome", (-(x - 0.03), yy, 0.9), (-(x - 0.03), yy, 2.1), 0.016, segs=6)
    # ---- roof: AC pod, hatches
    K.box("Paint", 0, 2.4, 3.12, 1.7, 2.4, 0.22)
    for y in (1.6, 2.4, 3.2):
        K.box("Trim", 0, y, 3.235, 1.3, 0.5, 0.01)
    for y in (-2.5, 0.2):
        K.box("Trim", 0, y, 3.03, 0.7, 0.7, 0.04)
    # ---- interior: floor, driver's platform + cockpit, seats, poles, rails
    K.box("Interior", 0, 0.0, 0.38, 2.4, 11.2, 0.04)
    K.box("Interior", 0, 4.45, 0.6, 2.4, 2.4, 0.4)   # raised rear floor over the engine
    seat = (0.72, -4.72, 1.15)
    K.box("Interior", 0.72, -4.85, 0.65, 0.9, 1.4, 0.5)
    K.cockpit(*seat, floor_z=0.9, dash_front=-5.55, half_w=0.45, passenger=False, floor_back=-4.15, cx=0.72)
    def row(x, y, z):
        K.box("Interior", x, y, z + 0.45, 0.85, 0.44, 0.1)
        K.box("Interior", x, y + 0.24, z + 0.75, 0.85, 0.08, 0.55, rx=-0.12)
        K.box("Trim", x, y, z + 0.2, 0.12, 0.3, 0.4)
    for y in (-3.85, -3.05, -2.25, -1.45, -0.65, 0.15, 0.95, 1.75):
        row(0.75, y, 0.4 if abs(y - AR) > 0.8 and abs(y - AF) > 0.8 else 0.75)
    for y in (-3.85, -3.05, -2.25, 1.15, 1.95):
        row(-0.75, y, 0.4 if abs(y - AR) > 0.8 and abs(y - AF) > 0.8 else 0.75)
    for y in (3.75, 4.55):
        for x in (0.75, -0.75):
            row(x, y, 0.8)
    K.box("Interior", 0, 5.3, 1.25, 2.3, 0.44, 0.1)
    K.box("Interior", 0, 5.52, 1.55, 2.3, 0.08, 0.55)
    for y in (-3.4, -1.0, 0.9, 2.2):
        K.cyl("Chrome", 0.28, y, 1.6, 0.02, 2.4, segs=8)
    for s in (1, -1):
        K.tube("Chrome", (s * 0.4, -4.0, 2.55), (s * 0.4, 3.0, 2.55), 0.018, segs=6)
    for s in (1, -1):
        K.wheel("wheel_F" + ("L" if s > 0 else "R"), s * 1.04, AF, R, 0.3, lugs=10, rim_scale=0.58)
        K.wheel("wheel_R" + ("L" if s > 0 else "R"), s * 0.92, AR, R, 0.28, dual=True, gap=0.03, lugs=10, rim_scale=0.58)
    finish(K, "bus", seat=seat, door_pos=(1.82, seat[1] - 0.1, 0), cam=(0, 0, 2.0))
    preview("bus", 11.6, 2.6, 3.25, seat=seat, close=((0.6, -4.9, 1.7), (3.6, -7.2, 1.0)))


# ------------------------------------------------------------------ truck (tractor unit)
HITCH = (0.0, 2.45, 1.22)


def truck():
    K = Kit("1d4f9c", rim="d8dadc", extra=[("Decal", ("f4f4f0", 0.45), {})])
    F, R, AF, AR1, AR2 = -3.55, 0.52, -2.6, 1.85, 3.15
    hood = K.shell("hood", [(-3.40, .60, .95, 1.80, 1.62, .55), (-3.30, .62, .92, 1.86, 1.66, .57),
                            (-2.6, .63, .90, 1.93, 1.70, .58), (-1.40, .64, .90, 2.02, 1.74, .58)], rb=0.03, rt=0.14, nb=2, nt=4)
    cab = K.shell("cab", round_ends([(-1.44, 1.06, 1.05, 2.98, 2.1, 1.0), (0.42, 1.06, 1.05, 2.98, 2.1, 1.0)], 0.06, 0.05),
                  rb=0.05, rt=0.16, nb=2, nt=4)
    K.paint(hood, [rules_front("Chrome", (0, 2), (0, 3), thr=0.7)])
    K.paint(cab, [
        rules_front("Trim", (0, 0.04), (2.13, 2.83)),
        *framed(rules_front, 0.05, x=(0.04, 0.92), z=(2.18, 2.78)),
        *framed(rules_side, 0.04, y=(-1.2, -0.27), z=(2.15, 2.75)),
        *framed(rules_back, 0.04, x=(0, 0.45), z=(2.2, 2.6)),
        rules_side("Chrome", (None, None), (1.08, 1.14)),
    ])
    K.probe()
    # grille: chrome shell (painted by the rule above) + dark core with vertical bars, emblem
    K.box("Trim", 0, -3.405, 1.36, 0.98, 0.02, 0.76)
    for k in range(13):
        K.box("Chrome", -0.45 + k * 0.075, -3.42, 1.36, 0.02, 0.02, 0.74)
    K.box("Chrome", 0, -3.43, 1.8, 0.3, 0.03, 0.06)
    K.box("Chrome", 0, -3.0, 1.89, 0.03, 0.5, 0.04)     # hood centre strip
    K.box("Chrome", 0, -3.34, 1.9, 0.06, 0.1, 0.06)     # mascot
    # front fenders sweeping back to the cab, headlight pods, indicators
    for s in (1, -1):
        K.fender("Paint", s * 0.93, AF, R + 0.02, R + 0.1, 0.62, 0.12, 2.3, th=0.03)
        K.box("Paint", s * 0.93, -1.8, 1.0, 0.62, 0.8, 0.04)
        K.box("Trim", s * 0.63, -2.6, 0.92, 0.02, 1.6, 0.4)
        K.cyl("Chrome", s * 0.92, -3.05, 1.2, 0.14, 0.14, axis="y", segs=16)
        K.cyl("Headlight", s * 0.92, -3.12, 1.2, 0.12, 0.012, axis="y", segs=16)
        K.box("Chrome", s * 0.92, -3.0, 1.05, 0.05, 0.05, 0.12)
        K.box("Indicator", s * 1.12, -3.0, 1.04, 0.08, 0.1, 0.05)
        # air cleaners on the cowl
        K.cyl("Chrome", s * 0.88, -1.8, 1.25, 0.2, 0.62, axis="y", segs=16)
        K.cyl("Trim", s * 0.88, -1.8, 1.25, 0.205, 0.05, axis="y", segs=16)
        # mirrors on the door front edge
        x = K.sx(-1.32, 2.3, s)
        K.tube("Chrome", (s * (x - 0.02), -1.33, 2.2), (s * (x + 0.3), -1.36, 2.2), 0.015, segs=6)
        K.tube("Chrome", (s * (x - 0.02), -1.33, 2.65), (s * (x + 0.3), -1.36, 2.6), 0.015, segs=6)
        K.box("Trim", s * (x + 0.31), -1.36, 2.4, 0.08, 0.11, 0.48)
        K.box("Glass", s * (x + 0.31), -1.36 + 0.057, 2.4, 0.065, 0.004, 0.42)
        # fuel tank, straps, steps
        K.cyl("Chrome", s * 0.8, -0.65, 0.74, 0.3, 1.1, axis="y", segs=20)
        for y in (-1.0, -0.3):
            K.cyl("Trim", s * 0.8, y, 0.74, 0.305, 0.04, axis="y", segs=20)
        K.box("Chrome", s * 0.97, -1.36, 0.62, 0.26, 0.24, 0.04)
        K.box("Chrome", s * 0.97, -1.36, 0.88, 0.26, 0.24, 0.04)
        K.box("Trim", s * 0.97, -1.36, 0.75, 0.24, 0.02, 0.3)
        # exhaust stacks + heat shields
        K.cyl("Chrome", s * 0.9, 0.6, 2.6, 0.065, 2.7, segs=12)
        K.cyl("Chrome", s * 0.9, 0.6, 2.0, 0.085, 0.8, segs=12)
        K.box("Trim", s * 0.9, 0.5, 1.6, 0.06, 0.2, 0.06)
        K.box("Trim", s * 0.9, 0.5, 2.6, 0.06, 0.2, 0.06)
        # quarter fenders over the drive axles, mud flaps
        for ay in (AR1, AR2):
            K.fender("Trim", s * 0.93, ay, R + 0.02, R + 0.08, 0.66, 1.0, 2.15, th=0.02, n=8)
        K.box("Trim", s * 0.95, AR2 + 0.68, 0.55, 0.62, 0.02, 0.6)
        K.box("Chrome", s * 0.95, AR2 + 0.68, 0.87, 0.64, 0.03, 0.04)
        # rear lamps on the frame end
        K.box("Taillight", s * 0.32, 3.62, 0.95, 0.14, 0.04, 0.08)
        K.box("Indicator", s * 0.5, 3.62, 0.95, 0.1, 0.04, 0.08)
        # horns on the roof
        K.cyl("Chrome", s * 0.3, -0.85, 3.02, 0.04, 0.5, axis="y", segs=10, r2=0.07)
    # bumper, engine, frame, deck plate, fifth wheel
    K.box("Chrome", 0, F + 0.11, 0.62, 2.42, 0.22, 0.32)
    K.box("Trim", 0, F + 0.11, 0.45, 2.3, 0.18, 0.04)
    K.box("Plate", 0, F - 0.005, 0.62, 0.52, 0.02, 0.12)
    K.box("Trim", 0, -2.45, 0.78, 0.86, 1.7, 0.42)
    for s in (1, -1):
        K.box("Trim", s * 0.43, 0.05, 0.96, 0.2, 7.1, 0.28)
    K.box("Trim", 0, 3.6, 0.96, 1.06, 0.08, 0.28)
    K.box("Chrome", 0, 0.88, 1.12, 1.7, 0.85, 0.03)
    K.box("Trim", 0, HITCH[1], HITCH[2] - 0.14, 0.9, 0.9, 0.1)  # fifth wheel mount
    K.box("Trim", 0, HITCH[1] + 0.25, HITCH[2] - 0.06, 0.24, 0.5, 0.08)  # kingpin slot
    for s in (1, -1):
        K.box("Trim", s * 0.28, HITCH[1], HITCH[2] - 0.055, 0.5, 0.95, 0.09, rz=s * 0.06)  # top plate, 1 cm under the trailer floor
    # roof: sun visor + clearance lamps; cab seams and handles
    K.box("Paint", 0, -1.52, 2.93, 2.0, 0.26, 0.04, rx=0.25)
    for k in range(5):
        K.box("Indicator", -0.5 + k * 0.25, -1.64, 2.92, 0.08, 0.03, 0.04)
    K.seam_v(-1.29, 1.08, 2.84)
    K.seam_v(-0.17, 1.08, 2.84)
    K.handle(-0.3, 1.95)
    for s in (1, -1):
        K.tube("Chrome", (s * 1.08, -0.1, 1.3), (s * 1.08, -0.1, 2.3), 0.018, segs=6)
    for s, f in ((1, "+x"), (-1, "-x")):
        x = K.sx(-0.73, 1.6, s)
        K.text("SOL FREIGHT", 0.19, V((s * (x + 0.005), -0.73, 1.62)), f)
    seat = (0.5, -0.72, 1.78)
    K.door_liner(-1.25, -0.2, 1.12, 2.1)
    K.cockpit(*seat, floor_z=1.4, dash_front=-1.36, half_w=0.98, dash_top=2.18, floor_back=0.35)
    K.box("Interior", 0, 0.33, 2.0, 1.95, 0.04, 1.6)
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        K.wheel("wheel_F" + sd, s * 1.03, AF, R, 0.3, lugs=10, rim_scale=0.58)
        K.wheel("wheel_R" + sd, s * 0.925, AR1, R, 0.28, dual=True, gap=0.04, lugs=10, rim_scale=0.58)
        K.wheel("wheel_R" + sd + "2", s * 0.925, AR2, R, 0.28, dual=True, gap=0.04, lugs=10, rim_scale=0.58)
    body, door = finish(K, "truck", seat=seat, door_pos=(1.61, seat[1] - 0.1, 0), cam=(0, 0, 2.0),
                        empties=[("Hitch", HITCH)],
                        door=dict(y0=-1.286, y1=-0.174, z0=1.06, z1=2.85, xmin=0.95, hinge_x=K.sx(-1.29, 1.6) - 0.02))
    preview("truck", 7.2, 2.6, 3.9, seat=seat, door=door, close=((0.6, -0.9, 2.3), (3.6, -3.4, 0.9)))


# ------------------------------------------------------------------ box trailer
KINGPIN = (0.0, -5.2, 1.22)


def trailer():
    K = Kit("f2f2ee", rim="d8dadc", extra=[("Livery", ("f28c1e", 0.35, 0.2), dict(coat=1.0)), ("Decal", ("1b2a4a", 0.5), {})])
    F, B, R, AR1, AR2 = -6.1, 6.1, 0.52, 3.85, 5.1
    sh = K.shell("box", round_ends([(F, 1.28, 1.22, 4.05, 3.95, 1.27), (B, 1.28, 1.22, 4.05, 3.95, 1.27)], 0.03),
                 rb=0.02, rt=0.04, nb=2, nt=2, step=0.5)
    K.paint(sh, [
        rules_back("Paint", (0, 1.12), (1.36, 3.92)),
        rules_back("Chrome", (0, 2), (0, 9)),
        rules_side("Chrome", (None, None), (1.22, 1.36)),
        rules_side("Chrome", (None, None), (3.92, 4.1)),
        rules_side("Livery", (None, None), (1.52, 1.72)),
        rules_front("Chrome", (1.15, 2), (0, 9)),
    ])
    K.probe()
    # side posts every 1.2 m, marker lamps, conspicuity
    y = F + 0.6
    while y < B - 0.3:
        for s in (1, -1):
            K.box("Chrome", s * 1.282, y, 2.65, 0.006, 0.05, 2.56)
        y += 1.2
    for y in (F + 0.15, 0.0, B - 0.15):
        for s in (1, -1):
            K.box("Indicator" if y < B - 1 else "Taillight", s * 1.285, y, 1.3, 0.02, 0.09, 0.05)
    # rear doors: seams, lock rods, hinges, handles; lamps, bumper
    K.box("Trim", 0, B + 0.004, 2.64, 0.014, 0.012, 2.56)
    for s in (1, -1):
        for lx in (0.32, 0.86):
            K.cyl("Chrome", s * lx, B + 0.03, 2.64, 0.018, 2.5, segs=8)
            for z in (1.6, 3.7):
                K.box("Chrome", s * lx, B + 0.02, z, 0.08, 0.03, 0.06)
            K.box("Chrome", s * (lx + 0.1), B + 0.04, 2.2, 0.2, 0.025, 0.03)
        for z in (1.6, 2.3, 3.0, 3.7):
            K.box("Trim", s * 1.08, B + 0.02, z, 0.2, 0.03, 0.08)
        K.box("Taillight", s * 0.95, B + 0.02, 1.29, 0.2, 0.03, 0.09)
        K.box("Indicator", s * 0.7, B + 0.02, 1.29, 0.12, 0.03, 0.09)
        K.box("Trim", s * 0.6, B - 0.06, 0.88, 0.1, 0.1, 0.66)
        K.box("Trim", s * 0.94, AR2 + 0.68, 0.55, 0.6, 0.02, 0.6)
    for k in (-1, 0, 1):
        K.box("Taillight", k * 0.12, B + 0.012, 3.98, 0.06, 0.03, 0.04)
    K.box("Trim", 0, B + 0.0, 0.55, 2.3, 0.12, 0.16)
    K.box("Plate", 0, B + 0.025, 1.1, 0.52, 0.02, 0.12)
    # under the floor: rails, slider, axles, landing gear, kingpin, glad hands
    for s in (1, -1):
        K.box("Trim", s * 0.5, 1.0, 1.06, 0.12, 10.0, 0.3)  # main rails, clear of the fifth wheel
        K.box("Trim", s * 0.55, (AR1 + AR2) / 2, 0.93, 0.25, 2.4, 0.26)
        K.box("Trim", s * 0.6, -3.4, 0.68, 0.12, 0.12, 1.1)
        K.box("Trim", s * 0.6, -3.4, 0.16, 0.1, 0.1, 0.3)
        K.box("Trim", s * 0.6, -3.4, 0.03, 0.26, 0.26, 0.06)
        K.box("Trim", s * 0.6, -3.15, 0.9, 0.06, 0.5, 0.06, rx=0.7)
        K.box("Trim", s * 1.0, -3.0, 1.12, 0.6, 0.06, 0.2)   # side underride rail brackets
    K.box("Trim", 0, -3.4, 0.6, 1.2, 0.06, 0.06)
    K.cyl("Chrome", 0.85, -3.4, 0.8, 0.012, 0.3, axis="x", segs=6)
    K.box("Chrome", 1.0, -3.4, 0.72, 0.02, 0.02, 0.18)
    for ay in (AR1, AR2):
        K.cyl("Trim", 0, ay, R, 0.06, 1.6, axis="x", segs=10)
        for s in (1, -1):
            K.box("Trim", s * 0.55, ay, 0.72, 0.12, 0.7, 0.12)
    K.cyl("Chrome", *KINGPIN[:2], KINGPIN[2] - 0.05, 0.045, 0.1, segs=10)
    for s, m in ((1, "Taillight"), (-1, "Indicator")):
        K.box(m, s * 0.25, F - 0.02, 1.5, 0.08, 0.04, 0.06)
    K.text("SOL FREIGHT", 1.25, V((K.sx(0.0, 2.75, 1) + 0.006, 0.0, 2.75)), "+x")
    K.text("SOL FREIGHT", 1.25, V((-(K.sx(0.0, 2.75, -1) + 0.006), 0.0, 2.75)), "-x")
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        K.wheel("wheel_R" + sd, s * 0.925, AR1, R, 0.28, dual=True, gap=0.04, lugs=10, rim_scale=0.58)
        K.wheel("wheel_R" + sd + "2", s * 0.925, AR2, R, 0.28, dual=True, gap=0.04, lugs=10, rim_scale=0.58)
    finish(K, "trailer", empties=[("Kingpin", KINGPIN)], cam=(0, 0, 2.5))
    preview("trailer", 12.2, 2.6, 4.1)


# ------------------------------------------------------------------ tow truck
def towtruck():
    K = Kit("f2b01e", rim="c9ccd0", extra=[
        ("Decal", ("16171a", 0.5), {}),
        ("Beacon", ("b8700c", 0.15, 0.0), dict(emit="ffa010", emit_str=0.0))])
    F, B, R, AF, AR = -3.0, 3.05, 0.42, -1.95, 1.72
    cab = K.shell("cab", [
        (-3.00, .86, .48, .90, .82, .82), (-2.95, .96, .40, 1.02, .94, .92), (-2.80, 1.01, .36, 1.10, 1.02, .97),
        (-2.30, 1.02, .35, 1.18, 1.10, .98), (-1.32, 1.02, .35, 1.26, 1.18, .98), (-0.88, 1.02, .35, 1.98, 1.22, .89),
        (0.02, 1.02, .35, 2.00, 1.22, .88), (0.10, 1.00, .37, 1.96, 1.20, .86)], rb=0.1, rt=0.13)
    bed = K.shell("bed", round_ends([(0.15, 1.02, .55, 1.25, 1.12, 1.0), (B, 1.02, .55, 1.25, 1.12, 1.0)], 0.04),
                  rb=0.04, rt=0.03, nb=2, nt=2)
    K.arch(cab, AF, R)
    K.arch(bed, AR, R)
    K.paint(cab, [
        *framed(rules_front, 0.035, x=(0, 0.78), z=(1.0, 2.2), y=(-1.29, -0.92), thr=0.25, extra_n=(("z", 1, 0.15),)),
        *framed(rules_side, 0.035, y=(-0.84, -0.08), z=(1.29, 1.86)),
        *framed(rules_back, 0.035, x=(0, 0.62), z=(1.36, 1.8)),
        rules_side("Trim", (None, None), (0.36, 0.5)),
    ])
    boxes = [(0.3, 1.1), (2.32, 2.95)]
    rr = []
    for a, b in boxes:
        rr += framed(rules_side, 0.025, glass="Chrome", y=(a, b), z=(0.64, 1.16))
    K.paint(bed, rr + [dict(mat="Chrome", z=(1.2, None), n=(("z", 1, 0.8),), only=("Paint",)),
                       rules_side("Trim", (None, None), (0.55, 0.62))])
    K.probe()
    # front: grille, lamps, push bumper, plate, wipers, mirrors
    fy = K.sfront(0, 0.75)
    K.box("Chrome", 0, fy + 0.015, 0.75, 1.1, 0.06, 0.32)
    K.box("Trim", 0, fy - 0.005, 0.75, 0.98, 0.04, 0.24)
    for k in range(3):
        K.box("Chrome", 0, fy - 0.03, 0.67 + k * 0.08, 1.0, 0.02, 0.02)
    for s in (1, -1):
        hy = K.sfront(s * 0.72, 0.86)
        K.box("Chrome", s * 0.72, hy + 0.01, 0.86, 0.3, 0.05, 0.15, rz=-s * 0.12)
        K.box("Headlight", s * 0.72, hy - 0.008, 0.86, 0.26, 0.03, 0.11, rz=-s * 0.12)
        iy = K.sfront(s * 0.92, 0.7)
        K.box("Indicator", s * 0.92, iy + 0.004, 0.7, 0.12, 0.04, 0.07, rz=-s * 0.4)
        wz = K.stop(s * 0.3, -1.25)
        K.box("Trim", s * 0.32, -1.25, wz + 0.015, 0.6, 0.025, 0.015)
        x = K.sx(-1.0, 1.32, s)
        K.box("Trim", s * (x - 0.01), -1.02, 1.3, 0.1, 0.06, 0.05)
        K.sphere("Paint", s * (x + 0.12), -1.0, 1.36, 0.11, 0.05, 0.08, segs=12, rings=8)
        K.box("Glass", s * (x + 0.13), -0.95, 1.36, 0.09, 0.004, 0.06)
    K.box("Chrome", 0, F - 0.02, 0.48, 2.0, 0.2, 0.2)
    for s in (1, -1):
        K.box("Chrome", s * 0.35, F - 0.12, 0.72, 0.06, 0.06, 0.5)
    K.box("Chrome", 0, F - 0.12, 0.95, 0.76, 0.06, 0.06)
    K.box("Plate", 0, F - 0.125, 0.5, 0.52, 0.02, 0.12)
    K.seam_v(-1.22, 0.38, 1.9)
    K.seam_v(-0.02, 0.38, 1.9)
    K.handle(-0.15, 1.12)
    lightbar(K, -0.4, 2.0, w=1.3, mats=("Beacon", "Beacon"))
    # wrecker body: toolbox handles, tower, boom, cable, hook, wheel-lift, lamps
    for a, b in boxes:
        K.handle(b - 0.1, 1.08, length=0.1)
    for s in (1, -1):
        K.box("Paint", s * 0.34, 1.0, 1.75, 0.14, 0.14, 1.0)
        K.cyl("Beacon", s * 0.34, 1.0, 2.31, 0.07, 0.12, segs=12)
        K.cyl("Trim", s * 0.34, 1.0, 2.255, 0.075, 0.02, segs=12)
        K.box("Taillight", s * 0.85, B + 0.01, 1.0, 0.16, 0.03, 0.12)
        K.box("Indicator", s * 0.85, B + 0.01, 0.85, 0.16, 0.03, 0.08)
        K.box("Chrome", s * 0.82, 3.4, 0.4, 0.06, 0.36, 0.06)
        K.box("Chrome", s * 0.82, 3.56, 0.46, 0.06, 0.06, 0.14)
        K.box("Trim", s * 0.85, AR + 0.58, 0.36, 0.34, 0.02, 0.3)
    K.box("Paint", 0, 1.0, 2.2, 0.82, 0.18, 0.14)
    a, b = V((0, 1.0, 2.18)), V((0, 3.35, 2.62))
    K.tube("Paint", a, b, 0.11, segs=4)
    K.tube("Chrome", (0, 1.5, 1.3), (0, 2.25, 2.33), 0.05, segs=10)
    K.tube("Trim", (0, 1.45, 1.27), (0, 1.75, 1.75), 0.07, segs=10)
    K.cyl("Chrome", 0, 3.35, 2.6, 0.12, 0.12, axis="x", segs=16)
    K.cyl("Trim", 0, 3.35, 2.6, 0.05, 0.2, axis="x", segs=10)
    K.tube("Trim", (0, 3.47, 2.58), (0, 3.47, 1.5), 0.008, segs=5)
    K.box("Chrome", 0, 3.47, 1.45, 0.08, 0.06, 0.12)
    K.torus("Chrome", 0, 3.47, 1.33, R=0.06, r=0.014, n1=12, n2=4, rx=math.pi / 2, rz=math.pi / 2)
    K.box("Trim", 0, 3.15, 0.42, 0.2, 0.8, 0.12)
    K.box("Trim", 0, 3.5, 0.42, 1.7, 0.14, 0.1)
    K.box("Plate", 0, B + 0.01, 0.72, 0.52, 0.02, 0.12)
    K.box("Trim", 0, B - 0.02, 0.55, 2.0, 0.12, 0.12)
    for s, f in ((1, "+x"), (-1, "-x")):
        x = K.sx(-0.62, 1.0, s)
        K.text("SOL TOWING", 0.17, V((s * (x + 0.006), -0.62, 0.95)), f)
    seat = (0.45, -0.58, 0.84)
    K.door_liner(-1.19, -0.05, 0.42, 1.24)
    K.cockpit(*seat, floor_z=0.62, dash_front=-1.28, half_w=0.9, dash_top=1.24, floor_back=0.05)
    K.box("Interior", 0, 0.06, 1.15, 1.9, 0.04, 1.4)
    for s in (1, -1):
        K.wheel("wheel_F" + ("L" if s > 0 else "R"), s * 0.86, AF, R, 0.265)
        K.wheel("wheel_R" + ("L" if s > 0 else "R"), s * 0.86, AR, R, 0.265)
    body, door = finish(K, "towtruck", seat=seat, door_pos=(1.57, seat[1] - 0.1, 0), cam=(0, 0, 1.4),
                        door=dict(y0=-1.216, y1=-0.024, z0=0.37, z1=1.93, xmin=0.86, hinge_x=K.sx(-1.22, 0.9) - 0.02))
    preview("towtruck", 6.6, 2.1, 2.7, seat=seat, door=door, close=((0.5, -0.8, 1.3), (3.0, -2.6, 1.0)))


# ------------------------------------------------------------------ speedboat
# faces of a hull_pts loft, by segment around the section (0 = keel to the first bottom point)
HULL_BOTTOM, HULL_SIDES, HULL_GUNWALE, HULL_DECK = (0, 1, 2, 15, 16, 17), (3, 4, 5, 12, 13, 14), (6, 11), (7, 8, 9, 10)
BOAT_ROWS = [  # (y, keel z, chine half-width, chine z, sheer half-width, sheer z, deck crown)
    (-3.10, 0.40, 0.010, 0.45, 0.015, 0.80, 0.0), (-3.00, 0.20, 0.06, 0.38, 0.12, 0.79, 0.02),
    (-2.70, -0.02, 0.22, 0.20, 0.42, 0.77, 0.05), (-2.10, -0.20, 0.50, 0.04, 0.80, 0.73, 0.07),
    (-1.30, -0.30, 0.76, -0.06, 1.05, 0.69, 0.08), (-0.40, -0.33, 0.88, -0.10, 1.14, 0.65, 0.08),
    (1.20, -0.32, 0.93, -0.12, 1.15, 0.62, 0.07), (3.10, -0.29, 0.93, -0.12, 1.12, 0.60, 0.06)]


def open_cockpit(K, ob, rows, y0, y1, xw, floor_z, wall="Livery", floor="Deck"):
    """remove the deck over the cockpit and line the hole with walls and a sole (as the car cabins)"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for co, no in (((0, y0, 0), (0, 1, 0)), ((0, y1, 0), (0, 1, 0)), ((xw, 0, 0), (1, 0, 0)), ((-xw, 0, 0), (1, 0, 0))):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    bm.normal_update()
    lid = [f for f in bm.faces if y0 < f.calc_center_median().y < y1 and abs(f.calc_center_median().x) < xw and f.normal.z > 0.3
           and f.calc_center_median().z > 0.2]
    bmesh.ops.delete(bm, geom=lid, context="FACES")
    W, Fl = K[wall], K[floor]
    n = int((y1 - y0) / 0.1)
    ys = [y0 + (y1 - y0) * k / n for k in range(n + 1)]
    for s in (1, -1):
        col = [(bm.verts.new((s * xw, y, floor_z)), bm.verts.new((s * xw, y, deck_z(rows, y, xw)))) for y in ys]
        for (a0, a1), (b0, b1) in zip(col, col[1:]):
            bm.faces.new((a0, b0, b1, a1)).material_index = W
    xs = [-xw + 2 * xw * k / 12 for k in range(13)]
    for y in (y0, y1):
        col = [(bm.verts.new((x, y, floor_z)), bm.verts.new((x, y, deck_z(rows, y, x)))) for x in xs]
        for (a0, a1), (b0, b1) in zip(col, col[1:]):
            bm.faces.new((a0, b0, b1, a1)).material_index = W
    q = [bm.verts.new(p) for p in ((-xw, y0, floor_z), (xw, y0, floor_z), (xw, y1, floor_z), (-xw, y1, floor_z))]
    bm.faces.new(q).material_index = Fl
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()


def boat():
    K = Kit("1f5fa8", rim="c9ccd0", extra=[
        ("Livery", ("f4f3ef", 0.3, 0.1), dict(coat=1.0)),
        ("Deck", ("e3ddcf", 0.8), {}),
        ("Seat", ("f2efe6", 0.6), {}),
        ("Decal", ("c9a227", 0.35, 0.6), {})])
    rows = BOAT_ROWS
    hull = K.hull("hull", rows)
    K.paint(hull, [
        dict(mat="Livery", seg=HULL_BOTTOM),
        dict(mat="Deck", seg=HULL_DECK),
        dict(mat="Livery", seg=HULL_GUNWALE),
        dict(mat="Decal", seg=HULL_SIDES, z=(0.40, 0.45)),
        dict(mat="Livery", seg=(-1,), z=(None, 0.0)),
    ])
    Y0, Y1, XW, FZ = -0.95, 2.35, 0.86, 0.17
    open_cockpit(K, hull, rows, Y0, Y1, XW, FZ)
    K.probe()
    # wrap-around windscreen with a chrome top rail
    cols = []
    for k in range(11):
        th = math.radians(-100 + 200 * k / 10)
        x, y = 0.92 * math.sin(th), -0.98 - 0.3 * math.cos(th)
        zb = deck_z(rows, y, x) - 0.005
        cols.append((V((x, y, zb)), V((x * 0.97, y + 0.17, zb + 0.42))))
    for (a0, a1), (b0, b1) in zip(cols, cols[1:]):
        K.quad("Glass", (a0, b0, b1, a1))
        K.tube("Chrome", a1, b1, 0.012, segs=6)
    for a0, a1 in (cols[0], cols[-1]):
        K.tube("Chrome", a0, a1, 0.012, segs=6)
    # helm (left) + passenger seat, dash, wheel; rear bench; engine hatch
    seat = (0.48, 0.05, 0.62)
    # helm console on the left, a matching one on the right, walk-through to the bow between them
    K.cockpit(*seat, floor_z=FZ, dash_front=Y0 + 0.02, half_w=0.36, seat_mat="Seat", headrest=False, floor_back=Y0 + 0.1,
              dash_mat="Livery", cx=seat[0])
    d0, d1 = Y0 + 0.02, seat[1] - 0.51
    K.box("Livery", -seat[0], (d0 + d1) / 2, (FZ + seat[2] + 0.42) / 2, 0.72, d1 - d0, seat[2] + 0.42 - FZ)
    for x in (seat[0], -seat[0]):
        K.box("Interior", x, (d0 + d1) / 2 + 0.02, seat[2] + 0.425, 0.66, d1 - d0 - 0.06, 0.012)  # dark dash tops
    K.box("Chrome", seat[0] + 0.28, -0.6, 1.08, 0.03, 0.03, 0.16, rx=0.4)       # throttle
    K.sphere("Trim", seat[0] + 0.28, -0.56, 1.16, 0.03, 0.03, 0.03, segs=8, rings=6)
    K.box("Seat", 0, 1.98, 0.43, 1.66, 0.52, 0.18)
    K.box("Seat", 0, 2.26, 0.74, 1.66, 0.16, 0.5, rx=-0.2)
    K.box("Livery", 0, 1.98, 0.27, 1.6, 0.48, 0.2)
    K.box("Trim", 0, 2.75, deck_z(rows, 2.75, 0) + 0.005, 1.4, 0.5, 0.01)       # engine hatch seam
    # outboard motor on the transom
    tz = 0.6
    K.box("Trim", 0, 3.18, 0.5, 0.3, 0.16, 0.3)
    K.loft_y("Trim", [(3.2, 0, 0.95, 0.05, 0.05), (3.25, 0, 0.98, 0.22, 0.2), (3.45, 0, 1.0, 0.26, 0.24),
                      (3.7, 0, 0.98, 0.22, 0.2), (3.82, 0, 0.94, 0.1, 0.12)], segs=16, exp=2.4)
    K.box("Chrome", 0, 3.5, 1.05, 0.535, 0.4, 0.04)
    K.box("Trim", 0, 3.42, 0.35, 0.14, 0.28, 0.85)
    K.box("Trim", 0, 3.42, -0.06, 0.36, 0.34, 0.02)
    K.loft_y("Trim", [(3.2, 0, -0.26, 0.02, 0.02), (3.26, 0, -0.26, 0.07, 0.07), (3.55, 0, -0.26, 0.06, 0.06), (3.62, 0, -0.26, 0.03, 0.03)], segs=10)
    K.box("Trim", 0, 3.45, -0.38, 0.02, 0.2, 0.2)
    for k in range(3):
        a = 2 * math.pi * k / 3
        K.box("Chrome", 0, 3.65, -0.26, 0.02, 0.06, 0.2, rx=0.0, ry=a, rz=0.0)
    for s in (1, -1):
        K.box("Deck", s * 0.62, 3.25, 0.2, 0.62, 0.32, 0.05)              # swim platform
        K.box("Taillight", s * 0.95, 3.1 + 0.005, 0.5, 0.06, 0.02, 0.03)
        # bow rails, cleats, rub rail
        pts = []
        for y in (-2.65, -2.2, -1.75, -1.35):
            zs = hermite(rows, y)
            x = zs[3] - 0.08
            top = V((s * x, y, deck_z(rows, y, x) + 0.26))
            K.tube("Chrome", (s * x, y, deck_z(rows, y, x)), top, 0.012, segs=6)
            pts.append(top)
        for a, b in zip(pts, pts[1:]):
            K.tube("Chrome", a, b, 0.014, segs=6)
        for y in (-1.6, 2.6):
            x = hermite(rows, y)[3] - 0.1
            K.box("Chrome", s * x, y, deck_z(rows, y, x) + 0.02, 0.04, 0.16, 0.03)
        prev = None
        for k in range(32):
            y = -2.9 + 6.0 * k / 31
            zk, xc, zc, hws, zs, cr = hermite(rows, y)
            p = V((s * (hws + 0.012), y, zs - 0.01))
            if prev is not None:
                K.tube("Trim", prev, p, 0.022, segs=6)
            prev = p
    K.box("Headlight", 0, -2.95, 0.86, 0.04, 0.06, 0.04)  # bow light
    K.text("SOL", 0.28, V((hermite(rows, -1.9)[3] + 0.03, -1.9, 0.42)), "+x")
    K.text("SOL", 0.28, V((-(hermite(rows, -1.9)[3] + 0.03), -1.9, 0.42)), "-x")
    hips = (seat[0], seat[1], seat[2] + 0.09)
    finish(K, "boat", seat=seat, door_pos=(1.7, seat[1] - 0.1, 0), cam=(0, 0, 1.0), empties=[("Seat", hips)])
    preview("boat", 7.0, 2.4, 1.6, seat=seat, water=True, z0=-0.3, close=((0.4, -0.4, 0.8), (2.8, -2.6, 1.3)))


# ------------------------------------------------------------------ jet ski
JET_ROWS = [
    (-1.60, 0.30, 0.010, 0.34, 0.015, 0.44, 0.0), (-1.50, 0.14, 0.07, 0.24, 0.13, 0.45, 0.02),
    (-1.25, -0.04, 0.22, 0.08, 0.34, 0.47, 0.02), (-0.80, -0.15, 0.40, -0.01, 0.52, 0.49, -0.04),
    (-0.10, -0.19, 0.47, -0.05, 0.57, 0.49, -0.07), (0.90, -0.18, 0.47, -0.06, 0.55, 0.48, -0.07),
    (1.55, -0.16, 0.45, -0.06, 0.50, 0.45, -0.04)]
JET_HIPS = V((0.0, 0.12, 0.93))


def jetski():
    K = Kit("e8501c", rim="c9ccd0", extra=[
        ("Livery", ("f4f3ef", 0.3, 0.1), dict(coat=1.0)),
        ("Deck", ("1c1d1f", 0.9), {}),
        ("Seat", ("2b2c2f", 0.7), {}),
        ("Decal", ("16171a", 0.5), {})])
    rows = JET_ROWS
    hull = K.hull("hull", rows, step=0.08)
    K.paint(hull, [
        dict(mat="Trim", seg=HULL_BOTTOM),
        dict(mat="Deck", seg=HULL_DECK),
        dict(mat="Livery", seg=HULL_SIDES, z=(0.2, 0.3)),
        dict(mat="Trim", seg=(-1,), z=(None, 0.25)),
    ])
    K.probe()
    # hood and pedestal + seat (straddle, like the bike: hips at JET_HIPS)
    K.loft_y("Paint", [(-1.5, 0, 0.49, 0.06, 0.03), (-1.38, 0, 0.55, 0.26, 0.09), (-1.1, 0, 0.62, 0.42, 0.17),
                       (-0.78, 0, 0.69, 0.46, 0.23), (-0.5, 0, 0.73, 0.4, 0.25), (-0.33, 0, 0.71, 0.27, 0.2),
                       (-0.24, 0, 0.67, 0.13, 0.12)], segs=18, exp=2.4)
    K.loft_y("Paint", [(-0.32, 0, 0.58, 0.1, 0.14), (-0.26, 0, 0.58, 0.17, 0.17), (0.95, 0, 0.58, 0.17, 0.17),
                       (1.08, 0, 0.57, 0.1, 0.14)], segs=16, exp=3.0)
    K.loft_y("Seat", [(-0.3, 0, 0.775, 0.08, 0.04), (-0.22, 0, 0.765, 0.165, 0.065), (0.05, 0, 0.76, 0.18, 0.07),
                      (0.4, 0, 0.765, 0.18, 0.07), (0.8, 0, 0.765, 0.17, 0.07), (1.0, 0, 0.75, 0.13, 0.05),
                      (1.06, 0, 0.73, 0.06, 0.03)], segs=18, exp=2.8)
    K.box("Trim", 0, -0.25, 0.83, 0.5, 0.05, 0.08, rx=0.5)      # windscreen lip
    K.box("Glass", 0, -0.42, 0.9, 0.42, 0.02, 0.14, rx=0.7)
    for s in (1, -1):
        K.box("Trim", s * 0.3, -1.0, 0.72, 0.18, 0.3, 0.02, rz=s * 0.1)   # hood vents
        K.tube("Chrome", (s * 0.42, 1.25, deck_z(rows, 1.25, 0.42)), (s * 0.42, 1.25, 0.7), 0.012, segs=6)
        K.box("Taillight", s * 0.25, 1.551, 0.42, 0.06, 0.03, 0.03)
        K.box("Trim", s * 0.32, -0.62, 0.86, 0.08, 0.04, 0.05)            # mirror pods
    K.tube("Chrome", (0.42, 1.25, 0.7), (-0.42, 1.25, 0.7), 0.012, segs=6)  # rear grab handle
    K.cyl("Trim", 0, 1.6, 0.06, 0.09, 0.24, axis="y", segs=14)            # jet nozzle
    K.box("Trim", 0, 1.3, -0.17, 0.32, 0.5, 0.02)                          # ride plate
    # steering: a separate "fork" object (as the bike) turning about a raked axis
    rake = math.radians(25)
    piv = V((0, -0.5, 0.82))
    axis = V((0, math.sin(rake), math.cos(rake)))
    W = Matrix.Translation(piv) @ Matrix.Rotation(-rake, 4, "X")
    main_bm = K.bm
    K.bm = bmesh.new()
    K.uvl = K.bm.loops.layers.uv.verify()
    grip = JET_HIPS + V((0.36, -0.52, 0.20))
    bar_c = V((0, grip.y - 0.02, grip.z - 0.03))
    K.tube("Trim", piv, piv + axis * 0.3, 0.05, segs=10)
    K.tube("Chrome", piv + axis * 0.25, bar_c, 0.02, segs=8)
    for s in (1, -1):
        g = V((s * grip.x, grip.y, grip.z))
        K.tube("Chrome", bar_c, g - V((s * 0.06, 0, 0)), 0.014, segs=8)
        K.tube("Trim", g - V((s * 0.065, 0, 0)), g + V((s * 0.065, 0, 0)), 0.02, segs=10)
        K.box("Chrome", s * (grip.x - 0.03), grip.y - 0.06, grip.z, 0.1, 0.012, 0.008, rz=s * 0.25)
    K.box("Trim", 0, bar_c.y, bar_c.z + 0.02, 0.22, 0.08, 0.07)
    K.box("Headlight", 0, bar_c.y - 0.04, bar_c.z + 0.03, 0.1, 0.01, 0.04)  # display
    fbm = K.bm
    K.bm = main_bm
    bmesh.ops.recalc_face_normals(fbm, faces=fbm.faces)
    fbm.transform(W.inverted())
    me = bpy.data.meshes.new("fork")
    fbm.to_mesh(me)
    fbm.free()
    for m in K.mats:
        me.materials.append(m)
    fork = bpy.data.objects.new("fork", me)
    bpy.context.scene.collection.objects.link(fork)
    fork.matrix_basis = W
    hips = tuple(JET_HIPS)
    peg = JET_HIPS + V((0.19, 0.06, -0.46))
    body, _ = finish(K, "jetski", seat=hips, door_pos=(0.85, 0.1, 0), cam=(0, 0, 0.9), fork=fork,
                     empties=[("Seat", hips), ("peg_L", tuple(peg)), ("peg_R", (-peg.x, peg.y, peg.z)),
                              ("grip_L", tuple(grip), fork), ("grip_R", (-grip.x, grip.y, grip.z), fork)])
    preview("jetski", 3.4, 1.3, 1.2, seat=hips, probe="bike", water=True, z0=-0.2, close=((0, -0.3, 0.8), (1.6, -1.8, 1.1)))


MODELS = {"ambulance": ambulance, "firetruck": firetruck, "bus": bus, "truck": truck, "trailer": trailer,
          "towtruck": towtruck, "boat": boat, "jetski": jetski}

if __name__ == "__main__":
    only = [a for a in ARGS[1:] if a in MODELS]
    for n in only or MODELS:
        MODELS[n]()
