// Hype trailer recorder (open the game with ?hype). Like trailer.js: steps the game at a fixed
// 30 fps, drives scripted shots, composites titles on top and uploads every frame
// (captures/trailer/hype_NNNNN.jpg). Cut to "Vessel of Eternity" (tricksntraps, CC0) at 150 BPM:
// a beat is exactly 12 frames. The music runs from bar 128: seven bars of build-up, the one-bar
// gap before the drop (bar 135), the drop at bar 136 with fast cuts, and the logo on bar 168.
// Encode: blender -b --factory-startup -P blender/encode_hype.py -- .
import * as THREE from 'three';

const W = 1280, H = 720, FPS = 30, DT = 1 / FPS, BEAT = 12;
const g = window.__game;
window.__trailer = true;

for (const id of ['stats', 'radar', 'street', 'help', 'speedo', 'hint', 'overlay', 'cutscene', 'fade', 'crosshair', 'msg', 'mission', 'fun', 'shop', 'dacity']) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
g.resize(W, H);

const out = document.createElement('canvas');
out.width = W;
out.height = H;
const ctx = out.getContext('2d');

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
const keys = g.input.keys;
const hold = (...codes) => {
  keys.clear();
  for (const c of codes) if (c) keys.add(c);
};
const tap = (code) => g.input.pressedOnce.add(code);
const trigger = (on, b = 0) => (on ? g.input.buttons.add(b) : g.input.buttons.delete(b));
const env = g.env, P = g.player, vehicles = g.vehicles, C = g.city;
const driving = () => g.state().driving;
const dv = () => driving()?.vehicle;
const HALF = C.HALF, EXT = C.EXT, WY = C.WATER_Y;
// for the recording: the hero can't be hurt (a death mid-shot would respawn him out of the car),
// and no random street events drive through the shots
P.takeHit = () => {};
g.events().update = () => {};

// ------------------------------------------------------------------ world helpers
function step(n = 1, scale = 1) {
  for (let i = 0; i < n; i++) g.step(DT * scale);
}
function calm() {
  hold();
  trigger(false);
  trigger(false, 2);
  if (g.fun().active) g.fun().stop(true);
  g.police.clear?.();
  g.wanted.clear();
  if (driving()) g.exit();
  g.weapons().equip(null);
}
function sky(h, m = 0, weather = 'clear') {
  env.setTime(h, m);
  env.setWeather(weather, true);
  env.wet = weather === 'rain' || weather === 'storm' ? 1 : 0;
}
// nothing in the way: traffic and people off the road along the car's path
function clearRoad(x, z, yaw, len = 160, half = 9) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const inPath = (px, pz) => {
    const a = (px - x) * fx + (pz - z) * fz, b = Math.abs(-(px - x) * fz + (pz - z) * fx);
    return a > -30 && a < len && b < half;
  };
  const T = g.traffic;
  for (const c of [...T.cars]) {
    const v = c.vehicle;
    if (!v || !inPath(v.pos.x, v.pos.z)) continue;
    T.cars.splice(T.cars.indexOf(c), 1);
    if (v.npcDriver) g.peds.unseatDriver(v);
    vehicles.remove(c);
  }
  T.spawnTimer = 12;
  // and every other car in the way: parked ones, and whatever earlier shots left standing
  const mine = driving();
  for (const c of [...vehicles.cars]) {
    if (c === mine || c.job) continue;
    const [px, pz] = vehicles.pose(c);
    if (!inPath(px, pz)) continue;
    if (c.vehicle) {
      if (c.vehicle.npcDriver) g.peds.unseatDriver(c.vehicle);
      if (c.vehicle.towing) vehicles.unhitch(c);
      if (c.vehicle.towedBy) c.vehicle.towedBy.towing = null;
      vehicles.remove(c);
    } else {
      const b = vehicles.batches[c.model];
      if (b) b.list.splice(b.list.indexOf(c), 1);
      vehicles.cars.splice(vehicles.cars.indexOf(c), 1);
      vehicles.dirty = true;
    }
  }
  for (const p of [...g.peds.list]) if (!p.keep && inPath(p.x, p.z)) g.peds.remove(p);
}
function spawnCar(model, x, z, yaw, color = 0xc8102e, ai = null) {
  const c = vehicles.spawn({ model, x, z, yaw, color, ai });
  const v = c.vehicle;
  v.pos.set(x, 0, z);
  v.heading = yaw;
  v.vel.set(0, 0, 0);
  v.angVel = 0;
  v.sync();
  return c;
}
// the hero at the wheel of a fresh vehicle already rolling at speed, the road ahead clear
function drive(model, x, z, yaw, speed, color) {
  calm();
  if (!vehicles.models[model]?.boat) clearRoad(x, z, yaw);
  const c = spawnCar(model, x, z, yaw, color);
  const v = c.vehicle;
  v.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
  g.seat(c);
  hold('KeyW');
  return c;
}
function placeHero(x, z, yaw, y) {
  calm();
  P.position.set(x, y ?? C.groundHeight(x, z), z);
  P.yaw = yaw;
  P.object.rotation.set(0, yaw, 0);
  P.vel?.set(0, 0, 0);
  P.moveSpeed = 0;
  g.follow.yaw = yaw;
}
// walk in through a venue's door (the fade is hidden), standing inside
function enter(type) {
  calm();
  const S = g.shop(), b = S.branches.find((q) => q.type === type);
  if (S.inside !== b) {
    P.position.set(b.door.x, C.groundHeight(b.door.x, b.door.z), b.door.z + 3);
    step(2);
    S.go(b, true);
    step(24);
  }
  return b;
}
function behind(v, back, side, up) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  return v3(v.pos.x - fx * back + fz * side, up, v.pos.z - fz * back - fx * side);
}
function ahead(v, d, up = 0.8) {
  return v3(v.pos.x + Math.sin(v.heading) * d, up, v.pos.z + Math.cos(v.heading) * d);
}

