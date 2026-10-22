// Pays queued rewards from the treasury hot wallet, a few wallets at a time.
// - DRY_RUN=true (the default): nothing is sent, rewards are only logged and marked 'dry'.
// - A transaction's signature is stored BEFORE it is sent, so after a crash or a timeout the
//   server checks what really happened instead of paying twice.
// - Keep only a small part of the pot in the hot wallet and top it up by hand.
import { config } from './config.mjs';
import { db, prune } from './db.mjs';
import { holdings, pot } from './rewards.mjs';
import { b58decode, b58encode } from './auth.mjs';

let sol = null; // @solana/web3.js + @solana/spl-token, loaded only when needed
let ctx = null;

async function load() {
  if (ctx) return ctx;
  const web3 = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');
  sol = { web3, spl };
  const conn = new web3.Connection(config.rpcUrl, 'confirmed');
  const mint = new web3.PublicKey(config.tokenMint);
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error('DACITY_MINT not found on this cluster');
  // pump.fun mints may be on the classic token program or Token-2022
  const programId = info.owner.equals(spl.TOKEN_2022_PROGRAM_ID) ? spl.TOKEN_2022_PROGRAM_ID : spl.TOKEN_PROGRAM_ID;
  const mintInfo = await spl.getMint(conn, mint, 'confirmed', programId);
  let payer = null;
  if (config.treasurySecret) {
    const raw = config.treasurySecret.trim().startsWith('[') ? Uint8Array.from(JSON.parse(config.treasurySecret)) : b58decode(config.treasurySecret.trim());
    payer = web3.Keypair.fromSecretKey(raw);
  }
  ctx = { conn, mint, programId, decimals: mintInfo.decimals, payer };
  return ctx;
}

// token balance of a wallet (for MIN_HOLDING), cached for 10 minutes
const holdCache = new Map();
holdings.get = async (wallet) => {
  const c = holdCache.get(wallet);
  if (c && Date.now() - c.t < 600000) return c.v;
  try {
    if (!config.holdMint) return Infinity; // not launched yet (dry run only, see checkConfig)
    const { conn } = await load();
    const owner = new sol.web3.PublicKey(wallet);
    const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: new sol.web3.PublicKey(config.holdMint) }, 'confirmed');
    const v = res.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
    holdCache.set(wallet, { v, t: Date.now() });
    return v;
  } catch (e) {
    console.warn('holding check failed:', e.message);
    return config.dryRun ? Infinity : null; // can't tell: don't pay now (live), don't block (dry run)
  }
};

// The pot = everything the payout wallet ever received: its DaCity balance + what it has paid
// out. Players can get all of it up to POT_FULL_UNTIL, and POT_SHARE_AFTER of anything above.
// What may still be promised = that, minus what was paid or is waiting to be paid.
let potCache = { t: 0, total: Infinity };
async function potTotal() {
  if (!config.potFullUntil || config.dryRun) return Infinity;
  if (Date.now() - potCache.t < 60000) return potCache.total;
  const { conn, payer, mint, programId } = await load();
  const from = sol.spl.getAssociatedTokenAddressSync(mint, payer.publicKey, false, programId);
  const bal = Number((await conn.getTokenAccountBalance(from, 'confirmed')).value.uiAmount || 0);
  const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE status = 'paid'").get().s;
  const received = bal + paid;
  const total = Math.min(received, config.potFullUntil) + config.potShareAfter * Math.max(0, received - config.potFullUntil);
  potCache = { t: Date.now(), total };
  return total;
}
const promised = () => db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM rewards WHERE status IN ('paid', 'queued', 'sending')").get().s;
pot.available = async () => {
  try {
    const total = await potTotal();
    return total === Infinity ? Infinity : total - promised();
  } catch (e) {
    console.warn('pot check failed:', e.message);
    return 0; // can't tell: promise nothing new for now
  }
};

const toUnits = (amount, decimals) => BigInt(Math.round(amount * 100)) * 10n ** BigInt(decimals) / 100n;

