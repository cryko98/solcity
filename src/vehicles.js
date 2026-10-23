// Cars: parked cars are drawn with instancing; a car becomes a full, simulated
// Vehicle when the player gets in or something bumps into it, and goes back
// to an instance once it has come to rest.
import * as THREE from 'three';

// circles: offsets along the car of the collision circles, r: their radius
export const SPECS = {
  sedan: { engine: 9.5, vmax: 44, reverse: 9, brake: 24, steer: 0.62, grip: 8.5, wheelbase: 2.84, radius: 0.34, halfW: 0.95, halfL: 2.36, circles: [-1.4, 0, 1.4], r: 0.97 },
  coupe: { engine: 13.5, vmax: 58, reverse: 10, brake: 28, steer: 0.58, grip: 10, wheelbase: 2.68, radius: 0.35, halfW: 0.97, halfL: 2.26, circles: [-1.4, 0, 1.4], r: 0.97 },
  police: { engine: 13, vmax: 56, reverse: 10, brake: 28, steer: 0.62, grip: 10, wheelbase: 2.84, radius: 0.34, halfW: 0.95, halfL: 2.4, circles: [-1.4, 0, 1.4], r: 0.97 },
  van: { engine: 7, vmax: 36, reverse: 8, brake: 18, steer: 0.55, grip: 7.5, wheelbase: 3.3, radius: 0.37, halfW: 1.0, halfL: 2.55, circles: [-1.75, 0, 1.75], r: 1.0 },
  taxi: { engine: 9.5, vmax: 45, reverse: 9, brake: 24, steer: 0.62, grip: 8.5, wheelbase: 2.84, radius: 0.34, halfW: 0.95, halfL: 2.36, circles: [-1.4, 0, 1.4], r: 0.97 },
  // recline: the low supercar seat lays the driver back (radians)
  super: { engine: 21, vmax: 78, reverse: 10, brake: 34, steer: 0.6, grip: 12.5, wheelbase: 2.74, radius: 0.36, halfW: 1.02, halfL: 2.28, circles: [-1.35, 0, 1.35], r: 1.0, recline: 0.55 },
  lux: { engine: 11.5, vmax: 54, reverse: 9, brake: 26, steer: 0.55, grip: 9, wheelbase: 3.63, radius: 0.37, halfW: 1.0, halfL: 2.7, circles: [-1.9, 0, 1.9], r: 0.99 },
  bike: { engine: 15, vmax: 54, reverse: 3, brake: 22, steer: 0.5, grip: 9, wheelbase: 1.45, radius: 0.31, halfW: 0.42, halfL: 1.05, circles: [-0.55, 0.55], r: 0.45, bike: true },
  // the working vehicles of the side jobs (see jobs.js)
  ambulance: { engine: 8.5, vmax: 42, reverse: 8, brake: 19, steer: 0.55, grip: 7.5, wheelbase: 3.87, radius: 0.4, halfW: 1.15, halfL: 3.3, circles: [-2.2, -0.75, 0.75, 2.2], r: 1.12 },
  firetruck: { engine: 7, vmax: 38, reverse: 7, brake: 17, steer: 0.5, grip: 7, wheelbase: 5.47, radius: 0.52, halfW: 1.27, halfL: 4.75, circles: [-3.5, -1.15, 1.15, 3.5], r: 1.25 },
  bus: { engine: 5.5, vmax: 30, reverse: 6, brake: 15, steer: 0.5, grip: 6.5, wheelbase: 5.7, radius: 0.5, halfW: 1.3, halfL: 5.85, circles: [-4.6, -2.76, -0.92, 0.92, 2.76, 4.6], r: 1.25 },
  truck: { engine: 7.5, vmax: 40, reverse: 6, brake: 16, steer: 0.5, grip: 7, wheelbase: 5.1, radius: 0.52, halfW: 1.2, halfL: 3.65, circles: [-2.4, -0.8, 0.8, 2.4], r: 1.2 },
  // a trailer has no engine: it rolls behind the truck (towUpdate)
  trailer: { engine: 0, vmax: 1, reverse: 1, brake: 10, steer: 0, grip: 9, wheelbase: 9.675, radius: 0.52, halfW: 1.3, halfL: 6.1, circles: [-4.9, -2.45, 0, 2.45, 4.9], r: 1.25, axle: -4.475 },
  towtruck: { engine: 9, vmax: 44, reverse: 8, brake: 21, steer: 0.58, grip: 8, wheelbase: 3.67, radius: 0.42, halfW: 1.05, halfL: 3.05, circles: [-1.95, -0.65, 0.65, 1.95], r: 1.05 },
  // boats: thrust and rudder on the water (updateBoat); draft: how deep they sit
  boat: { engine: 9, vmax: 26, reverse: 5, brake: 6, steer: 0.5, grip: 1.6, wheelbase: 3.0, radius: 0.3, halfW: 1.18, halfL: 3.1, circles: [-1.9, 0, 1.9], r: 1.18, boat: true, draft: 0.5 },
  jetski: { engine: 14, vmax: 30, reverse: 3, brake: 5, steer: 0.55, grip: 2.2, wheelbase: 1.4, radius: 0.3, halfW: 0.58, halfL: 1.6, circles: [-0.8, 0.8], r: 0.6, bike: true, boat: true, draft: 0.25 },
};
// the longest reach of any vehicle from its centre (collision search windows)
const MAX_HALF_L = Math.max(...Object.values(SPECS).map((s) => s.halfL));
const specOf = (c) => SPECS[c.model] || SPECS.sedan;

// Sol Customs upgrades (c.tune): engine / brakes / grip levels 0-3, nitro, tint, rims
export const RIMS = { stock: null, chrome: 0xe8eaec, black: 0x18191b, gold: 0xc9a227 };
const tunedSpec = (c) => {
  const b = specOf(c), t = c.tune;
  if (!t) return b;
  const e = t.engine || 0;
  return { ...b, engine: b.engine * (1 + 0.13 * e), vmax: b.vmax * (1 + 0.06 * e), brake: b.brake * (1 + 0.16 * (t.brakes || 0)), grip: b.grip * (1 + 0.11 * (t.grip || 0)) };
};
const NITRO_SECS = 3.5; // a full bottle

