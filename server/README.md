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
* Only wallets holding at least `MIN_HOLDING` (10 000) **$SOLCITY** (`SOLCITY_MINT`) earn
  DaCity; the chip in the game tells everybody else what they need. Without it the game is
  the same, with in-game dollars only. Balances are checked on the chain (cached 10 minutes).
* Story missions pay **once per wallet**. Races pay up to `RACE_DAILY_PER_RACE` times per
  race per day, with a cooldown, gold pays double.
* On top: per-wallet daily and lifetime caps, a **global daily budget** (the most the whole
  game can pay in a UTC day), wallets-per-IP and runs-per-hour limits, optional minimum
  DaCity holding and an optional Turnstile bot check.
* Payouts are queued in SQLite and sent in batches by the server's hot wallet. Every
  transfer's signature is stored **before** it is sent, so a crash or restart never pays
  twice: on start-up it checks the chain for anything that was in flight.

What it cannot do: no browser game is cheat proof. The game runs on the player's computer,
so a determined cheater can script a believable trace and only has to wait as long as a
real player would. The checks make that slow and fiddly; the **caps are the real
protection of the pot**. Tune them to what you are willing to pay per wallet per day, and
against farms of many wallets the $SOLCITY holding requirement (`MIN_HOLDING`) is the
strongest tool: every extra wallet costs 10 000 tokens. Turnstile helps against bots.

Default numbers: the story (15 missions, the bank job last) pays 485 DaCity in total per wallet, races 3 (gold 6), at most
120 per wallet per day, 2000 per wallet ever, 5000 for the whole game per day. A wallet's
first payout is sent once it has earned `MIN_PAYOUT` (20), because creating its token
account costs the payout wallet about 0.002 SOL.

### How much of the pot can go out

The simplest way: only put into the payout wallet what you want players to be able to earn.
The server never sends more than that wallet holds.

Or let the server do it: with `POT_FULL_UNTIL` set, the pot is everything the payout wallet
has ever received (its balance + what it already paid). Up to `POT_FULL_UNTIL` tokens all of
it can be earned; of anything above, only `POT_SHARE_AFTER` (e.g. 0.5). When nothing is
left to promise, players are told the pot is empty for now and nothing is queued.

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
2. `DACITY_MINT`: the DaCity mint (already filled in). `SOLCITY_MINT`: the $SOLCITY contract
   address, once the token is launched (the server won't go live without it).
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
`HOST=127.0.0.1` and set `TRUST_PROXY=true` so the per-IP limits see the player's IP (the
server takes the **last** X-Forwarded-For entry, the one your proxy adds; never expose port
8080 to the internet with `TRUST_PROXY=true`, or anyone can fake their IP). Set
`PUBLIC_DOMAIN` to your site's name for the sign-in message.

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

## Holders only, free play, accounts

`HOLDERS_ONLY=true` (the default): Sol City is for wallets holding at least `MIN_HOLDING` (10 000 or more) of `SOLCITY_MINT`.
Without one, the game gives 5 minutes of free play (a clock on screen, warnings at one minute and
15 seconds), then stops until a wallet that holds enough is connected. That clock lives in the
browser and can be got round; everything worth something is checked here, by the server: DaCity
rewards and multiplayer. `HOLDERS_ONLY=false` turns the free-play limit off.

Each wallet has an account with a **username** (`profile.mjs`, table `profiles`): 3-16 letters,
digits, `_ . -`, unique whatever the case, a few names reserved, changeable once a day
(`POST /api/profile`, signed in). It's the name over the player's head in multiplayer.

## Multiplayer

`/api/lobby/` (`lobby.mjs`): players gather in a room (rooms, ready, chat, the host's START), then
play in the same city. Joining needs a signed-in wallet that holds at least `MIN_HOLDING` and has a
username; the name comes from the account (never from the request) and one wallet is one player
(joining again takes it out of its old room). Everything lives in memory (a restart empties it); it
never touches the rewards.

Once a room has started it stays open while anyone is in it. Each player POSTs where they are and
what they're doing to `/api/lobby/state` about 8 times a second (checked field by field: on the map,
finite numbers, a known animation and vehicle; more often than every 70 ms is dropped), and the
room's event stream sends everyone's last state ten times a second (`event: world`). Room updates
and these go out as Server-Sent Events (`/api/lobby/events`, a long-lived GET with a ping every
15 s): the server sends `X-Accel-Buffering: no` so nginx passes them through at once; Caddy needs
nothing. A room of 8 is about 64 small requests a second in and 80 events out: fine for a small
VPS. Limits: 8 players a room, 300 rooms, 20 joins a minute and 8 open streams per IP, chat 140
characters at most once every 0.8 s. Only positions are shared so far: each player's traffic,
people, missions and fights are their own.

Self-tests: `node test-lobby.mjs` (rooms) and `node test-mp.mjs` (usernames, the wallet check, the
states in the city); `npm test` runs all three.

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
* Going live after testing: rewards earned in DRY_RUN stay marked `dry` and are never sent
  and don't count toward the caps. To start clean, stop the server and delete
  `data/rewards.sqlite`.
* A payout that can't be confirmed (RPC trouble) stays `sending` until its blockhash
  expires (a minute or two), then it is checked again: nothing is ever sent twice.
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
