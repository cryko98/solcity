// Pedestrians: male and female Blender models with randomised outfits (tinted
// materials), walking loops around the blocks, crossing at the zebra crossings
// when the lights allow. Punch one and it fights back; six hits and it goes
// down for good and drops cash. Cars knock them over too.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { prepareCharacter, retargetClips, chooseOutfit } from './materials.js';

const _door = new THREE.Vector3();
// states in which a person stays put (sitting, chatting, lying, in a car, boarding one)
const STILL = new Set(['down', 'riding', 'seated', 'talking', 'board']);
const MAX_PEDS = 24, SPAWN_MIN = 25, SPAWN_MAX = 110, DESPAWN = 140, RADIUS = 0.3, KO_HITS = 6;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const cornerIndex = (sx, sz) => CORNERS.findIndex(([a, b]) => a === sx && b === sz);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const UNIFORM = { Shirt: new THREE.Color('#25427e'), Denim: new THREE.Color('#161d2c'), Sneaker: new THREE.Color('#121212'), Hair: new THREE.Color('#1a1410') };
const COP_RUN = 4.3;

const SKIN = ['#7a4a30', '#a8714c', '#c99069', '#e6b897', '#f2cfb0', '#5c3a26'];
const OUTFIT = {
  Shirt: ['#f2f2ee', '#262626', '#b93a3a', '#3d6ea8', '#e3bd52', '#6fa893', '#d98fa8', '#8a5fb0', '#ef8a3c', '#9aa3ab'],
  Denim: ['#3a5a8c', '#262b33', '#6b5a48', '#80838a', '#b8c4d0', '#3f5a45', '#c9b99c', '#1f2a44'],
  Hair: ['#1c1410', '#2a1d14', '#3b2a1a', '#0e0e0e', '#4a3322', '#1c1410', '#5c5c5c', '#6b4a2c', '#9c7444', '#7a2e16'],
  Sneaker: ['#f4f4f4', '#2a2a2a', '#c9302c', '#e8d9b0', '#3a5fa0', '#9a9a9a'],
};

// clips play on any of the three models (same skeleton)
class AnimSet {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.weights = {};
    for (const [name, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      if (['punchl', 'punchr', 'hit', 'knockdown', 'getup'].includes(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      } else a.time = Math.random() * clip.duration;
      a.play();
      a.setEffectiveWeight(0);
      this.actions[name] = a;
      this.weights[name] = 0;
    }
    this.target = { idle: 1 };
  }

  once(name) {
    const a = this.actions[name];
    a.reset();
    a.play();
    return a.getClip().duration;
  }

  update(dt, rate = 12) {
    const k = 1 - Math.exp(-rate * dt);
    for (const n in this.actions) {
      this.weights[n] += ((this.target[n] || 0) - this.weights[n]) * k;
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    this.mixer.update(dt);
  }
}

export class Peds {
  constructor(scene, city, heroGltf, models, vehicles) {
    this.scene = scene;
    this.city = city;
    this.vehicles = vehicles;
    this.models = models; // { male: gltf, female: gltf }
    this.list = [];
    this.cash = [];
    this.spawnTimer = 0;
    this.onCash = null;
    const clip = (n) => heroGltf.animations.find((a) => a.name === n);
    this.clips = Object.fromEntries(['Idle', 'Walk', 'Run', 'Guard', 'PunchL', 'PunchR', 'Hit', 'KnockDown', 'GetUp', 'HandsUp', 'Drive', 'Ride', 'PistolAim', 'SitTalk', 'SitListen', 'StandTalk', 'StandListen'].map((n) => [n.toLowerCase(), clip(n)]).filter(([, c]) => c));
    this.modelClips = {
      male: retargetClips(this.clips, heroGltf.scene, models.male.scene),
      female: retargetClips(this.clips, heroGltf.scene, models.female.scene),
    };
    // police officers: own model if it loaded, otherwise the male model in a uniform
    if (!models.police) models.police = models.male;
    this.modelClips.police = retargetClips(this.clips, heroGltf.scene, models.police.scene);
    this.onCrime = null; // (type, ped) => void
    this.drivers = []; // NPCs sitting in moving traffic (not part of the street crowd)
    for (const m of Object.values(models)) prepareCharacter(m.scene);
    this.cashMat = new THREE.MeshStandardMaterial({ color: 0x5fae5a, emissive: 0x2f8a2a, emissiveIntensity: 0.6, roughness: 0.6 });
    this.bandMat = new THREE.MeshStandardMaterial({ color: 0xf2e6c4, roughness: 0.7 });
    this.cashGeo = new THREE.BoxGeometry(0.16, 0.035, 0.075);
    this.bandGeo = new THREE.BoxGeometry(0.03, 0.04, 0.08);
  }

  makeBody(kind) {
    const root = SkeletonUtils.clone(this.models[kind].scene);
    const colors = { Skin: new THREE.Color(pick(SKIN)) };
    for (const [k, list] of Object.entries(OUTFIT)) colors[k] = new THREE.Color(pick(list));
    if (kind === 'police') Object.assign(colors, UNIFORM);
    colors.HairCards = colors.BrowCards = colors.Hair;
    const meshes = [];
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const c = colors[o.material.name.endsWith('__shirt') ? 'Shirt' : o.material.name];
      if (c) {
        o.material = o.material.clone();
        o.material.color.copy(c);
      }
      o.castShadow = true;
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
      meshes.push(o);
    });
    root.userData.meshes = meshes;
    root.userData.outfit = chooseOutfit(root);
    // only officers carry a sidearm, and it stays out of sight until they draw it
    root.userData.gun = root.getObjectByName('Weapon_Pistol');
    for (const n of ['Weapon_Pistol', 'Weapon_SMG', 'Weapon_Shotgun']) {
      const o = root.getObjectByName(n);
      if (o) o.visible = false;
    }
    return root;
  }

