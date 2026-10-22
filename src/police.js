// Wanted level + police response.
//
// Crimes add heat; heat maps to 0-5 stars. While wanted, patrol cars (one per
// star, max 4) spawn out of sight and chase the player: straight at them when
// they can see them, otherwise along the road grid. Near a player on foot the
// officers get out and run after them. Staying out of every officer's sight
// for long enough clears the stars; being held still by officers = BUSTED.
import * as THREE from 'three';

const HEAT = { assault: 1, ko: 2, runover: 3, carjack: 2, theft: 1, shooting: 3, gunfire: 2, ram_cop: 3, assault_cop: 3, ko_cop: 6, runover_cop: 6 };
const STAR_AT = [1, 5, 11, 18, 28]; // heat needed for 1..5 stars
const SEE_RANGE = 70;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Wanted {
  constructor() {
    this.level = 0;
    this.heat = 0;
    this.unseen = 0;
    this.onChange = null;
  }

  // civilian crimes need a witness, crimes against officers never do
  // frozen: on a story mission ordinary offences don't raise the stars (force: the mission itself does)
  crime(type, force = false) {
    if (this.frozen && !force) return;
    this.heat += HEAT[type] || 1;
    let lvl = 0;
    STAR_AT.forEach((h, i) => {
      if (this.heat >= h) lvl = i + 1;
    });
    // any offence that is seen gives at least one star
    lvl = Math.max(lvl, 1);
    if (lvl > this.level) {
      this.level = lvl;
      this.onChange?.(this.level);
    }
    this.unseen = 0;
  }

  // the search period grows with the wanted level
  get searchTime() {
    return 6 + this.level * 3;
  }

  get flashing() {
    return this.level > 0 && this.unseen > 1.5;
  }

  update(dt, seen) {
    if (!this.level) return;
    if (seen) this.unseen = 0;
    else if ((this.unseen += dt) > this.searchTime) this.clear();
  }

  clear() {
    this.level = 0;
    this.heat = 0;
    this.unseen = 0;
    this.onChange?.(0);
  }
}

export class Police {
  constructor(city, vehicles, peds) {
    this.city = city;
    this.vehicles = vehicles;
    this.peds = peds;
    this.units = [];
    this.spawnTimer = 0;
    this.bust = 0;
    this.seen = false;
  }

