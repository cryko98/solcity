// Third-person character controller driving the Blender-made protagonist:
// walking/running/jumping, boxing combos, taking hits, and the driving pose.
import * as THREE from 'three';
import { prepareCharacter } from './materials.js';

const WALK = 1.65, RUN = 5.3, GRAVITY = 22, JUMP = 6.4, RADIUS = 0.32;
// in the sea: you swim once the water is chest-deep, and stand up again where it's shallower
const SWIM_IN = 1.25, SWIM_OUT = 1.0, SWIM = 1.5, SWIM_FAST = 2.7, SWIM_Y = 0.4; // body origin below the surface
const ONE_SHOTS = ['punchl', 'punchr', 'hit', 'knockdown', 'roll', 'getup'];
const ROLL_SPEED = 5.6;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// upper / lower body split for carrying and aiming weapons while walking
const UPPER = /^(spine|chest|neck|head|upper_arm|forearm|hand|thumb|index|middle|ring|pinky)/;
const LOCO = ['idle', 'walk', 'run', 'guard', 'jump'];
const WEAPON_CLIPS = { pistol: ['PistolHold', 'PistolAim'], smg: ['SMGHold', 'SMGAim'], shotgun: ['ShotgunHold', 'ShotgunAim'] };
const boneOf = (track) => track.name.slice(0, track.name.lastIndexOf('.'));
const subClip = (clip, name, keep) => {
  const c = clip.clone();
  c.name = name;
  c.tracks = c.tracks.filter((t) => keep(boneOf(t)));
  return c;
};
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const dampAngle = (a, b, rate, dt) => a + wrap(b - a) * (1 - Math.exp(-rate * dt));

