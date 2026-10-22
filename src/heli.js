// Police helicopter (Blender model: heli_police.glb). From three stars it joins the
// chase: flies in, circles the player with its searchlight on them and reports
// what it sees (keeps the stars from fading). It can be shot down: it spins out
// and explodes. When the stars are gone it flies off.
import * as THREE from 'three';

const ALT = 27, ORBIT = 24, MAX_SPEED = 30;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class PoliceHeli {
  constructor({ scene, gltf, city, audio, fx }) {
    Object.assign(this, { scene, city, audio, fx });
    this.obj = gltf.scene.clone(true);
    this.obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      if (o.material.name === 'SirenRed' || o.material.name === 'SirenBlue') (this.strobes ||= []).push(o.material);
      if (o.material.name === 'Headlight') {
        o.material.emissive.set(0xfff6e0);
        o.material.emissiveIntensity = 3;
      }
      if (o.material.name === 'Glass') {
        o.material.transparent = true;
        o.material.opacity = 0.8;
      }
    });
    this.body = this.obj.getObjectByName('Body');
    this.rotor = this.obj.getObjectByName('rotor_main');
    this.tailRotor = this.obj.getObjectByName('rotor_tail');
    this.spot = this.obj.getObjectByName('spot');
    this.obj.visible = false;
    scene.add(this.obj);

    // searchlight: an additive cone from the lamp to the ground, and a bright pool
    const coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 1 } },
      vertexShader: 'varying float vT; varying vec3 vN, vV; void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float k; varying float vT; varying vec3 vN, vV; void main(){ float a = (0.25 + 0.75 * vT) * 0.06 * k * pow(abs(dot(vN, vV)), 1.2); gl_FragColor = vec4(vec3(1.0, 0.97, 0.88) * a, a); }',
    });
    // unit cone, apex (uv.y = 1) at the origin, opening down -Y to length 1
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1, 1, 24, 1, true).translate(0, -0.5, 0), coneMat);
    this.cone.frustumCulled = false;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 64;
    const g = pc.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,235,1)');
    gr.addColorStop(0.6, 'rgba(255,245,225,.55)');
    gr.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.pool.renderOrder = 2;
    this.cone.visible = this.pool.visible = false;
    scene.add(this.cone, this.pool);

    this.state = 'off';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.orbitA = 0;
    this.aim = new THREE.Vector3();
    this.health = 100;
    this.cooldown = 0;
    this.seen = false;
    this.t = 0;
    this.onDown = null; // (pos) => void
  }

  get active() {
    return this.state === 'chase' || this.state === 'leave' || this.state === 'falling';
  }

  spawn(target) {
    const a = Math.random() * Math.PI * 2;
    this.pos.set(target.x + Math.cos(a) * 220, ALT + 15, target.z + Math.sin(a) * 220);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.orbitA = a;
    this.health = 100;
    this.state = 'chase';
    this.obj.visible = true;
    this.aim.set(target.x, 0, target.z);
  }

  // bullets: ray vs a sphere around the cabin; returns distance or Infinity
  rayHit(o, d) {
    if (!this.obj.visible || this.state === 'falling') return Infinity;
    const c = _v.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
    const oc = c.clone().sub(o);
    const t = oc.dot(d);
    if (t < 0) return Infinity;
    const d2 = oc.lengthSq() - t * t;
    return d2 < 2.3 * 2.3 ? t - Math.sqrt(2.3 * 2.3 - d2) : Infinity;
  }

  damage(n) {
    if (this.state !== 'chase' && this.state !== 'leave') return;
    this.health -= n;
    if (this.health <= 0) {
      this.state = 'falling';
      this.spin = 0;
    }
  }

  update(dt, { level, target, nightK, camera }) {
    this.t += dt;
    this.seen = false;
    this.cooldown -= dt;
    if (this.state === 'off') {
      if (level >= 3 && this.cooldown <= 0) this.spawn(target);
      else return this.audio.chopper?.(0);
    }
    if (this.state === 'chase' && !level) this.state = 'leave';
    if (this.state === 'leave' && level >= 3) this.state = 'chase';

    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, dist = Math.hypot(dx, dz);
    if (this.state === 'falling') {
      // spinning down out of control
      this.spin += dt * 3;
      this.yaw += dt * (2 + this.spin * 2);
      this.vel.y -= 9 * dt;
      this.vel.x *= Math.exp(-0.5 * dt);
      this.vel.z *= Math.exp(-0.5 * dt);
      for (let i = 0; i < 2; i++) this.fx.engineSmoke(this.pos.x, this.pos.y + 1.8, this.pos.z, 1);
      this.fx.flames(this.pos.x, this.pos.y + 1.5, this.pos.z, 1);
      const floor = this.city.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= floor + 0.5) {
        this.pos.y = floor;
        this.fx.explosion(this.pos, 1.4);
        this.onDown?.(this.pos.clone());
        this.state = 'off';
        this.cooldown = 35;
        this.obj.visible = this.cone.visible = this.pool.visible = false;
        this.audio.chopper?.(0);
        return;
      }
    } else {
      // where to be: circling the target, or away and up when leaving
      let want;
      if (this.state === 'leave') want = _v.set(this.pos.x - dx * 3, ALT + 30, this.pos.z - dz * 3);
      else {
        this.orbitA += dt * 0.22;
        want = _v.set(target.x + Math.cos(this.orbitA) * ORBIT, ALT, target.z + Math.sin(this.orbitA) * ORBIT);
      }
      // stay clear of the hill under it
      want.y += Math.max(this.city.groundHeight(want.x, want.z), this.city.groundHeight(this.pos.x, this.pos.z));
      const to = want.clone().sub(this.pos);
      const desired = to.clone().clampLength(0, MAX_SPEED).multiplyScalar(Math.min(1, to.length() / 25) || 0);
      this.vel.lerp(desired, 1 - Math.exp(-0.9 * dt));
      // face the direction of travel when fast, otherwise the target
      const face = this.vel.lengthSq() > 64 ? Math.atan2(this.vel.x, this.vel.z) : Math.atan2(dx, dz);
      this.yaw += Math.atan2(Math.sin(face - this.yaw), Math.cos(face - this.yaw)) * (1 - Math.exp(-1.5 * dt));
      if (this.state === 'leave' && dist > 320) {
        this.state = 'off';
        this.obj.visible = this.cone.visible = this.pool.visible = false;
        this.audio.chopper?.(0);
        return;
      }
    }
    this.pos.addScaledVector(this.vel, dt);

    // attitude: nose down when accelerating forward, bank into turns
    const fwd = Math.sin(this.yaw) * this.vel.x + Math.cos(this.yaw) * this.vel.z;
    const side = Math.cos(this.yaw) * this.vel.x - Math.sin(this.yaw) * this.vel.z;
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(THREE.MathUtils.clamp(fwd * 0.012, -0.25, 0.3), 0, THREE.MathUtils.clamp(-side * 0.015, -0.35, 0.35) + (this.state === 'falling' ? Math.sin(this.t * 7) * 0.2 : 0));
    this.rotor.rotation.y += dt * (this.state === 'falling' ? 14 : 32);
    this.tailRotor.rotation.x += dt * 60;
    if (this.strobes) this.strobes.forEach((m, i) => (m.emissiveIntensity = Math.floor(this.t * 2.5 + i * 0.5) % 2 ? 5 : 0));

    // searchlight sweeps lazily onto the target
    const on = this.state === 'chase' && dist < 80;
    const wob = _v.set(Math.sin(this.t * 0.9) * 2.5, 0, Math.cos(this.t * 0.7) * 2.5);
    const aimAt = new THREE.Vector3(target.x + wob.x, 0, target.z + wob.z);
    this.aim.lerp(aimAt, 1 - Math.exp(-1.6 * dt));
    this.cone.visible = this.pool.visible = on;
    if (on) {
      const lamp = this.spot.getWorldPosition(new THREE.Vector3());
      const ground = this.city.groundHeight(this.aim.x, this.aim.z) + 0.03;
      const dir = new THREE.Vector3(this.aim.x, ground, this.aim.z).sub(lamp);
      const len = dir.length();
      const r = 3.2;
      this.cone.position.copy(lamp);
      this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      this.cone.scale.set(r, len, r);
      this.cone.material.uniforms.k.value = 0.35 + nightK * 0.9;
      this.pool.position.set(this.aim.x, ground, this.aim.z);
      this.pool.scale.setScalar(r * 1.15);
      this.pool.material.opacity = 0.15 + nightK * 0.4;
      // the crew sees whoever is in (or near) the beam
      if (Math.hypot(this.aim.x - target.x, this.aim.z - target.z) < 7) this.seen = true;
    }
    const cd = camera.position.distanceTo(this.pos);
    this.audio.chopper?.(Math.max(0, 1 - cd / 260));
  }
}
