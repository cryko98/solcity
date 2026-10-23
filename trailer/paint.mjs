// Game stills repainted as key art for the cover and the banner (Nano Banana Pro on fal.ai, FAL_KEY
// in the environment): node trailer/paint.mjs shot_hero shot_jump ...
//   captures/trailer/<name>.jpg -> captures/trailer/<name>_painted.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' };
const PROMPT = `Repaint this video game screenshot as polished, high-end open-world crime game key art, in the style of classic
GTA box-art panels: cinematic lighting, rich saturated colours (warm sunset oranges and pinks, deep blues and neon at night),
crisp detailed materials, realistic people and cars, depth and atmosphere. Keep the exact composition, camera angle and framing,
every character with their pose, build and clothes (the hero wears a black short-sleeved button shirt and blue jeans),
every vehicle with its colour and shape, the buildings and the street layout. Do not add or remove any people or objects.
No text, no logos, no captions, no watermark, no borders.`;
// what a still needs said outright
const EXTRA = {
  shot_chase: 'Nobody stands on or beside the cars: the black limousine is being driven at speed with the police cars right behind it, lights flashing.',
  shot_chaseRight: 'Nobody stands on or beside the cars: the black limousine is being driven at speed with the police cars right behind it, lights flashing.',
  shot_wreck: 'Nobody stands outside the red car: it is being driven along the pavement, smashing through the street furniture, a fire hydrant gushing water behind it.',
};

async function paint(name) {
  const src = path.join(ROOT, 'captures', 'trailer', `${name}.jpg`);
  const uri = `data:image/jpeg;base64,${fs.readFileSync(src).toString('base64')}`;
  const sub = await (await fetch('https://queue.fal.run/fal-ai/nano-banana-pro/edit', {
    method: 'POST', headers: H, body: JSON.stringify({ prompt: EXTRA[name] ? `${PROMPT}\n${EXTRA[name]}` : PROMPT, image_urls: [uri], resolution: '2K', output_format: 'jpeg', num_images: 1 }),
  })).json();
  if (!sub.status_url) throw new Error(`${name}: ${JSON.stringify(sub).slice(0, 300)}`);
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await (await fetch(sub.status_url, { headers: H })).json();
    if (s.status === 'COMPLETED') break;
    if (i > 200) throw new Error(`${name}: timed out`);
  }
  const r = await (await fetch(sub.response_url, { headers: H })).json();
  const url = r.images?.[0]?.url;
  if (!url) throw new Error(`${name}: ${JSON.stringify(r).slice(0, 300)}`);
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  const out = path.join(ROOT, 'captures', 'trailer', `${name}_painted.jpg`);
  fs.writeFileSync(out, bin);
  return `${name}: ${bin.length} bytes`;
}
const res = await Promise.allSettled(process.argv.slice(2).map(paint));
for (const r of res) console.log(r.status === 'fulfilled' ? r.value : `FAILED ${r.reason}`);
