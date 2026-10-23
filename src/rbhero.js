// The hero as a Microsoft Rocketbox avatar (MIT, github.com/microsoft/Microsoft-Rocketbox).
//
// The hero's own rig, now invisible, still runs his state machine: which clip plays how much
// (player.weights). The Rocketbox body mirrors those weights with its own clips: motion capture
// from the Rocketbox library (idle, walk, run, sprint, talking, listening, dancing) and Quaternius's
// CC0 animation libraries retargeted onto it (boxing, hits, the knockdown and getting up, the jump,
// the roll, swimming, the pistol). An action it has no clip for (the car, the bike, the gym, the
// rifles...) it follows from the old rig bone by bone (both rigs calibrated in the same standing
// pose). Legs and upper body blend apart, so with a gun out the legs still walk on motion capture.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// the gait clips' own speed (m/s): the feet stay planted when played in step with the ground
const GAITS = { walk: 1.42, run: 3.7, sprint: 5.6 };
// the hero's actions that have a clip of their own here (the rest follow the old rig)
const OWN = {
  idle: 'idle', guard: 'guard', punchl: 'punchl', punchr: 'punchr', hit: 'hit', knockdown: 'knockdown', getup: 'getup',
  jump: 'jump', roll: 'roll', swim: 'swim', tread: 'tread', standtalk: 'standtalk', standlisten: 'standlisten', dance: 'dance',
  sittalk: 'sittalk', sitlisten: 'sitlisten',
};
// played in step with the old rig's own clip (one-shots), or held at their end (guard: the way in)
const SYNCED = ['punchl', 'punchr', 'hit', 'knockdown', 'getup', 'roll'];
const BLEND = 0.07; // (s) how quickly a change of clip blends in
const FOLLOW = '(follow)';
const SEAT_DROP = 0.05; // (m)
const GETUP_SECS = 2.4;
// where the left palm's middle goes on a pistol held in two hands (the gun's own space: +z the
// muzzle, +y the top, +x its left): against the left of the grip, over the right hand's fingers
const PISTOL_PALM = new THREE.Vector3(0.04, -0.055, 0.0);
const _cx = new THREE.Vector3(), _cy = new THREE.Vector3(), _cz = new THREE.Vector3(), _cv = new THREE.Vector3(), _cw = new THREE.Vector3(), _cu = new THREE.Vector3();
const _cp = new THREE.Vector3(), _cp2 = new THREE.Vector3(), _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cq3 = new THREE.Quaternion();
// the hand poses: how far each joint curls (radians about its own z), per finger (thumb, index,
// middle, ring, pinky) knuckle to tip
const ROCKETBOX = ['idle', 'walk', 'run', 'sprint', 'standtalk', 'standlisten', 'dance'];
const curl = (thumb, index, rest) => [thumb, index, rest, rest.map((x, i) => x + [0.05, 0.05, 0][i]), rest.map((x, i) => x + [0.1, 0.08, 0.05][i])];
const HANDS = {
  relaxed: curl([0.15, 0.2, 0.15], [0.32, 0.42, 0.28], [0.4, 0.5, 0.32]),
  flat: curl([0, 0.05, 0.05], [0.06, 0.08, 0.05], [0.06, 0.08, 0.05]),
  fist: curl([0.3, 0.7, 0.6], [1.35, 1.5, 1.0], [1.4, 1.55, 1.0]),
  grip: curl([0.3, 0.6, 0.45], [1.0, 1.25, 0.85], [1.1, 1.3, 0.9]),
  trigger: curl([0.3, 0.6, 0.45], [0.45, 0.55, 0.35], [1.15, 1.35, 0.9]),
};
const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
// (the thighs hang from the Biped's first spine bone, so that one goes with the legs)
const LOWER = /^Bip01_(Pelvis|Spine|[LR]_(Thigh|Calf|Foot|Toe0))$/;

