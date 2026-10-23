// Player accounts: one username per wallet, shown over the player's head in multiplayer.
import { db } from './db.mjs';

const RESERVED = /^(admin|administrator|mod|moderator|support|staff|system|server|solcity|sol_city|dacity|official|player|null|undefined)$/i;
const RENAME_EVERY = 24 * 3600 * 1000; // a name can be changed once a day

// 3-16 characters: letters, digits, _ . - (starting with a letter or a digit)
export function checkUsername(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < 3 || name.length > 16) return { error: 'A username is 3 to 16 characters long.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return { error: 'Use letters, digits, _ . or - (starting with a letter or a digit).' };
  if (RESERVED.test(name)) return { error: 'That name is reserved, pick another.' };
  return { name };
}

export function getProfile(wallet) {
  return db.prepare('SELECT username, changed FROM profiles WHERE wallet = ?').get(wallet) || null;
}

export function setUsername(wallet, raw) {
  const c = checkUsername(raw);
  if (c.error) return { status: 400, error: c.error };
  const now = Date.now();
  const mine = getProfile(wallet);
  if (mine && mine.username === c.name) return { status: 200, username: c.name };
  const taken = db.prepare('SELECT wallet FROM profiles WHERE lower(username) = lower(?)').get(c.name);
  if (taken && taken.wallet !== wallet) return { status: 409, error: 'That username is taken.' };
  // (only the case changes: always allowed)
  if (mine && mine.username.toLowerCase() !== c.name.toLowerCase() && now - mine.changed < RENAME_EVERY) {
    return { status: 429, error: 'You can change your username once a day.' };
  }
  try {
    if (mine) db.prepare('UPDATE profiles SET username = ?, changed = ? WHERE wallet = ?').run(c.name, now, wallet);
    else db.prepare('INSERT INTO profiles (wallet, username, created, changed) VALUES (?, ?, ?, ?)').run(wallet, c.name, now, now);
  } catch {
    return { status: 409, error: 'That username is taken.' }; // (two at once: the unique index decides)
  }
  return { status: 200, username: c.name };
}
