// The lobby on the title screen: players gather in a room (the public one, or a private room
// with a code to share), see who's there, chat, say they're ready, and the host starts
// everybody's game at the same moment. The server side is server/lobby.mjs.
// "PLAY SOLO" (or a click anywhere on the title screen) starts the game straight away, as before.
import { isTouch, goLandscape } from './touch.js';

const API = '/api/lobby/';
const overlay = document.getElementById('overlay');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const css = document.createElement('style');
css.textContent = `
  #menu { display: flex; gap: 12px; margin-top: 4vh; flex-wrap: wrap; justify-content: center; }
  #menu button, #lobby button { font: 18px Anton, Impact, sans-serif; letter-spacing: 2px; color: #fff; cursor: pointer; border-radius: 8px; padding: 10px 22px;
    background: rgba(0,0,0,.55); border: 2px solid rgba(255,255,255,.55); touch-action: manipulation; }
  #menu button:hover:not(:disabled), #lobby button:hover:not(:disabled) { border-color: #ffd23f; color: #ffd23f; }
  #menu button:disabled, #lobby button:disabled { opacity: .4; cursor: default; }
  #menu .primary, #lobby .primary { background: linear-gradient(180deg, #ffb347, #e8603a); border-color: #ffd9a0; color: #1a0d05; }
  #menu .primary:hover:not(:disabled), #lobby .primary:hover:not(:disabled) { color: #000; border-color: #fff; }
  #menu small { display: block; font: 700 10px Inter, sans-serif; letter-spacing: 1px; opacity: .8; margin-top: 2px; }
  #overlay.ready #loading-text { display: none; }
  #lobby { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: rgba(4,4,10,.72); padding: 10px; }
  #lobby.show { display: flex; }
  #lobby .box { width: min(720px, 100%); max-height: 100%; overflow: auto; background: rgba(14,12,22,.94); border: 2px solid rgba(255,179,71,.6); border-radius: 12px;
    padding: 14px 18px; font: 600 14px Inter, sans-serif; color: #eee; box-shadow: 0 16px 50px rgba(0,0,0,.6); }
  #lobby h2 { margin: 0; font: 28px Anton, Impact, sans-serif; letter-spacing: 2px; color: #ffd23f; display: flex; align-items: center; gap: 10px; }
  #lobby h2 .code { font: 700 13px Inter, sans-serif; letter-spacing: 3px; color: #fff; background: rgba(255,255,255,.1); border-radius: 5px; padding: 3px 8px; }
  #lobby h2 .x { margin-left: auto; padding: 4px 12px; font-size: 14px; }
  #lobby label { display: block; font: 700 11px Inter, sans-serif; letter-spacing: 2px; color: #aaa; text-transform: uppercase; margin: 10px 0 4px; }
  #lobby input { font: 600 16px Inter, sans-serif; color: #fff; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.25); border-radius: 7px;
    padding: 8px 10px; width: 100%; outline: none; }
  #lobby input:focus { border-color: #ffd23f; }
  #lobby .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
  #lobby .row input { flex: 1; min-width: 120px; width: auto; }
  #lobby .err { color: #ff7a6a; min-height: 18px; margin-top: 8px; font-size: 13px; }
  #lobby .note { color: #9a94a8; font-size: 12px; line-height: 1.5; margin-top: 8px; }
  #lobby .cols { display: flex; gap: 14px; margin-top: 10px; }
  #lobby .cols > div { flex: 1; min-width: 0; }
  #lobby .players { list-style: none; margin: 0; padding: 0; }
  #lobby .players li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,.05); margin-bottom: 4px; }
  #lobby .players li.me { background: rgba(255,210,63,.12); }
  #lobby .players li.off { opacity: .45; }
  #lobby .players .dot { width: 9px; height: 9px; border-radius: 50%; background: #666; flex: none; }
  #lobby .players .ready .dot { background: #7ad65b; box-shadow: 0 0 6px #7ad65b; }
  #lobby .players .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #lobby .tag { font: 700 9px Inter, sans-serif; letter-spacing: 1px; padding: 2px 5px; border-radius: 4px; background: rgba(255,255,255,.12); }
  #lobby .tag.host { background: #ffd23f; color: #000; }
  #lobby .tag.rdy { background: #3d7a2c; }
  #lobby .chat { height: 150px; overflow-y: auto; background: rgba(0,0,0,.35); border-radius: 7px; padding: 6px 8px; font-size: 13px; line-height: 1.45; }
  #lobby .chat .sys { color: #9a94a8; font-style: italic; }
  #lobby .chat b { color: #ffd23f; }
  #lobby .status { margin-left: auto; font: 700 13px Inter, sans-serif; color: #ccc; }
  #lobby .count { font: 64px Anton, Impact, sans-serif; color: #ffd23f; text-align: center; line-height: 1; }
  #lobby button.on { background: #3d7a2c; border-color: #9be07f; }
  @media (max-height: 480px) {
    #lobby .box { padding: 8px 12px; }
    #lobby h2 { font-size: 20px; }
    #lobby .chat { height: calc(100vh - 210px); min-height: 70px; }
    #lobby label { margin-top: 6px; }
    #lobby button { font-size: 15px; padding: 7px 14px; }
    #lobby .row { margin-top: 6px; }
    #lobby .cols { margin-top: 6px; }
    #menu { margin-top: 3vh; }
    #menu button { font-size: 15px; padding: 8px 16px; }
  }
  @media (max-width: 520px) { #lobby .cols { flex-direction: column; } }`;