// old rig bone -> Rocketbox bones that follow it
const MAP = {
  hips: ['Bip01_Pelvis'],
  spine: ['Bip01_Spine'],
  chest: ['Bip01_Spine1', 'Bip01_Spine2', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle'],
  neck: ['Bip01_Neck'],
  head: ['Bip01_Head'],
};
for (const S of ['L', 'R']) {
  Object.assign(MAP, {
    [`upper_arm${S}`]: [`Bip01_${S}_UpperArm`],
    [`forearm${S}`]: [`Bip01_${S}_Forearm`],
    [`hand${S}`]: [`Bip01_${S}_Hand`],
    [`thumb1${S}`]: [`Bip01_${S}_Finger0`],
    [`thumb2${S}`]: [`Bip01_${S}_Finger01`, `Bip01_${S}_Finger02`],
    [`thigh${S}`]: [`Bip01_${S}_Thigh`],
    [`shin${S}`]: [`Bip01_${S}_Calf`],
    [`foot${S}`]: [`Bip01_${S}_Foot`, `Bip01_${S}_Toe0`],
  });
  ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
    for (let j = 1; j <= 3; j++) MAP[`${f}${j}${S}`] = [`Bip01_${S}_Finger${i + 1}${j > 1 ? j - 1 : ''}`];
  });
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