// paint colours per model (taxis are always cab yellow)
const PALETTES = {
  taxi: [0xf2c12e],
  super: [0xc8102e, 0xf5c400, 0x7ad11f, 0xff6a13, 0xf2f2f2, 0x111214, 0x1f5fd6],
  lux: [0x0d0e10, 0x2b2d31, 0xb9bdc2, 0xf1efe9, 0x4a1420, 0x14213d],
  police: [0x111214],
  ambulance: [0xf4f4f0], firetruck: [0xb3141c], bus: [0xf2c12e], truck: [0xf2f2ee, 0x1f4f9e, 0xb3202a, 0x2a2c30], towtruck: [0xe8a21a],
  boat: [0xf4f4f0, 0x1f4f9e, 0xb3202a], jetski: [0xff4fa3, 0x41d6ff, 0xffd23f, 0x7dff6a],
};
export const colorFor = (model, fallback) => {
  const p = PALETTES[model];
  return p ? p[Math.floor(Math.random() * p.length)] : fallback;
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q2 = new THREE.Quaternion();

// headlight beams after dark: a soft light pool on the road plus a faint volumetric cone
let beamAssets = null;
function headlightAssets() {
  if (beamAssets) return beamAssets;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  // fan of light: bright near the bumper, spreading and fading down the road
  const gr = g.createRadialGradient(64, 10, 4, 64, 60, 200);
  gr.addColorStop(0, 'rgba(255,240,210,1)');
  gr.addColorStop(0.4, 'rgba(255,230,190,.5)');
  gr.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 256);
  g.globalCompositeOperation = 'destination-in';
  const side = g.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.3, 'rgba(0,0,0,1)');
  side.addColorStop(0.7, 'rgba(0,0,0,1)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = side;
  g.fillRect(0, 0, 128, 256);
  const along = g.createLinearGradient(0, 0, 0, 256);
  along.addColorStop(0, 'rgba(0,0,0,0)');
  along.addColorStop(0.08, 'rgba(0,0,0,1)');
  along.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 128, 256);
  const pool = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const cone = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'varying float vT; varying vec3 vN, vV; void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vT; varying vec3 vN, vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = vT * vT * 0.07 * edge; gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a); }',
  });
  // apex at the lamp (uv.y = 1), opening forward along +Z
  const coneGeo = new THREE.CylinderGeometry(0.35, 2.6, 13, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 6.5);
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  beamAssets = { pool, cone, coneGeo, poolGeo };
  return beamAssets;
}

