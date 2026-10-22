// Storage: one SQLite file (Node's built-in node:sqlite, no native modules to build).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'rewards.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS nonces (
  wallet TEXT NOT NULL, nonce TEXT PRIMARY KEY, message TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS logins (wallet TEXT NOT NULL, ip TEXT NOT NULL, day TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS logins_ip_day ON logins(ip, day);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
  started INTEGER NOT NULL, finished INTEGER, status TEXT NOT NULL DEFAULT 'open', reason TEXT
);
CREATE INDEX IF NOT EXISTS runs_wallet ON runs(wallet, started);
-- one row per thing the wallet completed; story missions are UNIQUE per wallet
CREATE TABLE IF NOT EXISTS completions (
  wallet TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, run TEXT NOT NULL, day TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS completions_story ON completions(wallet, ref) WHERE kind = 'story';
CREATE INDEX IF NOT EXISTS completions_day ON completions(wallet, day);
-- rewards to pay: queued -> sending -> paid (or failed / capped)
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, amount REAL NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
  run TEXT NOT NULL, day TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  batch TEXT, signature TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX IF NOT EXISTS rewards_status ON rewards(status);
CREATE INDEX IF NOT EXISTS rewards_wallet_day ON rewards(wallet, day);
CREATE INDEX IF NOT EXISTS rewards_day_status ON rewards(day, status);
CREATE INDEX IF NOT EXISTS rewards_story ON rewards(wallet, kind, ref);
`);
// added later: the last block height at which a sent transaction can still land
try {
  db.exec('ALTER TABLE rewards ADD COLUMN valid_until INTEGER');
} catch {}

// old sign-in nonces, logins and finished runs are only needed for a while
export function prune() {
  const month = Date.now() - 30 * 86400000;
  db.prepare('DELETE FROM nonces WHERE created < ?').run(Date.now() - 3600000);
  db.prepare('DELETE FROM logins WHERE created < ?').run(month);
  db.prepare("DELETE FROM runs WHERE started < ? AND status != 'open'").run(month);
}

export const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
