// Things to do in Sol City between jobs. The venues themselves (fronts, interiors, counters)
// are built by shops.js; the stations inside them hand over to the mini-games here:
//   gym:     treadmill (stamina: you run faster) and the bench press (strength: harder punches)
//   club:    the dance floor (a rhythm game to the club's beat) and darts against a local
//   arcade:  two cabinets, SOL INVADERS and NEON SNAKE
// plus your look: the barber's haircuts and dyes, the tattoo parlour's ink.
import * as THREE from 'three';

const FIT_KEY = 'solcity.fit', HI_KEY = 'solcity.arcade';

export const HAIRCUTS = [
  { id: 'crop', name: 'Classic crop', price: 20 },
  { id: 'bald', name: 'Clean shave', price: 30 },
  { id: 'blonde', name: 'Bleached blonde', color: '#e3c37e', price: 60 },
  { id: 'red', name: 'Fire red', color: '#c4361c', price: 60 },
  { id: 'blue', name: 'Electric blue', color: '#3a74f2', price: 80 },
  { id: 'platinum', name: 'Platinum', color: '#efeee6', price: 80 },
];
export const TATTOOS = [
  { id: 'tribal', name: 'Tribal band <small>(right arm)</small>', bone: 'upper_armR', price: 150, wrap: true },
  { id: 'skull', name: 'Skull &amp; rose <small>(left arm)</small>', bone: 'upper_armL', price: 250 },
  { id: 'script', name: '"SOL CITY" <small>(right forearm)</small>', bone: 'forearmR', price: 200 },
  { id: 'star', name: 'Lucky star <small>(left forearm)</small>', bone: 'forearmL', price: 120 },
  { id: 'laser', name: 'Laser removal', price: 300, remove: true },
];

