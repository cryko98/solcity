// Procedural canvas textures for the city (no external image assets needed).
import * as THREE from 'three';

export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = rng(99);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function tex(w, h, draw, opts) {
  const c = canvas(w, h);
  draw(c.getContext('2d'), w, h);
  return toTexture(c, opts);
}

function grain(g, w, h, amt) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

export const asphalt = () =>
  tex(512, 512, (g, w, h) => {
    g.fillStyle = '#3a3b3e';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? '15,15,18' : '90,90,92'},${0.05 + R() * 0.06})`;
      g.beginPath();
      g.ellipse(R() * w, R() * h, 20 + R() * 70, 10 + R() * 40, R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, w, h, 30);
    g.strokeStyle = 'rgba(18,18,20,.45)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = R() * w, y = R() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        x += (R() - 0.5) * 30;
        y += (R() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });

export const sidewalk = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#aaa59c';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 18);
    g.fillStyle = 'rgba(70,65,60,.45)';
    for (let i = 0; i <= 2; i++) {
      g.fillRect(i * 128 - 1, 0, 2, h);
      g.fillRect(0, i * 128 - 1, w, 2);
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(40,35,30,${0.05 + R() * 0.07})`;
      g.beginPath();
      g.arc(R() * w, R() * h, 4 + R() * 14, 0, Math.PI * 2);
      g.fill();
    }
  });

export const grass = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#4e7a35';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(110,150,60,.5)' : 'rgba(40,70,30,.5)';
      g.fillRect(R() * w, R() * h, 1.5, 3 + R() * 3);
    }
  });

export const roof = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#5f6062';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 40);
  });

// Facade: 4 bays x 4 floors per tile (16m x 14m). Returns colour + emissive (lit windows) maps.
export function facade({ wall, frame = '#ece6da', glass = false, brick = false, litChance = 0.28, seed = 1 }) {
  const rand = rng(seed);
  const S = 256, T = 64;
  const em = canvas(S, S);
  const eg = em.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S, S);
  const map = tex(S, S, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    if (brick) {
      g.strokeStyle = 'rgba(30,15,10,.25)';
      g.lineWidth = 1;
      for (let y = 0, row = 0; y < S; y += 6, row++) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
        for (let x = (row % 2) * 8; x < S; x += 16) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 6);
          g.stroke();
        }
      }
    }
    grain(g, S, S, glass ? 10 : 22);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = c * T, y = r * T;
        const [wx, wy, ww, wh] = glass ? [x + 3, y + 3, T - 6, T - 12] : [x + 14, y + 12, T - 28, T - 26];
        g.fillStyle = frame;
        g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        const grad = g.createLinearGradient(0, wy, 0, wy + wh);
        grad.addColorStop(0, glass ? '#9cbcd6' : '#b3c6d4');
        grad.addColorStop(0.55, glass ? '#3f6584' : '#4a5d6e');
        grad.addColorStop(1, '#25303a');
        g.fillStyle = grad;
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,.10)';
        g.beginPath();
        g.moveTo(wx, wy + wh * 0.7);
        g.lineTo(wx + ww * 0.6, wy);
        g.lineTo(wx + ww * 0.85, wy);
        g.lineTo(wx, wy + wh);
        g.fill();
        if (rand() < 0.3) {
          g.fillStyle = 'rgba(232,226,210,.8)';
          g.fillRect(wx, wy, ww, wh * (0.2 + rand() * 0.5));
        }
        g.fillStyle = frame;
        g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        if (rand() < litChance) {
          eg.globalAlpha = 0.55 + rand() * 0.45;
          eg.fillStyle = rand() < 0.6 ? '#ffc970' : '#ffe8b5';
          eg.fillRect(wx, wy, ww, wh);
        }
        if (!glass) {
          g.fillStyle = 'rgba(0,0,0,.28)';
          g.fillRect(wx - 3, wy + wh + 2, ww + 6, 3);
        }
      }
      if (glass) {
        g.fillStyle = 'rgba(20,28,36,.65)';
        g.fillRect(0, r * T + T - 8, S, 8);
      }
    }
  });
  return { map, emissive: toTexture(em) };
}