document.head.appendChild(css);

// ------------------------------------------------------------------ the two buttons on the title screen
const menu = document.createElement('div');
menu.id = 'menu';
menu.innerHTML = '<button class="primary" id="m-solo" disabled>LOADING…</button><button id="m-lobby">MULTIPLAYER LOBBY<small id="m-count"></small></button>';
overlay.appendChild(menu);
const soloBtn = menu.querySelector('#m-solo');
// the solo button just lets its click reach the title screen, which starts the game (src/main.js)
menu.querySelector('#m-lobby').addEventListener('click', (e) => {
  e.stopPropagation();
  open();
});
const ready = () => overlay.classList.contains('ready');
new MutationObserver(() => {
  if (!ready()) return;
  soloBtn.disabled = false;
  soloBtn.textContent = 'PLAY SOLO';
  if (pendingStart) startGame();
}).observe(overlay, { attributes: true, attributeFilter: ['class'] });
// how many are waiting in the public lobby
fetch(API + 'stats').then((r) => (r.ok ? r.json() : null)).then((s) => {
  if (s && s.players) menu.querySelector('#m-count').textContent = `${s.players} waiting`;
}).catch(() => {});

// ------------------------------------------------------------------ the lobby panel
const panel = document.createElement('div');
panel.id = 'lobby';
panel.innerHTML = '<div class="box"></div>';
document.body.appendChild(panel);
const box = panel.querySelector('.box');
// nothing in the panel reaches the game (the title screen's click, the touch controls)
for (const ev of ['click', 'touchstart', 'mousedown', 'keydown', 'keyup']) panel.addEventListener(ev, (e) => e.stopPropagation());

let me = null; // { id, key, room, name }
let es = null;
let state = null;
let pendingStart = false;
let countdown = null;
let lastChat = 0;

const savedName = () => {
  try {
    return localStorage.getItem('solcity.name') || '';
  } catch {
    return '';
  }
};

