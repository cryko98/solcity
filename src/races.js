// Street races: checkpoint time trials over the road grid, one in every district.
// Drive into a chequered start marker and press E: 3-2-1-GO, then hit every
// checkpoint (GPS line on the radar, light beams on the street) before the clock
// runs out. Gold / silver / bronze pay out; best times are kept in localStorage.
import * as THREE from 'three';

const RACES = [
  { name: 'Downtown Dash', start: [5, 4], seed: 11, len: 10 },
  { name: 'Havana Nights', start: [2, 7], seed: 23, len: 12 },
  { name: 'Harbor Run', start: [1, 1], seed: 37, len: 12 },
  { name: 'Hills Sprint', start: [7, 2], seed: 52, len: 11 },
];
const CP_RADIUS = 10;
const PRIZE = { GOLD: 500, SILVER: 300, BRONZE: 150 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export class Races {
  constructor({ scene, city, hud, audio }) {
    Object.assign(this, { scene, city, hud, audio });
    this.state = 'idle';
    this.race = null;
    for (const r of RACES) {
      r.route = this.makeRoute(r);
      const [a, b] = r.route;
      r.startPos = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      r.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      r.length = (r.route.length - 1) * city.PITCH;
      r.limit = Math.round(r.length / 11 + 10);
      r.gold = r.length / 22;
      r.silver = r.length / 17;
      try {
        r.best = parseFloat(localStorage.getItem('solcity.race.' + r.name)) || null;
      } catch {
        r.best = null;
      }
    }
    this.makeMarkers();
  }

  // a self-avoiding walk over the intersections, the same every session
  makeRoute(r) {
    const N = this.city.N;
    for (let tries = 0; tries < 50; tries++) {
      const rand = rng(r.seed + tries * 101);
      let [i, j] = r.start;
      const seen = new Set([`${i},${j}`]);
      const nodes = [[i, j]];
      let dir = null;
      while (nodes.length <= r.len) {
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => {
          const ni = i + di, nj = j + dj;
          return ni >= 0 && nj >= 0 && ni <= N && nj <= N && !seen.has(`${ni},${nj}`);
        });
        if (!opts.length) break;
        // keep going straight now and then, it makes for faster sections
        let pick = opts[Math.floor(rand() * opts.length)];
        if (dir && rand() < 0.4 && opts.some(([a, b]) => a === dir[0] && b === dir[1])) pick = dir;
        dir = pick;
        i += pick[0];
        j += pick[1];
        seen.add(`${i},${j}`);
        nodes.push([i, j]);
      }
      if (nodes.length > r.len) return nodes.map(([a, b]) => ({ x: this.city.roadC(a), z: this.city.roadC(b) }));
    }
    throw new Error('no race route for ' + r.name);
  }

  makeMarkers() {
    const beamMat = (color) => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, t: { value: 0 }, k: { value: 1 } },
      vertexShader: 'varying float vY; varying vec2 vUv; void main(){ vY = position.y; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 color; uniform float t, k; varying float vY; varying vec2 vUv;
        void main(){
          float a = (1.0 - clamp(vY / 24.0, 0.0, 1.0)) * (0.4 + 0.2 * sin(t * 5.0 - vY * 0.5));
          float chk = mod(floor(vUv.x * 16.0) + floor(vY * 1.2), 2.0);
          gl_FragColor = vec4(color * a * k * mix(0.55, 1.0, chk), a * k); }`,
    });
    const beam = (r, color) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 24, 32, 1, true).translate(0, 12, 0), beamMat(color));
      b.renderOrder = 5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.14, 6, 48).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      ring.position.y = 0.08;
      g.add(b, ring);
      g.userData.beam = b;
      g.visible = false;
      this.scene.add(g);
      return g;
    };
    this.startBeams = RACES.map(() => beam(3.2, 0xb8b8b8));
    this.cpBeam = beam(CP_RADIUS * 0.55, 0x39d2ff);
    this.nextBeam = beam(CP_RADIUS * 0.4, 0x1a6a8a);
    this.finishBeam = beam(CP_RADIUS * 0.55, 0xffffff);
  }

  get holdCar() {
    return this.state === 'countdown';
  }

  get active() {
    return this.state !== 'idle';
  }

  start(r, v) {
    this.race = r;
    this.vehicle = v;
    this.state = 'countdown';
    this.t = 3.5;
    this.cp = 1;
    this.lastBeep = 4;
    this.hud.say(`<em>${r.name}</em>: ${r.route.length - 1} checkpoints. Gold under ${fmt(r.gold)}.`, 3.2);
  }

  stop(msg) {
    this.state = 'idle';
    this.race = null;
    this.vehicle = null;
    this.hud.route = null;
    this.hud.mission(null);
    this.cpBeam.visible = this.nextBeam.visible = this.finishBeam.visible = false;
    if (msg) this.hud.say(msg, 4);
  }

  finish() {
    const r = this.race, time = this.elapsed;
    const medal = time <= r.gold ? 'GOLD' : time <= r.silver ? 'SILVER' : 'BRONZE';
    const record = !r.best || time < r.best;
    if (record) {
      r.best = time;
      try {
        localStorage.setItem('solcity.race.' + r.name, String(time));
      } catch {}
    }
    this.onFinish?.(medal);
    this.hud.addMoney(PRIZE[medal]);
    this.audio.cash();
    this.stop(`${r.name}: <em>${fmt(time)}</em> - ${medal}! +$${PRIZE[medal]}${record ? ' &nbsp;NEW RECORD' : ''}`);
  }

  update(dt, { driving, input, wanted, blocked, dead }) {
    const v = driving?.vehicle;
    // beams are additive: tone them down at night when bloom is on
    const u = (b) => {
      b.userData.beam.material.uniforms.t.value += dt;
      b.userData.beam.material.uniforms.k.value = 1 - 0.55 * (this.dim || 0);
    };
    for (const b of [...this.startBeams, this.cpBeam, this.nextBeam, this.finishBeam]) u(b);

    if (this.state === 'idle') {
      RACES.forEach((r, k) => {
        const b = this.startBeams[k];
        b.visible = true;
        b.position.set(r.startPos.x, 0, r.startPos.z);
      });
      this.hud.poiBlips = [...RACES.map((r) => ({ x: r.startPos.x, z: r.startPos.z, color: '#f4f4f4', r: 6, label: 'R' })),
        ...(this.city.spray ? [{ x: this.city.spray.x, z: this.city.spray.z, color: '#e0407e', r: 6, label: '$' }] : [])];
      if (!v || blocked) return;
      const r = RACES.find((q) => Math.hypot(v.pos.x - q.startPos.x, v.pos.z - q.startPos.z) < 5);
      if (!r) {
        this.hinted = null;
        return;
      }
      if (this.hinted !== r) {
        this.hinted = r;
        this.hud.say(wanted.level ? 'Lose the cops before you race.' : `<em>${r.name}</em>${r.best ? ` (best ${fmt(r.best)})` : ''}. Press <em>E</em> to race.`, 4);
      }
      if (input.pressed('KeyE') && !wanted.level) this.start(r, v);
      return;
    }

    for (const b of this.startBeams) b.visible = false;
    const r = this.race;
    if (v !== this.vehicle || dead || v.data.wrecked) return this.stop('Race abandoned.');
    if (input.pressed('KeyE') && this.state === 'running') return this.stop('Race abandoned.');

    if (this.state === 'countdown') {
      this.t -= dt;
      const n = Math.ceil(this.t);
      if (n < this.lastBeep && n <= 3) {
        this.lastBeep = n;
        if (n > 0) {
          this.audio.blip({ tone: 660, toneEnd: 660, dur: 0.18, gain: 0.3 });
          this.hud.say(`<em style="font-size:40px">${n}</em>`, 0.9);
        }
      }
      if (this.t <= 0) {
        this.state = 'running';
        this.elapsed = 0;
        this.timeLeft = r.limit;
        this.audio.blip({ tone: 1320, toneEnd: 1320, dur: 0.4, gain: 0.35 });
        this.hud.say('<em style="font-size:40px">GO!</em>', 1);
      }
    } else {
      this.elapsed += dt;
      this.timeLeft -= dt;
      const cp = r.route[this.cp];
      if (Math.hypot(v.pos.x - cp.x, v.pos.z - cp.z) < CP_RADIUS) {
        if (this.cp === r.route.length - 1) return this.finish();
        this.cp++;
        this.timeLeft += 2; // a little time back per checkpoint
        this.audio.blip({ tone: 990, toneEnd: 1480, dur: 0.14, gain: 0.25 });
      } else if (this.timeLeft <= 0) return this.stop('Out of time. Race failed.');
    }

    // markers + GPS
    const cp = r.route[this.cp], last = this.cp === r.route.length - 1;
    const next = last ? null : r.route[this.cp + 1];
    this.cpBeam.visible = !last;
    this.finishBeam.visible = last;
    (last ? this.finishBeam : this.cpBeam).position.set(cp.x, 0, cp.z);
    this.nextBeam.visible = !!next;
    if (next) this.nextBeam.position.set(next.x, 0, next.z);
    this.hud.route = [{ x: v.pos.x, z: v.pos.z }, ...r.route.slice(this.cp, this.cp + 4)];
    this.hud.routeColor = '#39d2ff';
    this.hud.poiBlips = [];
    this.hud.blips = [{ x: cp.x, z: cp.z, color: last ? '#ffffff' : '#39d2ff' }];
    this.hud.mission({
      title: r.name.toUpperCase(),
      time: this.state === 'running' ? this.timeLeft : r.limit,
      rows: [
        ['CHECKPOINT', `${this.cp} / ${r.route.length - 1}`],
        ['RACE TIME', fmt(this.elapsed || 0)],
        ['BEST', r.best ? fmt(r.best) : '--'],
      ],
    });
  }
}