// Ground floor shop window strip: one tile = 8m x 3.6m
export function shopfront(seed) {
  const rand = rng(seed);
  const W = 256, H = 116;
  const frames = ['#2b2d31', '#6b1f1f', '#1f3b5c', '#e8e2d4', '#2d5a3c'];
  const frame = frames[Math.floor(rand() * frames.length)];
  const em = canvas(W, H);
  const eg = em.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  const map = tex(W, H, (g) => {
    g.fillStyle = frame;
    g.fillRect(0, 0, W, H);
    const panes = [[8, 10, 100, 86], [150, 10, 98, 86]];
    for (const [x, y, w, h] of panes) {
      const grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#93a9b8');
      grad.addColorStop(0.5, '#3b4a55');
      grad.addColorStop(1, '#1d2328');
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(x + w * 0.15, y, 10, h);
      g.fillStyle = 'rgba(255,220,150,.18)';
      for (let i = 0; i < 4; i++) g.fillRect(x + 6 + rand() * (w - 30), y + 40 + rand() * 30, 10 + rand() * 18, 12 + rand() * 16);
      eg.fillStyle = 'rgba(255,205,130,.55)';
      eg.fillRect(x, y, w, h);
    }
    // door
    g.fillStyle = '#1a1d20';
    g.fillRect(114, 18, 30, 98);
    g.fillStyle = '#566673';
    g.fillRect(118, 22, 22, 60);
    g.fillStyle = '#c9b16a';
    g.fillRect(136, 64, 3, 10);
    eg.fillStyle = 'rgba(255,205,130,.5)';
    eg.fillRect(118, 22, 22, 60);
    // kick plate
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, 98, W, 18);
  });
  return { map, emissive: toTexture(em) };
}

export function sign(text, color) {
  return tex(
    256,
    64,
    (g, w, h) => {
      g.fillStyle = '#141418';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.shadowColor = color;
      g.shadowBlur = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.font = '38px Anton, Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = color;
      g.shadowBlur = 14;
      const tw = g.measureText(text).width;
      const sx = Math.min(1, (w - 30) / tw);
      g.save();
      g.translate(w / 2, h / 2 + 2);
      g.scale(sx, 1);
      g.fillText(text, 0, 0);
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.shadowBlur = 0;
      g.fillText(text, 0, 0);
      g.restore();
    },
    { repeat: false }
  );
}

export const awning = (a, b) =>
  tex(64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect(i * 8, 0, 8, h);
    }
    grain(g, w, h, 12);
  });

export const frond = () =>
  tex(
    64,
    256,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let y = 10; y < h - 4; y += 5) {
        const t = y / h;
        const len = (w / 2 - 3) * Math.min(1, Math.sin(Math.PI * (1 - t) * 0.95 + 0.1) * 1.15);
        g.strokeStyle = R() < 0.5 ? '#3f6b25' : '#5a8a32';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(w / 2, y + 6);
        g.lineTo(w / 2 - len, y - 6);
        g.moveTo(w / 2, y + 6);
        g.lineTo(w / 2 + len, y - 6);
        g.stroke();
      }
      g.strokeStyle = '#6e7f34';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(w / 2, h);
      g.lineTo(w / 2, 0);
      g.stroke();
    },
    { repeat: false }
  );

export const bark = () =>
  tex(64, 256, (g, w, h) => {
    g.fillStyle = '#7d6247';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 9) {
      g.fillStyle = 'rgba(40,28,18,.45)';
      g.fillRect(0, y, w, 2);
    }
    grain(g, w, h, 30);
  });

// ------------------------------------------------------------------ district textures
export const sand = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9c49a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? '160,130,90' : '245,232,200'},${0.08 + R() * 0.1})`;
      g.beginPath();
      g.ellipse(R() * w, R() * h, 10 + R() * 40, 4 + R() * 12, R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, w, h, 34);
  });

export const concrete = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a9894';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(40,38,34,${0.04 + R() * 0.08})`;
      g.beginPath();
      g.ellipse(R() * w, R() * h, 15 + R() * 50, 8 + R() * 30, R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, w, h, 26);
    g.fillStyle = 'rgba(50,48,44,.5)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
  });

// tiling normal map of small crossing waves
export function waterNormal() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const waves = Array.from({ length: 7 }, () => [Math.floor(1 + R() * 5), Math.floor(1 + R() * 5) * (R() < 0.5 ? -1 : 1), R() * 6.28, 0.3 + R() * 0.7]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, ph, a] of waves) {
        const t = ((x * kx + y * ky) / S) * Math.PI * 2 + ph;
        dx += Math.cos(t) * kx * a;
        dy += Math.cos(t) * ky * a;
      }
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 9;
      img.data[i + 1] = 128 + dy * 9;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// shipping container side: vertical corrugation, near-white so instance colours tint it