// ------------------------------------------------------------------ tattoo artwork
export function tattooArt(id) {
  const c = document.createElement('canvas');
  c.width = id === 'tribal' ? 512 : 256;
  c.height = 128;
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = g.strokeStyle = 'rgba(18,24,34,0.92)';
  g.lineCap = g.lineJoin = 'round';
  if (id === 'tribal') {
    // a band of interlocking flames all the way round
    g.fillRect(0, 54, W, 8);
    for (let k = 0; k < 8; k++) {
      const x = k * 64;
      g.beginPath();
      g.moveTo(x, 58);
      g.quadraticCurveTo(x + 20, 10, x + 52, 18);
      g.quadraticCurveTo(x + 30, 30, x + 34, 58);
      g.fill();
      g.beginPath();
      g.moveTo(x + 32, 58);
      g.quadraticCurveTo(x + 52, 106, x + 84, 98);
      g.quadraticCurveTo(x + 62, 88, x + 66, 58);
      g.fill();
    }
  } else if (id === 'skull') {
    // a skull with a rose under the jaw
    g.beginPath();
    g.ellipse(128, 50, 30, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(110, 66, 36, 22);
    g.fillStyle = '#c9a888';
    g.globalCompositeOperation = 'destination-out';
    for (const x of [116, 140]) {
      g.beginPath();
      g.ellipse(x, 50, 8, 9, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(128, 60);
    g.lineTo(123, 70);
    g.lineTo(133, 70);
    g.fill();
    for (let k = 0; k < 4; k++) g.fillRect(114 + k * 8, 80, 3, 9);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(150,22,30,0.9)';
    for (const [x, y, r] of [[96, 98, 12], [104, 90, 9], [90, 90, 8]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(30,80,40,0.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(100, 106);
    g.quadraticCurveTo(120, 118, 160, 108);
    g.stroke();
  } else if (id === 'script') {
    g.font = 'italic bold 52px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('Sol City', W / 2, 82);
    g.fillRect(40, 96, W - 80, 3);
  } else if (id === 'star') {
    // a nautical star: alternating dark and red points
    const cx = 128, cy = 64;
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2 - Math.PI / 2, a1 = ((k + 1) / 10) * Math.PI * 2 - Math.PI / 2;
      const outer = k % 2 === 0;
      g.fillStyle = outer ? 'rgba(18,24,34,0.92)' : 'rgba(160,26,34,0.9)';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * (outer ? 50 : 22), cy + Math.sin(a0) * (outer ? 50 : 22));
      g.lineTo(cx + Math.cos(a1) * (outer ? 22 : 50), cy + Math.sin(a1) * (outer ? 22 : 50));
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A patch of ink that follows an arm bone: a slice of a cylinder hugging the skin, sized from
// the skin vertices bound to that bone (so it fits this model without hand-tuned numbers).
function armPatch(skin, boneName, tex, wrap) {
  const sk = skin.skeleton, bi = sk.bones.findIndex((b) => b.name === boneName);
  if (bi < 0) return null;
  const pos = skin.geometry.attributes.position, si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight;
  const toBone = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[bi], skin.bindMatrix);
  const v = new THREE.Vector3(), pts = [];
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
    if (w < 0.85) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(toBone);
    pts.push([v.x, v.y, v.z]);
    yMin = Math.min(yMin, v.y);
    yMax = Math.max(yMax, v.y);
  }
  if (pts.length < 20) return null;
  // where the ink goes, in bone space: the outside of the arm, half turned to the front
  const side = boneName.endsWith('L') ? 1 : -1;
  const out = new THREE.Vector3(side, 0, 0.9).normalize().transformDirection(toBone); // (outer side, turned to the front)
  const face = Math.atan2(out.x, out.z);
  const len = (yMax - yMin) * 0.42, yc = yMin + (yMax - yMin) * 0.5;
  const arc = wrap ? Math.PI * 2 : 1.7, segs = wrap ? 36 : 12, ROWS = 4;
  // the skin isn't round and isn't centred on the bone: for each row along the bone take the
  // centre of the arm there, then for each angle how far out the skin is, and lay the ink 3 mm over it
  const pos2 = [], uv = [], idx = [];
  for (let k = 0; k < ROWS; k++) {
    const y = yc - len / 2 + (len * k) / (ROWS - 1);
    const ring = pts.filter((p) => Math.abs(p[1] - y) < 0.025);
    const cx = ring.reduce((t, p) => t + p[0], 0) / (ring.length || 1), cz = ring.reduce((t, p) => t + p[2], 0) / (ring.length || 1);
    const rAt = (th) => {
      let best = 0;
      for (const p of ring) {
        const dx = p[0] - cx, dz = p[2] - cz;
        if (Math.cos(Math.atan2(dx, dz) - th) > 0.97) best = Math.max(best, Math.hypot(dx, dz));
      }
      return best;
    };
    const rs = [];
    for (let j = 0; j <= segs; j++) rs.push(rAt(face - arc / 2 + (arc * j) / segs));
    const fallback = rs.filter(Boolean).sort((p, q) => p - q)[Math.floor(rs.filter(Boolean).length / 2)] || 0.05;
    for (let j = 0; j <= segs; j++) {
      const th = face - arc / 2 + (arc * j) / segs, r = (rs[j] || fallback) + 0.003;
      pos2.push(cx + Math.sin(th) * r, y, cz + Math.cos(th) * r);
      uv.push(j / segs, 1 - k / (ROWS - 1));
    }
  }
  for (let k = 0; k < ROWS - 1; k++) for (let j = 0; j < segs; j++) {
    const a = k * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.renderOrder = 2;
  sk.bones[bi].add(m);
  return m;
}

// dye a copy of the hair texture: keep the strands' light and dark, take the hue of the dye
function dyed(map, color) {
  const img = map.image, c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data, col = new THREE.Color(color);
  const tr = col.r * 255, tg = col.g * 255, tb = col.b * 255;
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] + px[i + 1] + px[i + 2]) / 765, k = Math.min(1.3, 0.8 + 1.8 * l);
    px[i] = Math.min(255, tr * k);
    px[i + 1] = Math.min(255, tg * k);
    px[i + 2] = Math.min(255, tb * k);
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = map.colorSpace;
  t.flipY = map.flipY;
  t.wrapS = map.wrapS;
  t.wrapT = map.wrapT;
  return t;
}

// ------------------------------------------------------------------ the mini-games
// Each game: start(), update(dt, input) -> true when finished, draw(g, W, H), and a result.
const lanes = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'], laneAlt = ['KeyA', 'KeyS', 'KeyW', 'KeyD'];
const laneGlyph = ['◀', '▼', '▲', '▶'], laneCol = ['#ff4fa3', '#41d6ff', '#7dff6a', '#ffcf3f'];

class Treadmill {
  constructor() {
    this.title = 'TREADMILL';
    this.help = 'Tap <kbd>Space</kbd> to keep your pace in the green';
    this.T = 20;
    this.t = 0;
    this.pace = 0.3;
    this.inZone = 0;
  }
  zone() {
    const c = 0.62 + 0.13 * Math.sin(this.t * 0.5);
    return [c - 0.12, c + 0.12];
  }
  update(dt, input) {
    this.t += dt;
    if (input.pressed('Space')) this.pace = Math.min(1, this.pace + 0.085);
    this.pace = Math.max(0, this.pace - dt * (0.32 + this.t * 0.012));
    const [a, b] = this.zone();
    if (this.pace >= a && this.pace <= b) this.inZone += dt;
    return this.t >= this.T;
  }
  draw(g, W, H) {
    const [a, b] = this.zone();
    g.fillStyle = '#1b1e24';
    g.fillRect(40, 60, W - 80, 40);
    g.fillStyle = 'rgba(80,220,120,.35)';
    g.fillRect(40 + a * (W - 80), 60, (b - a) * (W - 80), 40);
    g.fillStyle = '#ffd23f';
    g.fillRect(40 + this.pace * (W - 80) - 3, 52, 6, 56);
    g.fillStyle = '#fff';
    g.font = '18px Inter, sans-serif';
    g.textAlign = 'center';
    g.fillText(`Time ${Math.max(0, this.T - this.t).toFixed(1)}s     In the zone ${this.inZone.toFixed(1)}s`, W / 2, 150);
  }
}

class Bench {
  constructor(fatigue) {
    this.title = 'BENCH PRESS';
    this.help = 'Hammer <kbd>Space</kbd> to push the bar up';
    this.T = 25;
    this.t = 0;
    this.lift = 0;
    this.reps = 0;
    this.down = 0; // lowering the bar after a rep
    this.fatigue = fatigue;
  }
  update(dt, input) {
    this.t += dt;
    if (this.down > 0) {
      this.down -= dt;
      if (input.pressed('Space')) {} // (no credit while it comes down)
    } else {
      if (input.pressed('Space')) this.lift += 0.075 / (1 + this.reps * 0.05 + this.fatigue);
      this.lift = Math.max(0, this.lift - dt * 0.3);
      if (this.lift >= 1) {
        this.reps++;
        this.lift = 0;
        this.down = 0.7;
      }
    }
    return this.t >= this.T;
  }
  // where the bar is in the press clip (0..1 of its length)
  get phase() {
    return this.down > 0 ? 0.55 + 0.45 * (1 - this.down / 0.7) : 0.4 * this.lift;
  }
  draw(g, W, H) {
    g.fillStyle = '#1b1e24';
    g.fillRect(W / 2 - 22, 40, 44, 140);
    g.fillStyle = '#ffd23f';
    const h = 140 * (this.down > 0 ? 1 : this.lift);
    g.fillRect(W / 2 - 22, 180 - h, 44, h);
    g.fillStyle = '#fff';
    g.font = '18px Inter, sans-serif';
    g.textAlign = 'center';
    g.fillText(`Reps ${this.reps}     Time ${Math.max(0, this.T - this.t).toFixed(1)}s`, W / 2, 215);
  }
}

class Dance {
  constructor(audio) {
    this.title = 'DANCE FLOOR';
    this.help = 'Hit <kbd>←</kbd><kbd>↓</kbd><kbd>↑</kbd><kbd>→</kbd> (or <kbd>A</kbd><kbd>S</kbd><kbd>W</kbd><kbd>D</kbd>) as the arrows reach the line';
    this.audio = audio;
    this.bpm = 120;
    this.beat = 60 / this.bpm;
    this.lead = 1.6; // seconds an arrow takes to fall to the line
    this.t = -2; // a two-second count-in
    this.notes = [];
    // 48 beats; the second half adds off-beats
    for (let b = 0; b < 48; b++) {
      if (b % 8 === 7) continue;
      this.notes.push({ t: b * this.beat, lane: (b * 7 + (b >> 2)) % 4 });
      if (b >= 24 && b % 2 === 1) this.notes.push({ t: (b + 0.5) * this.beat, lane: (b * 3 + 1) % 4 });
    }
    this.end = 48 * this.beat + 1;
    this.score = 0;
    this.combo = 0;
    this.best = 0;
    this.hits = 0;
    this.flash = null;
    this.lastBeat = -1;
  }
  update(dt, input) {
    this.t += dt;
    // the club's beat: kick on every beat, a hat on the off-beat
    const bi = Math.floor((this.t + 0.0001) / (this.beat / 2));
    if (bi !== this.lastBeat && this.t > -this.beat * 4 && this.t < this.end - 1) {
      this.lastBeat = bi;
      if (bi % 2 === 0) this.audio.blip({ tone: 140, toneEnd: 42, dur: 0.16, gain: 0.55 });
      else this.audio.blip({ noise: 1, cutoff: 7000, dur: 0.05, gain: 0.14 });
    }
    for (let l = 0; l < 4; l++) {
      if (!input.pressed(lanes[l]) && !input.pressed(laneAlt[l])) continue;
      const n = this.notes.find((n) => !n.done && n.lane === l && Math.abs(n.t - this.t) < 0.24);
      if (!n) {
        this.combo = 0;
        continue;
      }
      n.done = true;
      const err = Math.abs(n.t - this.t), perfect = err < 0.1;
      this.combo++;
      this.best = Math.max(this.best, this.combo);
      this.hits += perfect ? 1 : 0.6;
      this.score += (perfect ? 100 : 50) * (1 + Math.min(4, Math.floor(this.combo / 8)));
      this.flash = { text: perfect ? 'PERFECT' : 'GOOD', t: 0.4, lane: l };
    }
    for (const n of this.notes) if (!n.done && this.t - n.t > 0.24) {
      n.done = n.missed = true;
      this.combo = 0;
    }
    if (this.flash && (this.flash.t -= dt) <= 0) this.flash = null;
    return this.t >= this.end;
  }
  get accuracy() {
    return this.hits / this.notes.length;
  }
  draw(g, W, H) {
    const lx = (l) => W / 2 + (l - 1.5) * 64, lineY = H - 60;
    for (let l = 0; l < 4; l++) {
      g.strokeStyle = laneCol[l];
      g.globalAlpha = 0.35;
      g.lineWidth = 2;
      g.strokeRect(lx(l) - 26, 20, 52, H - 50);
      g.globalAlpha = 1;
      g.fillStyle = laneCol[l];
      g.font = '30px sans-serif';
      g.textAlign = 'center';
      g.globalAlpha = 0.5;
      g.fillText(laneGlyph[l], lx(l), lineY + 11);
      g.globalAlpha = 1;
    }
    g.fillStyle = '#fff';
    g.fillRect(lx(0) - 30, lineY - 2, 4 * 64 - 4, 3);
    for (const n of this.notes) {
      if (n.done) continue;
      const y = lineY - ((n.t - this.t) / this.lead) * (lineY - 20);
      if (y < 0) continue;
      g.fillStyle = laneCol[n.lane];
      g.font = '34px sans-serif';
      g.fillText(laneGlyph[n.lane], lx(n.lane), y + 12);
    }
    g.font = 'bold 18px Inter, sans-serif';
    g.textAlign = 'left';
    g.fillText(`Score ${this.score}`, 12, 26);
    g.textAlign = 'right';
    g.fillText(this.combo > 1 ? `Combo x${this.combo}` : '', W - 12, 26);
    if (this.t < 0) {
      g.textAlign = 'center';
      g.font = 'bold 40px Anton, Impact, sans-serif';
      g.fillText(String(Math.ceil(-this.t / this.beat / 2) || 'GO'), W / 2, H / 2);
    }
    if (this.flash) {
      g.textAlign = 'center';
      g.font = 'bold 20px Inter, sans-serif';
      g.fillStyle = laneCol[this.flash.lane];
      g.fillText(this.flash.text, lx(this.flash.lane), lineY - 40);
    }
  }
}

// darts: three rounds of three darts against one of the regulars, highest total wins
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
function dartScore(x, y) {
  const r = Math.hypot(x, y);
  if (r > 1) return 0;
  if (r < 0.037) return 50;
  if (r < 0.094) return 25;
  const a = (Math.atan2(x, -y) + Math.PI * 2 + Math.PI / 20) % (Math.PI * 2);
  const s = SECTORS[Math.floor(a / (Math.PI / 10)) % 20];
  return r > 0.953 ? s * 2 : r > 0.582 && r < 0.629 ? s * 3 : s;
}
class Darts {
  constructor() {
    this.title = 'DARTS';
    this.help = 'Steady the aim with the <kbd>mouse</kbd> or <kbd>WASD</kbd>, throw with <kbd>Space</kbd> or <kbd>click</kbd>';
    this.round = 0;
    this.turn = 'you';
    this.darts = [];
    this.you = 0;
    this.them = 0;
    this.aim = { x: 0, y: -0.6 };
    this.t = 0;
    this.wait = 0;
    this.log = '';
  }
  throwAt(x, y, spread) {
    const a = Math.random() * Math.PI * 2, r = Math.abs(gauss()) * spread;
    const d = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
    d.s = dartScore(d.x, d.y);
    this.darts.push(d);
    return d.s;
  }
  update(dt, input) {
    this.t += dt;
    if (this.wait > 0) {
      if ((this.wait -= dt) > 0) return false;
      this.darts = [];
      if (this.turn === 'you') this.turn = 'them';
      else {
        this.turn = 'you';
        if (++this.round >= 3) return true;
      }
      return false;
    }
    if (this.turn === 'you') {
      // aim with the mouse / keys; the hand shakes in slow loops
      const k = 0.0016;
      this.aim.x = THREE.MathUtils.clamp(this.aim.x + input.dx * k + ((input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0)) * dt * 0.9, -1.1, 1.1);
      this.aim.y = THREE.MathUtils.clamp(this.aim.y + input.dy * k + ((input.down('KeyS') ? 1 : 0) - (input.down('KeyW') ? 1 : 0)) * dt * 0.9, -1.1, 1.1);
      if (input.pressed('Space') || input.pressed('Mouse0')) {
        const w = this.wobble();
        this.you += this.throwAt(this.aim.x + w.x, this.aim.y + w.y, 0.025);
        if (this.darts.length === 3) this.wait = 1.4;
      }
    } else if (this.t > 0.7) {
      // the regular goes for the treble 20, not always well
      this.t = 0;
      this.them += this.throwAt(0, -0.605, 0.16);
      if (this.darts.length === 3) this.wait = 1.6;
    }
    return false;
  }
  wobble() {
    return { x: Math.sin(this.t * 1.7) * 0.07 + Math.sin(this.t * 4.1) * 0.025, y: Math.cos(this.t * 1.3) * 0.07 + Math.sin(this.t * 3.3) * 0.025 };
  }
  draw(g, W, H) {
    const R = Math.min(W, H) * 0.38, cx = W / 2, cy = H / 2 + 8;
    const ring = (r, col) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(cx, cy, r * R, 0, Math.PI * 2);
      g.fill();
    };
    ring(1.18, '#111');
    for (let i = 0; i < 20; i++) {
      const a0 = -Math.PI / 2 - Math.PI / 20 + (i * Math.PI) / 10, a1 = a0 + Math.PI / 10;
      for (const [r0, r1, dark, light] of [[0.629, 1, '#1a1a1a', '#efe4c8'], [0.094, 0.582, '#1a1a1a', '#efe4c8'], [0.953, 1, '#b3202a', '#1f7a45'], [0.582, 0.629, '#b3202a', '#1f7a45']]) {
        g.fillStyle = i % 2 ? light : dark;
        g.beginPath();
        g.arc(cx, cy, r1 * R, a0, a1);
        g.arc(cx, cy, r0 * R, a1, a0, true);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.font = '13px Inter, sans-serif';
      g.textAlign = 'center';
      const am = a0 + Math.PI / 20;
      g.fillText(SECTORS[i], cx + Math.cos(am) * R * 1.09, cy + Math.sin(am) * R * 1.09 + 5);
    }
    ring(0.094, '#1f7a45');
    ring(0.037, '#b3202a');
    for (const d of this.darts) {
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(cx + d.x * R, cy + d.y * R, 4, 0, Math.PI * 2);
      g.fill();
    }
    if (this.turn === 'you' && this.wait <= 0) {
      const w = this.wobble(), x = cx + (this.aim.x + w.x) * R, y = cy + (this.aim.y + w.y) * R;
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.moveTo(x - 14, y);
      g.lineTo(x + 14, y);
      g.moveTo(x, y - 14);
      g.lineTo(x, y + 14);
      g.stroke();
    }
    g.fillStyle = '#fff';
    g.font = 'bold 16px Inter, sans-serif';
    g.textAlign = 'left';
    g.fillText(`YOU ${this.you}`, 10, 22);
    g.textAlign = 'right';
    g.fillText(`EDDIE ${this.them}`, W - 10, 22);
    g.textAlign = 'center';
    g.fillText(`Round ${Math.min(3, this.round + 1)}/3 · ${this.turn === 'you' ? 'your throw' : "Eddie's throw"}`, W / 2, H - 6);
  }
}
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

class Invaders {
  constructor() {
    this.title = 'SOL INVADERS';
    this.help = '<kbd>A</kbd>/<kbd>D</kbd> move, <kbd>Space</kbd> fire';
    this.x = 0.5;
    this.shots = [];
    this.bombs = [];
    this.lives = 3;
    this.score = 0;
    this.wave = 0;
    this.cool = 0;
    this.spawn();
  }
  spawn() {
    this.wave++;
    this.aliens = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) this.aliens.push({ x: 0.14 + c * 0.09, y: 0.1 + r * 0.075, r });
    this.dir = 1;
    this.speed = 0.06 + this.wave * 0.025;
  }
  update(dt, input) {
    this.x = THREE.MathUtils.clamp(this.x + ((input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0)) * dt * 0.6, 0.04, 0.96);
    if ((this.cool -= dt) <= 0 && (input.down('Space') || input.pressed('Mouse0'))) {
      this.shots.push({ x: this.x, y: 0.88 });
      this.cool = 0.35;
    }
    for (const s of this.shots) s.y -= dt * 0.9;
    for (const b of this.bombs) b.y += dt * (0.35 + this.wave * 0.04);
    let edge = false;
    for (const a of this.aliens) {
      a.x += this.dir * this.speed * dt * (1 + (32 - this.aliens.length) * 0.05);
      if (a.x < 0.04 || a.x > 0.96) edge = true;
    }
    if (edge) {
      this.dir *= -1;
      for (const a of this.aliens) a.y += 0.035;
    }
    if (this.aliens.length && Math.random() < dt * (0.8 + this.wave * 0.3)) {
      const a = this.aliens[Math.floor(Math.random() * this.aliens.length)];
      this.bombs.push({ x: a.x, y: a.y });
    }
    for (const s of this.shots) for (const a of this.aliens) if (!a.dead && !s.dead && Math.abs(s.x - a.x) < 0.035 && Math.abs(s.y - a.y) < 0.03) {
      a.dead = s.dead = true;
      this.score += (4 - a.r) * 10;
    }
    for (const b of this.bombs) if (!b.dead && b.y > 0.86 && b.y < 0.94 && Math.abs(b.x - this.x) < 0.04) {
      b.dead = true;
      this.lives--;
    }
    this.aliens = this.aliens.filter((a) => !a.dead);
    this.shots = this.shots.filter((s) => !s.dead && s.y > 0);
    this.bombs = this.bombs.filter((b) => !b.dead && b.y < 1);
    if (!this.aliens.length) this.spawn();
    if (this.aliens.some((a) => a.y > 0.84)) this.lives = 0;
    return this.lives <= 0;
  }
  draw(g, W, H) {
    g.fillStyle = '#05060c';
    g.fillRect(0, 0, W, H);
    const cols = ['#ff4fa3', '#ffcf3f', '#41d6ff', '#7dff6a'];
    for (const a of this.aliens) {
      g.fillStyle = cols[a.r];
      const x = a.x * W, y = a.y * H;
      g.fillRect(x - 10, y - 6, 20, 12);
      g.fillRect(x - 13, y + 2, 4, 6);
      g.fillRect(x + 9, y + 2, 4, 6);
      g.fillStyle = '#05060c';
      g.fillRect(x - 6, y - 3, 3, 3);
      g.fillRect(x + 3, y - 3, 3, 3);
    }
    g.fillStyle = '#ffd23f';
    g.fillRect(this.x * W - 14, 0.9 * H, 28, 8);
    g.fillRect(this.x * W - 3, 0.9 * H - 7, 6, 8);
    g.fillStyle = '#fff';
    for (const s of this.shots) g.fillRect(s.x * W - 1, s.y * H, 2, 9);
    g.fillStyle = '#ff5a3a';
    for (const b of this.bombs) g.fillRect(b.x * W - 2, b.y * H, 4, 8);
    g.font = 'bold 15px monospace';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText(`SCORE ${this.score}`, 8, 18);
    g.textAlign = 'right';
    g.fillText('♥'.repeat(Math.max(0, this.lives)), W - 8, 18);
  }
}

class Snake {
  constructor() {
    this.title = 'NEON SNAKE';
    this.help = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to steer';
    this.cols = 24;
    this.rows = 16;
    this.body = [[8, 8], [7, 8], [6, 8]];
    this.dir = [1, 0];
    this.next = [1, 0];
    this.t = 0;
    this.score = 0;
    this.food = this.place();
  }
  place() {
    for (;;) {
      const f = [Math.floor(Math.random() * this.cols), Math.floor(Math.random() * this.rows)];
      if (!this.body.some(([x, y]) => x === f[0] && y === f[1])) return f;
    }
  }
  update(dt, input) {
    const turn = (d) => {
      if (d[0] !== -this.dir[0] || d[1] !== -this.dir[1]) this.next = d;
    };
    if (input.pressed('KeyW') || input.pressed('ArrowUp')) turn([0, -1]);
    if (input.pressed('KeyS') || input.pressed('ArrowDown')) turn([0, 1]);
    if (input.pressed('KeyA') || input.pressed('ArrowLeft')) turn([-1, 0]);
    if (input.pressed('KeyD') || input.pressed('ArrowRight')) turn([1, 0]);
    this.t += dt;
    const step = Math.max(0.055, 0.13 - this.score * 0.0004);
    while (this.t > step) {
      this.t -= step;
      this.dir = this.next;
      const h = [this.body[0][0] + this.dir[0], this.body[0][1] + this.dir[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] >= this.cols || h[1] >= this.rows || this.body.some(([x, y]) => x === h[0] && y === h[1])) return true;
      this.body.unshift(h);
      if (h[0] === this.food[0] && h[1] === this.food[1]) {
        this.score += 10;
        this.food = this.place();
      } else this.body.pop();
    }
    return false;
  }
  draw(g, W, H) {
    g.fillStyle = '#05060c';
    g.fillRect(0, 0, W, H);
    const cw = W / this.cols, ch = (H - 24) / this.rows;
    g.fillStyle = '#ff4fa3';
    g.fillRect(this.food[0] * cw + 3, 24 + this.food[1] * ch + 3, cw - 6, ch - 6);
    this.body.forEach(([x, y], i) => {
      g.fillStyle = i ? '#41d6ff' : '#b8f4ff';
      g.fillRect(x * cw + 1, 24 + y * ch + 1, cw - 2, ch - 2);
    });
    g.fillStyle = '#fff';
    g.font = 'bold 15px monospace';
    g.textAlign = 'left';
    g.fillText(`SCORE ${this.score}`, 8, 17);
  }
}

// ------------------------------------------------------------------ the venues' side of things
export class Fun {
  constructor({ player, hud, audio, peds, input }) {
    Object.assign(this, { player, hud, audio, peds, input });
    try {
      this.fit = { str: 0, sta: 0, ...JSON.parse(localStorage.getItem(FIT_KEY) || '{}') };
      this.hi = JSON.parse(localStorage.getItem(HI_KEY) || '{}');
    } catch {
      this.fit = { str: 0, sta: 0 };
      this.hi = {};
    }
    this.game = null;
    this.drunk = 0;
    this.crowd = [];
    const css = document.createElement('style');
    css.textContent = `
      #fun { position: fixed; right: 2vw; top: 50%; transform: translateY(-50%); max-width: 46vw; z-index: 7; display: none; background: rgba(10,12,18,.88);
        border: 2px solid #ffd23f; border-radius: 10px; padding: 10px 12px 8px; color: #fff; font: 14px Inter, sans-serif; text-align: center; }
      #fun.show { display: block; }
      #fun .f-title { font: 26px Anton, Impact, sans-serif; letter-spacing: 1px; color: #ffd23f; }
      #fun canvas { display: block; margin: 6px auto; background: #11141b; border-radius: 6px; width: 100%; max-width: 440px; }
      #fun .f-help { opacity: .85; } #fun kbd { background: #333; border-radius: 3px; padding: 0 4px; margin: 0 1px; }`;
    document.head.appendChild(css);
    this.el = document.createElement('div');
    this.el.id = 'fun';
    this.el.innerHTML = '<div class="f-title"></div><canvas width="440" height="300"></canvas><div class="f-help"></div>';
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.applyFit();
  }

  get active() {
    return !!this.game;
  }

  save() {
    try {
      localStorage.setItem(FIT_KEY, JSON.stringify(this.fit));
      localStorage.setItem(HI_KEY, JSON.stringify(this.hi));
    } catch {}
  }

  // strength: harder punches; stamina: a faster sprint
  get punch() {
    return 1 + this.fit.str / 100;
  }
  applyFit() {
    this.player.runBoost = 1 + 0.14 * (this.fit.sta / 100);
  }

  // ---------------------------------------------------------------- your look
  applyLook(look) {
    const model = this.player.model;
    let skin = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'Skin' && o.isSkinnedMesh) skin = o;
      if (o.material.name !== 'HairCards') return;
      const m = o.material;
      m.userData.base ??= m.map;
      const cut = HAIRCUTS.find((h) => h.id === look.hair);
      o.visible = look.hair !== 'bald';
      if (cut?.color) {
        m.userData.dyes ??= {};
        m.map = m.userData.dyes[cut.id] ??= dyed(m.userData.base, cut.color);
      } else m.map = m.userData.base;
      m.needsUpdate = true;
    });
    // tattoos: one patch of ink per design, made once and shown or hidden
    this.ink ??= {};
    for (const t of TATTOOS) {
      if (t.remove) continue;
      const want = (look.tattoos || []).includes(t.id);
      if (want && !this.ink[t.id] && skin) this.ink[t.id] = armPatch(skin, t.bone, tattooArt(t.id), t.wrap);
      if (this.ink[t.id]) this.ink[t.id].visible = want;
    }
  }

  // ---------------------------------------------------------------- the people in the venue
  enter(b) {
    if (b.type !== 'club' || !b.spec.floor) return;
    const f = b.spec.floor;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + Math.random() * 0.4, r = 1.3 + Math.random() * 1.6;
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      const p = this.peds.add(Math.random() < 0.5 ? 'female' : 'male', x, z, Math.atan2(f.x - x, f.z - z) + (Math.random() - 0.5));
      p.state = 'contact';
      p.pose = 'dance';
      p.keep = true;
      p.invulnerable = true;
      p.anim.actions.dance && (p.anim.actions.dance.timeScale = 0.9 + Math.random() * 0.25);
      this.crowd.push(p);
    }
  }
  leave() {
    for (const p of this.crowd) this.peds.remove(p);
    this.crowd = [];
    if (this.game) this.stop(true);
  }

  // ---------------------------------------------------------------- stations -> games
  // what the hint says when you step into a station's ring
  hint(st) {
    return {
      treadmill: 'Press <em>E</em> to run on the treadmill (stamina).',
      bench: 'Press <em>E</em> for the bench press (strength).',
      dance: 'Press <em>E</em> to hit the dance floor.',
      darts: 'Press <em>E</em> to play darts with Eddie: <em>$50</em> to play, <em>$150</em> if you win.',
      invaders: 'Press <em>E</em> to play SOL INVADERS ($1).',
      snake: 'Press <em>E</em> to play NEON SNAKE ($1).',
    }[st.kind];
  }

  start(st, b) {
    const P = this.player, cost = { darts: 50, invaders: 1, snake: 1 }[st.kind] || 0;
    if (cost && this.hud.money < cost) return this.hud.say("You can't afford that.", 2);
    if (cost) this.hud.addMoney(-cost);
    this.st = st;
    this.b = b;
    this.game = st.kind === 'treadmill' ? new Treadmill() : st.kind === 'bench' ? new Bench(this.fit.str / 160) : st.kind === 'dance' ? new Dance(this.audio)
      : st.kind === 'darts' ? new Darts() : st.kind === 'invaders' ? new Invaders() : new Snake();
    this.el.querySelector('.f-title').textContent = this.game.title;
    this.el.querySelector('.f-help').innerHTML = this.game.help + ' &nbsp;·&nbsp; <kbd>Backspace</kbd> quit';
    this.el.classList.add('show');
    // the hero takes his place
    P.vel.set(0, 0, 0);
    P.moveSpeed = P.speed = 0;
    P.position.set(st.x, st.y || 0, st.z);
    P.yaw = st.yaw;
    P.object.rotation.y = st.yaw;
    P.posed = { treadmill: 'run', bench: 'benchpress', dance: 'dance', darts: 'darts', invaders: 'arcade', snake: 'arcade' }[st.kind] || 'idle';
    if (!P.actions[P.posed]) P.posed = 'idle';
    P.showWeapon();
    if (P.posed === 'benchpress') P.actions.benchpress.timeScale = 0;
    if (P.posed === 'dance' && P.actions.dance) P.actions.dance.timeScale = P.actions.dance.getClip().duration / (4 * this.game.beat);
  }

  stop(quit) {
    const g = this.game, P = this.player, st = this.st;
    this.game = null;
    this.el.classList.remove('show');
    P.posed = null;
    P.speed = 0;
    P.showWeapon();
    if (st?.bar) st.bar.position.copy(st.barRest);
    if (P.actions.benchpress) P.actions.benchpress.timeScale = 1;
    // step off the machine
    if (st?.off) P.position.set(st.off.x, 0, st.off.z);
    if (quit || !g) return;
    const say = (m) => this.hud.say(m, 4);
    if (g instanceof Treadmill) {
      const gain = Math.round(8 * (g.inZone / g.T) * (1 - this.fit.sta / 130));
      this.fit.sta = Math.min(100, this.fit.sta + gain);
      say(`Workout done. Stamina <em>+${gain}</em> (${this.fit.sta}/100).`);
    } else if (g instanceof Bench) {
      const gain = Math.min(10, Math.round(g.reps * 0.8 * (1 - this.fit.str / 130)));
      this.fit.str = Math.min(100, this.fit.str + gain);
      say(`${g.reps} reps. Strength <em>+${gain}</em> (${this.fit.str}/100).`);
    } else if (g instanceof Dance) {
      const pay = Math.round(Math.min(1, g.accuracy) ** 2 * 300);
      if (pay > 0) {
        this.hud.addMoney(pay);
        this.audio.cash();
      }
      say(g.accuracy > 0.85 ? `The floor is yours! Tips: <em>$${pay}</em>.` : g.accuracy > 0.5 ? `Not bad. Tips: <em>$${pay}</em>.` : 'Maybe stick to the bar.');
    } else if (g instanceof Darts) {
      if (g.you > g.them) {
        this.hud.addMoney(150);
        this.audio.cash();
        say(`You beat Eddie ${g.you} to ${g.them}. <em>$150</em>.`);
      } else say(`Eddie wins, ${g.them} to ${g.you}.${g.you === g.them ? ' (a tie goes to the house)' : ''}`);
    } else {
      const key = g.title, best = this.hi[key] || 0;
      if (g.score > best) {
        this.hi[key] = g.score;
        const prize = g.score >= 300 ? 100 : 0;
        if (prize) {
          this.hud.addMoney(prize);
          this.audio.cash();
        }
        say(`New high score on ${key}: <em>${g.score}</em>!${prize ? ' The machine pays out <em>$100</em>.' : ''}`);
      } else say(`${key}: ${g.score}. High score ${best}.`);
    }
    this.applyFit();
    this.save();
  }

  // ---------------------------------------------------------------- per frame
  update(dt, input) {
    if (this.drunk > 0) this.drunk = Math.max(0, this.drunk - dt);
    const g = this.game;
    if (!g) return;
    if (input.pressed('Backspace') || this.player.dead) return this.stop(true);
    const done = g.update(dt, input);
    // (darts aims with the mouse: the camera doesn't get it)
    if (g instanceof Darts) input.consumeMouse();
    const P = this.player;
    if (g instanceof Treadmill) P.speed = 1.6 + g.pace * 4.2;
    if (g instanceof Bench && P.actions.benchpress) P.actions.benchpress.time = g.phase * P.actions.benchpress.getClip().duration;
    // the bar follows his hands
    if (this.st.bar) {
      this.handL ??= P.model.getObjectByName('handL');
      this.handR ??= P.model.getObjectByName('handR');
      P.model.updateMatrixWorld(true);
      const a = this.handL.getWorldPosition(new THREE.Vector3()), b = this.handR.getWorldPosition(new THREE.Vector3());
      // (the grip is in the palm, a little past the wrist)
      this.st.bar.position.copy(a.add(b).multiplyScalar(0.5));
      this.st.bar.position.y += 0.03;
    }
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.draw(this.g, this.canvas.width, this.canvas.height);
    if (done) this.stop(false);
  }
}