// orientation / position of each bone relative to the model's root
function rootSpace(root, bones) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), out = {};
  for (const b of bones) {
    _m.multiplyMatrices(inv, b.matrixWorld);
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    _m.decompose(p, q, _s);
    out[b.name] = { q, p };
  }
  return out;
}
// a palm's frame in the world from its wrist and its index and little finger knuckles: x across
// the knuckles, y along the fingers, z out of the back of the hand
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _px = new THREE.Vector3(), _py = new THREE.Vector3(), _pz = new THREE.Vector3();
function palmFrame([hand, index, pinky], out) {
  hand.getWorldPosition(_pa);
  index.getWorldPosition(_pb);
  pinky.getWorldPosition(_pc);
  _px.subVectors(_pb, _pc).normalize();
  _py.addVectors(_pb, _pc).multiplyScalar(0.5).sub(_pa).normalize();
  _pz.crossVectors(_px, _py).normalize();
  _py.crossVectors(_pz, _px);
  return out.makeBasis(_px, _py, _pz).setPosition(_pa.add(_pb).add(_pc).divideScalar(3));
}
// a bone turned to a world orientation (its parent's world matrix up to date)
function setWorldQuaternion(b, q) {
  b.quaternion.copy(b.parent.getWorldQuaternion(_iq).invert().multiply(q));
  b.updateMatrixWorld(true);
}
const _iq = new THREE.Quaternion(), _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3();
const _iac = new THREE.Vector3(), _iab = new THREE.Vector3(), _iat = new THREE.Vector3(), _ix0 = new THREE.Vector3(), _ix1 = new THREE.Vector3();
const _ir = new THREE.Quaternion(), _ir2 = new THREE.Quaternion();
const acosC = (x) => Math.acos(THREE.MathUtils.clamp(x, -1, 1));
// two-bone IK (D. Holden's analytic form): a (shoulder) -> b (elbow) -> c (wrist) reaching for t,
// the elbow kept in the plane it bends in now; c keeps its world orientation
function reach(a, b, c, t) {
  a.getWorldPosition(_ia);
  b.getWorldPosition(_ib);
  c.getWorldPosition(_ic);
  const cq = c.getWorldQuaternion(new THREE.Quaternion());
  const lab = _ib.distanceTo(_ia), lcb = _ib.distanceTo(_ic);
  const lat = THREE.MathUtils.clamp(t.distanceTo(_ia), 0.01, lab + lcb - 0.001);
  _iac.subVectors(_ic, _ia).normalize();
  _iab.subVectors(_ib, _ia).normalize();
  _iat.subVectors(t, _ia).normalize();
  const ac_ab0 = acosC(_iac.dot(_iab));
  const ba_bc0 = acosC(_ia.clone().sub(_ib).normalize().dot(_ic.clone().sub(_ib).normalize()));
  const ac_at0 = acosC(_iac.dot(_iat));
  const ac_ab1 = acosC((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
  const ba_bc1 = acosC((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
  _ix0.crossVectors(_iac, _iab).normalize();
  _ix1.crossVectors(_iac, _iat);
  // the elbow, then the whole arm onto the target; axes taken into each bone's own frame
  const aw = a.getWorldQuaternion(new THREE.Quaternion()), bw = b.getWorldQuaternion(new THREE.Quaternion());
  const awi = aw.invert(), bwi = bw.invert();
  _ir.identity();
  if (_ix0.lengthSq() > 1e-8) {
    _ir.setFromAxisAngle(_ix0.clone().applyQuaternion(awi), ac_ab1 - ac_ab0);
    b.quaternion.multiply(_ir2.setFromAxisAngle(_ix0.clone().applyQuaternion(bwi), ba_bc1 - ba_bc0));
  }
  if (_ix1.lengthSq() > 1e-8) _ir.multiply(_ir2.setFromAxisAngle(_ix1.normalize().applyQuaternion(awi), ac_at0));
  a.quaternion.multiply(_ir);
  a.updateMatrixWorld(true);
  setWorldQuaternion(c, cq);
}
const boneOf = (track) => track.name.slice(0, track.name.lastIndexOf('.'));
const part = (clip, name, keep) => {
  const c = clip.clone();
  c.name = name;
  c.tracks = c.tracks.filter((t) => keep(boneOf(t)));
  return c;
};

export class RbHero {
  constructor(gltf, player) {
    this.player = player;
    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    const bone = (root, n) => root.getObjectByName(n);
    // the pairs that follow the old rig, parents before children
    this.pairs = [];
    const rbBones = [];
    this.model.traverse((o) => o.isBone && rbBones.push(o));
    const followed = new Map();
    for (const [o, list] of Object.entries(MAP)) for (const n of list) followed.set(n, o);
    for (const b of rbBones) if (followed.has(b.name) && bone(player.model, followed.get(b.name))) this.pairs.push({ rb: b, old: followed.get(b.name), lower: LOWER.test(b.name) });

    // calibration: both rigs in their standing pose (frame 0 of each one's idle)
    const oldIdle = player.actions.idle.getClip(), rbIdle = gltf.animations.find((a) => a.name === 'idle');
    const oc = SkeletonUtils.clone(player.model), rc = SkeletonUtils.clone(this.model);
    for (const [root, clip] of [[oc, oldIdle], [rc, rbIdle]]) {
      const mx = new THREE.AnimationMixer(root);
      mx.clipAction(clip).play();
      mx.update(0);
    }
    const oldB = [], rcB = [];
    oc.traverse((o) => o.isBone && oldB.push(o));
    rc.traverse((o) => o.isBone && rcB.push(o));
    const o0 = rootSpace(oc, oldB), r0 = rootSpace(rc, rcB);
    for (const pr of this.pairs) pr.c = o0[pr.old].q.clone().invert().multiply(r0[pr.rb.name].q);
    this.hip0 = { old: o0.hips.p.clone(), rb: r0.Bip01_Pelvis.p.clone(), k: r0.Bip01_Pelvis.p.y / o0.hips.p.y };

    // the Rocketbox body sits in the hero's model, so the lean, the car seat, the bike all carry it
    player.model.add(this.model);
    // the old body, hair, outfits and shoes go (kept hidden every frame: the barber and the clothes
    // shops still switch their parts on)
    this.retired = [];
    player.model.traverse((o) => {
      if (o.isSkinnedMesh && !this.isOurs(o)) this.retired.push(o);
    });
    this.oldBones = {};
    for (const pr of this.pairs) this.oldBones[pr.old] = bone(player.model, pr.old);
    this.rbHandR = bone(this.model, 'Bip01_R_Hand');
    this.pelvis = bone(this.model, 'Bip01_Pelvis');
    // the right palm of each rig (wrist, index and little finger knuckles): the gun goes palm to palm
    this.palms = {
      old: ['handR', 'index1R', 'pinky1R'].map((n) => bone(player.model, n)),
      rb: ['Bip01_R_Hand', 'Bip01_R_Finger1', 'Bip01_R_Finger4'].map((n) => bone(this.model, n)),
      left: ['Bip01_L_Hand', 'Bip01_L_Finger1', 'Bip01_L_Finger4'].map((n) => bone(this.model, n)),
    };
    this.arms = ['L', 'R'].map((S) => ({
      side: S,
      upper: bone(this.model, `Bip01_${S}_UpperArm`),
      fore: bone(this.model, `Bip01_${S}_Forearm`),
      hand: bone(this.model, `Bip01_${S}_Hand`),
      oldHand: this.oldBones[`hand${S}`],
      c: this.pairs.find((p) => p.old === `hand${S}`).c,
    }));

    // every clip twice: its legs and its upper body, blended apart
    this.mixer = new THREE.AnimationMixer(this.model);
    this.bones = rbBones;
    this.clean = rbBones.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
    this.acts = {}; // name -> { up, lo, dur }
    for (const c of gltf.animations) {
      // the gait clips walk on the spot, but some keep a drift of the pelvis over the cycle (it
      // would run ahead and snap back each loop): take that drift out, keep the bob and sway
      const pt = GAITS[c.name] && c.tracks.find((t) => t.name === 'Bip01_Pelvis.position');
      if (pt) {
        const v = pt.values, n = pt.times.length, dur = pt.times[n - 1] - pt.times[0] || 1;
        const d = [0, 1, 2].map((k) => v[(n - 1) * 3 + k] - v[k]);
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) v[i * 3 + k] -= (d[k] * (pt.times[i] - pt.times[0])) / dur;
      }
      const mk = (half) => {
        const a = this.mixer.clipAction(part(c, `${c.name}|${half}`, half === 'lo' ? (b) => LOWER.test(b) : (b) => !LOWER.test(b)));
        a.play();
        a.setEffectiveWeight(0);
        if (SYNCED.includes(c.name) || GAITS[c.name]) a.timeScale = 0;
        // the stance: the trunk and arms bob to and fro, the feet hold still
        if (c.name === 'guard' && half === 'up') a.setLoop(THREE.LoopPingPong, Infinity);
        if (c.name === 'guard' && half === 'lo') a.timeScale = 0;
        return a;
      };
      this.acts[c.name] = { up: mk('up'), lo: mk('lo'), dur: c.duration };
    }
    // getting up from the ground is motion capture of a man doing it: give it the time it takes
    const gu = player.actions.getup;
    if (gu && this.acts.getup) gu.timeScale = gu.getClip().duration / Math.max(gu.getClip().duration, GETUP_SECS);
    this.phase = 0;
    this.shares = {};
    this.gunBase = new Map();
    this._X = new THREE.Matrix4();
    // the finger joints: { b, rest, side, f (0 thumb .. 4 pinky), j (0 knuckle .. 2 tip) }
    this.fingers = [];
    for (const [side, S] of [[0, 'L'], [1, 'R']]) {
      for (let f = 0; f <= 4; f++) {
        ['', '1', '2'].forEach((jn, j) => {
          const b = bone(this.model, f ? `Bip01_${S}_Finger${f}${jn}` : `Bip01_${S}_Finger0${jn}`);
          if (b) this.fingers.push({ b, rest: b.quaternion.clone(), side, f, j });
        });
      }
    }
    this.handPose = {}; // pose name -> eased weight
    this.twist = [['Bip01_Pelvis', 1], ['Bip01_Spine1', -0.55], ['Bip01_Spine2', -0.45]].map(([n, f]) => [bone(this.model, n), f]);
  }

  // where the pelvis goes (in its parent's space) to sit where the old rig's hips are, the move
  // from the standing pose scaled to this body (the model's world matrices up to date)
  hipsAt(out) {
    const root = this.player.model;
    out.setFromMatrixPosition(this.oldBones.hips.matrixWorld);
    root.worldToLocal(out);
    out.sub(this.hip0.old).multiplyScalar(this.hip0.k).add(this.hip0.rb);
    root.localToWorld(out);
    return this.pelvis.parent.worldToLocal(out);
  }

  // the hands. Only the Rocketbox clips carry real finger motion; the others have none (CMU) or
  // fingers that don't survive the move to this hand (Quaternius, the old rig), so the hand takes a
  // pose for what it's doing: a fist in a fight, the grip and the trigger finger on a gun, a grip on
  // the bars and the wheel, a flat hand swimming, else loosely curled
  posture(dt) {
    const P = this.player, u = this.shares.up, sh = (...ns) => Math.min(1, ns.reduce((a, n) => a + (u[n] || 0), 0));
    const armed = P.weapon && !P.vehicle && !P.posed && !P.swimming && Object.values(P.weaponNodes || {}).some((w) => w.visible);
    const want = {
      grip: this.grip > 0.5 ? 1 : 0,
      gun: armed ? 1 : 0,
      fist: sh('guard', 'punchl', 'punchr'),
      flat: sh('swim', 'tread'),
      // (what the Rocketbox clips don't cover)
      relaxed: 1 - sh(...ROCKETBOX),
    };
    const ease = 1 - Math.exp(-dt / 0.1);
    let left = 1;
    const mix = []; // [pose, weight] in order of precedence, weights summing to at most 1
    for (const n of ['grip', 'gun', 'fist', 'flat', 'relaxed']) {
      const w = (this.handPose[n] = (this.handPose[n] || 0) + (want[n] - (this.handPose[n] || 0)) * ease);
      const take = Math.min(Math.max(0, w), left);
      if (take > 1e-3) mix.push([n, take]);
      left -= take;
    }
    if (!mix.length) return;
    const total = 1 - left;
    for (const k of this.fingers) {
      let a = 0;
      // (on a gun: the right hand's finger on the trigger, the left holding)
      for (const [n, w] of mix) a += HANDS[n === 'gun' ? (k.side === 1 ? 'trigger' : 'grip') : n][k.f][k.j] * w;
      _q.copy(k.rest).multiply(_q2.setFromAxisAngle(Z, a / total));
      k.b.quaternion.slerp(_q, total);
    }
  }

  // the left hand on a pistol held in two hands: the palm against the left of the grip, over the
  // right hand's fingers, the fingers wrapped round the front, the thumb along the frame
  cup(arm, gun, k) {
    const e = gun.matrixWorld.elements;
    const gx = _cx.set(e[0], e[1], e[2]).normalize(), gy = _cy.set(e[4], e[5], e[6]).normalize(), gz = _cz.set(e[8], e[9], e[10]).normalize();
    // the palm we want: fingers (y) down and round to the right, index knuckle (x) up and forward
    const y = _cv.copy(gx).multiplyScalar(-0.55).addScaledVector(gy, -0.75).addScaledVector(gz, 0.2).normalize();
    const x = _cw.copy(gy).multiplyScalar(0.6).addScaledVector(gz, 0.8);
    x.addScaledVector(y, -x.dot(y)).normalize();
    const want = _cq.setFromRotationMatrix(_cm.makeBasis(x, y, _cu.crossVectors(x, y)));
    // the palm as it is, in the hand: keep that, turn the hand so the palm comes out as wanted
    const palm = palmFrame(this.palms.left, _cm);
    const palmQ = _cq2.setFromRotationMatrix(palm);
    const handQ = arm.hand.getWorldQuaternion(_cq3);
    const inHand = handQ.clone().invert().multiply(palmQ);
    const wantHand = want.clone().multiply(inHand.invert());
    // and the wrist placed so the palm's middle lands on its spot
    const mid = _cp.setFromMatrixPosition(palm);
    const off = mid.sub(arm.hand.getWorldPosition(_cp2)).applyQuaternion(palmQ.clone().invert());
    const wrist = _cp2.copy(PISTOL_PALM).applyMatrix4(gun.matrixWorld).sub(off.applyQuaternion(want));
    reach(arm.upper, arm.fore, arm.hand, _p2.setFromMatrixPosition(arm.hand.matrixWorld).lerp(wrist, k));
    setWorldQuaternion(arm.hand, arm.hand.getWorldQuaternion(_cq3).slerp(wantHand, k));
  }

  isOurs(o) {
    for (let p = o; p; p = p.parent) if (p === this.model) return true;
    return false;
  }

  update(dt) {
    const P = this.player;
    for (const o of this.retired) o.visible = false;
    // -------------------------------------------------- the weights, from the hero's state machine
    // each half of the body: { clip: weight }, the gait's share, and what follows the old rig
    const half = () => ({ w: {}, gait: 0, follow: 0 });
    const up = half(), lo = half();
    for (const [n, w] of Object.entries(P.weights)) {
      if (w < 0.002) continue;
      const lower = n.endsWith('_lo'), upper = /^(pistol|smg|shotgun)_/.test(n);
      const base = lower ? n.slice(0, -3) : n;
      for (const [h, used] of [[up, !lower], [lo, !upper]]) {
        if (!used) continue;
        // the punches are thrown from the arms and the trunk; the feet stay planted in the stance
        // (the boxer's own footwork would slide about, the game doesn't move him with it)
        const own = h === lo && (base === 'punchl' || base === 'punchr') ? 'guard' : OWN[base];
        if (base === 'walk' || base === 'run') h.gait += w;
        else if (own && this.acts[own]) h.w[own] = (h.w[own] || 0) + w;
        else h.follow += w;
      }
    }
    // the gait: walk, run, sprint by speed
    const s = P.speed, g = { walk: 0, run: 0, sprint: 0 };
    if (s < GAITS.walk + 0.4) g.walk = 1;
    else if (s < GAITS.run) {
      const k = (s - GAITS.walk - 0.4) / (GAITS.run - GAITS.walk - 0.4);
      [g.walk, g.run] = [1 - k, k];
    } else {
      const k = Math.min(1, (s - GAITS.run) / (GAITS.sprint - GAITS.run));
      [g.run, g.sprint] = [1 - k, k];
    }
    // the shares of each half (clips and following, summing to 1), eased: the hero's state machine
    // switches some at once (a punch, a hit), here every change blends over a few frames
    const total = {}, ease = 1 - Math.exp(-dt / BLEND);
    for (const [h, key] of [[up, 'up'], [lo, 'lo']]) {
      for (const [n, k] of Object.entries(g)) if (h.gait) h.w[n] = (h.w[n] || 0) + h.gait * k;
      const sum = Object.values(h.w).reduce((a, b) => a + b, 0) + h.follow;
      const sm = (this.shares[key] ||= { idle: 1 });
      const want = (n) => (sum > 1e-4 ? (n === FOLLOW ? h.follow : h.w[n] || 0) / sum : n === 'idle' ? 1 : 0);
      for (const n of [...Object.keys(this.acts), FOLLOW]) sm[n] = (sm[n] || 0) + (want(n) - (sm[n] || 0)) * ease;
      // the clips share what doesn't follow the old rig; with none, the idle holds the pose
      const own = 1 - sm[FOLLOW];
      for (const [n, a] of Object.entries(this.acts)) a[key].setEffectiveWeight(own > 1e-4 ? sm[n] / own : n === 'idle' ? 1 : 0);
      total[key] = sm[FOLLOW];
    }
    // -------------------------------------------------- the clips' times
    let stride = 0, wsum = 0;
    for (const n of Object.keys(GAITS)) {
      const w = lo.w[n] || 0;
      stride += w * GAITS[n] * this.acts[n].dur;
      wsum += w;
    }
    // aiming and backing away: the steps run backwards (as the hero's own rig does)
    let dir = 1;
    if (P.aiming && P.grounded && !P.vehicle && !P.overlay && s > 0.3) {
      const rel = Math.atan2(P.vel.x, P.vel.z) - P.yaw;
      if (Math.cos(rel) < Math.cos(Math.PI * 0.6)) dir = -1;
    }
    if (wsum > 0.01 && s > 0.05) this.phase = (this.phase + (dir * dt * s) / (stride / wsum) + 1) % 1;
    for (const n of Object.keys(GAITS)) this.acts[n].up.time = this.acts[n].lo.time = this.phase * this.acts[n].dur;
    for (const n of SYNCED) {
      const a = this.acts[n], o = P.actions[n];
      if (!a || !o) continue;
      a.up.time = a.lo.time = Math.min(1, o.time / o.getClip().duration) * a.dur * 0.999;
    }
    // the mixer only writes a bone whose clip value changed: put back what it wrote last time, so the
    // touches below (fists, twist, following, IK) never pile up on a bone held still
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].quaternion.copy(this.clean[i].q);
      this.bones[i].position.copy(this.clean[i].p);
    }
    this.mixer.update(dt);
    for (let i = 0; i < this.bones.length; i++) {
      this.clean[i].q.copy(this.bones[i].quaternion);
      this.clean[i].p.copy(this.bones[i].position);
    }
    // aiming on the move: the hips turn toward where he walks, the chest back onto the aim
    // (the hero's rig works out how far: legTwist)
    if (Math.abs(P.legTwist || 0) > 1e-3) {
      for (const [b, f] of this.twist) {
        b.parent.getWorldQuaternion(_q2);
        _q.setFromAxisAngle(Y, P.legTwist * f);
        b.quaternion.premultiply(_q2.clone().invert().multiply(_q).multiply(_q2));
        b.updateMatrixWorld(true);
      }
    }
    // in the water the library's swim clips keep the hips at standing height: the body sits where
    // the hero's own rig puts his hips (just under the surface)
    const wade = Math.min(1, (this.shares.lo.swim || 0) + (this.shares.lo.tread || 0));
    if (wade > 0.01) {
      P.model.updateMatrixWorld(true);
      this.pelvis.position.lerp(this.hipsAt(_p), wade);
    }

    // -------------------------------------------------- following the old rig where it has to
    const root = P.model;
    root.updateMatrixWorld(true);
    const rootInvQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rq = new Map();
    const parentQ = (b) => rq.get(b.parent) || rootInvQ.clone().multiply(b.parent.getWorldQuaternion(new THREE.Quaternion()));
    if (total.up > 0.001 || total.lo > 0.001) {
      for (const pr of this.pairs) {
        const f = pr.lower ? total.lo : total.up;
        const pq = parentQ(pr.rb);
        if (f > 0.001) {
          const ob = this.oldBones[pr.old];
          _q.copy(rootInvQ).multiply(ob.getWorldQuaternion(_q2)).multiply(pr.c);
          _q2.copy(pq).invert().multiply(_q);
          pr.rb.quaternion.slerp(_q2, f);
          if (pr.old === 'hips') pr.rb.position.lerp(this.hipsAt(_p), f);
        }
        rq.set(pr.rb, pq.clone().multiply(pr.rb.quaternion));
      }
    }
    // -------------------------------------------------- the hands on what they hold
    // the old rig's hands were fitted to every seat and every gun; the new arms are longer and hang
    // from other shoulders. The right palm carries the gun: palm to palm (wrist and knuckles of
    // each hand), the gun sits in the new one as it sat in the old. Hands that hold on (the bars,
    // the wheel, the front grip of a two-handed gun) are reached to the old hand's place, moved the
    // same way (two-bone IK)
    this.model.updateMatrixWorld(true);
    const X = palmFrame(this.palms.rb, this._X).multiply(palmFrame(this.palms.old, _m2).invert());
    const armed = P.weapon && !P.vehicle && !P.posed && !P.swimming;
    const gun = armed && Object.values(P.weaponNodes || {}).find((w) => w.visible);
    // the gun first: it goes where the right palm is
    const oh = this.oldBones.handR;
    for (const w of Object.values(P.weaponNodes || {})) {
      if (!w.visible || w.parent !== oh) continue;
      if (!this.gunBase.has(w)) this.gunBase.set(w, w.matrix.clone());
      // where it sat in the old hand, moved palm to palm, back into the old hand's space
      _m2.multiplyMatrices(oh.matrixWorld, this.gunBase.get(w)).premultiply(X);
      _m.copy(oh.matrixWorld).invert().multiply(_m2);
      _m.decompose(w.position, w.quaternion, w.scale);
      w.updateMatrixWorld(true);
    }
    const seated = P.vehicle ? Math.min(1, (P.weights.drive || 0) + (P.weights.ride || 0)) : 0;
    // (a long gun has the left hand on its front grip; a pistol has it cupped under the right one
    // while aiming)
    const pistol = gun && /Pistol/i.test(gun.name);
    const twoHanded = gun && (!pistol || P.aiming) ? 1 : 0;
    const k8 = Math.min(1, dt * 8);
    this.grip = (this.grip || 0) + (seated - (this.grip || 0)) * k8;
    this.support = (this.support || 0) + (twoHanded - (this.support || 0)) * k8;
    // and sat a little deeper: this head is a few cm higher than the old one, low roofs are close
    this.model.position.y = (-SEAT_DROP * this.grip) / this.model.parent.getWorldScale(_s).y;
    for (const arm of this.arms) {
      const k = Math.max(this.grip, arm.side === 'L' ? this.support : 0);
      if (k < 0.01) continue;
      this.model.updateMatrixWorld(true);
      // (in a vehicle the old hand's own place; on a gun, carried with the gun)
      const onGun = this.support > this.grip;
      if (onGun && pistol && arm.side === 'L') {
        this.cup(arm, gun, k);
        continue;
      }
      {
        _p.setFromMatrixPosition(arm.oldHand.matrixWorld);
        if (onGun) _p.applyMatrix4(X);
      }
      _p2.setFromMatrixPosition(arm.hand.matrixWorld);
      reach(arm.upper, arm.fore, arm.hand, _p2.lerp(_p, k));
      // and the grip turned the way the old hand held it
      arm.oldHand.getWorldQuaternion(_q).multiply(arm.c);
      if (onGun) _q.premultiply(_q2.setFromRotationMatrix(X));
      arm.hand.getWorldQuaternion(_q2).slerp(_q, k);
      setWorldQuaternion(arm.hand, _q2);
    }
    this.posture(dt);
  }
}
