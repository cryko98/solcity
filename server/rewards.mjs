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

// what counts against the limits: everything earned, except capped rows, and (once live) the
// test-mode rows from DRY_RUN
const COUNTS = () => (config.dryRun ? "status != 'capped'" : "status NOT IN ('capped', 'dry')");
const sumToday = (wallet) => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND day = ? AND ${COUNTS()}`).get(wallet, today()).s;
const sumLifetime = (wallet) => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND ${COUNTS()}`).get(wallet).s;
const sumGlobalToday = () => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE day = ? AND ${COUNTS()}`).get(today()).s;
const paidForMission = (wallet, ref) =>
  db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND kind = 'story' AND ref = ? AND ${COUNTS()}`).get(wallet, ref).s;

// filled in by the payout module when an RPC is available:
//   holdings.get(wallet) -> DaCity the wallet holds (null if it can't be checked right now)
//   pot.available()      -> how much more may still be promised from the pot (Infinity = no pot rule)
export const holdings = { get: async () => Infinity };
export const pot = { available: async () => Infinity };

const closeRun = (runId, status, reason = null) =>
  db.prepare("UPDATE runs SET status = ?, finished = ?, reason = ? WHERE id = ? AND status = 'open'").run(status, Date.now(), reason, runId).changes === 1;

export async function finishRun(wallet, runId, trace) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.wallet !== wallet) return { error: 'unknown run' };
  if (run.status !== 'open') return { error: 'run already closed' };
  const plan = runPlan(run.kind, run.ref);
  const elapsed = (Date.now() - run.started) / 1000;
  const why = checkTrace(trace, plan, elapsed);
  if (why) {
    if (!closeRun(runId, 'rejected', why)) return { error: 'run already closed' };
    return { ok: false, reason: why };
  }
  let base = 0;
  if (run.kind === 'story') base = Number(config.storyRewards[run.ref] || 0);
  if (run.kind === 'race') base = config.raceReward * (elapsed <= plan.gold ? 2 : 1);
  const hold = config.minHolding > 0 ? await holdings.get(wallet) : Infinity;
  const potLeft = await pot.available();

  return tx(() => {
    // closing the run is the lock: two finishes of the same run can't both get past this
    if (!closeRun(runId, 'done')) return { error: 'run already closed' };
    let amount = base, reason = null;
    if (run.kind === 'story') {
      // a mission pays its reward once; if a cap cut it short, playing it again pays the rest
      amount = Math.max(0, base - paidForMission(wallet, run.ref));
      if (amount <= 0) return { ok: true, amount: 0, reason: 'already rewarded for this mission' };
    } else if (run.kind === 'race') {
      const paidToday = db.prepare(`SELECT COUNT(*) AS n FROM rewards WHERE wallet = ? AND kind = 'race' AND ref = ? AND day = ? AND ${COUNTS()}`).get(wallet, run.ref, today()).n;
      const last = db.prepare(`SELECT MAX(created) AS t FROM rewards WHERE wallet = ? AND kind = 'race' AND ${COUNTS()}`).get(wallet).t;
      if (paidToday >= config.raceDailyPerRace) [amount, reason] = [0, 'daily limit for this race reached'];
      else if (last && Date.now() - last < config.raceCooldownSec * 1000) [amount, reason] = [0, 'race cooldown'];
    }
    db.prepare('INSERT OR IGNORE INTO completions (wallet, kind, ref, run, day, created) VALUES (?, ?, ?, ?, ?, ?)').run(wallet, run.kind, run.ref, runId, today(), Date.now());
    if (amount > 0 && hold === null) [amount, reason] = [0, `couldn't check your $${config.holdTicker} balance, play it again later`];
    else if (amount > 0 && hold < config.minHolding) [amount, reason] = [0, `hold at least ${config.minHolding.toLocaleString('en-US')} $${config.holdTicker} to earn DaCity`];
    if (amount > 0) {
      const room = Math.min(config.walletDailyCap - sumToday(wallet), config.walletLifetimeCap - sumLifetime(wallet), config.globalDailyBudget - sumGlobalToday(), potLeft);
      if (!(room > 0)) [amount, reason] = [0, potLeft <= 0 ? 'the reward pot is empty right now, come back later' : 'daily limit reached, come back tomorrow'];
      else if (amount > room) [amount, reason] = [Math.floor(room * 100) / 100, 'partly capped'];
    }
    if (amount > 0) {
      db.prepare('INSERT INTO rewards (wallet, amount, kind, ref, run, day, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(wallet, amount, run.kind, run.ref, runId, today(), Date.now());
    }
    return { ok: true, amount, reason };
  });
}

// can this wallet earn DaCity at all? (holds enough $SOLCITY)
export async function eligibility(wallet) {
  if (!(config.minHolding > 0)) return { eligible: true };
  const holding = await holdings.get(wallet);
  return { eligible: holding !== null && holding >= config.minHolding, holding: holding === Infinity ? null : holding };
}

export function walletSummary(wallet) {
  const q = (status) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE wallet = ? AND status = ?').get(wallet, status).s;
  return {
    wallet,
    paid: q('paid'),
    pending: q('queued') + q('sending'),
    dryRun: config.dryRun ? q('dry') : 0, // DRY_RUN: earned, would have been sent
    today: sumToday(wallet),
    dailyCap: config.walletDailyCap,
    story: db.prepare("SELECT ref FROM completions WHERE wallet = ? AND kind = 'story'").all(wallet).map((r) => r.ref),
    recent: db.prepare('SELECT amount, kind, ref, status, signature, created FROM rewards WHERE wallet = ? ORDER BY id DESC LIMIT 10').all(wallet),
  };
}
