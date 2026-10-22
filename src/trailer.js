// Trailer recorder (open the game with ?trailer). Steps the game at a fixed 30 fps,
// drives scripted shots (camera + inputs), composites titles/grading on top and uploads
// every frame to the dev server (captures/trailer/fNNNNN.jpg) for encoding.
import * as THREE from 'three';

const W = 1280, H = 720, FPS = 30, DT = 1 / FPS;
const g = window.__game;
window.__trailer = true;

for (const id of ['stats', 'radar', 'street', 'help', 'speedo', 'hint', 'overlay']) {
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
const car = () => g.vehicles.cars[0];

// ------------------------------------------------------------------ compositing
function drawText(text, { size = 64, y = H / 2, alpha = 1, color = '#fff', stroke = 6, gradient = false, spacing = 2, x = W / 2 }) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px Anton, Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${spacing}px`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(text, x, y);
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

function composite(shot, f, n) {
  ctx.save();
  ctx.filter = shot.grade || 'contrast(1.12) saturate(1.2)';
  ctx.drawImage(g.renderer.domElement, 0, 0, W, H);
  ctx.restore();
  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // letterbox
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillRect(0, H - 62, W, 62);
  // punchy white flash on the cut
  if (shot.flash && f < 5) {
    ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - f / 5)})`;
    ctx.fillRect(0, 0, W, H);
  }
  shot.overlay?.call(shot, f / n, f, n);
}

async function upload(index) {
  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92));
  await fetch(`/capture/f${String(index).padStart(5, '0')}.jpg`, { method: 'POST', body: blob });
}

// ------------------------------------------------------------------ shots
const titleCard = (lines, frames, flash = false) => ({
  frames,
  flash,
  black: true,
  overlay: (t) => {
    const a = Math.min(1, t * 6, (1 - t) * 6);
    lines.forEach(([text, opts]) => drawText(text, { ...opts, alpha: a * (opts.alpha ?? 1) }));
  },
});

