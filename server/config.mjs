// Settings for the reward server, from environment variables (and an optional server/.env file).
// Every amount is in whole DaCity tokens. See server/README.md for what each one does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// minimal .env reader: KEY=value lines, # comments
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const str = (k, d) => process.env[k] ?? d;
const bool = (k, d) => (process.env[k] !== undefined ? /^(1|true|yes)$/i.test(process.env[k]) : d);

export const config = {
  port: num('PORT', 8080),
  host: str('HOST', '0.0.0.0'),
  gameRoot: path.resolve(here, '..'),
  dataDir: path.resolve(here, str('DATA_DIR', 'data')),
  // behind nginx / Cloudflare: trust the X-Forwarded-For header for the client IP
  trustProxy: bool('TRUST_PROXY', false),
  // the dev-only trailer frame upload (never on a public server)
  allowCapture: bool('ALLOW_CAPTURE', false),

  // ---- secrets (never commit them)
  sessionSecret: str('SESSION_SECRET', ''),
  treasurySecret: str('TREASURY_SECRET_KEY', ''), // base58 or JSON array of the hot wallet's secret key

  // ---- Solana
  rpcUrl: str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  tokenMint: str('DACITY_MINT', ''),
  // nothing is sent until this is switched off
  dryRun: bool('DRY_RUN', true),

  // ---- rewards (whole tokens)
  storyRewards: JSON.parse(str('STORY_REWARDS', JSON.stringify({
    rosa1: 10, rosa2: 12, vince1: 15, vince2: 18, diaz1: 20, diaz2: 22,
    rosa3: 25, vince3: 28, diaz3: 30, zara1: 35, zara2: 40, zara3: 60,
  }))),
  raceReward: num('RACE_REWARD', 3), // per finished race (gold pays double)
  raceDailyPerRace: num('RACE_DAILY_PER_RACE', 2), // paid finishes per race per wallet per day
  raceCooldownSec: num('RACE_COOLDOWN_SEC', 240),

  // ---- limits that protect the pot
  walletDailyCap: num('WALLET_DAILY_CAP', 120), // most one wallet can earn in a UTC day
  walletLifetimeCap: num('WALLET_LIFETIME_CAP', 2000),
  globalDailyBudget: num('GLOBAL_DAILY_BUDGET', 20000), // most the whole game pays out in a UTC day
  minHolding: num('MIN_HOLDING', 0), // DaCity a wallet must hold to earn (anti multi-wallet); 0 = off
  maxWalletsPerIpPerDay: num('MAX_WALLETS_PER_IP_PER_DAY', 3),
  maxRunStartsPerHour: num('MAX_RUN_STARTS_PER_HOUR', 30),

  // ---- payouts
  payoutIntervalSec: num('PAYOUT_INTERVAL_SEC', 60),
  payoutBatch: num('PAYOUT_BATCH', 10),

  // ---- optional Cloudflare Turnstile at sign-in (bots)
  turnstileSecret: str('TURNSTILE_SECRET', ''),
  turnstileSiteKey: str('TURNSTILE_SITE_KEY', ''),
};

export function checkConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be set (32+ random characters).');
  if (!config.dryRun) {
    if (!config.tokenMint) problems.push('DACITY_MINT must be set when DRY_RUN=false.');
    if (!config.treasurySecret) problems.push('TREASURY_SECRET_KEY must be set when DRY_RUN=false.');
  }
  return problems;
}
