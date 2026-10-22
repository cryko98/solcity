// Pay 'n' Spray & Sol Customs (Little Havana): drive in and the roller door comes down.
//   - with the cops after you: a quick respray and repair, and the police lose you ($100)
//   - otherwise the Sol Customs menu: paint, engine, brakes, suspension, nitro, tinted
//     windows, rims, repair. Upgrades stay with the car (c.tune); garage it at a safehouse
//     to keep it. W drives back out.
import { RIMS } from './vehicles.js';

const COST = 100;
const PAINT = [0xb3202a, 0x1f4fa8, 0xe8e8e8, 0x1b1b1d, 0x2e6b3c, 0x5b2a86, 0xd8622a, 0x6fb7d9, 0xd9a21b, 0x8a8f96, 0xc8102e, 0x14213d, 0xf5c400, 0x7ad11f, 0xff6a13];
const LEVEL_PRICE = { engine: [1500, 3500, 7000], brakes: [800, 1800, 3600], grip: [1000, 2400, 4800] };
const LEVEL_NAME = { engine: 'Engine', brakes: 'Brakes', grip: 'Suspension' };
const NITRO_PRICE = 5000, TINT_PRICE = 400, RIM_PRICE = 300;
const RIM_ORDER = ['stock', 'chrome', 'black', 'gold'];

export class PaySpray {
  constructor({ city, hud, audio, wanted }) {
    Object.assign(this, { city, hud, audio, wanted });
    this.s = city.spray;
    this.state = 'open';
    this.t = 0;
    this.cool = 0;
    this.door = 0.03; // door scale: 0 rolled up, 1 shut
    this.el = document.getElementById('shop');
  }

  get busy() {
    return this.state === 'closing' || this.state === 'spraying' || this.state === 'menu';
  }

  // ---------------------------------------------------------------- Sol Customs menu
  items(c) {
    const t = c.tune || {}, v = c.vehicle;
    const out = [{ key: 'paint', label: 'Respray <small>(next colour)</small>', price: COST }];
    for (const k of ['engine', 'brakes', 'grip']) {
      const lv = t[k] || 0;
      out.push(lv >= 3 ? { key: k, label: `${LEVEL_NAME[k]} <small>(max)</small>`, price: null } : { key: k, label: `${LEVEL_NAME[k]} level ${lv + 1}`, price: LEVEL_PRICE[k][lv] });
    }
    out.push(v.spec.bike ? { key: 'nitro', label: 'Nitro <small>(cars only)</small>', price: null }
      : t.nitro ? { key: 'nitro', label: 'Nitro <small>(fitted: hold Shift)</small>', price: null } : { key: 'nitro', label: 'Nitro <small>(hold Shift)</small>', price: NITRO_PRICE });
    out.push({ key: 'tint', label: t.tint ? 'Clear windows' : 'Tinted windows', price: TINT_PRICE });
    const next = RIM_ORDER[(RIM_ORDER.indexOf(t.rims || 'stock') + 1) % RIM_ORDER.length];
    out.push({ key: 'rims', label: `Rims: ${next}`, price: RIM_PRICE });
    out.push(c.health < 100 ? { key: 'repair', label: 'Repair', price: COST } : { key: 'repair', label: 'Repair <small>(no damage)</small>', price: null });
    return out;
  }

  show(c) {
    const money = this.hud.money;
    this.el.style.borderLeftColor = '#e0407e';
    this.el.innerHTML = '<div class="s-title" style="color:#e0407e">SOL CUSTOMS</div>' + this.items(c).map((it, i) =>
      `<div class="s-row${it.price === null || money < it.price ? ' poor' : ''}"><kbd>${i + 1}</kbd><span>${it.label}</span><b>${it.price === null ? '-' : '$' + it.price}</b></div>`).join('') +
      '<div class="s-foot">W: drive out</div>';
    this.el.classList.add('show');
  }

