// Side jobs, GTA style: get into the working vehicle at its depot and press T.
//   ambulance (Sol General): pick up the injured (lying on the pavement) and get them to the
//                            hospital before time runs out; each round, one more patient
//   fire truck (Station 3):  cars on fire around town; hold the mouse button to work the water
//                            cannon (it aims where you look) and put them out
//   bus (Downtown depot):    drive the route, stop at each stop for the passengers
//   truck (Port of Sol):     back up to the trailer to hitch it, deliver it across town
//   tow truck (impound lot): back up to the broken-down car to hook it, haul it to the lot
// Every vehicle waits at its depot (a fresh one turns up once you've driven off with it).
// Also here: the boats and jetskis at the harbour and the beach jetty.
import * as THREE from 'three';
import { colorFor } from './vehicles.js';

const PLACES = {
  ambulance: { name: 'SOL GENERAL HOSPITAL', block: [4, 5], along: 16, color: '#e8e8e8', icon: 'hospital' },
  firetruck: { name: 'FIRE STATION 3', block: [2, 3], along: 14, color: '#ff5a3a', icon: 'fire' },
  bus: { name: 'SOL TRANSIT DEPOT', block: [5, 5], along: 12, color: '#ffd23f', icon: 'bus' },
  towtruck: { name: 'CITY IMPOUND', block: [1, 1], along: 18, color: '#ffa31a', icon: 'tow' },
};
const BUS_STOPS = [[3, 4, 28], [5, 4, 30], [6, 5, 26], [5, 7, 24], [3, 6, 30], [2, 5, 22]];
const STOP_R = 7;
const CARS = ['sedan', 'coupe', 'van', 'taxi', 'super', 'lux', 'police'];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class SideJobs {
  constructor({ scene, city, vehicles, peds, hud, audio, fx }) {
    Object.assign(this, { scene, city, vehicles, peds, hud, audio, fx });
    this.state = 'off';
    this.kind = null;
    this.hinted = null;
    this.t = 0;
    // depots: where each working vehicle waits
    const C = city, rs = (bi, bj, along) => ({ x: C.blockMin(bi) + along, z: C.roadC(bj) + C.ROAD / 2 - 1.15, yaw: Math.PI / 2 });
    this.depots = [];
    for (const [model, p] of Object.entries(PLACES)) {
      const at = rs(p.block[0], p.block[1], p.along);
      this.depots.push({ model, ...at, name: p.name, icon: p.icon });
      this.sign(p.name, p.color, at.x, C.blockMin(p.block[1]) + 0.5);
      if (model === 'ambulance') this.hospital = { x: at.x + 16, z: at.z };
      if (model === 'towtruck') this.impound = { x: at.x + 18, z: at.z };
    }
    // Port of Sol: at the west end of the container quay (clear of the stacks), the truck faces
    // the city; its trailer waits behind it, to be backed up to
    this.depots.push({ model: 'truck', x: -315, z: -C.HALF - 10, yaw: 0, name: 'PORT OF SOL FREIGHT', icon: 'truck' });
    this.port = { x: -315, z: -C.HALF - 35, yaw: 0 };
    this.sign('PORT OF SOL FREIGHT', '#41d6ff', -306, -C.HALF - 12);
    // boats tied up along the harbour quay; jetskis and a speedboat at the beach jetty
    for (const [m, x, off] of [['boat', -150, 1.6], ['boat', -125, 1.6], ['jetski', -104, 1.0], ['jetski', -97, 1.0]]) {
      this.depots.push({ model: m, x, z: -C.EXT - off - (m === 'boat' ? 1.18 : 0.58), yaw: Math.PI / 2, name: 'Harbour', icon: 'boat', quiet: true });
    }
    this.jetty(118, C.EXT - 3, C.EXT + 46);
    for (const [m, x, z] of [['jetski', 121.6, C.EXT + 34], ['jetski', 121.6, C.EXT + 40], ['boat', 114, C.EXT + 42]]) this.depots.push({ model: m, x, z, yaw: 0, name: 'Beach jetty', icon: 'boat', quiet: true });
    for (const d of this.depots) d.c = this.place(d);
    this.makeMarkers();
    this.ensureT = 0;
  }

  // ---------------------------------------------------------------- the world bits
  sign(text, color, x, z) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = color;
    g.fillRect(0, 84, 512, 12);
    g.font = '50px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(text, 256, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const grp = new THREE.Group();
    const y = this.city.groundHeight(x, z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.8), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6, side: THREE.DoubleSide }));
    board.position.y = 2.9;
    grp.add(board);
    for (const s of [-1.9, 1.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.9, 0.1), new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 }));
      post.position.set(s, 1.45, 0);
      grp.add(post);
    }
    grp.position.set(x, y, z);
    grp.rotation.y = Math.PI;
    grp.traverse((o) => (o.castShadow = true));
    this.scene.add(grp);
    this.city.addColliders([{ type: 'circle', x: x - 1.9, z, r: 0.12, h: y + 3 }, { type: 'circle', x: x + 1.9, z, r: 0.12, h: y + 3 }]);
  }

  // a wooden jetty out from the beach: walk out on it, the jetskis are tied up alongside
  jetty(x, z0, z1) {
    const W = 2.6, y = 0.32, len = z1 - z0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, len), wood);
    deck.position.set(x, y - 0.06, (z0 + z1) / 2);
    deck.castShadow = deck.receiveShadow = true;
    this.scene.add(deck);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.9 }), Math.ceil(len / 4) * 2 + 2);
    let k = 0;
    for (let z = z0 + 1; z <= z1; z += 4) for (const s of [-1, 1]) posts.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(x + s * (W / 2 - 0.1), y - 2, z));
    posts.count = k;
    posts.castShadow = true;
    this.scene.add(posts);
    this.city.decks.push({ minX: x - W / 2, maxX: x + W / 2, minZ: z0, maxZ: z1, y });
  }

  // park a working vehicle at its depot (clearing any car parked there)
  place(d) {
    const sp = this.vehicles.models[d.model] ? d.model : null;
    if (!sp) return null;
    for (const c of [...this.vehicles.cars]) {
      if (c.vehicle || c.job) continue;
      if (Math.abs(c.x - d.x) < 9 && Math.abs(c.z - d.z) < 3.5) {
        const b = this.vehicles.batches[c.model];
        if (b) b.list.splice(b.list.indexOf(c), 1);
        this.vehicles.cars.splice(this.vehicles.cars.indexOf(c), 1);
      }
    }
    return this.vehicles.addParked({ x: d.x, z: d.z, yaw: d.yaw, model: d.model, color: colorFor(d.model, 0xf2f2ee), job: true, spawned: true });
  }

  // a vehicle that was driven off (or wrecked) is replaced once you're out of sight of the depot
  ensure(P) {
    for (const d of this.depots) {
      const dd = Math.hypot(P.x - d.x, P.z - d.z);
      if (dd < 70) continue; // (not while you watch)
      const c = d.c, there = c && this.vehicles.cars.includes(c) && !c.wrecked && Math.hypot(...this.vehicles.pose(c).slice(0, 2).map((v, i) => v - (i ? d.z : d.x))) < 8;
      if (there) continue;
      if (c && this.vehicles.cars.includes(c) && !c.vehicle && !c.owned) {
        // left lying about somewhere: it's the depot's again
        const b = this.vehicles.batches[c.model];
        if (b) b.list.splice(b.list.indexOf(c), 1);
        this.vehicles.cars.splice(this.vehicles.cars.indexOf(c), 1);
      }
      d.c = this.place(d);
    }
  }

  blips() {
    const seen = new Set(), b = [];
    for (const d of this.depots) {
      if (seen.has(d.icon + (d.quiet ? d.name : ''))) continue;
      seen.add(d.icon + (d.quiet ? d.name : ''));
      b.push({ x: d.x, z: d.z, icon: d.icon, r: 6, kind: 'job' });
    }
    return b;
  }

  makeMarkers() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(0xffc21a) }, t: { value: 0 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 color; uniform float t; varying float vY;
        void main(){ float a = (1.0 - clamp(vY / 30.0, 0.0, 1.0)) * (0.45 + 0.15 * sin(t * 4.0 - vY * 0.4)); gl_FragColor = vec4(color * a, a); }`,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 32, 1, true).translate(0, 15, 0), mat);
    this.beam.renderOrder = 5;
    this.beam.visible = false;
    this.scene.add(this.beam);
  }

  mark(p, color) {
    this.beam.visible = !!p;
    if (!p) return;
    this.beam.position.set(p.x, this.city.groundHeight(p.x, p.z), p.z);
    this.beam.material.uniforms.color.value.set(color || 0xffc21a);
  }

  // ---------------------------------------------------------------- places around town
  kerb(bi, bj) {
    const C = this.city, x0 = C.blockMin(bi), z0 = C.blockMin(bj), t = 8 + Math.random() * (C.BLOCK - 16);
    // the pavement on the block's north side and the lane next to it
    return { walk: { x: x0 + t, z: z0 + 1.4 }, stop: { x: x0 + t, z: z0 - 2.2 } };
  }

  farKerb(from, minD, maxD) {
    const N = this.city.N;
    for (let k = 0; k < 50; k++) {
      const s = this.kerb(Math.floor(Math.random() * N), Math.floor(Math.random() * N));
      const d = Math.hypot(s.stop.x - from.x, s.stop.z - from.z);
      if (d > minD && d < maxD) return s;
    }
    return this.kerb(Math.floor(Math.random() * N), Math.floor(Math.random() * N));
  }

  route(from, to) {
    this.routeT = (this.routeT || 0) - 1;
    if (this.routeT > 0) return;
    this.routeT = 15;
    this.hud.route = this.city.gpsRoute ? this.city.gpsRoute({ x: from.x, z: from.z }, { x: to.x, z: to.z }) : [from, to];
  }

  where(p) {
    const w = this.city.locationName(p.x, p.z);
    return `${w.street}, ${w.district}`;
  }

  // ---------------------------------------------------------------- start / stop
  start(kind, c) {
    this.kind = kind;
    this.c = c;
    this.v = c.vehicle;
    this.state = 'on';
    this.level = 0;
    this.earned = 0;
    c.keep = true;
    if (kind === 'ambulance' || kind === 'firetruck') this.v.siren = true;
    if (kind === 'towtruck') this.v.siren = true; // (the amber beacon)
    this.audio.blip({ tone: 660, toneEnd: 990, dur: 0.2, gain: 0.25 });
    this[kind + 'Start']();
  }

  stop(msg) {
    const k = this.kind;
    if (k && this[k + 'Stop']) this[k + 'Stop']();
    if (this.v) this.v.siren = false;
    if (this.c) this.c.keep = false;
    this.state = 'off';
    this.kind = null;
    this.v = this.c = null;
    this.mark(null);
    this.hud.route = null;
    this.hud.blips = [];
    this.hud.mission(null);
    if (msg) this.hud.say(msg, 4);
  }

  pay(n, msg) {
    this.earned += n;
    this.hud.addMoney(n);
    this.audio.cash();
    this.hud.say(msg + ` <em>+$${n}</em>`, 3.5);
  }

  // ---------------------------------------------------------------- per frame
  update(dt, { player, driving, input, wanted, follow, busy }) {
    this.t += dt;
    this.beam.material.uniforms.t.value = this.t;
    if ((this.ensureT -= dt) <= 0) {
      this.ensureT = 4;
      this.ensure(driving ? driving.vehicle.pos : player.position);
    }
    // the fire truck's water cannon works any time you're at the wheel
    if (driving?.model === 'firetruck' && !driving.wrecked) this.cannon(dt, driving.vehicle, input, follow);
    else this.spraying = false;
    // hitching works any time too (backing a truck up to a trailer, the tow truck to a car)
    if (driving && (driving.model === 'truck' || driving.model === 'towtruck')) this.hitchCheck(driving, input);

    const kind = driving?.model;
    if (this.state === 'off') {
      const can = driving && PLACES[kind] !== undefined || kind === 'truck';
      if (can && this.hinted !== driving && !busy) {
        this.hinted = driving;
        const what = { ambulance: 'paramedic', firetruck: 'firefighter', bus: 'bus driver', truck: 'trucker', towtruck: 'tow truck' }[kind];
        this.hud.say(`Press <em>T</em> to start ${what} missions.`, 4);
      }
      if (!driving) this.hinted = null;
      if (can && !busy && input.pressed('KeyT') && !driving.wrecked) this.start(kind, driving);
      return;
    }
    if (!driving || driving !== this.c || player.dead || player.busted || driving.wrecked) return this.stop(`Job over. You made <em>$${this.earned}</em>.`);
    if (input.pressed('KeyT')) return this.stop(`Job over. You made <em>$${this.earned}</em>.`);
    if (wanted.level > 0 && this.kind !== 'firetruck') return this.stop('Not with the cops after you. Job over.');
    this[this.kind + 'Update'](dt, this.v);
  }

  // ---------------------------------------------------------------- paramedic
  ambulanceStart() {
    this.level++;
    this.patients = [];
    this.aboard = 0;
    const v = this.v;
    for (let i = 0; i < Math.min(5, this.level); i++) {
      const s = this.farKerb(v.pos, 60, 280 + this.level * 40);
      const p = this.peds.add(Math.random() < 0.5 ? 'male' : 'female', s.walk.x, s.walk.z, Math.random() * 6.28);
      this.peds.knockOut(p, 0, 0, false);
      p.cashPending = false;
      p.keep = true;
      p.patient = true;
      this.patients.push({ p, stop: s.stop, done: false });
    }
    // a minute and a bit, plus time for the distances
    let d = 0, at = v.pos;
    for (const pt of this.patients) {
      d += Math.hypot(pt.stop.x - at.x, pt.stop.z - at.z);
      at = pt.stop;
    }
    d += Math.hypot(this.hospital.x - at.x, this.hospital.z - at.z);
    this.time = 30 + d / 7;
    this.loadT = 0;
    this.hud.say(`Paramedic level <em>${this.level}</em>: ${this.patients.length} ${this.patients.length > 1 ? 'patients' : 'patient'} to pick up (red blips).`, 4);
  }

  ambulanceStop() {
    for (const pt of this.patients || []) if (!pt.done && pt.p) pt.p.keep = false;
    this.patients = [];
  }

  ambulanceUpdate(dt, v) {
    this.time -= dt;
    if (this.time <= 0) return this.stop('Too late. Job over.');
    const left = this.patients.filter((pt) => !pt.done);
    const stopped = v.speed < 1.2;
    for (const pt of left) {
      if (!this.peds.list.includes(pt.p)) return this.stop('A patient was lost. Job over.');
      pt.p.timer = Math.min(pt.p.timer, 1); // stays down
    }
    // loading: stop next to them, the crew lifts them in
    const near = left.find((pt) => Math.hypot(pt.p.x - v.pos.x, pt.p.z - v.pos.z) < 7);
    if (near && stopped && this.aboard < 3) {
      this.loadT += dt;
      if (this.loadT > 1.5) {
        this.loadT = 0;
        near.done = true;
        this.peds.remove(near.p);
        this.aboard++;
        this.time += 6;
        this.audio.blip({ tone: 880, toneEnd: 1200, dur: 0.15, gain: 0.2 });
        this.hud.say(this.aboard >= 3 ? 'The ambulance is full: get them to the hospital!' : 'Patient aboard.', 2.5);
      }
    } else this.loadT = 0;
    const toHospital = this.aboard > 0 && (left.length === 0 || this.aboard >= 3);
    const target = toHospital ? this.hospital : left[0]?.stop;
    if (toHospital && stopped && Math.hypot(this.hospital.x - v.pos.x, this.hospital.z - v.pos.z) < STOP_R) {
      const n = this.aboard;
      this.aboard = 0;
      this.pay(Math.round(n * (60 + this.level * 25) + Math.max(0, this.time) * 2), `${n} ${n > 1 ? 'patients' : 'patient'} saved.`);
      if (!this.patients.some((pt) => !pt.done)) return this.ambulanceStart();
    }
    if (target) this.route(v.pos, target);
    this.mark(toHospital ? this.hospital : null, 0xff4040);
    this.hud.blips = [...left.map((pt) => ({ x: pt.p.x, z: pt.p.z, color: '#ff3b3b' })), ...(this.aboard ? [{ x: this.hospital.x, z: this.hospital.z, color: '#ffd23f' }] : [])];
    this.hud.mission({ title: 'PARAMEDIC', time: this.time, rows: [['LEVEL', this.level], ['ABOARD', `${this.aboard} / 3`], ['TO PICK UP', left.length]] });
  }

  // ---------------------------------------------------------------- firefighter
  firetruckStart() {
    this.level++;
    this.fires = [];
    const v = this.v, want = Math.min(4, this.level);
    const cands = this.vehicles.cars.filter((c) => !c.vehicle && !c.job && !c.wrecked && CARS.includes(c.model));
    for (let k = 0; k < 80 && this.fires.length < want; k++) {
      const c = cands[Math.floor(Math.random() * cands.length)];
      if (!c || this.fires.includes(c)) continue;
      const d = Math.hypot(c.x - v.pos.x, c.z - v.pos.z);
      if (d < 80 || d > 260 + this.level * 30) continue;
      c.burning = true;
      c.fireJob = true;
      c.health = 12;
      c.douse = 0;
      c.keep = true;
      this.vehicles.activate(c);
      this.fires.push(c);
    }
    this.time = 70 + this.fires.length * 35;
    this.hud.say(`Firefighter level <em>${this.level}</em>: ${this.fires.length} ${this.fires.length > 1 ? 'fires' : 'fire'} (red blips). Hold the <em>mouse button</em> to work the water cannon.`, 5);
  }

  firetruckStop() {
    for (const c of this.fires || []) {
      c.fireJob = false;
      c.keep = false;
    }
    this.fires = [];
  }

  firetruckUpdate(dt, v) {
    this.time -= dt;
    // the ones still burning
    const burning = this.fires.filter((c) => c.burning && this.vehicles.cars.includes(c));
    if (this.time <= 0) {
      for (const c of burning) c.fireJob = false; // they'll go up now
      return this.stop('The fires got away from you. Job over.');
    }
    if (!burning.length) {
      this.pay(150 + this.level * 120 + Math.round(this.time * 2), 'All fires out!');
      this.firetruckStop();
      return this.firetruckStart();
    }
    const near = burning.reduce((a, c) => (Math.hypot(...this.vehicles.pose(c).slice(0, 2).map((x, i) => x - (i ? v.pos.z : v.pos.x))) < Math.hypot(...this.vehicles.pose(a).slice(0, 2).map((x, i) => x - (i ? v.pos.z : v.pos.x))) ? c : a));
    const [nx, nz] = this.vehicles.pose(near);
    this.route(v.pos, { x: nx, z: nz });
    this.hud.blips = burning.map((c) => {
      const [x, z] = this.vehicles.pose(c);
      return { x, z, color: '#ff3b3b' };
    });
    this.mark(null);
    this.hud.mission({ title: 'FIREFIGHTER', time: this.time, rows: [['LEVEL', this.level], ['FIRES', burning.length]] });
  }

  // the cannon on the roof: hold the mouse button, it sprays where the camera looks
  cannon(dt, v, input, follow) {
    this.spraying = input.mouse(0);
    if (!this.spraying) return;
    const yaw = follow.yaw, pitch = 0.18 - (follow.viewPitch || 0) * 0.5;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const ox = v.pos.x + fx * 2.2, oy = v.groundY + 3.4, oz = v.pos.z + fz * 2.2, sp = 22;
    for (let i = 0; i < 7; i++) this.fx.jet(ox, oy, oz, dx * sp * Math.cos(pitch) + v.vel.x, sp * Math.sin(pitch), dz * sp * Math.cos(pitch) + v.vel.z);
    if ((this.hissT = (this.hissT || 0) - dt) <= 0) {
      this.hissT = 0.5;
      this.audio.hiss?.(0.6);
    }
    // what the water hits: burning cars go out, people get knocked over
    for (const c of this.vehicles.active) {
      if (!c.burning) continue;
      const cv = c.vehicle, tx = cv.pos.x - ox, tz = cv.pos.z - oz, d = Math.hypot(tx, tz);
      if (d > 28 || d < 1) continue;
      if ((tx * dx + tz * dz) / d < Math.cos(0.32)) continue;
      c.douse = (c.douse || 0) + dt;
      this.fx.engineSmoke(cv.pos.x, cv.groundY + 1.4, cv.pos.z, 0);
      if (c.douse > 2.2) {
        c.burning = false;
        c.fireJob = false;
        c.keep = false;
        c.health = Math.max(c.health, 30);
        this.hud.say('Fire out.', 1.5);
      }
    }
    for (const p of this.peds.list) {
      if (p.state === 'down' || p.state === 'riding' || p.invulnerable || p.keep) continue;
      const tx = p.x - ox, tz = p.z - oz, d = Math.hypot(tx, tz);
      if (d > 20 || d < 1 || (tx * dx + tz * dz) / d < Math.cos(0.18)) continue;
      this.peds.knockOut(p, dx * 4, dz * 4, false);
      p.cashPending = false;
    }
  }

  // ---------------------------------------------------------------- bus driver
  busStart() {
    this.stops = BUS_STOPS.map(([bi, bj, along]) => {
      const C = this.city, x = C.blockMin(bi) + along;
      return { x, z: C.roadC(bj) + C.ROAD / 2 - 1.15, walk: { x, z: C.blockMin(bj) + 1.4 }, name: this.where({ x, z: C.blockMin(bj) }) };
    });
    // start at the stop nearest the bus
    const v = this.v;
    this.next = this.stops.reduce((bi, s, i) => (Math.hypot(s.x - v.pos.x, s.z - v.pos.z) < Math.hypot(this.stops[bi].x - v.pos.x, this.stops[bi].z - v.pos.z) ? i : bi), 0);
    this.riders = 0;
    this.waiting = [];
    this.dwell = 0;
    this.prepStop();
    this.hud.say(`Bus route: stop at each <em>bus stop</em> (yellow) and let the passengers on.`, 4);
  }

  prepStop() {
    const s = this.stops[this.next], v = this.v;
    this.time = 25 + Math.hypot(s.x - v.pos.x, s.z - v.pos.z) / 7;
    for (const p of this.waiting) if (this.peds.list.includes(p)) p.keep = false;
    this.waiting = [];
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const p = this.peds.add(Math.random() < 0.5 ? 'male' : 'female', s.walk.x - 3 + i * 1.5, s.walk.z + Math.random() * 0.6, Math.PI);
      p.state = 'contact';
      p.keep = true;
      this.waiting.push(p);
    }
  }

  busStop() {
    for (const p of this.waiting || []) if (this.peds.list.includes(p)) p.keep = false;
    this.waiting = [];
  }

  busUpdate(dt, v) {
    const s = this.stops[this.next];
    this.time -= dt;
    const at = Math.hypot(s.x - v.pos.x, s.z - v.pos.z) < STOP_R && v.speed < 1;
    if (at) {
      this.dwell += dt;
      // the passengers walk to the door (on the right side) and get on
      const door = { x: v.pos.x + Math.cos(v.heading) * -1.6 + Math.sin(v.heading) * 4, z: v.pos.z - Math.sin(v.heading) * -1.6 + Math.cos(v.heading) * 4 };
      for (const p of this.waiting) {
        if (!this.peds.list.includes(p)) continue;
        p.yaw = Math.atan2(door.x - p.x, door.z - p.z);
        this.peds.move(p, 1.4, p.yaw, dt);
      }
      if (this.dwell > 3.5) {
        const on = this.waiting.filter((p) => this.peds.list.includes(p)).length;
        const off = Math.min(this.riders, Math.floor(Math.random() * (this.riders + 1)));
        for (const p of this.waiting) if (this.peds.list.includes(p)) this.peds.remove(p);
        this.waiting = [];
        this.riders += on - off;
        const late = this.time < 0;
        this.pay(on * 15 + off * 10 + (late ? 0 : 40), `${this.stops[this.next].name}: ${on} on, ${off} off${late ? ' (late)' : ''}.`);
        this.next = (this.next + 1) % this.stops.length;
        if (this.next === 0) this.pay(200, 'Round trip done! Bonus.');
        this.dwell = 0;
        this.prepStop();
      }
    } else this.dwell = 0;
    this.route(v.pos, s);
    this.mark(s, 0xffd23f);
    this.hud.blips = [{ x: s.x, z: s.z, color: '#ffd23f' }];
    this.hud.mission({ title: 'BUS ROUTE', time: Math.max(0, this.time), rows: [['NEXT STOP', `${this.next + 1} / ${this.stops.length}`], ['ON BOARD', this.riders], ['WAITING', this.waiting.length]] });
  }

  // ---------------------------------------------------------------- hitching (truck, tow truck)
  // back up so the hitch is right at the trailer's kingpin / the car's bumper, slowly
  hitchCheck(driving, input) {
    const v = driving.vehicle;
    if (v.towing) return;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const hx = v.pos.x + fz * v.hitch.x + fx * v.hitch.z, hz = v.pos.z - fx * v.hitch.x + fz * v.hitch.z;
    for (const c of this.vehicles.cars) {
      if (c === driving || c.wrecked) continue;
      if (driving.model === 'truck' ? c.model !== 'trailer' : !CARS.includes(c.model)) continue;
      const [x, z, h] = this.vehicles.pose(c);
      if (Math.abs(x - hx) > 14 || Math.abs(z - hz) > 14) continue;
      const tv = this.vehicles.activate(c);
      // the car's pivot: the trailer's kingpin, a car's front bumper (or its back, nosed in)
      for (const end of driving.model === 'truck' ? [1] : [1, -1]) {
        const pz = end > 0 ? tv.pivot.z : -tv.spec.halfL;
        const px = x + Math.sin(h) * pz, pzw = z + Math.cos(h) * pz;
        if (Math.hypot(px - hx, pzw - hz) > (driving.model === 'truck' ? 2.2 : 2.5) || v.speed > 7) continue;
        if (Math.abs(wrap(h + (end > 0 ? 0 : Math.PI) - v.heading)) > 0.7) continue;
        if (end < 0) {
          // hooked by the back: turn it round so the "front" is the end on the boom
          tv.heading = wrap(h + Math.PI);
          tv.pivot = new THREE.Vector3(0, 0.5, tv.spec.halfL);
        }
        this.vehicles.hitch(driving, c);
        c.keep = true;
        this.audio.blip({ tone: 300, toneEnd: 200, dur: 0.2, gain: 0.35 });
        this.hud.say(driving.model === 'truck' ? 'Trailer hitched.' : 'Hooked up.', 2);
        this.onHitch?.(c);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- trucker
  truckStart() {
    this.level++;
    this.load = null;
    this.trailerC = null;
    // a trailer waiting at the port
    const v = this.v, P = this.port;
    if (!v.towing) {
      const near = this.vehicles.cars.find((c) => c.model === 'trailer' && !c.wrecked && Math.hypot(c.x - P.x, c.z - P.z) < 30 && !c.vehicle?.towedBy);
      this.trailerC = near || this.vehicles.addParked({ x: P.x, z: P.z, yaw: P.yaw, model: 'trailer', color: colorFor('truck', 0xf2f2ee), spawned: true, keep: true });
    } else this.trailerC = this.vehicles.cars.find((c) => c.vehicle === v.towing);
    this.trailerC.keep = true;
    this.hud.say(v.towing ? 'Trailer on. Deliver the load (yellow).' : 'Back the truck up to the trailer at the <em>Port of Sol</em> to hitch it.', 4);
    this.time = null;
  }

  truckStop() {
    if (this.trailerC && !this.trailerC.vehicle?.towedBy) this.trailerC.keep = false;
  }

  truckUpdate(dt, v) {
    const tc = this.trailerC;
    if (!tc || !this.vehicles.cars.includes(tc) || tc.wrecked) return this.stop('The load is lost. Job over.');
    const hitched = v.towing && v.towing === tc.vehicle;
    if (!hitched) {
      const [x, z] = this.vehicles.pose(tc);
      this.route(v.pos, { x, z });
      this.mark({ x, z }, 0x41d6ff);
      this.hud.blips = [{ x, z, color: '#41d6ff' }];
      this.hud.mission({ title: 'TRUCKER', time: this.time, rows: [['LEVEL', this.level], ['', 'Hitch the trailer']] });
      if (this.time != null && (this.time -= dt) <= 0) return this.stop('Too slow: the load is late. Job over.');
      return;
    }
    if (!this.load) {
      const s = this.farKerb(v.pos, 250, 600);
      this.load = { x: s.stop.x, z: s.stop.z, name: this.where(s.stop) };
      const d = Math.hypot(this.load.x - v.pos.x, this.load.z - v.pos.z);
      this.time = 40 + d / 6;
      this.startHealth = (this.c.health ?? 100) + (tc.health ?? 100);
      this.hud.say(`Deliver to <em>${this.load.name}</em>. Easy on the corners.`, 4);
    }
    this.time -= dt;
    if (this.time <= 0) return this.stop('Too slow: the load is late. Job over.');
    const L = this.load;
    if (Math.hypot(L.x - tc.vehicle.pos.x, L.z - tc.vehicle.pos.z) < 12 && v.speed < 1) {
      const hp = ((this.c.health ?? 100) + (tc.health ?? 100)) / Math.max(1, this.startHealth);
      this.vehicles.unhitch(this.c);
      tc.keep = false;
      this.pay(Math.round((250 + this.level * 80 + this.time * 3) * Math.min(1, hp)), hp < 0.95 ? 'Delivered, a bit dented.' : 'Delivered in one piece.');
      // the next load: back at the port
      this.level++;
      this.load = null;
      const P = this.port;
      this.trailerC = this.vehicles.addParked({ x: P.x, z: P.z, yaw: P.yaw, model: 'trailer', color: colorFor('truck', 0xf2f2ee), spawned: true, keep: true });
      this.time = 60 + Math.hypot(P.x - v.pos.x, P.z - v.pos.z) / 6;
      this.hud.say('Next load is waiting at the <em>Port of Sol</em>.', 4);
      return;
    }
    this.route(v.pos, L);
    this.mark(L, 0xffd23f);
    this.hud.blips = [{ x: L.x, z: L.z, color: '#ffd23f' }];
    this.hud.mission({ title: 'TRUCKER', time: this.time, rows: [['LEVEL', this.level], ['TO', L.name]] });
  }

  // ---------------------------------------------------------------- tow truck
  towtruckStart() {
    this.level++;
    const v = this.v, MODELS = ['sedan', 'coupe', 'van', 'lux', 'taxi'];
    const s = this.farKerb(v.pos, 120, 360);
    const model = MODELS[Math.floor(Math.random() * MODELS.length)];
    this.target = this.vehicles.addParked({ x: s.stop.x, z: s.stop.z, yaw: Math.PI / 2, model, color: colorFor(model, 0x8a8f96), spawned: true, keep: true, health: 40 });
    this.time = 50 + Math.hypot(s.stop.x - v.pos.x, s.stop.z - v.pos.z) / 7;
    this.hud.say(`Tow level <em>${this.level}</em>: a broken-down car at <em>${this.where(s.stop)}</em>. Back up to it to hook it.`, 4);
  }

  towtruckStop() {
    if (this.target) this.target.keep = false;
    if (this.v?.towing && this.c) this.vehicles.unhitch(this.c);
  }

  towtruckUpdate(dt, v) {
    const t = this.target;
    if (!t || !this.vehicles.cars.includes(t)) return this.stop('The car is gone. Job over.');
    this.time -= dt;
    if (this.time <= 0) return this.stop('Too slow. Job over.');
    const hooked = v.towing && v.towing === t.vehicle;
    const goal = hooked ? this.impound : (() => {
      const [x, z] = this.vehicles.pose(t);
      return { x, z };
    })();
    if (hooked && !this.hookedOnce) {
      this.hookedOnce = true;
      this.time += Math.hypot(this.impound.x - v.pos.x, this.impound.z - v.pos.z) / 6;
      this.hud.say('Haul it to the <em>City Impound</em>.', 3);
    }
    if (hooked && Math.hypot(this.impound.x - t.vehicle.pos.x, this.impound.z - t.vehicle.pos.z) < 14 && v.speed < 1) {
      this.vehicles.unhitch(this.c);
      this.vehicles.remove(t);
      this.target = null;
      this.hookedOnce = false;
      this.pay(120 + this.level * 60 + Math.round(this.time * 2), 'Car impounded.');
      return this.towtruckStart();
    }
    this.route(v.pos, goal);
    this.mark(hooked ? this.impound : null, 0xffa31a);
    this.hud.blips = [{ x: goal.x, z: goal.z, color: hooked ? '#ffd23f' : '#ffa31a' }];
    this.hud.mission({ title: 'TOW TRUCK', time: this.time, rows: [['LEVEL', this.level], ['', hooked ? 'To the impound lot' : 'Hook the car']] });
  }
}
