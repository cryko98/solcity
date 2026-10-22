// AI traffic: cars drive in the right-hand lane of the road grid, follow the
// car ahead, stop at red lights and for people, and pick a random turn at
// every intersection. Cars are spawned around the player and removed far away.
import * as THREE from 'three';
import { colorFor } from './vehicles.js';

const LANE = 1.75, CRUISE = 11, TURN_SPEED = 5, MAX_CARS = 16;
const SPAWN_MIN = 60, SPAWN_MAX = 150, DESPAWN = 190;
const COLORS = [0xb3202a, 0x1f4fa8, 0xe8e8e8, 0x1b1b1d, 0x8a8f96, 0xd9a21b, 0x2e6b3c, 0x5b2a86, 0xd8622a, 0x6fb7d9, 0xf0f0f0, 0x303a48];

const vfOf = (v) => Math.abs(v.vf);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// traffic mix
const pickModel = () => {
  const r = Math.random();
  return r < 0.11 ? 'van' : r < 0.2 ? 'bike' : r < 0.36 ? 'taxi' : r < 0.41 ? 'lux' : r < 0.45 ? 'super' : r < 0.62 ? 'coupe' : 'sedan';
};

export class Traffic {
  constructor(city, vehicles) {
    this.city = city;
    this.vehicles = vehicles;
    this.cars = [];
    this.spawnTimer = 0;
  }

  // light for traffic moving along an axis: 'go' | 'amber' | 'stop'
  light(axis) {
    const s = this.city.lightState;
    if (axis === 'z') return s === 0 ? 'go' : s === 1 ? 'amber' : 'stop';
    return s === 2 ? 'go' : s === 3 ? 'amber' : 'stop';
  }

  node(i, j) {
    return [this.city.roadC(i), this.city.roadC(j)];
  }

  inGrid(i, j) {
    return i >= 0 && j >= 0 && i <= this.city.N && j <= this.city.N;
  }

