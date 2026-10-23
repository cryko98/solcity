// Sol City server: serves the game and the DaCity reward API.
//   node server/index.mjs        (Node 22.13+; see server/README.md)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, checkConfig } from './config.mjs';
import { makeNonce, useNonce, verifySignature, issueSession, readSession, isWallet, ipWalletsToday, recordLogin, walletSeenFromIpToday, checkTurnstile } from './auth.mjs';
import { startRun, finishRun, walletSummary, eligibility } from './rewards.mjs';
import { startPayouts } from './payout.mjs';
import { createLobby } from './lobby.mjs';
import { getProfile, setUsername } from './profile.mjs';
import { STORY, RACES } from '../src/shared/world.mjs';

const problems = checkConfig();
if (problems.length) {
  console.error('Configuration problems:\n - ' + problems.join('\n - '));
  process.exit(1);
}

// ------------------------------------------------------------------ static files (allow-list)
// only the game itself is served: never server/ (secrets, database), the git history, sources
const PUBLIC = ['/index.html', '/src/', '/assets/', '/SolCity_Trailer.mp4'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY', // nobody can frame the game to trick a wallet signature
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function serveStatic(req, res, url) {
  // url is already decoded: refuse anything that could step out of the allowed folders
  // (/src/../server/.env, encoded as %2e%2e, backslashes on Windows, NUL bytes)
  const BACKSLASH = String.fromCharCode(92), NUL = String.fromCharCode(0);
  if (url.split('/').some((seg) => seg === '..' || seg === '.') || url.includes(BACKSLASH) || url.includes(NUL)) return send(res, 404, 'Not found');
  const rel = path.posix.normalize(url === '/' ? '/index.html' : url);
  if (!PUBLIC.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))) return send(res, 404, 'Not found');
  const file = path.join(config.gameRoot, rel);
  const inside = path.relative(config.gameRoot, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const stream = fs.createReadStream(file);
    stream.on('error', () => (res.headersSent ? res.destroy() : send(res, 404, 'Not found')));
    stream.once('open', () => {
      res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      stream.pipe(res);
    });
  });
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ rate limits (per IP, in memory)
const buckets = new Map();
function limited(ip, key, perMinute) {
  const k = ip + '|' + key, now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.t > 60000) b = { t: now, n: 0 };
  b.n++;
  buckets.set(k, b);
  return b.n > perMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k);
}, 60000).unref();