class Vehicle {
  constructor(data, gltf, scene) {
    this.data = data;
    this.spec = tunedSpec(data);
    this.nitro = NITRO_SECS;
    this.boosting = false;
    this.root = gltf.scene.clone(true);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const n = o.material.name;
      if (n === 'Paint') {
        o.material = o.material.clone();
        o.material.color.set(data.color);
      } else if (n === 'Headlight') {
        o.material = o.material.clone();
        o.material.emissive.set(0xfff1d6);
        this.headMat = o.material;
      } else if (n === 'Taillight') {
        o.material = o.material.clone();
        o.material.emissive.set(0xff1408);
        this.tailMat = o.material;
      }
    });
    this.body = this.root.getObjectByName('Body');
    // wheels: wheel_FL / FR / RL / RR on cars (RL2 / RR2: a second rear axle), wheel_F / wheel_R on the bike
    this.wheels = [];
    this.root.traverse((o) => {
      if (!/^wheel_(FL|FR|RL2?|RR2?|F|R)$/.test(o.name)) return;
      o.rotation.order = 'YXZ';
      this.wheels.push({ o, front: o.name[6] === 'F', rest: o.quaternion.clone(), at: o.position.clone() });
    });
    this.doorMesh = this.root.getObjectByName('Door_L');
    if (this.doorMesh) {
      this.doorRest = this.doorMesh.quaternion.clone();
      // the door is a thin shell: show its inside when it swings open
      this.doorMesh.traverse((o) => {
        if (o.isMesh) o.material.side = THREE.DoubleSide;
      });
    }
    this.doorOpen = 0;
    this.fork = this.root.getObjectByName('fork');
    if (this.fork) this.forkRest = this.fork.quaternion.clone();
    this.sirenMats = [];
    this.root.traverse((o) => {
      if (o.isMesh && (o.material.name === 'SirenRed' || o.material.name === 'SirenBlue' || o.material.name === 'Beacon')) {
        const n = o.material.name;
        o.material = o.material.clone();
        o.material.emissive.set(n === 'SirenRed' ? 0xff1a1a : n === 'SirenBlue' ? 0x2a5bff : 0xffa31a);
        this.sirenMats.push(o.material);
      }
    });
    this.siren = false;
    // taxi roof sign: lit after dark
    this.root.traverse((o) => {
      if (o.isMesh && o.material.name === 'Checker' && o.material.map) {
        o.material.map.wrapS = o.material.map.wrapT = THREE.RepeatWrapping;
        o.material.map.needsUpdate = true;
      }
      if (o.isMesh && o.material.name === 'TaxiSign') {
        o.material = o.material.clone();
        o.material.emissive.set(0xffd27a);
        this.signMat = o.material;
      }
    });
    this.sirenT = Math.random();
    // (a trailer has neither seat nor door)
    this.seat = this.root.getObjectByName('seat_driver')?.position.clone() || new THREE.Vector3();
    this.door = this.root.getObjectByName('door_driver')?.position.clone() || new THREE.Vector3(1.6, 0, 0);
    // towing: where a trailer / towed car hangs on (truck: the fifth wheel; tow truck: the boom
    // at the back) and where a trailer / car is held (the kingpin; a car: its front bumper)
    this.hitch = this.root.getObjectByName('Hitch')?.position.clone() || new THREE.Vector3(0, 0.6, -this.spec.halfL - 0.2);
    this.pivot = this.root.getObjectByName('Kingpin')?.position.clone() || new THREE.Vector3(0, 0.5, this.spec.halfL);
    this.towedBy = null;
    this.towing = null;
    this.wave = Math.random() * 10;
    this.object = new THREE.Group();
    this.object.add(this.root);
    scene.add(this.object);
    {
      const A = headlightAssets(), s = specOf(data);
      const w = s.bike ? 2.2 : 4.6;
      this.lightPool = new THREE.Mesh(A.poolGeo, A.pool);
      this.lightPool.scale.set(w, 1, 11);
      this.lightPool.position.set(0, 0.03, s.halfL + 5.2);
      this.lightCone = new THREE.Mesh(A.coneGeo, A.cone);
      this.lightCone.position.set(0, s.bike ? 0.95 : 0.75, s.halfL - 0.1);
      this.lightCone.rotation.x = 0.08;
      if (s.bike) this.lightCone.scale.set(0.6, 0.6, 0.85);
      this.lightPool.visible = this.lightCone.visible = false;
      this.lightPool.renderOrder = 2;
      this.object.add(this.lightPool, this.lightCone);
    }

    this.pos = new THREE.Vector3(data.x, 0, data.z);
    this.heading = data.yaw;
    this.vel = new THREE.Vector3();
    this.angVel = 0;
    this.steer = 0;
    this.spin = 0;
    this.pitch = this.roll = this.pitchV = this.rollV = 0;
    this.prevVf = 0;
    this.vf = 0;
    this.slip = 0;
    this.braking = false;
    this.throttle = 0;
    this.restTime = 0;
    this.driven = false;
    this.impact = 0;
    this.hb = false;
    this.hopY = this.hopV = 0; // explosions throw the car up
    this.groundY = this.tPitch = this.tRoll = 0; // hills (Mount Sol)
    this.smokeAcc = this.fireAcc = this.tyreAcc = 0;
    if (data.health == null) data.health = 100;
    if (data.wrecked) this.burnOut();
    else if (data.tune) this.applyTune();
    this.sync();
  }

  // ---------------------------------------------------------------- damage
  // health 100..0: grey smoke below 65, black below 35, on fire at 12 (burns ~5 s), then explodes
  damage(amount) {
    const d = this.data;
    if (d.wrecked || amount <= 0) return;
    d.health -= amount;
    if (d.health <= 12 && !d.burning) {
      d.burning = true;
      d.health = Math.min(d.health, 12);
      this.onFire?.();
    }
    if (d.health <= 0) d.explodeNow = true;
  }

  // after a visit to Sol Customs: new handling numbers, tinted glass, painted rims
  applyTune() {
    this.spec = tunedSpec(this.data);
    const t = this.data.tune || {};
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material.name;
      if (n === 'Glass') {
        if (!o.userData.glass) o.userData.glass = { color: o.material.color.clone(), opacity: o.material.opacity, transmission: o.material.transmission || 0 };
        o.material = o.material.clone();
        o.material.name = 'Glass';
        o.material.color.copy(t.tint ? new THREE.Color(0x050608) : o.userData.glass.color);
        o.material.opacity = t.tint ? 0.92 : o.userData.glass.opacity;
        if ('transmission' in o.material) o.material.transmission = t.tint ? 0 : o.userData.glass.transmission; // see-through glass ignores opacity
      } else if (n === 'Rim') {
        if (!o.userData.rim) o.userData.rim = o.material.color.clone();
        o.material = o.material.clone();
        o.material.name = 'Rim';
        o.material.color.copy(RIMS[t.rims] != null ? new THREE.Color(RIMS[t.rims]) : o.userData.rim);
      }
    });
  }

  repaint(color) {
    this.data.color = color;
    this.root.traverse((o) => {
      if (o.isMesh && o.material.name === 'Paint') o.material.color.set(color);
    });
  }

  repair() {
    const d = this.data;
    d.health = 100;
    d.burning = false;
    d.explodeNow = false;
  }

  // charred shell: dark paint, no lights, nothing works any more
  burnOut() {
    const d = this.data;
    d.wrecked = true;
    d.burning = false;
    d.color = 0x1d1b1a;
    this.siren = false;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color?.multiplyScalar(o.material.name === 'Paint' ? 0 : 0.28);
      if (o.material.name === 'Paint') o.material.color.set(0x1d1b1a);
      if (o.material.roughness !== undefined) o.material.roughness = Math.max(0.75, o.material.roughness);
      if (o.material.metalness !== undefined) o.material.metalness = 0.2;
      if (o.material.emissive) o.material.emissiveIntensity = 0;
    });
    this.headMat = this.tailMat = this.signMat = null;
    this.sirenMats = [];
  }

  // flooded: dead engine, lights out
  drown() {
    const d = this.data;
    d.wrecked = true;
    d.drowned = true;
    d.health = 0;
    d.burning = false;
    this.siren = false;
    for (const m of [this.headMat, this.tailMat, ...this.sirenMats]) if (m) m.emissiveIntensity = 0;
    this.headMat = this.tailMat = this.signMat = null;
    this.sirenMats = [];
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return this.spec.circles.map((o) => [this.pos.x + fx * o, this.pos.z + fz * o]);
  }

  update(dt, ctl, city, night, wet = 0) {
    const s = this.spec;
    if (this.towedBy) return this.towUpdate(dt, city);
    if (s.boat) return this.updateBoat(dt, ctl, city, night);
    const wreck = this.data.wrecked;
    if (this.doorSwing && !this.data.entering) {
      this.doorOpen = Math.max(0, this.doorOpen + this.doorSwing * dt);
      if (!this.doorOpen) this.doorSwing = 0;
    }
    if (wreck) ctl = null;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = this.vel.x * rx + this.vel.z * rz;
    // airborne (ramp jump, blast): no traction until the wheels touch down
    const air = this.hopY > 0.3 && !this.rampOn;
    const thr = ctl && !air ? ctl.throttle : 0, steerIn = ctl ? ctl.steer : 0, hb = ctl && !air && ctl.handbrake;
    this.hb = !!hb;
    this.idle = !thr; // (nobody on the pedals: stopped on a hill, it holds)

    this.braking = false;
    if (thr > 0) {
      if (vf < -0.5) {
        vf = Math.min(0, vf + s.brake * dt);
        this.braking = true;
      } else vf += s.engine * thr * Math.max(0.04, 1 - vf / s.vmax) * dt;
    } else if (thr < 0) {
      if (vf > 0.5) {
        vf = Math.max(0, vf - s.brake * dt);
        this.braking = true;
      } else vf -= s.engine * 0.55 * Math.max(0, 1 + vf / s.reverse) * dt;
    } else if (!air) {
      // (nobody at the wheel: a parked car has its handbrake on, a shove doesn't send it far)
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (ctl ? 1.6 : wreck ? 14 : 10) * dt);
    }
    if (hb) {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 6 * dt);
      this.braking = true;
    }
    // nitro (fitted at Sol Customs): a hard push while held, the bottle refills slowly
    this.boosting = !!(ctl?.nitro && this.data.tune?.nitro && thr > 0 && !air && this.nitro > 0);
    if (this.boosting) {
      vf += 13 * dt * Math.max(0, 1 - vf / (s.vmax * 1.25));
      this.nitro = Math.max(0, this.nitro - dt);
    } else this.nitro = Math.min(NITRO_SECS, this.nitro + dt * 0.28);
    vf -= vf * Math.abs(vf) * 0.0007 * dt;
    this.throttle = Math.max(0, thr);

    // (a bike's short wheelbase turns sharply: at speed its bars give less, and they move gentler)
    const maxSteer = s.steer / (1 + Math.abs(vf) * (s.bike ? 0.15 : 0.05));
    this.steer += (steerIn * maxSteer - this.steer) * (1 - Math.exp(-(s.bike ? 6 : 7) * dt));
    const targetW = (vf / s.wheelbase) * Math.tan(this.steer) * (hb ? 1.6 : 1);
    if (!air) this.angVel += (targetW - this.angVel) * (1 - Math.exp(-(hb ? 2.5 : 9) * dt));
    // wet roads: less grip, longer slides
    if (!air) vl *= Math.exp(-(hb ? 1.4 : s.grip * (1 - 0.32 * wet)) * dt);
    this.slip = Math.abs(vl);

    // world velocity from the pre-turn basis: a fast turn leaves lateral momentum (drift)
    this.vel.set(fx * vf + rx * vl, 0, fz * vf + rz * vl);
    this.heading += this.angVel * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.collideStatic(city);
    this.followTerrain(dt, city);

    // visual suspension
    const aLong = (vf - this.prevVf) / Math.max(dt, 1e-4);
    this.prevVf = vf;
    this.vf = vf;
    const tPitch = THREE.MathUtils.clamp(-aLong * 0.005, -0.04, 0.045);
    let tRoll = THREE.MathUtils.clamp(vf * this.angVel * 0.005, -0.05, 0.05);
    if (s.bike) {
      // lean into the turn; parked bikes rest on the side stand
      // (about half the lean the physics would ask for: a full one reads as falling over)
      tRoll = this.driven || this.data.ai ? THREE.MathUtils.clamp(-0.55 * Math.atan((vf * this.angVel) / 9.81), -0.42, 0.42) : -0.2;
    }
    this.pitchV += ((tPitch - this.pitch) * 90 - this.pitchV * 11) * dt;
    this.rollV += ((tRoll - this.roll) * 90 - this.rollV * 11) * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
    if (this.hopY > 0 || this.hopV > 0) {
      this.hopV -= 20 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        if (this.hopV < -9) this.damage((-this.hopV - 9) * 1.5);
        if (this.hopV < -3) this.impact = Math.max(this.impact, -this.hopV * 0.5);
        this.hopV = this.hopV < -3 ? -this.hopV * 0.3 : 0;
      }
    }

    this.spin += (vf / s.radius) * dt;
    const lit = (this.driven || this.data.ai) && night;
    if (this.signMat) this.signMat.emissiveIntensity = night ? 2.2 : 0.25;
    if (this.sirenMats.length) {
      this.sirenT += dt;
      const ph = Math.floor(this.sirenT * 6) % 4;
      this.sirenMats.forEach((m, i) => (m.emissiveIntensity = this.siren && ((i % 2 === 0) === ph < 2) ? (ph % 2 ? 3 : 6) : 0));
    }
    if (this.headMat) this.headMat.emissiveIntensity = lit ? 3 : 0;
    this.lightPool.visible = this.lightCone.visible = lit && !!this.headMat && this.hopY < 0.3;
    if (this.tailMat) this.tailMat.emissiveIntensity = this.braking ? 5 : lit ? 1.2 : 0;
    this.sync();
  }

  // boats and the jetski: thrust and a rudder that bites harder with speed, the water's drag,
  // sliding through turns; they ride the swell, lift the bow under power and lean into turns.
  // They can't go where the water is shallower than they sit (the beach, the quay).
  updateBoat(dt, ctl, city, night) {
    const s = this.spec;
    if (this.data.wrecked) ctl = null;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz, vl = this.vel.x * rx + this.vel.z * rz;
    const thr = ctl ? ctl.throttle : 0, steerIn = ctl ? ctl.steer : 0;
    this.braking = false;
    if (thr > 0) vf += s.engine * thr * Math.max(0, 1 - vf / s.vmax) * dt;
    else if (thr < 0) {
      this.braking = vf > 0.5;
      vf -= s.engine * 0.6 * Math.max(0, 1 + vf / s.reverse) * dt;
    }
    vf -= vf * (thr ? 0.12 : 0.45) * dt; // water drag: it coasts to a stop with the throttle off
    this.throttle = Math.max(0, thr);
    this.steer += (steerIn * s.steer - this.steer) * (1 - Math.exp(-5 * dt));
    const bite = 0.3 + Math.min(1, Math.abs(vf) / 9);
    this.angVel += (this.steer * bite * 1.5 * (vf < -0.2 ? -1 : 1) - this.angVel) * (1 - Math.exp(-2.6 * dt));
    vl *= Math.exp(-s.grip * dt);
    this.slip = Math.abs(vl);
    this.vel.set(fx * vf + rx * vl, 0, fz * vf + rz * vl);
    this.vf = vf;
    this.heading += this.angVel * dt;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    // aground: back off the shallows / the quay wall
    if (city.waterDepth(this.pos.x, this.pos.z) < s.draft || city.waterDepth(this.pos.x + fx * s.halfL * 0.8, this.pos.z + fz * s.halfL * 0.8) < s.draft * 0.6) {
      this.pos.x = px;
      this.pos.z = pz;
      const sp = this.speed;
      this.impact = Math.max(this.impact, sp);
      if (sp > 9) this.damage((sp - 9) * 1.2);
      this.vel.multiplyScalar(-0.3);
      this.angVel *= 0.5;
    }
    this.collideStatic(city);
    // the swell (roughly the sea shader's) under the hull
    this.wave += dt;
    const t = this.wave;
    this.groundY = city.WATER_Y + 0.07 * Math.sin(t * 1.5 + this.pos.x * 0.21) + 0.045 * Math.sin(t * 2.2 + this.pos.z * 0.33);
    const tP = -Math.min(0.14, Math.max(0, vf) * 0.007) + 0.03 * Math.sin(t * 1.3 + this.pos.z * 0.2);
    const tR = THREE.MathUtils.clamp(-this.angVel * Math.max(0, vf) * (s.bike ? 0.05 : 0.02), -0.4, 0.4) + 0.03 * Math.sin(t * 1.1 + this.pos.x * 0.25);
    const k = 1 - Math.exp(-4 * dt);
    this.tPitch += (tP - this.tPitch) * k;
    this.tRoll += (tR - this.tRoll) * k;
    this.pitch = this.roll = 0;
    this.hopY = 0;
    const lit = (this.driven || this.data.ai) && night;
    if (this.headMat) this.headMat.emissiveIntensity = lit ? 3 : 0;
    if (this.tailMat) this.tailMat.emissiveIntensity = lit ? 1.2 : 0;
    this.lightPool.visible = false;
    this.lightCone.visible = lit && !!this.headMat;
    this.sync();
  }

  // hanging on behind a truck / the tow truck: the hitch drags the pivot along, the axle
  // follows it round corners (a towed car rides on its back wheels, nose up on the boom)
  towUpdate(dt, city) {
    const t = this.towedBy, s = this.spec;
    const tf = [Math.sin(t.heading), Math.cos(t.heading)];
    const hx = t.pos.x + tf[1] * t.hitch.x + tf[0] * t.hitch.z, hz = t.pos.z - tf[0] * t.hitch.x + tf[1] * t.hitch.z;
    const axle = s.axle ?? -s.wheelbase / 2; // where it rolls (local z)
    const f = [Math.sin(this.heading), Math.cos(this.heading)];
    const ax = this.pos.x + f[0] * axle, az = this.pos.z + f[1] * axle;
    let dx = hx - ax, dz = hz - az;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // no folding up: the tow can't swing round more than ~100 degrees
    let h = Math.atan2(dx, dz);
    const rel = Math.atan2(Math.sin(h - t.heading), Math.cos(h - t.heading));
    if (Math.abs(rel) > 1.75) h = t.heading + Math.sign(rel) * 1.75;
    const nx = hx - Math.sin(h) * this.pivot.z, nz = hz - Math.cos(h) * this.pivot.z;
    this.vel.set((nx - this.pos.x) / Math.max(dt, 1e-4), 0, (nz - this.pos.z) / Math.max(dt, 1e-4));
    this.angVel = Math.atan2(Math.sin(h - this.heading), Math.cos(h - this.heading)) / Math.max(dt, 1e-4);
    this.pos.set(nx, 0, nz);
    this.heading = h;
    this.vf = this.vel.x * Math.sin(h) + this.vel.z * Math.cos(h);
    this.spin += (this.vf / s.radius) * dt;
    this.followTerrain(dt, city);
    if (!this.trailer) this.tPitch = -0.11; // a car on the boom: front wheels up
    this.pitch = this.roll = 0;
    this.sync();
  }

  get trailer() {
    return this.data.model === 'trailer';
  }

  // ride on the hill: height from the terrain, body tilted to the slope, gravity along it
  followTerrain(dt, city) {
    const ter = city.terrain;
    let gy = ter ? ter(this.pos.x, this.pos.z) : 0;
    // off the beach: down the sea bed
    if (city.EXT && gy <= 0.01 && Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > city.EXT) gy = city.groundHeight(this.pos.x, this.pos.z);
    let pitch = 0, roll = 0;
    if (gy > 0.01 || this.groundY > 0.01) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = -fz, rz = fx;
      const slope = (ter(this.pos.x + fx * 1.4, this.pos.z + fz * 1.4) - ter(this.pos.x - fx * 1.4, this.pos.z - fz * 1.4)) / 2.8;
      const side = (ter(this.pos.x - rx * 0.9, this.pos.z - rz * 0.9) - ter(this.pos.x + rx * 0.9, this.pos.z + rz * 0.9)) / 1.8;
      // a bit more than real gravity: cars stall on slopes steeper than ~35 degrees and slide back;
      // stopped with nobody on the pedals, a car holds on anything gentler (in gear, handbrake on)
      if (this.idle !== false && this.speed < 1.5 && Math.abs(slope) < 0.7) {
        this.vel.multiplyScalar(Math.exp(-8 * dt));
      } else {
        const g = (9.8 * 1.6 * slope) / Math.sqrt(1 + slope * slope);
        this.vel.x -= fx * g * dt;
        this.vel.z -= fz * g * dt;
      }
      pitch = THREE.MathUtils.clamp(-Math.atan(slope), -0.7, 0.7);
      roll = THREE.MathUtils.clamp(Math.atan(side), -0.6, 0.6);
    }
    this.groundY = gy;
    // driven into the sea: the water drags the car to a stop, and once it's in over the sills
    // the engine floods and that's the end of it (no fire, it just sits there under the water)
    const depth = (city.WATER_Y ?? -9) - gy;
    if (depth > 0.45 && !this.spec.boat) {
      this.vel.multiplyScalar(Math.exp(-(depth > 0.9 ? 2.4 : 1.1) * dt));
      this.angVel *= Math.exp(-3 * dt);
      if (depth > 0.9 && !this.data.wrecked && (this.flood = (this.flood || 0) + dt) > 2.2) this.drown();
    } else this.flood = 0;
    const k = Math.min(1, dt * 10);
    this.tPitch += (pitch - this.tPitch) * k;
    this.tRoll += (roll - this.tRoll) * k;
  }

  collideStatic(city) {
    const b = city.bounds - 1;
    for (const axis of ['x', 'z']) {
      if (Math.abs(this.pos[axis]) > b) {
        const sgn = Math.sign(this.pos[axis]);
        this.pos[axis] = sgn * b;
        if (this.vel[axis] * sgn > 0) this.bounce(axis === 'x' ? -sgn : 0, axis === 'z' ? -sgn : 0, 0.2, this.pos.x, this.pos.z);
      }
    }
    const R = this.spec.r;
    for (const [cx, cz] of this.circles()) {
      for (const c of city.query(cx - 1.2, cx + 1.2, cz - 1.2, cz + 1.2)) {
        if (c.h < 0.3) continue;
        let nx, nz, pen;
        if (c.type === 'box') {
          const qx = THREE.MathUtils.clamp(cx, c.minX, c.maxX), qz = THREE.MathUtils.clamp(cz, c.minZ, c.maxZ);
          const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d < 1e-6) continue;
          nx = dx / d;
          nz = dz / d;
          pen = R - d;
        } else {
          const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz), r = R + c.r;
          if (d >= r || d < 1e-6) continue;
          nx = dx / d;
          nz = dz / d;
          pen = r - d;
        }
        this.pos.x += nx * pen;
        this.pos.z += nz * pen;
        this.bounce(nx, nz, 0.25, cx, cz);
      }
    }
  }

  bounce(nx, nz, e, cx, cz) {
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn >= 0) return;
    this.vel.x -= (1 + e) * vn * nx;
    this.vel.z -= (1 + e) * vn * nz;
    this.vel.multiplyScalar(0.9);
    const rxw = cx - this.pos.x, rzw = cz - this.pos.z;
    this.angVel += (rzw * (-vn * nx) - rxw * (-vn * nz)) * 0.08;
    this.impact = Math.max(this.impact, -vn);
    // only real crashes hurt: scrapes and bumps are free
    if (-vn > 9) this.damage((-vn - 9) * 1.6);
    if (-vn > 3.5) this.crashAt = { x: cx + (cx - this.pos.x) * 0.3, z: cz + (cz - this.pos.z) * 0.3, s: -vn };
  }

  sync() {
    this.object.position.copy(this.pos);
    this.object.position.y = this.groundY + this.hopY;
    this.object.rotation.set(this.tPitch, this.heading, this.tRoll, 'YXZ');
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const w of this.wheels) {
      // the body pitches and rolls on its springs: where it comes down onto a wheel further
      // than the arch allows, the wheel goes down with it (it never pokes through the wing)
      if (!this.fork) {
        _p.copy(w.at).applyEuler(this.body.rotation);
        w.o.position.copy(w.at);
        w.o.position.y += Math.min(0, _p.y - w.at.y + 0.06);
      }
      w.o.quaternion.copy(w.rest);
      if (w.front && !this.fork) w.o.quaternion.multiply(_q.setFromAxisAngle(UP, this.steer));
      w.o.quaternion.multiply(_q.setFromAxisAngle(X_AXIS, this.spin));
    }
    if (this.fork) this.fork.quaternion.copy(this.forkRest).multiply(_q.setFromAxisAngle(UP, this.steer));
    if (this.doorMesh) this.doorMesh.quaternion.copy(this.doorRest).multiply(_q.setFromAxisAngle(UP, -1.15 * this.doorOpen));
  }

  setShadows(on) {
    if (this.shadows === on) return;
    this.shadows = on;
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = on;
    });
  }

  dispose(scene) {
    scene.remove(this.object);
  }
}