let fightPed = null;
const shots = [
  titleCard([['SOL CITY STORIES', { size: 30, spacing: 10, color: '#f2d48c', stroke: 0 }]], 40),
  titleCard([['THE CITY NEVER SLEEPS', { size: 56, spacing: 6 }]], 30, true),
  {
    // aerial sweep over downtown at golden hour
    frames: 90,
    flash: true,
    setup() {
      g.setNight(false);
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(-170, 95, 150), v3(-70, 48, 55), e);
      cam.lookAt(v3(30, 12, -30));
      cam.fov = 58;
    },
  },
  {
    // the hero walks toward a low tracking camera
    frames: 78,
    flash: true,
    setup() {
      const p = g.player;
      p.position.set(14, 0.15, -9.6);
      p.yaw = Math.PI / 2;
      g.follow.yaw = Math.PI / 2;
      hold('KeyW');
    },
    camera(cam, t) {
      const p = g.player.position;
      cam.position.set(p.x + 2.7 - t * 0.3, p.y + 0.75, p.z + 0.55);
      cam.lookAt(p.x, p.y + 1.45, p.z);
      cam.fov = 48;
    },
    overlay: (t) => drawText('WELCOME TO SOL CITY', { size: 70, y: H - 130, alpha: Math.min(1, (t - 0.25) * 5) }),
  },
  {
    // street fight: jab-cross combos, the other guy swings back
    frames: 100,
    flash: true,
    setup() {
      hold();
      const p = g.player;
      p.position.set(19.5, 0.15, -10.4);
      p.yaw = Math.PI / 2;
      g.follow.yaw = Math.PI / 2;
      fightPed = g.peds.list.find((q) => q.state === 'walk' && !q.female) || g.peds.list[0];
      fightPed.x = p.position.x + 1.05;
      fightPed.z = p.position.z;
      fightPed.y = 0.15;
      fightPed.yaw = -Math.PI / 2;
      fightPed.points = [{ x: fightPed.x - 0.01, z: fightPed.z }];
      fightPed.hits = 0;
      fightPed.state = 'walk';
    },
    tick(f) {
      if (f % 9 === 0 && f < 90 && fightPed.state !== 'down') tap('Mouse0');
      // save the knockout for the slow-motion shot
      if (fightPed.hits > 4) fightPed.hits = 4;
    },
    camera(cam, t) {
      const p = g.player.position;
      const a = -0.6 + t * 0.9;
      const c = v3(p.x + 0.5, 0, p.z);
      cam.position.set(c.x + Math.sin(a) * 2.6, 1.35, c.z - Math.cos(a) * 2.6);
      cam.lookAt(c.x, 1.25, c.z);
      cam.fov = 50;
    },
    overlay: (t) => drawText('THROW HANDS', { size: 74, y: H - 130, alpha: Math.min(1, (t - 0.3) * 5) }),
  },
  {
    // slow-motion knockout
    frames: 60,
    timeScale: 0.35,
    flash: true,
    setup() {
      if (fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, true);
    },
    tick(f) {
      if (f === 2 && fightPed.state !== 'down') g.peds.knockOut(fightPed, 2.6, 0, true);
    },
    camera(cam, t) {
      cam.position.set(fightPed.x + 0.4 - t * 0.6, 0.85, fightPed.z - 3.6);
      cam.lookAt(fightPed.x + 0.4, 0.85 - t * 0.35, fightPed.z);
      cam.fov = 45;
    },
    grade: 'contrast(1.2) saturate(.75)',
  },
  {
    // grab the cash
    frames: 54,
    setup() {
      // make sure the drop exists
      if (!g.peds.cash.length) g.peds.dropCash(fightPed.x + 0.2, fightPed.z + 0.8);
      const c = g.peds.cash[g.peds.cash.length - 1];
      const p = g.player;
      p.position.set(c.x - 2.2, 0.15, c.z);
      p.yaw = Math.PI / 2;
      g.follow.yaw = Math.PI / 2;
      hold('KeyW');
      this.cash = c;
    },
    camera(cam, t) {
      const c = this.cash;
      const p = g.player.position;
      // over the shoulder, looking down at the cash
      cam.position.set(p.x - 1.4, 1.75, p.z - 1.3);
      cam.lookAt(c.x, 0.45, c.z);
      cam.fov = 46;
    },
    overlay(t) {
      drawText('+$' + (this.cash?.amount || 120), { size: 80, y: H / 2 - 40, color: '#7ad65b', alpha: t > 0.45 ? Math.min(1, (t - 0.45) * 6) : 0, x: W * 0.7 });
    },
  },
  {
    // get in the coupe
    frames: 54,
    flash: true,
    setup() {
      hold();
      const c = car();
      const [x, z, h] = g.vehicles.pose(c);
      const p = g.player;
      p.position.set(x + Math.cos(h) * 1.7, 0.15, z - Math.sin(h) * 1.7);
      this.done = false;
    },
    tick(f) {
      if (f === 6) g.toggleVehicle();
    },
    camera(cam, t) {
      const [x, z, h] = g.vehicles.pose(car());
      const a = h - Math.PI / 2 - 0.55 + t * 0.4;
      cam.position.set(x + Math.sin(a) * 5.8, 1.6, z + Math.cos(a) * 5.8);
      cam.lookAt(x, 0.9, z);
      cam.fov = 50;
    },
    overlay: (t) => drawText('TAKE WHAT YOU WANT', { size: 66, y: H - 130, alpha: Math.min(1, (t - 0.2) * 5) }),
  },
  {
    // floor it: low chase camera
    frames: 105,
    flash: true,
    setup() {
      hold('KeyW');
    },
    camera(cam, t) {
      const v = car().vehicle;
      if (!v) return;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      cam.position.set(v.pos.x - fx * 5.2 + fz * 1.2, 1.1, v.pos.z - fz * 5.2 - fx * 1.2);
      cam.lookAt(v.pos.x + fx * 6, 0.9, v.pos.z + fz * 6);
      cam.fov = 62 + Math.min(18, v.speed * 0.45);
    },
  },
  {
    // handbrake drift into the intersection
    frames: 66,
    flash: true,
    setup() {
      const v = car().vehicle;
      v.pos.set(30, 0, 1.75);
      v.heading = Math.PI / 2;
      v.vel.set(26, 0, 0);
      v.angVel = 0;
      v.sync();
      hold('KeyW');
    },
    tick(f) {
      if (f === 20) hold('KeyW', 'KeyA', 'Space');
      if (f === 44) hold('KeyW');
    },
    camera(cam, t) {
      const v = car().vehicle;
      cam.position.set(78, 7 - t * 2.5, -14 + t * 3);
      cam.lookAt(v.pos.x, 0.5, v.pos.z);
      cam.fov = 55;
    },
    overlay: (t) => drawText('OWN THE STREETS', { size: 72, y: H - 130, alpha: Math.min(1, (t - 0.35) * 5) }),
  },
  {
    // road-level fly-by
    frames: 50,
    flash: true,
    setup() {
      const v = car().vehicle;
      v.pos.set(-75, 0, 1.75);
      v.heading = Math.PI / 2;
      v.vel.set(38, 0, 0);
      v.angVel = 0;
      v.steer = 0;
      v.sync();
      hold('KeyW');
    },
    camera(cam) {
      const v = car().vehicle;
      cam.position.set(-30, 0.45, 6.2);
      cam.lookAt(v.pos.x, 0.7, v.pos.z);
      cam.fov = 40;
    },
  },
  {
    // neon night cruise
    frames: 75,
    flash: true,
    setup() {
      g.setNight(true);
      const v = car().vehicle;
      v.pos.set(-185, 0, 1.75);
      v.heading = Math.PI / 2;
      v.vel.set(16, 0, 0);
      v.angVel = 0;
      v.sync();
      hold('KeyW');
    },
    tick() {
      const v = car().vehicle;
      if (v.speed > 17) hold();
      else hold('KeyW');
    },
    camera(cam, t) {
      const v = car().vehicle;
      cam.position.set(v.pos.x + 9 - t * 6, 1.5, v.pos.z - 6.5);
      cam.lookAt(v.pos.x + 1.5, 0.9, v.pos.z);
      cam.fov = 52;
    },
    grade: 'brightness(1.35) contrast(1.1) saturate(1.4)',
    overlay: (t) => drawText('NO RULES. NO LIMITS.', { size: 64, y: H - 130, alpha: Math.min(1, (t - 0.3) * 5) }),
  },
  {
    // logo over the night skyline
    frames: 95,
    flash: true,
    setup() {
      hold();
    },
    camera(cam, t) {
      const e = ease(t);
      cam.position.lerpVectors(v3(150, 40, 230), v3(120, 70, 190), e);
      cam.lookAt(v3(0, 30 + 10 * e, 0));
      cam.fov = 55;
    },
    grade: 'contrast(1.15) saturate(1.3) brightness(1.05)',
    overlay: (t) => {
      const a = Math.min(1, (t - 0.1) * 4);
      drawText('SOL CITY', { size: 150, y: H / 2 - 30, gradient: true, stroke: 10, spacing: 6, alpha: a });
      drawText('COMING SOON  •  PLAY IN YOUR BROWSER', { size: 30, y: H / 2 + 70, spacing: 5, color: '#f6e3c2', stroke: 4, alpha: Math.min(1, (t - 0.35) * 4) });
    },
  },
];

