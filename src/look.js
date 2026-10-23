// The hero's look on his Rocketbox body (src/rbhero.js): the clothes shop's colours, the barber's
// cuts and dyes and the tattoo parlour's ink, painted into his own copies of the avatar's two
// textures. Where each thing lies on them is Male_Adult_11's layout (fractions of the texture).
import * as THREE from 'three';
import { HAIRCUTS, TATTOOS, tattooArt } from './fun.js';

// body texture: the jeans in the top corners, the shirt down the middle and the sleeves either side
// of it; the arms' skin under the sleeves (left half: the right arm, its outside at x 0.15)
const inJeans = (x, y) => y < 0.445 && (x < 0.31 || x > 0.7);
const inShirt = (x, y) => (x > 0.355 && x < 0.645 && y < 0.985) || (y > 0.43 && y < 0.6 && (x < 0.31 || x > 0.69));
// where the ink goes: [centre x, centre y, width] (the height follows the art; across the arm the
// texture stretches about 1.45 times less than along it)
const INK = { tribal: [0.15, 0.658, 0.3], skull: [0.85, 0.65, 0.12], script: [0.15, 0.75, 0.17], star: [0.85, 0.755, 0.09] };
// head texture: the hair is the dark crown above the face, ears and brows left out
const inScalp = (x, y) => y < 0.56 && !(x > 0.36 && x < 0.64 && y > 0.2) && !(y > 0.28 && y < 0.44 && ((x > 0.19 && x < 0.3) || (x > 0.7 && x < 0.81)));

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class Look {
  constructor(model) {
    model.traverse((o) => {
      if (!o.isMesh || !o.material.map) return;
      if (/_body$/.test(o.material.name)) this.body = own(o);
      if (/_head$/.test(o.material.name)) this.head = own(o);
    });
    if (!this.body || !this.head) return;
    // the masks, once: how much of each texel is shirt, jeans, hair (0..1)
    this.body.shirt = mask(this.body, inShirt, (r, g, b, l, s) => clamp01((0.5 - l) / 0.12) * clamp01((0.45 - s) / 0.1) * clamp01((l - 0.025) / 0.03));
    this.body.jeans = mask(this.body, inJeans, (r, g, b, l) => clamp01((l - 0.03) / 0.03));
    this.head.hair = mask(this.head, inScalp, (r, g, b, l) => clamp01((0.6 - l) / 0.14) * clamp01((l - 0.04) / 0.04));
    // the bare scalp under a shave: the forehead's colour
    this.scalp = average(this.head, 0.42, 0.17, 0.58, 0.21);
  }

  apply(look) {
    if (!this.body || !this.head) return;
    const key = JSON.stringify([look.shirt, look.jeans, look.hair, look.tattoos]);
    if (key === this.key) return;
    this.key = key;

    // the body: the clothes' colours, then the ink on top
    const b = this.body, px = new Uint8ClampedArray(b.base);
    if (look.shirt) tint(px, b.shirt, look.shirt, 0.25);
    if (look.jeans && look.jeans !== '#ffffff') tint(px, b.jeans, look.jeans, 0.35);
    const g = b.ctx;
    g.putImageData(new ImageData(px, b.w, b.h), 0, 0);
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.85;
    for (const id of look.tattoos || []) {
      const at = INK[id], art = TATTOOS.some((t) => t.id === id) && at && tattooArt(id).image;
      if (!art) continue;
      const w = at[2] * b.w, h = (w * art.height * 0.69) / art.width;
      g.drawImage(art, at[0] * b.w - w / 2, at[1] * b.h - h / 2, w, h);
    }
    g.restore();
    show(b);

    // the head: the cut (a shave leaves bare scalp) and the dye
    const hd = this.head, hp = new Uint8ClampedArray(hd.base);
    const cut = HAIRCUTS.find((c) => c.id === look.hair);
    if (look.hair === 'bald') shave(hp, hd.hair, this.scalp);
    else if (cut?.color) tint(hp, hd.hair, cut.color, 0.3);
    hd.ctx.putImageData(new ImageData(hp, hd.w, hd.h), 0, 0);
    show(hd);
  }
}

// the mesh gets its own material and a canvas to paint its texture on (the avatar's scene is also
// what the other players in multiplayer are cloned from: theirs keep the plain look)
function own(mesh) {
  const mat = (mesh.material = mesh.material.clone()), src = mat.map, img = src.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  for (const k of ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'anisotropy', 'channel']) tex[k] = src[k];
  return { mat, src, tex, ctx, w: c.width, h: c.height, base: ctx.getImageData(0, 0, c.width, c.height).data };
}

function show(t) {
  t.tex.needsUpdate = true;
  if (t.mat.map !== t.tex) {
    t.mat.map = t.tex;
    t.mat.needsUpdate = true;
  }
}

// weight per texel: where(x, y) on the texture and test(r, g, b, lightness, saturation), all 0..1
function mask(t, where, test) {
  const m = new Float32Array(t.w * t.h), px = t.base;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      if (!where(x / t.w, y / t.h)) continue;
      const i = (y * t.w + x) * 4, r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      m[y * t.w + x] = test(r, g, b, (r + g + b) / 3, hi > 0 ? (hi - lo) / hi : 0);
    }
  }
  return m;
}

function average(t, x0, y0, x1, y1) {
  const s = [0, 0, 0];
  let n = 0;
  for (let y = Math.floor(y0 * t.h); y < y1 * t.h; y++) {
    for (let x = Math.floor(x0 * t.w); x < x1 * t.w; x++, n++) for (let k = 0; k < 3; k++) s[k] += t.base[(y * t.w + x) * 4 + k];
  }
  return s.map((v) => v / n);
}

// recolour under a mask keeping the folds and the weave: each texel's lightness against the masked
// area's average scales the new colour (floor: how much of it stays in the deepest shadow)
function tint(px, m, color, floor) {
  const c = new THREE.Color(color).convertLinearToSRGB(), to = [c.r * 255, c.g * 255, c.b * 255];
  let sum = 0, wsum = 0;
  for (let j = 0; j < m.length; j++) {
    if (m[j] <= 0) continue;
    sum += m[j] * (px[j * 4] + px[j * 4 + 1] + px[j * 4 + 2]);
    wsum += m[j];
  }
  const avg = sum / (wsum || 1);
  for (let j = 0; j < m.length; j++) {
    const w = m[j];
    if (w <= 0) continue;
    const i = j * 4, k = floor + (1 - floor) * ((px[i] + px[i + 1] + px[i + 2]) / avg);
    for (let ch = 0; ch < 3; ch++) px[i + ch] += (to[ch] * k - px[i + ch]) * w;
  }
}

// a clean shave: bare scalp, a shadow of stubble where the hair was darkest
function shave(px, m, skin) {
  for (let j = 0; j < m.length; j++) {
    const w = m[j];
    if (w <= 0) continue;
    const i = j * 4, l = (px[i] + px[i + 1] + px[i + 2]) / 765, k = 0.86 + 0.14 * clamp01(l / 0.35);
    for (let ch = 0; ch < 3; ch++) px[i + ch] += (skin[ch] * k - px[i + ch]) * w;
  }
}
