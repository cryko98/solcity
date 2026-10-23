// The trailer's sound, generated with ElevenLabs through fal.ai (FAL_KEY in the environment):
//   node trailer/gen.mjs voice [ids...]   the narrator's lines (script.json) -> trailer/voice/<id>.mp3
//   node trailer/gen.mjs music            the score, laid out on script.json's sections -> trailer/music/score.mp3
//   node trailer/gen.mjs sfx [names...]   the sound effects (sfx.json) -> trailer/sfx/<name>.mp3
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(fs.readFileSync(path.join(DIR, 'script.json'), 'utf8'));
const KEY = process.env.FAL_KEY;
if (!KEY) throw new Error('set FAL_KEY');
const H = { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' };

async function fal(endpoint, input, out) {
  const sub = await fetch(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers: H, body: JSON.stringify(input) });
  const job = await sub.json();
  if (!sub.ok) throw new Error(`${endpoint} ${sub.status}: ${JSON.stringify(job).slice(0, 300)}`);
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 4000));
    const s = await (await fetch(job.status_url, { headers: H })).json();
    if (s.status === 'COMPLETED') break;
    if (i > 300) throw new Error('timed out');
  }
  const res = await fetch(job.response_url, { headers: H });
  const body = await res.json();
  if (!res.ok || !body.audio) throw new Error(`${endpoint}: ${JSON.stringify(body).slice(0, 300)}`);
  const bin = Buffer.from(await (await fetch(body.audio.url)).arrayBuffer());
  fs.writeFileSync(out, bin);
  console.log('saved', path.relative(DIR, out), bin.length);
}

const [what, ...only] = process.argv.slice(2);
const pick = (id) => !only.length || only.includes(id);
const BAR_MS = (4 * 60000) / script.bpm;

if (what === 'voice') {
  const lines = script.sections.flatMap((s) => s.lines).filter((l) => pick(l.id));
  await Promise.all(lines.map((l) => fal('fal-ai/elevenlabs/tts/eleven-v3', { text: l.text, voice: script.voice, stability: 0.5 }, path.join(DIR, 'voice', `${l.id}.mp3`))));
} else if (what === 'music') {
  const plan = {
    positive_global_styles: ['instrumental', '90s west coast G-funk hip hop', `${script.bpm} BPM`, '4/4', 'cinematic video game trailer', 'deep bass', 'whiny portamento synth lead', 'punchy drums'],
    negative_global_styles: ['vocals', 'singing', 'rap vocals', 'lyrics', 'tempo changes', 'EDM', 'dubstep'],
    sections: script.sections.map((s) => ({ section_name: s.name, positive_local_styles: [s.music], negative_local_styles: [], duration_ms: Math.round(s.bars * BAR_MS), lines: [] })),
  };
  await fal('fal-ai/elevenlabs/music', { composition_plan: plan, respect_sections_durations: true, output_format: 'mp3_44100_192' }, path.join(DIR, 'music', 'score.mp3'));
} else if (what === 'sfx') {
  const sfx = JSON.parse(fs.readFileSync(path.join(DIR, 'sfx.json'), 'utf8'));
  await Promise.all(Object.entries(sfx).filter(([n]) => pick(n)).map(([n, s]) => fal('fal-ai/elevenlabs/sound-effects/v2', { text: s.text, duration_seconds: s.secs, prompt_influence: 0.6 }, path.join(DIR, 'sfx', `${n}.mp3`))));
} else console.log('voice | music | sfx');
