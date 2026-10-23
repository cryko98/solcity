// The player's wallet sign-in, shared by the DaCity chip (src/dacity.js), the free-play limit
// (src/gate.js) and the multiplayer lobby (src/lobby.js). Only on the Sol City server
// (server/index.mjs answers /api/config); on a plain static host there is nothing to sign in to.
// Phantom signs a one-time sign-in message (no funds move); the server answers with a session token.
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

// Cloudflare Turnstile, only if the server asks for it
function botCheck(sitekey) {
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:50';
    document.body.appendChild(box);
    const render = () => window.turnstile.render(box, { sitekey, callback: (t) => (box.remove(), resolve(t)), 'error-callback': () => (box.remove(), reject(new Error('bot check failed'))) });
    if (window.turnstile) return render();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.onload = render;
    document.head.appendChild(s);
  });
}

export const wallet = {
  session: null, // { wallet, token }
  summary: null, // what /api/me says: rewards, eligible (holds enough), username
  cfg: undefined, // /api/config (null: no server)

  load() {
    try {
      this.session = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {}
  },

  async call(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.session ? { Authorization: 'Bearer ' + this.session.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && this.session && path !== '/login') this.signOut();
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status });
    return data;
  },

  // the server's settings, once (null: no Sol City server here)
  config() {
    if (this.cfg !== undefined) return Promise.resolve(this.cfg);
    return (this.cfgP ||= this.call('GET', '/config').then((c) => (this.cfg = c?.enabled ? c : null)).catch(() => (this.cfg = null)));
  },

  // what the server knows of the signed-in wallet (null if none)
  async refresh() {
    if (!this.session) return (this.summary = null);
    try {
      this.summary = await this.call('GET', '/me');
    } catch {
      this.summary = null;
    }
    this.changed();
    return this.summary;
  },

  get holder() {
    return !!(this.session && this.summary && this.summary.eligible !== false);
  },

  async connect(ui = {}) {
    const cfg = await this.config();
    if (!cfg) throw new Error('No Sol City server here.');
    const provider = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    if (!provider) {
      window.open('https://phantom.app/', '_blank', 'noopener');
      throw new Error('Install the Phantom wallet (phantom.app), then try again.');
    }
    document.exitPointerLock?.();
    const res = await provider.connect();
    const addr = res.publicKey.toString();
    const { nonce, message } = await this.call('POST', '/nonce', { wallet: addr });
    const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
    const turnstile = cfg.turnstileSiteKey ? await (ui.turnstile?.() ?? botCheck(cfg.turnstileSiteKey)) : undefined;
    const { token, summary } = await this.call('POST', '/login', { wallet: addr, nonce, signature: b58(signed.signature), turnstile });
    this.session = { wallet: addr, token };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.session));
    } catch {}
    this.summary = summary;
    this.changed();
    return summary;
  },

  async setUsername(name) {
    const r = await this.call('POST', '/profile', { username: name });
    if (this.summary) this.summary.username = r.username;
    this.changed();
    return r.username;
  },

  signOut() {
    this.session = null;
    this.summary = null;
    try {
      localStorage.removeItem(KEY);
    } catch {}
    this.changed();
  },

  // everyone who shows the wallet hears about it here
  changed() {
    dispatchEvent(new CustomEvent('solcity:wallet', { detail: { session: this.session, summary: this.summary } }));
  },

  // what a wallet needs to hold, e.g. "10k $SOLCITY"
  get need() {
    const n = this.cfg?.minHolding || 0;
    return n ? `${n >= 1000 && n % 1000 === 0 ? n / 1000 + 'k' : n.toLocaleString('en-US')} $${this.cfg.holdTicker || 'SOLCITY'}` : '';
  },
};
wallet.load();