// ------------------------------------------------------------------ compositing
function drawText(text, { size = 64, y = H / 2, alpha = 1, color = '#fff', stroke = 6, gradient = false, spacing = 2, x = W / 2, align = 'center' }) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.font = `${size}px Anton, Impact, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${spacing}px`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  if (stroke) ctx.strokeText(text, x, y);
  if (gradient) {
    const gr = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    gr.addColorStop(0, '#ffe08a');
    gr.addColorStop(0.55, '#ff7a3d');
    gr.addColorStop(1, '#d93a7a');
    ctx.fillStyle = gr;
  } else ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
// the one caption of a shot: punches in low in the frame (never two at once, nothing else there)
function punch(text, t, t0 = 0.12, opts = {}) {
  const k = (t - t0) * 7;
  if (k <= 0) return;
  const s = 1 + 0.4 * Math.max(0, 1 - k);
  // a skewed colour slash behind the words
  ctx.save();
  ctx.globalAlpha = Math.min(1, k) * 0.85;
  ctx.fillStyle = opts.bar || '#ff3f7a';
  ctx.font = `${opts.size || 70}px Anton, Impact, sans-serif`;
  const w = ctx.measureText(text).width + 70;
  ctx.translate(W / 2, H - 128);
  ctx.transform(1, 0, -0.25, 1, 0, 0);
  ctx.fillRect(-w / 2 * Math.min(1, k), -36, w * Math.min(1, k), 72);
  ctx.restore();
  drawText(text, { size: (opts.size || 70) * s, y: H - 128, alpha: Math.min(1, k), stroke: 5, spacing: 3, ...opts });
}
function stars(n, t) {
  for (let i = 0; i < 5; i++) {
    const on = i < n && t * 10 > i * 0.8;
    drawText('★', { size: 50, x: W - 320 + i * 56, y: 112, color: on ? '#ffd23f' : 'rgba(255,255,255,.25)', stroke: 4 });
  }
}

function composite(shot, f, n) {
  ctx.save();
  ctx.filter = shot.grade || 'contrast(1.14) saturate(1.3)';
  // a zoom punch on every cut, a little shake on the beat after the drop
  const z = 1 + 0.07 * Math.max(0, 1 - f / 6);
  const sh = shot.drop ? Math.max(0, 1 - (f % BEAT) / 4) * 5 : 0;
  ctx.drawImage(g.renderer.domElement, (W - W * z) / 2 + (Math.random() - 0.5) * sh, (H - H * z) / 2 + (Math.random() - 0.5) * sh, W * z, H * z);
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, 58);
  ctx.fillRect(0, H - 58, W, 58);
  if (shot.flash !== false && f < 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - f / 3)})`;
    ctx.fillRect(0, 0, W, H);
  }
  shot.overlay?.call(shot, f / n, f, n);
}

async function upload(index) {
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92));
  await fetch(`/capture/hype_${String(index).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
}

// ------------------------------------------------------------------ shots
const card = (beats, lines, flashAt = 0) => ({
  beats,
  black: true,
  overlay: (t) => {
    const a = Math.min(1, t * 8, (1 - t) * 10);
    lines.forEach(([text, opts]) => drawText(text, { ...opts, size: (opts.size || 60) * (1 + 0.12 * (1 - Math.min(1, t * 4))), alpha: a }));
  },
});