  cornerPoint(bi, bj, k, w) {
    const { BLOCK } = this.city;
    const x0 = this.city.blockMin(bi), z0 = this.city.blockMin(bj);
    const [sx, sz] = CORNERS[k];
    return { x: sx < 0 ? x0 + w : x0 + BLOCK - w, z: sz < 0 ? z0 + w : z0 + BLOCK - w };
  }

  // ------------------------------------------------------------- street life
  // a few people stop for a while: two friends chatting on the pavement, someone sitting on
  // a park bench (talking and listening in turns), then they walk on
  spawnLife(focus) {
    const busy = this.list.filter((p) => p.life).length;
    if (busy >= 6) return;
    const near = (x, z) => {
      const d = Math.hypot(x - focus.x, z - focus.z);
      return d > 22 && d < 85;
    };
    if (Math.random() < 0.5) {
      const free = this.city.benches.filter((b) => b.used < 2 && near(b.x, b.z));
      if (!free.length) return;
      const b = free[Math.floor(Math.random() * free.length)];
      const n = b.used === 0 && Math.random() < 0.6 ? 2 : 1;
      const group = [];
      for (let k = 0; k < n && b.used < 2; k++) {
        const slot = b.used++ ? 0.5 : -0.5;
        const p = this.add(Math.random() < 0.5 ? 'female' : 'male', b.x + b.ax * slot, b.z + b.az * slot, b.yaw);
        const hips = p.body.getObjectByName('hips').position.y * p.scale;
        p.y = b.y + 0.1 - hips;
        p.state = 'seated';
        p.life = { t: 0, until: 35 + Math.random() * 50, bench: b, sit: true, turn: 2 + Math.random() * 3, group };
        group.push(p);
      }
      group.forEach((p, i) => (p.pose = this.lifePose(p, i === 0)));
      return;
    }
    // two people meet on the pavement
    const { N } = this.city;
    for (let attempt = 0; attempt < 6; attempt++) {
      const bi = Math.floor(Math.random() * N), bj = Math.floor(Math.random() * N);
      const k = Math.floor(Math.random() * 4);
      const a = this.cornerPoint(bi, bj, k, 2.4), c = this.cornerPoint(bi, bj, (k + 1) % 4, 2.4);
      const t = 0.2 + Math.random() * 0.6;
      const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
      if (!near(x, z)) continue;
      const ux = (c.x - a.x) / Math.hypot(c.x - a.x, c.z - a.z), uz = (c.z - a.z) / Math.hypot(c.x - a.x, c.z - a.z);
      const group = [];
      for (const s of [-1, 1]) {
        const p = this.add(Math.random() < 0.5 ? 'female' : 'male', x + ux * 0.55 * s, z + uz * 0.55 * s, Math.atan2(-ux * s, -uz * s));
        p.state = 'talking';
        p.life = { t: 0, until: 20 + Math.random() * 35, turn: 2 + Math.random() * 3, group };
        group.push(p);
      }
      group.forEach((p, i) => (p.pose = this.lifePose(p, i === 0)));
      return;
    }
  }

  lifePose(p, talking) {
    const n = (p.state === 'seated' ? 'sit' : 'stand') + (talking ? 'talk' : 'listen');
    return p.anim.actions[n] ? n : p.state === 'seated' ? 'drive' : 'idle';
  }

  updateLife(p, dt) {
    const L = p.life;
    L.t += dt;
    // take turns talking (the first one still there keeps the time)
    const members = L.group.filter((q) => q.life);
    if (members[0] === p && (L.turn -= dt) <= 0) {
      L.turn = 2.5 + Math.random() * 4;
      if (members.length < 2) p.pose = this.lifePose(p, Math.random() < 0.25);
      else {
        const k = Math.floor(Math.random() * members.length);
        members.forEach((q, i) => (q.pose = this.lifePose(q, i === k)));
      }
    }
    if (L.t > L.until) this.endLife(p);
  }

  endLife(p) {
    const L = p.life;
    if (!L) return;
    p.life = null;
    if (L.bench) L.bench.used = Math.max(0, L.bench.used - 1);
    p.pose = null;
    p.y = this.city.groundHeight(p.x, p.z);
    if (L.sit) {
      // stand up a step in front of the bench
      p.x += Math.sin(p.yaw) * 0.5;
      p.z += Math.cos(p.yaw) * 0.5;
    }
    if (p.state === 'seated' || p.state === 'talking') this.rejoin(p);
  }

