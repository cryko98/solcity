// Trailer #3, "Sol City" (open the game with ?hype3): the whole game in two minutes, GTA style,
// told by a narrator. The same kind of recorder as hype.js / hype2.js (a fixed 30 fps, scripted
// shots, every frame POSTed as captures/trailer/hype3_NNNNN.jpg) with a look of its own: a warm,
// saturated grade, slim bars, titles that slam in, freeze-frame name cards for the four bosses.
// It is cut to the score (trailer/music, 90 BPM: a beat is 20 frames, a bar 80; trailer/mix.mjs
// cuts the track down to these 88 seconds): 132 beats, the drop on beat 24, the heat from beat 72,
// a breakdown from beat 110, the logo on beat 120.
// Every sound is laid on the same grid: the narrator's lines (trailer/voice) and the effects
// (trailer/sfx) go to captures/trailer/hype3_cues.json, which trailer/mix.mjs turns into the
// soundtrack. See trailer/README.md for the whole pipeline.
import * as THREE from 'three';

const Q = new URLSearchParams(location.search);
const W = 1920, H = 1080, FPS = 30, DT = 1 / FPS, BEAT = 20, TOTAL_BEATS = 132;
const g = window.__game;
window.__trailer = true;

for (const id of ['stats', 'radar', 'street', 'help', 'speedo', 'hint', 'overlay', 'cutscene', 'fade', 'crosshair', 'msg', 'mission', 'fun', 'shop', 'dacity', 'freeplay']) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
g.resize(W, H);

const out = document.createElement('canvas');
out.width = W;
out.height = H;
const ctx = out.getContext('2d');
const still = document.createElement('canvas'); // a frozen frame (the name cards)
still.width = W;
still.height = H;
const sctx = still.getContext('2d');

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
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
const takeHit = P.takeHit.bind(P);
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
  P.posed = null;
  if (P.busted) P.busted = false;
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
function clearPeds(x, z, r) {
  for (const p of [...g.peds.list]) if (!p.keep && Math.hypot(p.x - x, p.z - z) < r) g.peds.remove(p);
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
function face(x, z) {
  P.yaw = Math.atan2(x - P.position.x, z - P.position.z);
  P.object.rotation.set(0, P.yaw, 0);
  g.follow.yaw = P.yaw;
}
// walk in through a venue's door (the fade is hidden), standing inside
function enter(type) {
  calm();
  const S = g.shop(), b = S.branches.find((q) => q.type === type);
  if (S.inside !== b) {
    if (S.inside) {
      S.go(S.inside, false);
      step(24);
    }
    P.position.set(b.door.x, C.groundHeight(b.door.x, b.door.z), b.door.z + 3);
    step(2);
    S.go(b, true);
    step(24);
  }
  return b;
}
function leave() {
  const S = g.shop();
  if (S.inside) {
    calm();
    S.go(S.inside, false);
    step(24);
  }
  P.indoors = false;
}
function behind(v, back, side, up) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  return v3(v.pos.x - fx * back + fz * side, up, v.pos.z - fz * back - fx * side);
}
function ahead(v, d, up = 0.8) {
  return v3(v.pos.x + Math.sin(v.heading) * d, up, v.pos.z + Math.cos(v.heading) * d);
}
// around the hero: a for the angle (0 in front of him), d away, at height h, looking at his chest
function orbit(cam, a, d, h, look = 1.35, fov = 45) {
  const p = P.position, yaw = P.yaw + a;
  cam.position.set(p.x + Math.sin(yaw) * d, p.y + h, p.z + Math.cos(yaw) * d);
  cam.lookAt(p.x, p.y + look, p.z);
  cam.fov = fov;
}

// ------------------------------------------------------------------ compositing: the look
const BAR = 64; // slim bars (2.1:1)
const GOLD = '#ffd23f';
const FONT = 'Anton, Impact, sans-serif';

