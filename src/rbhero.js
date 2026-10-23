// The hero as a Microsoft Rocketbox avatar (MIT, github.com/microsoft/Microsoft-Rocketbox).
//
// Every move the hero has (fists, guns, cars, the bike, swimming, the gym...) is still played on his
// own rig, now invisible; the Rocketbox body follows it bone by bone each frame (runtime retarget:
// each of its bones takes the orientation its counterpart has, both rigs calibrated in the same
// standing pose). Where the library has real motion capture, idle / walk / run / sprint, that
// plays instead and the two are blended: on foot, unarmed, just moving about, it's the mocap.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// the clips' own speed (m/s): the feet stay planted when played in step with the ground
const GAITS = { walk: 1.42, run: 3.7, sprint: 5.6 };

// old rig bone -> Rocketbox bones that follow it
const MAP = {
  hips: ['Bip01_Pelvis'],
  spine: ['Bip01_Spine'],
  chest: ['Bip01_Spine1', 'Bip01_Spine2', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle'],
  neck: ['Bip01_Neck'],
  head: ['Bip01_Head'],
};
for (const [s, S] of [['L', 'L'], ['R', 'R']]) {
  Object.assign(MAP, {
    [`upper_arm${s}`]: [`Bip01_${S}_UpperArm`],
    [`forearm${s}`]: [`Bip01_${S}_Forearm`],
    [`hand${s}`]: [`Bip01_${S}_Hand`],
    [`thumb1${s}`]: [`Bip01_${S}_Finger0`],
    [`thumb2${s}`]: [`Bip01_${S}_Finger01`, `Bip01_${S}_Finger02`],
    [`thigh${s}`]: [`Bip01_${S}_Thigh`],
    [`shin${s}`]: [`Bip01_${S}_Calf`],
    [`foot${s}`]: [`Bip01_${S}_Foot`, `Bip01_${S}_Toe0`],
  });
  ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
    for (let j = 1; j <= 3; j++) MAP[`${f}${j}${s}`] = [`Bip01_${S}_Finger${i + 1}${j > 1 ? j - 1 : ''}`];
  });
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _m = new THREE.Matrix4();