let fightPed = null, jackCar = null, copCar = null;
const saved = { outfit: JSON.stringify(g.shop().outfit) };
const shots = [
  // ================================================================ build-up: bars 128-134 (28 beats)
  {
    // golden hour: over the sea toward the city
    beats: 4,
    setup() {
      calm();
      sky(17, 40);
      placeHero(40, EXT + 2, 0);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(60, 26, EXT + 150), v3(30, 34, EXT + 60), e);
      cam.lookAt(v3(0, 18, 0));
      cam.fov = 56;
    },
    overlay: (t) => punch('WELCOME TO SOL CITY', t, 0.3),
  },
  {
    // run down the beach into the sea
    beats: 4,
    setup() {
      sky(17, 50);
      placeHero(41, EXT + 2, 0);
      hold('KeyW', 'ShiftLeft');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(42.6, 0.2, EXT + 15 - t * 1.5);
      cam.lookAt(p.x, p.y + 1.0, p.z);
      cam.fov = 48;
    },
    overlay: (t) => punch('DIVE IN', t, 0.4, { bar: '#1aa3c8' }),
  },
  {
    // front crawl, the camera at the waterline
    beats: 4,
    setup() {
      sky(18, 0);
      placeHero(60, EXT + 42, Math.PI / 2, WY - 0.4);
      hold('KeyW', 'ShiftLeft');
      step(8);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 3.4 - t * 1.2, WY + 0.35, p.z + 2.4);
      cam.lookAt(p.x - 0.2, WY + 0.05, p.z);
      cam.fov = 50;
    },
  },
  {
    // the gym: bench press
    beats: 2,
    setup() {
      sky(18, 10);
      const b = enter('gym');
      this.st = b.spec.stations.find((s) => s.kind === 'bench');
      g.fun().start(this.st, b);
    },
    tick(f) {
      if (f % 3 === 0) tap('Space');
    },
    camera(cam, t) {
      const s = this.st;
      cam.position.set(s.x + 1.9 - t * 0.3, 1.25, s.z - 0.2);
      cam.lookAt(s.x, 0.75, s.z + 0.35);
      cam.fov = 50;
    },
    overlay: (t) => punch('GET STRONG', t, 0.2, { bar: '#b3202a' }),
  },
  {
    // treadmill
    beats: 2,
    setup() {
      g.fun().stop(true);
      const b = g.shop().inside;
      this.st = b.spec.stations.find((s) => s.kind === 'treadmill');
      g.fun().start(this.st, b);
    },
    tick(f) {
      if (f % 4 === 0) tap('Space');
    },
    camera(cam, t) {
      const s = this.st;
      cam.position.set(s.x - 1.6 + t * 0.4, 1.2, s.z + 1.8);
      cam.lookAt(s.x, 1.2, s.z);
      cam.fov = 52;
    },
  },
  {
    // fresh ink and a new cut: slow orbit round the hero in the tattoo parlour
    beats: 4,
    setup() {
      const b = enter('tattoo');
      const S = g.shop();
      S.outfit.hair = 'blonde';
      S.outfit.tattoos = ['tribal', 'skull', 'script', 'star'];
      S.applyOutfit();
      placeHero(b.room.ox - 0.5, b.room.oz + 0.3, 0, 0);
      P.indoors = true;
      this.b = b;
    },
    camera(cam, t) {
      const p = P.position, a = -0.9 + t * 1.3;
      cam.position.set(p.x + Math.sin(a) * 1.7, 1.45, p.z + Math.cos(a) * 1.7);
      cam.lookAt(p.x, 1.3, p.z);
      cam.fov = 48;
    },
    overlay: (t) => punch('YOUR LOOK, YOUR INK', t, 0.25, { bar: '#7a1450' }),
  },
  {
    // Club Solar: the dance floor and the crowd
    beats: 4,
    setup() {
      sky(23, 0);
      const b = enter('club');
      this.st = b.spec.stations.find((s) => s.kind === 'dance');
      g.fun().start(this.st, b);
      this.b = b;
    },
    camera(cam, t) {
      const f = this.b.spec.floor;
      cam.position.set(f.x + 4.5 - t * 2, 2.6 - t * 0.6, f.z - 5);
      cam.lookAt(f.x, 1.2, f.z);
      cam.fov = 58;
    },
    overlay: (t) => punch('NIGHTLIFE', t, 0.3, { bar: '#9b30d9' }),
  },
  {
    // the arcade's glowing cabinets
    beats: 2,
    setup() {
      const b = enter('arcade');
      this.st = b.spec.stations[0];
      g.fun().start(this.st, b);
    },
    camera(cam, t) {
      const s = this.st;
      cam.position.set(s.x - 1.6, 1.7, s.z - 2.4 + t * 0.6);
      cam.lookAt(s.x + 1, 1.3, s.z);
      cam.fov = 54;
    },
  },
  {
    // the sign on Mount Sol at dusk
    beats: 2,
    setup() {
      calm();
      sky(19, 40);
      placeHero(14, -9.6, Math.PI / 2);
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(110, 26, -HALF + 16), v3(140, 32, -HALF + 4), ease(t));
      cam.lookAt(v3(150, 33, -HALF - 46));
      cam.fov = 46;
    },
  },
  // ================================================================ bar 135: the gap before the drop
  card(4, [['ARE YOU READY?', { size: 96, spacing: 8, gradient: true }]]),
  // ================================================================ the drop: bars 136-167 (128 beats)
  {
    beats: 4,
    drop: true,
    setup() {
      sky(16, 30);
      drive('super', -200, 1.75, Math.PI / 2, 24, 0xf5c400);
    },
    camera(cam) {
      const v = dv();
      cam.position.copy(behind(v, 5.2, -1.1, 1.0));
      cam.lookAt(ahead(v, 7, 0.9));
      cam.fov = 66 + Math.min(18, v.speed * 0.4);
    },
    overlay: (t) => punch('OWN THE STREETS', t, 0.05),
  },
  {
    // handbrake drift into the intersection
    beats: 4,
    drop: true,
    setup() {
      drive('super', 30, 1.75, Math.PI / 2, 27, 0xf5c400);
    },
    tick(f) {
      if (f === 16) hold('KeyW', 'KeyA', 'Space');
      if (f === 40) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(78, 7 - t * 2.5, -14 + t * 3);
      cam.lookAt(v.pos.x, 0.5, v.pos.z);
      cam.fov = 55;
    },
  },
  {
    // road-level fly-by
    beats: 2,
    drop: true,
    setup() {
      drive('coupe', -62, 1.75, Math.PI / 2, 40, 0xc8102e);
    },
    camera(cam) {
      const v = dv();
      cam.position.set(-34, 0.4, 6.2);
      cam.lookAt(v.pos.x, 0.7, v.pos.z);
      cam.fov = 40;
    },
  },
  {
    // motorbike past the camera
    beats: 2,
    drop: true,
    setup() {
      drive('bike', C.roadC(4) - 1.75, 128, Math.PI, 30, 0x1f5fd6);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(C.roadC(4) - 5.2, 0.5 + t * 0.6, 106);
      cam.lookAt(v.pos.x, 1.0, v.pos.z);
      cam.fov = 40 + t * 14;
    },
  },
  {
    // stunt ramp, slow motion
    beats: 6,
    drop: true,
    setup() {
      const r = g.stunts().ramps[0];
      this.r = r;
      // the run-up: 45 m out (a beach bar stands further back), a little to the side of the
      // umbrella pole just in front of the ramp (the ramp is 4.2 m wide)
      const sx = -r.fz * 1.3, sz = r.fx * 1.3;
      calm();
      clearRoad(r.x - r.fx * 50 + sx, r.z - r.fz * 50 + sz, r.yaw, 120, 10);
      drive('super', r.x - r.fx * 45 + sx, r.z - r.fz * 45 + sz, r.yaw, 38, 0x7ad11f);
      step(24);
    },
    timeScale: 0.42,
    camera(cam, t) {
      const r = this.r, v = dv();
      cam.position.set(r.x + r.fx * 14 + r.fz * 13, 2.5 + t * 2, r.z + r.fz * 14 - r.fx * 13);
      cam.lookAt(v.pos.x, v.pos.y + 1.2, v.pos.z);
      cam.fov = 50;
    },
    overlay: (t) => punch('STUNT JUMPS', t, 0.25),
  },
  {
    // jetski skimming past at the waterline
    beats: 2,
    drop: true,
    setup() {
      sky(16, 50);
      drive('jetski', 20, EXT + 70, Math.PI / 2, 19, 0xff4fa3);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(44, WY + 0.5, EXT + 66);
      cam.lookAt(v.pos.x, WY + 0.8, v.pos.z);
      cam.fov = 42 + t * 10;
    },
    overlay: (t) => punch('RIDE THE WAVES', t, 0.15, { bar: '#1aa3c8' }),
  },
  {
    // speedboat out of the harbour, high and wide over the wake
    beats: 4,
    drop: true,
    setup() {
      drive('boat', -260, -EXT - 40, Math.PI / 2, 17, 0xf4f4f0);
    },
    tick(f) {
      if (f === 20) hold('KeyW', 'KeyA');
      if (f === 34) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 11 - t * 3, 6, 4.5 - t));
      cam.lookAt(ahead(v, 4, 0));
      cam.fov = 58;
    },
  },
  {
    // carjack: drag the driver out, in and gone
    beats: 8,
    drop: true,
    setup() {
      calm();
      sky(15, 0);
      const x = 34, z = 1.75;
      clearRoad(x - 20, z, Math.PI / 2, 120);
      jackCar = spawnCar('lux', x, z, Math.PI / 2, 0x14213d, { ctl: { throttle: 0, steer: 0, handbrake: true } });
      step(20);
      const v = jackCar.vehicle;
      placeHero(x + Math.cos(v.heading) * 3.2 - 1.5, z - Math.sin(v.heading) * 3.2, Math.PI);
      step(1);
      g.toggleVehicle();
      step(22); // (straight to the good part: the door swings open)
    },
    tick(f, n) {
      if (f === Math.round(n * 0.86)) hold('KeyW');
    },
    camera(cam, t) {
      const v = jackCar.vehicle;
      const a = v.heading + Math.PI / 2 + 0.75 - t * 0.55;
      const d = 5.4 - t * 0.8;
      cam.position.set(v.pos.x + Math.sin(a) * d, 1.55, v.pos.z + Math.cos(a) * d);
      cam.lookAt(v.pos.x - Math.sin(v.heading) * 0.6, 1.0, v.pos.z - Math.cos(v.heading) * 0.6);
      cam.fov = 52;
    },
    overlay: (t) => punch('TAKE WHAT YOU WANT', t, 0.5),
  },
  {
    // street fight
    beats: 3,
    drop: true,
    setup() {
      placeHero(19.5, -10.4, Math.PI / 2);
      for (const p of [...g.peds.list]) if (!p.keep && Math.hypot(p.x - 20, p.z + 10.4) < 6) g.peds.remove(p);
      fightPed = g.peds.add('male', 20.65, -10.4, -Math.PI / 2);
      fightPed.points = [{ x: 20.64, z: -10.4 }];
      fightPed.hits = 0;
      step(4);
    },
    tick(f) {
      if (f % 8 === 0 && fightPed.state !== 'down') tap('Mouse0');
      if (fightPed.hits > 4) fightPed.hits = 4;
    },
    camera(cam, t) {
      const p = P.position, a = -0.7 + t * 1.0;
      cam.position.set(p.x + 0.5 + Math.sin(a) * 2.4, 1.3, p.z - Math.cos(a) * 2.4);
      cam.lookAt(p.x + 0.5, 1.25, p.z);
      cam.fov = 50;
    },
    overlay: (t) => punch('THROW HANDS', t, 0.15),
  },
  {
    // the knockout, slow
    beats: 3,
    drop: true,
    timeScale: 0.3,
    setup() {
      if (fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, false);
    },
    camera(cam, t) {
      cam.position.set(fightPed.x + 0.5 - t * 0.7, 0.8, fightPed.z - 3.4);
      cam.lookAt(fightPed.x + 0.4, 0.8 - t * 0.3, fightPed.z);
      cam.fov = 44;
    },
    grade: 'contrast(1.28) saturate(.75)',
  },
  {
    // a 24/7 hold-up: the clerk's hands go up
    beats: 2,
    drop: true,
    setup() {
      const b = enter('mart');
      const S = g.shop(), clerk = S.clerks.get(b);
      const c = b.counter;
      placeHero(c.x, c.z - 0.4, Math.atan2(clerk.x - c.x, clerk.z - c.z + 0.4), 0);
      g.weapons().give('pistol');
      g.weapons().equip('pistol');
      P.indoors = true;
      trigger(true, 2);
      S.startRobbery(b, clerk);
      this.clerk = clerk;
      step(6);
    },
    camera(cam, t) {
      const k = this.clerk, p = P.position;
      cam.position.set(p.x - 0.9 + t * 0.2, 1.75, p.z - 1.1);
      cam.lookAt(k.x, 1.4, k.z);
      cam.fov = 48;
    },
    overlay: (t) => punch('HOLD-UPS', t, 0.15),
  },
  {
    // the bank: SMG up, the vault behind the teller line
    beats: 4,
    drop: true,
    setup() {
      g.shop().robbery = null;
      g.shop().alarm = false;
      const b = enter('bank');
      const v = b.vault;
      placeHero(v.x - 1.5, v.z - 4, Math.atan2(1.5, 4), 0);
      g.weapons().give('smg');
      g.weapons().equip('smg');
      P.indoors = true;
      trigger(true, 2);
      step(6);
      this.v = v;
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 1.2 - t * 0.9, 0.7 + t * 0.4, p.z - 1.6);
      cam.lookAt(this.v.x, 1.4, this.v.z);
      cam.fov = 54;
    },
    overlay: (t) => punch('ROB THE BANK', t, 0.2, { bar: '#c9a24a', color: '#fff' }),
  },
  {
    // police chase
    beats: 6,
    drop: true,
    setup() {
      g.shop().alarm = false;
      sky(19, 10);
      drive('super', -180, 1.75, Math.PI / 2, 30, 0xc8102e);
      for (let i = 0; i < 4; i++) g.wanted.crime('ram_cop', true);
      g.police.units.length = 0;
      for (const [back, side] of [[7, 0], [13, -3.5]]) {
        const c = spawnCar('police', -180 - back, 1.75 + side, Math.PI / 2, 0x111214, { police: true, ctl: { throttle: 0, steer: 0, handbrake: false } });
        c.vehicle.vel.set(31, 0, 0);
        c.vehicle.siren = true;
        g.police.units.push({ c, wp: null, stuck: 0, reverse: 0, officers: 0, leaving: false, life: 0 });
      }
      hold();
      step(6);
    },
    tick() {
      const lead = g.police.units[0]?.c.vehicle;
      hold(lead && dv().pos.x - lead.pos.x < 6 ? 'KeyW' : null);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(ahead(v, 8 - t * 2, 1.1));
      cam.position.z += 2.6;
      cam.lookAt(v.pos.x - 6, 1.0, v.pos.z);
      cam.fov = 60;
    },
    overlay: (t) => stars(4, t),
  },
  {
    // SMG into a patrol car
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(19, 20);
      placeHero(-20, -9.3, Math.PI / 2);
      copCar = spawnCar('police', -10, -4.2, -Math.PI / 2 + 0.25, 0x111214);
      copCar.vehicle.siren = true;
      copCar.health = 60;
      g.weapons().give('smg');
      g.weapons().equip('smg');
      P.yaw = Math.atan2(-10 - P.position.x, -4.2 - P.position.z);
      P.object.rotation.set(0, P.yaw, 0);
      g.follow.yaw = P.yaw;
      step(3);
      trigger(true);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 2.6 + t * 0.5, 1.65, p.z - 0.2 + t * 0.3);
      cam.lookAt(-12, 1.0, -5.2);
      cam.fov = 50;
    },
    overlay: (t) => punch('FIGHT BACK', t, 0.1),
  },
  {
    // boom
    beats: 6,
    drop: true,
    timeScale: 0.4,
    setup() {
      trigger(false);
      vehicles.activate(copCar);
      if (copCar.health !== 0) vehicles.explode(copCar);
    },
    camera(cam, t) {
      const v = copCar.vehicle, a = 2.2 + t * 0.5;
      cam.position.set(v.pos.x + Math.sin(a) * 9, 1.2 + t * 1.5, v.pos.z + Math.cos(a) * 9);
      cam.lookAt(v.pos.x, 1.4, v.pos.z);
      cam.fov = 50;
    },
    grade: 'contrast(1.22) saturate(1.35)',
  },
  {
    // the helicopter's searchlight at night
    beats: 6,
    drop: true,
    setup() {
      calm();
      sky(23, 30);
      drive('coupe', -60, -1.75, Math.PI / 2, 14, 0xf2f2f2);
      for (let i = 0; i < 4; i++) g.wanted.crime('ram_cop', true);
      const h = g.heli();
      if (h) {
        h.spawn(dv().pos);
        h.pos.set(-48, 27, 18);
      }
      step(20);
    },
    tick(f) {
      const v = dv();
      hold(v.speed > 15 ? 'KeyS' : 'KeyW');
      const h = g.heli();
      if (h) {
        h.pos.set(v.pos.x + 20 - f * 0.04, 17, v.pos.z + 3 + Math.sin(f * 0.05) * 2);
        h.vel?.set(v.vel.x, 0, 0);
      }
    },
    camera(cam, t) {
      const v = dv(), h = g.heli();
      cam.position.copy(behind(v, 7.5 - t * 1.5, 1.6, 1.25));
      const look = h ? h.pos.clone().lerp(v.pos, 0.7) : ahead(v, 10);
      cam.lookAt(look.x, look.y, look.z);
      cam.fov = 70;
    },
    grade: 'brightness(1.3) contrast(1.1) saturate(1.3)',
    overlay: (t) => stars(5, t),
  },
  {
    // the fire truck's cannon on a burning car
    beats: 4,
    drop: true,
    setup() {
      calm();
      g.heli()?.obj && (g.heli().obj.visible = false);
      sky(21, 30);
      clearRoad(30, 1.75, Math.PI / 2, 80);
      const car = spawnCar('sedan', 62, 5.4, Math.PI / 2 + 0.3, 0x5a6a7a);
      car.burning = true;
      car.fireJob = true;
      car.health = 12;
      car.keep = true;
      const ft = spawnCar('firetruck', 46, 1.75, Math.PI / 2, 0xb3141c);
      g.seat(ft);
      ft.vehicle.siren = true;
      g.follow.yaw = Math.atan2(62 - 46, 5.4 - 1.75);
      step(12);
      trigger(true);
      this.car = car;
    },
    tick() {
      g.follow.yaw = Math.atan2(62 - dv().pos.x, 5.4 - dv().pos.z);
    },
    camera(cam, t) {
      cam.position.set(52 + t * 2, 3.2, 12.5);
      cam.lookAt(56, 1.6, 3);
      cam.fov = 56;
    },
    after() {
      trigger(false);
      this.car.fireJob = false;
      this.car.keep = false;
    },
    grade: 'brightness(1.2) contrast(1.12) saturate(1.3)',
    overlay: (t) => punch('FIREFIGHTER', t, 0.2, { bar: '#e0561e' }),
  },
  {
    // the ambulance, lights going
    beats: 2,
    drop: true,
    setup() {
      sky(21, 40);
      drive('ambulance', -140, 1.75, Math.PI / 2, 18, 0xf4f4f0);
      dv().siren = true;
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(ahead(v, 9 - t * 3, 0.7));
      cam.position.z += 4;
      cam.lookAt(v.pos.x, 1.4, v.pos.z);
      cam.fov = 54;
    },
    grade: 'brightness(1.25) contrast(1.1) saturate(1.3)',
    overlay: (t) => punch('PARAMEDIC', t, 0.1, { bar: '#d63a3a' }),
  },
  {
    // the bus
    beats: 2,
    drop: true,
    setup() {
      sky(9, 0);
      drive('bus', -150, 1.75, Math.PI / 2, 11, 0xf2c12e);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 10 - t * 6, 1.1, v.pos.z + 8);
      cam.lookAt(v.pos.x, 1.6, v.pos.z);
      cam.fov = 50;
    },
    overlay: (t) => punch('BUS DRIVER', t, 0.1, { bar: '#d8a514' }),
  },
  {
    // truck and trailer
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(9, 20);
      const X = -170, Z = 1.75;
      clearRoad(X - 20, Z, Math.PI / 2, 140);
      const tr = spawnCar('trailer', X - 7.65, Z, Math.PI / 2, 0xf2f2ee);
      const tk = spawnCar('truck', X, Z, Math.PI / 2, 0x1f4f9e);
      vehicles.hitch(tk, tr);
      tk.vehicle.vel.set(14, 0, 0);
      g.seat(tk);
      hold('KeyW');
      step(4);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 12 - t * 10, 1.0, v.pos.z - 9);
      cam.lookAt(v.pos.x - 4, 2.0, v.pos.z);
      cam.fov = 56;
    },
    overlay: (t) => punch('TRUCKER', t, 0.15, { bar: '#2a7ad8' }),
  },
  {
    // tow truck, a car on the boom
    beats: 2,
    drop: true,
    setup() {
      calm();
      const X = -160, Z = -1.75, yaw = -Math.PI / 2;
      clearRoad(X + 20, Z, yaw, 120);
      const tw = spawnCar('towtruck', X, Z, yaw, 0xe8a21a);
      const car = spawnCar('sedan', X + 3.25 + 2.36, Z, yaw, 0x8a8f96);
      vehicles.hitch(tw, car);
      tw.vehicle.siren = true;
      tw.vehicle.vel.set(-12, 0, 0);
      g.seat(tw);
      hold('KeyW');
      step(4);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x - 7 + t * 5, 1.4, v.pos.z + 7);
      cam.lookAt(v.pos.x + 2.5, 1.0, v.pos.z);
      cam.fov = 54;
    },
    overlay: (t) => punch('TOW TRUCK', t, 0.1, { bar: '#c47a12' }),
  },
  {
    // a taxi at night
    beats: 2,
    drop: true,
    setup() {
      sky(22, 10);
      drive('taxi', -120, -1.75, -Math.PI / 2, 15, 0xf2c12e);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 6 - t * 2, -2.6, 1.4));
      cam.lookAt(ahead(v, 3, 1));
      cam.fov = 54;
    },
    grade: 'brightness(1.3) contrast(1.1) saturate(1.4)',
    overlay: (t) => punch('TAXI', t, 0.1, { bar: '#d8a514' }),
  },
  {
    // darts at Club Solar
    beats: 2,
    drop: true,
    setup() {
      sky(23, 0);
      const b = enter('club');
      this.st = b.spec.stations.find((s) => s.kind === 'darts');
      g.fun().start(this.st, b);
    },
    camera(cam, t) {
      const s = this.st;
      cam.position.set(s.x - 1.2, 1.75, s.z - 1.4 + t * 0.4);
      cam.lookAt(s.x + 2.4, 1.6, s.z);
      cam.fov = 50;
    },
    overlay: (t) => punch('PLAY HARD', t, 0.1, { bar: '#9b30d9' }),
  },
  {
    // the bounty board: wanted men, alive or dead
    beats: 2,
    drop: true,
    setup() {
      const B = g.bounties().board;
      placeHero(B.x - 1.1, B.z - 0.4, Math.PI * 0.85);
      this.B = B;
    },
    camera(cam, t) {
      const B = this.B;
      cam.position.set(B.x + 1.3 - t * 0.6, 1.7, B.z - 2.4);
      cam.lookAt(B.x, 1.6, B.z + 0.9);
      cam.fov = 46;
    },
    overlay: (t) => punch('BOUNTY HUNTER', t, 0.1),
  },
  {
    // street race countdown, then off
    beats: 4,
    drop: true,
    setup() {
      sky(17, 0);
      const r = g.races().list[0];
      drive('super', r.startPos.x, r.startPos.z, r.yaw, 0, 0xff6a13);
      clearRoad(r.startPos.x, r.startPos.z, r.yaw, 200);
      hold();
      g.races().start(r, dv());
      step(Math.round(FPS * 2.6));
    },
    tick(f) {
      if (f === 1) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 7 - t * 2, 2.5, 1.6 + t * 0.6));
      cam.lookAt(ahead(v, 12, 1));
      cam.fov = 56 + t * 12;
    },
    overlay(t) {
      const R = g.races();
      if (R.state === 'countdown' && Math.ceil(R.t) > 0) drawText(String(Math.ceil(R.t)), { size: 150, y: H / 2 - 50, color: '#ffd23f', stroke: 10 });
      else if (t < 0.5) drawText('GO!', { size: 150, y: H / 2 - 50, color: '#7ad65b', stroke: 10 });
      punch('STREET RACES', t, 0.5);
    },
  },
  {
    // a contact's back room
    beats: 8,
    drop: true,
    setup() {
      g.races().stop?.('');
      calm();
      sky(21, 0);
      const S = g.story();
      const c = S.contacts.find((q) => q.id === 'zara') || S.contacts[0];
      S.startCutscene(c);
      for (let i = 0; i < 200 && !(S.cut && S.cut.arr); i++) step(1);
      step(20);
      this.S = S;
    },
    camera: null,
    overlay(t) {
      const cut = this.S.cut;
      if (cut?.m) {
        const [who, text] = cut.m.lines[Math.max(0, cut.i)] || ['', ''];
        const shown = text.slice(0, Math.floor(cut.chars));
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(W * 0.12, H - 190, W * 0.76, 120);
        ctx.restore();
        drawText(who, { size: 28, y: H - 165, color: who === 'YOU' ? '#9fe0ff' : cut.c.color, stroke: 0, spacing: 4 });
        ctx.save();
        ctx.font = '600 28px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        let line = '', y = H - 128;
        for (const w of shown.split(' ')) {
          if (ctx.measureText(line + w).width > W * 0.64) {
            ctx.fillText(line, W / 2, y);
            line = '';
            y += 32;
          }
          line += w + ' ';
        }
        ctx.fillText(line, W / 2, y);
        ctx.restore();
      }
      // the title up top, clear of the subtitles
      drawText('15 STORY MISSIONS', { size: 54, y: 112, gradient: true, stroke: 5, spacing: 4, alpha: Math.min(1, t * 6) });
    },
    tick(f) {
      if (f % 30 === 29) tap('Space');
    },
    after() {
      const S = this.S;
      if (S.cut) {
        if (S.cut.arr) S.leaveRoom();
        S.cut = null;
      }
      document.body.classList.remove('cutscene');
      S.fade(false);
    },
    flash: false,
  },
  {
    // nitro: a tuned supercar
    beats: 4,
    drop: true,
    setup() {
      sky(16, 0);
      const c = drive('super', -230, 1.75, Math.PI / 2, 20, 0x7a2bd6);
      c.tune = { engine: 3, nitro: true, rims: 'gold', tint: true };
      c.vehicle.applyTune();
      hold('KeyW', 'ShiftLeft');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 4.2 + t * 2, 1.6, 0.55));
      cam.lookAt(ahead(v, 6, 0.8));
      cam.fov = 70 + t * 16;
    },
    overlay: (t) => punch('TUNE YOUR RIDE', t, 0.15, { bar: '#e0407e' }),
  },
  {
    // thunderstorm on the neon street
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(22, 30, 'storm');
      drive('lux', -150, 1.75, Math.PI / 2, 16, 0x0d0e10);
      env.flash = 1;
      step(5);
    },
    tick(f) {
      hold(dv().speed > 17 ? null : 'KeyW');
      if (f === 26) env.flash = 1;
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 10 - t * 7, 0.6, v.pos.z - 6);
      cam.lookAt(v.pos.x + 1, 0.8, v.pos.z);
      cam.fov = 50;
    },
    grade: 'brightness(1.3) contrast(1.15) saturate(1.25)',
    overlay: (t) => punch('A LIVING WORLD', t, 0.25),
  },
  {
    // neon night cruise
    beats: 4,
    drop: true,
    setup() {
      sky(23, 15);
      drive('super', -185, 1.75, Math.PI / 2, 17, 0xc8102e);
    },
    tick() {
      hold(dv().speed > 18 ? null : 'KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 9 - t * 6, 1.5, v.pos.z - 6.5);
      cam.lookAt(v.pos.x + 1.5, 0.9, v.pos.z);
      cam.fov = 52;
    },
    grade: 'brightness(1.35) contrast(1.1) saturate(1.45)',
    overlay: (t) => punch('DAY AND NIGHT', t, 0.2),
  },
  {
    // the jetski from behind, spray flying
    beats: 4,
    drop: true,
    setup() {
      sky(10, 30);
      drive('jetski', 160, EXT + 80, -Math.PI / 2, 18, 0x41d6ff);
    },
    tick(f) {
      if (f === 18) hold('KeyW', 'KeyD');
      if (f === 32) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 5.5, -1.5, 1.1));
      cam.position.y = WY + 1.3;
      cam.lookAt(ahead(v, 6, WY + 0.6));
      cam.fov = 62;
    },
  },
  {
    // sunrise over the beach jetty, the jetskis bobbing
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(7, 0);
      placeHero(118, EXT + 20, 0, 0.32);
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(135, 6, EXT + 58), v3(128, 4, EXT + 44), ease(t));
      cam.lookAt(v3(118, 0, EXT + 28));
      cam.fov = 54;
    },
    grade: 'contrast(1.12) saturate(1.35) brightness(1.05)',
  },
  {
    // the hero walks at the camera, sunset behind
    beats: 4,
    drop: true,
    setup() {
      sky(18, 20);
      placeHero(14, -9.6, Math.PI / 2);
      hold('KeyW');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 2.6 - t * 0.4, p.y + 0.6, p.z + 0.7 - t * 0.3);
      cam.lookAt(p.x, p.y + 1.5, p.z);
      cam.fov = 44;
    },
  },
  card(4, [['HOLD $SOLCITY', { size: 92, y: H / 2 - 60, spacing: 6, color: '#fff' }], ['EARN $DACITY', { size: 92, y: H / 2 + 55, spacing: 6, gradient: true }]]),
  {
    // the night skyline from over the sea, the sign lit
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(22, 0);
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(190, 30, -HALF + 30), v3(140, 40, -HALF + 8), ease(t));
      cam.lookAt(v3(150, 34, -HALF - 46));
      cam.fov = 55;
    },
    grade: 'brightness(1.25) contrast(1.12) saturate(1.35)',
  },
  // ================================================================ bars 168-171: the logo (16 beats)
  {
    beats: 16,
    setup() {
      calm();
      sky(21, 40);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(150, 40, 230), v3(118, 72, 188), e);
      cam.lookAt(v3(0, 30 + 10 * e, 0));
      cam.fov = 55;
    },
    grade: 'contrast(1.15) saturate(1.3) brightness(1.08)',
    overlay: (t) => {
      const a = Math.min(1, (t - 0.04) * 6);
      drawText('SOL CITY', { size: 160 * (1 + 0.3 * Math.max(0, 1 - t * 6)), y: H / 2 - 40, gradient: true, stroke: 10, spacing: 6, alpha: a });
      drawText('PLAY IT IN YOUR BROWSER', { size: 32, y: H / 2 + 70, spacing: 8, color: '#f6e3c2', stroke: 4, alpha: Math.min(1, (t - 0.25) * 4) });
      if (t > 0.86) {
        ctx.fillStyle = `rgba(0,0,0,${(t - 0.86) / 0.14})`;
        ctx.fillRect(0, 0, W, H);
      }
    },
  },
];