export class Player {
  constructor(gltf, city) {
    this.city = city;
    this.object = new THREE.Group();
    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    this.object.add(this.model);
    prepareCharacter(this.model);
    // sitting: the seat cushion sits a little below the hip joints
    this.hipsRest = this.model.getObjectByName('hips').position.y;

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    const names = ['Idle', 'Walk', 'Run', 'Jump', 'Drive', 'Ride', 'HandsUp', 'Guard', 'PunchL', 'PunchR', 'Hit', 'KnockDown', 'Roll', 'SitTalk', 'SitListen', 'StandTalk', 'StandListen', 'OpenDoor', 'GetIn', 'JackPull', 'GetUp', 'Swim', 'Tread', 'Dance', 'BenchPress', 'Arcade', 'Darts'];
    // Ride / HandsUp may be missing from older exports
    const clips = Object.fromEntries(names.map((n) => [n.toLowerCase(), clip(n)]).filter(([, c]) => c));
    // stride length = ground covered per gait cycle, measured from the foot motion in the clip
    this.walkStride = this.measureStride(clips.walk, 1.0);
    this.runStride = this.measureStride(clips.run, 1.3, true);

    this.actions = {};
    this.weights = {};
    for (const [n, c] of Object.entries(clips)) {
      const a = this.mixer.clipAction(c);
      if (ONE_SHOTS.includes(n)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.play();
      a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      this.actions[n] = a;
      this.weights[n] = n === 'idle' ? 1 : 0;
    }
    // armed variants: legs from the locomotion clips, upper body from the weapon pose
    const extra = {};
    for (const n of LOCO) if (clips[n]) extra[n + '_lo'] = subClip(clips[n], n + '_lo', (b) => !UPPER.test(b));
    for (const [key, [hold, aim]] of Object.entries(WEAPON_CLIPS)) {
      if (clip(hold)) extra[key + '_hold'] = subClip(clip(hold), key + '_hold', (b) => UPPER.test(b));
      if (clip(aim)) extra[key + '_aim'] = subClip(clip(aim), key + '_aim', (b) => UPPER.test(b));
    }
    for (const [n, c] of Object.entries(extra)) {
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[n] = a;
      this.weights[n] = 0;
    }
    this.actions.walk.timeScale = this.actions.run.timeScale = 0;
    if (this.actions.walk_lo) this.actions.walk_lo.timeScale = this.actions.run_lo.timeScale = 0;
    this.durations = { walk: clips.walk.duration, run: clips.run.duration };
    // guns modelled on the right hand bone; hidden until equipped
    this.weaponNodes = {};
    for (const n of ['Weapon_Pistol', 'Weapon_SMG', 'Weapon_Shotgun']) {
      const o = this.model.getObjectByName(n);
      if (o) {
        o.visible = false;
        this.weaponNodes[n] = o;
      }
    }
    this.bones = Object.fromEntries(['hips', 'spine', 'chest', 'neck', 'head'].map((n) => [n, this.model.getObjectByName(n)]));
    this.legTwist = 0; // aiming on the move: how far the hips turn toward where he walks
    this.lookYaw = 0; // head turn toward where the camera looks
    this.camYaw = 0;
    this.weapon = null;
    this.aiming = false;
    this.aimPitch = 0;
    this.recoilKick = 0;

    this.vel = new THREE.Vector3();
    this.push = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.moveSpeed = 0;
    this.vy = 0;
    this.grounded = true;
    this.phase = 0;
    this.speed = 0;
    this.lean = 0;
    this.pitch = 0;
    this.vehicle = null;
    this.scene = null;

    // combat
    this.health = 100;
    this.armor = 0;
    this.dead = false;
    this.busted = false;
    this.overlay = null; // one-shot animation in progress: { name, t, dur }
    this.combo = 0;
    this.queued = false;
    this.guardTimer = 0;
    this.findTarget = null; // () => { x, z } | null   (set by the game)
    this.onPunch = null; // () => void, called at the moment a punch would land
    this.onHurt = null;
    this.onDeath = null;
    this.onStep = null; // (running) => void, every footfall
    this.onLand = null; // (fallSpeed) => void
  }

  // ground covered per gait cycle. planted: the clip plants its feet (the run): how fast the
  // foot slides back under the body while it's on the ground, times the cycle, so they never
  // skid. Otherwise (and as a fallback) from the foot's reach.
  measureStride(clip, flightFactor, planted = false) {
    const action = this.mixer.clipAction(clip);
    action.play();
    const foot = this.model.getObjectByName('footL') || this.model.getObjectByName('foot.L');
    const v = new THREE.Vector3(), pts = [], N = 80;
    for (let i = 0; i < N; i++) {
      action.time = (clip.duration * i) / N;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      foot.getWorldPosition(v);
      pts.push([v.y, v.z]);
    }
    action.stop();
    this.mixer.uncacheAction(clip);
    const minY = Math.min(...pts.map((p) => p[0]));
    const speeds = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
      if (pts[i][0] < minY + 0.02 && a[0] < minY + 0.03 && b[0] < minY + 0.03) speeds.push(Math.abs(b[1] - a[1]) * (N / 2));
    }
    if (planted && speeds.length >= 3) return speeds.sort((p, q) => p - q)[Math.floor(speeds.length / 2)];
    const zs = pts.map((p) => p[1]);
    return Math.max(0.8, 2 * (Math.max(...zs) - Math.min(...zs)) * flightFactor);
  }

  get position() {
    return this.object.position;
  }

  // a scripted full-body clip (getting in / out of cars): the caller moves the body
  playScripted(name, reverse = false) {
    const a = this.actions[name];
    if (!a) return 0;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = reverse ? -1 : 1;
    if (reverse) a.time = a.getClip().duration;
    a.play();
    this.posed = name;
    this.overlay = null;
    for (const n of Object.keys(this.weights)) this.weights[n] = n === name ? 1 : 0;
    this.showWeapon();
    return a.getClip().duration;
  }

  setWeapon(w) {
    this.weapon = w;
    this.showWeapon();
  }

  showWeapon() {
    for (const [n, o] of Object.entries(this.weaponNodes)) o.visible = !!this.weapon && !this.vehicle && !this.posed && !this.swimming && n === this.weapon.node;
  }

  recoil(k) {
    this.recoilKick = Math.min(0.5, this.recoilKick + k * 4);
  }

  get seatClip() {
    return this.vehicle && this.vehicle.spec.bike && this.actions.ride ? 'ride' : 'drive';
  }