// world-space orientation / position of each bone of a model, relative to the model's root
function rootSpace(root, bones) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), out = {};
  for (const b of bones) {
    _m.multiplyMatrices(inv, b.matrixWorld);
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    _m.decompose(p, q, _p2);
    out[b.name] = { q, p };
  }
  return out;
}

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
    // the pairs, parents before children (the Rocketbox hierarchy order)
    this.pairs = [];
    const rbBones = [];
    this.model.traverse((o) => o.isBone && rbBones.push(o));
    const followed = new Map();
    for (const [o, list] of Object.entries(MAP)) for (const n of list) followed.set(n, o);
    for (const b of rbBones) if (followed.has(b.name) && bone(player.model, followed.get(b.name))) this.pairs.push({ rb: b, old: followed.get(b.name) });

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
    // per pair: the fixed turn from the old bone's frame to the new one's (C = old^-1 * new)
    for (const pr of this.pairs) pr.c = o0[pr.old].q.clone().invert().multiply(r0[pr.rb.name].q);
    // the pelvis: where it is against the old hips, and the ratio of their heights
    this.hip0 = { old: o0.hips.p.clone(), rb: r0.Bip01_Pelvis.p.clone(), k: r0.Bip01_Pelvis.p.y / o0.hips.p.y };

    // the Rocketbox body sits in the hero's model, so the lean, the car seat, the bike all carry it
    player.model.add(this.model);
    // the old body hides (its skeleton keeps playing every move, and holds the guns)
    player.model.traverse((o) => {
      if (o.isSkinnedMesh && !this.isOurs(o)) o.visible = false;
    });
    this.oldBones = {};
    for (const pr of this.pairs) this.oldBones[pr.old] = bone(player.model, pr.old);
    this.rbHandR = bone(this.model, 'Bip01_R_Hand');

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const c of gltf.animations) {
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[c.name] = a;
    }
    // locomotion is stepped by one shared gait phase, so walk, run and sprint stay in step
    for (const n of Object.keys(GAITS)) if (this.actions[n]) this.actions[n].timeScale = 0;
    this.weights = Object.fromEntries(Object.keys(this.actions).map((n) => [n, n === 'idle' ? 1 : 0]));
    this.phase = 0;
    this.mocap = 0; // 1: the motion capture plays, 0: the body follows the old rig
    this.gunBase = new Map();
  }

  isOurs(o) {
    for (let p = o; p; p = p.parent) if (p === this.model) return true;
    return false;
  }

  update(dt) {
    const P = this.player;
    // -------------------------------------------------- the motion capture
    const armed = Object.values(P.weaponNodes || {}).some((o) => o.visible);
    const free = !P.vehicle && !P.posed && !P.overlay && !P.swimming && !P.busted && !P.dead && P.grounded && !armed && !P.aiming && !(P.guardTimer > 0);
    this.mocap += ((free ? 1 : 0) - this.mocap) * Math.min(1, dt * 8);
    const s = P.speed;
    const tw = { idle: 0, walk: 0, run: 0, sprint: 0 };
    if (s < 1.0) [tw.idle, tw.walk] = [1 - s, s];
    else if (s < GAITS.walk + 0.4) tw.walk = 1;
    else if (s < GAITS.run) {
      const k = (s - GAITS.walk - 0.4) / (GAITS.run - GAITS.walk - 0.4);
      [tw.walk, tw.run] = [1 - k, k];
    } else {
      const k = Math.min(1, (s - GAITS.run) / (GAITS.sprint - GAITS.run));
      [tw.run, tw.sprint] = [1 - k, k];
    }
    const k = 1 - Math.exp(-10 * dt);
    for (const n of Object.keys(this.actions)) {
      this.weights[n] += ((tw[n] || 0) - this.weights[n]) * k;
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    let stride = 0, wsum = 0;
    for (const n of Object.keys(GAITS)) {
      const a = this.actions[n];
      if (!a) continue;
      stride += this.weights[n] * GAITS[n] * a.getClip().duration;
      wsum += this.weights[n];
    }
    if (wsum > 0.01 && s > 0.05) this.phase = (this.phase + (dt * s) / (stride / wsum)) % 1;
    for (const n of Object.keys(GAITS)) if (this.actions[n]) this.actions[n].time = this.phase * this.actions[n].getClip().duration;
    this.mixer.update(dt);

    // -------------------------------------------------- following the old rig
    const follow = 1 - this.mocap;
    const root = P.model;
    root.updateMatrixWorld(true);
    const rootInvQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    // root-space orientation of every Rocketbox bone as it is now set (parents first)
    const rq = new Map();
    const parentQ = (b) => rq.get(b.parent) || rootInvQ.clone().multiply(b.parent.getWorldQuaternion(new THREE.Quaternion()));
    if (follow > 0.001) {
      for (const pr of this.pairs) {
        const ob = this.oldBones[pr.old];
        // the target: the old bone's root-space orientation turned by the calibration
        _q.copy(rootInvQ).multiply(ob.getWorldQuaternion(_q2)).multiply(pr.c);
        const pq = parentQ(pr.rb);
        _q2.copy(pq).invert().multiply(_q); // in the parent's frame
        pr.rb.quaternion.slerp(_q2, follow);
        rq.set(pr.rb, pq.clone().multiply(pr.rb.quaternion));
        if (pr.old === 'hips') {
          // the pelvis goes where the old hips go, scaled to the new body's height
          _p.setFromMatrixPosition(ob.matrixWorld);
          root.worldToLocal(_p);
          _p.sub(this.hip0.old).multiplyScalar(this.hip0.k).add(this.hip0.rb); // root space
          // root space -> the pelvis's parent's space
          root.localToWorld(_p);
          pr.rb.parent.worldToLocal(_p);
          pr.rb.position.lerp(_p, follow);
        }
      }
    }
    // -------------------------------------------------- the gun, from the old hand to the new
    this.model.updateMatrixWorld(true);
    const oh = this.oldBones.handR;
    for (const w of Object.values(P.weaponNodes || {})) {
      if (!w.visible || w.parent !== oh) continue;
      if (!this.gunBase.has(w)) this.gunBase.set(w, w.position.clone());
      // move it by how far the new hand is from the old one, in the old hand's frame
      _p.setFromMatrixPosition(this.rbHandR.matrixWorld);
      oh.worldToLocal(_p);
      w.position.copy(this.gunBase.get(w)).add(_p);
    }
  }
}
