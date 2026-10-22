// Trailer recorder (open the game with ?trailer). Steps the game at a fixed 30 fps,
// drives scripted shots (camera + inputs), composites titles/grading on top and uploads
// every frame to the dev server (captures/trailer/fNNNNN.jpg) for encoding.
// 60 seconds cut to the music: 123 BPM, every shot is a whole number of beats.
import * as THREE from 'three';

const W = 1280, H = 720, FPS = 30, DT = 1 / FPS;
const BEAT = (60 / 123) * FPS; // frames per beat
const g = window.__game;
window.__trailer = true;

for (const id of ['stats', 'radar', 'street', 'help', 'speedo', 'hint', 'overlay', 'cutscene', 'fade', 'crosshair', 'msg', 'mission']) {
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
  for (const c of codes) keys.add(c);
};
const tap = (code) => g.input.pressedOnce.add(code);
const trigger = (on) => (on ? g.input.buttons.add(0) : g.input.buttons.delete(0));
const env = g.env, P = g.player, vehicles = g.vehicles;
const driving = () => g.state().driving;
const dv = () => driving()?.vehicle;
const ROAD = (i) => g.city.roadC(i);
const HALF = g.city.HALF;

// ------------------------------------------------------------------ world helpers
function step(n = 1, scale = 1) {
  for (let i = 0; i < n; i++) g.step(DT * scale);
}
function calm() {
  hold();
  trigger(false);
  g.police.clear?.();
  g.wanted.clear();
  if (driving()) g.exit();
}
function sky(h, m = 0, weather = 'clear') {
  env.setTime(h, m);
  env.setWeather(weather, true);
  env.wet = weather === 'rain' || weather === 'storm' ? 1 : 0;
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
// the hero at the wheel of a fresh car already rolling at speed
function drive(model, x, z, yaw, speed, color) {
  calm();
  const c = spawnCar(model, x, z, yaw, color);
  const v = c.vehicle;
  v.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
  g.seat(c);
  hold('KeyW');
  return c;
}
// no traffic through the shot: cars near (x, z) go, and none spawn for a while
function clearTraffic(x, z, r = 80, hold = 8) {
  const T = g.traffic;
  for (const c of [...T.cars]) {
    const v = c.vehicle;
    if (v && Math.hypot(v.pos.x - x, v.pos.z - z) > r) continue;
    T.cars.splice(T.cars.indexOf(c), 1);
    if (v?.npcDriver) g.peds.unseatDriver(v);
    if (v) vehicles.remove(c);
  }
  T.spawnTimer = hold;
}
function placeHero(x, z, yaw) {
  calm();
  P.position.set(x, g.city.groundHeight(x, z), z);
  P.yaw = yaw;
  P.object.rotation.set(0, yaw, 0);
  P.vel?.set(0, 0, 0);
  g.follow.yaw = yaw;
}
function behind(v, back, side, up) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  return v3(v.pos.x - fx * back + fz * side, up, v.pos.z - fz * back - fx * side);
}
function ahead(v, d, up = 0.8) {
  return v3(v.pos.x + Math.sin(v.heading) * d, up, v.pos.z + Math.cos(v.heading) * d);
}

// ------------------------------------------------------------------ compositing
function drawText(text, { size = 64, y = H / 2, alpha = 1, color = '#fff', stroke = 6, gradient = false, spacing = 2, x = W / 2, align = 'center', italic = false }) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.font = `${italic ? 'italic ' : ''}${size}px Anton, Impact, sans-serif`;
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
// a caption that punches in (scale + fade) at t0
function punch(text, t, t0 = 0.15, opts = {}) {
  const k = (t - t0) * 7;
  if (k <= 0) return;
  const s = 1 + 0.35 * Math.max(0, 1 - k);
  drawText(text, { size: (opts.size || 72) * s, y: H - 128, alpha: Math.min(1, k), ...opts, ...(opts.size ? { size: opts.size * s } : {}) });
}
function stars(n, t) {
  for (let i = 0; i < 5; i++) {
    const on = i < n && t * 10 > i * 0.8;
    drawText('★', { size: 54, x: W - 330 + i * 58, y: 110, color: on ? '#ffd23f' : 'rgba(255,255,255,.25)', stroke: 4 });
  }
}

