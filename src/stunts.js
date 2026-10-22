// Stunt jumps: hazard-striped ramps on the beaches. Hit one fast and the car takes
// off (simple ballistic hop on top of the flat driving model); land it for a
// stunt bonus based on air time and distance, doubled the first time per ramp.
import * as THREE from 'three';

const LEN = 8, WIDTH = 4.2, HEIGHT = 1.9;

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c12e';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1a1a1a';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 + 128, 128);
    g.lineTo(i + 128, 128);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Stunts {
  constructor({ scene, city, hud, audio }) {
    Object.assign(this, { scene, city, hud, audio });
    const H = city.HALF;
    this.ramps = [
      { x: -60, z: H + 22, yaw: Math.PI / 2 },
      { x: 130, z: H + 30, yaw: -Math.PI / 2 },
      { x: H + 22, z: 60, yaw: Math.PI },
      { x: -H - 22, z: 140, yaw: 0 },
    ];
    const tex = hazardTexture();
    tex.repeat.set(2, 1);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const side = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9 });
    const geo = this.wedge();
    for (const r of this.ramps) {
      const m = new THREE.Mesh(geo, [top, side]);
      m.position.set(r.x, 0, r.z);
      m.rotation.y = r.yaw;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      r.fx = Math.sin(r.yaw);
      r.fz = Math.cos(r.yaw);
      r.done = false;
    }
    this.air = new Map(); // vehicle -> flight record
    // unique jumps already landed (kept across sessions)
    try {
      const done = JSON.parse(localStorage.getItem('solcity.jumps') || '[]');
      this.ramps.forEach((r, i) => (r.done = !!done[i]));
    } catch {}
  }

  // wedge rising along +Z from 0 to LEN; group 0 = driving surface
  wedge() {
    const w = WIDTH / 2;
    const p = [
      // slope
      -w, 0, 0, w, 0, 0, w, HEIGHT, LEN, -w, 0, 0, w, HEIGHT, LEN, -w, HEIGHT, LEN,
      // back face
      -w, 0, LEN, -w, HEIGHT, LEN, w, HEIGHT, LEN, -w, 0, LEN, w, HEIGHT, LEN, w, 0, LEN,
      // sides
      w, 0, 0, w, 0, LEN, w, HEIGHT, LEN, -w, 0, 0, -w, HEIGHT, LEN, -w, 0, LEN,
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, ...new Array(24).fill(0)];
    // listed clockwise from outside: flip every triangle so the faces point outwards
    for (let t = 0; t < p.length / 9; t++) {
      for (let k = 0; k < 3; k++) [p[t * 9 + 3 + k], p[t * 9 + 6 + k]] = [p[t * 9 + 6 + k], p[t * 9 + 3 + k]];
      for (let k = 0; k < 2; k++) [uv[t * 6 + 2 + k], uv[t * 6 + 4 + k]] = [uv[t * 6 + 4 + k], uv[t * 6 + 2 + k]];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.addGroup(0, 6, 0);
    g.addGroup(6, 12, 1);
    g.computeVertexNormals();
    return g;
  }

  // ramp under a point: { r, u (0..LEN along the ramp), surface height }
  rampAt(x, z) {
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const u = dx * r.fx + dz * r.fz, v = dx * r.fz - dz * r.fx;
      if (u >= 0 && u <= LEN && Math.abs(v) <= WIDTH / 2 + 0.3) return { r, u, h: (u / LEN) * HEIGHT };
    }
    return null;
  }

  update(dt, vehicles, driving) {
    for (const c of vehicles.active) {
      const v = c.vehicle;
      const along = (r) => v.vel.x * r.fx + v.vel.z * r.fz;
      const on = this.rampAt(v.pos.x, v.pos.z);
      if (on && along(on.r) > 1 && v.hopY <= on.h + 0.15 && v.hopV <= 0.5) {
        // riding up the slope
        v.hopY = on.h;
        v.hopV = 0;
        v.pitch = -Math.atan(HEIGHT / LEN) * 0.9;
        v.pitchV = 0;
        v.rampOn = on.r;
      } else if (v.rampOn && !on) {
        // off the lip: launch with the slope's vertical speed
        const r = v.rampOn;
        v.rampOn = null;
        const sp = Math.max(0, along(r));
        if (v.hopY > HEIGHT * 0.8 && sp > 6) {
          v.hopV = sp * (HEIGHT / LEN) * 1.15 + 1.5;
          // and a bit more forward boost for fun
          v.vel.x += r.fx * 1.5;
          v.vel.z += r.fz * 1.5;
          if (c === driving) this.air.set(v, { r, t: 0, x: v.pos.x, z: v.pos.z, top: v.hopY });
        }
      } else if (!on) v.rampOn = null;
    }
    // flights of the player's car: nose follows the arc, bonus on landing
    for (const [v, f] of this.air) {
      f.t += dt;
      f.top = Math.max(f.top, v.hopY);
      v.pitch = THREE.MathUtils.clamp(-Math.atan2(v.hopV, Math.max(4, v.speed)) * 0.8, -0.5, 0.5);
      if (v.hopY <= 0.01 && f.t > 0.15) {
        this.air.delete(v);
        if (!v.driven) continue;
        const dist = Math.hypot(v.pos.x - f.x, v.pos.z - f.z) + LEN;
        if (f.t < 0.6 || v.data.wrecked) continue;
        const unique = !f.r.done;
        f.r.done = true;
        try {
          localStorage.setItem('solcity.jumps', JSON.stringify(this.ramps.map((r) => r.done)));
        } catch {}
        this.onStunt?.(unique);
        const pay = Math.round((f.t * 40 + dist * 2) * (unique ? 2 : 1));
        this.hud.addMoney(pay);
        this.audio.cash();
        this.hud.say(`${unique ? 'UNIQUE ' : ''}STUNT BONUS <em>$${pay}</em> &nbsp; ${dist.toFixed(0)} m, ${f.t.toFixed(1)} s in the air`, 4);
      }
    }
  }

  get doneCount() {
    return this.ramps.filter((r) => r.done).length;
  }

  blips() {
    return this.ramps.map((r) => ({ x: r.x, z: r.z, color: '#f2c12e', r: 5, label: 'J' }));
  }
}