// ------------------------------------------------------------------ record
async function run() {
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:14px monospace;z-index:9;background:#000a;padding:4px 8px';
  document.body.appendChild(status);
  // let traffic and pedestrians populate first
  g.setCinematic(null);
  for (let i = 0; i < 150; i++) g.step(DT);
  let index = 0;
  const total = shots.reduce((s, x) => s + x.frames, 0);
  for (const shot of shots) {
    shot.setup?.();
    g.setCinematic(shot.camera ? (cam, dt) => {
      shot.camera.call(shot, cam, shot._t);
      cam.updateProjectionMatrix();
    } : null);
    for (let f = 0; f < shot.frames; f++) {
      shot._t = f / shot.frames;
      shot.tick?.call(shot, f);
      if (shot.black) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        shot.overlay(shot._t, f, shot.frames);
        if (shot.flash && f < 4) {
          ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - f / 4)})`;
          ctx.fillRect(0, 0, W, H);
        }
      } else {
        g.step(DT * (shot.timeScale || 1));
        g.render();
        composite(shot, f, shot.frames);
      }
      await upload(index++);
      status.textContent = `recording ${index}/${total}`;
    }
  }
  status.textContent = `done: ${index} frames`;
  window.__trailerDone = index;
}

run().catch((e) => {
  window.__trailerErr = String(e && e.stack || e);
  console.error(e);
});