  // ---------------------------------------------------------------- spawning
  spawnUnit(target) {
    const { N } = this.city;
    for (let attempt = 0; attempt < 12; attempt++) {
      const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1));
      const x = this.city.roadC(i), z = this.city.roadC(j);
      const d = Math.hypot(x - target.x, z - target.z);
      if (d < 70 || d > 150) continue;
      // not straight into view
      if (this.city.raycast(new THREE.Vector3(x, 1.2, z), new THREE.Vector3(target.x - x, 0, target.z - z).normalize(), d) >= d - 2) continue;
      if (this.vehicles.cars.some((c) => {
        const [cx, cz] = this.vehicles.pose(c);
        return Math.abs(cx - x) < 8 && Math.abs(cz - z) < 8;
      })) continue;
      const c = this.vehicles.spawn({
        x, z, yaw: Math.atan2(target.x - x, target.z - z), color: 0x111214, model: 'police',
        ai: { police: true, ctl: { throttle: 0, steer: 0, handbrake: false } },
      });
      c.vehicle.siren = true;
      this.units.push({ c, wp: null, stuck: 0, reverse: 0, officers: 0, leaving: false, life: 0 });
      return true;
    }
    return false;
  }

  clear() {
    for (const p of this.peds.cops) p.armed = false;
    for (const u of this.units) this.vehicles.remove(u.c);
    this.units = [];
    this.peds.standDown();
    this.bust = 0;
  }

  // ---------------------------------------------------------------- road-grid navigation
  nodeOf(x, z) {
    const { N, HALF, ROAD, PITCH } = this.city;
    const f = (v) => THREE.MathUtils.clamp(Math.round((v + HALF - ROAD / 2) / PITCH), 0, N);
    return [f(x), f(z)];
  }

  nodePos([i, j]) {
    return { x: this.city.roadC(i), z: this.city.roadC(j) };
  }

  visible(from, to, range = SEE_RANGE) {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d < 4) return true;
    return this.city.raycast(new THREE.Vector3(from.x, 1.3, from.z), new THREE.Vector3(dx / d, 0, dz / d), d) >= d - 1.5;
  }

  drive(u, dt, target, targetVel, onFoot) {
    const v = u.c.vehicle;
    const ctl = u.c.ai.ctl;
    const dx = target.x - v.pos.x, dz = target.z - v.pos.z, d = Math.hypot(dx, dz);
    let aim;
    if (u.leaving) {
      // drive off along the road away from the player
      aim = { x: v.pos.x + Math.sin(v.heading) * 30, z: v.pos.z + Math.cos(v.heading) * 30 };
    } else if (d < 28 || this.visible(v.pos, target, 90)) {
      // lead a moving target a little
      aim = { x: target.x + targetVel.x * Math.min(1.2, d / 25), z: target.z + targetVel.z * Math.min(1.2, d / 25) };
      u.wp = null;
    } else {
      const here = this.nodeOf(v.pos.x, v.pos.z), goal = this.nodeOf(target.x, target.z);
      if (!u.wp || Math.hypot(this.nodePos(u.wp).x - v.pos.x, this.nodePos(u.wp).z - v.pos.z) < 9) {
        // next node toward the goal along the grid (greedy is optimal on a full grid)
        const di = Math.sign(goal[0] - here[0]), dj = Math.sign(goal[1] - here[1]);
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const opts = [];
        if (di) opts.push([here[0] + di, here[1]]);
        if (dj) opts.push([here[0], here[1] + dj]);
        if (!opts.length) opts.push(here);
        // prefer the option we are already facing
        opts.sort((a, b) => {
          const pa = this.nodePos(a), pb = this.nodePos(b);
          return (pb.x - v.pos.x) * fx + (pb.z - v.pos.z) * fz - ((pa.x - v.pos.x) * fx + (pa.z - v.pos.z) * fz);
        });
        u.wp = opts[0];
      }
      aim = this.nodePos(u.wp);
    }

    const desired = Math.atan2(aim.x - v.pos.x, aim.z - v.pos.z);
    let diff = wrap(desired - v.heading);
    let target_speed = v.spec.vmax * 0.85;
    if (Math.abs(diff) > 0.5) target_speed = Math.min(target_speed, 12);
    if (Math.abs(diff) > 1.2) target_speed = 7;
    if (onFoot && !u.leaving) target_speed = Math.min(target_speed, Math.max(0, (d - 7) * 0.9));

    // unstick: reverse out with the opposite lock
    if (u.reverse > 0) {
      u.reverse -= dt;
      ctl.throttle = -1;
      ctl.steer = -Math.sign(diff || 1);
      ctl.handbrake = false;
      return;
    }
    if (target_speed > 3 && v.speed < 1) {
      if ((u.stuck += dt) > 1.3) {
        u.reverse = 1.1;
        u.stuck = 0;
      }
    } else u.stuck = 0;

    ctl.steer = THREE.MathUtils.clamp(diff * 2.2, -1, 1);
    const thr = THREE.MathUtils.clamp((target_speed - v.vf) * 0.35, -1, 1);
    ctl.throttle = thr < 0 && v.vf < 0.5 ? 0 : thr;
    ctl.handbrake = Math.abs(diff) > 1.4 && v.speed > 12;
  }

  // ---------------------------------------------------------------- update
  // returns 'busted' when the player has been arrested
  update(dt, wanted, player) {
    const pv = player.vehicle;
    const target = pv ? pv.pos : player.position;
    const targetVel = pv ? pv.vel : player.vel;
    const onFoot = !pv;

    // patrol cars
    const want = wanted.level ? Math.min(3, Math.ceil(wanted.level * 0.7)) : 0;
    const active = this.units.filter((u) => !u.leaving).length;
    if ((this.spawnTimer -= dt) <= 0 && active < want) {
      this.spawnTimer = 2.5;
      this.spawnUnit(target);
    }
    if (!wanted.level) for (const u of this.units) u.leaving = true;

    this.seen = false;
    for (const u of [...this.units]) {
      const v = u.c.vehicle;
      if (!v) {
        this.units.splice(this.units.indexOf(u), 1);
        continue;
      }
      u.life += dt;
      const d = Math.hypot(v.pos.x - target.x, v.pos.z - target.z);
      // player took the patrol car, or it drove off / fell too far behind
      if (v.driven || u.c.wrecked || d > 260 || (u.leaving && d > 110)) {
        if (v.driven || u.c.wrecked) {
          u.c.ai = null;
          v.siren = false;
        } else this.vehicles.remove(u.c);
        this.units.splice(this.units.indexOf(u), 1);
        continue;
      }
      v.siren = !u.leaving;
      this.drive(u, dt, target, targetVel, onFoot);
      if (!u.leaving && this.visible(v.pos, target)) this.seen = true;
      // officers step out when the car has stopped near a player on foot (or a stopped car)
      const maxOfficers = wanted.level >= 3 ? 2 : 1;
      if (!u.leaving && u.officers < maxOfficers && v.speed < 2 && d < 18 && (onFoot || pv.speed < 2)) {
        const side = u.officers ? -1 : 1;
        const rx = Math.cos(v.heading) * side, rz = -Math.sin(v.heading) * side;
        this.peds.spawnCop(v.pos.x + rx * 1.6, v.pos.z + rz * 1.6, v.heading);
        u.officers++;
        // the driver is the one who got out
        v.officersOut = true;
        this.peds.unseatDriver(v);
      }
    }

    // officers on foot: join the chase when wanted, report sightings, arrest
    let holding = false;
    for (const p of this.peds.cops) {
      const d = Math.hypot(p.x - target.x, p.z - target.z);
      if (wanted.level && p.state !== 'cop' && d < 45 && this.visible(p, target, 45)) p.state = 'cop';
      if (p.state !== 'cop') continue;
      // from three stars the officers draw their pistols
      p.armed = wanted.level >= 4;
      if (this.visible(p, target, 50)) this.seen = true;
      const reach = pv ? pv.spec.halfW + 1.4 : 1.25;
      const punching = player.overlay && player.overlay.name.startsWith('punch');
      if (d < reach && !punching && (!pv || pv.speed < 1.5)) holding = true;
    }
    // a patrol car boxing in a stopped player car also counts
    if (pv && pv.speed < 1.2) {
      for (const u of this.units) {
        const v = u.c.vehicle;
        if (!u.leaving && Math.hypot(v.pos.x - pv.pos.x, v.pos.z - pv.pos.z) < 5.5) holding = true;
      }
    }
    if (!wanted.level) holding = false;
    this.bust = holding ? this.bust + dt : Math.max(0, this.bust - dt * 0.6);
    if (this.bust > (pv ? 3.4 : 3.6)) {
      this.bust = 0;
      return 'busted';
    }
    return null;
  }

  // distance from the player to the nearest siren (for the audio)
  nearestSiren(pos) {
    let best = Infinity;
    for (const u of this.units) {
      const v = u.c.vehicle;
      if (v && v.siren) best = Math.min(best, Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z));
    }
    return best;
  }

  isPoliceCar(c) {
    return this.units.some((u) => u.c === c);
  }
}
