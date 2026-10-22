// Safehouses: a free flat in Little Havana, a Downtown loft and a South Beach villa to buy.
// Walk into the ring at the door: the game is saved there; E sleeps 8 hours (health back).
// Two marked parking bays at the kerb out front: a car left standing in a bay is kept, colour
// and Sol Customs upgrades included, and is back in its bay next time you play.
import * as THREE from 'three';
import { roadside, blockMin } from './shared/world.mjs';

export const SAFEHOUSES = [
  { id: 'havana', name: 'Little Havana flat', price: 0, block: [1, 7], t: 18 },
  { id: 'downtown', name: 'Downtown loft', price: 12000, block: [5, 3], t: 24 },
  { id: 'beach', name: 'South Beach villa', price: 30000, block: [8, 8], t: 22 },
];
const KEY = 'solcity.homes';
const BAY_R = 1.7; // how close to a bay's centre a parked car counts as in it

export class Safehouses {
  constructor({ scene, city, hud, audio, vehicles, player, env, wanted }) {
    Object.assign(this, { scene, city, hud, audio, vehicles, player, env, wanted });
    this.state = { owned: ['havana'], bays: {} };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.owned)) this.state = { owned: [...new Set(['havana', ...s.owned])], bays: s.bays || {} };
    } catch {}
    this.t = 0;
    this.checkT = 0;
    this.fadeEl = document.getElementById('fade');
    this.houses = SAFEHOUSES.map((h) => this.build(h));
    // the cars kept in the bays come back where they were left
    for (const h of this.houses) {
      if (!this.owns(h)) continue;
      h.bays.forEach((b, i) => {
        const rec = this.state.bays[`${h.id}:${i}`];
        if (rec) b.car = this.vehicles.spawn({ x: b.x, z: b.z, yaw: b.yaw, model: rec.model, color: rec.color, tune: rec.tune || undefined, owned: true, keep: true });
      });
    }
  }

  owns(h) {
    return this.state.owned.includes(h.id);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {}
  }

  build(h) {
    const [bi, bj] = h.block;
    const door = { x: blockMin(bi) + h.t, z: blockMin(bj) + 1.05 };
    const y = this.city.groundHeight(door.x, door.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(door.x, y + 0.04, door.z);
    ring.renderOrder = 2;
    this.scene.add(ring);
    // two parking bays at the kerb, white lines on the road; nothing else parks there
    const line = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const bays = [h.t + 3.5, h.t + 9.5].map((along) => {
      const p = roadside(bi, bj, along);
      for (const [w, d, ox, oz] of [[5.6, 0.12, 0, -1.15], [5.6, 0.12, 0, 1.15], [0.12, 2.42, -2.8, 0], [0.12, 2.42, 2.8, 0]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), line);
        m.position.set(p.x + ox, 0.02, p.z + oz);
        this.scene.add(m);
      }
      for (const c of [...this.vehicles.cars]) {
        if (c.keep || c.owned || c.vehicle || Math.abs(c.x - p.x) > 4 || Math.abs(c.z - p.z) > 2.5) continue;
        const batch = this.vehicles.batches[c.model];
        if (batch && batch.list.includes(c)) batch.list.splice(batch.list.indexOf(c), 1);
        this.vehicles.remove(c);
        this.vehicles.dirty = true;
      }
      return { ...p, car: null };
    });
    return { ...h, door, ring, bays };
  }

  blips() {
    return this.houses.map((h) => ({ x: h.door.x, z: h.door.z, color: this.owns(h) ? '#3aa0d8' : '#8a96a3', r: 6, icon: 'house', kind: 'home' }));
  }

  sleep() {
    this.busy = true;
    this.fadeEl.classList.add('show');
    setTimeout(() => {
      this.env.minutes = (this.env.minutes + 8 * 60) % 1440;
      this.player.health = 100;
      this.hud.setHealth(100);
      this.onSave?.();
      this.fadeEl.classList.remove('show');
      this.hud.say('You slept <em>8 hours</em>. Game saved.', 3);
      this.busy = false;
    }, 1200);
  }

  update(dt, input, driving) {
    this.t += dt;
    const P = this.player.position;
    for (const h of this.houses) {
      h.ring.material.opacity = 0.55 + 0.25 * Math.sin(this.t * 4);
      const inRing = !driving && !this.player.dead && Math.hypot(P.x - h.door.x, P.z - h.door.z) < 0.9;
      if (!inRing) {
        if (this.at === h) this.at = null;
        continue;
      }
      if (this.at !== h) {
        this.at = h;
        if (!this.owns(h)) this.hud.say(`<em>${h.name}</em> for sale: <em>$${h.price.toLocaleString('en-US')}</em>. Press <em>E</em> to buy.`, 4);
        else {
          this.onSave?.();
          this.hud.say(`<em>${h.name}</em>: game saved. Press <em>E</em> to sleep 8 hours.`, 4);
        }
      }
      if (!input.pressed('KeyE') || this.busy) continue;
      if (!this.owns(h)) {
        if (this.hud.money < h.price) {
          this.hud.say("You can't afford it yet.", 2.5);
          continue;
        }
        this.hud.addMoney(-h.price);
        this.state.owned.push(h.id);
        this.save();
        this.onSave?.();
        this.audio.cash();
        this.hud.say(`You bought the <em>${h.name}</em>! Save here, sleep here, and park in the bays out front to keep your cars.`, 5);
      } else if (this.wanted.level > 0) this.hud.say('Not with the cops on your tail.', 2.5);
      else this.sleep();
    }
    // the parking bays, twice a second
    if ((this.checkT -= dt) > 0) return;
    this.checkT = 0.5;
    let changed = false;
    for (const h of this.houses) {
      if (!this.owns(h)) continue;
      h.bays.forEach((b, i) => {
        const key = `${h.id}:${i}`;
        const here = this.vehicles.cars.find((c) => {
          const v = c.vehicle, x = v ? v.pos.x : c.x, z = v ? v.pos.z : c.z;
          return Math.hypot(x - b.x, z - b.z) < BAY_R && !c.ai && !c.wrecked && !(v && v.speed > 0.4) && driving !== c;
        });
        const rec = this.state.bays[key];
        if (here) {
          here.owned = here.keep = true;
          const now = { model: here.model, color: here.color, tune: here.tune || null };
          if (!rec || JSON.stringify(rec) !== JSON.stringify(now)) {
            this.state.bays[key] = now;
            changed = true;
            if (rec?.model !== now.model || here !== b.car) this.hud.say(`Car kept in your <em>${h.name}</em> bay.`, 2.5);
          }
          b.car = here;
        } else if (rec && (!b.car || !this.vehicles.cars.includes(b.car) || b.car.wrecked || Math.hypot((b.car.vehicle?.pos.x ?? b.car.x) - b.x, (b.car.vehicle?.pos.z ?? b.car.z) - b.z) > 3)) {
          // driven away (or wrecked): the bay is free again
          delete this.state.bays[key];
          if (b.car && !b.car.wrecked) b.car.keep = false;
          b.car = null;
          changed = true;
        }
      });
    }
    if (changed) this.save();
  }
}
