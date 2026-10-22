// Sign-in with a Solana wallet: the server hands out a one-time message, the wallet (Phantom)
// signs it, the server checks the ed25519 signature against the wallet address. Proves the
// player owns the address rewards go to, without any password. Sessions are HMAC-signed tokens.
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { db, today } from './db.mjs';

// ------------------------------------------------------------------ base58 (Bitcoin alphabet)
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHA].map((c, i) => [c, i]));
export function b58decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 128) throw new Error('bad base58');
  let n = 0n;
  for (const ch of s) {
    const v = MAP[ch];
    if (v === undefined) throw new Error('bad base58');
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}
export function b58encode(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let s = '';
  while (n > 0n) {
    s = ALPHA[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export function isWallet(addr) {
  try {
    return b58decode(addr).length === 32;
  } catch {
    return false;
  }
}

// ed25519 public key (raw 32 bytes) -> Node KeyObject
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export function verifySignature(wallet, message, signatureB58) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, b58decode(wallet)]), format: 'der', type: 'spki' });
    const sig = b58decode(signatureB58);
    if (sig.length !== 64) return false;
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ nonces
const NONCE_TTL = 5 * 60 * 1000;
export function makeNonce(wallet, host) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Sol City wants you to sign in with your Solana wallet:\n${wallet}\n\n` +
    `This only proves you own this wallet. It does not move any funds.\n\nDomain: ${host}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
  db.prepare('DELETE FROM nonces WHERE created < ?').run(Date.now() - NONCE_TTL);
  db.prepare('INSERT INTO nonces (wallet, nonce, message, created) VALUES (?, ?, ?, ?)').run(wallet, nonce, message, Date.now());
  return { nonce, message };
}

export function useNonce(wallet, nonce) {
  const row = db.prepare('SELECT * FROM nonces WHERE nonce = ? AND wallet = ?').get(nonce, wallet);
  if (!row || row.used || Date.now() - row.created > NONCE_TTL) return null;
  db.prepare('UPDATE nonces SET used = 1 WHERE nonce = ?').run(nonce);
  return row.message;
}

// ------------------------------------------------------------------ sessions
const SESSION_TTL = 12 * 3600 * 1000;
const hmac = (s) => crypto.createHmac('sha256', config.sessionSecret).update(s).digest('base64url');
export function issueSession(wallet) {
  const body = Buffer.from(JSON.stringify({ w: wallet, exp: Date.now() + SESSION_TTL })).toString('base64url');
  return `${body}.${hmac(body)}`;
}
export function readSession(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = hmac(body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() && isWallet(p.w) ? p.w : null;
  } catch {
    return null;
  }
}

// how many different wallets signed in from this IP today
export function ipWalletsToday(ip) {
  return db.prepare('SELECT COUNT(DISTINCT wallet) AS n FROM logins WHERE ip = ? AND day = ?').get(ip, today()).n;
}
export function recordLogin(wallet, ip) {
  db.prepare('INSERT INTO logins (wallet, ip, day, created) VALUES (?, ?, ?, ?)').run(wallet, ip, today(), Date.now());
}
export function walletSeenFromIpToday(wallet, ip) {
  return !!db.prepare('SELECT 1 FROM logins WHERE ip = ? AND day = ? AND wallet = ?').get(ip, today(), wallet);
}

// optional Cloudflare Turnstile check (bots creating wallets)
export async function checkTurnstile(token, ip) {
  if (!config.turnstileSecret) return true;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: config.turnstileSecret, response: token || '', remoteip: ip }),
    });
    return (await r.json()).success === true;
  } catch {
    return false;
  }
}