async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The lobby server answered ${r.status}.`);
  return j;
}

function open() {
  panel.classList.add('show');
  if (me) return renderRoom();
  box.innerHTML = `
    <h2>MULTIPLAYER LOBBY <button class="x" data-a="close">✕</button></h2>
    <label for="lb-name">Your name</label>
    <input id="lb-name" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="Player" value="${esc(savedName())}">
    <div class="row"><button class="primary" data-a="public">JOIN PUBLIC LOBBY</button><button data-a="new">CREATE PRIVATE ROOM</button></div>
    <div class="row"><input id="lb-code" maxlength="8" autocapitalize="characters" spellcheck="false" placeholder="Room code"><button data-a="code">JOIN</button></div>
    <div class="err"></div>
    <div class="note">Gather here with your friends: when everybody is ready, the host starts the game for the whole room at once.</div>`;
  box.querySelector('#lb-code').addEventListener('keydown', (e) => e.key === 'Enter' && join(box.querySelector('#lb-code').value));
}

function close() {
  panel.classList.remove('show');
}

async function join(room) {
  const name = box.querySelector('#lb-name')?.value || savedName();
  const err = box.querySelector('.err');
  if (!room) return void (err.textContent = 'Type the room code your friend sent you.');
  try {
    localStorage.setItem('solcity.name', name.trim());
  } catch {}
  if (isTouch()) goLandscape();
  box.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    me = await post('join', { name, room });
  } catch (e) {
    box.querySelectorAll('button').forEach((b) => (b.disabled = false));
    err.textContent = /fetch|network/i.test(e.message) ? 'The lobby server is not reachable. You can still play solo.' : e.message;
    return;
  }
  state = null;
  connect();
  renderRoom();
}

function connect() {
  es?.close();
  es = new EventSource(`${API}events?id=${encodeURIComponent(me.id)}&key=${encodeURIComponent(me.key)}`);
  es.onmessage = (ev) => {
    try {
      state = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (state.phase === 'countdown') countdown = performance.now() + state.startsIn;
    if (state.phase === 'started') return go();
    renderRoom();
  };
  // the server forgot us (restarted, or we were away too long): back to the start
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED || !me) return;
    me = null;
    state = null;
    open();
    box.querySelector('.err').textContent = 'Lost the connection to the lobby. Join again.';
  };
}

function leave() {
  if (me) post('act', { id: me.id, key: me.key, type: 'leave' }).catch(() => {});
  es?.close();
  es = null;
  me = null;
  state = null;
  open();
}
// closing the tab: say goodbye so the others don't wait for us
addEventListener('pagehide', () => {
  if (me && navigator.sendBeacon) navigator.sendBeacon(API + 'act', JSON.stringify({ id: me.id, key: me.key, type: 'leave' }));
});

function renderRoom() {
  const chatEl = box.querySelector('.chat');
  const draft = box.querySelector('#lb-msg')?.value || '';
  const focused = document.activeElement?.id === 'lb-msg';
  const atBottom = !chatEl || chatEl.scrollTop + chatEl.clientHeight >= chatEl.scrollHeight - 8;
  if (!state) {
    box.innerHTML = '<h2>MULTIPLAYER LOBBY</h2><div class="note">Joining…</div>';
    return;
  }
  const mine = state.players.find((p) => p.id === me.id);
  const host = !!mine?.host;
  const others = state.players.filter((p) => !p.host);
  const allReady = others.every((p) => p.ready);
  const counting = state.phase === 'countdown';
  const left = counting ? Math.max(0, Math.ceil((countdown - performance.now()) / 1000)) : 0;
  box.innerHTML = `
    <h2>${state.public ? 'PUBLIC LOBBY' : 'PRIVATE ROOM'} <span class="code" title="Send this code to your friends">${esc(state.room)}</span>
      <span class="status">${state.players.length}/${state.max}</span><button class="x" data-a="leave">LEAVE</button></h2>
    <div class="cols">
      <div><label>Players</label><ul class="players">${state.players.map((p) => `
        <li class="${p.ready || p.host ? 'ready' : ''}${p.id === me.id ? ' me' : ''}${p.online ? '' : ' off'}"><span class="dot"></span><span class="nm">${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</span>
          ${p.host ? '<span class="tag host">HOST</span>' : p.ready ? '<span class="tag rdy">READY</span>' : '<span class="tag">NOT READY</span>'}</li>`).join('')}</ul>
        ${counting ? `<div class="count">${left}</div>` : ''}</div>
      <div><label>Chat</label><div class="chat">${state.chat.map((m) => (m.from ? `<div><b>${esc(m.from)}:</b> ${esc(m.text)}</div>` : `<div class="sys">${esc(m.text)}</div>`)).join('')}</div>
        <div class="row"><input id="lb-msg" maxlength="140" placeholder="Say something…" autocomplete="off"><button data-a="send">SEND</button></div></div>
    </div>
    <div class="row">
      ${host
        ? `<button class="primary" data-a="start" ${!counting && !allReady ? 'disabled' : ''}>${counting ? 'STOP COUNTDOWN' : 'START GAME'}</button>
           <span class="note">${counting ? 'Starting…' : allReady ? (others.length ? 'Everybody is ready.' : 'Start alone, or wait for friends to join.') : 'Waiting for everybody to be ready.'}</span>`
        : `<button data-a="ready" class="${mine?.ready ? 'on' : ''}">${mine?.ready ? 'READY ✓' : 'READY?'}</button>
           <span class="note">${counting ? 'Get ready!' : mine?.ready ? 'Waiting for the host to start.' : 'Tap READY when you are.'}</span>`}
      <span class="status">${state.public ? '' : 'Share the code: ' + esc(state.room)}</span>
    </div>
    <div class="err"></div>`;
  const msg = box.querySelector('#lb-msg');
  msg.value = draft;
  if (focused) msg.focus();
  msg.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  const c = box.querySelector('.chat');
  if (atBottom) c.scrollTop = c.scrollHeight;
  if (counting) {
    clearTimeout(renderRoom.t);
    renderRoom.t = setTimeout(() => state?.phase === 'countdown' && renderRoom(), 250);
  }
}

async function send() {
  const msg = box.querySelector('#lb-msg');
  const text = msg.value.trim();
  if (!text || performance.now() - lastChat < 800) return;
  lastChat = performance.now();
  msg.value = '';
  act({ type: 'chat', text });
}

async function act(body) {
  try {
    await post('act', { id: me.id, key: me.key, ...body });
  } catch (e) {
    const err = box.querySelector('.err');
    if (err) err.textContent = e.message;
  }
}

box.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (!a) return;
  if (a === 'close') return close();
  if (a === 'public') return join('PUBLIC');
  if (a === 'new') return join('NEW');
  if (a === 'code') return join(box.querySelector('#lb-code').value.trim());
  if (a === 'leave') return leave();
  if (a === 'send') return send();
  if (isTouch()) goLandscape();
  if (a === 'ready') return act({ type: 'ready', on: !state.players.find((p) => p.id === me.id)?.ready });
  if (a === 'start') return act({ type: 'start' });
});

// ------------------------------------------------------------------ the room starts
let crew = [];
function go() {
  crew = state.players.filter((p) => p.id !== me.id).map((p) => p.name);
  es?.close();
  es = null;
  me = null;
  panel.classList.remove('show');
  pendingStart = true;
  if (ready()) startGame();
  else overlay.querySelector('#loading-text').textContent = 'Your crew is in. Loading the city…';
}

function startGame() {
  pendingStart = false;
  overlay.click(); // the title screen's own start (src/main.js)
  // the start came from the network, not a tap: browsers keep the sound off until the next touch
  const unlock = () => {
    window.__game?.audio?.ctx?.resume?.();
    removeEventListener('pointerdown', unlock, true);
    removeEventListener('keydown', unlock, true);
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
  setTimeout(() => window.__game?.hud?.say(crew.length ? `Rolling with <em>${crew.map(esc).join(', ')}</em>. See you in Sol City.` : 'Welcome to Sol City.', 5), 1200);
}
