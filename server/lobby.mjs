// The lobby: players gather in a room before a game, see each other, chat, say they're ready,
// and the host starts everyone's game at the same moment. Plain HTTP, no dependencies:
//   POST /api/lobby/join    { name, room }        -> { id, key, room }   room: 'PUBLIC', 'NEW' or a code
//   GET  /api/lobby/events?id=..&key=..           -> Server-Sent Events: the room, on every change
//   POST /api/lobby/act     { id, key, type, .. } -> type: ready { on }, start, chat { text }, leave
//   GET  /api/lobby/stats                         -> { players, waiting } in the public rooms
// Everything lives in memory: a restart empties the lobby, nothing is stored. Used by both the
// developer's server.js and server/index.mjs.
import crypto from 'node:crypto';

const MAX_PLAYERS = 8; // per room
const MAX_ROOMS = 300;
const MAX_TOTAL = 1500; // players in all rooms together
const MAX_STREAMS_PER_IP = 8;
const COUNTDOWN = 5000; // ms between START and the game starting
const GRACE = 8000; // a dropped connection may come back this long (a phone switching networks)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // nothing that reads two ways (0/O, 1/I)

// names: letters (any alphabet), digits, space, _ - . ; at most 16 characters
export function cleanName(raw) {
  const s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return s || 'Player';
}
// chat: printable text only, at most 140 characters (shown with textContent, never as HTML)
export function cleanChat(raw) {
  return String(raw ?? '').normalize('NFC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function createLobby({ now = () => Date.now() } = {}) {
  const rooms = new Map(); // code -> room
  const players = new Map(); // id -> player
  const streamsPerIp = new Map();

  const newCode = () => {
    for (;;) {
      let c = '';
      for (const b of crypto.randomBytes(5)) c += CODE_CHARS[b % CODE_CHARS.length];
      if (!rooms.has(c)) return c;
    }
  };

  function makeRoom(isPublic) {
    const room = { code: newCode(), public: isPublic, phase: 'waiting', hostId: null, players: [], chat: [], startsAt: 0, timer: null, created: now() };
    rooms.set(room.code, room);
    return room;
  }

  function view(room) {
    return {
      room: room.code, public: room.public, phase: room.phase, max: MAX_PLAYERS,
      startsIn: room.phase === 'countdown' ? Math.max(0, room.startsAt - now()) : 0,
      players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, host: p.id === room.hostId, online: !!p.stream })),
      chat: room.chat,
    };
  }

  function broadcast(room) {
    const data = `data: ${JSON.stringify(view(room))}\n\n`;
    for (const p of room.players) if (p.stream) p.stream.write(data);
  }

  function say(room, text, from = null) {
    room.chat.push({ t: now(), from, text });
    if (room.chat.length > 30) room.chat.shift();
  }

  function cancelCountdown(room, why) {
    if (room.phase !== 'countdown') return;
    clearTimeout(room.timer);
    room.phase = 'waiting';
    say(room, why);
  }

  function remove(p, why) {
    const room = rooms.get(p.room);
    players.delete(p.id);
    clearTimeout(p.dropTimer);
    if (p.stream) {
      p.stream.end();
      p.stream = null;
    }
    if (!room) return;
    room.players = room.players.filter((q) => q !== p);
    if (!room.players.length) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.phase === 'started') return;
    say(room, `${p.name} ${why}.`);
    if (room.hostId === p.id) {
      room.hostId = room.players[0].id; // the one who has waited longest
      say(room, `${room.players[0].name} is the host now.`);
    }
    cancelCountdown(room, 'Countdown stopped: the room changed.');
    broadcast(room);
  }

  function join(body) {
    if (players.size >= MAX_TOTAL) return { status: 503, body: { error: 'The lobby is full, try again in a minute.' } };
    const want = String(body.room ?? 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
    let room;
    if (want === 'PUBLIC') {
      // the fullest public room that is still gathering; a new one when they're all full or starting
      room = [...rooms.values()].filter((r) => r.public && r.phase === 'waiting' && r.players.length < MAX_PLAYERS).sort((a, b) => b.players.length - a.players.length)[0];
    } else if (want !== 'NEW') {
      room = rooms.get(want);
      if (!room) return { status: 404, body: { error: `No room with the code ${want}.` } };
      if (room.phase !== 'waiting') return { status: 409, body: { error: 'That room has already started.' } };
      if (room.players.length >= MAX_PLAYERS) return { status: 409, body: { error: 'That room is full.' } };
    }
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return { status: 503, body: { error: 'Too many rooms right now, try again in a minute.' } };
      room = makeRoom(want === 'PUBLIC');
    }
    // the same name twice in a room gets a number
    let name = cleanName(body.name);
    const base = name.slice(0, 13);
    for (let n = 2; room.players.some((q) => q.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} ${n}`;
    const p = { id: crypto.randomBytes(6).toString('hex'), key: crypto.randomBytes(18).toString('base64url'), name, room: room.code, ready: false, stream: null, lastChat: 0, joined: now(), dropTimer: null };
    players.set(p.id, p);
    room.players.push(p);
    if (!room.hostId) room.hostId = p.id;
    say(room, `${name} joined.`);
    cancelCountdown(room, 'Countdown stopped: someone new joined.');
    // nobody opened the event stream in time: a client that never came (removed by the sweep)
    p.dropTimer = setTimeout(() => !p.stream && players.has(p.id) && remove(p, 'left'), GRACE * 2);
    broadcast(room);
    return { status: 200, body: { id: p.id, key: p.key, room: room.code, name } };
  }

  const auth = (id, key) => {
    const p = players.get(String(id ?? ''));
    if (!p) return null;
    const a = Buffer.from(String(key ?? '')), b = Buffer.from(p.key);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? p : null;
  };

  function act(body) {
    const p = auth(body.id, body.key);
    if (!p) return { status: 401, body: { error: 'Not in a room (it may have closed). Join again.' } };
    const room = rooms.get(p.room);
    if (body.type === 'leave') {
      remove(p, 'left');
      return { status: 200, body: { ok: true } };
    }
    if (room.phase === 'started') return { status: 409, body: { error: 'The game has started.' } };
    if (body.type === 'ready') {
      p.ready = !!body.on;
      if (!p.ready) cancelCountdown(room, `Countdown stopped: ${p.name} is not ready.`);
    } else if (body.type === 'chat') {
      const text = cleanChat(body.text);
      if (!text) return { status: 400, body: { error: 'empty' } };
      if (now() - p.lastChat < 800) return { status: 429, body: { error: 'Slow down a little.' } };
      p.lastChat = now();
      say(room, text, p.name);
    } else if (body.type === 'start') {
      if (room.hostId !== p.id) return { status: 403, body: { error: 'Only the host can start.' } };
      if (room.phase === 'countdown') {
        cancelCountdown(room, 'The host stopped the countdown.');
      } else {
        const waiting = room.players.filter((q) => q.id !== p.id && !q.ready);
        if (waiting.length) return { status: 409, body: { error: `Waiting for ${waiting.map((q) => q.name).join(', ')} to be ready.` } };
        p.ready = true;
        room.phase = 'countdown';
        room.startsAt = now() + COUNTDOWN;
        say(room, 'Starting in 5 seconds...');
        room.timer = setTimeout(() => {
          room.phase = 'started';
          broadcast(room);
          // everyone is in the city now: the room closes a moment later
          setTimeout(() => {
            for (const q of [...room.players]) remove(q, 'started');
          }, 3000);
        }, COUNTDOWN);
      }
    } else return { status: 400, body: { error: 'unknown action' } };
    broadcast(room);
    return { status: 200, body: { ok: true } };
  }

  function events(req, res, query, ip) {
    const p = auth(query.get('id'), query.get('key'));
    if (!p) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'Not in a room. Join again.' }));
    }
    const open = streamsPerIp.get(ip) || 0;
    if (open >= MAX_STREAMS_PER_IP) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'too many connections' }));
    }
    streamsPerIp.set(ip, open + 1);
    // one stream per player: a reconnect replaces the old one
    if (p.stream) p.stream.end();
    clearTimeout(p.dropTimer);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: pass the events through at once
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('retry: 2000\n\n');
    p.stream = res;
    const room = rooms.get(p.room);
    if (room) broadcast(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      streamsPerIp.set(ip, (streamsPerIp.get(ip) || 1) - 1);
      if (streamsPerIp.get(ip) <= 0) streamsPerIp.delete(ip);
      if (p.stream !== res) return;
      p.stream = null;
      if (!players.has(p.id)) return;
      const r = rooms.get(p.room);
      if (r) broadcast(r);
      p.dropTimer = setTimeout(() => !p.stream && players.has(p.id) && remove(p, 'lost connection'), GRACE);
    });
  }

  function readJson(req, res, limit = 2048) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          // answer at once, throw the rest away unread, and close the connection after it
          reject(new Error('body too large'));
          req.removeAllListeners('data');
          req.resume();
          res.setHeader('Connection', 'close');
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });
  }

  // join attempts per IP per minute (in memory)
  const joins = new Map();
  setInterval(() => {
    const t = now();
    for (const [k, v] of joins) if (t - v.t > 60000) joins.delete(k);
  }, 60000).unref();

  // returns true if it answered the request
  async function handle(req, res, rawUrl, ip = '?') {
    const u = new URL(rawUrl, 'http://lobby');
    const path = u.pathname;
    if (!path.startsWith('/api/lobby/')) return false;
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && path === '/api/lobby/events') return events(req, res, u.searchParams, ip), true;
      if (req.method === 'GET' && path === '/api/lobby/stats') {
        const pub = [...rooms.values()].filter((r) => r.public);
        return reply(200, { players: pub.reduce((n, r) => n + r.players.length, 0), waiting: pub.filter((r) => r.phase === 'waiting').length }), true;
      }
      if (req.method === 'POST' && path === '/api/lobby/join') {
        const j = joins.get(ip) || { t: now(), n: 0 };
        if (now() - j.t > 60000) Object.assign(j, { t: now(), n: 0 });
        joins.set(ip, j);
        if (++j.n > 20) return reply(429, { error: 'Too many tries, wait a minute.' }), true;
        const r = join(await readJson(req, res));
        return reply(r.status, r.body), true;
      }
      if (req.method === 'POST' && path === '/api/lobby/act') {
        const r = act(await readJson(req, res));
        return reply(r.status, r.body), true;
      }
      reply(404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) reply(400, { error: e.message === 'body too large' || e.message === 'bad json' ? e.message : 'bad request' });
    }
    return true;
  }

  return { handle, rooms, players, view };
}