function drawText(text, { size = 64, y = H / 2, alpha = 1, color = '#fff', stroke = 10, spacing = 2, x = W / 2, align = 'center', font = FONT, shadow = true, scale = 1, rot = 0 }) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${spacing}px`;
  ctx.lineJoin = 'round';
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowOffsetX = size * 0.05;
    ctx.shadowOffsetY = size * 0.06;
    ctx.shadowBlur = size * 0.08;
  }
  if (stroke) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, 0, 0);
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
// a title that slams in (big, settles in a few frames), holds, and drops out
function slam(text, t, t0 = 0.05, { size = 150, y = H - BAR - 120, color = '#fff', life = 1, x = W / 2, align = 'center', rot = -0.035 } = {}) {
  const k = (t - t0) * 9;
  if (k <= 0 || t > t0 + life) return;
  const s = 1 + 0.5 * Math.max(0, 1 - k) ** 2;
  drawText(text, { size, y, x, color, alpha: Math.min(1, k * 2), scale: s, stroke: size * 0.12, spacing: 3, align, rot });
}
// a GTA intro card: the picture frozen, the name in big letters with its colour swiped under it
function nameCard(name, role, color, t, t0) {
  const k = clamp01((t - t0) * 8);
  if (k <= 0) return;
  const x = 150, y = H - BAR - 190;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.95;
  ctx.fillRect(x - 20, y + 62, (520 + name.length * 30) * ease(k), 12);
  ctx.restore();
  drawText(name, { size: 170, x: x + (1 - ease(k)) * -120, y, align: 'left', color: '#fff', stroke: 18, spacing: 4, alpha: k, rot: -0.03 });
  drawText(role, { size: 40, x: x + 6, y: y + 112, align: 'left', color, stroke: 8, spacing: 8, alpha: clamp01((t - t0) * 6 - 0.6), rot: -0.03 });
}
function stars(n, t, { y = BAR + 60, size = 66, x0 = W - 440 } = {}) {
  for (let i = 0; i < 5; i++) {
    const on = i < n && t * 10 > i * 0.8;
    drawText('★', { size, x: x0 + i * size * 1.12, y, color: on ? '#fff' : 'rgba(255,255,255,.22)', stroke: 6 });
  }
}
function moneyHud(v) {
  drawText(`$${String(Math.round(v)).padStart(8, '0')}`, { size: 64, x: W - 70, y: BAR + 70, align: 'right', color: '#7ad65b', stroke: 9, spacing: 3, font: '"Pricedown", Anton, Impact, sans-serif' });
}
// a name over a head, like the players' tags in multiplayer
const _np = new THREE.Vector3();
function tagAt(text, pos, cam) {
  _np.copy(pos).project(cam);
  if (_np.z > 1) return;
  const x = (_np.x * 0.5 + 0.5) * W, y = (-_np.y * 0.5 + 0.5) * H;
  ctx.save();
  ctx.font = 'bold 34px Inter, Arial, sans-serif';
  const w = ctx.measureText(text).width + 34;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 26, w, 52, 14);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function composite(shot, f, n) {
  const t = f / n, frozen = shot.freeze != null && t >= shot.freeze;
  ctx.save();
  if (frozen) {
    // the frozen frame, drained of colour and washed with the card's colour
    ctx.filter = 'grayscale(.55) contrast(1.25) brightness(.9)';
    ctx.drawImage(still, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = shot.tint || GOLD;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.filter = shot.grade || 'contrast(1.14) saturate(1.38) brightness(1.04) sepia(.08)';
    // a punch-in on the cut, and on a whip the picture smears in from the side
    const z = (shot.punch ? 1.08 : 1.03) - (shot.punch ? 0.08 : 0.03) * clamp01(f / 6);
    const sh = shot.shake ? (Math.random() - 0.5) * shot.shake * Math.max(0, 1 - (f % BEAT) / 6) : 0;
    const src = g.renderer.domElement;
    if (shot.whip && f < 4) {
      const k = 1 - f / 4;
      ctx.globalAlpha = 0.28;
      for (let i = -3; i <= 3; i++) ctx.drawImage(src, (W - W * z) / 2 + i * 90 * k * shot.whip, (H - H * z) / 2, W * z, H * z);
      ctx.globalAlpha = 1;
    } else ctx.drawImage(src, (W - W * z) / 2 + sh, (H - H * z) / 2 + sh * 0.6, W * z, H * z);
    ctx.filter = 'none';
    if (shot.freeze != null) sctx.drawImage(out, 0, 0); // (kept for the freeze)
  }
  ctx.restore();
  // warm light from the top corner, a soft vignette
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const lg = ctx.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, `rgba(255,190,90,${shot.night ? 0.12 : 0.32})`);
  lg.addColorStop(1, `rgba(40,70,140,${shot.night ? 0.3 : 0.18})`);
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.0);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  if (shot.flash && f < 5) {
    ctx.fillStyle = `rgba(255,248,230,${0.85 * (1 - f / 5)})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, BAR);
  ctx.fillRect(0, H - BAR, W, BAR);
  shot.overlay?.call(shot, t, f, n);
  if (shot.fadeIn) {
    ctx.fillStyle = `rgba(0,0,0,${1 - clamp01(t / shot.fadeIn)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (shot.fadeOut != null && t > shot.fadeOut) {
    ctx.fillStyle = `rgba(0,0,0,${clamp01((t - shot.fadeOut) / (1 - shot.fadeOut))})`;
    ctx.fillRect(0, 0, W, H);
  }
}

async function upload(index) {
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.93));
  await fetch(`/capture/hype3_${String(index).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
}

// ------------------------------------------------------------------ the narrator
// [beat, file, from s, to s, gain] (from/to: a piece of the file, for the lines cut to the pictures)
const NARRATION = [
  [1.5, 'n01'],
  [6, 'n02'],
  [16.5, 'n03'],
  [28, 'n04'],
  [36.3, 'n05'],
  [40.25, 'n06'],
  [44.25, 'n07'],
  [56.25, 'n08', 0, 1.5, 1.6],
  [60.25, 'n08', 1.6, 3.3, 1.6],
  [64.25, 'n08', 3.45, 5.84, 1.6],
  [72.5, 'n09'],
  [88.25, 'n10', 0, 1.6],
  [91.25, 'n10', 1.6, 3.1],
  [94.25, 'n10', 3.1, 4.68],
  [97.25, 'n11'],
  [104.3, 'n12'],
  [109.8, 'n13'],
  [114.8, 'n14'],
  [122.5, 'n15'],
];

// ------------------------------------------------------------------ shots
// beats: how long; sfx: [beat in the shot, effect, gain]; the rest as in hype2.js, plus
// freeze (from this fraction of the shot on, the picture holds), whip, punch, flash, shake
const card = (beats, draw, extra = {}) => ({ beats, black: true, overlay: draw, ...extra });

let fightPed = null, copCar = null, wreckCar = null;
const savedOutfit = JSON.stringify(g.shop().outfit);
const CONTACT_ROLE = { rosa: 'LITTLE HAVANA', vince: 'THE DOCKS', diaz: 'THE LAWYER', zara: 'DACITY' };

// a boss in their room, over the hero's shoulder, frozen into their card
function bossShot(id, name, beats = 2) {
  return {
    beats,
    freeze: 0.55,
    tint: null,
    sfx: [[beats * 0.55, 'freeze', 0.9]],
    setup() {
      calm();
      leave();
      const S = g.story();
      if (S.cut) {
        if (S.cut.arr) S.leaveRoom();
        S.cut = null;
      }
      const c = S.contacts.find((q) => q.id === id);
      this.tint = c.color;
      S.startCutscene(c);
      for (let i = 0; i < 240 && !(S.cut && S.cut.arr); i++) step(1);
      step(10);
      this.S = S;
    },
    camera(cam, t) {
      const cut = this.S.cut;
      if (!cut?.arr) return;
      const A = cut.arr.C, B = cut.arr.P;
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 1, fx = dx / d, fz = dz / d, rx = fz, rz = -fx;
      const h = A.sit ? 1.18 : 1.58;
      cam.position.set(A.x + fx * (1.35 - t * 0.25) + rx * 0.42, h + 0.08, A.z + fz * (1.35 - t * 0.25) + rz * 0.42);
      cam.lookAt(A.x + rx * 0.1, h - 0.02, A.z + rz * 0.1);
      cam.fov = 38;
    },
    overlay(t) {
      nameCard(name, CONTACT_ROLE[id], this.tint, t, 0.55);
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
  };
}

const shots = [
  // ================================================================ intro (36 beats): morning
  {
    // over the sea at sunrise, towards the skyline
    beats: 6,
    fadeIn: 0.3,
    setup() {
      calm();
      sky(6, 25);
      placeHero(118, EXT + 20, 0, 0.32);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(-60, 46, EXT + 150), v3(-20, 30, EXT + 40), e);
      cam.lookAt(v3(10, 12, -40));
      cam.fov = 50;
    },
    sfx: [[0, 'whoosh_low', 0.5]],
  },
  {
    // the beach jetty at sunrise, the hero at the end of it
    beats: 3,
    setup() {
      sky(6, 40);
    },
    camera(cam, t) {
      cam.position.lerpVectors(v3(138, 7, EXT + 62), v3(128, 3.5, EXT + 42), ease(t));
      cam.lookAt(v3(118, 0.8, EXT + 24));
      cam.fov = 52;
    },
  },
  {
    // umbrellas and palms along the beach, low over the sand
    beats: 3,
    setup() {
      sky(7, 30);
    },
    camera(cam, t) {
      const x = -60 + t * 30;
      cam.position.set(x, 1.4, HALF + 40);
      cam.lookAt(x + 30, 2.2, HALF + 14);
      cam.fov = 48;
    },
  },
  {
    // Downtown in the morning traffic, from a corner
    beats: 3,
    setup() {
      sky(8, 30);
    },
    camera(cam, t) {
      const x = C.roadC(4), z = C.roadC(4);
      cam.position.set(x + 14 - t * 3, 2.2 + t * 2, z + 16);
      cam.lookAt(x - 6, 8 + t * 4, z - 20);
      cam.fov = 58;
    },
  },
  {
    // the hero walks at the camera
    beats: 3,
    setup() {
      sky(9, 20);
      placeHero(14, -9.6, Math.PI / 2);
      clearPeds(20, -9.6, 12);
      hold('KeyW');
    },
    camera(cam, t) {
      orbit(cam, 0.25, 2.9 - t * 0.5, 0.65, 1.55, 42);
    },
  },
  {
    // money on the screen
    beats: 2,
    punch: true,
    setup() {
      placeHero(-6, -9.6, Math.PI / 2);
      hold();
    },
    camera(cam, t) {
      orbit(cam, -0.6 + t * 0.3, 1.5, 1.55, 1.5, 36);
    },
    overlay(t) {
      moneyHud(1000 + 90000 * ease(t));
    },
    sfx: [[0.2, 'cash', 0.8], [0, 'riser', 0.8]],
  },
  {
    // the pistol comes up
    beats: 1,
    punch: true,
    setup() {
      placeHero(-6, -9.6, Math.PI / 2);
      g.weapons().give('pistol');
      g.weapons().equip('pistol');
      trigger(true, 2);
      step(4);
    },
    camera(cam, t) {
      orbit(cam, -0.9 - t * 0.2, 1.4, 1.5, 1.42, 34);
    },
  },
  // the riser bar: a cut a beat, the last one a blink of fire, then black
  {
    beats: 1,
    whip: 1,
    setup() {
      calm();
      sky(13, 0);
      drive('super', -200, 1.75, Math.PI / 2, 40, 0xff6a13);
    },
    camera(cam) {
      const v = dv();
      cam.position.set(-180, 0.4, 5.6);
      cam.lookAt(v.pos.x, 0.8, v.pos.z);
      cam.fov = 40;
    },
    sfx: [[0, 'engine', 0.6]],
  },
  {
    beats: 1,
    whip: -1,
    setup() {
      calm();
      sky(13, 5);
      placeHero(-20, -9.3, Math.PI / 2);
      g.weapons().give('smg');
      g.weapons().equip('smg');
      trigger(true, 2);
      step(4);
      trigger(true);
    },
    camera(cam) {
      orbit(cam, -0.7, 1.9, 1.5, 1.4, 44);
    },
    after() {
      trigger(false);
    },
    sfx: [[0, 'smg', 0.5]],
  },
  card(1, (t) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }),
  // ================================================================ the story (24 beats)
  {
    // the drop: he walks away from the car going up behind him, slow
    beats: 4,
    punch: true,
    flash: true,
    timeScale: 0.55,
    setup() {
      calm();
      sky(18, 30);
      placeHero(-22, -9.6, Math.PI / 2);
      clearPeds(-22, -9.6, 14);
      this.car = spawnCar('lux', -28, -6.2, Math.PI / 2, 0x0d0e10);
      this.car.health = 5;
      hold('KeyW');
      step(4);
      vehicles.explode(this.car);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 4.4 - t * 0.9, 1.15, p.z - 1.3);
      cam.lookAt(p.x - 1, 1.5, p.z);
      cam.fov = 46;
    },
    sfx: [[0, 'hit', 1], [0, 'explosion', 0.9]],
  },
  bossShot('rosa', 'ROSA'),
  bossShot('vince', 'VINCE'),
  bossShot('diaz', 'DIAZ'),
  bossShot('zara', 'ZARA'),
  {
    // the Reserve: guards at the teller line, the SMG on them
    beats: 2,
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
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x - 0.9 + t * 0.6, 1.62, p.z - 1.1);
      cam.lookAt(p.x + 0.6, 1.3, p.z + 4);
      cam.fov = 50;
    },
    after() {
      for (const p of this.guards) g.peds.knockOut(p, 0, 0, false);
      trigger(false, 2);
    },
    overlay: (t) => slam('THE RESERVE', t, 0.15, { size: 110, life: 0.85 }),
  },
  {
    // the vault door, sparks off the drill
    beats: 2,
    setup() {
      const b = g.shop().inside, v = b.vault;
      placeHero(v.x, v.z - 0.9, 0, 0);
      P.indoors = true;
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
  },
  // ================================================================ action (40 beats)
  {
    // fists in the street
    beats: 3,
    punch: true,
    setup() {
      calm();
      sky(14, 40);
      placeHero(19.5, -10.4, Math.PI / 2);
      clearPeds(20, -10.4, 6);
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
    overlay: (t) => slam('FIGHT FOR IT', t, 0.05, { life: 0.9 }),
    sfx: [[0.1, 'punch', 0.8], [2.1, 'punch', 0.8]],
  },
  {
    // down he goes
    beats: 1,
    timeScale: 0.3,
    setup() {
      if (fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, false);
    },
    camera(cam, t) {
      cam.position.set(fightPed.x + 0.4 - t * 0.5, 0.5, fightPed.z + 3.2);
      cam.lookAt(fightPed.x + 0.4, 0.8 - t * 0.3, fightPed.z);
      cam.fov = 42;
    },
    grade: 'contrast(1.3) saturate(.8) brightness(1.15)',
    sfx: [[0, 'punch', 1]],
  },
  {
    // a black saloon at the kerb: the driver dragged out
    beats: 3,
    setup() {
      leave();
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
      step(24);
    },
    camera(cam, t) {
      const v = this.car.vehicle, a = v.heading + Math.PI / 2 + 0.3 + t * 0.3;
      cam.position.set(v.pos.x + Math.sin(a) * 4.2, 0.9, v.pos.z + Math.cos(a) * 4.2);
      cam.lookAt(v.pos.x, 1.1, v.pos.z);
      cam.fov = 46;
    },
  },
  {
    // the Russo crew on the pavement: the SMG against their pistols
    beats: 3,
    setup() {
      calm();
      sky(13, 30);
      const x = -30, z = -9.6;
      placeHero(x, z, Math.PI / 2);
      clearPeds(x + 10, z, 12);
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
    sfx: [[0, 'smg', 0.7], [1.5, 'pistol', 0.6], [2.5, 'smg', 0.6]],
  },
  {
    // the SMG into a patrol car, and it goes up
    beats: 3,
    timeScale: 0.5,
    setup() {
      calm();
      placeHero(-20, -9.3, Math.PI / 2);
      copCar = spawnCar('police', -10, -4.2, -Math.PI / 2 + 0.25, 0x111214);
      copCar.vehicle.siren = true;
      copCar.health = 30;
      g.weapons().give('smg');
      g.weapons().equip('smg');
      face(-10, -4.2);
      step(3);
      trigger(true);
      trigger(true, 2);
    },
    tick(f) {
      if (f === 26) {
        trigger(false);
        vehicles.activate(copCar);
        if (copCar.health !== 0) vehicles.explode(copCar);
      }
    },
    camera(cam, t) {
      const v = copCar.vehicle, a = 1.1 - t * 0.5;
      cam.position.set(v.pos.x + Math.sin(a) * 9, 1.0 + t * 1.2, v.pos.z + Math.cos(a) * 9);
      cam.lookAt(v.pos.x - 2, 1.4, v.pos.z - 2);
      cam.fov = 56;
    },
    after() {
      trigger(false);
      trigger(false, 2);
    },
    sfx: [[0, 'smg', 0.6], [1.3, 'explosion', 1]],
  },
  {
    // nitro
    beats: 2,
    punch: true,
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
    sfx: [[0, 'engine', 0.8]],
  },
  {
    // handbrake through the intersection
    beats: 1,
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
    sfx: [[0, 'screech', 0.8]],
  },
  {
    // RACE IT: the street race, off the line
    beats: 4,
    setup() {
      calm();
      sky(17, 0);
      const r = g.races().list[0];
      drive('super', r.startPos.x, r.startPos.z, r.yaw, 0, 0xff6a13);
      clearRoad(r.startPos.x, r.startPos.z, r.yaw, 200);
      hold();
      g.races().start(r, dv());
      step(Math.round(FPS * 3.3));
      hold('KeyW');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 7 - t * 2, 2.5, 1.6 + t * 0.6));
      cam.lookAt(ahead(v, 12, 1));
      cam.fov = 56 + t * 12;
    },
    overlay(t) {
      slam('RACE IT.', t, 0.04, { life: 0.95, color: GOLD });
    },
    after() {
      g.races().stop?.('');
    },
    sfx: [[0.75, 'engine', 0.55]],
  },
  {
    // JUMP IT: over the stunt ramp, slow
    beats: 4,
    setup() {
      const r = g.stunts().ramps[0];
      this.r = r;
      const sx = -r.fz * 1.3, sz = r.fx * 1.3;
      calm();
      clearRoad(r.x - r.fx * 50 + sx, r.z - r.fz * 50 + sz, r.yaw, 120, 10);
      drive('super', r.x - r.fx * 45 + sx, r.z - r.fz * 45 + sz, r.yaw, 38, 0x111114);
      step(30);
    },
    timeScale: 0.42,
    camera(cam, t) {
      const r = this.r, v = dv();
      cam.position.set(r.x + r.fx * 10 - r.fz * 9, 1.0 + t * 3, r.z + r.fz * 10 + r.fx * 9);
      cam.lookAt(v.pos.x, v.pos.y + 1.6, v.pos.z);
      cam.fov = 54;
    },
    overlay: (t) => slam('JUMP IT.', t, 0.04, { life: 0.95, color: GOLD }),
    sfx: [[0, 'whoosh_low', 0.4], [3.2, 'landing', 0.8]],
  },
  {
    // WRECK IT: down the pavement through the hydrants, the bins, a traffic light
    beats: 4,
    shake: 14,
    setup() {
      calm();
      sky(12, 10);
      // a stretch of pavement with a run of props on it: lamps, hydrants, bins (near the bank, where the
      // shots are set)
      const kinds = ['hydrant', 'bin', 'lamp', 'light'];
      const props = C.colliders.filter((c) => c.prop && !c.off && kinds.includes(c.prop.kind) && Math.hypot(c.x - 20, c.z) < 160);
      let best = null;
      for (const c of props) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = props.filter((o) => {
            const a = (o.x - c.x) * dx + (o.z - c.z) * dz, b = Math.abs((o.x - c.x) * dz - (o.z - c.z) * dx);
            return a >= 0 && a < 34 && b < 0.6;
          }).length;
          if (!best || n > best.n) best = { c, dx, dz, n };
        }
        if (best?.n >= 4) break;
      }
      const { c, dx, dz } = best;
      // the camera off to the road side of the pavement, not inside a building
      const inside = (x, z) => C.query(x - 0.5, x + 0.5, z - 0.5, z + 0.5).some((q) => q.type === 'box' && x > q.minX && x < q.maxX && z > q.minZ && z < q.maxZ);
      const side = inside(c.x + dz * 6 + dx * 30, c.z - dx * 6 + dz * 30) ? -1 : 1;
      this.line = { x: c.x, z: c.z, dx, dz, sx: dz * side, sz: -dx * side };
      const yaw = Math.atan2(dx, dz);
      wreckCar = drive('sedan', c.x - dx * 9, c.z - dz * 9, yaw, 21, 0x8a1c1c);
      clearPeds(c.x + dx * 15, c.z + dz * 15, 25);
    },
    timeScale: 0.7,
    camera(cam, t) {
      const L = this.line, v = dv();
      cam.position.set(L.x + L.dx * (13 - t * 3) + L.sx * 3.6, 0.85, L.z + L.dz * (13 - t * 3) + L.sz * 3.6);
      cam.lookAt(v.pos.x, 1.0, v.pos.z);
      cam.fov = 58;
    },
    overlay: (t) => slam('WRECK IT.', t, 0.04, { life: 0.95, color: GOLD }),
    sfx: [[0.3, 'crash', 0.55], [1.2, 'hydrant', 0.6], [2.3, 'crash', 0.6]],
  },
  {
    // and the wreck goes up, slow
    beats: 4,
    timeScale: 0.45,
    flash: true,
    setup() {
      const c = driving() ? wreckCar : spawnCar('sedan', P.position.x, P.position.z, 0, 0x8a1c1c);
      g.exit();
      step(10);
      this.car = c;
      vehicles.explode(c);
      const v = c.vehicle;
      placeHero(v.pos.x - Math.sin(v.heading) * 7, v.pos.z - Math.cos(v.heading) * 7, v.heading + Math.PI);
    },
    camera(cam, t) {
      const v = this.car.vehicle, a = v.heading + 1.6 - t * 0.6;
      cam.position.set(v.pos.x + Math.sin(a) * 10, 1.2 + t * 2, v.pos.z + Math.cos(a) * 10);
      cam.lookAt(v.pos.x, 1.5, v.pos.z);
      cam.fov = 52;
    },
    sfx: [[0, 'explosion', 1], [0, 'hit', 0.7]],
  },
  // ================================================================ the heat (24 beats)
  {
    // cops behind, nose to the camera, the stars filling up
    beats: 3,
    setup() {
      calm();
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
    overlay: (t) => stars(4, t),
    sfx: [[0, 'siren', 0.8]],
  },
  {
    // the helicopter's searchlight finds him, at night
    beats: 3,
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
    grade: 'brightness(1.35) contrast(1.12) saturate(1.3)',
    overlay: (t) => stars(5, t),
    sfx: [[0, 'heli', 0.9]],
  },
  {
    // a patrol car howls past the lens
    beats: 1,
    setup() {
      calm();
      sky(11, 0);
      drive('lux', -90, -1.75, Math.PI / 2, 10, 0x0d0e10);
      const c = spawnCar('police', -40, 1.75, -Math.PI / 2, 0x111214);
      c.vehicle.siren = true;
      c.vehicle.vel.set(-36, 0, 0);
      this.cop = c;
    },
    camera(cam) {
      cam.position.set(-58, 0.5, 5.4);
      const v = this.cop.vehicle;
      cam.lookAt(v.pos.x, 0.8, v.pos.z);
      cam.fov = 40;
    },
    sfx: [[0, 'whoosh', 0.8]],
  },
  {
    // the shotgun at the next one
    beats: 1,
    setup() {
      calm();
      placeHero(-20, -9.3, Math.PI / 2);
      const c = spawnCar('police', -11, -4.4, -Math.PI / 2 - 0.2, 0x111214);
      c.vehicle.siren = true;
      g.weapons().give('shotgun');
      g.weapons().equip('shotgun');
      face(-11, -4.4);
      trigger(true, 2);
      step(6);
    },
    tick(f) {
      if (f === 3 || f === 22) tap('Mouse0');
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 1.5, 1.2, p.z + 2.6 - t * 0.4);
      cam.lookAt(p.x + 0.4, 1.3, p.z);
      cam.fov = 46;
    },
    after() {
      trigger(false, 2);
    },
    sfx: [[0.15, 'pistol', 0.7]],
  },
  {
    // WASTED
    beats: 2,
    timeScale: 0.35,
    setup() {
      calm();
      sky(15, 30);
      placeHero(30, -9.6, Math.PI / 2);
      clearPeds(30, -9.6, 8);
      step(2);
      P.knockDown({ x: 31, z: -9.6 }, 3);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 0.5, 3.2 + t * 1.5, p.z + 2.4);
      cam.lookAt(p.x, 0.3, p.z);
      cam.fov = 48;
    },
    grade: 'grayscale(.75) contrast(1.25) brightness(.9)',
    overlay(t) {
      drawText('wasted', { size: 190, y: H / 2, color: '#c0242c', stroke: 14, spacing: 6, font: '"Pricedown", Anton, Impact, sans-serif', alpha: clamp01((t - 0.15) * 6), scale: 1 + 0.12 * (1 - clamp01((t - 0.15) * 4)) });
    },
    sfx: [[0, 'hit', 0.9]],
  },
  {
    // BUSTED: hands up in front of a patrol car
    beats: 3,
    setup() {
      calm();
      sky(15, 40);
      placeHero(30, -9.6, -Math.PI / 2);
      clearPeds(30, -9.6, 8);
      const c = spawnCar('police', 22, -5.6, Math.PI / 2 + 0.3, 0x111214);
      c.vehicle.siren = true;
      this.cop = g.peds.add('police', 26, -8.6, Math.atan2(30 - 26, -9.6 + 8.6));
      this.cop.state = 'contact';
      this.cop.keep = this.cop.hostile = this.cop.gunman = this.cop.aimingGun = true;
      g.story().arm(this.cop);
      P.surrender();
      step(10);
    },
    tick() {
      const p = this.cop;
      if (p) p.yaw = Math.atan2(P.position.x - p.x, P.position.z - p.z);
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 3.0 - t * 0.5, 1.35, p.z + 4.2);
      cam.lookAt(p.x - 1.6, 1.3, p.z - 0.4);
      cam.fov = 46;
    },
    grade: 'contrast(1.2) saturate(1.1) brightness(1.02)',
    overlay(t) {
      drawText('busted', { size: 190, y: H / 2 + 250, color: '#f2f2f2', stroke: 14, spacing: 6, font: '"Pricedown", Anton, Impact, sans-serif', alpha: clamp01((t - 0.3) * 6), scale: 1 + 0.12 * (1 - clamp01((t - 0.3) * 4)) });
    },
    after() {
      if (this.cop) {
        this.cop.keep = this.cop.hostile = this.cop.aimingGun = false;
        if (this.cop.body.userData.gun) this.cop.body.userData.gun.visible = false;
        g.peds.remove(this.cop);
      }
      P.busted = false;
      P.posed = null;
    },
    sfx: [[0, 'busted', 0.8], [1.2, 'hit', 0.6]],
  },
  {
    // into Sol Customs hot, out in a new colour: the stars are gone
    beats: 3,
    setup() {
      calm();
      sky(16, 45);
      const S = C.spray;
      drive('lux', S.x, S.z, Math.PI, 0, 0x0d0e10);
      hold();
      for (let i = 0; i < 3; i++) g.wanted.crime('ram_cop', true);
      g.police.clear?.();
      step(Math.round(FPS * 3.0));
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
    },
    sfx: [[0.5, 'whoosh', 0.6]],
  },
  // ================================================================ the hustle (20 beats)
  {
    // a taxi, a fare in the back
    beats: 3,
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
    overlay(t) {
      moneyHud(12400 + 85 * clamp01((t - 0.6) * 4));
    },
    sfx: [[3, 'cash', 0.6]],
  },
  {
    // the ambulance, lights going
    beats: 3,
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
    sfx: [[0, 'siren', 0.5]],
  },
  {
    // the fire truck's cannon on a burning car, at dusk
    beats: 3,
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
    sfx: [[0, 'hydrant', 0.5]],
  },
  {
    // the clothes store: shirts, a beat each
    beats: 2,
    setup() {
      const b = enter('clothes');
      placeHero(b.counter.x, b.counter.z - 1.4, 0, 0);
      P.indoors = true;
    },
    tick(f) {
      const S = g.shop(), cols = ['#b8202c', '#f2f1ec', '#5a9ad8', '#2a2a2e'];
      if (f % 10 === 0) {
        S.outfit.shirt = cols[(f / 10) % cols.length];
        S.applyOutfit();
      }
    },
    camera(cam, t) {
      orbit(cam, 0.4 - t * 0.5, 2.2, 1.5, 1.2, 46);
    },
    overlay: (t) => slam('NEW THREADS', t, 0.05, { size: 110, life: 0.9 }),
    sfx: [[0, 'whoosh', 0.5], [1, 'whoosh', 0.4]],
  },
  {
    // fresh ink and a new cut: a slow orbit in the tattoo parlour
    beats: 2,
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
      orbit(cam, -1.2 + t * 0.8, 1.6, 1.45, 1.3, 46);
    },
    overlay: (t) => slam('NEW INK', t, 0.05, { size: 110, life: 0.9 }),
    sfx: [[0, 'scratch', 0.5]],
  },
  {
    // Sol Customs: a fresh coat, gold rims
    beats: 2,
    setup() {
      leave();
      calm();
      sky(16, 50);
      const S = C.spray;
      const c = spawnCar('super', S.x, S.entrance.z - 5, Math.PI, 0xffd23f);
      c.tune = { engine: 3, nitro: true, rims: 'gold', tint: true };
      c.vehicle.applyTune();
      this.c = c;
    },
    camera(cam, t) {
      const v = this.c.vehicle, a = 0.8 + t * 0.9;
      cam.position.set(v.pos.x + Math.sin(a) * 5, 0.9, v.pos.z + Math.cos(a) * 5);
      cam.lookAt(v.pos.x, 0.7, v.pos.z);
      cam.fov = 44;
    },
    overlay: (t) => slam('NEW RIDE', t, 0.05, { size: 110, life: 0.9 }),
    sfx: [[0, 'engine', 0.4]],
  },
  {
    // the South Beach villa
    beats: 1,
    setup() {
      calm();
      sky(18, 40);
      const h = g.homes().houses.find((q) => q.id === 'beach') || g.homes().houses[0];
      placeHero(h.door.x, h.door.z - 6, 0);
      hold('KeyW');
      this.h = h;
    },
    camera(cam, t) {
      const d = this.h.door;
      cam.position.set(d.x + 9 - t * 2, 2.2, d.z - 14);
      cam.lookAt(d.x, 3.2, d.z + 4);
      cam.fov = 54;
    },
    overlay: (t) => slam('A PLACE OF YOUR OWN', t, 0.05, { size: 96, life: 0.9 }),
    after() {
      hold();
    },
  },
  // ================================================================ life (10 beats)
  {
    // the gym: bench press
    beats: 1,
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
  },
  {
    // Club Solar: the dance floor and the crowd
    beats: 2,
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
    sfx: [[0, 'crowd', 0.5]],
  },
  {
    // the arcade's glowing cabinets
    beats: 1,
    night: true,
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
  },
  {
    // a jetski at the waterline, spray in the lens
    beats: 1,
    setup() {
      leave();
      sky(17, 30);
      drive('jetski', 20, EXT + 70, Math.PI / 2, 19, 0xff2bd6);
    },
    camera(cam, t) {
      const v = dv();
      cam.position.set(44, WY + 0.45, EXT + 66);
      cam.lookAt(v.pos.x, WY + 0.8, v.pos.z);
      cam.fov = 40 + t * 12;
    },
    sfx: [[0, 'boat', 0.6], [1.2, 'splash', 0.5]],
  },
  {
    // the speedboat out to sea at sunset
    beats: 1,
    setup() {
      sky(19, 12);
      drive('boat', 150, EXT + 60, Math.PI / 2, 17, 0x111114);
    },
    tick(f) {
      if (f === 14) hold('KeyW', 'KeyA');
    },
    camera(cam, t) {
      const v = dv();
      cam.position.copy(behind(v, 12 - t * 3, -6, 5 - t));
      cam.lookAt(ahead(v, 4, 0));
      cam.fov = 58;
    },
  },
  // ================================================================ the crew (10 beats): the breakdown
  {
    // four of them walking down the boulevard at dusk, the hero out in front in the middle, the
    // other three (other players, in their own avatars) fanned out behind him, names over their heads
    beats: 5,
    setup() {
      calm();
      sky(18, 55);
      const x = -10, z = -9.6;
      placeHero(x, z, Math.PI / 2);
      clearPeds(x + 8, z, 20);
      this.crew = [[-1.3, 0.8, 'MIAMI_V', 'female', 'Female_Adult_15'], [1.3, 0.8, 'DAWG', 'male', 'Male_Adult_14'], [-2.5, 1.7, 'LUCKY777', 'male', 'Male_Adult_08']].map(([side, back, name, kind, avatar]) => {
        const p = g.peds.add(kind, x, z + side, Math.PI / 2, avatar);
        p.state = 'remote';
        p.keep = true;
        p.side = side;
        p.back = back;
        p.tagName = name;
        return p;
      });
      hold('KeyW');
      step(2);
    },
    tick() {
      for (const p of this.crew) {
        p.x = P.position.x - p.back;
        p.z = P.position.z + p.side;
        p.y = C.groundHeight(p.x, p.z);
        p.yaw = P.yaw;
        p.cur = P.speed || 1.4;
        p.netAnim = 'walk';
      }
    },
    camera(cam, t) {
      const p = P.position;
      cam.position.set(p.x + 6.0 - t * 1.2, 1.3, p.z);
      cam.lookAt(p.x - 1, 1.4, p.z);
      cam.fov = 50;
      this.cam = cam;
    },
    overlay(t) {
      if (!this.cam) return;
      const a = clamp01((t - 0.12) * 5);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      tagAt('NICO_SOL', v3(P.position.x, P.position.y + 2.15, P.position.z), this.cam);
      for (const p of this.crew) tagAt(p.tagName, v3(p.x, p.y + 2.15, p.z), this.cam);
      ctx.globalAlpha = 1;
    },
    after() {
      for (const p of this.crew) g.peds.remove(p);
      hold();
    },
    sfx: [[4, 'riser', 0.9]],
  },
  card(5, (t, f) => {
    // the holders' card
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    slam('HOLD $SOLCITY', t, 0.02, { size: 150, y: H / 2 - 90, life: 2, rot: -0.03 });
    slam('EARN $DACITY', t, 0.6, { size: 150, y: H / 2 + 90, color: GOLD, life: 2, rot: -0.03 });
  }),
  // ================================================================ the finale (12 beats): the logo
  {
    beats: 12,
    flash: true,
    fadeOut: 0.86,
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
    grade: 'brightness(.85) contrast(1.15) saturate(1.3)',
    night: true,
    overlay(t) {
      const k = clamp01(t * 14);
      drawText('SOL CITY', { size: 260, y: H / 2 - 50, color: '#fff', stroke: 26, spacing: 10, scale: 1 + 0.6 * (1 - ease(k)), alpha: k, rot: -0.03 });
      drawText('NOW PLAYING', { size: 56, y: H / 2 + 120, spacing: 22, color: GOLD, stroke: 9, alpha: clamp01((t - 0.43) * 5), rot: -0.03 });
      drawText('FREE IN YOUR BROWSER  ·  MULTIPLAYER FOR HOLDERS OF 10,000 $SOLCITY', { size: 30, y: H / 2 + 200, spacing: 5, color: '#eee', stroke: 5, alpha: clamp01((t - 0.55) * 5) });
    },
    sfx: [[0, 'hit_final', 1]],
  },
];

