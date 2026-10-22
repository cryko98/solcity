// Getting in and out of cars, GTA style.
//   Enter: walk (around the car if needed) to the driver door - a moving car brakes for you -
//          open the door, drag out whoever is driving and throw them on the ground, get in
//          (step in, duck, sit), pull the door shut.
//   Exit:  stop, open the door, step out, close it.
//   Bail:  F while going fast: the door flies open and you dive out and roll on the road.
// Motorbikes have no door: you just get on and off.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;

export class CarEntry {
  constructor({ player, peds, city, audio, hud }) {
    Object.assign(this, { player, peds, city, audio, hud });
    this.s = null;
    // fed to the Player while we steer him to the door
    this.input = {
      down: (...codes) => codes.includes('KeyW') || (this.s?.run && (codes.includes('ShiftLeft') || codes.includes('ShiftRight'))),
      pressed: () => false,
      mouse: () => false,
    };
    this.onEntered = null; // (c) => void
    this.onExited = null; // (c) => void
    this.onJack = null; // (c, ped) => void
  }

  get active() {
    return !!this.s;
  }

  // walking to the door (the player is driven by this.input and this.yaw)
  get steering() {
    return this.s?.phase === 'approach';
  }

  // ---------------------------------------------------------------- geometry helpers
  doorSpot(v) {
    return v.root.localToWorld(_v.copy(v.door)).clone();
  }

  // facing the car side from the door: local -X in world space
  faceCarYaw(v) {
    const d = new THREE.Vector3(-1, 0, 0).applyQuaternion(v.object.getWorldQuaternion(_q));
    return Math.atan2(d.x, d.z);
  }

  seatSpot(v) {
    const P = this.player;
    return v.body.localToWorld(new THREE.Vector3(v.seat.x, v.seat.y - P.hipsRest + 0.09, v.seat.z + 0.02));
  }

  // route around the car to the driver's side if we start on the wrong side
  waypoints(v) {
    const s = v.spec, P = this.player.position;
    const local = v.root.worldToLocal(P.clone());
    const door = v.door;
    const pts = [];
    const W = s.halfW + 1.0, L = s.halfL + 1.0;
    if (local.x < s.halfW + 0.3) {
      const zc = local.z >= door.z ? L : -L;
      if (local.x < -s.halfW + 0.3) pts.push(new THREE.Vector3(-W, 0, zc));
      pts.push(new THREE.Vector3(W, 0, zc));
    }
    return pts;
  }

  // ---------------------------------------------------------------- start
  enter(c) {
    const v = c.vehicle;
    c.entering = true; // keep it a live vehicle (not parked back into the instanced fleet)
    this.s = { mode: 'enter', phase: 'approach', c, v, t: 0, wps: this.waypoints(v), run: false };
    if (c.ai) c.ai.halt = true; // the driver brakes when you go for the door
  }

  exit(c) {
    const v = c.vehicle;
    c.entering = true;
    this.s = { mode: 'exit', phase: 'open', c, v, t: 0 };
  }

  // jump out of a moving car: door flies open, dive, roll
  bail(c) {
    const v = c.vehicle, P = this.player;
    const vel = v.vel.clone();
    const out = new THREE.Vector3(1, 0, 0).applyQuaternion(v.object.getWorldQuaternion(_q)).setY(0).normalize();
    v.doorOpen = 1;
    P.exitVehicle();
    P.posed = null;
          P.showWeapon();
    P.yaw = Math.atan2(vel.x, vel.z);
    P.object.rotation.set(0, P.yaw, 0);
    P.position.addScaledVector(out, 0.4);
    P.push.copy(vel).multiplyScalar(0.75).addScaledVector(out, 3.5);
    if (P.actions.roll) P.playOnce('roll');
    else P.knockDown(v.pos, 1.6);
    const hurt = Math.min(30, v.speed * 1.1);
    P.health = Math.max(1, P.health - hurt);
    this.onExited?.(c, true);
    v.doorSwing = -1.2; // swings shut again
    this.audio.blip({ noise: 1, cutoff: 900, tone: 120, toneEnd: 50, dur: 0.25, gain: 0.5 });
  }

