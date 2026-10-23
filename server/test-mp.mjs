// Self-test of the accounts and multiplayer in the city: node server/test-mp.mjs
// A throw-away database; the lobby on a local port with a stand-in for the wallet check.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solcity-mp-'));
Object.assign(process.env, { DATA_DIR: tmp, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), DRY_RUN: 'true', PORT: '0' });
const { checkUsername, setUsername, getProfile } = await import('./profile.mjs');
const { createLobby, cleanState } = await import('./lobby.mjs');

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

// ---- usernames
ok(!checkUsername('ab').name && !checkUsername('a'.repeat(17)).name, 'username: 3 to 16 characters');
ok(!checkUsername('bad name').name && !checkUsername('_lead').name && !checkUsername('<b>x</b>').name, 'username: no spaces, no leading _, no markup');
ok(!checkUsername('Admin').name, 'username: reserved names refused');
ok(checkUsername('Nico_99').name === 'Nico_99', 'username: a good one passes');
ok(setUsername('W1', 'Nico').status === 200 && getProfile('W1').username === 'Nico', 'username saved for a wallet');
ok(setUsername('W2', 'nico').status === 409, 'username unique (case does not matter)');
ok(setUsername('W1', 'NICO').status === 200, 'own name in another case: fine');
ok(setUsername('W1', 'Other').status === 429, 'renaming: once a day');
ok(setUsername('W2', 'Zara').status === 200, 'second wallet, own name');

// ---- the lobby behind a wallet check (the stand-in reads x-wallet; the real one a session token)
const names = { W1: 'Nico', W2: 'Zara', W3: null };
const lobby = createLobby({
  authorize: async (req) => {
    const w = req.headers['x-wallet'];
    if (!w) return { status: 401, error: 'Connect your wallet to play multiplayer.' };
    if (w === 'POOR') return { status: 403, error: 'Multiplayer is for holders.' };
    if (!names[w]) return { status: 403, error: 'Choose a username first.' };
    return { wallet: w, name: names[w] };
  },
});
const server = http.createServer((req, res) => lobby.handle(req, res, req.url, req.socket.remoteAddress));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/api/lobby/`;
const post = async (p, body, wallet) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(wallet ? { 'x-wallet': wallet } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// an event stream: collects "world" events
function stream(me) {
  const got = { world: [], room: [] };
  const req = http.get(`${base}events?id=${me.id}&key=${encodeURIComponent(me.key)}`, (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1] || 'message', data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) (ev === 'world' ? got.world : got.room).push(JSON.parse(data));
      }
    });
  });
  got.close = () => req.destroy();
  return got;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ok((await post('join', { room: 'NEW' })).status === 401, 'join without a wallet: refused');
ok((await post('join', { room: 'NEW' }, 'POOR')).status === 403, 'join without holding enough: refused');
ok((await post('join', { room: 'NEW' }, 'W3')).status === 403, 'join without a username: refused');
const a0 = await post('join', { room: 'NEW', name: 'Fake' }, 'W1');
ok(a0.status === 200 && a0.body.name === 'Nico', 'the name comes from the account, not the request');
const a = await post('join', { room: 'NEW' }, 'W1');
ok(a.status === 200 && !lobby.players.has(a0.body.id), 'one wallet, one player: joining again replaces the old one');
const b = await post('join', { room: a.body.room }, 'W2');
ok(b.status === 200 && b.body.name === 'Zara', 'a second holder joins the room');
const sa = stream(a.body), sb = stream(b.body);
await wait(150);
const s0 = { x: 10, y: 0.1, z: -5, h: 1.2, v: 1.4, a: 'walk' };
ok((await post('state', { id: a.body.id, key: a.body.key, s: s0 })).status === 409, 'no states before the game starts');
await post('act', { id: b.body.id, key: b.body.key, type: 'ready', on: true });
await post('act', { id: a.body.id, key: a.body.key, type: 'start' });
await wait(5300);
ok(lobby.rooms.get(a.body.room)?.phase === 'started', 'the room starts');
ok((await post('state', { id: a.body.id, key: a.body.key, s: s0 })).body.ok === true, 'a state is taken');
ok((await post('state', { id: a.body.id, key: a.body.key, s: s0 })).body.ok === false, 'too soon again: dropped');
await wait(250);
const seen = sb.world.flatMap((w) => w.p).find((p) => p.id === a.body.id);
ok(seen && seen.name === 'Nico' && seen.s.x === 10 && seen.s.a === 'walk', 'the other player sees it in a world event, with the name');
ok((await post('state', { id: b.body.id, key: b.body.key, s: { ...s0, x: NaN } })).status === 400, 'a state with NaN: refused');
await wait(80);
ok((await post('state', { id: b.body.id, key: b.body.key, s: { ...s0, x: 1e9 } })).status === 400, 'a state off the map: refused');
ok(cleanState({ ...s0, a: '<script>' }).a === 'idle' && !('c' in cleanState({ ...s0, c: { m: 'tank', k: 0, x: 0, z: 0, h: 0, v: 0 } })), 'unknown animation and vehicle: dropped');
ok(cleanState({ ...s0, c: { m: 'sedan', k: 0xff0000, x: 1, z: 2, h: 0.5, v: 12 } }).c.m === 'sedan', 'a car is passed on');
ok((await post('state', { id: a.body.id, key: 'wrong'.repeat(5), s: s0 })).status === 401, 'a state with the wrong key: refused');
sa.close();
await post('act', { id: a.body.id, key: a.body.key, type: 'leave' });
await wait(250);
const last = sb.world[sb.world.length - 1];
ok(last && !last.p.some((p) => p.id === a.body.id), 'a player who left is gone from the world');
sb.close();
lobby.close();
server.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {} // (Windows: the database file is still open)
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
