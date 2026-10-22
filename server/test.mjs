// Self-test: node server/test.mjs
// Uses a throw-away database and a generated wallet; never touches the chain (DRY_RUN).
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solcity-test-'));
Object.assign(process.env, {
  DATA_DIR: tmp, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), DRY_RUN: 'true',
  WALLET_DAILY_CAP: '40', GLOBAL_DAILY_BUDGET: '100000', RACE_COOLDOWN_SEC: '240', PORT: '0',
});
const { b58encode, verifySignature, makeNonce, useNonce, issueSession, readSession } = await import('./auth.mjs');
const { startRun, finishRun } = await import('./rewards.mjs');
const { db } = await import('./db.mjs');
const W = await import('../src/shared/world.mjs');

let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

// a wallet like Phantom's: ed25519
function wallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { addr: b58encode(raw), sign: (msg) => b58encode(crypto.sign(null, Buffer.from(msg, 'utf8'), privateKey)) };
}

// ---- sign-in
const A = wallet(), B = wallet();
const { nonce, message } = makeNonce(A.addr, 'test');
ok(verifySignature(A.addr, message, A.sign(message)), 'valid wallet signature accepted');
ok(!verifySignature(A.addr, message, B.sign(message)), 'signature from another wallet rejected');
ok(!verifySignature(A.addr, message + 'x', A.sign(message)), 'signature over a different message rejected');
ok(useNonce(A.addr, nonce) === message, 'nonce usable once');
ok(useNonce(A.addr, nonce) === null, 'nonce cannot be reused');
const tok = issueSession(A.addr);
ok(readSession(tok) === A.addr, 'session token round trip');
ok(readSession(tok.slice(0, -2) + 'xx') === null, 'tampered session rejected');

// ---- traces
// walk a path through points at a given speed, one sample a second
function trace(points, speed = 20) {
  const out = [];
  let t = 0;
  out.push([0, points[0].x, points[0].z]);
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / speed));
    for (let i = 1; i <= n; i++) {
      t += d / n / speed;
      out.push([t, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n]);
    }
  }
  return out;
}
// pretend the run started `sec` seconds ago (the server's own clock)
const age = (run, sec) => db.prepare('UPDATE runs SET started = ? WHERE id = ?').run(Date.now() - sec * 1000, run);
const runFor = (w, kind, ref) => startRun(w, kind, ref).run;

const m = W.storyById.rosa2;
const pts = [W.contactStand('rosa'), ...W.missionSpots(m)];
const good = trace(pts);
const dur = good[good.length - 1][0];

let run = runFor(A.addr, 'story', 'rosa2');
age(run, dur + 2);
let r = await finishRun(A.addr, run, good);
ok(r.ok && r.amount === 12, `honest delivery pays (${r.amount})`);

run = runFor(A.addr, 'story', 'rosa2');
age(run, dur + 2);
r = await finishRun(A.addr, run, good);
ok(r.ok && r.amount === 0, 'same story mission never pays twice');

run = runFor(B.addr, 'story', 'rosa2');
age(run, dur + 2);
r = await finishRun(A.addr, run, good);
ok(!!r.error, "can't finish another wallet's run");

