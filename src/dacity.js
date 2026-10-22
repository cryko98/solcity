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

  // what a wallet needs to earn DaCity (only $SOLCITY holders do; everyone plays for dollars)
  get need() {
    const n = this.cfg?.minHolding || 0;
    return n ? `${n >= 1000 && n % 1000 === 0 ? n / 1000 + 'k' : n.toLocaleString('en-US')} $${this.cfg.holdTicker || 'SOLCITY'}` : '';
  }

  show(summary) {
    this.summary = summary;
    this.summaryAt = Date.now();
    const amt = this.el.querySelector('.amt'), btn = this.el.querySelector('button');
    if (!this.session || !summary) {
      amt.textContent = '';
      btn.textContent = 'Connect wallet';
      btn.title = 'Earn DaCity for story missions and races';
      return;
    }
    const pend = summary.pending + (summary.dryRun || 0);
    amt.textContent = summary.eligible === false ? `needs ${this.need}` : `${summary.paid}${pend ? ` (+${pend} pending)` : ''}`;
    amt.style.color = summary.eligible === false ? '#ff9a9a' : '';
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
      this.hud.say(summary.eligible === false
        ? `Wallet connected. Hold at least <em>${this.need}</em> to earn DaCity; until then you play for dollars.`
        : `Wallet connected. Story missions and races now earn <em>DaCity</em>.${this.cfg.dryRun ? ' (test mode)' : ''}`, 5);
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

  // ---------------------------------------------------------------- the ATM panel
  // a DaCity ATM on the street: what the wallet has earned, what is on its way, today's room
  async toggleAtm() {
    if (this.atmEl?.style.display === 'block') return this.closeAtm();
    if (!this.atmEl) {
      const el = (this.atmEl = document.createElement('div'));
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);max-height:80vh;overflow:auto;z-index:12;' +
        'background:rgba(8,14,20,.94);border:2px solid #ffd23f;border-radius:10px;padding:18px 20px;color:#eee;font:14px Inter,sans-serif;pointer-events:auto;display:none';
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      document.body.appendChild(el);
    }
    document.exitPointerLock?.();
    const el = this.atmEl;
    el.style.display = 'block';
    const title = '<div style="font:28px Anton,Impact,sans-serif;letter-spacing:2px;color:#ffd23f">DACITY ATM</div>';
    const foot = '<div style="margin-top:12px;color:#8a96a3;font-size:12px">E or walk away to close</div>';
    if (!this.cfg) {
      el.innerHTML = title + '<p>The DaCity network is offline here: this server doesn\u2019t pay rewards.</p>' + foot;
      return;
    }
    if (!this.session) {
      el.innerHTML = title + `<p>Connect your wallet to see your DaCity.</p><p>Holders of <b>${this.need || '$SOLCITY'}</b> earn DaCity for story missions and races.</p>` +
        '<button style="font:700 13px Inter,sans-serif;background:#ffd23f;border:0;border-radius:12px;padding:6px 14px;cursor:pointer">Connect wallet</button>' + foot;
      el.querySelector('button').onclick = () => this.connect().then(() => this.session && this.toggleAtm().then(() => this.toggleAtm()));
      return;
    }
    el.innerHTML = title + '<p>Loading...</p>';
    try {
      this.show(await this.call('GET', '/me'));
    } catch (e) {
      el.innerHTML = title + `<p>${e.message}</p>` + foot;
      return;
    }
    const m = this.summary, row = (k, v) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span>${k}</span><b>${v}</b></div>`;
    const story = (this.cfg.story || []).length;
    const recent = (m.recent || []).map((r) => {
      const when = new Date(r.created).toLocaleDateString();
      const link = r.signature ? ` <a href="https://solscan.io/tx/${r.signature}" target="_blank" rel="noopener" style="color:#7fd6ff">tx</a>` : '';
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>${when} ${r.kind} ${r.ref}</span><span>${r.amount} ${r.status}${link}</span></div>`;
    }).join('') || '<div style="font-size:12px;color:#8a96a3">Nothing yet.</div>';
    el.innerHTML = title +
      `<div style="color:#8a96a3;margin-bottom:8px">${m.wallet.slice(0, 6)}…${m.wallet.slice(-6)}${this.cfg.dryRun ? ' (test mode)' : ''}</div>` +
      (m.eligible === false ? `<p style="color:#ff9a9a">Hold at least <b>${this.need}</b> to earn DaCity. Until then you play for dollars.</p>` : '') +
      row('Paid to your wallet', m.paid + ' DACITY') +
      row('On its way', m.pending + (m.dryRun || 0) + ' DACITY') +
      row('Earned today', `${m.today} / ${m.dailyCap}`) +
      row('Story missions rewarded', `${(m.story || []).length} / ${story}`) +
      '<div style="margin:12px 0 4px;color:#ffd23f;font-weight:700">Recent</div>' + recent + foot;
  }

  closeAtm() {
    if (this.atmEl) this.atmEl.style.display = 'none';
  }

  // ---------------------------------------------------------------- runs
  async start(kind, ref) {
    this.run = null;
    if (!this.enabled || !this.session) return;
    const ticket = (this.pending = {});
    // not a holder: no run at all, unless they may have bought in since the last look
    if (this.summary?.eligible === false) {
      if (Date.now() - (this.summaryAt || 0) < 300000) return;
      try {
        this.show(await this.call('GET', '/me'));
      } catch {}
      if (this.summary?.eligible === false || this.pending !== ticket) return;
    }
    try {
      const { run } = await this.call('POST', '/run/start', { kind, ref });
      // ended or replaced while the server was answering: forget it (the server drops it on the next start)
      if (this.pending !== ticket) return;
      this.pending = null;
      this.run = { id: run, kind, ref, t0: performance.now(), next: 0, last: -1, trace: [] }; // the clock starts after the server's
      this.sample(0);
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
    this.pending = null;
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
