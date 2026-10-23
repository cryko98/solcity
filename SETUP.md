# START HERE: setting up the Sol City server

This is the checklist for whoever runs the **public Sol City server** (the game, the DaCity rewards,
the holder gate and multiplayer). It takes about half an hour. Every step links to the details in
[`server/README.md`](server/README.md).

> **Never paste `.env` or any secret key into a chat, an issue or a commit.** You fill those in on
> the server yourself. `server/.env` is git-ignored.

## What you need

- A small **Linux VPS** (1 vCPU, 1 GB RAM is plenty), with a **domain name** pointing at it.
- **Node.js 22.13 or newer** (`node -v`). The server uses Node's built-in SQLite: nothing to compile.
- A **private Solana RPC** URL (Helius, QuickNode, Triton… the free tiers are fine to start).
- A **new, empty hot wallet** just for paying rewards (never the project's main treasury).
- The **$SOLCITY** token's contract address (mint), once it is launched.

## 1. Get the code and install

```bash
git clone https://github.com/cryko98/solcity.git
cd solcity/server
npm install --omit=dev
cp .env.example .env
chmod 600 .env
```

## 2. Fill in `server/.env`

Open it (`nano .env`). These are the ones you **must** set; everything else has a sensible default
and is explained in the file itself.

| Setting | What to put | Why |
|---|---|---|
| `SESSION_SECRET` | 64 random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | signs players' log-in sessions |
| `PUBLIC_DOMAIN` | your site's name, e.g. `play.solcity.xyz` | shown in the wallet sign-in message |
| `SOLANA_RPC_URL` | your private RPC URL | balances and payouts |
| `SOLCITY_MINT` | the $SOLCITY contract address | the holder check (**at least** `MIN_HOLDING`, 10 000 by default) |
| `TREASURY_SECRET_KEY` | the **hot wallet's** secret key (base58, or the JSON array from `solana-keygen new`) | pays the DaCity rewards |
| `DRY_RUN` | leave **`true`** for now | nothing is sent while you test |

Already set for you: `DACITY_MINT` (the DaCity token), `HOLDERS_ONLY=true` (the game is for holders of at
least 10k $SOLCITY; everyone else gets 5 minutes of free play), `MIN_HOLDING=10000`, the reward
amounts and the daily caps. Fund the hot wallet with a little SOL for fees and only a few days' worth
of DaCity; refill it by hand. Details: [server/README.md → Fill in .env](server/README.md#fill-in-env).

## 3. Test it

```bash
npm test          # must end with "all passed" three times
node index.mjs    # starts in DRY_RUN ("rewards DRY RUN - nothing is sent")
# in a second terminal on the server:
curl http://127.0.0.1:8080/api/config     # answers with the settings: it works. Then Ctrl+C the server.
```

If something in `.env` is wrong, the server says what and refuses to start.

## 4. HTTPS (required: wallets only sign on HTTPS pages)

Keep Node on `HOST=127.0.0.1`, set `TRUST_PROXY=true`, and put **Caddy** (easiest, it gets the
certificate itself) or nginx in front. Open only ports 22, 80 and 443 in the firewall.
Copy-paste configs: [server/README.md → HTTPS in front](server/README.md#https-in-front-required).

## 5. Run it for good

A systemd service so it starts on boot and restarts on a crash:
[server/README.md → Run it as a service](server/README.md#run-it-as-a-service).
Logs: `journalctl -u solcity -f`.

## 6. Go live

1. Play a story mission in the browser with your wallet: you should see "+X DACITY (test mode)".
2. Check the log, then in `.env` set `DRY_RUN=false` and restart (`sudo systemctl restart solcity`).
   The server refuses to go live without `SOLCITY_MINT` and `TREASURY_SECRET_KEY`.
3. Optional: delete `data/rewards.sqlite` before going live to start with a clean slate.

## What players get

- **Holders of at least 10,000 $SOLCITY** (connected with Phantom) play as long as they like, earn
  DaCity for story missions and races, and can play **multiplayer** under their own username.
- **Everyone else** gets 5 minutes of free play, then the game asks for a holder's wallet.
- Multiplayer rooms live in the server's memory; a restart empties them.

## Day to day

Backups, what was paid, failed payouts, changing reward amounts:
[server/README.md → Day to day](server/README.md#day-to-day).
Updating the game: `git pull` in the repo, then `sudo systemctl restart solcity`.