run = runFor(B.addr, 'story', 'rosa2');
age(run, 3);
r = await finishRun(B.addr, run, trace(pts, 200));
ok(!r.ok && r.reason === 'too fast', `finished faster than possible rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
age(run, dur + 2);
const jump = good.map((s) => s.slice());
jump[Math.floor(jump.length / 2)][1] += 400; // one teleport in the middle
r = await finishRun(B.addr, run, jump);
ok(!r.ok && r.reason === 'moved impossibly fast', `teleport rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
{
  // drives off somewhere else instead of the beach, slowly enough to pass the time check
  const half = trace([pts[0], pts[1], { x: pts[1].x + 150, z: pts[1].z + 150 }], 8);
  age(run, half[half.length - 1][0] + 1);
  r = await finishRun(B.addr, run, half);
}
ok(!r.ok && r.reason === 'missed a place', `missed the destination rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
age(run, 5);
r = await finishRun(B.addr, run, good);
ok(!r.ok, `trace longer than the run rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
{
  const away = trace([{ x: pts[1].x - 300, z: pts[1].z }, ...pts.slice(1)]);
  age(run, away[away.length - 1][0] + 1);
  r = await finishRun(B.addr, run, away);
}
ok(!r.ok && r.reason === 'started somewhere else', `started away from the contact rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
age(run, dur + 2);
const gappy = good.filter((_, i) => i % 9 === 0);
r = await finishRun(B.addr, run, gappy);
ok(!r.ok, `sparse / gappy trace rejected (${r.reason})`);

run = runFor(B.addr, 'story', 'rosa2');
age(run, dur + 2);
r = await finishRun(B.addr, run, good);
ok(r.ok && r.amount === 12, 'second wallet earns once');
r = await finishRun(B.addr, run, good);
ok(!!r.error, 'a finished run cannot be finished again');

// ---- caps: wallet A has 12 today, cap 40: vince1 15 fits, vince2 18 is cut to 13
for (const id of ['vince1', 'vince2']) {
  const mm = W.storyById[id];
  const pp = [W.contactStand(mm.contact), ...W.missionSpots(mm)];
  const tr = trace(pp);
  run = runFor(A.addr, 'story', id);
  age(run, Math.max(tr[tr.length - 1][0], W.missionMinSeconds(mm)) + 1);
  if (tr[tr.length - 1][0] < W.missionMinSeconds(mm)) tr.push([W.missionMinSeconds(mm) + 0.5, tr[tr.length - 1][1], tr[tr.length - 1][2]]);
  r = await finishRun(A.addr, run, tr);
  ok(r.ok, `${id} accepted (${r.amount}${r.reason ? ', ' + r.reason : ''})`);
}
const total = db.prepare("SELECT SUM(amount) AS s FROM rewards WHERE wallet = ?").get(A.addr).s;
ok(total === 40, `daily cap holds (${total} of 40)`);

// ---- races: cooldown
const race = W.RACES[0], route = W.raceRoute(race);
const start = { x: (route[0].x + route[1].x) / 2, z: (route[0].z + route[1].z) / 2 };
const rt = trace([start, ...route.slice(1)], 30);
const C = wallet();
run = runFor(C.addr, 'race', race.id);
age(run, rt[rt.length - 1][0] + 1);
r = await finishRun(C.addr, run, rt);
ok(r.ok && r.amount > 0, `race pays (${r.amount})`);
run = runFor(C.addr, 'race', race.id);
age(run, rt[rt.length - 1][0] + 1);
r = await finishRun(C.addr, run, rt);
ok(r.ok && r.amount === 0, `race cooldown (${r.reason})`);

// ---- every story mission can be passed by playing it honestly (the places are reachable)
{
  const D = wallet();
  db.prepare("UPDATE rewards SET day = 'old'").run(); // keep the daily caps out of this
  for (const mm of W.STORY) {
    if (mm.type === 'chase') continue; // the getaway car's route is random: only the time is checked
    const pp = [W.contactStand(mm.contact), ...W.missionSpots(mm)];
    const tr = trace(pp, 18);
    const need = W.missionMinSeconds(mm);
    if (tr[tr.length - 1][0] < need) tr.push([need + 0.5, tr[tr.length - 1][1], tr[tr.length - 1][2]]);
    run = runFor(D.addr, 'story', mm.id);
    age(run, tr[tr.length - 1][0] + 1);
    r = await finishRun(D.addr, run, tr);
    db.prepare("UPDATE rewards SET day = 'old'").run();
    ok(r.ok && r.amount > 0, `${mm.id} (${mm.type}) passes when played (${r.amount}${r.reason ? ', ' + r.reason : ''})`);
  }
}
// cash bags in any order; one missing fails
{
  const E = wallet(), mm = W.storyById.diaz3, bags = W.missionSpots(mm);
  const tr = trace([W.contactStand('diaz'), ...bags.slice().reverse()], 15);
  run = runFor(E.addr, 'story', 'diaz3');
  age(run, tr[tr.length - 1][0] + 1);
  r = await finishRun(E.addr, run, tr);
  ok(r.ok && r.amount > 0, `cash bags picked up in any order (${r.amount})`);
  const tr2 = trace([W.contactStand('diaz'), ...bags.slice(1)], 15);
  const F = wallet();
  run = runFor(F.addr, 'story', 'diaz3');
  age(run, tr2[tr2.length - 1][0] + 1);
  r = await finishRun(F.addr, run, tr2);
  ok(!r.ok && r.reason === 'missed a place', `a bag left behind fails (${r.reason})`);
}
// a fast car crosses a race checkpoint between two samples
{
  const G = wallet(), race2 = W.RACES[1], route2 = W.raceRoute(race2);
  const st = { x: (route2[0].x + route2[1].x) / 2, z: (route2[0].z + route2[1].z) / 2 };
  const fast = trace([st, ...route2.slice(1)], 40);
  run = runFor(G.addr, 'race', race2.id);
  age(run, fast[fast.length - 1][0] + 1);
  r = await finishRun(G.addr, run, fast);
  ok(r.ok && r.amount > 0, `checkpoints crossed between samples count (${r.amount}${r.reason ? ', ' + r.reason : ''})`);
}

// ---- HTTP: the game is served, secrets are not
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '.env.testprobe'), 'SECRET=1');
const srv = await import('node:child_process').then(({ spawn }) => spawn(process.execPath, ['index.mjs'], {
  cwd: path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), env: { ...process.env, PORT: '18765' }, stdio: 'ignore',
}));
await new Promise((res) => setTimeout(res, 1500));
const get = (p) => fetch('http://127.0.0.1:18765' + p).then((x) => x.status).catch(() => 0);
ok((await get('/')) === 200, 'game page served');
ok((await get('/src/main.js')) === 200, 'game code served');
ok((await get('/server/.env.testprobe')) === 404, 'server files not served');
ok((await get('/server/data/rewards.sqlite')) === 404, 'database not served');
ok((await get('/src/../server/index.mjs')) === 404, 'path traversal blocked');
ok((await get('/.git/config')) === 404, 'git not served');
const cfg = await fetch('http://127.0.0.1:18765/api/config').then((x) => x.json()).catch(() => null);
ok(cfg && cfg.enabled && cfg.dryRun, 'api config answers (dry run)');
ok((await fetch('http://127.0.0.1:18765/api/me').then((x) => x.status)) === 401, 'api needs sign-in');
srv.kill();
await new Promise((res) => setTimeout(res, 300));
fs.rmSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '.env.testprobe'));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