  spawn(focus) {
    const { N } = this.city;
    for (let attempt = 0; attempt < 6; attempt++) {
      const bi = Math.floor(Math.random() * N), bj = Math.floor(Math.random() * N);
      const w = 1.9 + Math.random() * 1.5;
      const k = Math.floor(Math.random() * 4), dir = Math.random() < 0.5 ? 1 : -1;
      const a = this.cornerPoint(bi, bj, k, w), b = this.cornerPoint(bi, bj, (k + dir + 4) % 4, w);
      const t = Math.random();
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      // a few foot patrols walk the beat
      const kind = Math.random() < 0.07 ? 'police' : Math.random() < 0.45 ? 'female' : 'male';
      const p = this.add(kind, x, z, Math.atan2(b.x - a.x, b.z - a.z));
      Object.assign(p, { bi, bj, k: (k + dir + 4) % 4, dir, w, points: [b] });
      return;
    }
  }

  add(kind, x, z, yaw) {
    const female = kind === 'female';
    const body = this.makeBody(kind);
    const scale = (female ? 0.94 : 1) * (0.95 + Math.random() * 0.1);
    body.scale.setScalar(scale);
    this.scene.add(body);
    const p = {
      body, anim: new AnimSet(body, this.modelClips[kind]), x, z, y: this.city.groundHeight(x, z), yaw,
      speed: 1.1 + Math.random() * 0.45, cur: 0, bi: 0, bj: 0, k: 0, dir: 1, w: 2.5, points: [],
      state: 'walk', timer: 0, vel: new THREE.Vector3(), scale, hits: 0, overlay: null, attackTimer: 1, female, cop: kind === 'police',
    };
    this.list.push(p);
    return p;
  }

  // an officer stepping out of a patrol car to chase the player
  spawnCop(x, z, yaw) {
    const p = this.add('police', x, z, yaw);
    p.state = 'cop';
    p.attackTimer = 1.2;
    return p;
  }

  // ------------------------------------------------------------- taxi fares
  // someone waiting at the kerb for a cab
  spawnFare(x, z, yaw) {
    const p = this.add(Math.random() < 0.45 ? 'female' : 'male', x, z, yaw);
    p.state = 'fare';
    p.keep = true;
    return p;
  }

  // walk to the cab's rear door, then sit in the back
  board(p, v, onBoarded) {
    p.state = 'board';
    p.vehicle = v;
    p.onBoarded = onBoarded;
  }

  seatIn(p, v) {
    p.state = 'riding';
    p.vehicle = v;
    p.overlay = null;
    this.scene.remove(p.body);
    v.body.add(p.body);
    const hips = p.body.getObjectByName('hips').position.y * p.scale;
    // rear bench, passenger side
    p.body.position.set(-v.seat.x, v.seat.y - hips + 0.09, v.seat.z - (v.spec.halfL > 2.5 ? 1.05 : 0.82));
    p.body.rotation.set(0, 0, 0);
    p.anim.target = { drive: 1 };
    for (const n in p.anim.weights) p.anim.weights[n] = n === 'drive' ? 1 : 0;
  }

  // get out on the kerb side and walk off
  alight(p) {
    const v = p.vehicle;
    v.body.remove(p.body);
    this.scene.add(p.body);
    const out = v.root.localToWorld(new THREE.Vector3(-v.seat.x - 1.4, 0, v.seat.z - 0.8));
    p.x = out.x;
    p.z = out.z;
    p.y = this.city.groundHeight(p.x, p.z);
    p.yaw = v.heading - Math.PI / 2;
    p.vehicle = null;
    p.keep = false;
    this.rejoin(p);
  }

  remove(p) {
    p.body.parent?.remove(p.body);
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  // ------------------------------------------------------------- drivers / riders of AI vehicles
  seatDriver(v, kind) {
    const body = this.makeBody(kind);
    const anim = new AnimSet(body, this.modelClips[kind]);
    const hips = body.getObjectByName('hips').position.y;
    const clip = v.spec.bike && anim.actions.ride ? 'ride' : 'drive';
    if (v.spec.bike) body.position.set(v.seat.x, v.seat.y - hips, v.seat.z);
    else body.position.set(v.seat.x, v.seat.y - hips + 0.09, v.seat.z + 0.02);
    const rc = v.spec.recline || 0;
    if (rc) {
      // lie back like the player does in the supercar (pivot at the hips)
      const pivot = new THREE.Vector3(0, hips, 0);
      body.rotation.x = -rc;
      body.position.add(pivot.clone().sub(pivot.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -rc)));
    }
    v.body.add(body);
    anim.target = { [clip]: 1 };
    for (const n in anim.weights) anim.weights[n] = n === clip ? 1 : 0;
    const d = { body, anim, v, kind };
    this.drivers.push(d);
    v.npcDriver = d;
    return d;
  }

  unseatDriver(v) {
    const d = v.npcDriver;
    if (!d) return null;
    v.body.remove(d.body);
    this.drivers.splice(this.drivers.indexOf(d), 1);
    v.npcDriver = null;
    return d;
  }

  updateDrivers(dt) {
    for (const d of [...this.drivers]) {
      // the vehicle was despawned or parked: its driver goes with it
      if (!d.v.object.parent) {
        this.drivers.splice(this.drivers.indexOf(d), 1);
        d.v.npcDriver = null;
        continue;
      }
      d.anim.update(dt, 10);
    }
  }

