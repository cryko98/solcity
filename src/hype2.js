// Hype trailer #2, "The Last Job" (open the game with ?hype2): a morning getting ready for the
// heist, the alarm, then every part of the game in fast cuts, a few of them at night. The same
// recorder as hype.js (a fixed 30 fps, scripted shots, every frame POSTed as
// captures/trailer/hype2_NNNNN.jpg) with a look of its own: a teal-and-magenta grade (strong in
// the night shots), a scope letterbox, cuts that tear instead of flashing, glitch titles and a
// clock running through the morning. Cut to "The Lab" (tricksntraps, CC0) at 144 BPM: a beat is
// 12.5 frames. The music runs from 253.41 s: 32 beats of build-up, the silent gap and the riser,
// the drop at 273.41 s (beat 48), 128 beats of it, then the logo.
// Encode: blender -b --factory-startup -P blender/encode_hype.py -- . SolCity_LastJob.mp4 hype2_ 4_the_lab.wav 253.41
import * as THREE from 'three';

const W = 1280, H = 720, FPS = 30, DT = 1 / FPS, BEAT = 12.5;
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
  g.exit(); // (out of the car, and a carjack still under way is called off)
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

// ------------------------------------------------------------------ compositing: the night look
const BAR = 88; // scope letterbox (2.35:1)
const TEAL = '#19e3d3', MAGENTA = '#ff2bd6';

function drawText(text, { size = 64, y = H / 2, alpha = 1, color = '#fff', stroke = 6, spacing = 2, x = W / 2, align = 'center', font = 'Anton, Impact, sans-serif' }) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${spacing}px`;
  ctx.lineJoin = 'round';
  if (stroke) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
// a title that glitches in: cyan and magenta ghosts that settle onto the white, torn slices at first
function glitch(text, t, t0 = 0.1, { size = 84, y = H - BAR - 70, color = '#fff', life = 1 } = {}) {
  const k = (t - t0) * 6;
  if (k <= 0 || t > t0 + life) return;
  const a = Math.min(1, k);
  const jit = Math.max(0, 1 - k * 0.6) * 16 + 2;
  drawText(text, { size, y, x: W / 2 - jit, color: TEAL, alpha: a * 0.8, stroke: 0, spacing: 4 });
  drawText(text, { size, y, x: W / 2 + jit, color: MAGENTA, alpha: a * 0.8, stroke: 0, spacing: 4 });
  drawText(text, { size, y, color, alpha: a, stroke: 5, spacing: 4 });
  if (k < 1.5) {
    // torn: a few horizontal slices of the title knocked sideways
    for (let i = 0; i < 4; i++) {
      const sy = y - size / 2 + Math.random() * size, sh = 4 + Math.random() * 10, dx = (Math.random() - 0.5) * 70;
      ctx.drawImage(out, 0, sy, W, sh, dx, sy, W, sh);
    }
  }
}
// typed out letter by letter, with a block cursor
function type(text, t, t0 = 0.05, { size = 46, y = H / 2, cps = 2.2, color = '#e8fbff' } = {}) {
  if (t < t0) return;
  const n = Math.min(text.length, Math.floor((t - t0) * cps * text.length + 1));
  const shown = text.slice(0, n), cursor = Math.floor(t * 16) % 2 ? '▌' : ' ';
  drawText(shown + (n < text.length || cursor === '▌' ? '▌' : ''), { size, y, color, stroke: 4, spacing: 6, font: '"Courier New", monospace' });
}
function stars(n, t, { y = BAR + 50, size = 50, x0 = W - 330 } = {}) {
  for (let i = 0; i < 5; i++) {
    const on = i < n && t * 10 > i * 0.8;
    drawText('★', { size, x: x0 + i * size * 1.12, y, color: on ? '#ffd23f' : 'rgba(255,255,255,.22)', stroke: 4 });
  }
}

function composite(shot, f, n) {
  ctx.save();
  ctx.filter = shot.grade || 'contrast(1.2) saturate(1.3) brightness(1.08)';
  const z = 1 + 0.06 * Math.max(0, 1 - f / 6);
  const sh = shot.drop ? Math.max(0, 1 - (f % BEAT) / 4) * 6 : 0;
  ctx.drawImage(g.renderer.domElement, (W - W * z) / 2 + (Math.random() - 0.5) * sh, (H - H * z) / 2 + (Math.random() - 0.5) * sh, W * z, H * z);
  ctx.restore();
  // split tone: teal up top, magenta down below (strong at night, a hint of it by day)
  if (shot.tone !== false) {
    const k = shot.night ? 1 : 0.45;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const tg = ctx.createLinearGradient(0, 0, W, H);
    tg.addColorStop(0, `rgba(25,227,211,${0.45 * k})`);
    tg.addColorStop(1, `rgba(255,43,214,${0.4 * k})`);
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.6)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // the cut: the picture tears (slices thrown sideways, a colour fringe), no white flash
  if (f < 4) {
    const k = 1 - f / 4;
    for (let i = 0; i < 10; i++) {
      const sy = Math.random() * H, shh = 6 + Math.random() * 50, dx = (Math.random() - 0.5) * 120 * k;
      ctx.drawImage(out, 0, sy, W, shh, dx, sy, W, shh);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.35 * k;
    ctx.fillStyle = f % 2 ? TEAL : MAGENTA;
    ctx.fillRect(0, Math.random() * H, W, 30 + Math.random() * 80);
    ctx.restore();
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, BAR);
  ctx.fillRect(0, H - BAR, W, BAR);
  // the clock in the bar: it runs through the night
  if (shot.clock) {
    drawText(shot.clock, { size: 22, x: 48, y: H - BAR / 2, align: 'left', color: '#9aa', stroke: 0, spacing: 4, font: '"Courier New", monospace' });
    drawText('● REC', { size: 20, x: W - 48, y: H - BAR / 2, align: 'right', color: Math.floor(f / 8) % 2 ? '#ff3355' : '#661520', stroke: 0, spacing: 3 });
  }
  shot.overlay?.call(shot, f / n, f, n);
}

async function upload(index) {
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92));
  await fetch(`/capture/hype2_${String(index).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
}