// parked-car batches have room for this many more cars (abandoned, wrecked, parked police cars)
const CAR_HEADROOM = 48;

export class Vehicles {
  constructor(scene, city, models) {
    this.scene = scene;
    this.city = city;
    this.models = models;
    // a model that failed to load falls back to the sedan
    this.cars = city.parkedCars.map((c, i) => ({ ...c, model: models[c.model] ? c.model : 'sedan', id: i, vehicle: null }));
    this.active = new Set();
    this.batches = {};
    this.refreshTimer = 0;
    this.dirty = true;
    for (const [name, gltf] of Object.entries(models)) {
      const list = this.cars.filter((c) => c.model === name);
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        let mat = o.material;
        if (mat.name === 'Paint') {
          mat = mat.clone();
          mat.color.set(0xffffff);
        }
        // two sets: near cars cast shadows, far ones don't
        const [near, far] = [true, false].map((shadow) => {
          const inst = new THREE.InstancedMesh(o.geometry, mat, list.length + CAR_HEADROOM);
          inst.castShadow = shadow;
          inst.receiveShadow = true;
          inst.frustumCulled = false;
          this.scene.add(inst);
          return inst;
        });
        parts.push({ near, far, rel: o.matrixWorld.clone(), paint: mat.name === 'Paint' });
      });
      this.batches[name] = { parts, list };
    }
  }

  // only parked cars near the camera are drawn (fog hides the rest)
  refreshInstances(cam) {
    const FAR2 = 170 * 170, NEAR2 = 50 * 50, col = new THREE.Color(), tmp = new THREE.Matrix4();
    for (const { parts, list } of Object.values(this.batches)) {
      let kn = 0, kf = 0;
      for (const c of list) {
        const d2 = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2;
        if (c.vehicle || d2 > FAR2) continue;
        const near = d2 < NEAR2 && kn < parts[0].near.instanceMatrix.count;
        if (!near && kf >= parts[0].far.instanceMatrix.count) continue;
        const k = near ? kn++ : kf++;
        _q.setFromAxisAngle(UP, c.yaw);
        if (specOf(c).bike) _q.multiply(_q2.setFromAxisAngle(Z_AXIS, -0.2)); // on the side stand
        _m.compose(_p.set(c.x, specOf(c).boat ? this.city.WATER_Y : this.city.terrain ? this.city.terrain(c.x, c.z) : 0, c.z), _q, _s);
        for (const p of parts) {
          const inst = near ? p.near : p.far;
          inst.setMatrixAt(k, tmp.multiplyMatrices(_m, p.rel));
          if (p.paint) inst.setColorAt(k, col.set(c.color));
        }
      }
      for (const p of parts) {
        for (const [inst, n] of [[p.near, kn], [p.far, kf]]) {
          inst.count = n;
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        }
      }
    }
    // moving cars only cast shadows near the camera too
    for (const c of this.active) c.vehicle.setShadows((c.vehicle.pos.x - cam.x) ** 2 + (c.vehicle.pos.z - cam.z) ** 2 < NEAR2);
    this.dirty = false;
  }

  activate(c) {
    if (c.vehicle) return c.vehicle;
    c.vehicle = new Vehicle(c, this.models[c.model], this.scene);
    c.vehicle.onFire = () => this.onFire?.(c);
    this.active.add(c);
    this.dirty = true;
    return c.vehicle;
  }

  deactivate(c) {
    const v = c.vehicle;
    c.x = v.pos.x;
    c.z = v.pos.z;
    c.yaw = v.heading;
    v.dispose(this.scene);
    c.vehicle = null;
    this.active.delete(c);
    // cars that started life as traffic join the parked (instanced) fleet
    const batch = this.batches[c.model];
    if (!batch.list.includes(c)) batch.list.push(c);
    this.dirty = true;
  }

  // a traffic car that becomes an active vehicle straight away
  spawn(data) {
    const c = { ...data, model: this.models[data.model] ? data.model : 'sedan', id: this.cars.length, vehicle: null, spawned: true };
    this.cars.push(c);
    this.activate(c);
    return c;
  }

  addParked(data) {
    const c = { ...data, model: this.models[data.model] ? data.model : 'sedan', id: this.cars.length + 100000 + Math.floor(Math.random() * 1e6), vehicle: null };
    this.cars.push(c);
    this.batches[c.model]?.list.push(c);
    this.dirty = true;
    return c;
  }

  // hitch b on behind a (a trailer on the truck, a car on the tow truck); null: let go
  hitch(a, b) {
    const va = this.activate(a), vb = this.activate(b);
    va.towing = vb;
    vb.towedBy = va;
  }

  unhitch(a) {
    const va = a.vehicle;
    if (!va?.towing) return;
    va.towing.towedBy = null;
    va.towing.vel.set(0, 0, 0);
    va.towing = null;
  }

  remove(c) {
    if (c.vehicle) c.vehicle.dispose(this.scene);
    c.vehicle = null;
    this.active.delete(c);
    this.cars.splice(this.cars.indexOf(c), 1);
  }

  // car whose driver door (or body) is within reach
  nearest(pos, reach = 3.2) {
    let best = null, bd = reach;
    for (const c of this.cars) {
      if (c.wrecked) continue;
      const x = c.vehicle ? c.vehicle.pos.x : c.x, z = c.vehicle ? c.vehicle.pos.z : c.z;
      if (Math.abs(x - pos.x) > 9 || Math.abs(z - pos.z) > 9) continue;
      // (distance to the body's footprint: you can get into a bus from its door, not its middle)
      const sp = specOf(c), h = c.vehicle ? c.vehicle.heading : c.yaw;
      const lx = (x - pos.x) * Math.cos(h) - (z - pos.z) * Math.sin(h), lz = (x - pos.x) * Math.sin(h) + (z - pos.z) * Math.cos(h);
      const d = Math.hypot(Math.max(0, Math.abs(lx) - sp.halfW), Math.max(0, Math.abs(lz) - sp.halfL)) + Math.min(1.2, sp.halfW);
      if (sp.wheelbase > 9) continue; // (a trailer has no cab)
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  pose(c) {
    return c.vehicle ? [c.vehicle.pos.x, c.vehicle.pos.z, c.vehicle.heading] : [c.x, c.z, c.yaw];
  }

  update(dt, driven, ctl, night, cam) {
    // cars that were left lying about (abandoned traffic, wrecks) go once nobody can see them,
    // so the fleet does not grow for ever and nothing blocks a lane for good
    if ((this.sweepTimer = (this.sweepTimer || 0) - dt) <= 0) {
      this.sweepTimer = 3;
      for (const c of [...this.cars]) {
        if (!c.spawned || c.vehicle || c.owned || c.keep || c.job) continue; // keep: a story mission needs it; job: a depot's vehicle
        if ((c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < 190 * 190) continue;
        const b = this.batches[c.model];
        if (b) b.list.splice(b.list.indexOf(c), 1);
        this.cars.splice(this.cars.indexOf(c), 1);
        this.dirty = true;
      }
    }
    if ((this.refreshTimer -= dt) <= 0 || this.dirty) {
      this.refreshTimer = 0.5;
      this.refreshInstances(cam);
    }
    for (const c of this.active) c.vehicle.update(dt, c === driven ? ctl : c.ai ? c.ai.ctl : null, this.city, night, this.wet || 0);
    this.resolvePairs();
    for (const c of [...this.active]) {
      const v = c.vehicle;
      if (!v) continue; // removed earlier in this loop (an explosion next to it, a despawn)
      v.impact *= Math.exp(-6 * dt);
      if (c.explodeNow) this.explode(c);
      if (v.crashAt) {
        this.onCrash?.(v.crashAt.x, v.crashAt.z, v.crashAt.s);
        v.crashAt = null;
      }
      // damaged cars stay simulated so they keep smoking / burning
      const busy = c.burning || c.smolder > 0 || c.health < 65 || v.doorOpen > 0.01 || c.entering || c.roadblock;
      if (c !== driven && !c.ai && !busy && v.speed < 0.05 && Math.abs(v.angVel) < 0.02) {
        // tuned cars stay full models: the instanced fleet can't show tinted glass or painted rims
        if ((v.restTime += dt) > 2 && !c.tune && !v.towedBy && !v.towing && !c.keep) this.deactivate(c);
      } else v.restTime = 0;
    }
    if (this.fx) this.effects(dt, cam);
  }

  explode(c) {
    const v = c.vehicle;
    c.explodeNow = false;
    c.health = 0;
    c.smolder = 30;
    v.burnOut();
    v.hopV = 6.5;
    v.pitchV += (Math.random() - 0.5) * 6;
    v.rollV += (Math.random() - 0.5) * 8;
    v.angVel += (Math.random() - 0.5) * 2;
    c.ai = null;
    this.dirty = true;
    this.fx?.explosion(v.pos);
    this.onExplode?.(c);
  }

  // engine smoke, fire, tyre smoke and skid marks for cars near the camera
  effects(dt, cam) {
    const fx = this.fx;
    for (const c of this.active) {
      const v = c.vehicle, s = v.spec;
      const d2 = (v.pos.x - cam.x) ** 2 + (v.pos.z - cam.z) ** 2;
      if (d2 > 110 * 110) {
        // out of sight the fire still burns down
        if (c.burning && !c.fireJob && (c.health -= dt * 2.4) <= 0) c.explodeNow = true;
        else if (c.wrecked) c.smolder -= dt;
        continue;
      }
      const fxh = Math.sin(v.heading), fzh = Math.cos(v.heading);
      const rx = -fzh, rz = fxh;
      // engine bay (front of the car; bikes: under the tank)
      const ex = v.pos.x + fxh * (s.bike ? 0.1 : s.halfL - 0.75), ez = v.pos.z + fzh * (s.bike ? 0.1 : s.halfL - 0.75);
      const gy = v.groundY || 0;
      const ey = gy + v.hopY + (s.bike ? 0.7 : 0.95);
      if (c.burning) {
        if (!c.fireJob) c.health -= dt * 2.4; // (a fire job's car burns until it is put out)
        if (c.health <= 0) c.explodeNow = true;
        fx.burning(ex, ey, ez, d2 < 60 * 60 ? 1 : 0.5);
        for (v.fireAcc += dt * 34; v.fireAcc > 1; v.fireAcc--) fx.flames(ex, ey - 0.1, ez, 1);
        for (v.smokeAcc += dt * 9; v.smokeAcc > 1; v.smokeAcc--) fx.engineSmoke(ex, ey + 0.8, ez, 1);
      } else if (c.wrecked) {
        if ((c.smolder -= dt) > 0) {
          const k = c.smolder / 30;
          if (c.smolder > 18) for (v.fireAcc += dt * 26 * k; v.fireAcc > 1; v.fireAcc--) fx.flames(v.pos.x + (Math.random() - 0.5) * 2, gy + 0.7, v.pos.z + (Math.random() - 0.5) * 2, 0.9);
          if (c.smolder > 18) fx.burning(v.pos.x, gy + 0.8, v.pos.z, k);
          for (v.smokeAcc += dt * 10 * k; v.smokeAcc > 1; v.smokeAcc--) fx.engineSmoke(v.pos.x, gy + 1.2, v.pos.z, 1);
        }
      } else if (c.health < 65) {
        const dark = THREE.MathUtils.clamp((40 - c.health) / 25, 0, 1);
        for (v.smokeAcc += dt * (5 + 12 * (1 - c.health / 65)); v.smokeAcc > 1; v.smokeAcc--) fx.engineSmoke(ex, ey, ez, dark);
      }
      // boats: spray at the bow and a wake behind
      if (s.boat) {
        if (v.speed > 2 && d2 < 90 * 90) {
          for (v.tyreAcc += dt * v.speed * 1.6; v.tyreAcc > 1; v.tyreAcc--) {
            const b = Math.random() < 0.5, sd = Math.random() < 0.5 ? -1 : 1;
            const along = b ? s.halfL * 0.6 : -s.halfL, side = b ? sd * s.halfW * 0.9 : (Math.random() - 0.5) * s.halfW;
            fx.wake(v.pos.x + fxh * along + rx * side, v.groundY, v.pos.z + fzh * along + rz * side, rx * sd * (b ? 2 : 0.4), fxh * -v.vf * 0.2, fzh * -v.vf * 0.2, b);
          }
        }
        continue;
      }
      // sliding tyres: rubber on the road + smoke
      if (d2 > 80 * 80 || c.wrecked) continue;
      const slide = v.slip > 3.2 || (v.hb && v.speed > 4) || (v.braking && v.speed > 9 && v.throttle === 0 && Math.abs(v.vf) > 9 && v.driven);
      if (!slide) continue;
      const amount = THREE.MathUtils.clamp((Math.max(v.slip, v.hb ? 4 : 3.5) - 3) / 7, 0.1, 1);
      const half = s.wheelbase / 2, w = s.bike ? 0 : s.halfW - 0.18;
      const wheels = s.bike ? [[-half, 0]] : [[-half, w], [-half, -w], ...(v.slip > 6 ? [[half, w], [half, -w]] : [])];
      v.tyreAcc += dt * 26 * amount;
      const puffs = Math.floor(v.tyreAcc);
      v.tyreAcc -= puffs;
      wheels.forEach(([a, b], k) => {
        const x = v.pos.x + fxh * a + rx * b, z = v.pos.z + fzh * a + rz * b;
        fx.skid(c.id * 4 + k, x, z, s.bike ? 0.14 : 0.22);
        if (k < 2) for (let i = 0; i < puffs; i++) fx.tyreSmoke(x, z, amount, v.vel.x, v.vel.z);
      });
    }
  }

  resolvePairs() {
    for (const a of [...this.active]) {
      const va = a.vehicle;
      if (!va) continue;
      for (const b of this.cars) {
        if (b === a) continue;
        // (a traffic car slipping out of a jam passes through the other traffic, not through you)
        if ((a.ghost && b.ai) || (b.ghost && a.ai)) continue;
        const [bx, bz, bh] = this.pose(b);
        if (Math.abs(bx - va.pos.x) > va.spec.halfL + MAX_HALF_L + 2 || Math.abs(bz - va.pos.z) > va.spec.halfL + MAX_HALF_L + 2) continue;
        // (the truck and its trailer; a parked car has no vehicle yet, and null is not a trailer)
        if (b.vehicle && (va.towing === b.vehicle || va.towedBy === b.vehicle)) continue;
        const bf = [Math.sin(bh), Math.cos(bh)];
        const sb = specOf(b), rr = va.spec.r + sb.r;
        for (const [ax, az] of va.circles()) {
          for (const o of sb.circles) {
            const cx = bx + bf[0] * o, cz = bz + bf[1] * o;
            const dx = ax - cx, dz = az - cz, d = Math.hypot(dx, dz);
            if (d >= rr || d < 1e-6) continue;
            const vb = this.activate(b);
            const nx = dx / d, nz = dz / d, pen = rr - d;
            va.pos.x += nx * pen * 0.5;
            va.pos.z += nz * pen * 0.5;
            vb.pos.x -= nx * pen * 0.5;
            vb.pos.z -= nz * pen * 0.5;
            const rvx = va.vel.x - vb.vel.x, rvz = va.vel.z - vb.vel.z;
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              const j = (-(1 + 0.3) * vn) / 2;
              va.vel.x += j * nx;
              va.vel.z += j * nz;
              vb.vel.x -= j * nx;
              vb.vel.z -= j * nz;
              const mx = (ax + cx) / 2, mz = (az + cz) / 2;
              va.angVel += ((mz - va.pos.z) * j * nx - (mx - va.pos.x) * j * nz) * 0.12;
              vb.angVel -= ((mz - vb.pos.z) * j * nx - (mx - vb.pos.x) * j * nz) * 0.12;
              va.impact = Math.max(va.impact, -vn);
              vb.impact = Math.max(vb.impact, -vn);
              if (-vn > 6) {
                va.damage(Math.max(0, -vn - 9) * 1.3);
                vb.damage(Math.max(0, -vn - 9) * 1.3);
                this.onCrash?.(mx, mz, -vn);
              }
            }
            va.sync();
            vb.sync();
          }
        }
      }
    }
  }

  // push a walking character (circle) out of every car; returns true if hit by a moving car
  collideCircle(p, r) {
    let hit = 0;
    for (const c of this.cars) {
      const v = c.vehicle, x = v ? v.pos.x : c.x, z = v ? v.pos.z : c.z; // (no array: this runs for every person, every frame)
      if (Math.abs(x - p.x) > MAX_HALF_L + 1 || Math.abs(z - p.z) > MAX_HALF_L + 1) continue;
      const h = v ? v.heading : c.yaw;
      const spec = specOf(c);
      if (Math.abs(x - p.x) > spec.halfL + 1 && Math.abs(z - p.z) > spec.halfL + 1) continue;
      const s = Math.sin(h), co = Math.cos(h);
      const dx = p.x - x, dz = p.z - z;
      const lx = dx * co - dz * s, lz = dx * s + dz * co; // into car space (+Z forward)
      const qx = THREE.MathUtils.clamp(lx, -spec.halfW, spec.halfW), qz = THREE.MathUtils.clamp(lz, -spec.halfL, spec.halfL);
      let ex = lx - qx, ez = lz - qz;
      let d = Math.hypot(ex, ez);
      if (d >= r) continue;
      if (d < 1e-6) {
        // inside: leave sideways
        ex = lx >= 0 ? 1 : -1;
        ez = 0;
        d = 0;
        const push = spec.halfW - Math.abs(lx) + r;
        p.x += (ex * co) * push;
        p.z += (-ex * s) * push;
      } else {
        const k = (r - d) / d;
        p.x += (ex * co + ez * s) * k;
        p.z += (-ex * s + ez * co) * k;
      }
      if (c.vehicle) hit = Math.max(hit, c.vehicle.speed);
    }
    return hit;
  }
}
