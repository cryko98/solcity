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
  sittalk: 'sittalk', sitlisten: 'sitlisten', pistol_hold: 'pistol_hold', pistol_aim: 'pistol_aim', pistol_walk: 'pistol_hold', pistol_run: 'pistol_hold',
};
// played in step with the old rig's own clip (one-shots), or held at their end (guard: the way in)
const SYNCED = ['punchl', 'punchr', 'hit', 'knockdown', 'getup', 'roll'];
const BLEND = 0.07; // (s) how quickly a change of clip blends in
const FOLLOW = '(follow)';
const FIST = [1.35, 1.5, 1.0], THUMB = [0.2, 0.6, 0.5]; // knuckle, middle, tip
const Z = new THREE.Vector3(0, 0, 1);
const LOWER =/^Bip01_(Pelvis|[LR]_(Thigh|Calf|Foot|Toe0))$/;

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
    this.cHand = this.pairs.find((p) => p.old === 'handR').c;

    // the Rocketbox body sits in the hero's model, so the lean, the car seat, the bike all carry it
    player.model.add(this.model);
    player.model.traverse((o) => {
      if (o.isSkinnedMesh && !this.isOurs(o)) o.visible = false;
    });
    this.oldBones = {};
    for (const pr of this.pairs) this.oldBones[pr.old] = bone(player.model, pr.old);
    this.rbHandR = bone(this.model, 'Bip01_R_Hand');

    // every clip twice: its legs and its upper body, blended apart
    this.mixer = new THREE.AnimationMixer(this.model);
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
    this.phase = 0;
    this.shares = {};
    this.gunBase = new Map();
    // the fingers curled into a fist: [bone, angle about its own z]
    this.fingers = [];
    for (const S of ['L', 'R']) {
      for (let f = 1; f <= 4; f++) ['', '1', '2'].forEach((j, i) => this.fingers.push([bone(this.model, `Bip01_${S}_Finger${f}${j}`), FIST[i]]));
      ['', '1', '2'].forEach((j, i) => this.fingers.push([bone(this.model, `Bip01_${S}_Finger0${j}`), THUMB[i]]));
    }
    this.fingers = this.fingers.filter(([b]) => b);
  }

  isOurs(o) {
    for (let p = o; p; p = p.parent) if (p === this.model) return true;
    return false;
  }

  update(dt) {
    const P = this.player;
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
    if (wsum > 0.01 && s > 0.05) this.phase = (this.phase + (dt * s) / (stride / wsum)) % 1;
    for (const n of Object.keys(GAITS)) this.acts[n].up.time = this.acts[n].lo.time = this.phase * this.acts[n].dur;
    for (const n of SYNCED) {
      const a = this.acts[n], o = P.actions[n];
      if (!a || !o) continue;
      a.up.time = a.lo.time = Math.min(1, o.time / o.getClip().duration) * a.dur * 0.999;
    }
    this.mixer.update(dt);
    // fists in the fight (the motion capture has no fingers)
    const fu = this.shares.up, fist = Math.min(1, fu.guard + fu.punchl + fu.punchr || 0);
    if (fist > 0.01) for (const [b, a] of this.fingers) b.quaternion.multiply(_q.setFromAxisAngle(Z, a * fist));

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
          if (pr.old === 'hips') {
            _p.setFromMatrixPosition(ob.matrixWorld);
            root.worldToLocal(_p);
            _p.sub(this.hip0.old).multiplyScalar(this.hip0.k).add(this.hip0.rb);
            root.localToWorld(_p);
            pr.rb.parent.worldToLocal(_p);
            pr.rb.position.lerp(_p, f);
          }
        }
        rq.set(pr.rb, pq.clone().multiply(pr.rb.quaternion));
      }
    }
    // -------------------------------------------------- the gun, in the new hand
    // it sits in the new hand as it sat in the old one: the old hand's frame is the new one's
    // turned back by the calibration
    this.model.updateMatrixWorld(true);
    const oh = this.oldBones.handR;
    for (const w of Object.values(P.weaponNodes || {})) {
      if (!w.visible || w.parent !== oh) continue;
      if (!this.gunBase.has(w)) this.gunBase.set(w, w.matrix.clone());
      // the new hand's frame in the old hand's place: rbHand * C^-1 (rotation), at the new hand
      this.rbHandR.matrixWorld.decompose(_p, _q, _s);
      _q.multiply(_q2.copy(this.cHand).invert());
      oh.matrixWorld.decompose(_p2, _q2, _s);
      _m.compose(_p, _q, _s); // (the old hand's scale: the gun's offset is in its units)
      _m.multiply(this.gunBase.get(w));
      _m2.copy(oh.matrixWorld).invert().multiply(_m);
      _m2.decompose(w.position, w.quaternion, w.scale);
    }
  }
}
