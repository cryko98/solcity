// Hidden packages: twenty taped-up parcels tucked away around the city (along building
// walls, on the beaches, up on Mount Sol, in a park). Each one pays, every fifth a
// bonus, all twenty a jackpot. Found ones stay found (localStorage).
import * as THREE from 'three';

const COUNT = 20, REACH = 1.4, PAY = 100, KEY = 'solcity.packages';

function parcelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#a8784a';
  g.fillRect(0, 0, 128, 128);
  // cardboard grain
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(60,35,15,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 6, 1);
  }
  // packing tape across both ways
  g.fillStyle = 'rgba(225,205,150,.85)';
  g.fillRect(52, 0, 24, 128);
  g.fillRect(0, 52, 128, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// small deterministic RNG: the packages are in the same places every game
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Packages {
  constructor({ scene, city, hud, audio, stunts }) {
    Object.assign(this, { scene, city, hud, audio });
    let found = [];
    try {
      found = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {}
    this.spots = this.place(stunts);
    const geo = new THREE.BoxGeometry(0.46, 0.34, 0.46);
    const mat = new THREE.MeshStandardMaterial({ map: parcelTexture(), roughness: 0.85, emissive: 0x3a2a10, emissiveIntensity: 0.4 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x6dff7a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringGeo = new THREE.RingGeometry(0.38, 0.55, 32).rotateX(-Math.PI / 2);
    this.items = this.spots.map((p, i) => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(geo, mat);
      box.castShadow = true;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = -0.38;
      g.add(box, ring);
      g.userData.box = box;
      g.position.set(p.x, city.groundHeight(p.x, p.z) + 0.45, p.z);
      g.visible = !found[i];
      scene.add(g);
      return { ...p, g, found: !!found[i] };
    });
  }

  get count() {
    return this.items.filter((p) => p.found).length;
  }

  free(x, z, r = 0.6) {
    if (Math.abs(x) > this.city.HALF - 2 || Math.abs(z) > this.city.HALF - 2) return true; // beach, hills
    for (const c of this.city.query(x - r, x + r, z - r, z + r)) {
      if (c.type === 'box' ? x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r : Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
    }
    return true;
  }

  place(stunts) {
    const { N, BLOCK, SW, HALF } = this.city;
    const rand = rng(77);
    const out = [];
    // tucked in along building walls, at the back of the pavement
    let tries = 0;
    while (out.length < 16 && tries++ < 400) {
      const bi = Math.floor(rand() * N), bj = Math.floor(rand() * N);
      const x0 = this.city.blockMin(bi), z0 = this.city.blockMin(bj);
      const t = 0.12 + rand() * 0.76, inset = SW - 0.7;
      const side = Math.floor(rand() * 4);
      const x = side === 0 ? x0 + inset : side === 1 ? x0 + BLOCK - inset : x0 + t * BLOCK;
      const z = side === 2 ? z0 + inset : side === 3 ? z0 + BLOCK - inset : z0 + t * BLOCK;
      if (!this.free(x, z) || out.some((p) => Math.hypot(p.x - x, p.z - z) < 60)) continue;
      out.push({ x, z });
    }
    // two on the beaches next to the stunt ramps
    for (const r of (stunts?.ramps || []).slice(0, 2)) out.push({ x: r.x + r.fz * 9, z: r.z - r.fx * 9 });
    // one up the slope under the SOL CITY sign
    out.push({ x: 150, z: -HALF - 40 });
    // one in the middle of a park
    out.push({ x: this.city.spawn.x + 6.5, z: this.city.spawn.z - 6.5 });
    return out.slice(0, COUNT);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items.map((p) => p.found)));
    } catch {}
  }

  update(dt, pos) {
    this.t = (this.t || 0) + dt;
    for (const p of this.items) {
      if (p.found) continue;
      // only the ones near the camera need animating
      if (Math.abs(p.x - pos.x) > 90 || Math.abs(p.z - pos.z) > 90) continue;
      p.g.userData.box.rotation.y = this.t * 1.6;
      p.g.userData.box.position.y = Math.sin(this.t * 2.4 + p.x) * 0.08;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > REACH) continue;
      p.found = true;
      p.g.visible = false;
      this.save();
      const n = this.count;
      let pay = PAY, extra = '';
      if (n === COUNT) {
        pay += 5000;
        extra = ' &nbsp;ALL PACKAGES FOUND! +$5000';
      } else if (n % 5 === 0) {
        pay += 500;
        extra = ' &nbsp;Bonus +$500';
      }
      this.hud.addMoney(pay);
      this.audio.cash();
      this.hud.say(`Hidden package <em>${n} / ${COUNT}</em>${extra}`, 3.5);
      this.onFound?.(n);
    }
  }
}
