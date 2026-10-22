// Firearms: pistol, SMG, pump shotgun.
// The guns are modelled in Blender as rigid children of the hero's right hand bone
// (Weapon_Pistol / Weapon_SMG / Weapon_Shotgun, with Muzzle_* empties); the matching
// hold/aim poses are layered on the upper body by the Player. This module owns the
// inventory, aiming, firing (hit-scan with tracers, muzzle flash, impacts), damage,
// armed police, and weapon pickups around the city.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: { name: 'Pistol', node: 'Weapon_Pistol', muzzle: 'Muzzle_Pistol', clip: 'pistol', auto: false, rate: 0.2, dmg: 3, mag: 12, start: 48, spread: 0.008, pellets: 1, range: 120, kick: 0.035, reload: 1.3 },
  smg: { name: 'SMG', node: 'Weapon_SMG', muzzle: 'Muzzle_SMG', clip: 'smg', auto: true, rate: 0.075, dmg: 2, mag: 30, start: 120, spread: 0.025, pellets: 1, range: 100, kick: 0.018, reload: 1.8 },
  shotgun: { name: 'Shotgun', node: 'Weapon_Shotgun', muzzle: 'Muzzle_Shotgun', clip: 'shotgun', auto: false, rate: 0.85, dmg: 2, mag: 6, start: 24, spread: 0.075, pellets: 8, range: 40, kick: 0.09, reload: 2.4 },
};
const ORDER = [null, 'pistol', 'smg', 'shotgun'];
const PICKUP_COLOR = { health: '#ff5a5a', armor: '#4b9fff' };
const PED_R = 0.38, PED_H = 1.8;

// slab test: ray vs vertical cylinder (x, z, r) between y0 and y1; returns t or Infinity
function rayCylinder(o, d, x, z, r, y0, y1) {
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return Infinity;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return Infinity;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : Infinity;
}

export class Weapons {
  constructor({ scene, city, player, peds, vehicles, hud, audio, camera, follow, heroScene }) {
    Object.assign(this, { scene, city, player, peds, vehicles, hud, audio, camera, follow });
    this.inv = {}; // key -> { mag, reserve }
    this.current = null;
    this.cool = 0;
    this.reloading = 0;
    this.aiming = false;
    this.readyT = 0; // hip fire: the hero squares up to the camera for a moment
    this.queued = 0; // a shot waiting for the hero to turn round
    this.onShot = null; // (pos) => void  (gunfire is a crime when heard)
    this.makeFx();
    this.makePickups(heroScene);
    // start with bare fists; the pistol is in the pocket (key 2)
    this.inv.pistol = { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.start - WEAPONS.pistol.mag };
    this.equip(null);
  }

