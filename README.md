# Sol City

> **Setting up the public server?** Start with **[SETUP.md](SETUP.md)**: what to install, what to put in
> `server/.env` (the secrets you fill in yourself, never in a chat or a commit), HTTPS, and going live.

A GTA-style browser game prototype (Three.js). The character and the cars are
modelled, rigged and animated procedurally in Blender by the scripts in `blender/`.

## Run

```bash
node server.js
```

Then open http://localhost:8080 (the page must be served over HTTP; opening
`index.html` directly from disk cannot load the GLB models). Three.js is loaded from the jsDelivr CDN.

`server.js` is the local development server. To host the game publicly, with **DaCity
rewards** for story missions and races, run `server/index.mjs` instead: see
[server/README.md](server/README.md).

## DaCity rewards

On the Sol City server a **Connect wallet** chip appears at the top right. Sign in once with Phantom
(a signature only, no funds move). Wallets holding at least 10 000 **$SOLCITY** earn DaCity: every
story mission pays once, and street races pay a little every day. Everybody else plays for
in-game dollars. The game records where you drive while a mission runs; the server checks that
trace against the mission's places (`src/shared/world.mjs`, shared by game and server), its own clock
and believable speeds before it queues a payout, with per-wallet and global daily caps on top.
Dollars in the game are not exchangeable: they live in the browser and could be edited.

On the Sol City server the game itself is for holders of **at least 10 000 $SOLCITY**: without such a wallet
there are 5 minutes of free play (a clock on screen, warnings near the end), then the game asks for one.
**Multiplayer** (MULTIPLAYER LOBBY on the title screen) always needs a connected holder wallet and a
username, which the others see over your head: gather in a room, the host starts, and everyone plays in
the same city (`src/net.js`, `server/lobby.mjs`). Only where everyone is and what they do is shared so far.
Game side: `src/dacity.js`; server: `server/`.

## Controls

| On foot | |
|---|---|
| W A S D | move (camera-relative) |
| Shift | run |
| Space | jump (while aiming: dodge roll) |
| C | dodge roll |
| Mouse / wheel | look around / zoom (click the game to lock the mouse) |
| F | get in the nearest car |

| In a car | |
|---|---|
| W / S | throttle / brake & reverse |
| A / D | steer |
| Space | handbrake (drift) |
| F | stop and get out |
| R | next radio station |
| G | horn (people jump out of the way) |
| E | start a street race (at an R marker) |

M opens the map, N skips to the next night / morning, K changes the weather, P switches the graphics quality
(ULTRA adds ambient occlusion for a dedicated GPU; HIGH / MEDIUM / LOW step the resolution and shadows down for
weaker ones), H hides the help panel.
Progress (money, guns, armour, time of day) is saved in the browser every 10 seconds.

## Phones and tablets

The game is played in **landscape**: held upright it pauses behind a "rotate your phone" screen. The first tap
goes full screen and locks landscape where the browser allows it (Android Chrome; on an iPhone, add the page to
the home screen for a full-screen app). Phones start on LOW graphics.

| Touch | |
|---|---|
| left thumb | joystick (appears where you touch); push it all the way out to sprint. In a car it steers |
| right side | drag to look around, pinch to zoom |
| FIRE | punch / shoot; keep the finger down and drag it to aim while firing |
| AIM, JUMP, ROLL, CAR, USE, WEAPON, RELOAD | on foot |
| GAS, BRAKE, DRIFT, EXIT, NITRO, HORN, RADIO, JOB | in a car |
| MAP, FULL, GFX | the top row: city map, full screen, graphics quality |

Shop and paint-shop menus: tap a row to buy. Story scenes: tap to move the dialogue on. The small letter on a
button is the keyboard key the game's hints talk about (USE is E, CAR is F, JOB is T). Code: `src/touch.js`.

## Multiplayer lobby