// ------------------------------------------------------------------ record
const REC = Q.get('rec') ? Q.get('rec').split(',').flatMap((r) => {
  const [a, b] = r.split('-').map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}) : null;

// every sound on the grid: { t: seconds, name, gain, from, to }
function cueSheet() {
  const cues = NARRATION.map(([beat, name, from, to, gain = 1]) => ({ t: (beat * BEAT) / FPS, kind: 'voice', name, gain, from, to }));
  let beat = 0;
  for (const s of shots) {
    for (const [b, name, gain] of s.sfx || []) cues.push({ t: ((beat + b) * BEAT) / FPS, kind: 'sfx', name, gain });
    beat += s.beats;
  }
  return { fps: FPS, beat: BEAT, beats: beat, seconds: (beat * BEAT) / FPS, cues };
}

async function run() {
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:14px monospace;z-index:9;background:#000a;padding:4px 8px';
  document.body.appendChild(status);
  const sum = shots.reduce((s, x) => s + x.beats, 0);
  if (sum !== TOTAL_BEATS) console.warn('hype3: beats', sum, 'expected', TOTAL_BEATS);
  window.__hypeBeats = sum;
  await fetch('/capture/hype3_cues.json', { method: 'POST', body: JSON.stringify(cueSheet(), null, 1) });
  if (Q.has('cues')) return void (status.textContent = 'cues written');
  g.setCinematic(null);
  step(150);
  let beat = 0, index = 0;
  const total = Math.round(TOTAL_BEATS * BEAT);
  for (let k = 0; k < shots.length; k++) {
    const shot = shots[k];
    const f0 = Math.round(beat * BEAT);
    beat += shot.beats;
    const n = Math.round(beat * BEAT) - f0;
    const rec = !REC || REC.includes(k);
    if (!shot.black && (rec || !REC)) {
      g.setCinematic(null);
      shot.setup?.call(shot);
    }
    g.setCinematic(shot.camera ? (cam) => {
      shot.camera.call(shot, cam, shot._t);
      cam.updateProjectionMatrix();
    } : null);
    for (let f = 0; f < n; f++) {
      shot._t = f / n;
      const frozen = shot.freeze != null && shot._t >= shot.freeze;
      if (!rec) {
        index++;
        continue;
      }
      shot.tick?.call(shot, f, n);
      if (shot.black) shot.overlay(shot._t, f, n);
      else {
        if (!frozen) {
          g.step(DT * (shot.timeScale || 1));
          g.render();
        }
        composite(shot, f, n);
      }
      await upload(index++);
      status.textContent = `recording ${index}/${total} (shot ${k + 1}/${shots.length})`;
    }
    if (rec || !REC) shot.after?.call(shot);
  }
  calm();
  leave();
  // the hero's own look back (the shop shots change it)
  const S = g.shop();
  S.outfit = JSON.parse(savedOutfit);
  S.applyOutfit();
  P.takeHit = takeHit;
  status.textContent = `done: ${index} frames`;
  window.__hypeDone = index;
}

run().catch((e) => {
  window.__hypeErr = String(e && e.stack || e);
  console.error(e);
});
