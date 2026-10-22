// Pay 'n' Spray (Little Havana): drive in, the roller door comes down, and the car
// rolls out repaired in a new colour while the police lose track of you. $100.
const COST = 100;
const PAINT = [0xb3202a, 0x1f4fa8, 0xe8e8e8, 0x1b1b1d, 0x2e6b3c, 0x5b2a86, 0xd8622a, 0x6fb7d9, 0xd9a21b, 0x8a8f96, 0xc8102e, 0x14213d];

export class PaySpray {
  constructor({ city, hud, audio, wanted }) {
    Object.assign(this, { city, hud, audio, wanted });
    this.s = city.spray;
    this.state = 'open';
    this.t = 0;
    this.cool = 0;
    this.door = 0.03; // door scale: 0 rolled up, 1 shut
  }

  get busy() {
    return this.state === 'closing' || this.state === 'spraying';
  }

  update(dt, driving) {
    if (!this.s) return;
    const v = driving?.vehicle;
    const inside = v && this.s.inside(v.pos.x, v.pos.z);
    this.cool -= dt;
    this.t += dt;
    let want = 0.03;
    if (this.state === 'open') {
      if (inside && v.speed < 2.5 && this.cool <= 0) {
        if (this.hud.money < COST) {
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
        this.state = 'spraying';
        this.t = 0;
        this.audio.hiss(1.6);
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
