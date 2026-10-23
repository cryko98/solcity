// World effects: smoke / fire / spark particles (two GPU point systems), tyre skid
// marks (a ring buffer of road decals), explosions with debris, scorch marks and a
// shared fire light. Everything is pooled: no allocations or new lights at runtime.
import * as THREE from 'three';

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // a soft blob made of a few overlapping circles, so puffs don't look like perfect discs
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  };
  blob(32, 32, 30, 0.75);
  blob(24, 28, 16, 0.35);
  blob(40, 36, 15, 0.3);
  blob(34, 22, 12, 0.25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

class Particles {
  constructor(scene, max, map, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.accel = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setAttribute('size', this.aSize);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: map }, viewH: { value: 800 }, tint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `
        attribute vec3 color; attribute float alpha; attribute float size;
        uniform float viewH; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * projectionMatrix[1][1] * viewH * 0.5 / max(0.1, -mv.z);
          vColor = color; vAlpha = alpha;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 tint; varying vec3 vColor; varying float vAlpha;
        void main(){
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor * tint, a);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
    scene.add(this.points);
  }

  // accel: upward acceleration (smoke rises > 0, sparks fall < 0)
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, drag = 1, accel = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); // full: recycle a random one
    else this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.accel[i] = accel;
  }

  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const a of [this.pos, this.vel, this.col]) a.copyWithin(i * 3, j * 3, j * 3 + 3);
    for (const a of [this.age, this.life, this.size0, this.size1, this.alpha0, this.drag, this.accel]) a[i] = a[j];
  }

  update(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      if ((this.age[i] += dt) >= this.life[i]) this.kill(i);
    }
    const P = this.aPos.array, C = this.aCol.array, A = this.aAlpha.array, S = this.aSize.array;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, t = this.age[i] / this.life[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr;
      this.vel[k + 2] *= dr;
      this.vel[k + 1] = this.vel[k + 1] * dr + this.accel[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] *= -0.3;
      }
      P[k] = this.pos[k];
      P[k + 1] = this.pos[k + 1];
      P[k + 2] = this.pos[k + 2];
      C[k] = this.col[k];
      C[k + 1] = this.col[k + 1];
      C[k + 2] = this.col[k + 2];
      // quick fade in, slow fade out
      A[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aAlpha.needsUpdate = this.aSize.needsUpdate = true;
  }
}

// ring buffer of dark quads on the road
class SkidMarks {
  constructor(scene, max = 700) {
    this.max = max;
    this.next = 0;
    const pos = new Float32Array(max * 4 * 3);
    const idx = [];
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x0b0b0b, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.trails = new Map(); // key -> { x, z, t }
  }

  // continue (or start) the trail of one wheel
  add(key, x, y, z, w, now) {
    const last = this.trails.get(key);
    this.trails.set(key, { x, z, t: now });
    if (!last || now - last.t > 0.12) return;
    const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
    if (d < 0.05 || d > 3) return;
    const nx = (-dz / d) * w * 0.5, nz = (dx / d) * w * 0.5;
    const a = this.attr.array, o = this.next * 12;
    a.set([last.x + nx, y, last.z + nz, last.x - nx, y, last.z - nz, x + nx, y, z + nz, x - nx, y, z - nz], o);
    this.attr.addUpdateRange?.(o, 12);
    this.attr.needsUpdate = true;
    this.next = (this.next + 1) % this.max;
  }
}

export class Fx {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    const tex = puffTexture();
    this.smoke = new Particles(scene, 900, tex, false);
    this.fire = new Particles(scene, 500, tex, true);
    this.skids = new SkidMarks(scene);
    this.time = 0;
    // one shared light for explosions and the burning car nearest the camera
    this.light = new THREE.PointLight(0xff7a2a, 0, 32, 2);
    this.light.position.set(0, -50, 0);
    scene.add(this.light);
    this.boom = 0;
    this.burnLight = null; // { x, y, z, k }
    // shockwave ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringT = 1;
    // flying debris (pooled boxes)
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.5 }), 60);
    this.debris.castShadow = true;
    this.debris.frustumCulled = false;
    this.debris.count = 0;
    scene.add(this.debris);
    this.chunks = [];
    // scorch marks left by explosions
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const g = sc.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,.9)');
    gr.addColorStop(0.55, 'rgba(10,8,6,.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.scorchMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.scorches = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  setViewport(h) {
    this.smoke.mat.uniforms.viewH.value = h;
    this.fire.mat.uniforms.viewH.value = h;
  }

  // ambient light level for smoke (dark at night)
  setAmbient(k) {
    this.smoke.mat.uniforms.tint.value.setScalar(k);
  }

  // ---------------------------------------------------------------- emitters
  tyreSmoke(x, z, amount, vx = 0, vz = 0) {
    const g = 0.75 + Math.random() * 0.1;
    this.smoke.emit(x + (Math.random() - 0.5) * 0.3, 0.25, z + (Math.random() - 0.5) * 0.3,
      vx * 0.15 + (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, vz * 0.15 + (Math.random() - 0.5) * 0.8,
      1.4 + Math.random() * 1.2, 0.7, 3.2 + amount * 1.5, g, g, g, 0.28 + amount * 0.2, 1.2, 0.35);
  }

  // engine smoke of a damaged car: grey -> black as it gets worse
  engineSmoke(x, y, z, dark) {
    const g = 0.75 - dark * 0.68;
    this.smoke.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4,
      1.8 + Math.random() * 1.4 + dark, 0.5, 2.6 + dark * 2, g, g * 0.98, g * 0.95, 0.35 + dark * 0.35, 0.6, 0.8);
  }

  flames(x, y, z, s = 1) {
    const h = Math.random();
    this.fire.emit(x + (Math.random() - 0.5) * 0.8 * s, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.8 * s,
      (Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5,
      0.45 + Math.random() * 0.35, 0.9 * s, 0.3 * s, 1.0, 0.45 + h * 0.35, 0.12 + h * 0.08, 0.9, 1.5, 2.0);
  }

  sparks(at, n = 8, dir = null) {
    for (let i = 0; i < n; i++) {
      const vx = (dir ? dir.x * 3 : 0) + (Math.random() - 0.5) * 6, vz = (dir ? dir.z * 3 : 0) + (Math.random() - 0.5) * 6;
      this.fire.emit(at.x, at.y, at.z, vx, 1 + Math.random() * 3, vz, 0.25 + Math.random() * 0.3, 0.09, 0.03, 1, 0.75, 0.35, 1, 0.5, -14);
    }
  }

  // a little puff where a bullet hits a wall or the ground
  dust(at, n = 3) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(at.x, at.y, at.z, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2,
        0.5 + Math.random() * 0.4, 0.15, 0.7, 0.62, 0.58, 0.52, 0.5, 3, 0.2);
    }
  }

  // raindrop hitting the ground / a wet footstep
  splash(x, y, z, n = 2) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(x, y + 0.03, z, (Math.random() - 0.5) * 1.4, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 1.4,
        0.22 + Math.random() * 0.12, 0.05, 0.14, 0.75, 0.8, 0.86, 0.55, 2, -9);
    }
  }

  // white water: thrown up at the bow (spray) or left behind on the surface (wake)
  wake(x, y, z, sx, vx, vz, spray) {
    this.smoke.emit(x, y + 0.05, z, sx + vx + (Math.random() - 0.5) * 0.6, spray ? 1.2 + Math.random() : 0.15, vz + (Math.random() - 0.5) * 0.6,
      spray ? 0.5 + Math.random() * 0.3 : 1.4 + Math.random() * 1.2, spray ? 0.2 : 0.5, spray ? 0.6 : 2.2, 0.92, 0.96, 1.0, spray ? 0.55 : 0.4, spray ? 1.5 : 2.5, spray ? -8 : 0);
  }

  // the fire truck's water cannon: drops along a falling arc
  jet(x, y, z, vx, vy, vz) {
    const j = () => (Math.random() - 0.5) * 1.2;
    this.smoke.emit(x, y, z, vx + j(), vy + j(), vz + j(), 0.9 + Math.random() * 0.4, 0.3, 1.1, 0.86, 0.93, 1.0, 0.7, 0.2, -9.8);
  }

  // gun smoke drifting from the muzzle
  muzzleSmoke(at) {
    this.smoke.emit(at.x, at.y, at.z, (Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3,
      0.8 + Math.random() * 0.5, 0.12, 0.6, 0.8, 0.8, 0.8, 0.22, 2, 0.4);
  }

  // dark red pool spreading under someone who went down from gunfire
  bloodPool(x, z) {
    if (!this.bloodMat) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      for (let i = 0; i < 7; i++) {
        const bx = 64 + (Math.random() - 0.5) * 40, bz = 64 + (Math.random() - 0.5) * 40, r = 18 + Math.random() * 22;
        const gr = g.createRadialGradient(bx, bz, 0, bx, bz, r);
        gr.addColorStop(0, 'rgba(70,4,4,.95)');
        gr.addColorStop(0.7, 'rgba(60,3,3,.85)');
        gr.addColorStop(1, 'rgba(50,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 128, 128);
      }
      this.bloodMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, roughness: 0.15, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      this.pools = [];
    }
    let m;
    if (this.pools.length >= 10) m = this.pools.shift();
    else {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.bloodMat);
      m.renderOrder = 1;
      this.scene.add(m);
    }
    m.position.set(x, this.city.groundHeight(x, z) + 0.022, z);
    m.rotation.y = Math.random() * 6.28;
    m.scale.set(0.2, 1, 0.2);
    m.userData.grow = 1.4 + Math.random() * 0.6;
    this.pools.push(m);
  }

  explosion(at, power = 1) {
    const { x, z } = at;
    const gy = this.city?.groundHeight ? this.city.groundHeight(x, z) : 0;
    // fireball: a fast outer burst plus a slower rolling core
    for (let i = 0; i < 60 * power; i++) {
      const core = i % 3 === 0;
      const a = Math.random() * 6.283, s = core ? 1 + Math.random() * 2.5 : 3 + Math.random() * 8, up = (core ? 3 : 2) + Math.random() * 7;
      const h = Math.random();
      this.fire.emit(x + (Math.random() - 0.5) * 2, gy + 0.8 + Math.random() * 1.5, z + (Math.random() - 0.5) * 2, Math.cos(a) * s, up, Math.sin(a) * s,
        (core ? 1.0 : 0.6) + Math.random() * 0.7, core ? 4.2 : 3.0, core ? 2.4 : 1.4, 1, 0.22 + h * 0.4, 0.03 + h * 0.07, core ? 0.5 : 0.42, core ? 1.6 : 2.6, core ? 2.5 : 1.2);
    }
    for (let i = 0; i < 28 * power; i++) {
      const a = Math.random() * 6.283, s = 1 + Math.random() * 4.5;
      const g = 0.05 + Math.random() * 0.1;
      this.smoke.emit(x, gy + 1 + Math.random() * 2, z, Math.cos(a) * s, 2.5 + Math.random() * 5, Math.sin(a) * s,
        3.5 + Math.random() * 3, 2.6, 7.5, g, g, g, 0.85, 0.9, 1.1);
    }
    this.sparks({ x, y: gy + 1, z }, 26);
    // debris
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.283, s = 3 + Math.random() * 8;
      if (this.chunks.length >= 60) this.chunks.shift();
      this.chunks.push({
        p: new THREE.Vector3(x, gy + 1, z), v: new THREE.Vector3(Math.cos(a) * s, 5 + Math.random() * 8, Math.sin(a) * s),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
        life: 6, s: 0.6 + Math.random() * 1.6,
      });
    }
    this.boom = 1;
    this.light.position.set(x, 2.5, z);
    this.ring.position.set(x, this.city.groundHeight(x, z) + 0.08, z);
    this.ring.visible = true;
    this.ringT = 0;
    this.scorch(x, z, 3.2 * power);
  }

  scorch(x, z, r) {
    let m;
    if (this.scorches.length >= 14) m = this.scorches.shift();
    else {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.scorchMat);
      m.renderOrder = 1;
      this.scene.add(m);
    }
    m.position.set(x, this.city.groundHeight(x, z) + 0.02, z);
    m.scale.set(r * 2, 1, r * 2);
    m.rotation.y = Math.random() * 6.28;
    this.scorches.push(m);
  }

  skid(key, x, z, w = 0.22) {
    this.skids.add(key, x, this.city.groundHeight(x, z) + 0.018, z, w, this.time);
  }

  // the burning car nearest the camera lights its surroundings
  burning(x, y, z, k) {
    if (!this.burnLight || k > this.burnLight.k) this.burnLight = { x, y, z, k };
  }

  update(dt) {
    this.time += dt;
    for (const m of this.pools || []) {
      if (m.scale.x < m.userData.grow) {
        const s = Math.min(m.userData.grow, m.scale.x + dt * 0.25);
        m.scale.set(s, 1, s);
      }
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    // light: explosion flash first, otherwise a flickering fire
    if (this.boom > 0) {
      this.boom = Math.max(0, this.boom - dt * 1.6);
      this.light.intensity = 900 * this.boom * this.boom;
    } else if (this.burnLight) {
      const b = this.burnLight;
      this.light.position.set(b.x, b.y + 1.2, b.z);
      this.light.intensity = (60 + Math.random() * 40) * b.k;
    } else this.light.intensity = 0;
    this.burnLight = null;
    if (this.ringT < 1) {
      this.ringT = Math.min(1, this.ringT + dt * 2.4);
      const s = 1 + this.ringT * 14;
      this.ring.scale.set(s, 1, s);
      this.ring.material.opacity = 0.9 * (1 - this.ringT);
      if (this.ringT >= 1) this.ring.visible = false;
    }
    // debris
    let n = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if ((c.life -= dt) <= 0) {
        this.chunks.splice(i, 1);
        continue;
      }
      const gy = this.city.groundHeight(c.p.x, c.p.z) + 0.04;
      if (c.p.y > gy || c.v.y > 0) {
        c.v.y -= 20 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.addScaledVector(c.w, dt);
        if (c.p.y < gy) {
          c.p.y = gy;
          c.v.set(c.v.x * 0.4, -c.v.y * 0.25, c.v.z * 0.4);
          c.w.multiplyScalar(0.4);
          if (Math.abs(c.v.y) < 0.6) c.v.set(0, 0, 0);
        }
      }
    }
    for (const c of this.chunks) {
      this._q.setFromEuler(this._e.set(c.r.x, c.r.y, c.r.z));
      this._m.compose(c.p, this._q, new THREE.Vector3(c.s, c.s, c.s));
      this.debris.setMatrixAt(n++, this._m);
    }
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