  // a driver pulled out of their car runs away
  spawnFleeing(x, z, from) {
    const p = this.add(Math.random() < 0.45 ? 'female' : 'male', x, z, 0);
    p.state = 'flee';
    p.timer = 6;
    p.fleeFrom = { x: from.x, z: from.z };
    return p;
  }

  // standing people within r of a point (witnesses), and whether an officer is among them
  witnesses(pos, r) {
    let n = 0, cop = false;
    for (const p of this.list) {
      if (p.state === 'down' || p.state === 'riding' || Math.abs(p.x - pos.x) > r || Math.abs(p.z - pos.z) > r) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > r) continue;
      n++;
      if (p.cop) cop = true;
    }
    return { n, cop };
  }

  get cops() {
    return this.list.filter((p) => p.cop && p.state !== 'down');
  }

  // wanted level gone: officers go back to walking their beat
  standDown() {
    for (const p of this.list) {
      if (!p.cop) continue;
      p.armed = false;
      if (p.body.userData.gun) p.body.userData.gun.visible = false;
      if (p.state === 'cop') this.rejoin(p);
    }
  }

  // ------------------------------------------------------------- sidewalk routes
  planNext(p) {
    const { N, ROAD, BLOCK } = this.city;
    const [sx, sz] = CORNERS[p.k];
    const options = [];
    if (p.bi + sx >= 0 && p.bi + sx < N) options.push('x');
    if (p.bj + sz >= 0 && p.bj + sz < N) options.push('z');
    if (options.length && Math.random() < 0.35) {
      const axis = pick(options);
      const x0 = this.city.blockMin(p.bi), z0 = this.city.blockMin(p.bj);
      const edgeX = sx < 0 ? x0 : x0 + BLOCK, edgeZ = sz < 0 ? z0 : z0 + BLOCK;
      if (axis === 'x') {
        const zc = edgeZ - sz * 1.8;
        p.points.push({ x: edgeX - sx * 0.7, z: zc }, { x: edgeX - sx * 0.6, z: zc, wait: 'x' }, { x: edgeX + sx * (ROAD + 0.7), z: zc });
        p.bi += sx;
        p.k = cornerIndex(-sx, sz);
      } else {
        const xc = edgeX - sx * 1.8;
        p.points.push({ x: xc, z: edgeZ - sz * 0.7 }, { x: xc, z: edgeZ - sz * 0.6, wait: 'z' }, { x: xc, z: edgeZ + sz * (ROAD + 0.7) });
        p.bj += sz;
        p.k = cornerIndex(sx, -sz);
      }
      if (Math.random() < 0.5) p.dir = -p.dir;
      p.points.push(this.cornerPoint(p.bi, p.bj, p.k, p.w));
      return;
    }
    p.k = (p.k + p.dir + 4) % 4;
    p.points.push(this.cornerPoint(p.bi, p.bj, p.k, p.w));
  }

  // after fleeing or fighting: rejoin the sidewalk loop of the nearest block
  rejoin(p) {
    const { N, HALF, ROAD, PITCH } = this.city;
    const idx = (v) => THREE.MathUtils.clamp(Math.floor((v + HALF - ROAD) / PITCH), 0, N - 1);
    p.bi = idx(p.x);
    p.bj = idx(p.z);
    let best = 0, bd = Infinity;
    for (let k = 0; k < 4; k++) {
      const c = this.cornerPoint(p.bi, p.bj, k, p.w);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    p.k = best;
    p.points = [this.cornerPoint(p.bi, p.bj, best, p.w)];
    p.state = 'walk';
  }

  canCross(axis) {
    const s = this.city.lightState;
    return axis === 'x' ? s === 2 : s === 0;
  }

  // ------------------------------------------------------------- combat API
  // nearest standing ped in front of (pos, yaw), for auto-aiming punches
  target(pos, yaw, range = 2.6) {
    let best = null, bd = range;
    for (const p of this.list) {
      if (p.state === 'down' || p.state === 'riding' || p.invulnerable) continue;
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (Math.abs(wrap(Math.atan2(dx, dz) - yaw)) > 1.1) continue;
      bd = d;
      best = p;
    }
    return best;
  }

  // the player's punch lands at this moment; returns true on a hit
  punch(pos, yaw) {
    const p = this.target(pos, yaw, 1.5);
    if (!p) return false;
    this.takeHit(p, pos);
    return true;
  }

  // hit by a bullet: dmg in the same units as punches (6 = down)
  shot(p, dmg, dir) {
    if (p.life) this.endLife(p); // off the bench / out of the chat
    p.hits += dmg;
    p.wasShot = true; // (a bounty brought in shot is worth half)
    const ko = p.hits >= KO_HITS;
    this.onCrime?.(ko ? (p.cop ? 'ko_cop' : 'ko') : p.cop ? 'assault_cop' : 'shooting', p);
    p.yaw = Math.atan2(-dir.x, -dir.z);
    if (ko) {
      this.knockOut(p, dir.x * 3.5, dir.z * 3.5, true);
    } else {
      p.vel.set(dir.x * 1.6, 0, dir.z * 1.6);
      p.overlay = { name: 'hit', t: 0, dur: p.anim.once('hit') * 0.7 };
      if (p.cop) p.state = 'cop';
      else {
        // shot civilians run for it
        p.state = 'flee';
        p.timer = 8;
        p.fleeFrom = { x: p.x - dir.x * 5, z: p.z - dir.z * 5 };
      }
    }
    this.scare(p.x, p.z, p, 30);
  }

  takeHit(p, from) {
    if (p.life) this.endLife(p); // off the bench / out of the chat
    p.hits++;
    this.onCrime?.(p.hits >= KO_HITS ? (p.cop ? 'ko_cop' : 'ko') : p.cop ? 'assault_cop' : 'assault', p);
    const dx = p.x - from.x, dz = p.z - from.z, d = Math.hypot(dx, dz) || 1;
    p.yaw = Math.atan2(-dx, -dz);
    if (p.hits >= KO_HITS) {
      this.knockOut(p, (dx / d) * 2.6, (dz / d) * 2.6, true);
      return;
    }
    p.vel.set((dx / d) * 1.3, 0, (dz / d) * 1.3);
    p.overlay = { name: 'hit', t: 0, dur: p.anim.once('hit') * 0.8 };
    if (p.cop) {
      p.state = 'cop';
      this.scare(p.x, p.z, p);
    } else if (p.state !== 'fight') {
      p.state = 'fight';
      p.attackTimer = 0.6 + Math.random() * 0.4;
      this.scare(p.x, p.z, p);
    }
  }

  knockOut(p, vx, vz, dropCash) {
    if (p.life) this.endLife(p);
    p.state = 'down';
    p.timer = 0;
    p.overlay = null;
    p.rising = false;
    p.anim.once('knockdown');
    p.vel.set(vx, 0, vz);
    p.cashPending = dropCash || Math.random() < 0.5;
  }

  // bystanders run away from trouble
  scare(x, z, except, radius = 12) {
    for (const o of this.list) {
      if (o === except || o.state === 'down' || o.state === 'fight' || o.state === 'riding' || o.state === 'cop') continue;
      if (o.keep && o.state !== 'fare') continue;
      if (Math.hypot(o.x - x, o.z - z) > radius) continue;
      if (o.life) this.endLife(o);
      o.state = 'flee';
      o.timer = 5 + Math.random() * 3;
      o.fleeFrom = { x, z };
    }
  }

  calm() {
    for (const p of this.list) if (p.state === 'fight' || p.state === 'flee') this.rejoin(p);
  }

  dropCash(x, z) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const bill = new THREE.Mesh(this.cashGeo, this.cashMat);
      bill.position.y = i * 0.036;
      bill.rotation.y = (Math.random() - 0.5) * 0.4;
      bill.castShadow = true;
      g.add(bill);
    }
    g.add(new THREE.Mesh(this.bandGeo, this.bandMat).translateY(0.036));
    g.position.set(x, this.city.groundHeight(x, z) + 0.25, z);
    this.scene.add(g);
    this.cash.push({ g, x, z, t: 0, amount: 20 + Math.floor(Math.random() * 140) });
  }

  // ------------------------------------------------------------- update
  update(dt, focus, player) {
    const onFoot = player && !player.vehicle && !player.dead ? player : null;
    if ((this.lifeTimer = (this.lifeTimer ?? 2) - dt) <= 0) {
      this.lifeTimer = 3 + Math.random() * 3;
      this.spawnLife(focus);
    }
    if ((this.spawnTimer -= dt) <= 0 && this.list.filter((p) => !p.keep).length < MAX_PEDS) {
      this.spawnTimer = 0.25;
      this.spawn(focus);
    }
    for (const p of [...this.list]) {
      const dist = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (p.state === 'riding') {
        this.animate(p, dt, 0);
        continue;
      }
      if (!p.keep && (dist > (p.state === 'cop' ? 260 : DESPAWN) || (p.state === 'down' && p.timer > 40))) {
        this.endLife(p);
        this.scene.remove(p.body);
        this.list.splice(this.list.indexOf(p), 1);
        continue;
      }
      if (p.overlay) {
        p.overlay.t += dt;
        if (p.overlay.t > p.overlay.dur) p.overlay = null;
      }
      if (p.state === 'down') this.updateDown(p, dt);
      else if (p.state === 'fight') this.updateFight(p, dt, onFoot);
      else if (p.state === 'cop') this.updateCop(p, dt, player);
      else if (p.state === 'flee') this.updateFlee(p, dt);
      else if (p.state === 'fare' || p.state === 'contact') this.move(p, 0, p.yaw, dt);
      else if (p.state === 'seated' || p.state === 'talking') {
        p.cur = 0;
        if (p.life) this.updateLife(p, dt);
      }
      else if (p.state === 'board') this.updateBoard(p, dt);
      else this.updateWalk(p, dt, onFoot);
      if (p.state === 'riding') continue;
      this.separate(p);

      if (p.state !== 'down' && !p.invulnerable) this.carHits(p);
      for (const m of p.body.userData.meshes) m.castShadow = dist < 40;
      p.body.position.set(p.x, p.y, p.z);
      p.body.rotation.y = p.yaw;
      this.animate(p, dt, dist);
    }
    this.updateCash(dt, onFoot);
  }

  // people standing or walking don't walk through each other: each takes half of the overlap
  separate(p) {
    if (STILL.has(p.state)) return;
    for (const o of this.list) {
      if (o === p || STILL.has(o.state) || Math.abs(o.x - p.x) > 0.6 || Math.abs(o.z - p.z) > 0.6) continue;
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = RADIUS * 2;
      if (d >= m || d < 1e-6) continue;
      const k = (m - d) / d / 2;
      p.x += dx * k;
      p.z += dz * k;
      if (!o.keep) {
        o.x -= dx * k;
        o.z -= dz * k;
      }
    }
  }

  carHits(p) {
    for (const c of this.vehicles.active) {
      const v = c.vehicle;
      if (v.speed < 3 || Math.abs(v.pos.x - p.x) > 4 || Math.abs(v.pos.z - p.z) > 4) continue;
      if (v.circles().some(([cx, cz]) => Math.hypot(cx - p.x, cz - p.z) < v.spec.r + RADIUS)) {
        p.yaw = Math.atan2(-v.vel.x, -v.vel.z);
        if (v.driven) this.onCrime?.(p.cop ? 'runover_cop' : 'runover', p);
        p.runOver = true;
        this.knockOut(p, v.vel.x * 0.8, v.vel.z * 0.8, false);
        this.scare(p.x, p.z, p);
        return;
      }
    }
  }

  move(p, speed, yawTarget, dt, turn = 8) {
    p.yaw += wrap(yawTarget - p.yaw) * (1 - Math.exp(-turn * dt));
    p.cur += (speed - p.cur) * (1 - Math.exp(-5 * dt));
    p.x += Math.sin(p.yaw) * p.cur * dt + p.vel.x * dt;
    p.z += Math.cos(p.yaw) * p.cur * dt + p.vel.z * dt;
    p.vel.multiplyScalar(Math.exp(-6 * dt));
    this.collideWorld(p);
    // cars are solid (a passenger walking to the taxi door is let through on the last step)
    if (p.state !== 'board') this.vehicles.collideCircle(p, RADIUS);
    const gh = this.city.groundHeight(p.x, p.z);
    p.y += (gh - p.y) * Math.min(1, dt * 15);
  }

  collideWorld(p) {
    for (const c of this.city.query(p.x - 1, p.x + 1, p.z - 1, p.z + 1)) {
      if (c.type === 'box') {
        const qx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX), qz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
        if (d < RADIUS && d > 1e-6) {
          p.x += (dx / d) * (RADIUS - d);
          p.z += (dz / d) * (RADIUS - d);
        }
      } else {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), r = RADIUS + c.r;
        if (d < r && d > 1e-6) {
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        }
      }
    }
  }

  // Steer round whatever is in the way (the player, other peds, cars, lamp posts, palms)
  // instead of stopping and queueing behind it: everything ahead inside the walking lane
  // pushes the heading sideways, nearer and more central obstacles push harder. Head-on
  // with nothing to choose from, each ped keeps its own preferred side so two walkers
  // pass each other rather than dancing.
  avoid(p, heading, player) {
    const fx = Math.sin(heading), fz = Math.cos(heading), LOOK = 2.4;
    let turn = 0, slow = 1;
    p.passSide ??= Math.random() < 0.5 ? 1 : -1;
    const obstacle = (ox, oz, r, moving) => {
      const rx = ox - p.x, rz = oz - p.z;
      const ahead = rx * fx + rz * fz;
      if (ahead <= -0.1 || ahead > LOOK + r) return;
      const lat = rx * fz - rz * fx; // + : on the side a positive turn heads to
      const clear = r + RADIUS + 0.3;
      if (Math.abs(lat) > clear) return;
      const near = 1 - Math.max(0, ahead - r) / LOOK;
      const dir = Math.abs(lat) < 0.08 ? p.passSide : -Math.sign(lat);
      turn += dir * near * (1 - Math.abs(lat) / clear) * 1.3;
      // almost touching: ease off while the turn takes effect (stand still only if boxed in)
      if (ahead < r + RADIUS + 0.25) slow = Math.min(slow, moving ? 0.55 : 0.4);
    };
    if (player) obstacle(player.position.x, player.position.z, 0.35, false);
    for (const o of this.list) {
      if (o === p || o.state === 'down' || o.state === 'riding') continue;
      if (Math.abs(o.x - p.x) > 3 || Math.abs(o.z - p.z) > 3) continue;
      obstacle(o.x, o.z, RADIUS, o.cur > 0.3);
    }
    for (const c of this.vehicles.active) {
      const v = c.vehicle;
      if (Math.abs(v.pos.x - p.x) > 6 || Math.abs(v.pos.z - p.z) > 6) continue;
      for (const [cx, cz] of v.circles()) obstacle(cx, cz, v.spec.r, v.speed > 0.5);
    }
    for (const c of this.city.query(p.x - 3, p.x + 3, p.z - 3, p.z + 3)) {
      if (c.type !== 'box' && c.r < 1.5) obstacle(c.x, c.z, c.r, false);
    }
    return { turn: THREE.MathUtils.clamp(turn, -1.2, 1.2), slow };
  }

  updateWalk(p, dt, player) {
    const t = p.points[0];
    if (!t) {
      this.planNext(p);
      return;
    }
    const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    // rain: everyone walks faster, some jog for cover
    const hurry = this.hurry || 0;
    p.jogger ??= Math.random() < 0.35;
    let want = hurry > 0.6 && p.jogger ? 2.7 : p.speed * (1 + 0.3 * hurry);
    if (t.wait && d < 0.4) {
      want = 0;
      if (this.canCross(t.wait)) p.points.shift();
    } else if (d < 0.35) p.points.shift();
    const heading = d > 1e-3 ? Math.atan2(dx, dz) : p.yaw;
    const steer = this.avoid(p, heading, player);
    this.move(p, want * steer.slow, heading + steer.turn, dt);
  }

  updateFlee(p, dt) {
    p.timer -= dt;
    this.move(p, 4.2, Math.atan2(p.x - p.fleeFrom.x, p.z - p.fleeFrom.z), dt, 6);
    if (p.timer <= 0) this.rejoin(p);
  }

  updateFight(p, dt, player) {
    if (!player || Math.hypot(player.position.x - p.x, player.position.z - p.z) > 18) {
      this.rejoin(p);
      return;
    }
    const dx = player.position.x - p.x, dz = player.position.z - p.z, d = Math.hypot(dx, dz);
    const busy = p.overlay && (p.overlay.name === 'hit' || p.overlay.name.startsWith('punch'));
    const want = busy ? 0 : d > 1.0 ? Math.min(3.2, (d - 0.9) * 2.5) : 0;
    this.move(p, want, Math.atan2(dx, dz), dt, 10);
    if (p.overlay && p.overlay.name.startsWith('punch') && !p.overlay.landed && p.overlay.t > p.overlay.dur * 0.32) {
      p.overlay.landed = true;
      const ahead = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / (d || 1);
      if (d < 1.3 && ahead > 0.6) player.takeHit(7, p);
    }
    if (!busy && d < 1.25 && (p.attackTimer -= dt) <= 0) {
      const name = Math.random() < 0.5 ? 'punchl' : 'punchr';
      p.overlay = { name, t: 0, dur: p.anim.once(name) };
      p.attackTimer = 0.9 + Math.random() * 0.8;
    }
  }

  // chase the player (on foot or in a car) and try to take them down
  canSee(p, x, z) {
    const o = new THREE.Vector3(p.x, p.y + 1.5, p.z), d = new THREE.Vector3(x - p.x, 0, z - p.z), L = d.length();
    return L < 0.5 || this.city.raycast(o, d.normalize(), L) >= L - 0.8;
  }

  updateCop(p, dt, player) {
    if (!player || player.dead || player.busted) {
      this.move(p, 0, p.yaw, dt);
      return;
    }
    const v = player.vehicle;
    // a player in a car: go for the driver's door (cars are solid now, the middle can't be reached)
    let door = v && v.root.localToWorld(_door.set(-v.seat.x - 1.0, 0, v.seat.z));
    if (v) {
      // on the far side of the car: walk round the nearer end first instead of pushing at it
      const s = Math.sin(v.heading), c = Math.cos(v.heading), ox = p.x - v.pos.x, oz = p.z - v.pos.z;
      const lx = ox * c - oz * s, lz = ox * s + oz * c, doorSide = Math.sign(-v.seat.x - 1.0);
      if (Math.sign(lx) !== doorSide && Math.abs(lz) < v.spec.halfL + 0.4) {
        const cx = Math.sign(lx) * (v.spec.halfW + 0.7), cz = (lz >= 0 ? 1 : -1) * (v.spec.halfL + 0.8);
        door = _door.set(v.pos.x + cx * c + cz * s, 0, v.pos.z - cx * s + cz * c);
      }
    }
    const tx = v ? door.x : player.position.x, tz = v ? door.z : player.position.z;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const reach = v ? 0.5 : 1.0;
    const busy = p.overlay && (p.overlay.name === 'hit' || p.overlay.name.startsWith('punch'));
    const gun = p.body.userData.gun;
    if (gun) gun.visible = !!p.armed;
    if (p.armed && gun) {
      // hold position at 7-16 m with the pistol up and fire every second or so
      const want = busy ? 0 : d > 16 ? COP_RUN : d < 6 ? -1.2 : 0;
      this.move(p, Math.max(0, want), Math.atan2(dx, dz), dt, 10);
      if (want < 0) {
        p.x -= (dx / d) * 1.2 * dt;
        p.z -= (dz / d) * 1.2 * dt;
      }
      // only at a player he can see: never through a building
      p.aimingGun = !busy && d < 22 && this.canSee(p, tx, tz);
      if (p.aimingGun && (p.fireTimer = (p.fireTimer ?? 1.8) - dt) <= 0) {
        p.fireTimer = 1.6 + Math.random() * 1.4;
        this.onCopFire?.(p);
      }
      return;
    }
    p.aimingGun = false;
    const want = busy ? 0 : d > reach + 2.5 ? COP_RUN : d > reach ? Math.min(COP_RUN, (d - reach + 0.2) * 2.5) : 0;
    this.move(p, want, Math.atan2(dx, dz), dt, 10);
    if (v) return;
    if (p.overlay && p.overlay.name.startsWith('punch') && !p.overlay.landed && p.overlay.t > p.overlay.dur * 0.32) {
      p.overlay.landed = true;
      const ahead = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / (d || 1);
      if (d < 1.3 && ahead > 0.6) player.takeHit(4, p);
    }
    if (!busy && d < 1.25 && (p.attackTimer -= dt) <= 0) {
      const name = Math.random() < 0.5 ? 'punchl' : 'punchr';
      p.overlay = { name, t: 0, dur: p.anim.once(name) };
      p.attackTimer = 1.4 + Math.random();
    }
  }

  updateBoard(p, dt) {
    const v = p.vehicle;
    const door = v.root.localToWorld(new THREE.Vector3(-v.seat.x - 1.1, 0, v.seat.z - 0.8));
    const dx = door.x - p.x, dz = door.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.45) {
      this.seatIn(p, v);
      p.onBoarded?.();
      return;
    }
    // jog to the car, without being pushed out of it by collisions on the last step
    this.move(p, Math.min(2.6, d * 3), Math.atan2(dx, dz), dt, 10);
  }

  updateDown(p, dt) {
    p.timer += dt;
    // a dragged-out driver picks himself up (the GetUp clip) and runs
    if (p.getUpAt && p.timer > p.getUpAt && !p.rising && p.anim.actions.getup) {
      p.rising = true;
      p.overlay = { name: 'getup', t: 0, dur: p.anim.once('getup') };
      p.vel.set(0, 0, 0);
    }
    if (p.rising && p.overlay) return;
    if (p.getUpAt && p.timer > p.getUpAt) {
      p.getUpAt = 0;
      p.rising = false;
      p.state = 'flee';
      p.timer = 6;
      if (!p.fleeFrom) p.fleeFrom = { x: p.x, z: p.z };
      return;
    }
    p.x += p.vel.x * dt;
    p.z += p.vel.z * dt;
    p.vel.multiplyScalar(Math.exp(-3.5 * dt));
    if (p.timer < 1) this.collideWorld(p);
    // a body thrown about doesn't end up inside a car (the one that hit it has moved on by now)
    if (p.timer > 0.25) this.vehicles.collideCircle(p, RADIUS);
    const gh = this.city.groundHeight(p.x, p.z);
    p.y += (gh - p.y) * Math.min(1, dt * 10);
    if (p.cashPending && p.timer > 1.1) {
      p.cashPending = false;
      const side = p.yaw + Math.PI / 2;
      this.dropCash(p.x + Math.sin(side) * 0.7, p.z + Math.cos(side) * 0.7);
    }
  }

  animate(p, dt, dist) {
    const a = p.anim;
    if (p.overlay) a.target = { [p.overlay.name]: 1 };
    else if (p.state === 'down') a.target = { knockdown: 1 };
    else if (p.cower && a.actions.handsup) a.target = { handsup: 1 }; // held up at gunpoint
    else if (p.state === 'flee') a.target = { run: 1 };
    else if (p.state === 'fight') a.target = p.cur > 2.1 ? { run: 1 } : p.cur > 0.4 ? { walk: 1 } : { guard: 1 };
    else if ((p.state === 'cop' || p.state === 'contact') && p.aimingGun && a.actions.pistolaim) a.target = { pistolaim: 1 };
    else if (p.state === 'cop') a.target = p.cur > 2.4 ? { run: 1 } : p.cur > 0.4 ? { walk: 1 } : { guard: 1 };
    else if (p.state === 'riding') a.target = { drive: 1 };
    else if (p.state === 'board') a.target = p.cur > 2.2 ? { run: 1 } : { walk: 1 };
    else if (p.state === 'seated' || p.state === 'talking') a.target = { [p.pose || 'idle']: 1 };
    else if (p.cur > 2.1) a.target = { run: 1 };
    else {
      const w = Math.min(1, p.cur / 0.6);
      a.target = { walk: w, idle: 1 - w };
    }
    a.actions.walk.timeScale = (p.cur / (1.36 * p.scale)) * this.clips.walk.duration;
    a.actions.run.timeScale = (p.cur / (2.3 * p.scale)) * this.clips.run.duration;
    if (dist < 60 || (p.tick = (p.tick || 0) + 1) % 3 === 0) a.update(dist < 60 ? dt : dt * 3, p.overlay || p.state === 'down' ? 18 : 10);
  }

  updateCash(dt, player) {
    for (const c of [...this.cash]) {
      c.t += dt;
      c.g.rotation.y += dt * 2;
      c.g.position.y = this.city.groundHeight(c.x, c.z) + 0.2 + Math.sin(c.t * 3) * 0.05;
      const taken = player && Math.hypot(player.position.x - c.x, player.position.z - c.z) < 1.0;
      if (taken || c.t > 90) {
        this.scene.remove(c.g);
        this.cash.splice(this.cash.indexOf(c), 1);
        if (taken) this.onCash?.(c.amount);
      }
    }
  }

  get obstacles() {
    return this.list.filter((p) => p.state !== 'down' && p.state !== 'riding' && p.state !== 'board');
  }

  collideCircle(pos, r) {
    for (const p of this.list) {
      if (p.state === 'down' || p.state === 'riding') continue;
      const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz), m = r + RADIUS;
      if (d < m && d > 1e-6) {
        pos.x += (dx / d) * (m - d);
        pos.z += (dz / d) * (m - d);
      }
    }
  }
}