// ------------------------------------------------------------------ record
const Q = new URLSearchParams(location.search);
const FROM = parseInt(Q.get('from') || '0', 10), TO = parseInt(Q.get('to') || '999', 10);
const REC = Q.get('rec') ? Q.get('rec').split(',').flatMap((r) => {
  const [a, b] = r.split('-').map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}) : null;
const TOTAL_BEATS = 176; // bars 128-172 of the track

async function run() {
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:14px monospace;z-index:9;background:#000a;padding:4px 8px';
  document.body.appendChild(status);
  const sum = shots.reduce((s, x) => s + x.beats, 0);
  if (sum !== TOTAL_BEATS) console.warn('hype: beats', sum, 'expected', TOTAL_BEATS);
  window.__hypeBeats = sum;
  try {
    localStorage.removeItem('solcity.jumps');
  } catch {}
  g.stunts().ramps.forEach((r) => (r.done = false));
  g.setCinematic(null);
  step(150);
  let index = 0;
  for (let k = 0; k < shots.length; k++) {
    const shot = shots[k];
    const n = shot.beats * BEAT;
    if (!shot.black) {
      g.setCinematic(null);
      shot.setup?.call(shot);
    }
    g.setCinematic(shot.camera ? (cam) => {
      shot.camera.call(shot, cam, shot._t);
      cam.updateProjectionMatrix();
    } : null);
    const rec = REC ? REC.includes(k) : k >= FROM && k <= TO;
    for (let f = 0; f < n; f++) {
      shot._t = f / n;
      shot.tick?.call(shot, f, n);
      if (!rec) {
        if (!shot.black) g.step(DT * (shot.timeScale || 1));
        index++;
        continue;
      }
      if (shot.black) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        shot.overlay(shot._t, f, n);
        if (f < 3) {
          ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - f / 3)})`;
          ctx.fillRect(0, 0, W, H);
        }
      } else {
        g.step(DT * (shot.timeScale || 1));
        g.render();
        composite(shot, f, n);
      }
      await upload(index++);
      status.textContent = `recording ${index}/${TOTAL_BEATS * BEAT} (shot ${k + 1}/${shots.length})`;
    }
    shot.after?.call(shot);
  }
  // put the hero's look back the way it was
  const S = g.shop();
  S.outfit = JSON.parse(saved.outfit);
  S.applyOutfit();
  status.textContent = `done: ${index} frames`;
  window.__hypeDone = index;
}

run().catch((e) => {
  window.__hypeErr = String(e && e.stack || e);
  console.error(e);
});
