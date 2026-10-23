// The trailer's soundtrack: the score cut down to the picture, the narrator over it (the music
// ducks under him), the effects on their beats, a limiter on the lot.
//   node trailer/mix.mjs   (after trailer/towav.py; the cues come from the recorder, ?hype3)
// -> trailer/build/hype3_mix.wav, 44.1 kHz stereo, as long as the picture
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(DIR, 'build');
const SR = 44100;
const sheet = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'captures', 'trailer', 'hype3_cues.json'), 'utf8'));
const LEN = Math.round(sheet.seconds * SR);
const BEAT = (sheet.beat / sheet.fps) * SR; // samples a beat (90 BPM)

function readWav(file) {
  const b = fs.readFileSync(path.join(BUILD, file));
  let i = 12;
  while (i < b.length) {
    const id = b.toString('ascii', i, i + 4), len = b.readUInt32LE(i + 4);
    if (id === 'data') {
      const n = len / 4, L = new Float32Array(n), R = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        L[k] = b.readInt16LE(i + 8 + k * 4) / 32768;
        R[k] = b.readInt16LE(i + 10 + k * 4) / 32768;
      }
      return [L, R];
    }
    i += 8 + len;
  }
  throw new Error(`no data in ${file}`);
}
const track = () => [new Float32Array(LEN), new Float32Array(LEN)];
// add src[from..to) into dst at sample `at`, times gain (gain may be a function of the output sample)
function add(dst, src, at, gain = 1, from = 0, to = src[0].length) {
  for (let c = 0; c < 2; c++) {
    const d = dst[c], s = src[c];
    for (let k = from; k < to; k++) {
      const o = at + k - from;
      if (o < 0) continue;
      if (o >= LEN) break;
      d[o] += s[k] * (typeof gain === 'function' ? gain(o) : gain);
    }
  }
}

// ------------------------------------------------------------------ the score, cut to 33 bars
// (its bars as generated: the build-up 1-9, the drop on 10, the tense stretch 26-31, the fade 42-44;
// the first beat 30 ms in) kept: the build-up from bar 4 to the end of the action, the tense
// stretch, the groove, the fade-out
const BAR = 4 * BEAT, OFF = Math.round(0.03 * SR);
const KEEP = [[4, 21], [26, 29], [32, 39], [42, 44]];
const score = readWav('music_score.wav');
const music = track();
{
  let at = 0;
  const X = Math.round(0.015 * SR); // a short crossfade at each join
  for (const [a, b] of KEEP) {
    const from = OFF + Math.round((a - 1) * BAR), to = Math.min(score[0].length, OFF + Math.round(b * BAR) + X);
    const n = to - from;
    add(music, score, at, (o) => Math.min(1, (o - at) / X, (at + n - o) / X), from, to);
    at += Math.round((b - a + 1) * BAR);
  }
}
// in from silence over the first bar
for (let k = 0; k < Math.min(LEN, BAR); k++) for (const c of music) c[k] *= k / BAR;
// the breakdown (beats 110-120): the music low-passed, opening up again into the logo
{
  const a = Math.round(110 * BEAT), b = Math.round(120 * BEAT);
  for (const c of music) {
    let y1 = 0, y2 = 0;
    for (let k = a; k < b; k++) {
      const t = (k - a) / (b - a), fc = 380 * Math.pow(3000 / 380, t * t);
      const al = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      y1 += (c[k] - y1) * al;
      y2 += (y1 - y2) * al; // (two poles: 12 dB an octave)
      c[k] = y2 * (0.8 + 0.2 * t);
    }
  }
}

// ------------------------------------------------------------------ the narrator
const voice = track();
for (const q of sheet.cues.filter((c) => c.kind === 'voice')) {
  const src = readWav(`voice_${q.name}.wav`);
  const from = q.from ? Math.round(q.from * SR) : 0, to = q.to ? Math.min(src[0].length, Math.round(q.to * SR)) : src[0].length;
  // each piece faded at its cut ends so nothing clicks
  const F = Math.round(0.01 * SR), at = Math.round(q.t * SR), n = to - from;
  add(voice, src, at, (o) => 2.2 * q.gain * Math.min(1, (o - at + 1) / F, (at + n - o) / F), from, to);
}
// the music ducks under him (the effects a little): an envelope of his voice, quick down, slow back up
const env = new Float32Array(LEN);
{
  let e = 0;
  const att = 1 - Math.exp(-1 / (0.03 * SR)), rel = 1 - Math.exp(-1 / (0.9 * SR));
  for (let k = 0; k < LEN; k++) {
    const x = Math.max(Math.abs(voice[0][k]), Math.abs(voice[1][k])) > 0.02 ? 1 : 0;
    e += (x - e) * (x > e ? att : rel);
    env[k] = e;
  }
  for (const c of music) for (let k = 0; k < LEN; k++) c[k] *= 1 - 0.8 * env[k];
}