function composite(shot, f, n) {
  ctx.save();
  ctx.filter = shot.grade || 'contrast(1.12) saturate(1.22)';
  // a little zoom punch on every cut
  const z = 1 + 0.05 * Math.max(0, 1 - f / 6);
  ctx.drawImage(g.renderer.domElement, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillRect(0, H - 62, W, 62);
  if (shot.flash !== false && f < 4) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - f / 4)})`;
    ctx.fillRect(0, 0, W, H);
  }
  shot.overlay?.call(shot, f / n, f, n);
}

async function upload(index) {
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92));
  await fetch(`/capture/f${String(index).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
}

// ------------------------------------------------------------------ shots
const card = (beats, lines) => ({
  beats,
  black: true,
  overlay: (t) => {
    const a = Math.min(1, t * 8, (1 - t) * 8);
    lines.forEach(([text, opts]) => drawText(text, { ...opts, size: (opts.size || 60) * (1 + 0.15 * (1 - Math.min(1, t * 4))), alpha: a }));
  },
});

let fightPed = null, jackCar = null, copCar = null;
const shots = [
  card(2, [['SOL CITY STORIES', { size: 34, spacing: 12, color: '#f2d48c', stroke: 0 }]]),
  {
    // golden-hour sweep over downtown
    beats: 4,
    setup() {
      calm();
      sky(16, 50);
      placeHero(14, -9.6, Math.PI / 2);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(-190, 105, 170), v3(-60, 52, 60), e);
      cam.lookAt(v3(30, 10, -30));
      cam.fov = 58;
    },
  },
  {
    // Mount Sol and the sign
    beats: 4,
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(105, 24, -HALF + 18), v3(158, 33, -HALF + 2), e);
      cam.lookAt(v3(150, 33, -HALF - 46));
      cam.fov = 46;
    },
    overlay: (t) => punch('WELCOME TO SOL CITY', t, 0.3, { size: 76 }),
  },
  {
    // the hero walks toward a low tracking camera
    beats: 4,
    setup() {
      placeHero(14, -9.6, Math.PI / 2);
      hold('KeyW');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 2.5 - t * 0.4, p.y + 0.7, p.z + 0.6 - t * 0.3);
      cam.lookAt(p.x, p.y + 1.45, p.z);
      cam.fov = 46;
    },
  },
  {
    // people in the street, every one dressed differently
    beats: 3,
    setup() {
      calm();
      placeHero(60, -30, 0);
      this.crowd = [];
      for (let i = 0; i < 6; i++) {
        const p = g.peds.add(i % 2 ? 'female' : 'male', 30 + i * 2.3, -9 - (i % 3) * 0.9, -Math.PI / 2);
        p.points = [{ x: 0, z: p.z }];
        p.speed = 1.2 + (i % 3) * 0.15;
        this.crowd.push(p);
      }
      step(10);
    },
    camera(cam, t) {
      cam.position.set(16 - t * 1.5, 1.1, -12.5);
      cam.lookAt(28 - t * 2, 1.2, -9.5);
      cam.fov = 44;
    },
  },
  {
    // street fight: jab-cross combos
    beats: 4,
    setup() {
      for (const p of this.prev?.crowd || []) p.keep = false;
      placeHero(19.5, -10.4, Math.PI / 2);
      fightPed = g.peds.add('male', 20.55, -10.4, -Math.PI / 2);
      fightPed.points = [{ x: 20.54, z: -10.4 }];
      fightPed.hits = 0;
      step(4);
    },
    tick(f) {
      if (f % 9 === 0 && fightPed.state !== 'down') tap('Mouse0');
      if (fightPed.hits > 4) fightPed.hits = 4;
    },
    camera(cam, t) {
      const p = P.position;
      const a = -0.7 + t * 1.1;
      cam.position.set(p.x + 0.5 + Math.sin(a) * 2.5, 1.3, p.z - Math.cos(a) * 2.5);
      cam.lookAt(p.x + 0.5, 1.25, p.z);
      cam.fov = 50;
    },
    overlay: (t) => punch('THROW HANDS', t, 0.2),
  },
  {
    // slow-motion knockout
    beats: 3,
    timeScale: 0.3,
    setup() {
      if (fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, true);
    },
    camera(cam, t) {
      cam.position.set(fightPed.x + 0.5 - t * 0.7, 0.8, fightPed.z - 3.4);
      cam.lookAt(fightPed.x + 0.4, 0.8 - t * 0.3, fightPed.z);
      cam.fov = 44;
    },
    grade: 'contrast(1.25) saturate(.7)',
  },
  {
    // grab the cash
    beats: 2,
    setup() {
      if (!g.peds.cash.length) g.peds.dropCash(fightPed.x + 0.2, fightPed.z + 0.8);
      const c = g.peds.cash[g.peds.cash.length - 1];
      placeHero(c.x - 1.8, c.z, Math.PI / 2);
      hold('KeyW');
      this.cash = c;
    },
    camera(cam) {
      const c = this.cash, p = P.position;
      cam.position.set(p.x - 1.3, 1.7, p.z - 1.3);
      cam.lookAt(c.x, 0.45, c.z);
      cam.fov = 46;
    },
    overlay(t) {
      drawText('+$' + (this.cash?.amount || 120), { size: 84, y: H / 2 - 40, color: '#7ad65b', alpha: t > 0.35 ? (t - 0.35) * 6 : 0, x: W * 0.68 });
    },
  },
  {
    // carjack: door open, the driver dragged out and thrown down, in and gone
    beats: 9,
    setup() {
      calm();
      const x = 34, z = 1.75;
      clearTraffic(x, z, 90, 10);
      jackCar = spawnCar('lux', x, z, Math.PI / 2, 0x14213d, { ctl: { throttle: 0, steer: 0, handbrake: true } });
      // the driver loop seats somebody at the wheel
      this.cam = v3(x - 3, 1.5, z - 7);
      g.setCinematic((cam) => {
        cam.position.copy(this.cam);
        cam.lookAt(x, 1, z);
      });
      step(20);
      const v = jackCar.vehicle;
      placeHero(x + Math.cos(v.heading) * 3.2 - 1.5, z - Math.sin(v.heading) * 3.2, Math.PI);
      step(1);
      g.toggleVehicle();
      step(6);
    },
    tick(f, n) {
      if (f === Math.round(n * 0.82)) hold('KeyW');
    },
    camera(cam, t) {
      const v = jackCar.vehicle;
      const a = v.heading + Math.PI / 2 + 0.75 - t * 0.55; // the driver side
      const d = 5.6 - t * 0.8;
      cam.position.set(v.pos.x + Math.sin(a) * d, 1.55, v.pos.z + Math.cos(a) * d);
      cam.lookAt(v.pos.x - Math.sin(v.heading) * 0.6, 1.0, v.pos.z - Math.cos(v.heading) * 0.6);
      cam.fov = 52;
    },
    overlay: (t) => punch('TAKE WHAT YOU WANT', t, 0.55),
  },
  {
    // floor it: low chase camera
    beats: 4,
    setup() {
      drive('super', -200, 1.75, Math.PI / 2, 22, 0xf5c400);
    },
    camera(cam) {
      const v = dv();
      cam.position.copy(behind(v, 5.2, -1.1, 1.05));
      cam.lookAt(ahead(v, 7, 0.9));
      cam.fov = 64 + Math.min(18, v.speed * 0.4);
    },
  },
  {
    // handbrake drift into the intersection
    beats: 4,
    setup() {
      drive('super', 30, 1.75, Math.PI / 2, 27, 0xf5c400);
    },
    tick(f) {
      if (f === 18) hold('KeyW', 'KeyA', 'Space');
      if (f === 42) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(78, 7 - t * 2.5, -14 + t * 3);
      cam.lookAt(v.pos.x, 0.5, v.pos.z);
      cam.fov = 55;
    },
    overlay: (t) => punch('OWN THE STREETS', t, 0.35),
  },
  {
    // road-level fly-by
    beats: 2,
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
    // motorbike blasting past the camera
    beats: 4,
    setup() {
      drive('bike', ROAD(4) - 1.75, 128, Math.PI, 30, 0x1f5fd6);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(ROAD(4) - 5.2, 0.5 + t * 0.6, 100);
      cam.lookAt(v.pos.x, 1.0, v.pos.z);
      cam.fov = 38 + t * 14;
    },
  },
  {
    // stunt ramp: slow-motion flight
    beats: 5,
    setup() {
      const r = g.stunts().ramps[0];
      this.r = r;
      drive('super', r.x - r.fx * 70, r.z - r.fz * 70, r.yaw, 38, 0x7ad11f);
      step(38);
    },
    timeScale: 0.42,
    camera(cam, t) {
      const r = this.r, v = dv();
      cam.position.set(r.x + r.fx * 14 + r.fz * 13, 2.5 + t * 2, r.z + r.fz * 14 - r.fx * 13);
      cam.lookAt(v.pos.x, v.pos.y + 1.2, v.pos.z);
      cam.fov = 50;
    },
    grade: 'contrast(1.18) saturate(1.35)',
    overlay: (t) => punch('STUNT JUMPS', t, 0.25),
  },
  {
    // street race: countdown at the start beam, then off toward the checkpoints
    beats: 5,
    setup() {
      const r = g.races().list[0];
      this.r = r;
      drive('super', r.startPos.x, r.startPos.z, r.yaw, 0, 0xff6a13);
      hold();
      g.races().start(r, dv());
      step(Math.round(FPS * 2.1));
    },
    tick(f) {
      if (f === 2) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 7 - t * 2, 2.5, 1.6 + t * 0.6));
      cam.lookAt(ahead(v, 12, 1));
      cam.fov = 56 + t * 12;
    },
    overlay(t) {
      const n = Math.ceil(g.races().t);
      if (g.races().state === 'countdown' && n > 0) drawText(String(n), { size: 160, y: H / 2 - 40, color: '#ffd23f', stroke: 10 });
      else if (t < 0.55) drawText('GO!', { size: 160, y: H / 2 - 40, color: '#7ad65b', stroke: 10 });
      punch('STREET RACES', t, 0.45);
    },
  },
  card(1, [['MOST WANTED', { size: 84, spacing: 8, color: '#ff4040' }]]),
  {
    // police chase, sirens screaming
    beats: 6,
    setup() {
      g.races().stop?.('');
      drive('super', -180, 1.75, Math.PI / 2, 30, 0xc8102e);
      for (let i = 0; i < 4; i++) g.wanted.crime('ram_cop', true);
      g.police.units.length = 0;
      for (const [back, side] of [[7, 0], [13, -3.5]]) {
        const c = spawnCar('police', -180 - back, 1.75 + side, Math.PI / 2, 0x111214, { police: true, ctl: { throttle: 0, steer: 0, handbrake: false } });
        c.vehicle.vel.set(31, 0, 0);
        c.vehicle.siren = true;
        g.police.units.push({ c, wp: null, stuck: 0, reverse: 0, officers: 0, leaving: false, life: 0 });
      }
      sky(19, 10);
      hold();
      step(6);
    },
    tick() {
      // keep the hero just ahead of the patrol cars
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
    // fight back: SMG into a patrol car
    beats: 4,
    setup() {
      calm();
      sky(19, 20);
      placeHero(-20, -9.3, Math.PI / 2);
      copCar = spawnCar('police', -10, -4.2, -Math.PI / 2 + 0.25, 0x111214);
      copCar.vehicle.siren = true;
      copCar.health = 60; // already shot up: stays live (smoking) instead of being parked away
      const W_ = g.weapons();
      W_.give('smg');
      W_.equip('smg');
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
    overlay: (t) => punch('FIGHT BACK', t, 0.3),
  },
  {
    // boom
    beats: 4,
    timeScale: 0.4,
    setup() {
      trigger(false);
      vehicles.activate(copCar);
      if (copCar.health !== 0) vehicles.explode(copCar);
    },
    camera(cam, t) {
      const v = copCar.vehicle;
      const a = 2.2 + t * 0.5;
      cam.position.set(v.pos.x + Math.sin(a) * 9, 1.2 + t * 1.5, v.pos.z + Math.cos(a) * 9);
      cam.lookAt(v.pos.x, 1.4, v.pos.z);
      cam.fov = 50;
    },
    grade: 'contrast(1.2) saturate(1.3)',
  },
  {
    // bail out of a moving car and roll
    beats: 4,
    setup() {
      g.weapons().equip(null);
      sky(19, 30);
      drive('sedan', -120, 5.25, Math.PI / 2, 21, 0xb9bdc2);
      step(2);
    },
    tick(f) {
      if (f === 4) g.toggleVehicle();
      if (f > 4) hold();
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 3 - t, 1.0, p.z + 6.5);
      cam.lookAt(p.x + 1.5, 0.8, p.z);
      cam.fov = 48;
    },
    overlay: (t) => punch('NO RULES', t, 0.4),
  },
  {
    // police helicopter at night, searchlight sweeping the street
    beats: 5,
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
      // hovering over the road just ahead, searchlight on the car
      const h = g.heli();
      if (h) {
        h.pos.set(v.pos.x + 20 - f * 0.04, 17, v.pos.z + 3 + Math.sin(f * 0.05) * 2);
        h.vel?.set(v.vel.x, 0, 0);
      }
    },
    camera(cam, t) {
      const v = dv();
      const h = g.heli();
      cam.position.copy(behind(v, 7.5 - t * 1.5, 1.6, 1.25));
      const look = h ? h.pos.clone().lerp(v.pos, 0.7) : ahead(v, 10);
      cam.lookAt(look.x, look.y, look.z);
      cam.fov = 70;
    },
    grade: 'brightness(1.3) contrast(1.1) saturate(1.3)',
    overlay: (t) => stars(5, t),
  },
  card(1, [['STORY MISSIONS', { size: 84, spacing: 8, gradient: true }]]),
  {
    // a contact's back room: dialogue, shot / reverse shot
    beats: 8,
    setup() {
      calm();
      sky(21, 0);
      g.heli()?.obj && (g.heli().obj.visible = false);
      const S = g.story();
      const c = S.contacts.find((q) => q.id === 'vince') || S.contacts[0];
      S.startCutscene(c);
      for (let i = 0; i < 200 && !(S.cut && S.cut.arr); i++) step(1);
      step(20);
      this.S = S;
    },
    camera: null,
    overlay() {
      const cut = this.S.cut;
      if (!cut || !cut.m) return;
      const [who, text] = cut.m.lines[Math.max(0, cut.i)] || ['', ''];
      const shown = text.slice(0, Math.floor(cut.chars));
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(W * 0.1, H - 185, W * 0.8, 116);
      ctx.restore();
      drawText(who, { size: 30, y: H - 158, color: who === 'YOU' ? '#9fe0ff' : cut.c.color, stroke: 0, spacing: 4 });
      ctx.save();
      ctx.font = '600 30px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      const words = shown.split(' ');
      let line = '', y = H - 118;
      for (const w of words) {
        if (ctx.measureText(line + w).width > W * 0.66) {
          ctx.fillText(line, W / 2, y);
          line = '';
          y += 34;
        }
        line += w + ' ';
      }
      ctx.fillText(line, W / 2, y);
      ctx.restore();
    },
    tick(f) {
      // move the conversation along a little faster than in the game
      if (f % 34 === 33) tap('Space');
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
    // thunderstorm: wet neon street, lightning
    beats: 5,
    setup() {
      calm();
      sky(22, 30, 'storm');
      drive('lux', -150, 1.75, Math.PI / 2, 16, 0x0d0e10);
      env.flash = 1;
      step(5);
    },
    tick(f) {
      hold(dv().speed > 17 ? null : 'KeyW');
      if (f === 40) env.flash = 1;
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 10 - t * 7, 0.6, v.pos.z - 6);
      cam.lookAt(v.pos.x + 1, 0.8, v.pos.z);
      cam.fov = 50;
    },
    grade: 'brightness(1.3) contrast(1.15) saturate(1.25)',
    overlay: (t) => punch('A LIVING WORLD', t, 0.3),
  },
  {
    // neon night cruise
    beats: 4,
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
    overlay: (t) => punch('DAY AND NIGHT', t, 0.3),
  },
  {
    // the sign lit up over the night city
    beats: 4,
    setup() {
      calm();
      sky(22, 0);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(190, 30, -HALF + 30), v3(140, 40, -HALF + 8), e);
      cam.lookAt(v3(150, 34, -HALF - 46));
      cam.fov = 55;
    },
    grade: 'brightness(1.25) contrast(1.12) saturate(1.35)',
  },
  {
    // logo over the night skyline
    beats: 0, // the rest
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
      const a = Math.min(1, (t - 0.08) * 4);
      drawText('SOL CITY', { size: 150 * (1 + 0.25 * Math.max(0, 1 - t * 5)), y: H / 2 - 30, gradient: true, stroke: 10, spacing: 6, alpha: a });
      drawText('PLAY IT IN YOUR BROWSER', { size: 30, y: H / 2 + 72, spacing: 6, color: '#f6e3c2', stroke: 4, alpha: Math.min(1, (t - 0.3) * 4) });
      // fade to black at the very end
      if (t > 0.88) {
        ctx.fillStyle = `rgba(0,0,0,${(t - 0.88) / 0.12})`;
        ctx.fillRect(0, 0, W, H);
      }
    },
  },
];