export const corrugated = () =>
  tex(256, 256, (g, w, h) => {
    g.fillStyle = '#e8e8e6';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.18)');
      gr.addColorStop(0.5, 'rgba(255,255,255,.12)');
      gr.addColorStop(1, 'rgba(0,0,0,.18)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 16, h);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(110,60,30,${0.05 + R() * 0.12})`;
      g.fillRect(R() * w, R() * h, 2 + R() * 10, 10 + R() * 60);
    }
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 6, w, 6);
    grain(g, w, h, 14);
  });

export const rollerDoor = () =>
  tex(128, 128, (g, w, h) => {
    g.fillStyle = '#8d9094';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) {
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(0, y, w, 1);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(0, y + 1, w, 1);
    }
    grain(g, w, h, 22);
    g.fillStyle = 'rgba(60,40,20,.25)';
    g.fillRect(0, h - 14, w, 14);
  });

// warehouse wall: brick or ribbed metal, high clerestory windows (tile = 16m x 14m)
export function warehouse({ wall, metal = false, seed = 1 }) {
  const rand = rng(seed);
  const S = 256;
  const em = canvas(S, S);
  const eg = em.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S, S);
  const map = tex(S, S, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    if (metal) {
      for (let x = 0; x < S; x += 8) {
        g.fillStyle = 'rgba(0,0,0,.16)';
        g.fillRect(x, 0, 2, S);
        g.fillStyle = 'rgba(255,255,255,.1)';
        g.fillRect(x + 3, 0, 1, S);
      }
    } else {
      g.strokeStyle = 'rgba(30,15,10,.28)';
      for (let y = 0, row = 0; y < S; y += 6, row++) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
        for (let x = (row % 2) * 8; x < S; x += 16) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + 6);
          g.stroke();
        }
      }
    }
    grain(g, S, S, 26);
    // grime streaks
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(20,18,15,${0.05 + rand() * 0.1})`;
      g.fillRect(rand() * S, 0, 4 + rand() * 10, S * (0.3 + rand() * 0.7));
    }
    // clerestory window band (~6.5-7.5 m)
    for (let c = 0; c < 4; c++) {
      const x = c * 64 + 8, y = 108;
      g.fillStyle = '#2b2f33';
      g.fillRect(x - 2, y - 2, 52, 22);
      const gr = g.createLinearGradient(0, y, 0, y + 18);
      gr.addColorStop(0, '#9fb3c0');
      gr.addColorStop(1, '#3a4652');
      g.fillStyle = gr;
      g.fillRect(x, y, 48, 18);
      for (let k = 1; k < 4; k++) {
        g.fillStyle = '#2b2f33';
        g.fillRect(x + k * 12, y, 2, 18);
      }
      if (rand() < 0.3) {
        eg.fillStyle = 'rgba(255,220,160,.7)';
        eg.fillRect(x, y, 48, 18);
      }
    }
  });
  return { map, emissive: toTexture(em) };
}

// villa facade: 2 bays x 2 floors per tile (8m x 7m), tall windows with shutters
export function villa({ wall, shutter, seed = 1 }) {
  const rand = rng(seed);
  const S = 256;
  const em = canvas(S, S);
  const eg = em.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S, S);
  const map = tex(S, S, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    grain(g, S, S, 12);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const x = c * 128 + 34, y = r * 128 + 22, ww = 60, wh = 84;
        g.fillStyle = 'rgba(0,0,0,.15)';
        g.fillRect(x - 6, y - 6, ww + 12, wh + 14);
        g.fillStyle = '#f4f1ea';
        g.fillRect(x - 4, y - 4, ww + 8, wh + 8);
        const gr = g.createLinearGradient(0, y, 0, y + wh);
        gr.addColorStop(0, '#a9c4d6');
        gr.addColorStop(0.6, '#4b6274');
        gr.addColorStop(1, '#27323b');
        g.fillStyle = gr;
        g.fillRect(x, y, ww, wh);
        g.fillStyle = '#f4f1ea';
        g.fillRect(x + ww / 2 - 2, y, 4, wh);
        g.fillRect(x, y + wh * 0.38, ww, 3);
        g.fillStyle = shutter;
        g.fillRect(x - 22, y - 2, 16, wh + 4);
        g.fillRect(x + ww + 6, y - 2, 16, wh + 4);
        g.fillStyle = 'rgba(0,0,0,.2)';
        for (let k = 0; k < wh; k += 6) {
          g.fillRect(x - 22, y + k, 16, 1);
          g.fillRect(x + ww + 6, y + k, 16, 1);
        }
        if (rand() < 0.35) {
          eg.fillStyle = rand() < 0.5 ? '#ffcf86' : '#ffe9c0';
          eg.globalAlpha = 0.7;
          eg.fillRect(x, y, ww, wh);
        }
      }
    }
  });
  return { map, emissive: toTexture(em) };
}