// ------------------------------------------------------------------ the effects
const sfx = track();
const cache = {};
for (const q of sheet.cues.filter((c) => c.kind === 'sfx')) {
  const src = (cache[q.name] ??= readWav(`sfx_${q.name}.wav`));
  add(sfx, src, Math.round(q.t * SR), 0.75 * q.gain);
}
for (const c of sfx) for (let k = 0; k < LEN; k++) c[k] *= 1 - 0.5 * env[k];

// (how clearly each line stands over the rest: printed with TRAILER_SNR=1)
if (process.env.TRAILER_SNR) {
  const rms = (tr, a, b) => { let e = 0; for (let k = a; k < b; k++) e += tr[0][k] ** 2 + tr[1][k] ** 2; return Math.sqrt(e / (2 * (b - a))); };
  for (const q of sheet.cues.filter((c) => c.kind === 'voice')) {
    const a = Math.round(q.t * SR), b = Math.min(LEN, a + Math.round(((q.to ?? 3) - (q.from ?? 0)) * SR));
    const v = rms(voice, a, b), m = 0.85 * rms(music, a, b), x = rms(sfx, a, b);
    console.log(q.name, q.t.toFixed(1).padStart(5), 'voice', (20 * Math.log10(v)).toFixed(0), 'music', (20 * Math.log10(m)).toFixed(0), 'sfx', (20 * Math.log10(x + 1e-9)).toFixed(0));
  }
}
// ------------------------------------------------------------------ the master: summed, limited
const mix = track();
for (const c of [0, 1]) for (let k = 0; k < LEN; k++) mix[c][k] = 0.8 * music[c][k] + voice[c][k] + sfx[c][k];
// a look-ahead peak limiter (5 ms ahead, 120 ms release) to -1 dBFS
{
  const ceil = 0.89, ahead = Math.round(0.005 * SR), rel = 1 - Math.exp(-1 / (0.12 * SR));
  const need = new Float32Array(LEN);
  for (let k = 0; k < LEN; k++) {
    const p = Math.max(Math.abs(mix[0][k]), Math.abs(mix[1][k]));
    need[k] = p > ceil ? ceil / p : 1;
  }
  // the lowest gain needed in the next few ms, then released slowly
  let g = 1;
  const out = new Float32Array(LEN);
  for (let k = LEN - 1; k >= 0; k--) out[k] = Math.min(need[k], k + 1 < LEN ? out[k + 1] + (1 - out[k + 1]) * (1 / ahead) : 1);
  for (let k = 0; k < LEN; k++) {
    g = out[k] < g ? out[k] : g + (out[k] - g) * rel;
    mix[0][k] *= g;
    mix[1][k] *= g;
  }
}
// the very end fades to nothing with the picture
for (let k = Math.max(0, LEN - SR); k < LEN; k++) for (const c of mix) c[k] *= (LEN - k) / SR;

const outFile = path.join(BUILD, 'hype3_mix.wav');
const b = Buffer.alloc(44 + LEN * 4);
b.write('RIFF', 0);
b.writeUInt32LE(36 + LEN * 4, 4);
b.write('WAVEfmt ', 8);
b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20);
b.writeUInt16LE(2, 22);
b.writeUInt32LE(SR, 24);
b.writeUInt32LE(SR * 4, 28);
b.writeUInt16LE(4, 32);
b.writeUInt16LE(16, 34);
b.write('data', 36);
b.writeUInt32LE(LEN * 4, 40);
let peak = 0;
for (let k = 0; k < LEN; k++) {
  for (let c = 0; c < 2; c++) {
    const v = Math.max(-1, Math.min(1, mix[c][k]));
    peak = Math.max(peak, Math.abs(v));
    b.writeInt16LE(Math.round(v * 32767), 44 + k * 4 + c * 2);
  }
}
fs.writeFileSync(outFile, b);
console.log('mixed', path.relative(path.join(DIR, '..'), outFile), (LEN / SR).toFixed(2), 's, peak', peak.toFixed(3), ',', sheet.cues.length, 'cues');