// ------------------------------------------------------------------ record
// ?trailer&from=A&to=B re-records only shots A..B (0-based); the others are simulated
// without saving, so the world is in the same state and the frame numbers line up
const Q = new URLSearchParams(location.search);
const FROM = parseInt(Q.get('from') || '0', 10), TO = parseInt(Q.get('to') || '999', 10);

async function run() {
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:14px monospace;z-index:9;background:#000a;padding:4px 8px';
  document.body.appendChild(status);
  try {
    localStorage.removeItem('solcity.jumps');
  } catch {}
  g.stunts().ramps.forEach((r) => (r.done = false));
  // let traffic and pedestrians populate first
  g.setCinematic(null);
  step(150);
  // whole beats per shot, the last one takes what is left of the minute
  const TOTAL_BEATS = 123;
  const fixed = shots.reduce((s, x) => s + x.beats, 0);
  shots[shots.length - 1].beats = TOTAL_BEATS - fixed;
  let beat = 0, index = 0;
  const total = Math.round(TOTAL_BEATS * BEAT);
  for (let k = 0; k < shots.length; k++) {
    const shot = shots[k];
    shot.prev = shots[k - 1];
    const n = Math.round((beat + shot.beats) * BEAT) - Math.round(beat * BEAT);
    beat += shot.beats;
    if (!shot.black) {
      g.setCinematic(null);
      shot.setup?.call(shot);
    }
    g.setCinematic(shot.camera ? (cam) => {
      shot.camera.call(shot, cam, shot._t);
      cam.updateProjectionMatrix();
    } : null);
    const rec = k >= FROM && k <= TO;
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
      status.textContent = `recording ${index}/${total} (shot ${k + 1}/${shots.length})`;
    }
    shot.after?.call(shot);
  }
  status.textContent = `done: ${index} frames`;
  window.__trailerDone = index;
}

run().catch((e) => {
  window.__trailerErr = String(e && e.stack || e);
  console.error(e);
});