  enterVehicle(v) {
    this.swimming = false;
    this.vehicle = v;
    this.scene = this.object.parent;
    v.body.add(this.object);
    // car seats: the cushion sits a little below the hip joints; on the bike the hips sit on the seat marker
    if (v.spec.bike) this.object.position.set(v.seat.x, v.seat.y - this.hipsRest, v.seat.z);
    else this.object.position.set(v.seat.x, v.seat.y - this.hipsRest + 0.09, v.seat.z + 0.02);
    // reclined seat (supercar): tip the body back about the hip joint so the legs stay inside the car
    this.object.rotation.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    const rc = v.spec.recline || 0;
    if (rc) {
      const hips = new THREE.Vector3(0, this.hipsRest, 0);
      this.model.rotation.set(-rc, 0, 0);
      this.model.position.copy(hips).sub(hips.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -rc));
    }
    this.vel.set(0, 0, 0);
    this.moveSpeed = this.speed = 0;
    this.overlay = null;
    for (const n of Object.keys(this.weights)) this.weights[n] = n === this.seatClip ? 1 : 0;
    this.showWeapon();
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    const door = v.root.localToWorld(v.door.clone());
    this.scene.add(this.object);
    this.object.position.set(door.x, this.city.groundHeight(door.x, door.z), door.z);
    this.yaw = v.heading + Math.PI / 2;
    this.object.rotation.set(0, this.yaw, 0);
    this.vehicle = null;
    this.grounded = true;
    this.showWeapon();
    for (const n of Object.keys(this.weights)) this.weights[n] = n === 'idle' ? 1 : 0;
  }

  // ---------------------------------------------------------------- combat
  playOnce(name) {
    const a = this.actions[name];
    a.reset();
    a.play();
    this.overlay = { name, t: 0, dur: a.getClip().duration, landed: false };
  }

  attack() {
    if (this.overlay && this.overlay.name.startsWith('punch')) {
      // click during a punch chains the next one with the other hand
      if (this.overlay.t > 0.08) this.queued = true;
      return;
    }
    if (this.overlay) return; // staggered
    this.throwPunch();
  }

  // dodge roll in the direction of travel (or straight ahead)
  roll(dirYaw) {
    this.yaw = dirYaw;
    this.object.rotation.y = dirYaw;
    this.playOnce('roll');
    this.moveSpeed = ROLL_SPEED;
    this.queued = false;
  }

  throwPunch() {
    this.playOnce(this.combo % 2 === 0 ? 'punchl' : 'punchr');
    this.combo++;
    this.queued = false;
    this.guardTimer = 3;
  }

  takeHit(dmg, from) {
    if (this.dead || this.busted || this.vehicle) return;
    if (this.overlay && this.overlay.name === 'roll' && this.overlay.t < this.overlay.dur * 0.8) return;
    const soak = Math.min(this.armor, dmg * 0.75);
    this.armor -= soak;
    this.health = Math.max(0, this.health - (dmg - soak));
    const dx = this.position.x - from.x, dz = this.position.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.push.set((dx / d) * 2, 0, (dz / d) * 2);
    this.yaw = Math.atan2(-dx, -dz);
    this.guardTimer = 3;
    this.onHurt?.(dmg);
    if (this.health <= 0) {
      this.dead = true;
      this.swimming = false;
      this.playOnce('knockdown');
      this.overlay.dur = Infinity;
      this.push.multiplyScalar(1.4);
      this.onDeath?.();
    } else {
      this.playOnce('hit');
      this.overlay.dur *= 0.75;
    }
  }

  // thrown off a crashing bike: fall, lie for a moment, get up
  knockDown(from, dur = 2.4) {
    const dx = this.position.x - from.x, dz = this.position.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.push.set((dx / d) * 4, 0, (dz / d) * 4);
    this.playOnce('knockdown');
    this.overlay.dur = dur;
  }

  // arrested: hands up, no control
  surrender() {
    this.busted = true;
    this.swimming = false;
    this.overlay = null;
    this.vel.set(0, 0, 0);
    this.moveSpeed = this.speed = 0;
  }

  respawn(pos, yaw) {
    this.health = 100;
    this.armor = 0;
    this.dead = false;
    this.busted = false;
    this.overlay = null;
    this.combo = 0;
    // nothing carried over from the moment of death (mid-jump, mid-fight)
    this.vy = 0;
    this.grounded = true;
    this.vel?.set(0, 0, 0);
    this.push?.set(0, 0, 0);
    this.moveSpeed = 0;
    this.position.copy(pos);
    this.yaw = yaw;
    this.object.rotation.y = yaw;
    for (const n of Object.keys(this.weights)) this.weights[n] = n === 'idle' ? 1 : 0;
  }

  // ---------------------------------------------------------------- update
  update(dt, input, camYaw, vehicles, peds) {
    this.camYaw = camYaw;
    // posed by a cutscene (sitting / standing still): animation only
    if (this.posed) {
      this.camYaw = this.yaw;
      this.animate(dt);
      return;
    }
    if (this.vehicle) {
      this.guardTimer -= dt;
      this.animate(dt);
      return;
    }
    if (this.dead || this.busted) {
      this.slide(dt, vehicles, peds);
      this.animate(dt);
      return;
    }
    if (this.overlay) {
      const o = this.overlay;
      o.t += dt;
      if (o.name.startsWith('punch') && !o.landed && o.t > o.dur * 0.3) {
        o.landed = true;
        this.onPunch?.();
      }
      if (o.name.startsWith('punch') && this.queued && o.t > o.dur * 0.62) this.throwPunch();
      else if (o.t >= o.dur) {
        this.overlay = null;
        if (o.name.startsWith('punch')) this.comboReset = 0.5;
        // knocked flat (off a bike): get back up instead of popping upright
        if (o.name === 'knockdown' && !this.dead && this.actions.getup) this.playOnce('getup');
      }
    }
    if (this.comboReset !== undefined && (this.comboReset -= dt) <= 0 && !this.overlay) {
      this.combo = 0;
      this.comboReset = undefined;
    }
    this.guardTimer -= dt;
    // into the sea: once it's chest-deep (and we've come down to the surface) we swim
    const pos = this.object.position;
    const depth = this.indoors ? 0 : this.city.waterDepth(pos.x, pos.z);
    if (!this.swimming && depth > SWIM_IN && pos.y <= this.city.WATER_Y + 0.1) {
      this.swimming = true;
      this.overlay = null;
      this.vy = 0;
      this.grounded = true;
      this.showWeapon();
      this.onSplash?.();
    }
    if (this.swimming) return this.swim(dt, input, camYaw, depth, vehicles, peds);
    if (input.pressed('Mouse0') && this.grounded && !this.weapon) this.attack();

    const ix = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const iz = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    const running = input.down('ShiftLeft', 'ShiftRight');
    const punching = this.overlay && this.overlay.name.startsWith('punch');
    const staggered = this.overlay && this.overlay.name === 'hit';

    // camera-relative intent: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const mx = fx * iz - fz * ix, mz = fz * iz + fx * ix;
    const hasInput = (mx !== 0 || mz !== 0) && !staggered;
    // C (or jump while aiming): combat roll
    if (this.actions.roll && this.grounded && !this.overlay && (input.pressed('KeyC') || (this.aiming && input.pressed('Space')))) {
      this.roll(hasInput ? Math.atan2(mx, mz) : this.yaw);
    }
    const rolling = this.overlay && this.overlay.name === 'roll';
    let target = hasInput ? (running ? RUN * (this.runBoost || 1) : WALK) : 0;
    if (punching) target = Math.min(target, 0.8);
    if (this.guardTimer > 0 && !running) target = Math.min(target, 1.5);
    // wading: the deeper the water, the slower you go
    if (depth > 0.3) target *= 1 - 0.45 * Math.min(1, (depth - 0.3) / 0.9);

    // turn toward the intent first (fast when slow, wider arcs at speed), then move along the facing
    const prevYaw = this.yaw;
    if (punching && this.findTarget) {
      // auto-aim: square up to whoever is in front
      const t = this.findTarget();
      if (t) {
        this.yaw = dampAngle(this.yaw, Math.atan2(t.x - this.position.x, t.z - this.position.z), 18, dt);
        // step in so the punch reaches
        const d = Math.hypot(t.x - this.position.x, t.z - this.position.z);
        if (d > 1.15 && this.overlay.t < this.overlay.dur * 0.35) this.moveSpeed = Math.min(2.6, (d - 1.05) * 6);
        else this.moveSpeed = 0;
      }
    }
    if (rolling) {
      // fast at first, rolling out to a stop
      const k = this.overlay.t / this.overlay.dur;
      this.moveSpeed = ROLL_SPEED * (k < 0.75 ? 1 - k * 0.35 : (1 - k) * 2.6);
    } else if (this.aiming && this.grounded) {
      this.yaw = dampAngle(this.yaw, camYaw, 20, dt);
      const tgt = hasInput ? (running ? RUN * 0.6 : WALK * 1.25) : 0; // Shift: a jog with the gun up
      this.moveSpeed += (tgt - this.moveSpeed) * (1 - Math.exp(-8 * dt));
      const len = Math.hypot(mx, mz) || 1;
      this.strafe = hasInput ? [mx / len, mz / len] : this.strafe || [0, 0];
    } else if (hasInput && this.grounded && !punching) {
      const desired = Math.atan2(mx, mz);
      const turnRate = THREE.MathUtils.lerp(16, 7, Math.min(1, this.moveSpeed / RUN));
      this.yaw = dampAngle(this.yaw, desired, turnRate, dt);
      const align = THREE.MathUtils.clamp(Math.cos(Math.abs(wrap(desired - this.yaw))), 0.15, 1);
      const accel = target > this.moveSpeed ? (running ? 7 : 6) : 10;
      this.moveSpeed += (target * align - this.moveSpeed) * (1 - Math.exp(-accel * dt));
    } else if (this.grounded && !punching) {
      this.moveSpeed += (Math.min(target, this.moveSpeed) - this.moveSpeed) * (1 - Math.exp(-9 * dt));
      if (!hasInput) this.moveSpeed *= Math.exp(-9 * dt);
    } else if (punching && !(this.findTarget && this.findTarget())) {
      this.moveSpeed *= Math.exp(-9 * dt);
    }
    if (this.aiming && !this.grounded && !rolling) this.yaw = dampAngle(this.yaw, camYaw, 20, dt);
    this.yawRate = wrap(this.yaw - prevYaw) / Math.max(dt, 1e-4);
    if (this.grounded && this.aiming && !rolling) this.vel.set(this.strafe[0] * this.moveSpeed, 0, this.strafe[1] * this.moveSpeed);
    else if (this.grounded) this.vel.set(Math.sin(this.yaw) * this.moveSpeed, 0, Math.cos(this.yaw) * this.moveSpeed);

    if (this.grounded && !this.overlay && !this.aiming && input.pressed('Space')) {
      this.vy = JUMP;
      this.grounded = false;
    }

    const p = this.object.position;
    const before = p.clone();
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    this.slide(dt, vehicles, peds);
    // speed actually achieved (walls slow you down) drives the animation
    const moved = Math.hypot(p.x - before.x, p.z - before.z) / Math.max(dt, 1e-4);
    if (this.grounded && moved < this.moveSpeed * 0.6) this.moveSpeed = THREE.MathUtils.lerp(this.moveSpeed, moved, 0.25);

    const gh = this.city.groundHeight(p.x, p.z);
    if (this.grounded) {
      if (p.y - gh > 0.3) this.grounded = false;
      else p.y += (gh - p.y) * Math.min(1, dt * 18);
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      p.y += this.vy * dt;
      if (p.y <= gh) {
        p.y = gh;
        this.onLand?.(-this.vy);
        this.vy = 0;
        this.grounded = true;
      }
    }

    this.object.rotation.y = this.yaw;
    this.speed = this.grounded ? this.moveSpeed : Math.hypot(this.vel.x, this.vel.z);

    // body lean into turns and on acceleration
    const tLean = this.overlay ? 0 : THREE.MathUtils.clamp(-this.yawRate * this.speed * 0.022, -0.2, 0.2);
    this.lean += (tLean - this.lean) * (1 - Math.exp(-8 * dt));
    const tPitch = this.grounded && !this.overlay ? THREE.MathUtils.clamp((target - this.speed) * 0.025, -0.05, 0.08) : 0;
    this.pitch += (tPitch - this.pitch) * (1 - Math.exp(-6 * dt));
    this.model.rotation.set(this.pitch, 0, this.lean);
    this.animate(dt);
  }

  // front crawl: no punching, jumping or guns; Shift swims faster; out where it's shallow
  swim(dt, input, camYaw, depth, vehicles, peds) {
    const ix = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const iz = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const mx = fx * iz - fz * ix, mz = fz * iz + fx * ix;
    const hasInput = mx !== 0 || mz !== 0;
    const target = hasInput ? (input.down('ShiftLeft', 'ShiftRight') ? SWIM_FAST : SWIM) : 0;
    const prevYaw = this.yaw;
    if (hasInput) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 3.5, dt);
    this.moveSpeed += (target - this.moveSpeed) * (1 - Math.exp(-(target > this.moveSpeed ? 2.5 : 1.6) * dt));
    this.yawRate = wrap(this.yaw - prevYaw) / Math.max(dt, 1e-4);
    this.vel.set(Math.sin(this.yaw) * this.moveSpeed, 0, Math.cos(this.yaw) * this.moveSpeed);
    const p = this.object.position;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    this.slide(dt, vehicles, peds);
    // bob at the surface
    this.swimT = (this.swimT || 0) + dt;
    const y = this.city.WATER_Y - SWIM_Y + Math.sin(this.swimT * 2.2) * 0.03;
    p.y += (y - p.y) * Math.min(1, dt * 4);
    this.speed = this.moveSpeed;
    this.object.rotation.y = this.yaw;
    this.lean += (THREE.MathUtils.clamp(-this.yawRate * 0.08, -0.25, 0.25) - this.lean) * (1 - Math.exp(-5 * dt));
    this.pitch *= Math.exp(-6 * dt);
    this.model.rotation.set(this.pitch, 0, this.lean);
    // swimming into the quay or a jetty: climb out onto it
    if (hasInput) {
      const ax = p.x + Math.sin(this.yaw) * 0.7, az = p.z + Math.cos(this.yaw) * 0.7, gh = this.city.groundHeight(ax, az);
      if (gh > this.city.WATER_Y + 0.25 && gh < this.city.WATER_Y + 1.4) {
        p.set(ax, gh, az);
        this.swimming = false;
        this.grounded = true;
        this.moveSpeed = 0;
        this.showWeapon();
        return this.animate(dt);
      }
    }
    // touching bottom: wade out
    if (this.city.waterDepth(p.x, p.z) < SWIM_OUT) {
      this.swimming = false;
      this.grounded = true;
      this.moveSpeed = Math.min(this.moveSpeed, WALK);
      this.showWeapon();
    }
    this.animate(dt);
  }

  // knock-back impulse + collisions
  slide(dt, vehicles, peds) {
    const p = this.object.position;
    p.addScaledVector(this.push, dt);
    this.push.multiplyScalar(Math.exp(-7 * dt));
    this.collide(p);
    if (vehicles) vehicles.collideCircle(p, RADIUS);
    if (peds && !this.dead) peds.collideCircle(p, RADIUS);
    if (!this.indoors) {
      // (shop interiors are built far outside the island)
      const b = this.city.bounds;
      p.x = THREE.MathUtils.clamp(p.x, -b, b);
      p.z = THREE.MathUtils.clamp(p.z, -b, b);
    }
    if (this.dead) p.y += (Math.max(this.city.groundHeight(p.x, p.z), this.city.WATER_Y - SWIM_Y) - p.y) * Math.min(1, dt * 10);
  }

  collide(p) {
    const cs = this.city.query(p.x - 1, p.x + 1, p.z - 1, p.z + 1);
    for (let iter = 0; iter < 2; iter++) {
      for (const c of cs) {
        if (p.y > c.h - 0.05) continue;
        if (c.type === 'box') {
          const qx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX), qz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
          const dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= RADIUS * RADIUS) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (RADIUS - d);
            p.z += (dz / d) * (RADIUS - d);
          } else {
            // centre inside the box: leave by the shallowest side
            const opts = [[c.minX - RADIUS - p.x, 0], [c.maxX + RADIUS - p.x, 0], [0, c.minZ - RADIUS - p.z], [0, c.maxZ + RADIUS - p.z]];
            opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
            p.x += opts[0][0];
            p.z += opts[0][1];
          }
        } else {
          const dx = p.x - c.x, dz = p.z - c.z, r = RADIUS + c.r;
          const d = Math.hypot(dx, dz);
          if (d < r && d > 1e-6) {
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          }
        }
      }
    }
  }

  animate(dt) {
    const s = this.speed;
    let tw;
    if (this.posed) tw = { [this.actions[this.posed] ? this.posed : 'idle']: 1 };
    else if (this.vehicle) tw = { [this.seatClip]: 1 };
    else if (this.busted) tw = this.actions.handsup ? { handsup: 1 } : { idle: 1 };
    else if (this.swimming && this.actions.swim) {
      // treading water when still, front crawl once moving; the stroke rate follows the speed
      // (one cycle, two strokes, carries him ~2.7 m at the normal pace)
      const k = THREE.MathUtils.clamp((s - 0.15) / 0.7, 0, 1);
      tw = this.actions.tread ? { swim: k, tread: 1 - k } : { swim: 1 };
      this.actions.swim.timeScale = 0.5 + (0.5 * s) / SWIM;
    } else if (this.overlay) tw = { [this.overlay.name]: 1 };
    else if (!this.grounded) tw = { jump: 1 };
    else if (s < WALK) {
      const rest = this.guardTimer > 0 ? 'guard' : 'idle';
      tw = { [rest]: 1 - s / WALK, walk: s / WALK };
    } else {
      const t = Math.min(1, (s - WALK) / (RUN - WALK));
      tw = { walk: 1 - t, run: t };
    }
    // armed: legs keep their locomotion, the upper body holds / aims the gun
    const armed = this.weapon && !this.vehicle && !this.posed && !this.busted && !this.dead && !this.swimming && this.actions[this.weapon.clip + '_hold'] &&
      !(this.overlay && ['hit', 'knockdown', 'roll', 'getup'].includes(this.overlay.name));
    if (armed) {
      const lt = {};
      for (const [n, w] of Object.entries(tw)) lt[LOCO.includes(n) && this.actions[n + '_lo'] ? n + '_lo' : n] = w;
      lt[this.weapon.clip + (this.aiming ? '_aim' : '_hold')] = 1;
      tw = lt;
    }
    const k = 1 - Math.exp(-(this.overlay ? 22 : this.grounded ? 10 : 7) * dt);
    for (const n of Object.keys(this.actions)) {
      this.weights[n] += ((tw[n] || 0) - this.weights[n]) * k;
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    // aiming on the move (strafing, backing off): the legs walk the way he goes, turning the
    // hips up to ~60 degrees off the aim, and the gait runs backwards when he backs away;
    // the spine turns the chest back onto the aim (see below)
    let twist = 0, backward = false;
    if (this.aiming && this.grounded && !this.vehicle && !this.overlay && s > 0.3) {
      let rel = wrap(Math.atan2(this.vel.x, this.vel.z) - this.yaw);
      if (Math.abs(rel) > Math.PI * 0.6) {
        backward = true;
        rel = wrap(rel - Math.PI);
      }
      twist = THREE.MathUtils.clamp(rel, -1.05, 1.05);
    }
    this.legTwist += (twist - this.legTwist) * (1 - Math.exp(-10 * dt));
    // walk and run share one gait phase so blending never crosses feet
    if (this.grounded && !this.vehicle && !this.swimming) {
      const runShare = this.weights.run / Math.max(1e-3, this.weights.walk + this.weights.run);
      const stride = THREE.MathUtils.lerp(this.walkStride, this.runStride, runShare);
      const before = this.phase;
      this.phase = (this.phase + ((backward ? -1 : 1) * dt * s) / stride + 1) % 1;
      // a foot lands twice per gait cycle
      const crossed = backward ? this.phase > before || (before >= 0.5 && this.phase < 0.5) : this.phase < before || (before < 0.5 && this.phase >= 0.5);
      if (s > 0.6 && !this.overlay && crossed) this.onStep?.(s > WALK * 1.5);
    }
    this.actions.walk.time = this.phase * this.durations.walk;
    this.actions.run.time = this.phase * this.durations.run;
    if (this.actions.walk_lo) {
      this.actions.walk_lo.time = this.actions.walk.time;
      this.actions.run_lo.time = this.actions.run.time;
    }
    // undo last frame's aim offset first: the mixer skips writing a bone whose animated value
    // didn't change, so an offset left in place would pile up frame after frame
    if (this.aimSaved) {
      for (const [b, q] of this.aimSaved) b.quaternion.copy(q);
      this.aimSaved = null;
    }
    this.mixer.update(dt);
    // hips toward the walking direction, spine and chest back onto the aim
    if (Math.abs(this.legTwist) > 1e-3 && this.bones.hips) {
      this.model.updateMatrixWorld(true);
      this.aimSaved = this.aimSaved || [];
      for (const [n, f] of [['hips', 1], ['spine', -0.55], ['chest', -0.45]]) {
        const b = this.bones[n];
        if (!b) continue;
        if (!this.aimSaved.some(([o]) => o === b)) this.aimSaved.push([b, b.quaternion.clone()]);
        b.parent.getWorldQuaternion(_q2);
        _q3.setFromAxisAngle(_v2.set(0, 1, 0), this.legTwist * f);
        b.quaternion.premultiply(_q2.clone().invert().multiply(_q3).multiply(_q2));
        b.updateMatrixWorld(true);
      }
    }
    // vertical aim + recoil: pitch the spine about the character's right axis
    this.recoilKick *= Math.exp(-12 * dt);
    const ang = (armed && this.aiming ? this.aimPitch : 0) - this.recoilKick;
    if (armed && Math.abs(ang) > 1e-3) {
      this.model.updateMatrixWorld(true);
      const axis = _v1.set(1, 0, 0).applyQuaternion(this.object.getWorldQuaternion(_q1));
      this.aimSaved = this.aimSaved || [];
      for (const [n, f] of [['spine', 0.3], ['chest', 0.5], ['neck', 0.2]]) {
        const b = this.bones[n];
        if (!b) continue;
        if (!this.aimSaved.some(([o]) => o === b)) this.aimSaved.push([b, b.quaternion.clone()]);
        b.parent.getWorldQuaternion(_q2);
        _q3.setFromAxisAngle(axis, ang * f);
        // world rotation -> the bone's parent space
        b.quaternion.premultiply(_q2.clone().invert().multiply(_q3).multiply(_q2));
        b.updateMatrixWorld(true);
      }
    }
    this.headLook(dt, armed);
  }

  // turn the head (and a little of the neck) toward where the camera is looking, like GTA's free look
  headLook(dt, armed) {
    const bodyYaw = this.vehicle ? this.vehicle.heading : this.yaw;
    let want = wrap(this.camYaw - bodyYaw);
    const free = !this.dead && !this.busted && !(armed && this.aiming) && !(this.overlay && this.overlay.name !== 'guard');
    if (!free || Math.abs(want) > 2.0) want = 0; // looking backwards: face front again
    want = THREE.MathUtils.clamp(want, -1.05, 1.05);
    this.lookYaw += (want - this.lookYaw) * (1 - Math.exp(-5 * dt));
    if (Math.abs(this.lookYaw) < 0.01) return;
    this.model.updateMatrixWorld(true);
    const axis = _v2.set(0, 1, 0).applyQuaternion(this.object.getWorldQuaternion(_q1));
    if (!this.aimSaved) this.aimSaved = [];
    for (const [n, f] of [['neck', 0.4], ['head', 0.6]]) {
      const b = this.bones[n];
      if (!b) continue;
      if (!this.aimSaved.some(([o]) => o === b)) this.aimSaved.push([b, b.quaternion.clone()]);
      b.parent.getWorldQuaternion(_q2);
      _q3.setFromAxisAngle(axis, this.lookYaw * f);
      b.quaternion.premultiply(_q2.clone().invert().multiply(_q3).multiply(_q2));
      b.updateMatrixWorld(true);
    }
  }
}
