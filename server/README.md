# Sol City server: hosting + DaCity rewards

`server/index.mjs` serves the game and pays players in **DaCity** (SPL token on Solana) for
**story missions** and **street races** they really played. It is one Node process with a
SQLite file; no other services are needed.

> The root `server.js` is only the developer's local file server. On a real host run
> `server/index.mjs`.

## How the rewards work

* Players click **Connect wallet** (top right in the game) and sign a one-time sign-in
  message in Phantom. The message moves no funds; the server checks the ed25519 signature
  and gives the browser a 12-hour session.
* When a story mission or a race starts, the game asks the server for a **run**. The server
  remembers when it started (its own clock). While the run is open the game records the
  player's position about once a second.
* When it is passed, the game sends that trace. The server pays only if it checks out:
  * it lasts as long as the server's clock says, and at least as long as the fastest
    believable time for that mission (the whole route at supercar speed)
  * it starts at the right place (the contact's door, the race start)
  * nothing in it moves faster than 90 m/s (no teleports), no jumps across gaps
  * it passes through every place of that mission / every race checkpoint, in order.
    The places come from `src/shared/world.mjs`, the same file the game builds its
    missions from.
* Story missions pay **once per wallet**. Races pay up to `RACE_DAILY_PER_RACE` times per
  race per day, with a cooldown, gold pays double.
* On top: per-wallet daily and lifetime caps, a **global daily budget** (the most the whole
  game can pay in a UTC day), wallets-per-IP and runs-per-hour limits, optional minimum
  DaCity holding and an optional Turnstile bot check.
* Payouts are queued in SQLite and sent in batches by the server's hot wallet. Every
  transfer's signature is stored **before** it is sent, so a crash or restart never pays
  twice: on start-up it checks the chain for anything that was in flight.

What it cannot do: no browser game is 100% cheat proof. Someone who scripts a bot that
really drives the routes in real time can earn what a player earns, but no more than the
caps allow. The caps are the real protection of the pot: tune them to what you are
willing to pay per wallet per day.

Default numbers: the story pays 315 DaCity in total per wallet, races 3 (gold 6), at most
120 per wallet per day, 2000 per wallet ever, 20 000 for the whole game per day.

## Setup (Linux server)

Needs **Node.js 22.13 or newer** (it uses the built-in `node:sqlite`).

```bash
git clone https://github.com/cryko98/solcity.git
cd solcity/server
npm install --omit=dev
cp .env.example .env
nano .env            # see below
node test.mjs        # self-test: must end with "all passed"
node index.mjs       # first start, in DRY_RUN
```

### Fill in `.env`

1. `SESSION_SECRET`: 64 random hex characters:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. `DACITY_MINT`: the token's mint address.
3. `TREASURY_SECRET_KEY`: create a **new, separate hot wallet** only for payouts
   (`solana-keygen new -o payout.json`, then paste the JSON array, or a base58 secret key).
   Send it a little SOL for fees and only a few days' worth of DaCity. Refill it by hand.
   If the server is ever compromised, only that float is at risk, never the main treasury.
4. `SOLANA_RPC_URL`: a private RPC endpoint (Helius, QuickNode, ...) is much more
   reliable than the public one.
5. Leave `DRY_RUN=true` at first. In dry run everything works (sign-in, checks, the
   "+X DACITY" toast) but rewards are only written to the database, nothing is sent.
   Play a few missions, look at the log, then set `DRY_RUN=false` and restart.

The file must be readable only by the server's user: `chmod 600 .env`.

### Run it as a service

systemd (`/etc/systemd/system/solcity.service`):

```ini
[Unit]
Description=Sol City
After=network.target

[Service]
User=solcity
WorkingDirectory=/home/solcity/solcity/server
ExecStart=/usr/bin/node index.mjs
Restart=always
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now solcity
journalctl -u solcity -f     # log: payouts, rejected runs, problems
```

(pm2 works too: `pm2 start index.mjs --name solcity`.)

### HTTPS in front (required)

Wallets only sign on HTTPS pages. Put nginx or Caddy in front, keep the Node server on
`HOST=127.0.0.1` and set `TRUST_PROXY=true` so the per-IP limits see the player's IP.

Caddy (gets the certificate by itself), `/etc/caddy/Caddyfile`:

```
solcity.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx:

```nginx
server {
    server_name solcity.example.com;
    listen 443 ssl;   # certbot --nginx adds the certificate lines
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

Firewall: open only 22, 80, 443 (`ufw allow OpenSSH; ufw allow 80; ufw allow 443; ufw enable`).

## What the server serves

Only the game: `/index.html`, `/src/`, `/assets/`, `/SolCity_Trailer.mp4`. Everything else
(including `server/`, `.env`, the database, `.git`, `blender/`, `vendor/`) answers 404.
`node test.mjs` checks this.

## Day to day

* **Database**: `server/data/rewards.sqlite`. Back it up (e.g. a daily `cp` while running
  is fine for SQLite in WAL mode, or `sqlite3 rewards.sqlite ".backup b.sqlite"`).
* **What was paid**:
  `sqlite3 data/rewards.sqlite "SELECT day, status, COUNT(*), SUM(amount) FROM rewards GROUP BY 1,2 ORDER BY 1 DESC LIMIT 20"`
* **Failed payouts** (empty hot wallet, RPC down) stay `failed` after 5 tries. Refill /
  fix, then requeue: `UPDATE rewards SET status='queued', attempts=0 WHERE status='failed';`
* **Rejected runs** and why: `SELECT reason, COUNT(*) FROM runs WHERE status='rejected' GROUP BY 1;`
  Lots of one reason from one wallet = someone trying to cheat.
* Changing `SESSION_SECRET` signs everybody out.
* Changing reward numbers: edit `.env`, restart. Changing **where** a mission happens
  must be done in `src/shared/world.mjs` (game and server both read it).

## Notes for whoever sets this up with Claude

* Never paste the contents of `.env` or any secret key into a chat. Fill it in on the
  server yourself.
* Start in `DRY_RUN=true`, run `node test.mjs`, play a mission in the browser, and check
  `journalctl` before going live.
* The token amounts are whole tokens; the server reads the mint's decimals itself and
  supports both the classic SPL Token program and Token-2022 (pump.fun tokens).
* Legal: rewards in a token can count as gambling / securities / promotions in some
  countries. Check the rules where you and your players are.