// ------------------------------------------------------------------ shots
const card = (beats, draw) => ({ beats, black: true, overlay: draw });

let copCar = null, fightPed = null, boomCar = null;
const savedOutfit = JSON.stringify(g.shop().outfit);
const shots = [
  // ================================================================ build-up (32 beats)
  {
    // the city in the morning, from over the sea
    beats: 4,
    clock: '08:47 AM',
    setup() {
      calm();
      sky(8, 47);
      placeHero(14, -9.6, Math.PI / 2);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(-40, 34, EXT + 60), v3(-12, 26, EXT + 10), e);
      cam.lookAt(v3(0, 6, -20));
      cam.fov = 52;
    },
    overlay: (t) => type('SOL CITY.  8:47 AM.', t, 0.08, { y: H / 2 - 10, cps: 3 }),
  },
  {
    // a contact's back room: the next job, over a drink
    beats: 8,
    clock: '09:05 AM',
    setup() {
      calm();
      sky(9, 5);
      const S = g.story();
      const c = S.contacts.find((q) => q.id === 'zara') || S.contacts[0];
      S.startCutscene(c);
      for (let i = 0; i < 200 && !(S.cut && S.cut.arr); i++) step(1);
      step(20);
      this.S = S;
    },
    camera: null,
    tick(f) {
      if (f % 30 === 29) tap('Space');
    },
    overlay(t) {
      const cut = this.S.cut;
      if (cut?.m) {
        const [who, text] = cut.m.lines[Math.max(0, cut.i)] || ['', ''];
        const shown = text.slice(0, Math.floor(cut.chars));
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(W * 0.12, H - BAR - 128, W * 0.76, 112);
        ctx.restore();
        drawText(who, { size: 26, y: H - BAR - 106, color: cut.c.color, stroke: 0, spacing: 4 });
        ctx.save();
        ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        let line = '', y = H - BAR - 70;
        for (const w of shown.split(' ')) {
          if (ctx.measureText(line + w).width > W * 0.64) {
            ctx.fillText(line, W / 2, y);
            line = '';
            y += 30;
          }
          line += w + ' ';
        }
        ctx.fillText(line, W / 2, y);
        ctx.restore();
      }
      glitch('15 STORY MISSIONS', t, 0.1, { size: 60, y: BAR + 50, life: 2 });
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
  },
  {
    // the gym: bench press
    beats: 2,
    clock: '09:40 AM',
    setup() {
      sky(9, 40);
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
    overlay: (t) => glitch('GET STRONG', t, 0.15, { size: 72 }),
  },
  {
    // treadmill
    beats: 2,
    clock: '09:52 AM',
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
    // fresh ink and a new cut: a slow orbit in the tattoo parlour
    beats: 4,
    clock: '10:15 AM',
    setup() {
      const b = enter('tattoo');
      const S = g.shop();
      S.outfit.hair = 'blonde';
      S.outfit.tattoos = ['tribal', 'skull', 'script', 'star'];
      S.applyOutfit();
      placeHero(b.room.ox - 0.5, b.room.oz + 0.3, 0, 0);
      P.indoors = true;
    },
    camera(cam, t) {
      const p = P.position, a = -0.9 + t * 1.3;
      cam.position.set(p.x + Math.sin(a) * 1.7, 1.45, p.z + Math.cos(a) * 1.7);
      cam.lookAt(p.x, 1.3, p.z);
      cam.fov = 48;
    },
    overlay: (t) => glitch('YOUR LOOK, YOUR INK', t, 0.2, { size: 64 }),
  },
  {
    // Ammu-Nation: the SMG comes up
    beats: 4,
    clock: '09:30 AM',
    setup() {
      const b = enter('gun');
      placeHero(b.counter.x, b.counter.z - 0.6, Math.PI, 0);
      P.indoors = true;
      g.weapons().give('smg');
      g.weapons().equip('smg');
      trigger(true, 2);
      step(8);
      this.b = b;
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 0.9 - t * 0.35, 1.55, p.z - 1.3 + t * 0.2);
      cam.lookAt(p.x - 0.1, 1.45, p.z);
      cam.fov = 42;
    },
    overlay: (t) => glitch('GEAR UP', t, 0.2, { size: 72 }),
  },
  {
    // the Reserve: guards at the teller line, the SMG on them
    beats: 4,
    clock: '10:40 AM',
    setup() {
      const b = enter('bank');
      this.guards = (b.guardSpots || []).slice(0, 2).map((s) => {
        const p = g.peds.add('male', s.x, s.z, Math.PI);
        p.state = 'contact';
        p.keep = true;
        return p;
      });
      const v = b.vault;
      placeHero(v.x - 1.2, v.z - 5, 0.25, 0);
      P.indoors = true;
      g.weapons().give('smg');
      g.weapons().equip('smg');
      trigger(true, 2);
      step(6);
      this.b = b;
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 0.8 + t * 0.6, 1.6, p.z - 1.0);
      cam.lookAt(p.x + 0.6, 1.3, p.z + 4);
      cam.fov = 50;
    },
    overlay: (t) => glitch('THE RESERVE', t, 0.2, { size: 72 }),
    after() {
      for (const p of this.guards) g.peds.knockOut(p, 0, 0, false);
    },
  },
  {
    // the vault door, sparks off the drill
    beats: 4,
    clock: '10:46 AM',
    setup() {
      trigger(false, 2);
      const b = g.shop().inside, v = b.vault;
      placeHero(v.x, v.z - 0.9, 0, 0);
      P.indoors = true;
      g.weapons().equip(null);
      this.v = v;
    },
    tick(f) {
      const v = this.v;
      if (f % 2 === 0) g.fx.sparks(v3(v.x + 0.15, 1.25, v.z - 0.35), 6, v3(0, 0.4, -1));
    },
    camera(cam, t) {
      const v = this.v;
      cam.position.set(v.x + 1.3 - t * 0.4, 1.4, v.z - 1.6);
      cam.lookAt(v.x, 1.2, v.z - 0.3);
      cam.fov = 44;
    },
    overlay(t) {
      drawText(`DRILL  ${Math.min(100, Math.round(t * 130))}%`, { size: 34, y: BAR + 44, color: '#ffd23f', stroke: 4, spacing: 6, font: '"Courier New", monospace' });
    },
  },
  // ================================================================ the silent gap, then the riser (16 beats)
  card(6, (t) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    type('IT WAS SUPPOSED TO BE CLEAN.', t, 0.08, { y: H / 2, size: 40, cps: 1.6 });
  }),
  {
    // outside: the patrol cars swing in, the alarm
    beats: 6,
    clock: '10:49 AM',
    setup() {
      calm();
      sky(10, 49);
      g.shop().alarm = false;
      const b = g.shop().branches.find((q) => q.type === 'bank');
      clearRoad(b.door.x - 40, b.door.z - 6, Math.PI / 2, 80, 9);
      placeHero(b.door.x, b.door.z - 1.4, Math.PI);
      g.weapons().give('smg');
      g.weapons().equip('smg');
      trigger(true, 2);
      this.b = b;
      this.cops = [];
      for (const [dx, h] of [[-11, Math.PI / 2], [11, -Math.PI / 2]]) {
        const c = spawnCar('police', b.door.x + dx, b.door.z - 6.5, h, 0x111214);
        c.vehicle.siren = true;
        c.vehicle.vel.set(Math.sin(h) * 16, 0, Math.cos(h) * 16);
        this.cops.push(c);
      }
    },
    tick() {
      for (const c of this.cops) c.vehicle.vel.multiplyScalar(0.9);
    },
    camera(cam, t) {
      const b = this.b;
      cam.position.set(b.door.x + 1.5 - t, 1.3, b.door.z - 15);
      cam.lookAt(b.door.x, 1.6, b.door.z - 3);
      cam.fov = 56;
    },
    after() {
      trigger(false, 2);
    },
    grade: 'brightness(1.15) contrast(1.2) saturate(1.15)',
    overlay(t, f) {
      // the red alarm pulse
      ctx.fillStyle = `rgba(255,0,40,${0.18 + 0.18 * Math.sin(f * 0.5)})`;
      ctx.fillRect(0, BAR, W, H - 2 * BAR);
      glitch("IT WASN'T.", t, 0.3, { size: 96, color: '#ff4060' });
    },
  },
  card(4, (t, f) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // a star a beat, then the drop
    const n = Math.min(4, Math.floor(f / BEAT) + 1);
    stars(n, 1, { y: H / 2, size: 110, x0: W / 2 - 2 * 123 });
  }),
  // ================================================================ the drop (128 beats): every part of the game, a cut each
  {
    // cops behind, nose to the camera
    beats: 4,
    drop: true,
    setup() {
      g.shop().alarm = false;
      sky(10, 50);
      drive('lux', -180, 1.75, Math.PI / 2, 30, 0x0d0e10);
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
      cam.position.copy(ahead(v, 8 - t * 2, 1.0));
      cam.position.z += 2.4;
      cam.lookAt(v.pos.x - 6, 1.0, v.pos.z);
      cam.fov = 62;
    },
    overlay(t) {
      stars(4, t);
      glitch('RUN.', t, 0.08, { size: 120 });
    },
  },
  {
    // road-level fly-by
    beats: 2,
    drop: true,
    setup() {
      drive('lux', -62, 1.75, Math.PI / 2, 40, 0x0d0e10);
    },
    camera(cam) {
      const v = dv();
      cam.position.set(-34, 0.35, 6.2);
      cam.lookAt(v.pos.x, 0.7, v.pos.z);
      cam.fov = 38;
    },
  },
  {
    // handbrake through the intersection
    beats: 2,
    drop: true,
    setup() {
      calm();
      drive('lux', 40, 1.75, Math.PI / 2, 27, 0x0d0e10);
      step(10);
      hold('KeyW', 'KeyA', 'Space');
    },
    tick(f) {
      if (f === 14) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 9, 1.0, v.pos.z - 7 + t * 2);
      cam.lookAt(v.pos.x, 0.5, v.pos.z);
      cam.fov = 52;
    },
  },
  {
    // the SMG into a patrol car
    beats: 2,
    drop: true,
    setup() {
      calm();
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
      cam.position.set(p.x - 0.3 + t * 0.3, 1.5, p.z - 1.9);
      cam.lookAt(p.x + 2.5, 1.3, p.z + 0.4);
      cam.fov = 48;
    },
  },
  {
    // boom
    beats: 4,
    drop: true,
    timeScale: 0.4,
    setup() {
      trigger(false);
      vehicles.activate(copCar);
      if (copCar.health !== 0) vehicles.explode(copCar);
    },
    camera(cam, t) {
      const v = copCar.vehicle, a = 1.2 - t * 0.6;
      cam.position.set(v.pos.x + Math.sin(a) * 8, 0.8 + t * 1.2, v.pos.z + Math.cos(a) * 8);
      cam.lookAt(v.pos.x, 1.6, v.pos.z);
      cam.fov = 54;
    },
    grade: 'contrast(1.25) saturate(1.4) brightness(1.1)',
  },
  {
    // a roll out of the way of a patrol car
    beats: 2,
    drop: true,
    setup() {
      calm();
      placeHero(-40, 1.0, -Math.PI / 2);
      const c = spawnCar('police', -24, 1.75, -Math.PI / 2, 0x111214);
      c.vehicle.siren = true;
      c.vehicle.vel.set(-16, 0, 0);
      step(4);
      tap('KeyC');
      hold('KeyD');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 5 + t, 0.6, p.z + 4.5);
      cam.lookAt(p.x + 2, 0.8, p.z);
      cam.fov = 48;
    },
    timeScale: 0.6,
  },
  {
    // the helicopter's searchlight finds him
    beats: 4,
    drop: true,
    night: true,
    setup() {
      calm();
      sky(0, 15, 'clear');
      drive('lux', -60, -1.75, Math.PI / 2, 14, 0x0d0e10);
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
        h.pos.set(v.pos.x + 18 - f * 0.04, 16, v.pos.z + 3 + Math.sin(f * 0.05) * 2);
        h.vel?.set(v.vel.x, 0, 0);
      }
    },
    camera(cam, t) {
      const v = dv(), h = g.heli();
      cam.position.copy(behind(v, 7 - t * 1.5, -1.8, 1.0));
      const look = h ? h.pos.clone().lerp(v.pos, 0.6) : ahead(v, 10);
      cam.lookAt(look.x, look.y, look.z);
      cam.fov = 72;
    },
    grade: 'brightness(1.3) contrast(1.1) saturate(1.3)',
    overlay: (t) => stars(5, t),
  },
  {
    // the Russo crew on the pavement: the SMG against their pistols
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(13, 30);
      const x = -30, z = -9.6;
      placeHero(x, z, Math.PI / 2);
      for (const p of [...g.peds.list]) if (!p.keep && Math.hypot(p.x - x - 10, p.z - z) < 12) g.peds.remove(p);
      this.goons = [0, 1, 2].map((k) => {
        const p = g.peds.add('male', x + 9 + k * 1.8, z + (k - 1) * 1.2, -Math.PI / 2);
        p.state = 'contact';
        p.keep = p.hostile = p.gunman = p.aimingGun = true;
        g.story().arm(p);
        return p;
      });
      g.weapons().give('smg');
      g.weapons().equip('smg');
      trigger(true, 2);
      step(8);
      trigger(true);
    },
    tick() {
      for (const p of this.goons) if (p.state !== 'down') p.yaw = Math.atan2(P.position.x - p.x, P.position.z - p.z);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 2.2 + t * 0.6, 1.7, p.z - 0.9);
      cam.lookAt(p.x + 10, 1.1, p.z - 0.3);
      cam.fov = 52;
    },
    after() {
      trigger(false);
      trigger(false, 2);
      for (const p of this.goons) {
        p.keep = p.hostile = p.aimingGun = false;
        if (p.body.userData.gun) p.body.userData.gun.visible = false;
      }
    },
    overlay: (t) => glitch('STORY MISSIONS', t, 0.12, { size: 72 }),
  },
  {
    // a black saloon at the kerb: the driver dragged out
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(13, 45);
      const x = 34, z = 1.75;
      clearRoad(x - 20, z, Math.PI / 2, 120);
      this.car = spawnCar('lux', x, z, Math.PI / 2, 0x0d0e10, { ctl: { throttle: 0, steer: 0, handbrake: true } });
      step(20);
      const v = this.car.vehicle;
      placeHero(x + Math.cos(v.heading) * 3.2 - 1.5, z - Math.sin(v.heading) * 3.2, Math.PI);
      step(1);
      g.toggleVehicle();
      step(30);
    },
    camera(cam, t) {
      const v = this.car.vehicle, a = v.heading + Math.PI / 2 + 0.3 + t * 0.3;
      cam.position.set(v.pos.x + Math.sin(a) * 4.2, 0.9, v.pos.z + Math.cos(a) * 4.2);
      cam.lookAt(v.pos.x, 1.1, v.pos.z);
      cam.fov = 46;
    },
    overlay: (t) => glitch('CARJACK ANYTHING', t, 0.3, { size: 72 }),
  },
  {
    // fists in the street
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(14, 40);
      placeHero(19.5, -10.4, Math.PI / 2);
      for (const p of [...g.peds.list]) if (!p.keep && Math.hypot(p.x - 20, p.z + 10.4) < 6) g.peds.remove(p);
      fightPed = g.peds.add('male', 20.65, -10.4, -Math.PI / 2);
      fightPed.points = [{ x: 20.64, z: -10.4 }];
      fightPed.hits = 0;
      step(4);
    },
    tick(f) {
      if (f % 7 === 0 && fightPed.state !== 'down') tap('Mouse0');
      if (fightPed.hits > 4) fightPed.hits = 4;
    },
    camera(cam, t) {
      const p = P.position, a = 0.6 - t * 0.8;
      cam.position.set(p.x + 0.5 + Math.sin(a) * 2.2, 1.45, p.z + Math.cos(a) * 2.2);
      cam.lookAt(p.x + 0.5, 1.4, p.z);
      cam.fov = 48;
    },
    overlay: (t) => glitch('THROW HANDS', t, 0.1, { size: 72 }),
  },
  {
    // down he goes
    beats: 2,
    drop: true,
    timeScale: 0.3,
    setup() {
      if (fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, false);
    },
    camera(cam, t) {
      cam.position.set(fightPed.x + 0.4 - t * 0.5, 0.5, fightPed.z + 3.2);
      cam.lookAt(fightPed.x + 0.4, 0.8 - t * 0.3, fightPed.z);
      cam.fov = 42;
    },
    grade: 'contrast(1.3) saturate(.7) brightness(1.2)',
  },
  {
    // a 24/7 on the way: the clerk's hands go up
    beats: 2,
    drop: true,
    setup() {
      const b = enter('mart');
      const S = g.shop(), clerk = S.clerks.get(b), c = b.counter;
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
      cam.position.set(k.x + 0.7 - t * 0.2, 1.5, k.z + 0.9);
      cam.lookAt(p.x, 1.4, p.z);
      cam.fov = 46;
    },
    overlay: (t) => glitch('HOLD-UPS', t, 0.1, { size: 72 }),
  },
  {
    // the bounty board: wanted men, alive or dead
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(15, 0);
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
    overlay: (t) => glitch('BOUNTY HUNTER', t, 0.1, { size: 72 }),
  },
  card(4, (t, f) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (f < BEAT * 2) glitch('ONE CITY.', t * 2, 0.02, { size: 110, y: H / 2 });
    else glitch('NO RULES.', (t - 0.5) * 2, 0.02, { size: 110, y: H / 2, color: '#ff4fa3' });
  }),
  {
    // the ambulance, lights going
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(11, 0);
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
    overlay: (t) => glitch('PARAMEDIC', t, 0.1, { size: 80, color: '#ffdede' }),
  },
  {
    // the fire truck's cannon on a burning car, at dusk
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(19, 30);
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
    overlay: (t) => glitch('FIREFIGHTER', t, 0.15, { size: 80, color: '#ffe2c8' }),
  },
  {
    // the bus
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(9, 0);
      drive('bus', -150, 1.75, Math.PI / 2, 11, 0xf2c12e);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 10 - t * 6, 1.1, v.pos.z + 8);
      cam.lookAt(v.pos.x, 1.6, v.pos.z);
      cam.fov = 50;
    },
    overlay: (t) => glitch('BUS DRIVER', t, 0.1, { size: 76 }),
  },
  {
    // truck and trailer
    beats: 2,
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
      cam.position.set(v.pos.x + 12 - t * 8, 1.0, v.pos.z - 9);
      cam.lookAt(v.pos.x - 4, 2.0, v.pos.z);
      cam.fov = 56;
    },
    overlay: (t) => glitch('TRUCKER', t, 0.1, { size: 76 }),
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
    overlay: (t) => glitch('TOW TRUCK', t, 0.1, { size: 76 }),
  },
  {
    // a taxi
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(11, 30);
      drive('taxi', -120, -1.75, -Math.PI / 2, 15, 0xf2c12e);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 6 - t * 2, -2.6, 1.4));
      cam.lookAt(ahead(v, 3, 1));
      cam.fov = 54;
    },
    overlay: (t) => glitch('TAXI', t, 0.1, { size: 80 }),
  },
  {
    // vigilante: a patrol car on a getaway sedan's bumper
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(15, 10);
      drive('police', -200, 1.75, Math.PI / 2, 22, 0x111214);
      dv().siren = true;
      this.s = spawnCar('sedan', -188, 1.75, Math.PI / 2, 0x8a8f96);
      this.s.vehicle.vel.set(22, 0, 0);
    },
    tick() {
      this.s.vehicle.vel.x = 22.5;
      hold(dv().pos.x > this.s.vehicle.pos.x - 8 ? null : 'KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 16 - t * 4, 0.7, v.pos.z + 5.5);
      cam.lookAt(v.pos.x + 5, 1.0, v.pos.z);
      cam.fov = 50;
    },
    overlay: (t) => glitch('VIGILANTE', t, 0.1, { size: 76 }),
  },
  {
    // street race countdown, then off
    beats: 4,
    drop: true,
    setup() {
      calm();
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
      if (R.state === 'countdown' && Math.ceil(R.t) > 0) drawText(String(Math.ceil(R.t)), { size: 150, y: H / 2 - 30, color: '#ffd23f', stroke: 10 });
      else if (t < 0.5) drawText('GO!', { size: 150, y: H / 2 - 30, color: '#7ad65b', stroke: 10 });
      glitch('STREET RACES', t, 0.5, { size: 72 });
    },
    after() {
      g.races().stop?.('');
    },
  },
  {
    // over the stunt ramp, slow
    beats: 6,
    drop: true,
    setup() {
      const r = g.stunts().ramps[0];
      this.r = r;
      const sx = -r.fz * 1.3, sz = r.fx * 1.3;
      calm();
      clearRoad(r.x - r.fx * 50 + sx, r.z - r.fz * 50 + sz, r.yaw, 120, 10);
      drive('super', r.x - r.fx * 45 + sx, r.z - r.fz * 45 + sz, r.yaw, 38, 0x111114);
      step(24);
    },
    timeScale: 0.42,
    camera(cam, t) {
      const r = this.r, v = dv();
      cam.position.set(r.x + r.fx * 10 - r.fz * 9, 1.0 + t * 3, r.z + r.fz * 10 + r.fx * 9);
      cam.lookAt(v.pos.x, v.pos.y + 1.6, v.pos.z);
      cam.fov = 54;
    },
    overlay: (t) => glitch('STUNT JUMPS', t, 0.2, { size: 72 }),
  },
  {
    // into Sol Customs hot, out in a new colour: the stars are gone
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(16, 45);
      const S = C.spray;
      const c = drive('lux', S.x, S.z, Math.PI, 0, 0x0d0e10);
      hold();
      for (let i = 0; i < 3; i++) g.wanted.crime('ram_cop', true);
      g.police.clear?.();
      step(Math.round(FPS * 3.0)); // the door down, the hiss
      this.c = c;
      this.S = S;
    },
    tick(f) {
      if (f === 6) hold('KeyW');
      if (f > 30 && dv().speed > 6) hold();
    },
    camera(cam, t) {
      const S = this.S;
      cam.position.set(S.x + 3.5, 1.1, S.entrance.z - 8 + t * 1.5);
      cam.lookAt(S.x, 1.2, S.entrance.z + 1);
      cam.fov = 48;
    },
    overlay(t) {
      stars(t < 0.3 ? 3 : 0, 1);
      glitch('NEW PAINT. NEW FACE.', t, 0.45, { size: 70 });
    },
  },
  {
    // nitro
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(12, 30);
      const c = drive('super', -230, 1.75, Math.PI / 2, 20, 0x111114);
      c.tune = { engine: 3, nitro: true, rims: 'gold', tint: true };
      c.vehicle.applyTune();
      hold('KeyW', 'ShiftLeft');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 3.8 + t * 2.4, 1.4, 0.5));
      cam.lookAt(ahead(v, 6, 0.8));
      cam.fov = 72 + t * 18;
    },
    overlay: (t) => glitch('NO BRAKES', t, 0.1),
  },
  {
    // a bike splits the lanes past the lens
    beats: 2,
    drop: true,
    setup() {
      drive('bike', C.roadC(4) - 1.75, 128, Math.PI, 32, 0x1f5fd6);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(C.roadC(4) - 4.6, 0.45 + t * 0.6, 108);
      cam.lookAt(v.pos.x, 1.0, v.pos.z);
      cam.fov = 40 + t * 16;
    },
  },
  {
    // the clothes store: a slow turn in front of the mirror
    beats: 2,
    drop: true,
    setup() {
      const b = enter('clothes');
      placeHero(b.counter.x, b.counter.z - 1.4, 0, 0);
      P.indoors = true;
    },
    camera(cam, t) {
      const p = P.position, a = 0.4 - t * 0.6;
      cam.position.set(p.x + Math.sin(a) * 2.2, 1.5, p.z + Math.cos(a) * 2.2);
      cam.lookAt(p.x, 1.2, p.z);
      cam.fov = 48;
    },
    overlay: (t) => glitch('NEW THREADS', t, 0.1, { size: 72 }),
  },
  {
    // front crawl, the camera at the waterline
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(16, 0);
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
    overlay: (t) => glitch('SWIM', t, 0.1, { size: 80 }),
  },
  {
    // off the end of the jetty, into the sea
    beats: 2,
    drop: true,
    setup() {
      calm();
      sky(19, 5);
      placeHero(116.2, EXT + 30, Math.PI / 2, 0.32);
      hold('KeyW', 'ShiftLeft');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(124, WY + 0.4, EXT + 26.5);
      cam.lookAt(p.x, Math.max(WY + 0.2, p.y + 0.8), p.z);
      cam.fov = 44;
    },
  },
  {
    // a jetski at the waterline, spray in the lens
    beats: 2,
    drop: true,
    setup() {
      drive('jetski', 20, EXT + 70, Math.PI / 2, 19, 0xff2bd6);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(44, WY + 0.45, EXT + 66);
      cam.lookAt(v.pos.x, WY + 0.8, v.pos.z);
      cam.fov = 40 + t * 12;
    },
  },
  {
    // the speedboat out to sea, high over the wake
    beats: 4,
    drop: true,
    setup() {
      sky(19, 12);
      drive('boat', 150, EXT + 60, Math.PI / 2, 17, 0x111114);
    },
    tick(f) {
      if (f === 18) hold('KeyW', 'KeyA');
      if (f === 32) hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 12 - t * 3, -6, 5 - t));
      cam.lookAt(ahead(v, 4, 0));
      cam.fov = 58;
    },
    overlay: (t) => glitch('BOATS & JETSKIS', t, 0.2, { size: 76 }),
  },
  {
    // Club Solar: the dance floor and the crowd
    beats: 4,
    drop: true,
    night: true,
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
    grade: 'brightness(1.6) contrast(1.1) saturate(1.35)',
    overlay: (t) => glitch('NIGHTLIFE', t, 0.2, { size: 80 }),
  },
  {
    // darts at Club Solar
    beats: 2,
    drop: true,
    night: true,
    setup() {
      g.fun().stop(true);
      const b = g.shop().inside;
      this.st = b.spec.stations.find((s) => s.kind === 'darts');
      g.fun().start(this.st, b);
    },
    camera(cam, t) {
      const s = this.st;
      cam.position.set(s.x - 1.2, 1.75, s.z - 1.4 + t * 0.4);
      cam.lookAt(s.x + 2.4, 1.6, s.z);
      cam.fov = 50;
    },
    grade: 'brightness(2.4) contrast(1.05) saturate(1.3)',
    overlay: (t) => glitch('DARTS', t, 0.1, { size: 72 }),
  },
  {
    // the arcade's glowing cabinets
    beats: 2,
    drop: true,
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
    grade: 'brightness(1.6) contrast(1.1) saturate(1.35)',
    overlay: (t) => glitch('ARCADE', t, 0.1, { size: 72 }),
  },
  {
    // the storm breaks
    beats: 4,
    drop: true,
    night: true,
    setup() {
      calm();
      g.shop().robbery = null;
      g.shop().alarm = false;
      sky(23, 2, 'storm');
      drive('lux', -150, 1.75, Math.PI / 2, 16, 0x0d0e10);
      env.flash = 1;
      step(5);
    },
    tick(f) {
      hold(dv().speed > 17 ? null : 'KeyW');
      if (f === 24) env.flash = 1;
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(v.pos.x + 9 - t * 7, 0.5, v.pos.z + 5.5);
      cam.lookAt(v.pos.x + 1, 0.8, v.pos.z);
      cam.fov = 50;
    },
    grade: 'brightness(1.35) contrast(1.15) saturate(1.25)',
  },
  {
    // the helicopter over him, low over the street
    beats: 4,
    drop: true,
    setup() {
      sky(16, 31);
      placeHero(24, -9.6, Math.PI / 2);
      for (let i = 0; i < 4; i++) g.wanted.crime('ram_cop', true);
      const h = g.heli();
      if (h) h.spawn(P.position);
      hold('KeyW', 'ShiftLeft');
      step(10);
    },
    tick(f) {
      const h = g.heli(), p = P.position;
      if (h) h.pos.set(p.x - 6 + f * 0.05, 15, p.z + 6);
    },
    camera(cam, t) {
      const p = P.position, h = g.heli();
      cam.position.set(p.x + 6, 0.6, p.z - 5);
      const look = h ? h.pos.clone().lerp(p, 0.55) : p;
      cam.lookAt(look.x, look.y, look.z);
      cam.fov = 66;
    },
    grade: 'brightness(1.3) contrast(1.12) saturate(1.3)',
    overlay: (t) => stars(5, t),
  },
  {
    // never look back: the car behind him goes up, the sun going down
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(18, 40);
      placeHero(-22, -9.6, Math.PI / 2);
      this.car = spawnCar('lux', -27, -6.2, Math.PI / 2, 0x0d0e10);
      this.car.health = 5;
      hold('KeyW');
      step(4);
    },
    tick(f) {
      if (f === 8) vehicles.explode(this.car);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 4.2 - t * 0.8, 1.2, p.z - 1.2);
      cam.lookAt(p.x - 1, 1.5, p.z);
      cam.fov = 46;
    },
    timeScale: 0.7,
    overlay: (t) => glitch('NEVER LOOK BACK', t, 0.35, { size: 76 }),
  },
  {
    // the cops lose the scent: a patrol car howls past the lens
    beats: 2,
    drop: true,
    setup() {
      calm();
      drive('lux', -90, -1.75, Math.PI / 2, 10, 0x0d0e10);
      const c = spawnCar('police', -40, 1.75, -Math.PI / 2, 0x111214);
      c.vehicle.siren = true;
      c.vehicle.vel.set(-36, 0, 0);
      this.cop = c;
    },
    camera(cam, t) {
      cam.position.set(-58, 0.5, 5.4);
      const v = this.cop.vehicle;
      cam.lookAt(v.pos.x, 0.8, v.pos.z);
      cam.fov = 40;
    },
  },
  {
    // the shotgun at the next one
    beats: 2,
    drop: true,
    setup() {
      calm();
      placeHero(-20, -9.3, Math.PI / 2);
      boomCar = spawnCar('police', -11, -4.4, -Math.PI / 2 - 0.2, 0x111214);
      boomCar.vehicle.siren = true;
      g.weapons().give('shotgun');
      g.weapons().equip('shotgun');
      P.yaw = Math.atan2(-11 - P.position.x, -4.4 - P.position.z);
      P.object.rotation.set(0, P.yaw, 0);
      g.follow.yaw = P.yaw;
      trigger(true, 2);
      step(6);
    },
    tick(f) {
      if (f === 3 || f === 16) tap('Mouse0');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 1.5, 1.2, p.z + 2.6 - t * 0.4);
      cam.lookAt(p.x + 0.4, 1.3, p.z);
      cam.fov = 46;
    },
  },
  card(4, (t, f) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    glitch('HOLD $SOLCITY', t, 0.02, { size: 92, y: H / 2 - 55, life: 2 });
    glitch('EARN $DACITY', t, 0.25, { size: 92, y: H / 2 + 55, color: '#ffd23f', life: 2 });
  }),
  {
    // the night skyline from over the sea, the sign lit on the hill
    beats: 4,
    drop: true,
    night: true,
    setup() {
      calm();
      sky(2, 10, 'clear');
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(250, 22, -HALF + 120), v3(215, 30, -HALF + 85), ease(t));
      cam.lookAt(v3(150, 30, -HALF - 46));
      cam.fov = 50;
    },
    grade: 'brightness(1.3) contrast(1.12) saturate(1.35)',
  },
  {
    // sunrise over the beach jetty
    beats: 4,
    drop: true,
    setup() {
      calm();
      sky(6, 31, 'clear');
      placeHero(118, EXT + 20, 0, 0.32);
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(136, 7, EXT + 60), v3(127, 3.5, EXT + 42), ease(t));
      cam.lookAt(v3(118, 0.5, EXT + 26));
      cam.fov = 54;
    },
    grade: 'contrast(1.12) saturate(1.35) brightness(1.05)',
    tone: false,
  },
  {
    // the hero walks at the camera, the sun going down behind him
    beats: 4,
    drop: true,
    setup() {
      calm();
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
  // ================================================================ the logo (16 beats)
  {
    beats: 16,
    setup() {
      calm();
      sky(21, 50, 'clear');
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(150, 40, 230), v3(118, 72, 188), e);
      cam.lookAt(v3(0, 30 + 10 * e, 0));
      cam.fov = 55;
    },
    grade: 'brightness(.8) contrast(1.15) saturate(1.3)',
    overlay(t) {
      const a = Math.min(1, (t - 0.04) * 6);
      glitch('SOL CITY', t, 0.04, { size: 170, y: H / 2 - 40, life: 2 });
      drawText('THE LAST JOB', { size: 40, y: H / 2 + 70, spacing: 18, color: MAGENTA, stroke: 4, alpha: Math.min(1, (t - 0.2) * 4) });
      drawText('PLAY FREE IN YOUR BROWSER', { size: 26, y: H / 2 + 125, spacing: 8, color: '#cfe', stroke: 3, alpha: Math.min(1, (t - 0.35) * 4) * a });
      if (t > 0.86) {
        ctx.fillStyle = `rgba(0,0,0,${(t - 0.86) / 0.14})`;
        ctx.fillRect(0, 0, W, H);
      }
    },
  },
];