The title screen has **PLAY SOLO**, **MULTIPLAYER LOBBY** and **HOW TO PLAY** (everything there is to do, in
short, by topic: `src/howto.js`). In the lobby players join the public lobby, or create a private room and send
its 5-letter code to their friends. Everybody sees who is in the room, can chat and says READY; the host presses
START, and after a 5-second countdown the game starts for the whole room at once: everyone starts side by side
in the same city and sees the others (the hero's avatar with their name over the head) walking, fighting,
swimming and driving (`src/net.js`). Only positions and what each player is doing are shared so far; traffic,
people and missions are each player's own. On the Sol City server the lobby needs a connected wallet holding at
least 10 000 $SOLCITY and a username (the account's; `server/profile.mjs`); the developer's `server.js` lets
anyone in under any name. Code: `src/lobby.js`, `server/lobby.mjs`; tests: `node server/test-lobby.mjs`,
`node server/test-mp.mjs`.

## Getting in and out

F next to a car: the hero walks to the driver door (around the car if needed), opens it, drags out whoever
is at the wheel and throws them on the road (they get up and run), steps in ducking under the roof and pulls the
door shut. A moving car brakes when you go for its door. F at the wheel: stop, open the door, step out, close it;
at speed you dive out instead and roll on the road while the car rolls on. The driver doors are separate,
hinged objects in `blender/build_car.py`; the OpenDoor / GetIn / JackPull clips are in `blender/build_character.py`
and the sequence in `src/carentry.js`. Motorbikes: straight on and off.

## Wanted level & police

Crimes raise heat (stars): punching or knocking someone out, running people over and
carjacking need a witness; anything done to an officer always counts. Patrol cars (one per
star, max 4) chase you across the road grid with sirens, officers get out and run after you
on foot. Stay out of every officer's sight until the stars stop blinking and the search ends;
if officers hold you still, you're BUSTED (fine + respawn). From four stars, two patrol cars
block the road ahead of you with armed officers behind them. Code: `src/police.js`.

## Shops

Thirteen shops you can walk into, spread over the districts (`src/shops.js`):

- **Ammu-Nation** (two Downtown, Old Harbor): pistol, SMG, shotgun (ammo if you own it), body armor.
- **Restaurants**: Burger Sol (Little Havana, South Beach), Taco Loco (Old Harbor), Pizza Sol (Downtown): meals heal 25 / 50 / 100 HP.
- **Sol Threads** clothes stores (Little Havana, two in South Beach): shirts and jeans in other colours for the hero (kept between sessions).
- **24/7** stores (Old Harbor, two in South Beach): snacks, energy drinks, a first-aid kit and scratch cards.

Each has its own shop front across the ground floor of its building (the city leaves that floor plain for it: pilasters, display windows, a glass double door, a lit name on the fascia, striped awnings) and its own furnished
interior: Ammu-Nation's pegboard of guns and glass display counter, a diner with booths, a kitchen and a
menu board, a clothes store with rails, mannequins and fitting rooms, a 24/7 with aisles and lit fridges.
Step into the ring at the door: the screen fades and you're inside, with a closer indoor camera and the
room's own lights. The clerk serves you at the counter ring (keys 1-6); the ring by the door takes you
back out. You can't go in while the cops are after you.

The minimap and the big map (M) show every shop and place of interest with its own SVG icon
(`src/icons.js`); the big map has a legend.

**Hold-ups:** point a gun at the clerk of a 24/7 or a diner. He puts his hands up and the till
empties while you keep him covered (6 s); look away too long and he hits the alarm. Walking out of a
robbed shop brings two stars, and the till needs a few minutes to fill up again. Ammu-Nation, the
clothes stores and the bank turn you down.

**Sol City Reserve:** the bank downtown (`bank` in the shop list), a marble hall with a teller counter
and the vault door at the back. Nothing to buy; it's where Zara's bank job happens.

## Sol Customs

The Pay 'n' Spray garage in Little Havana doubles as a tuning shop (`src/spray.js`). Drive in with no
cops after you and the door comes down on a menu: respray, engine, brakes and suspension (three levels
each), nitro (hold Shift while driving; the bar under the speedometer refills slowly), tinted windows,
rims (chrome / black / gold) and repair. Upgrades change the car's handling (`tunedSpec` in
`src/vehicles.js`) and look. With the cops after you, the old quick respray still loses them ($100).

## Safehouses

A free flat in Little Havana, a Downtown loft ($12,000) and a South Beach villa ($30,000), blue house
icons on the map (grey while for sale; `src/safehouses.js`). The ring at the door saves the game;
E buys the place, or sleeps 8 hours with your health back. Two marked parking bays at the kerb out
front: a car left standing in one is kept, colour and Sol Customs upgrades included, and is back in
its bay next session.

## Hidden packages

Twenty taped-up parcels are hidden around Sol City: along building walls, on the beaches, up
the slope under the SOL CITY sign and in a park. Each pays $100, every fifth a $500 bonus,
all twenty $5000. Progress is shown on the big map (M). Code: `src/packages.js`.

## Weapons

Pistol, SMG and pump shotgun (`src/weapons.js`, models + hold/aim poses in
`blender/build_character.py` / `blender/build_weapons.py`). Green rings around the city are
weapon pickups (respawn after 45 s). `1`-`4` / `Q` switch, right mouse aims over the shoulder
(two-handed isosceles pistol stance, shouldered long guns), left mouse fires, `R` reloads.
From four stars the police draw their pistols and shoot back. Getting busted costs your guns.
Guns, ammo and armour can also be bought at **Ammu-Nation** (see Shops below).
Red first-aid kits refill your health, blue vests give body armour (it soaks up most of the damage).
Dying costs a $100 hospital bill.

## Story missions

One story in fifteen missions: Nico helps Little Havana, the docks and a crooked lawyer against the Russo brothers,
and ends up working for **Zara**, the woman behind DaCity, the city's new money. Four contacts give the jobs
(yellow letter blips, only the ones with work for you right now): **Rosa** (R, her cafe in Little Havana),
**Vince** (V, his office in an Old Harbor warehouse), **Diaz** (D, her law office Downtown)
and **Zara** (Z, her penthouse in South Beach, skyline window and a wall of DaCity charts). Walk into
the yellow ring at their door: the screen fades and a cutscene plays inside their place (`src/interiors.js`):
letterbox, shot / reverse-shot camera, typed dialogue with mumbled voices, the speaker talking with their hands
and the listener nodding. In one scene per contact they sit at a table or desk. Space / click skips a line.
Three missions per contact, in story order: beat up a racketeer, a timed delivery, torch a rival's car, steal a
supercar without a scratch, stop a snitch's getaway car, grab evidence and shake off the cops, a coffee run to
four cafes against the clock, clear a Russo crew off the pier, pick up five cash bags before the patrols do,
steal the Russos' armored van, a bike run through five drops, and the finale: the crew at the Russo club, then
Marco Russo's getaway car. After that Zara plans the **bank job**: photograph the Sol City Reserve from
three sides, steal a black saloon for the getaway and park it behind the bank, then the heist itself:
three armed guards, twenty seconds of drilling at the vault door, out on the street with three stars and
a getaway to Zara's garage. MISSION PASSED pays out and the progress is saved. During a mission the GPS line follows the streets and ordinary crimes don't raise
your wanted level. Talking / listening clips (sitting and standing) are made in `blender/build_character.py`.

## Police helicopter

From three stars a police helicopter (`blender/build_heli.py`) joins the chase, circles you and keeps
its searchlight on you: as long as the beam is on you, the stars won't fade. It can be shot down.

## Cars: damage, fire, explosions

Crashes and bullets damage cars: grey smoke, then black smoke, then the engine catches fire and the car
explodes a few seconds later (get out!). Explosions throw people and nearby cars around and can set
off a chain reaction; wrecks stay as burnt-out shells. Skidding leaves tyre marks and smoke.
Hydrants, bins, traffic lights and beach umbrellas go flying when a car hits them hard enough (a
hydrant leaves a fountain); they are back in place a while later, once you are far away.
The **Pay 'n' Spray** in Little Havana ($ on the map) repairs and repaints your car for $100 and
makes the police lose you.

## Street races and stunt jumps

Five checkpoint races (R markers, one per district plus the beachfront): drive into the marker, press E, then hit every
checkpoint before the clock runs out. Gold / silver / bronze pay $500 / $300 / $150; best times are kept.
Yellow-black ramps on the beaches (J on the map) are stunt jumps: land them for a stunt bonus,
double the first time.

## Mount Sol and the SOL CITY sign

A big rounded hill rises out of the sea behind Vinewood Hills, with a Hollywood-style **SOL CITY** sign of
white block letters on its slope (softly lit at night). Cars climb the lower slopes (they stall and slide back
where it gets steeper than ~35 degrees); on foot you can walk right up to the letters and look down over the city.

## Smooth running

All shaders are compiled while loading, the sky reflections are rebuilt only when the sky really changes, and
if the game runs below ~24 fps for a few seconds the graphics quality steps down automatically (P picks it
by hand).

The look: ACES tone mapping and bloom, then a filmic grade (an S-curve, warm highlights over cool shadows),
light sharpening, a vignette and a fine film grain. Building walls darken toward the pavement (a cheap
ambient occlusion baked into their material, on every setting); ULTRA adds real screen-space ambient occlusion
([N8AO](https://github.com/N8python/n8ao), at half resolution) for contact shading under cars, in corners and
along the kerbs.

## Weather and time of day

The clock runs one game minute per second, with sunrise, noon, golden hour, dusk and a starry night.
The weather cycles between clear, cloudy, rain and thunderstorms: rain, wet glossy roads (less grip!),
lightning and thunder. After dark the street lamps nearest to you are real lights (they light up walls,
cars and people; ULTRA and HIGH use 6 of them, MEDIUM 4, LOW 2) and car headlights light up the road.

## Side jobs

Every working vehicle waits at its depot (map icons); get in and press `T`. A fresh one turns up at the depot
once you have driven off with it.

- **Paramedic** (ambulance, Sol General Hospital): the injured lie on the pavement (red blips). Stop next to
  them and the crew loads them (three fit), then get them to the hospital before time runs out. One more patient each level.
- **Firefighter** (fire truck, Fire Station 3): cars on fire around town. Hold the mouse button to work the
  roof cannon, which sprays where you look; a fire goes out after a couple of seconds of water (and people in the jet go over).
- **Bus driver** (Sol Transit depot, Downtown): six stops round Downtown, Little Havana and South Beach. Stop in the yellow
  beam, the waiting passengers walk to the door; pay per passenger, a bonus for being on time and for each full round.
- **Trucker** (Port of Sol, west end of the container quay): back the truck up to the trailer to hitch it,
  deliver it across town against the clock; dents come off the pay. The trailer swings out behind on the turns.
- **Tow truck** (City Impound): back up to the broken-down car to hook it (front or back), haul it to the lot.

## Swimming, boats and jetskis

The beach shelves gently into the sea: wade in and he swims once it is chest-deep (front crawl, `Shift`
faster; treading water when you stop). No guns in the water, and nobody follows you in. Swim into a quay or a jetty
to climb out. A car driven into the sea floods. Speedboats and jetskis are tied up along the harbour quay and at the
beach jetty: `F` from the quay or the water to climb aboard. They ride the swell, lift the bow under power,
lean into turns and leave a wake; they can't go up the beach or over the quay.
The sea itself: rolling swell, ripples, clear turquoise over the sand, deep blue further out, surf on the beach.

## Things to do

- **Iron Sol Gym** (Little Havana): treadmill (tap `Space` to hold the pace: stamina, a faster sprint) and
  bench press (hammer `Space`: strength, harder punches). Both are kept between sessions.
- **Club Solar** (South Beach): a rhythm game on the dance floor (arrows / WASD to the beat, tips for a good
  dance) with a dancing crowd, darts against Eddie ($50 to play, $150 if you win), drinks at the bar.
- **Pixel Palace** (Old Harbor): two playable cabinets, SOL INVADERS and NEON SNAKE; a new high score over 300 pays out.
- **Sol Cuts** (barber): haircuts and dyes. **Ink Sol** (tattoo parlour): four designs fitted to the arms, or laser removal.

## Bounty hunting, street events, DaCity ATMs

- The notice board outside the Downtown precinct, next to Diaz's law office, has a wanted man: the yellow area is where he
  was last seen. He runs or shoots; bring him in alive (knock him down, `E` to cuff) for the full bounty, dead for half.
- Random street events: a bag snatcher, a getaway car, a broken-down driver who needs a push (hold `E`), a
  mugging in progress. Help out for a reward.
- DaCity ATMs stand outside the bank and the 24/7 stores: `E` shows your DaCity balance and payouts
  (only when the game runs on the Sol City server).

## Vigilante missions

In a police cruiser press `T`: a getaway car (red blip) flees across the city. Ram it until the engine
catches fire and the driver bails out (or blow it up) before the clock runs out. Every level is faster
and pays more.

## Taxi missions

Get into a taxi and press `T`: pick up the fare marked on the radar, drive them to the
destination (GPS route on the minimap, beam of light on the street) before the meter runs out.
Fare + tip for the time left, $200 bonus for every 5 fares in a row.

## Districts & vehicles

Downtown (glass towers), South Beach (art deco + neon), Little Havana (colourful
shophouses with balconies), Old Harbor (warehouses, container yards), Vinewood Hills
(villas with pools), all on an island of 10 x 10 blocks with three parks, a beach and the Port of Sol container terminal.
Vehicles: sedan, coupe, taxi (lit roof sign at night), supercar, luxury saloon, delivery van, police cruiser and a motorbike (`blender/build_car.py`,
`blender/build_bike.py`), the police helicopter (`blender/build_heli.py`), and the working vehicles and boats
(`blender/build_heavy.py`): ambulance, fire truck, city bus, semi truck and trailer, tow truck, speedboat, jetski.
Car radio: SOL FM plays the CC0 track below, BEAT 102 is a synthwave groove generated live with WebAudio.

## World

- AI traffic drives in the right-hand lanes, turns at random at intersections, stops at red lights and for people, keeps its distance from the car ahead and pulls over for sirens (`src/traffic.js`). You can take any traffic car with F.
- Pedestrians walk around the blocks, cross at the zebra crossings when the lights allow, and get knocked down by cars (`src/peds.js`). They steer around whatever is in their way (you, other people, cars, lamp posts) instead of stopping and queueing behind it.
- Every pedestrian wears one of several real outfits (shirt and jeans, jacket, tee, suit; tee and shorts, blouse and skirt, sports top and leggings) with matching shoes, and gets their own skin and hair colour.
- Street life: friends stop for a chat on the pavement and people sit on the park benches, taking turns talking, then walk on (or run off when something happens).
- Seagulls wheel over the beaches and the park during the day (`src/birds.js`).
- Traffic waits behind a car left standing in its lane, then pulls out and drives round it.
- Both are spawned around the player and removed when far away.

## Trailer

`SolCity_Trailer.mp4` (88 s, 1080p) is the trailer: the whole game, GTA style, with a narrator, cut to its own G-funk
score. It is recorded from the game itself (http://localhost:8080/?hype3) and its sound is generated and mixed in
`trailer/`: see [trailer/README.md](trailer/README.md).

The first one (60 s) is recorded from the game the same way: open http://localhost:8080/?trailer
(frames are saved to `captures/trailer/`), then encode with music (into another file name now). Every shot is a whole number of beats of
the 123 BPM track, so the cuts land on the beat. `?trailer&from=8&to=8` re-records only those shots (the
others are simulated without saving, so the frame numbers stay the same).

```bash
blender -b --factory-startup -P blender/encode_trailer.py -- . vendor/music/cyberpunk_beat_disquantic_cc0.mp3 SolCity_Teaser.mp4
```

`SolCity_Hype.mp4` (70 s) is the fast-cut version with everything in it: open http://localhost:8080/?hype
(`?hype&rec=14,37-44` re-records only those shots), then encode it. It is cut to "Vessel of Eternity" by
tricksntraps (CC0, https://opengameart.org/content/free-rhythm-game-music-pack-1; put `9_vessel_of_eternity.wav` in
`vendor/music/rhythm_pack/`) at 150 BPM from bar 128: every cut lands on a beat (12 frames) and the drop hits at 12.8 s.

```bash
blender -b --factory-startup -P blender/encode_hype.py -- .
```

`SolCity_LastJob.mp4` (80 s) is the second one, "The Last Job": the morning of a bank job (a contact's back
room, the gym, the tattoo parlour, Ammu-Nation, the vault), the alarm, then every part of the game in fast
cuts with glitch titles. Open http://localhost:8080/?hype2 (`?hype2&rec=9,43` re-records only those shots).
It is cut to "The Lab" from the same pack (put `4_the_lab.wav` in `vendor/music/rhythm_pack/`) at 144 BPM
from 253.41 s: a beat is 12.5 frames and the drop hits at 20 s.

```bash
blender -b --factory-startup -P blender/encode_hype.py -- . SolCity_LastJob.mp4 hype2_ 4_the_lab.wav 253.41
```

Music: "Cyberpunk Beat" by Disquantic, https://freesound.org/people/Disquantic/sounds/525290/ (CC0).
The hero is a [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatar (MIT), `src/rbhero.js`
(`?classic` shows the old model). His moves come from three free sources, retargeted onto the avatar in Blender
(`blender/build_rocketbox.py`, run by `blender/build_rb_hero.sh`):

- Rocketbox's own motion capture: idle, walk, run, sprint, talking, listening, dancing (`vendor/rocketbox/`)
- the CMU Graphics Lab Motion Capture Database (http://mocap.cs.cmu.edu, free for any use; BVH conversion by
  github.com/Shriinivas/cmubvh): the boxing stance, jab and cross (take 14_01), the fall (90_18) and getting up
  (113_08), in `vendor/cmu/`
- Quaternius's Universal Animation Library 1 and 2 (CC0, quaternius.com): hits, the jump, the roll, swimming,
  driving, sitting, in `vendor/quaternius/`

None of the source files are in the repository. Actions without a clip of their own (the bike, the gym, the rifles...)
follow the old rig bone by bone; legs and upper body blend separately, and every change of clip is eased.

The people of the city are Rocketbox avatars too (17 of them: men, women, business people, police officers;
`assets/models/people/`, built by `blender/build_people.sh` after `blender/fetch_rocketbox.sh` has downloaded
them), playing the hero's clips: they fight, fall and get up the same way, and the mission contacts are each
always the same person. `?classic` keeps the old models.

People are built from Blender Studio's Human Base Meshes (CC0). The bundle is not in the repository
(~100 MB): to rebuild the characters, download it from https://www.blender.org/download/demo/ and extract it to
`vendor/human_base_meshes/extracted/human-base-meshes-bundle-v1.4.1/`. The finished GLB models are included.

Hair, eyebrows, the NPC outfits and all shoes are MakeHuman system assets (CC0,
https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html). To rebuild, extract
`hair/`, `eyebrows/` and `clothes/` from `makehuman_system_assets_cc0.zip` into `vendor/makehuman/`, and put
MakeHuman's `base.obj` (makehuman/data/3dobjs) and `default_weights.mhw` (makehuman/data/rigs) from
https://github.com/makehumancommunity/makehuman next to them. `build_character.py` fits them to our bodies:
every garment vertex is bound to the MakeHuman base mesh (.mhclo); it is carried bone by bone to our skeleton
(A-pose arms come down to our rest pose), keeps its height over the skin, is smoothed and pushed out of the
skin, and takes the bone weights of the skin under it.

## Rebuilding the 3D models

```bash
blender -b --factory-startup -P blender/build_character.py -- .
blender -b --factory-startup -P blender/build_car.py -- .
blender -b --factory-startup -P blender/build_bike.py -- .
blender -b --factory-startup -P blender/build_heli.py -- .
blender -b --factory-startup -P blender/build_heavy.py -- .
```

Each script writes the GLB to `assets/models/` and a `.blend` file to `blender/`.
Add `--preview <dir>` to also render preview images.
