// Runs (a mission or race in progress) and the rewards they earn, with every limit that
// protects the pot applied in one database transaction.
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { db, today, tx } from './db.mjs';
import { runPlan, checkTrace } from './validate.mjs';

export function startRun(wallet, kind, ref) {
  const plan = runPlan(kind, ref);
  if (!plan) return { error: 'unknown run' };
  const hourAgo = Date.now() - 3600 * 1000;
  const n = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE wallet = ? AND started > ?').get(wallet, hourAgo).n;
  if (n >= config.maxRunStartsPerHour) return { error: 'too many runs, slow down' };
  // one open run per wallet: starting another abandons the last
  db.prepare("UPDATE runs SET status = 'abandoned' WHERE wallet = ? AND status = 'open'").run(wallet);
  const id = crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO runs (id, wallet, kind, ref, started) VALUES (?, ?, ?, ?, ?)').run(id, wallet, kind, ref, Date.now());
  return { run: id };
}

const sumToday = (wallet) =>
  db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND day = ? AND status != 'capped'").get(wallet, today()).s;
const sumLifetime = (wallet) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND status != 'capped'").get(wallet).s;
const sumGlobalToday = () => db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE day = ? AND status != 'capped'").get(today()).s;

// holding check (anti multi-wallet): filled in by the payout module when an RPC is available
export const holdings = { get: async () => Infinity };

export async function finishRun(wallet, runId, trace) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.wallet !== wallet) return { error: 'unknown run' };
  if (run.status !== 'open') return { error: 'run already closed' };
  const plan = runPlan(run.kind, run.ref);
  const elapsed = (Date.now() - run.started) / 1000;
  const why = checkTrace(trace, plan, elapsed);
  if (why) {
    db.prepare("UPDATE runs SET status = 'rejected', finished = ?, reason = ? WHERE id = ?").run(Date.now(), why, runId);
    return { ok: false, reason: why };
  }
  let base = 0;
  if (run.kind === 'story') base = Number(config.storyRewards[run.ref] || 0);
  if (run.kind === 'race') base = config.raceReward * (elapsed <= plan.gold ? 2 : 1);
  const hold = config.minHolding > 0 ? await holdings.get(wallet) : Infinity;

  return tx(() => {
    db.prepare("UPDATE runs SET status = 'done', finished = ? WHERE id = ?").run(Date.now(), runId);
    let amount = base, reason = null;
    if (run.kind === 'story') {
      const done = db.prepare("SELECT 1 FROM completions WHERE wallet = ? AND kind = 'story' AND ref = ?").get(wallet, run.ref);
      if (done) return { ok: true, amount: 0, reason: 'already rewarded for this mission' };
    } else if (run.kind === 'race') {
      const paidToday = db.prepare("SELECT COUNT(*) AS n FROM rewards WHERE wallet = ? AND kind = 'race' AND ref = ? AND day = ? AND status != 'capped'").get(wallet, run.ref, today()).n;
      const last = db.prepare("SELECT MAX(created) AS t FROM rewards WHERE wallet = ? AND kind = 'race' AND status != 'capped'").get(wallet).t;
      if (paidToday >= config.raceDailyPerRace) [amount, reason] = [0, 'daily limit for this race reached'];
      else if (last && Date.now() - last < config.raceCooldownSec * 1000) [amount, reason] = [0, 'race cooldown'];
    }
    db.prepare('INSERT INTO completions (wallet, kind, ref, run, day, created) VALUES (?, ?, ?, ?, ?, ?)').run(wallet, run.kind, run.ref, runId, today(), Date.now());
    if (amount > 0 && hold < config.minHolding) [amount, reason] = [0, `hold at least ${config.minHolding} DaCity to earn`];
    if (amount > 0) {
      const room = Math.min(config.walletDailyCap - sumToday(wallet), config.walletLifetimeCap - sumLifetime(wallet), config.globalDailyBudget - sumGlobalToday());
      if (room <= 0) [amount, reason] = [0, 'daily limit reached, come back tomorrow'];
      else if (amount > room) [amount, reason] = [Math.floor(room * 100) / 100, 'partly capped'];
    }
    if (amount > 0) {
      db.prepare('INSERT INTO rewards (wallet, amount, kind, ref, run, day, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(wallet, amount, run.kind, run.ref, runId, today(), Date.now());
    }
    return { ok: true, amount, reason };
  });
}

export function walletSummary(wallet) {
  const q = (status) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND status = ?').get(wallet, status).s;
  return {
    wallet,
    paid: q('paid'),
    pending: q('queued') + q('sending'),
    dryRun: q('dry'), // DRY_RUN: earned, would have been sent
    today: sumToday(wallet),
    dailyCap: config.walletDailyCap,
    story: db.prepare("SELECT ref FROM completions WHERE wallet = ? AND kind = 'story'").all(wallet).map((r) => r.ref),
    recent: db.prepare('SELECT amount, kind, ref, status, signature, created FROM rewards WHERE wallet = ? ORDER BY id DESC LIMIT 10').all(wallet),
  };
}
