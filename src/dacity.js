// DaCity rewards, game side. Only active when the game is served by the Sol City server
// (server/index.mjs answers /api/config); on a plain static host this does nothing.
//   - "Connect wallet": Phantom signs a one-time sign-in message (no funds move)
//   - while a story mission or a race runs, the player's position is sampled once a second
//   - when it is passed, the trace goes to the server, which checks it and queues the payout
const API = '/api';
const KEY = 'solcity.dacity';
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = ALPHA[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export class DaCity {
  constructor({ hud }) {
    this.hud = hud;
    this.enabled = false;
    this.session = null;
    this.run = null;
    try {
      this.session = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {}
    this.buildUi();
    this.init();
  }

  async call(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.session ? { Authorization: 'Bearer ' + this.session.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && this.session && path !== '/login') this.signOut();
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  async init() {
    try {
      this.cfg = await this.call('GET', '/config');
      this.enabled = !!this.cfg.enabled;
    } catch {
      return; // no reward server: stay hidden
    }
    this.el.style.display = 'inline-flex';
    if (this.session) {
      try {
        this.show(await this.call('GET', '/me'));
      } catch {
        this.signOut();
      }
    } else this.show(null);
  }

  // ---------------------------------------------------------------- UI: a chip at the end of the top-right column
  // (under clock, money, stars and weapon, so it never covers them)
  buildUi() {
    const el = (this.el = document.createElement('div'));
    el.id = 'dacity';
    el.style.cssText = 'margin-top:8px;display:none;align-items:center;gap:8px;font:700 13px Inter,sans-serif;' +
      'background:rgba(0,0,0,.55);border:1px solid rgba(255,210,63,.5);border-radius:18px;padding:5px 12px;color:#fff;pointer-events:auto';
    el.innerHTML = '<span style="font:16px Anton,Impact,sans-serif;letter-spacing:1px;color:#ffd23f">DACITY</span><b class="amt"></b>' +
      '<button style="font:700 12px Inter,sans-serif;background:#ffd23f;border:0;border-radius:12px;padding:4px 10px;cursor:pointer">Connect wallet</button>';
    el.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.session) this.signOut();
      else this.connect();
    });
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    (document.getElementById('stats') || document.body).appendChild(el);
    const t = (this.toastEl = document.createElement('div'));
    t.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);font:42px Anton,Impact,sans-serif;color:#ffd23f;' +
      'text-shadow:0 3px 0 #000,0 0 18px rgba(0,0,0,.6);opacity:0;transition:opacity .4s;pointer-events:none;z-index:7;text-align:center';
    document.body.appendChild(t);
  }

  show(summary) {
    this.summary = summary;
    const amt = this.el.querySelector('.amt'), btn = this.el.querySelector('button');
    if (!this.session || !summary) {
      amt.textContent = '';
      btn.textContent = 'Connect wallet';
      btn.title = 'Earn DaCity for story missions and races';
      return;
    }
    const pend = summary.pending + (summary.dryRun || 0);
    amt.textContent = `${summary.paid}${pend ? ` (+${pend} pending)` : ''}`;
    btn.textContent = summary.wallet.slice(0, 4) + '…' + summary.wallet.slice(-4);
    btn.title = 'Click to disconnect';
  }

  toast(html, secs = 3.5) {
    this.toastEl.innerHTML = html;
    this.toastEl.style.opacity = 1;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.style.opacity = 0), secs * 1000);
  }

  // ---------------------------------------------------------------- wallet
  async connect() {
    const provider = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    if (!provider) {
      this.hud.say('Install the <em>Phantom</em> wallet to earn DaCity (phantom.app).', 5);
      window.open('https://phantom.app/', '_blank', 'noopener');
      return;
    }
    try {
      document.exitPointerLock?.();
      const res = await provider.connect();
      const wallet = res.publicKey.toString();
      const { nonce, message } = await this.call('POST', '/nonce', { wallet });
      const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
      const turnstile = this.cfg.turnstileSiteKey ? await this.turnstile() : undefined;
      const { token, summary } = await this.call('POST', '/login', { wallet, nonce, signature: b58(signed.signature), turnstile });
      this.session = { wallet, token };
      try {
        localStorage.setItem(KEY, JSON.stringify(this.session));
      } catch {}
      this.show(summary);
      this.hud.say(`Wallet connected. Story missions and races now earn <em>DaCity</em>.${this.cfg.dryRun ? ' (test mode)' : ''}`, 4);
    } catch (e) {
      this.hud.say(`Wallet: ${e.message || e}`, 4);
    }
  }

  signOut() {
    this.session = null;
    try {
      localStorage.removeItem(KEY);
    } catch {}
    this.show(null);
  }

  // Cloudflare Turnstile, only if the server asks for it
  turnstile() {
    return new Promise((resolve, reject) => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:20';
      document.body.appendChild(box);
      const render = () => window.turnstile.render(box, { sitekey: this.cfg.turnstileSiteKey, callback: (t) => (box.remove(), resolve(t)), 'error-callback': () => (box.remove(), reject(new Error('bot check failed'))) });
      if (window.turnstile) return render();
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.onload = render;
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------- runs
  async start(kind, ref) {
    this.run = null;
    if (!this.enabled || !this.session) return;
    try {
      const { run } = await this.call('POST', '/run/start', { kind, ref });
      this.run = { id: run, kind, ref, t0: performance.now(), next: 0, last: -1, trace: [] };
    } catch (e) {
      console.warn('DaCity run start:', e.message);
    }
  }

  // every frame: sample the player (or their car) about once a second while a run is open.
  // Wall-clock time, like the server's: a paused game is a gap in which nobody moved.
  update(dt, pos, indoors) {
    this.pos = pos;
    this.indoors = indoors;
    const r = this.run;
    if (!r) return;
    const t = (performance.now() - r.t0) / 1000;
    if (t >= r.next) this.sample(t);
  }

  sample(t) {
    const r = this.run, p = this.pos;
    if (!r || !p || this.indoors || r.trace.length >= 3900 || t - r.last < 0.25) return;
    r.next = t + 1;
    r.last = t;
    r.trace.push([Math.round(t * 100) / 100, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);
  }

  // an extra sample right now (a checkpoint, a pickup, the finish)
  mark() {
    if (this.run) this.sample((performance.now() - this.run.t0) / 1000);
  }

  async finish(passed) {
    if (passed) this.mark();
    const r = this.run;
    this.run = null;
    if (!r || !passed) return;
    try {
      const res = await this.call('POST', '/run/finish', { run: r.id, trace: r.trace });
      if (res.summary) this.show(res.summary);
      if (res.ok && res.amount > 0) this.toast(`+${res.amount} DACITY${this.cfg.dryRun ? '<div style="font-size:16px">(test mode)</div>' : ''}`);
      else if (res.reason) this.hud.say(`DaCity: ${res.reason}`, 4);
    } catch (e) {
      this.hud.say(`DaCity: ${e.message}`, 4);
    }
  }
}
