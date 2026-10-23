// Settings for the reward server, from environment variables (and an optional server/.env file).
// Every amount is in whole DaCity tokens. See server/README.md for what each one does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// minimal .env reader: KEY=value lines, # comments (also after a value: KEY=5  # five)
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#') || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    const q = v.match(/^(["'])(.*?)\1/);
    if (q) v = q[2]; // quoted: everything inside the quotes
    else v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v;
  }
}

// a setting that can't be read is reported by checkConfig (the server won't start), never a silent default
const bad = [];
const num = (k, d) => {
  const raw = process.env[k];
  if (raw === undefined || raw === '') return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    bad.push(`${k} must be a number >= 0 (got "${raw}")`);
    return d;
  }
  return v;
};
const str = (k, d) => process.env[k] || d;
const bool = (k, d) => {
  const raw = process.env[k];
  if (raw === undefined || raw === '') return d;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  bad.push(`${k} must be true or false (got "${raw}")`);
  return d;
};
const json = (k, d) => {
  const raw = process.env[k];
  if (!raw) return d;
  try {
    return JSON.parse(raw);
  } catch {
    bad.push(`${k} is not valid JSON`);
    return d;
  }
};

export const config = {
  port: num('PORT', 8080),
  host: str('HOST', '0.0.0.0'),
  gameRoot: path.resolve(here, '..'),
  dataDir: path.resolve(here, str('DATA_DIR', 'data')),
  // behind nginx / Cloudflare: take the client IP from X-Forwarded-For (the entry the proxy added)
  trustProxy: bool('TRUST_PROXY', false),
  // the site's name in the sign-in message (falls back to the request's Host header)
  publicDomain: str('PUBLIC_DOMAIN', ''),
  // the dev-only trailer frame upload (never on a public server)
  allowCapture: bool('ALLOW_CAPTURE', false),

  // ---- secrets (never commit them)
  sessionSecret: str('SESSION_SECRET', ''),
  treasurySecret: str('TREASURY_SECRET_KEY', ''), // base58 or JSON array of the payout wallet's secret key

  // ---- Solana
  rpcUrl: str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  tokenMint: str('DACITY_MINT', 'nxPqZ4F7ux8Vph5NFu25rEP6Kx9Gr1U6Fmj36Rjpump'),
  // nothing is sent until this is switched off
  dryRun: bool('DRY_RUN', true),

  // ---- rewards (whole tokens)
  storyRewards: json('STORY_REWARDS', {
    rosa1: 10, rosa2: 12, vince1: 15, vince2: 18, diaz1: 20, diaz2: 22,
    rosa3: 25, vince3: 28, diaz3: 30, zara1: 35, zara2: 40, zara3: 60,
    zara4: 30, zara5: 40, zara6: 100,
  }),
  raceReward: num('RACE_REWARD', 3), // per finished race (gold pays double)
  raceDailyPerRace: num('RACE_DAILY_PER_RACE', 2), // paid finishes per race per wallet per day
  raceCooldownSec: num('RACE_COOLDOWN_SEC', 240),

  // ---- limits that protect the pot
  walletDailyCap: num('WALLET_DAILY_CAP', 120), // most one wallet can earn in a UTC day
  walletLifetimeCap: num('WALLET_LIFETIME_CAP', 2000),
  globalDailyBudget: num('GLOBAL_DAILY_BUDGET', 5000), // most the whole game pays out in a UTC day
  // only holders of the project's own token earn DaCity: a wallet needs MIN_HOLDING of HOLD_MINT
  // ($SOLCITY). Everybody else plays for in-game dollars only. MIN_HOLDING=0 turns it off.
  holdMint: str('SOLCITY_MINT', ''),
  holdTicker: str('HOLD_TICKER', 'SOLCITY'),
  minHolding: num('MIN_HOLDING', 10000),
  // the game itself (solo and multiplayer) is for holders only: the title screen asks for a wallet
  // with MIN_HOLDING of the token and a username before it starts. HOLDERS_ONLY=false opens it.
  holdersOnly: bool('HOLDERS_ONLY', true),
  maxWalletsPerIpPerDay: num('MAX_WALLETS_PER_IP_PER_DAY', 3),
  maxRunStartsPerHour: num('MAX_RUN_STARTS_PER_HOUR', 30),

  // ---- the pot: everything the payout wallet ever received (its balance + what it has paid out).
  // Up to POT_FULL_UNTIL tokens all of it can go to players; of anything above that, POT_SHARE_AFTER.
  potFullUntil: num('POT_FULL_UNTIL', 0), // 0 = no pot rule (only the caps above and the wallet's balance)
  potShareAfter: num('POT_SHARE_AFTER', 0.5),

  // ---- payouts
  payoutIntervalSec: num('PAYOUT_INTERVAL_SEC', 60),
  payoutBatch: num('PAYOUT_BATCH', 10),
  // a wallet is paid once it has earned at least this much (each new wallet costs ~0.002 SOL rent)
  minPayout: num('MIN_PAYOUT', 20),

  // ---- optional Cloudflare Turnstile at sign-in (bots)
  turnstileSecret: str('TURNSTILE_SECRET', ''),
  turnstileSiteKey: str('TURNSTILE_SITE_KEY', ''),
};

export function checkConfig() {
  const problems = [...bad];
  if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be set (32+ random characters).');
  if (config.potShareAfter > 1) problems.push('POT_SHARE_AFTER must be between 0 and 1.');
  if (!config.payoutIntervalSec) problems.push('PAYOUT_INTERVAL_SEC must be above 0.');
  for (const [k, v] of Object.entries(config.storyRewards || {})) if (!(Number(v) >= 0)) problems.push(`STORY_REWARDS.${k} must be a number >= 0.`);
  if (!config.dryRun) {
    if (!config.tokenMint) problems.push('DACITY_MINT must be set when DRY_RUN=false.');
    if (!config.treasurySecret) problems.push('TREASURY_SECRET_KEY must be set when DRY_RUN=false.');
    if (config.minHolding > 0 && !config.holdMint) problems.push('SOLCITY_MINT must be set when DRY_RUN=false (or MIN_HOLDING=0).');
  }
  return problems;
}