// ------------------------------------------------------------------ record
const Q = new URLSearchParams(location.search);
const REC = Q.get('rec') ? Q.get('rec').split(',').flatMap((r) => {
  const [a, b] = r.split('-').map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}) : null;
const TOTAL_BEATS = 192;

async function run() {
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:14px monospace;z-index:9;background:#000a;padding:4px 8px';
  document.body.appendChild(status);
  const sum = shots.reduce((s, x) => s + x.beats, 0);
  if (sum !== TOTAL_BEATS) console.warn('hype2: beats', sum, 'expected', TOTAL_BEATS);
  window.__hypeBeats = sum;
  g.setCinematic(null);
  step(150);
  // a beat is 12.5 frames: each shot runs from its first beat's frame to the next shot's
  let beat = 0, index = 0;
  const total = Math.round(TOTAL_BEATS * BEAT);
  for (let k = 0; k < shots.length; k++) {
    const shot = shots[k];
    const f0 = Math.round(beat * BEAT);
    beat += shot.beats;
    const n = Math.round(beat * BEAT) - f0;
    if (!shot.black) {
      g.setCinematic(null);
      shot.setup?.call(shot);
    }
    g.setCinematic(shot.camera ? (cam) => {
      shot.camera.call(shot, cam, shot._t);
      cam.updateProjectionMatrix();
    } : null);
    const rec = !REC || REC.includes(k);
    for (let f = 0; f < n; f++) {
      shot._t = f / n;
      shot.tick?.call(shot, f, n);
      if (!rec) {
        if (!shot.black) g.step(DT * (shot.timeScale || 1));
        index++;
        continue;
      }
      if (shot.black) {
        shot.overlay(shot._t, f, n);
        if (f < 3) {
          ctx.fillStyle = `rgba(255,43,214,${0.35 * (1 - f / 3)})`;
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
  calm();
  // the hero's own look back (the tattoo parlour shot changes it)
  const S = g.shop();
  S.outfit = JSON.parse(savedOutfit);
  S.applyOutfit();
  status.textContent = `done: ${index} frames`;
  window.__hypeDone = index;
}

run().catch((e) => {
  window.__hypeErr = String(e && e.stack || e);
  console.error(e);
});