// behind a proxy: the LAST X-Forwarded-For entry is the one our proxy added (earlier ones come
// from the client and can be anything)
const clientIp = (req) => {
  if (config.trustProxy && req.headers['x-forwarded-for']) {
    const list = String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list[list.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || '?';
};
const authed = (req) => readSession((req.headers.authorization || '').replace(/^Bearer /, ''));

// ------------------------------------------------------------------ API
// the lobby where players gather before a game and then play in the same city (see lobby.mjs):
// only a signed-in wallet that holds the token, under its account's username
const lobby = createLobby({
  authorize: async (req) => {
    const wallet = authed(req);
    if (!wallet) return { status: 401, error: 'Connect your wallet to play multiplayer.' };
    const e = await eligibility(wallet);
    if (!e.eligible) return { status: 403, error: `Multiplayer is for holders of at least ${config.minHolding.toLocaleString('en-US')} $${config.holdTicker}.` };
    const prof = getProfile(wallet);
    if (!prof) return { status: 403, error: 'Choose a username first.' };
    return { wallet, name: prof.username };
  },
});
// what the game shows of a wallet: rewards, whether it holds enough, its username
const me = async (wallet) => ({ ...walletSummary(wallet), ...(await eligibility(wallet)), username: getProfile(wallet)?.username || null });

async function api(req, res, url) {
  const ip = clientIp(req);
  // (a player in the city sends where they are ten times a second: the lobby limits that itself)
  if (url === '/api/lobby/state') return void (await lobby.handle(req, res, req.url, ip));
  if (limited(ip, 'api', 120)) return json(res, 429, { error: 'too many requests' });

  if (req.method === 'GET' && url === '/api/config') {
    return json(res, 200, {
      enabled: true, dryRun: config.dryRun, mint: config.tokenMint || null, turnstileSiteKey: config.turnstileSiteKey || null,
      storyRewards: config.storyRewards, raceReward: config.raceReward, dailyCap: config.walletDailyCap, minHolding: config.minHolding, holdTicker: config.holdTicker,
      holdersOnly: config.holdersOnly, trialSeconds: config.holdersOnly ? 300 : 0,
      story: STORY.map((m) => m.id), races: RACES.map((r) => r.id),
    });
  }
  if (req.method === 'POST' && url === '/api/nonce') {
    if (limited(ip, 'nonce', 10)) return json(res, 429, { error: 'too many requests' });
    const { wallet } = await readBody(req, 4096);
    if (!isWallet(wallet)) return json(res, 400, { error: 'bad wallet address' });
    return json(res, 200, makeNonce(wallet, config.publicDomain || String(req.headers.host || 'sol-city').slice(0, 100)));
  }
  if (req.method === 'POST' && url === '/api/login') {
    if (limited(ip, 'login', 10)) return json(res, 429, { error: 'too many requests' });
    const { wallet, nonce, signature, turnstile } = await readBody(req, 8192);
    if (!isWallet(wallet)) return json(res, 400, { error: 'bad wallet address' });
    if (!(await checkTurnstile(turnstile, ip))) return json(res, 403, { error: 'bot check failed' });
    const message = useNonce(wallet, nonce);
    if (!message || !verifySignature(wallet, message, signature)) return json(res, 401, { error: 'signature check failed' });
    if (!walletSeenFromIpToday(wallet, ip) && ipWalletsToday(ip) >= config.maxWalletsPerIpPerDay) {
      return json(res, 429, { error: 'too many wallets from this connection today' });
    }
    recordLogin(wallet, ip);
    return json(res, 200, { token: issueSession(wallet), summary: await me(wallet) });
  }

  if (url.startsWith('/api/lobby/')) return void (await lobby.handle(req, res, req.url, ip));

  const wallet = authed(req);
  if (!wallet) return json(res, 401, { error: 'sign in first' });
  if (req.method === 'GET' && url === '/api/me') return json(res, 200, await me(wallet));
  if (req.method === 'POST' && url === '/api/profile') {
    if (limited(ip, 'profile', 10)) return json(res, 429, { error: 'too many requests' });
    const { username } = await readBody(req, 1024);
    const r = setUsername(wallet, username);
    return json(res, r.status, r.error ? { error: r.error } : { username: r.username });
  }
  if (req.method === 'POST' && url === '/api/run/start') {
    const { kind, ref } = await readBody(req, 4096);
    if (!['story', 'race'].includes(kind) || typeof ref !== 'string') return json(res, 400, { error: 'bad run' });
    const r = startRun(wallet, kind, ref);
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'POST' && url === '/api/run/finish') {
    if (limited(ip, 'finish', 20)) return json(res, 429, { error: 'too many requests' });
    const { run, trace } = await readBody(req);
    if (typeof run !== 'string') return json(res, 400, { error: 'bad run' });
    const r = await finishRun(wallet, run, trace);
    if (r.ok === false) console.log(`run rejected: ${wallet} ${r.reason}`);
    return json(res, r.error ? 400 : 200, { ...r, summary: { ...walletSummary(wallet), ...(await eligibility(wallet)) } });
  }
  return json(res, 404, { error: 'not found' });
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  try {
    let url;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (url.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'POST' && url.startsWith('/capture/') && config.allowCapture) {
      // dev only: the trailer recorder's frame upload
      const name = path.basename(url);
      if (!/^[\w.-]+$/.test(name)) return send(res, 400, 'bad name');
      const dir = path.join(config.gameRoot, 'captures', 'trailer');
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(path.join(dir, name));
      let size = 0;
      req.on('data', (c) => (size += c.length) > 20e6 && req.destroy());
      req.pipe(out);
      out.on('finish', () => send(res, 200, 'ok'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message === 'body too large' || e.message === 'bad json' ? e.message : 'bad request' });
  }
});
// a bug in one request must never take the whole server (and its payouts) down
process.on('unhandledRejection', (e) => console.error('unhandled:', e));
process.on('uncaughtException', (e) => console.error('uncaught:', e));

server.listen(config.port, config.host, () => {
  console.log(`Sol City on http://localhost:${config.port}  (rewards ${config.dryRun ? 'DRY RUN - nothing is sent' : 'LIVE'})`);
  startPayouts();
});
