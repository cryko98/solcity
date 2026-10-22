// Vigilante missions: in a police cruiser press T. A suspect car (red blip) tries to
// get away across the road grid; ram it until it gives up (the engine catches fire
// and the driver bails) or blow it up before the clock runs out. Each level the
// suspects are faster and the pay is better.
import * as THREE from 'three';
import { colorFor } from './vehicles.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const MODELS = ['sedan', 'coupe', 'van', 'lux', 'super'];

export class Vigilante {
  constructor({ city, vehicles, hud, audio }) {
    Object.assign(this, { city, vehicles, hud, audio });
    this.state = 'off';
    this.level = 0;
    this.suspect = null;
    this.hinted = null;
  }

  node(x, z) {
    const { N, HALF, ROAD, PITCH } = this.city;
    const f = (v) => THREE.MathUtils.clamp(Math.round((v + HALF - ROAD / 2) / PITCH), 0, N);
    return [f(x), f(z)];
  }

  pos([i, j]) {
    return { x: this.city.roadC(i), z: this.city.roadC(j) };
  }

  start(v) {
    this.vehicle = v;
    this.state = 'on';
    this.level = 0;
    v.siren = true;
    this.next();
  }

  stop(msg) {
    if (this.suspect && this.suspect.ai) {
      // the getaway car just drives off as a normal car
      this.suspect.ai = null;
    }
    if (this.vehicle) this.vehicle.siren = false;
    this.suspect = null;
    this.state = 'off';
    this.vehicle = null;
    this.hud.mission(null);
    this.hud.blips = [];
    if (msg) this.hud.say(msg, 3.5);
  }

  next() {
    this.level++;
    const v = this.vehicle;
    const { N } = this.city;
    for (let tries = 0; tries < 30; tries++) {
      const n = [Math.floor(Math.random() * (N + 1)), Math.floor(Math.random() * (N + 1))];
      const p = this.pos(n);
      const d = Math.hypot(p.x - v.pos.x, p.z - v.pos.z);
      if (d < 90 || d > 220) continue;
      if (this.vehicles.cars.some((c) => {
        const [x, z] = this.vehicles.pose(c);
        return Math.abs(x - p.x) < 8 && Math.abs(z - p.z) < 8;
      })) continue;
      const model = MODELS[Math.min(MODELS.length - 1, Math.floor(Math.random() * (2 + this.level)))];
      this.suspect = this.vehicles.spawn({
        x: p.x, z: p.z, yaw: Math.atan2(p.x - v.pos.x, p.z - v.pos.z), color: colorFor(model, 0x8a8f96), model,
        ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } },
      });
      this.wp = null;
      this.stuck = 0;
      this.reverse = 0;
      this.time = 90 + this.level * 5;
      this.hud.say(`Suspect level <em>${this.level}</em>: stop the getaway car (red blip). Ram it!`, 4);
      this.audio.blip({ tone: 700, toneEnd: 500, dur: 0.25, gain: 0.25 });
      return;
    }
  }

  // run away along the grid: at every intersection take the road that leads furthest from the cop
  drive(dt, chaser) {
    const c = this.suspect, v = c.vehicle, ctl = c.ai.ctl;
    const here = this.node(v.pos.x, v.pos.z);
    const hp = this.pos(here);
    if (!this.wp || Math.hypot(this.pos(this.wp).x - v.pos.x, this.pos(this.wp).z - v.pos.z) < 9) {
      const { N } = this.city;
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([a, b]) => [here[0] + a, here[1] + b])
        .filter(([i, j]) => i >= 0 && j >= 0 && i <= N && j <= N);
      const score = (n) => {
        const p = this.pos(n);
        const away = Math.hypot(p.x - chaser.x, p.z - chaser.z) - Math.hypot(hp.x - chaser.x, hp.z - chaser.z);
        const ahead = (p.x - v.pos.x) * Math.sin(v.heading) + (p.z - v.pos.z) * Math.cos(v.heading);
        return away + ahead * 0.4 + Math.random() * 25;
      };
      opts.sort((a, b) => score(b) - score(a));
      this.wp = opts[0];
    }
    const aim = this.pos(this.wp);
    const diff = wrap(Math.atan2(aim.x - v.pos.x, aim.z - v.pos.z) - v.heading);
    let target = Math.min(v.spec.vmax * 0.8, 18 + this.level * 3);
    if (Math.abs(diff) > 0.5) target = Math.min(target, 13);
    if (Math.abs(diff) > 1.2) target = 7;
    if (this.reverse > 0) {
      this.reverse -= dt;
      ctl.throttle = -1;
      ctl.steer = -Math.sign(diff || 1);
      ctl.handbrake = false;
      return;
    }
    if (v.speed < 1) {
      if ((this.stuck += dt) > 1.2) {
        this.reverse = 1;
        this.stuck = 0;
      }
    } else this.stuck = 0;
    ctl.steer = THREE.MathUtils.clamp(diff * 2.2, -1, 1);
    const thr = THREE.MathUtils.clamp((target - v.vf) * 0.35, -1, 1);
    ctl.throttle = thr < 0 && v.vf < 0.5 ? 0 : thr;
    ctl.handbrake = Math.abs(diff) > 1.4 && v.speed > 12;
  }

  update(dt, { driving, input, dead }) {
    const v = driving?.vehicle;
    const inCruiser = v && driving.model === 'police' && !driving.wrecked;
    if (this.state === 'off') {
      if (inCruiser && this.hinted !== driving) {
        this.hinted = driving;
        this.hud.say('Press <em>T</em> for vigilante missions.', 4);
      }
      if (!inCruiser) this.hinted = null;
      if (inCruiser && input.pressed('KeyT')) this.start(v);
      return;
    }
    if (v !== this.vehicle || dead || driving.wrecked) return this.stop('Vigilante mission over.');
    if (input.pressed('KeyT')) return this.stop('Vigilante mission over.');

    const c = this.suspect;
    if (!c || !this.vehicles.cars.includes(c)) return this.next();
    const sv = c.vehicle;
    // stopped: on fire (the driver bails) or blown up
    if (c.burning || c.wrecked || c.health <= 30 || !c.ai) {
      const pay = 150 + this.level * 100;
      this.onStopped?.();
      this.hud.addMoney(pay);
      this.audio.cash();
      this.hud.say(`Suspect stopped! <em>+$${pay}</em>`, 3);
      if (c.ai) {
        // the shaken driver gives up and the car rolls to a stop
        c.ai = null;
      }
      this.suspect = null;
      return this.next();
    }
    this.time -= dt;
    if (this.time <= 0) return this.stop('The suspect got away.');
    if (sv) {
      this.drive(dt, v.pos);
      this.hud.blips = [{ x: sv.pos.x, z: sv.pos.z, color: '#ff3b3b' }];
      // too far away: lost him
      if (Math.hypot(sv.pos.x - v.pos.x, sv.pos.z - v.pos.z) > 420) return this.stop('The suspect got away.');
    }
    this.hud.mission({
      title: 'VIGILANTE',
      time: this.time,
      rows: [['LEVEL', this.level], ['SUSPECT CAR', `${Math.max(0, Math.round(((c.health - 30) / 70) * 100))}%`]],
    });
  }
}