  // queue the lane points for the road from ai.from along ai.dir, then a turn at the far node
  extend(ai) {
    const { ROAD } = this.city;
    const [ai0, aj0] = ai.from;
    const [dx, dz] = ai.dir;
    const [bi, bj] = [ai0 + dx, aj0 + dz];
    const [ax, az] = this.node(ai0, aj0), [bx, bz] = this.node(bi, bj);
    const rx = -dz, rz = dx; // right-hand side of travel
    const axis = dx ? 'x' : 'z';
    const start = ROAD / 2 + 1, len = Math.hypot(bx - ax, bz - az) - start - (ROAD / 2 + 2.5);
    for (let t = 0; t <= len; t += 8) ai.points.push({ x: ax + dx * (start + t) + rx * LANE, z: az + dz * (start + t) + rz * LANE });
    ai.points.push({ x: bx - dx * (ROAD / 2 + 2.5) + rx * LANE, z: bz - dz * (ROAD / 2 + 2.5) + rz * LANE, stop: axis });

    // choose a way out of the intersection (no U-turns, stay on the map)
    const options = [[[dx, dz], 0.5], [[dz, -dx], 0.25], [[-dz, dx], 0.25]].filter(([[ex, ez]]) => this.inGrid(bi + ex, bj + ez));
    let r = Math.random() * options.reduce((s, o) => s + o[1], 0);
    let d2 = options[0][0];
    for (const [d, w] of options) if ((r -= w) <= 0) { d2 = d; break; }
    const [ex, ez] = d2, r2x = -ez, r2z = ex;
    const E = [bx - dx * (ROAD / 2) + rx * LANE, bz - dz * (ROAD / 2) + rz * LANE];
    const X = [bx + ex * (ROAD / 2) + r2x * LANE, bz + ez * (ROAD / 2) + r2z * LANE];
    const turning = ex !== dx || ez !== dz;
    const C = turning ? (dx ? [X[0], E[1]] : [E[0], X[1]]) : [(E[0] + X[0]) / 2, (E[1] + X[1]) / 2];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      ai.points.push({ x: u * u * E[0] + 2 * u * t * C[0] + t * t * X[0], z: u * u * E[1] + 2 * u * t * C[1] + t * t * X[1], turn: turning });
    }
    ai.from = [bi, bj];
    ai.dir = d2;
  }

  trySpawn(focus) {
    const { N } = this.city;
    for (let attempt = 0; attempt < 8; attempt++) {
      const vertical = Math.random() < 0.5;
      const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * N);
      const sgn = Math.random() < 0.5 ? 1 : -1;
      // segment between node (i, j) and (i, j+1) on a vertical road, or the transposed one
      let from = vertical ? [i, j] : [j, i];
      const dir = vertical ? [0, sgn] : [sgn, 0];
      if (sgn < 0) from = vertical ? [i, j + 1] : [j + 1, i];
      const ai = { from, dir, points: [], ctl: { throttle: 0, steer: 0, handbrake: false }, stuck: 0 };
      this.extend(ai);
      const p = ai.points[2];
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      if (this.vehicles.cars.some((c) => {
        const [x, z] = this.vehicles.pose(c);
        return Math.abs(x - p.x) < 12 && Math.abs(z - p.z) < 12;
      })) continue;
      ai.points.splice(0, 2);
      const model = pickModel();
      const c = this.vehicles.spawn({
        x: p.x, z: p.z, yaw: Math.atan2(dir[0], dir[1]),
        color: colorFor(model, COLORS[Math.floor(Math.random() * COLORS.length)]),
        model, ai,
      });
      c.vehicle.vel.set(dir[0] * CRUISE * 0.8, 0, dir[1] * CRUISE * 0.8);
      this.cars.push(c);
      return;
    }
  }

  update(dt, focus, people) {
    // cars with sirens on (patrols, the player's cruiser on a vigilante job)
    this.sirens = [];
    for (const c of this.vehicles.active) if (c.vehicle.siren && !c.wrecked) this.sirens.push(c.vehicle);
    // population control
    if ((this.spawnTimer -= dt) <= 0 && this.cars.length < MAX_CARS) {
      this.spawnTimer = 0.4;
      this.trySpawn(focus);
    }
    for (const c of [...this.cars]) {
      const v = c.vehicle;
      const far = !v || Math.hypot(v.pos.x - focus.x, v.pos.z - focus.z) > DESPAWN;
      if (!c.ai || far || (c.ai.stuck > 25 && Math.hypot(v.pos.x - focus.x, v.pos.z - focus.z) > 35)) {
        this.cars.splice(this.cars.indexOf(c), 1);
        if (c.ai && v) this.vehicles.remove(c);
        continue;
      }
      // hijacked or wrecked: hand the car over to the normal physics
      if (v.driven) {
        c.ai = null;
        this.cars.splice(this.cars.indexOf(c), 1);
        continue;
      }
      this.drive(c, dt, people);
    }
  }

  drive(c, dt, people) {
    const ai = c.ai, v = c.vehicle;
    while (ai.points.length < 10) this.extend(ai);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);

    // pop reached points (a stop point stays until its light is green or we're past it)
    while (ai.points.length) {
      const p = ai.points[0];
      const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
      const ahead = dx * fx + dz * fz;
      const reached = Math.hypot(dx, dz) < 3 || ahead < -0.5;
      if (!reached) break;
      if (p.stop && this.light(p.stop) !== 'go' && ahead > -0.5 && !(this.light(p.stop) === 'amber' && ahead < 6)) break;
      ai.points.shift();
    }

    let target = ai.halt ? 0 : CRUISE; // someone is going for the door
    // red light: brake to the stop point
    const stopIdx = ai.points.findIndex((p) => p.stop);
    if (stopIdx >= 0 && stopIdx < 4) {
      const p = ai.points[stopIdx];
      const ahead = (p.x - v.pos.x) * fx + (p.z - v.pos.z) * fz;
      const l = this.light(p.stop);
      if (l === 'stop' || (l === 'amber' && ahead > 6)) target = Math.min(target, Math.max(0, (ahead - 0.3) * 0.9));
    }
    // slow for corners
    if (ai.points.slice(0, 3).some((p) => p.turn)) target = Math.min(target, TURN_SPEED + 2);
    if (ai.points[0]?.turn) target = Math.min(target, TURN_SPEED);

    // keep a gap to cars and people ahead
    const rx = -fz, rz = fx;
    const gap = (x, z, width, keep) => {
      const dx = x - v.pos.x, dz = z - v.pos.z;
      const ahead = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (ahead > 0 && ahead < 24 && Math.abs(lat) < width) target = Math.min(target, Math.max(0, (ahead - keep) * 0.8));
    };
    let blocker = null;
    for (const o of this.vehicles.cars) {
      if (o === c || o === ai.dodging) continue;
      const [x, z] = this.vehicles.pose(o);
      if (Math.abs(x - v.pos.x) < 26 && Math.abs(z - v.pos.z) < 26) {
        const before = target;
        gap(x, z, 2.0, 5.5);
        // a car standing in the lane with nobody driving it (abandoned, wrecked, parked badly)
        if (target < before && !o.ai && !(o.vehicle?.speed > 0.5)) blocker = o;
      }
    }
    // wait a moment behind it, then pull out and go round
    ai.blockT = blocker && vfOf(v) < 1 ? (ai.blockT || 0) + dt : 0;
    if (blocker && ai.blockT > 2.5) ai.dodging = blocker;
    if (ai.dodging) {
      const [x, z] = this.vehicles.pose(ai.dodging);
      const ahead = (x - v.pos.x) * fx + (z - v.pos.z) * fz;
      if (ahead < -4 || ahead > 30 || !this.vehicles.cars.includes(ai.dodging)) ai.dodging = null;
    }
    for (const p of people) gap(p.x, p.z, 1.6, 3.5);

    // a siren coming up from behind: slow down and pull over to the right
    let pull = 0;
    for (const s of this.sirens) {
      if (s === v) continue;
      const dx = s.pos.x - v.pos.x, dz = s.pos.z - v.pos.z;
      const behind = -(dx * fx + dz * fz);
      if (behind > 0 && behind < 32 && Math.abs(dx * rx + dz * rz) < 5) pull = Math.max(pull, 1 - behind / 40);
    }
    if (pull > 0) target = Math.min(target, 3.5);
    // pure-pursuit steering toward the next lane point
    const p0 = ai.points[0];
    const p = ai.dodging && !p0.turn ? { x: p0.x - rx * 3.6, z: p0.z - rz * 3.6 }
      : pull > 0 && !p0.turn ? { x: p0.x + rx * 1.7 * pull, z: p0.z + rz * 1.7 * pull } : p0;
    if (ai.dodging) target = Math.min(target, 6);
    const desired = Math.atan2(p.x - v.pos.x, p.z - v.pos.z);
    const diff = wrap(desired - v.heading);
    const vf = v.vf;
    ai.ctl.steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
    let thr = THREE.MathUtils.clamp((target - vf) * 0.4, -1, 1);
    if (thr < 0 && vf < 0.6) thr = 0;
    ai.ctl.throttle = thr;
    ai.stuck = vf < 0.3 && target > 2 ? ai.stuck + dt : 0;
  }
}