  cancel() {
    const s = this.s;
    if (!s) return;
    if (s.c.ai) s.c.ai.halt = false;
    s.c.entering = false;
    if (s.c.vehicle) s.c.vehicle.doorOpen = 0;
    this.player.posed = null;
    this.player.showWeapon();
    this.s = null;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const s = this.s;
    if (!s) return;
    const P = this.player;
    s.t += dt;
    if (!s.c.vehicle || s.c.wrecked || P.dead || P.busted) return this.cancel();
    const v = (s.v = s.c.vehicle);

    if (s.mode === 'enter') {
      if (s.phase === 'approach') {
        // a moving car brakes; if it gets away, give up
        const target = s.wps.length ? v.root.localToWorld(s.wps[0].clone()) : this.doorSpot(v);
        const dx = target.x - P.position.x, dz = target.z - P.position.z, d = Math.hypot(dx, dz);
        this.yaw = Math.atan2(dx, dz);
        const door = this.doorSpot(v);
        const dd = Math.hypot(door.x - P.position.x, door.z - P.position.z);
        s.run = dd > 2.5;
        if (s.t > 7 || (dd > 14 && v.speed > 2)) return this.cancel();
        if (d < (s.wps.length ? 0.8 : 0.45)) {
          if (s.wps.length) s.wps.shift();
          else if (v.speed < 1.2) this.beginOpen();
        }
        return;
      }
      // the car stays put while we climb in
      v.vel.multiplyScalar(Math.exp(-6 * dt));
      v.angVel *= Math.exp(-6 * dt);
      if (s.phase === 'open') {
        this.placeAtDoor();
        v.doorOpen = smooth(0.3, 0.85, s.t / s.dur);
        if (s.t >= s.dur) (v.npcDriver ? this.beginJack() : this.beginGetIn());
      } else if (s.phase === 'jack') {
        this.placeAtDoor();
        if (!s.thrown && s.t > s.dur * 0.45) this.throwDriver();
        if (s.t >= s.dur) this.beginGetIn();
      } else if (s.phase === 'getin') {
        const k = Math.min(1, s.t / s.dur);
        const a = smooth(0.15, 0.9, k);
        const from = this.doorSpot(v), to = this.seatSpot(v);
        P.position.set(from.x + (to.x - from.x) * a, from.y + (to.y - from.y) * smooth(0.3, 0.8, k), from.z + (to.z - from.z) * a);
        P.yaw = lerpAngle(this.faceCarYaw(v), v.heading, smooth(0.1, 0.75, k));
        P.object.rotation.set(0, P.yaw, 0);
        if (k >= 1) {
          P.posed = null;
          P.showWeapon();
          if (s.c.ai) s.c.ai.halt = false;
          this.onEntered?.(s.c);
          s.phase = 'close';
          s.t = 0;
        }
      } else if (s.phase === 'close') {
        v.doorOpen = 1 - smooth(0, 0.45, s.t);
        if (s.t > 0.45) {
          v.doorOpen = 0;
          this.audio.blip({ noise: 1, cutoff: 500, tone: 90, toneEnd: 60, dur: 0.12, gain: 0.35 }); // thunk
          s.c.entering = false;
          this.s = null;
        }
      }
      return;
    }

    if (s.mode === 'exit') {
      if (s.phase === 'open') {
        v.doorOpen = smooth(0, 0.4, s.t);
        if (s.t >= 0.4) {
          // leave the seat: from here on the body is moved by hand
          const seat = P.object.getWorldPosition(new THREE.Vector3());
          this.onExited?.(s.c, false);
          P.exitVehicle();
          P.position.copy(seat);
          s.from = seat;
          s.dur = P.playScripted('getin', true) || 0.9;
          s.phase = 'getout';
          s.t = 0;
        }
      } else if (s.phase === 'getout') {
        const k = Math.min(1, s.t / s.dur);
        const a = smooth(0.1, 0.85, k);
        const door = this.doorSpot(v);
        door.y = this.city.groundHeight(door.x, door.z);
        P.position.set(s.from.x + (door.x - s.from.x) * a, s.from.y + (door.y - s.from.y) * smooth(0.2, 0.7, k), s.from.z + (door.z - s.from.z) * a);
        // swing round to step out facing away from the car
        P.yaw = lerpAngle(v.heading, this.faceCarYaw(v) + Math.PI, smooth(0.25, 0.9, k));
        P.object.rotation.set(0, P.yaw, 0);
        if (k >= 1) {
          P.posed = null;
          P.showWeapon();
          P.grounded = true;
          s.phase = 'close';
          s.t = 0;
        }
      } else if (s.phase === 'close') {
        v.doorOpen = 1 - smooth(0.1, 0.5, s.t);
        if (s.t > 0.5) {
          v.doorOpen = 0;
          this.audio.blip({ noise: 1, cutoff: 500, tone: 90, toneEnd: 60, dur: 0.12, gain: 0.35 });
          s.c.entering = false;
          this.s = null;
        }
      }
    }
  }

  placeAtDoor() {
    const s = this.s, P = this.player;
    const door = this.doorSpot(s.v);
    P.position.set(door.x, this.city.groundHeight(door.x, door.z), door.z);
    P.yaw = this.faceCarYaw(s.v);
    P.object.rotation.set(0, P.yaw, 0);
  }

  beginOpen() {
    const s = this.s;
    s.phase = 'open';
    s.t = 0;
    s.dur = this.player.playScripted('opendoor') || 0.8;
    this.placeAtDoor();
    this.audio.blip({ noise: 0.6, cutoff: 1800, dur: 0.08, gain: 0.25 }); // handle click
  }

  beginJack() {
    const s = this.s;
    s.phase = 'jack';
    s.t = 0;
    s.thrown = false;
    s.dur = this.player.playScripted('jackpull') || 0.9;
  }

  // the driver comes out of the seat and lands on the road behind us
  throwDriver() {
    const s = this.s, v = s.v, P = this.player;
    s.thrown = true;
    const d = this.peds.unseatDriver(v);
    if (!d) return;
    const door = this.doorSpot(v);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(v.object.getWorldQuaternion(_q)); // towards the car's rear
    const out = new THREE.Vector3(1, 0, 0).applyQuaternion(v.object.getWorldQuaternion(_q));
    const p = this.peds.add(d.kind || 'male', door.x - out.x * 0.3 + back.x * 0.4, door.z - out.z * 0.3 + back.z * 0.4, P.yaw);
    p.yaw = Math.atan2(-out.x, -out.z);
    this.peds.knockOut(p, out.x * 2.5 + back.x * 3.2, out.z * 2.5 + back.z * 3.2, false);
    p.getUpAt = 2.2 + Math.random();
    p.fleeFrom = { x: P.position.x, z: P.position.z };
    this.audio.punch();
    this.onJack?.(s.c, p);
  }

  beginGetIn() {
    const s = this.s;
    s.phase = 'getin';
    s.t = 0;
    s.dur = this.player.playScripted('getin') || 1.0;
  }
}
