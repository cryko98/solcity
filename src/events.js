// Random street events: every couple of minutes, somewhere near you, something happens.
//   snatch    a thief grabs a woman's bag and runs: knock him down, the bag (and a reward) is yours
//   getaway   a car tears off from a robbery: stop it (ram it, shoot the engine)
//   breakdown a car broken down by the kerb, its owner waving: E to fix it
//   mugging   a mugger is beating someone up: deal with him
// Each shows a red (or yellow) blip and pays a little. Nothing starts during a mission, race or job.
import * as THREE from 'three';
import { Vigilante } from './vigilante.js';

const EVERY = [70, 130]; // seconds between events
const LOOK = 160; // give up when you're this far away

export class StreetEvents {
  constructor({ city, peds, vehicles, hud, audio, player, fx }) {
    Object.assign(this, { city, peds, vehicles, hud, audio, player, fx });
    this.timer = 40;
    this.ev = null;
  }

  get active() {
    return !!this.ev;
  }

  blips() {
    const e = this.ev;
    if (!e) return [];
    const p = e.at();
    return p ? [{ x: p.x, z: p.z, color: e.color, r: 5, kind: 'event' }] : [];
  }

  // a pavement point at 40-90 m, in front of the player if possible
  spot(min = 40, max = 90) {
    const P = this.player.position, { N, BLOCK } = this.city;
    for (let k = 0; k < 30; k++) {
      const bi = Math.floor(Math.random() * N), bj = Math.floor(Math.random() * N);
      const x = this.city.blockMin(bi) + 6 + Math.random() * (BLOCK - 12), z = this.city.blockMin(bj) + 1.6;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d > min && d < max) return { x, z, bi, bj };
    }
    return null;
  }

  update(dt, { busy, driving, input }) {
    this.input = input;
    if (this.ev) return this.tick(dt, driving);
    if (busy || this.player.dead || this.player.busted) return;
    if ((this.timer -= dt) > 0) return;
    this.timer = EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]);
    const kinds = ['snatch', 'getaway', 'breakdown', 'mugging'];
    this.start(kinds[Math.floor(Math.random() * kinds.length)]);
  }

  start(kind) {
    const ped = this.peds, s = this.spot();
    if (!s) return;
    const e = { kind, t: 0, color: '#ff3b3b', keep: [] };
    const hold = (p) => {
      p.keep = true;
      e.keep.push(p);
      return p;
    };
    if (kind === 'snatch') {
      const victim = hold(ped.add('female', s.x, s.z, 0));
      const thief = hold(ped.add('male', s.x + 1.2, s.z, Math.PI));
      thief.state = 'flee';
      thief.timer = 999;
      thief.fleeFrom = { x: s.x, z: s.z };
      victim.state = 'contact';
      Object.assign(e, { victim, thief, at: () => thief });
      this.hud.say('<em>"Stop, thief! He took my bag!"</em> Catch the purse snatcher (red blip).', 4);
    } else if (kind === 'getaway') {
      const P = this.player.position;
      let car = null;
      for (let k = 0; k < 30 && !car; k++) {
        const n = [Math.floor(Math.random() * (this.city.N + 1)), Math.floor(Math.random() * (this.city.N + 1))];
        const x = this.city.roadC(n[0]), z = this.city.roadC(n[1]), d = Math.hypot(x - P.x, z - P.z);
        if (d < 60 || d > 140) continue;
        car = this.vehicles.spawn({ x, z, yaw: Math.random() * 6.28, color: 0x2a2d33, model: 'sedan', keep: true, ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } } });
      }
      if (!car) return;
      const chase = Object.assign(Object.create(Vigilante.prototype), { city: this.city, vehicles: this.vehicles, hud: this.hud, audio: this.audio, level: 1, wp: null, stuck: 0, reverse: 0, suspect: car });
      Object.assign(e, { car, chase, at: () => (car.vehicle ? car.vehicle.pos : car) });
      this.hud.say('Radio: <em>robbery suspects fleeing in a dark sedan</em>. Stop them (red blip).', 4);
    } else if (kind === 'breakdown') {
      const x = s.x, z = this.city.blockMin(s.bj) - 1.15;
      const car = this.vehicles.spawn({ x, z, yaw: Math.PI / 2, color: 0x8a8f96, model: Math.random() < 0.5 ? 'sedan' : 'van', keep: true });
      car.health = 45; // smoking
      const owner = hold(ped.add(Math.random() < 0.5 ? 'male' : 'female', x, z + 2.4, Math.PI));
      owner.state = 'contact';
      Object.assign(e, { car, owner, fix: 0, color: '#ffd23f', at: () => owner });
      this.hud.say('Someone has broken down nearby (yellow blip). Walk up and press <em>E</em> to help.', 4);
    } else if (kind === 'mugging') {
      const victim = hold(ped.add('male', s.x, s.z, 0));
      const mugger = hold(ped.add('male', s.x + 0.9, s.z, -Math.PI / 2));
      ped.knockOut(victim, 0, 0, false);
      mugger.state = 'contact';
      mugger.hostile = true;
      Object.assign(e, { victim, mugger, at: () => mugger });
      this.hud.say('Someone is getting <em>mugged</em> nearby (red blip). Stop him!', 4);
    }
    this.ev = e;
  }

  end(msg, pay = 0) {
    const e = this.ev;
    this.ev = null;
    for (const p of e.keep) {
      p.keep = false;
      p.hostile = false;
      if (p.state === 'contact' && this.peds.list.includes(p)) this.peds.rejoin(p); // back to walking
    }
    if (e.car) {
      e.car.keep = false;
      if (e.car.ai) e.car.ai = null;
    }
    if (pay) {
      this.hud.addMoney(pay);
      this.audio.cash();
    }
    if (msg) this.hud.say(msg, 3.5);
  }

  tick(dt, driving) {
    const e = this.ev, P = this.player.position, me = driving ? driving.vehicle.pos : P;
    e.t += dt;
    if (this.player.dead || this.player.busted) return this.end(null);
    const at = e.at(), far = at && Math.hypot(at.x - me.x, at.z - me.z) > LOOK;
    if (e.kind === 'snatch') {
      const th = e.thief;
      if (th.state === 'down') {
        th.cashPending = false;
        return this.end('You got the bag back. <em>"Thank you so much!"</em> +$200', 200);
      }
      th.state = 'flee';
      th.timer = 999;
      th.fleeFrom = { x: me.x, z: me.z }; // runs from you
      if (e.t > 60 || far || !this.peds.list.includes(th)) return this.end('The thief got away.');
    } else if (e.kind === 'getaway') {
      const c = e.car;
      if (c.burning || c.wrecked || c.health <= 30 || !c.ai) {
        c.ai = null;
        return this.end("Suspects stopped. <em>Citizen's arrest!</em> +$400", 400);
      }
      e.chase.drive(dt, me);
      if (e.t > 120 || far) return this.end('The getaway car escaped.');
    } else if (e.kind === 'breakdown') {
      const o = e.owner;
      o.yaw = Math.atan2(P.x - o.x, P.z - o.z);
      const close = !driving && Math.hypot(P.x - o.x, P.z - o.z) < 3;
      if (close && !e.asked) {
        e.asked = true;
        this.hud.say('<em>"It just died on me!"</em> Hold <em>E</em> to fix it.', 3);
      }
      if (close && this.input?.down('KeyE')) e.fix += dt;
      if (e.fix > 2.2) {
        e.car.vehicle?.repair();
        e.car.health = 100;
        return this.end('Fixed. <em>"You’re a life saver!"</em> +$150', 150);
      }
      if (e.t > 150 || far) return this.end(null);
    } else if (e.kind === 'mugging') {
      const m = e.mugger, d = Math.hypot(P.x - m.x, P.z - m.z);
      if (m.state === 'down') {
        e.victim.getUpAt = e.victim.timer + 0.5;
        return this.end('You stopped the mugger. <em>+$250</em>', 250);
      }
      if (!driving && d < 14 && m.state !== 'fight') {
        m.state = 'fight';
        m.attackTimer = 0.4;
      }
      if (m.state === 'walk') m.state = 'contact'; // lost you: back over his victim
      if (m.state !== 'fight') m.yaw = Math.atan2(e.victim.x - m.x, e.victim.z - m.z);
      if (e.t > 90 || far) return this.end('The mugger got away.');
    }
  }
}
