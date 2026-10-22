// Ammu-Nation: a gun counter on a Downtown sidewalk (G on the map). Walk up to the
// counter and buy with 1-4; guns you already own get a box of ammo instead.
import * as THREE from 'three';
import * as TX from './textures.js';

const ITEMS = [
  { key: 'pistol', name: 'Pistol', price: 150 },
  { key: 'smg', name: 'SMG', price: 450 },
  { key: 'shotgun', name: 'Shotgun', price: 600 },
  { key: 'armor', name: 'Body armor', price: 250 },
];

export class GunShop {
  constructor({ scene, city, hud, audio, weapons, player }) {
    Object.assign(this, { scene, city, hud, audio, weapons, player });
    const x0 = city.blockMin(4), z0 = city.blockMin(4);
    this.x = x0 + 21;
    this.z = z0 + 2.9;
    this.stand = { x: this.x, z: z0 + 1.3 };
    this.build();
    this.el = document.getElementById('shop');
    this.open = false;
  }

  build() {
    const g = new THREE.Group();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const red = std({ color: 0x8e1b1b, roughness: 0.6 });
    const dark = std({ color: 0x1c1d21, roughness: 0.7 });
    const wood = std({ color: 0x5a3b22, roughness: 0.8 });
    const steel = std({ color: 0x55585e, roughness: 0.4, metalness: 0.8 });
    const box = (m, w, h, d, x, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y + h / 2, z);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    box(dark, 3.2, 2.9, 0.15, 0, 0, 0.9); // back wall
    box(dark, 0.12, 2.9, 1.9, -1.55, 0, 0); // sides
    box(dark, 0.12, 2.9, 1.9, 1.55, 0, 0);
    box(red, 3.2, 1.05, 0.7, 0, 0, -0.55); // counter
    box(wood, 3.25, 0.06, 0.8, 0, 1.05, -0.55);
    box(red, 3.4, 0.12, 2.2, 0, 2.9, -0.1); // roof
    // guns on the wall rack
    for (let i = 0; i < 4; i++) {
      box(steel, 0.9, 0.08, 0.05, -0.9 + (i % 2) * 1.8 * 0.5 + (i > 1 ? 0.9 : 0), 1.5 + (i % 2) * 0.5, 0.8);
      box(wood, 0.25, 0.14, 0.05, -1.25 + (i % 2) * 0.9 + (i > 1 ? 0.9 : 0), 1.45 + (i % 2) * 0.5, 0.8);
    }
    const t = TX.sign('AMMU-NATION', '#ff4040');
    const sm = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.5 });
    this.signMat = sm;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.12), [dark, dark, dark, dark, sm, dark]);
    sign.position.set(0, 3.45, -0.6);
    sign.rotation.y = Math.PI;
    g.add(sign);
    // the counter faces the road (-Z)
    g.position.set(this.x, this.city.groundHeight(this.x, this.z), this.z);
    this.scene.add(g);
  }

  show() {
    const money = this.hud.money;
    this.el.innerHTML = '<div class="s-title">AMMU-NATION</div>' + ITEMS.map((it, i) => {
      const own = it.key !== 'armor' && this.weapons.inv[it.key];
      return `<div class="s-row${money < it.price ? ' poor' : ''}"><kbd>${i + 1}</kbd><span>${it.name}${own ? ' ammo' : ''}</span><b>$${own ? Math.round(it.price * 0.4) : it.price}</b></div>`;
    }).join('') + '<div class="s-foot">Walk away to leave</div>';
  }

  buy(i) {
    const it = ITEMS[i];
    const own = it.key !== 'armor' && this.weapons.inv[it.key];
    const price = own ? Math.round(it.price * 0.4) : it.price;
    if (this.hud.money < price) {
      this.hud.say("You can't afford that.", 2);
      this.audio.blip({ tone: 220, toneEnd: 180, dur: 0.15, gain: 0.25 });
      return;
    }
    if (it.key === 'armor') {
      if (this.player.armor >= 100) return this.hud.say('You already have full armor.', 2);
      this.player.armor = 100;
      this.hud.setArmor(100);
      this.audio.cash();
      this.hud.say('Body armor fitted.', 2);
    } else {
      this.weapons.give(it.key, true);
      this.weapons.equip(it.key);
    }
    this.hud.addMoney(-price);
    this.show();
  }

  // call before Weapons.update: the digit keys are eaten while the menu is open
  update(dt, input, onFoot) {
    const P = this.player.position;
    // the booth is solid
    const lx = P.x - this.x, lz = P.z - this.z;
    if (Math.abs(lx) < 1.75 && lz > -1.05 && lz < 1.1) {
      const outs = [[-1.75 - lx, 0], [1.75 - lx, 0], [0, -1.05 - lz]];
      outs.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
      P.x += outs[0][0];
      P.z += outs[0][1];
    }
    const near = onFoot && Math.hypot(P.x - this.stand.x, P.z - this.stand.z) < 2.2;
    if (near !== this.open) {
      this.open = near;
      this.el.classList.toggle('show', near);
      if (near) this.show();
    }
    if (!near) return;
    for (let i = 0; i < ITEMS.length; i++) {
      const code = 'Digit' + (i + 1);
      if (input.pressed(code)) {
        input.pressedOnce.delete(code);
        this.buy(i);
      }
    }
  }

  blip() {
    return { x: this.x, z: this.z, color: '#e04040', r: 6, label: 'G' };
  }
}
