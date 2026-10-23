// Self-test of the lobby: node server/test-lobby.mjs  (no dependencies, no database; ~7 s)
import http from 'node:http';
import { createLobby, cleanName, cleanChat } from './lobby.mjs';

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

// ---- names and chat
ok(cleanName('  <b>Bob</b>  ') === 'bBobb', 'markup stripped from names');
ok(cleanName('') === 'Player' && cleanName(null) === 'Player', 'empty name becomes Player');
ok(cleanName('Árvíztűrő Tükörfúrógép') .length <= 16, 'names cut to 16 characters');
ok(cleanName('Kovács Éva') === 'Kovács Éva', 'accented names kept');
ok(cleanChat('hi\u0000‮ there\n') === 'hi there', 'control characters removed from chat');
ok(cleanChat('x'.repeat(500)).length === 140, 'chat cut to 140 characters');

// ---- over HTTP, the way the game talks to it
const lobby = createLobby();
const srv = http.createServer(async (req, res) => {
  if (!(await lobby.handle(req, res, req.url, req.socket.remoteAddress))) res.writeHead(404).end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/api/lobby/`;
const post = (p, b, raw) => fetch(base + p, { method: 'POST', body: raw ?? JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

// an event stream that remembers the latest room state
async function listen(me) {
  const ctl = new AbortController();
  const r = await fetch(`${base}events?id=${me.id}&key=${me.key}`, { signal: ctl.signal });
  const s = { status: r.status, last: null, close: () => ctl.abort() };
  if (r.status !== 200) return s;
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const msg = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (msg.startsWith('data: ')) s.last = JSON.parse(msg.slice(6));
        }
      }
    } catch {}
  })();
  return s;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await post('join', { name: 'Alice', room: 'NEW' });
ok(A.status === 200 && /^[A-Z2-9]{5}$/.test(A.room), `private room created (${A.room})`);
const sA = await listen(A);
const B = await post('join', { name: 'alice', room: A.room.toLowerCase() });
ok(B.status === 200 && B.room === A.room, 'second player joins with the code (any case)');
ok(B.name === 'alice 2', `same name gets a number (${B.name})`);
const sB = await listen(B);
await wait(150);
ok(sA.last?.players.length === 2 && sA.last.players[0].host && !sA.last.players[1].host, 'both see the room; the first one is the host');
ok(!JSON.stringify(sA.last).includes(A.key), 'keys are never sent to the room');

ok((await post('join', { name: 'X', room: 'ZZZZZ' })).status === 404, 'unknown code refused');
ok((await post('act', { id: B.id, key: 'wrong', type: 'ready', on: true })).status === 401, 'wrong key refused');
ok((await listen({ id: B.id, key: 'nope' })).status === 401, 'event stream needs the key');
ok((await post('act', { id: B.id, key: B.key, type: 'start' })).status === 403, 'only the host can start');
const early = await post('act', { id: A.id, key: A.key, type: 'start' });
ok(early.status === 409 && /alice 2/.test(early.error), 'start waits for everybody to be ready');

ok((await post('act', { id: B.id, key: B.key, type: 'chat', text: '<img src=x onerror=alert(1)>' })).status === 200, 'chat accepted');
ok((await post('act', { id: B.id, key: B.key, type: 'chat', text: 'again' })).status === 429, 'chat flood slowed down');
await wait(100);
ok(sA.last.chat.some((m) => m.from === 'alice 2' && m.text.includes('<img')), 'chat delivered as text (the page escapes it)');
ok((await post('join', {}, '{bad json')).status === 400, 'bad json answered');
ok((await post('join', {}, 'x'.repeat(5000))).status === 400, 'big body refused');

// ready, start, countdown, started
await post('act', { id: B.id, key: B.key, type: 'ready', on: true });
ok((await post('act', { id: A.id, key: A.key, type: 'start' })).status === 200, 'host starts once everybody is ready');
await wait(100);
ok(sB.last.phase === 'countdown' && sB.last.startsIn > 4000, `countdown sent (${sB.last.startsIn} ms)`);
ok((await post('join', { name: 'Late', room: A.room })).status === 409, 'no joining a room that is starting');
const P = await post('join', { name: 'Pub', room: 'PUBLIC' });
ok(P.status === 200 && P.room !== A.room, 'the public lobby is a room of its own');
await wait(5300);
ok(sA.last.phase === 'started' && sB.last.phase === 'started', 'everybody gets the start');

// leaving hands the host on
const H1 = await post('join', { name: 'Host', room: 'NEW' });
const sH1 = await listen(H1);
const H2 = await post('join', { name: 'Next', room: H1.room });
const sH2 = await listen(H2);
await post('act', { id: H1.id, key: H1.key, type: 'leave' });
await wait(100);
ok(sH2.last.players.length === 1 && sH2.last.players[0].host, 'the host left: the next player is the host');
ok((await post('act', { id: H1.id, key: H1.key, type: 'ready', on: true })).status === 401, 'a player who left is gone');

for (const s of [sA, sB, sH1, sH2]) s.close();
srv.close();
srv.closeAllConnections?.();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