// settle 'sending' batches left over from a crash: confirmed -> paid, gone -> back to the queue
async function recover() {
  const rows = db.prepare("SELECT batch, signature, MAX(valid_until) AS valid_until FROM rewards WHERE status = 'sending' GROUP BY batch, signature").all();
  if (!rows.length) return;
  const { conn } = await load();
  const height = await conn.getBlockHeight('confirmed');
  for (const { batch, signature, valid_until } of rows) {
    if (!signature) {
      db.prepare("UPDATE rewards SET status = 'queued', batch = NULL WHERE batch = ?").run(batch);
      continue;
    }
    const st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      db.prepare("UPDATE rewards SET status = 'paid' WHERE batch = ?").run(batch);
    } else if (!st && (!valid_until || height > valid_until)) {
      // never landed and its blockhash has expired, so it never can: safe to try again.
      // (Until then it may still land: leave it as 'sending' and look again next tick.)
      db.prepare("UPDATE rewards SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END, batch = NULL, signature = NULL WHERE batch = ?").run(batch);
    } else if (st && st.err) {
      db.prepare("UPDATE rewards SET status = 'queued', batch = NULL, signature = NULL, error = ? WHERE batch = ?").run(JSON.stringify(st.err), batch);
    }
  }
}

async function payWallet(wallet, rows) {
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const batch = `${wallet.slice(0, 6)}-${Date.now()}`;
  const ids = rows.map((r) => r.id);
  const mark = (sql, ...a) => db.prepare(`${sql} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...a, ...ids);
  if (config.dryRun) {
    console.log(`[dry run] would send ${amount} DaCity to ${wallet} (${rows.map((r) => r.ref).join(', ')})`);
    mark("UPDATE rewards SET status = 'dry', batch = ?", batch);
    return;
  }
  const { web3, spl } = sol;
  const { conn, mint, programId, decimals, payer } = ctx;
  if (!payer) throw new Error('no treasury key');
  const owner = new web3.PublicKey(wallet);
  const from = spl.getAssociatedTokenAddressSync(mint, payer.publicKey, false, programId);
  const to = spl.getAssociatedTokenAddressSync(mint, owner, false, programId);
  const t = new web3.Transaction().add(
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, owner, mint, programId),
    spl.createTransferCheckedInstruction(from, mint, to, payer.publicKey, toUnits(amount, decimals), decimals, [], programId),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  t.recentBlockhash = blockhash;
  t.feePayer = payer.publicKey;
  t.sign(payer);
  const signature = b58encode(t.signature);
  // remember the signature first: a crash after this point can be checked, never paid twice
  mark("UPDATE rewards SET status = 'sending', batch = ?, signature = ?, valid_until = ?, attempts = attempts + 1", batch, signature, lastValidBlockHeight);
  try {
    await conn.sendRawTransaction(t.serialize(), { skipPreflight: false, maxRetries: 3 });
    const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
    mark("UPDATE rewards SET status = 'paid', error = NULL");
    console.log(`paid ${amount} DaCity to ${wallet}: ${signature}`);
  } catch (e) {
    // did it land anyway? If we can't tell yet, leave it 'sending': recover() settles it once
    // its blockhash has expired, so it is never sent twice
    let st;
    try {
      st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    } catch {
      console.warn(`payout to ${wallet} unclear (${e.message}); will check again`);
      return;
    }
    if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      mark("UPDATE rewards SET status = 'paid', error = NULL");
      return;
    }
    if (!st || !st.err) {
      console.warn(`payout to ${wallet} not confirmed yet (${e.message}); will check again`);
      return;
    }
    const failed = rows[0].attempts + 1 >= 5;
    mark(`UPDATE rewards SET status = ?, batch = NULL, signature = NULL, error = ?`, failed ? 'failed' : 'queued', String(e.message || e).slice(0, 300));
    console.warn(`payout to ${wallet} failed: ${e.message}`);
  }
}

let busy = false, lastPrune = 0;
export async function payoutTick() {
  if (busy) return;
  busy = true;
  try {
    if (!config.dryRun) {
      await load();
      await recover();
    }
    // wallets that have earned at least MIN_PAYOUT (or were paid before: their token account exists)
    const wallets = db.prepare(`SELECT wallet, SUM(amount) AS due FROM rewards WHERE status = 'queued' GROUP BY wallet
      HAVING due >= ? OR wallet IN (SELECT wallet FROM rewards WHERE status = 'paid') LIMIT ?`).all(config.minPayout, config.payoutBatch);
    for (const { wallet } of wallets) {
      const rows = db.prepare("SELECT * FROM rewards WHERE wallet = ? AND status = 'queued'").all(wallet);
      if (rows.length) await payWallet(wallet, rows);
    }
    if (Date.now() - lastPrune > 3600000) {
      lastPrune = Date.now();
      prune();
    }
  } catch (e) {
    console.warn('payout tick:', e.message);
  } finally {
    busy = false;
  }
}

export function startPayouts() {
  setInterval(payoutTick, config.payoutIntervalSec * 1000).unref?.();
  setTimeout(payoutTick, 3000);
}
