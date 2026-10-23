// Free play: on the Sol City server (when it says holdersOnly) the city is for $SOLCITY holders.
// Without a holder's wallet a player gets FREE seconds of play (counted while the game runs, kept
// in the browser), with a clock on screen and warnings near the end; then the game stops until a
// wallet that holds enough is connected. (A limit kept in the browser can be got round; what is
// worth anything, DaCity rewards and multiplayer, is checked by the server itself.)
import { wallet } from './wallet.js';

const KEY = 'solcity.freeplay';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class FreePlay {
  constructor({ hud }) {
    this.hud = hud;
    this.on = false;
    this.used = 0;
    try {
      this.used = Number(localStorage.getItem(KEY)) || 0;
    } catch {}
    this.warned = {};
    this.buildUi();
    addEventListener('solcity:wallet', () => this.check());
    wallet.config().then(async (cfg) => {
      this.limit = cfg?.holdersOnly ? cfg.trialSeconds || 300 : 0;
      if (!this.limit) return;
      this.on = true;
      if (wallet.session) await wallet.refresh();
      this.check();
    });
  }

  get left() {
    return Math.max(0, this.limit - this.used);
  }

  // a holder plays on; everyone else on the clock
  check() {
    if (!this.on) return;
    const free = wallet.holder;
    this.clock.style.display = free ? 'none' : '';
    if (free && this.locked) this.unlock();
    if (!free && this.left <= 0) this.lock();
  }

  // ---------------------------------------------------------------- UI
  buildUi() {
    const c = (this.clock = document.createElement('div'));
    c.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:6;display:none;pointer-events:auto;cursor:pointer;' +
      'font:700 12px Inter,sans-serif;letter-spacing:1px;color:#fff;background:rgba(0,0,0,.6);border:1px solid rgba(255,210,63,.6);border-radius:14px;padding:4px 12px';
    c.title = 'Connect a holder wallet to play on';
    c.addEventListener('mousedown', (e) => e.stopPropagation());
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      this.lock(true);
    });
    document.body.appendChild(c);
    const p = (this.panel = document.createElement('div'));
    p.style.cssText = 'position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:rgba(4,4,10,.8);padding:12px';
    p.innerHTML = '<div class="fp" style="width:min(460px,100%);background:rgba(14,12,22,.96);border:2px solid #ffd23f;border-radius:12px;padding:18px 20px;color:#eee;font:600 14px Inter,sans-serif;text-align:center"></div>';
    for (const ev of ['click', 'mousedown', 'touchstart', 'keydown', 'keyup']) p.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(p);
  }

  render(msg = '') {
    const box = this.panel.querySelector('.fp');
    const need = esc(wallet.need || '$SOLCITY');
    const over = this.left <= 0;
    const s = wallet.summary;
    box.innerHTML = `
      <div style="font:30px Anton,Impact,sans-serif;letter-spacing:2px;color:#ffd23f">${over ? 'FREE PLAY IS OVER' : 'PLAY ON IN SOL CITY'}</div>
      <p style="line-height:1.5">${over ? 'Your 5 free minutes are up.' : `You have <b>${fmt(this.left)}</b> of free play left.`}
        Sol City is for holders of <b>at least ${need}</b>: connect a wallet that holds that much (or more) to keep playing.</p>
      ${wallet.session && s && s.eligible === false ? `<p style="color:#ff9a9a">This wallet (${esc(s.wallet.slice(0, 4))}…${esc(s.wallet.slice(-4))}) holds less than ${need}.</p>` : ''}
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px">
        <button data-a="connect" style="font:18px Anton,Impact,sans-serif;letter-spacing:2px;cursor:pointer;border-radius:8px;padding:10px 22px;background:linear-gradient(180deg,#ffb347,#e8603a);border:2px solid #ffd9a0;color:#1a0d05">${wallet.session ? 'USE ANOTHER WALLET' : 'CONNECT WALLET'}</button>
        ${over ? '' : '<button data-a="close" style="font:18px Anton,Impact,sans-serif;letter-spacing:2px;cursor:pointer;border-radius:8px;padding:10px 22px;background:rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.5);color:#fff">LATER</button>'}
      </div>
      <div style="color:#ff7a6a;min-height:18px;margin-top:10px;font-size:13px">${esc(msg)}</div>`;
    box.querySelector('[data-a="connect"]').onclick = () => this.connect();
    const close = box.querySelector('[data-a="close"]');
    if (close) close.onclick = () => this.unlock();
  }

  async connect() {
    try {
      if (wallet.session) wallet.signOut();
      const s = await wallet.connect();
      if (s.eligible === false) return this.render(`This wallet holds less than ${wallet.need}.`);
      this.unlock();
      this.hud.say('Wallet connected: <em>Sol City is yours</em>, play as long as you like.', 5);
    } catch (e) {
      this.render(e.message || String(e));
    }
  }

  // stop the game (over: for good until a holder signs in; else just the panel, from the clock)
  lock(asked = false) {
    if (this.locked && !asked) return;
    this.locked = this.left <= 0;
    if (this.locked) window.__locked = true;
    document.exitPointerLock?.();
    this.panel.style.display = 'flex';
    this.render();
  }

  unlock() {
    if (this.left <= 0 && !wallet.holder) return;
    this.locked = false;
    window.__locked = false;
    this.panel.style.display = 'none';
  }

  // every frame the game runs
  update(dt) {
    if (!this.on || wallet.holder || this.locked) return;
    this.used += dt;
    if ((this.saveT = (this.saveT || 0) + dt) > 2) {
      this.saveT = 0;
      try {
        localStorage.setItem(KEY, String(Math.round(this.used)));
      } catch {}
    }
    const left = this.left;
    this.clock.textContent = `FREE PLAY ${fmt(left)} · CONNECT WALLET`;
    this.clock.style.display = '';
    this.clock.style.borderColor = left < 60 ? '#ff5a4a' : 'rgba(255,210,63,.6)';
    if (!this.warned.start) {
      this.warned.start = true;
      this.hud.say(`<em>Free play: ${fmt(left)}.</em> Sol City is for holders of at least ${wallet.need || '$SOLCITY'}: connect a wallet to keep playing.`, 6);
    }
    for (const [t, text] of [[60, 'One minute of free play left. Connect a wallet with at least ' + (wallet.need || '$SOLCITY') + ' to keep playing.'], [15, '15 seconds of free play left.']]) {
      if (left <= t && !this.warned[t]) {
        this.warned[t] = true;
        this.hud.say(`<em>${text}</em>`, 5);
      }
    }
    if (left <= 0) this.lock();
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