  buy(c, i) {
    const it = this.items(c)[i];
    if (!it) return;
    if (it.price === null) return this.no('Nothing to do there.');
    if (this.hud.money < it.price) return this.no("You can't afford that.");
    const v = c.vehicle;
    c.tune = c.tune || {};
    if (it.key === 'paint') {
      let k = (PAINT.indexOf(c.color) + 1) % PAINT.length;
      if (PAINT[k] === c.color) k = (k + 1) % PAINT.length;
      v.repaint(PAINT[k]);
      this.audio.hiss(0.8);
    } else if (it.key === 'repair') {
      v.repair();
    } else if (it.key === 'nitro') {
      c.tune.nitro = true;
    } else if (it.key === 'tint') {
      c.tune.tint = !c.tune.tint;
    } else if (it.key === 'rims') {
      c.tune.rims = RIM_ORDER[(RIM_ORDER.indexOf(c.tune.rims || 'stock') + 1) % RIM_ORDER.length];
    } else c.tune[it.key] = (c.tune[it.key] || 0) + 1;
    v.applyTune();
    this.hud.addMoney(-it.price);
    this.audio.cash();
    this.hud.say(it.key === 'paint' ? 'Fresh paint.' : it.key === 'repair' ? 'Good as new.' : 'Fitted.', 1.5);
    this.show(c);
  }

  no(msg) {
    this.hud.say(msg, 2);
    this.audio.blip({ tone: 220, toneEnd: 180, dur: 0.15, gain: 0.25 });
  }

  closeMenu() {
    this.el.classList.remove('show');
    this.state = 'done';
    this.t = 0;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, driving, input) {
    if (!this.s) return;
    const v = driving?.vehicle;
    const inside = v && this.s.inside(v.pos.x, v.pos.z);
    this.cool -= dt;
    this.t += dt;
    let want = 0.03;
    if (this.state === 'open') {
      if (inside && v.speed < 2.5 && this.cool <= 0) {
        const hot = this.wanted.level > 0;
        if (hot && this.hud.money < COST) {
          this.hud.say(`No money, no spray. A respray is <em>$${COST}</em>.`, 3);
          this.cool = 6;
        } else {
          this.state = 'closing';
          this.t = 0;
          this.c = driving;
        }
      }
    } else if (this.state === 'closing') {
      want = 1;
      if (!inside) this.state = 'open';
      else if (this.t > 1.1) {
        this.t = 0;
        if (this.wanted.level > 0) {
          this.state = 'spraying';
          this.audio.hiss(1.6);
        } else {
          this.state = 'menu';
          this.show(this.c);
        }
      }
    } else if (this.state === 'menu') {
      want = 1;
      if (driving !== this.c) this.closeMenu();
      else {
        const n = this.items(this.c).length;
        for (let i = 0; i < n; i++) {
          const code = 'Digit' + (i + 1);
          if (input?.pressed(code)) {
            input.pressedOnce.delete(code);
            this.buy(this.c, i);
          }
        }
        // (not Enter: that gets you out of the car)
        if (input?.pressed('Backspace') || (this.t > 0.6 && input?.down('KeyW'))) this.closeMenu();
      }
    } else if (this.state === 'spraying') {
      want = 1;
      if (this.t > 1.8) {
        const c = this.c, car = c.vehicle;
        let color = c.color;
        while (color === c.color) color = PAINT[Math.floor(Math.random() * PAINT.length)];
        car.repaint(color);
        car.repair();
        const hot = this.wanted.level > 0;
        this.wanted.clear();
        this.hud.addMoney(-COST);
        this.audio.cash();
        this.hud.say(hot ? 'New paint job. The cops have lost you.' : 'Good as new. Fresh paint, engine fixed.', 3.5);
        this.state = 'done';
        this.t = 0;
      }
    } else if (this.state === 'done') {
      // wait for the car to leave before serving again
      if (!inside) {
        this.state = 'open';
        this.cool = 3;
      }
    }
    this.door += (want - this.door) * Math.min(1, dt * 3.2);
    this.s.door.scale.y = Math.max(0.03, this.door);
  }
}