  // ---------------------------------------------------------------- effects
  makeFx() {
    const flashTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,230,1)');
      gr.addColorStop(0.25, 'rgba(255,200,90,.9)');
      gr.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb050, 0, 9, 2);
    this.scene.add(this.flash, this.flashLight);
    this.fx = []; // { obj, life, max, kind }
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1).translate(0, 0, 0.5);
    this.sparkMat = new THREE.SpriteMaterial({ map: flashTex, color: 0xffd070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.bloodMat = new THREE.SpriteMaterial({ color: 0x8a0d0d, transparent: true, depthWrite: false, opacity: 0.85 });
    this.flashT = 0;
  }

  spawnFx(obj, life, kind) {
    this.scene.add(obj);
    this.fx.push({ obj, life, max: life, kind });
  }

  tracer(from, to) {
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this.spawnFx(m, 0.06, 'tracer');
  }

  impact(at, blood) {
    const s = new THREE.Sprite(blood ? this.bloodMat.clone() : this.sparkMat.clone());
    s.position.copy(at);
    s.scale.setScalar(blood ? 0.35 : 0.25);
    this.spawnFx(s, blood ? 0.35 : 0.12, blood ? 'blood' : 'spark');
  }

  muzzleFlash(at, size = 0.45) {
    this.flash.position.copy(at);
    this.flash.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    this.flash.material.rotation = Math.random() * 6.28;
    this.flash.visible = true;
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 25;
    this.flashT = 0.045;
  }

  // ---------------------------------------------------------------- pickups
  makePickups(heroScene) {
    this.pickups = [];
    const spots = [];
    const { N, BLOCK } = this.city;
    // two spots per district-ish: sidewalks at random blocks, deterministic per session
    const keys = ['pistol', 'pistol', 'smg', 'shotgun', 'pistol', 'smg', 'shotgun', 'pistol', 'smg', 'pistol'];
    for (let k = 0; k < keys.length; k++) {
      // (k / N) keeps the 9th and 10th pickup off the blocks of the 1st and 2nd
      const bi = (k * 3 + 1) % N, bj = (k * 5 + 2 + Math.floor(k / N)) % N;
      const x0 = this.city.blockMin(bi), z0 = this.city.blockMin(bj);
      spots.push({ key: keys[k], x: x0 + BLOCK * 0.5 + (k % 2 ? 7 : -7), z: z0 + 2.2 });
    }
    for (let k = 0; k < 10; k++) {
      const bi = (k * 5 + 3) % N, bj = (k * 3 + 1 + Math.floor(k / N)) % N;
      const x0 = this.city.blockMin(bi), z0 = this.city.blockMin(bj);
      spots.push({ key: k % 2 ? 'armor' : 'health', x: x0 + BLOCK * 0.5 + (k % 3 - 1) * 9, z: z0 + BLOCK - 2.2 });
    }
    for (const s of spots) {
      if (!WEAPONS[s.key]) {
        const vis = s.key === 'health' ? this.healthModel() : this.armorModel();
        const g = new THREE.Group();
        g.add(vis);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: PICKUP_COLOR[s.key], transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
        ring.position.y = -0.85;
        g.add(ring);
        g.position.set(s.x, this.city.groundHeight(s.x, s.z) + 0.95, s.z);
        this.scene.add(g);
        this.pickups.push({ ...s, g, vis, respawn: 0 });
        continue;
      }
      const src = heroScene.getObjectByName(WEAPONS[s.key].node);
      let vis;
      if (src) {
        vis = src.clone(true);
        vis.position.set(0, 0, 0);
        vis.quaternion.identity();
        vis.scale.setScalar(1.6);
        vis.visible = true;
        vis.traverse((o) => (o.visible = true));
      } else {
        vis = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      }
      const g = new THREE.Group();
      g.add(vis);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x7ad65b, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.position.y = -0.85;
      g.add(ring);
      g.position.set(s.x, this.city.groundHeight(s.x, s.z) + 0.95, s.z);
      this.scene.add(g);
      this.pickups.push({ ...s, g, vis, respawn: 0 });
    }
  }

  // first-aid box: white case with a red cross
  healthModel() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd8262b, roughness: 0.4, emissive: 0x500000 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.2), white));
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.22), red);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.22), red);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    handle.position.y = 0.18;
    g.add(h, v, handle);
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  // body armour vest
  armorModel() {
    const g = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ color: 0x24406e, roughness: 0.75 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.16), blue);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), strap);
    neck.rotation.x = Math.PI / 2;
    neck.position.y = 0.22;
    neck.scale.set(1, 1.2, 1);
    for (const sx of [-0.17, 0.17]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.17), blue);
      sh.position.set(sx, 0.29, 0);
      g.add(sh);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.18), strap);
    band.position.y = -0.12;
    g.add(body, neck, band);
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  // health / armour: only taken when it's needed
  takeItem(key) {
    const P = this.player;
    if (key === 'health') {
      if (P.health >= 100) return false;
      P.health = 100;
      this.hud.setHealth(100);
      this.hud.say('Health restored.', 2);
    } else {
      if (P.armor >= 100) return false;
      P.armor = 100;
      this.hud.setArmor(100);
      this.hud.say('Body armor.', 2);
    }
    this.audio.cash();
    return true;
  }

  give(key, bought = false) {
    const w = WEAPONS[key];
    const had = !!this.inv[key];
    if (!had) this.inv[key] = { mag: w.mag, reserve: w.start - w.mag };
    else this.inv[key].reserve += w.start;
    this.hud.say(had ? `${w.name} ammo +${w.start}` : `${bought ? "Bought" : "Picked up"} a <em>${w.name}</em>. Press <em>${ORDER.indexOf(key) + 1}</em> or <em>Q</em> to equip, right mouse to aim.`, 3.5);
    this.audio.cash();
    if (!had && !this.current) this.equip(key);
    this.updateHud();
  }

  // ---------------------------------------------------------------- inventory
  equip(key) {
    if (key && !this.inv[key]) return;
    this.current = key;
    this.reloading = 0;
    this.player.setWeapon(key ? WEAPONS[key] : null);
    this.updateHud();
  }

  cycle() {
    const owned = ORDER.filter((k) => k === null || this.inv[k]);
    const i = owned.indexOf(this.current);
    this.equip(owned[(i + 1) % owned.length]);
  }

  reload() {
    const w = WEAPONS[this.current], s = this.inv[this.current];
    if (!w || this.reloading > 0 || s.mag >= w.mag || s.reserve <= 0) return;
    this.reloading = w.reload;
    this.audio.blip({ noise: 0.6, cutoff: 1800, dur: 0.08, gain: 0.3 });
  }

  updateHud() {
    const el = document.getElementById('weapon');
    if (!el) return;
    const w = WEAPONS[this.current];
    if (!w) {
      el.innerHTML = '<span class="w-name">FISTS</span>';
      return;
    }
    const s = this.inv[this.current];
    el.innerHTML = `<span class="w-name">${w.name.toUpperCase()}</span><span class="w-ammo">${this.reloading > 0 ? 'RELOADING' : `${s.mag}<small> / ${s.reserve}</small>`}</span>`;
  }

  // ---------------------------------------------------------------- shooting
  muzzleWorld(obj, key) {
    const m = obj.getObjectByName(WEAPONS[key].muzzle);
    const v = new THREE.Vector3();
    if (m) m.getWorldPosition(v);
    else obj.getObjectByName('hand.R')?.getWorldPosition(v);
    return v;
  }

  // nearest hit along a ray: { t, ped?, car?, wall? }
  trace(o, d, range, ignore) {
    let best = { t: range };
    for (const p of this.peds.list) {
      if (p === ignore || p.state === 'riding' || p.state === 'down' || p.invulnerable) continue;
      if (Math.abs(p.x - o.x) > range || Math.abs(p.z - o.z) > range) continue;
      const t = rayCylinder(o, d, p.x, p.z, PED_R, p.y, p.y + PED_H);
      if (t < best.t) best = { t, ped: p };
    }
    for (const c of this.vehicles.cars) {
      const [x, z, h] = this.vehicles.pose(c);
      if (Math.abs(x - o.x) > range || Math.abs(z - o.z) > range) continue;
      if (this.player.vehicle && c.vehicle === this.player.vehicle) continue;
      const fx = Math.sin(h), fz = Math.cos(h);
      const sp = this.vehicles.specOf ? this.vehicles.specOf(c) : null;
      for (const off of (c.vehicle ? c.vehicle.spec.circles : [-1.4, 0, 1.4])) {
        const t = rayCylinder(o, d, x + fx * off, z + fz * off, 0.95, 0, 1.4);
        if (t < best.t) best = { t, car: c };
      }
    }
    if (this.heli) {
      const th = this.heli.rayHit(o, d);
      if (th < best.t) best = { t: th, heli: true };
    }
    const tw = this.city.raycast(o, d, best.t);
    if (tw < best.t) best = { t: tw, wall: true };
    // the ground
    if (d.y < -1e-4) {
      const tg = (this.city.groundHeight(o.x, o.z) + 0.02 - o.y) / d.y;
      if (tg > 0 && tg < best.t) best = { t: tg, ground: true };
    }
    return best;
  }

  // can a shot from o reach this person without a wall in between?
  clear(o, p) {
    const to = new THREE.Vector3(p.x, p.y + 1.25, p.z).sub(o), d = to.length();
    return this.city.raycast(o, to.normalize(), d) >= d - 0.5;
  }

  // the person nearest the crosshair within maxAngle (radians), hostile ones first
  crossTarget(maxAngle, range) {
    const cam = this.camera.position, cd = new THREE.Vector3();
    this.camera.getWorldDirection(cd);
    let best = null, bs = Infinity;
    for (const p of this.peds.list) {
      if (p.state === 'down' || p.state === 'riding' || p.invulnerable || p.state === 'seated' && p.keep) continue;
      const v = new THREE.Vector3(p.x - cam.x, p.y + 1.25 - cam.y, p.z - cam.z), d = v.length();
      if (d > range || d < 1) continue;
      const ang = v.angleTo(cd);
      if (ang > maxAngle) continue;
      const hostile = p.hostile || p.state === 'fight' || p.state === 'cop';
      const score = ang * (hostile ? 0.5 : 1) + d * 0.002;
      if (score < bs && this.clear(cam, p)) {
        bs = score;
        best = p;
      }
    }
    return best;
  }

  // right mouse pressed: swing the view onto whoever is close to the crosshair (assisted aim)
  lockOn() {
    const w = WEAPONS[this.current], t = this.crossTarget(0.3, Math.min(w.range, 45));
    if (!t) return;
    const cam = this.camera.position, dx = t.x - cam.x, dz = t.z - cam.z, dy = t.y + 1.3 - cam.y;
    this.follow.assistTo(Math.atan2(dx, dz), Math.atan2(-dy, Math.hypot(dx, dz)));
  }

  aimDirection(muzzle, w) {
    const P = this.player;
    if (this.aiming || this.readyT > 0) {
      // a little magnetism: a shot that just grazes someone hits them (more when firing from the hip)
      const t = this.crossTarget(this.aiming ? 0.035 : 0.1, w.range);
      if (t) return new THREE.Vector3(t.x - muzzle.x, t.y + 1.25 - muzzle.y, t.z - muzzle.z).normalize();
      // through the crosshair: from the camera, then from the muzzle to whatever the camera ray hits
      const cd = new THREE.Vector3();
      this.camera.getWorldDirection(cd);
      const hit = this.trace(this.camera.position.clone().addScaledVector(cd, 1.5), cd, w.range);
      const aimPt = this.camera.position.clone().addScaledVector(cd, 1.5 + hit.t);
      return aimPt.sub(muzzle).normalize();
    }
    return new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  }

  fire() {
    const key = this.current, w = WEAPONS[key], s = this.inv[key];
    if (this.cool > 0 || this.reloading > 0) return;
    if (s.mag <= 0) {
      this.audio.blip({ tone: 900, toneEnd: 900, dur: 0.03, gain: 0.15 });
      this.cool = 0.25;
      this.reload();
      return;
    }
    s.mag--;
    this.cool = w.rate;
    const muzzle = this.muzzleWorld(this.player.model, key);
    const base = this.aimDirection(muzzle, w);
    for (let i = 0; i < w.pellets; i++) {
      const d = base.clone();
      d.x += (Math.random() - 0.5) * w.spread * 2;
      d.y += (Math.random() - 0.5) * w.spread * 2;
      d.z += (Math.random() - 0.5) * w.spread * 2;
      d.normalize();
      const hit = this.trace(muzzle, d, w.range);
      const at = muzzle.clone().addScaledVector(d, hit.t);
      if (i === 0 || Math.random() < 0.35) this.tracer(muzzle, at);
      if (hit.ped) {
        this.impact(at, true);
        this.hitMark();
        const wasUp = hit.ped.state !== 'down';
        this.peds.shot(hit.ped, w.dmg, d);
        if (wasUp && hit.ped.state === 'down') {
          const p = hit.ped;
          setTimeout(() => this.worldFx?.bloodPool(p.x, p.z), 900);
        }
      } else if (hit.t < w.range) {
        this.impact(at, false);
        if (hit.heli) {
          this.heli.damage(w.dmg * 3);
          this.worldFx?.sparks(at, 4, d.clone().negate());
        } else if (hit.car) {
          const v = this.vehicles.activate(hit.car);
          v.vel.addScaledVector(new THREE.Vector3(d.x, 0, d.z), 0.15);
          v.damage(w.dmg * 2);
          this.worldFx?.sparks(at, 3, d.clone().negate());
        } else this.worldFx?.dust(at, key === 'shotgun' ? 1 : 3);
      }
    }
    this.muzzleFlash(muzzle, key === 'shotgun' ? 0.7 : 0.45);
    this.worldFx?.muzzleSmoke(muzzle);
    this.audio.gunshot(key);
    this.player.recoil(w.kick);
    this.follow.kick(w.kick * 0.6);
    this.onShot?.(this.player.position);
    if (s.mag === 0 && s.reserve > 0) this.reload();
    this.updateHud();
  }

  hitMark() {
    const el = document.getElementById('crosshair');
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  // an armed officer fires at the player: visible tracer, 35% chance to hit
  copFire(p) {
    const P = this.player;
    const target = P.vehicle ? P.vehicle.pos.clone().setY(1.0) : P.position.clone().setY(P.position.y + 1.3);
    const muzzle = this.muzzleWorld(p.body, 'pistol');
    const d = target.clone().sub(muzzle).normalize();
    const hits = Math.random() < (P.vehicle ? 0.12 : 0.2);
    if (!hits) {
      d.x += (Math.random() - 0.5) * 0.12;
      d.y += (Math.random() - 0.5) * 0.06;
      d.normalize();
    }
    const dist = muzzle.distanceTo(target);
    const end = muzzle.clone().addScaledVector(d, dist + (hits ? 0 : 6));
    this.tracer(muzzle, end);
    this.muzzleFlash(muzzle, 0.4);
    this.audio.gunshot('pistol', Math.max(0.15, 1 - dist / 60));
    if (hits) {
      if (P.vehicle) {
        P.health = Math.max(1, P.health - 2);
        this.hud.setHealth(P.health);
        P.vehicle.damage(1.2);
      } else P.takeHit(6, p);
      this.impact(end, !P.vehicle);
    } else this.impact(end, false);
  }

  // ---------------------------------------------------------------- update
  update(dt, input, { onFoot }) {
    this.cool -= dt;
    // weapon selection
    if (input.pressed('Digit1')) this.equip(null);
    for (const [i, k] of ORDER.entries()) if (k && input.pressed('Digit' + (i + 1))) this.equip(k);
    if (input.pressed('KeyQ')) this.cycle();
    if (input.pressed('KeyR') && onFoot) this.reload();

    const armed = !!this.current && onFoot;
    const aim = armed && input.mouse(2) && !this.player.overlay;
    if (aim && !this.aiming) this.lockOn();
    this.aiming = aim;
    const w0 = WEAPONS[this.current];
    const trigger = armed && !this.player.overlay && (w0?.auto ? input.mouse(0) : input.pressed('Mouse0'));
    // firing without aiming: the hero turns to where the camera looks and shoots at the crosshair
    if (trigger && !this.aiming) this.readyT = 1.1;
    this.readyT = armed && !this.aiming ? this.readyT - dt : 0;
    const ready = this.readyT > 0;
    this.player.aiming = this.aiming || ready;
    this.follow.setAim(this.aiming);
    const ch = document.getElementById('crosshair');
    if (ch) {
      ch.classList.toggle('show', this.aiming || ready);
      ch.classList.toggle('hip', ready);
      const over = (this.aiming || ready) && !!this.crossTarget(0.035, w0 ? w0.range : 0);
      ch.classList.toggle('target', over);
      this.follow.slow = over && this.aiming;
    }

    if (this.reloading > 0 && (this.reloading -= dt) <= 0) {
      const w = WEAPONS[this.current], s = this.inv[this.current];
      const n = Math.min(w.mag - s.mag, s.reserve);
      s.mag += n;
      s.reserve -= n;
      this.updateHud();
    }
    // shoot once the hero faces the way the camera looks (a hip shot waits a moment for the turn)
    if (trigger) this.queued = 0.35;
    this.queued -= dt;
    if (armed && !this.player.overlay && this.queued > 0) {
      const off = Math.abs(Math.atan2(Math.sin(this.player.yaw - this.follow.yaw), Math.cos(this.player.yaw - this.follow.yaw)));
      if (off < 0.45) {
        this.fire();
        this.queued = 0;
      }
    }

    // effects
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
    for (const f of [...this.fx]) {
      f.life -= dt;
      const a = Math.max(0, f.life / f.max);
      f.obj.material.opacity = (f.kind === 'blood' ? 0.85 : 0.9) * a;
      if (f.kind !== 'tracer') f.obj.scale.multiplyScalar(1 + dt * (f.kind === 'blood' ? 2 : 6));
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        this.fx.splice(this.fx.indexOf(f), 1);
      }
    }

    // pickups
    const P = this.player.position;
    for (const pk of this.pickups) {
      if (pk.respawn > 0) {
        if ((pk.respawn -= dt) <= 0) pk.g.visible = true;
        continue;
      }
      pk.vis.rotation.y += dt * 1.6;
      pk.g.position.y = this.city.groundHeight(pk.x, pk.z) + 0.95 + Math.sin(performance.now() / 400 + pk.x) * 0.08;
      if (onFoot && Math.hypot(P.x - pk.x, P.z - pk.z) < 1.3) {
        if (!WEAPONS[pk.key] && !this.takeItem(pk.key)) continue;
        if (WEAPONS[pk.key]) this.give(pk.key);
        pk.g.visible = false;
        pk.respawn = 45;
      }
    }
    this.hud.pickupBlips = this.pickups.filter((p) => p.respawn <= 0).map((p) => ({ x: p.x, z: p.z, color: PICKUP_COLOR[p.key] || '#7ad65b', r: 4 }));
  }
}
