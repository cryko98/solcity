// HOW TO PLAY on the title screen: everything there is to do in Sol City, in short, by topic.
import { isTouch } from './touch.js';

const css = document.createElement('style');
css.textContent = `
  #howto { position: fixed; inset: 0; z-index: 31; display: none; align-items: center; justify-content: center; background: rgba(4,4,10,.78); padding: 10px; }
  #howto.show { display: flex; }
  #howto .box { width: min(820px, 100%); max-height: 100%; display: flex; flex-direction: column; background: rgba(14,12,22,.96); border: 2px solid rgba(255,179,71,.6);
    border-radius: 12px; padding: 14px 18px; color: #e8e4ef; font: 500 14px Inter, sans-serif; box-shadow: 0 16px 50px rgba(0,0,0,.6); }
  #howto h2 { margin: 0; font: 30px Anton, Impact, sans-serif; letter-spacing: 2px; color: #ffd23f; display: flex; align-items: center; }
  #howto h2 button { margin-left: auto; }
  #howto button { font: 15px Anton, Impact, sans-serif; letter-spacing: 1px; color: #fff; cursor: pointer; border-radius: 7px; padding: 6px 12px;
    background: rgba(0,0,0,.5); border: 2px solid rgba(255,255,255,.4); touch-action: manipulation; }
  #howto button:hover, #howto button.on { border-color: #ffd23f; color: #ffd23f; }
  #howto .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; }
  #howto .page { overflow-y: auto; padding-right: 6px; line-height: 1.5; }
  #howto .page h3 { font: 17px Anton, Impact, sans-serif; letter-spacing: 1px; color: #ffb347; margin: 12px 0 4px; }
  #howto .page h3:first-child { margin-top: 2px; }
  #howto .page ul { margin: 0; padding-left: 18px; }
  #howto .page li { margin: 2px 0; }
  #howto .keys { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; }
  #howto kbd { font: 700 12px Inter, sans-serif; color: #111; background: #ffd23f; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
  #howto b { color: #fff; }
  @media (max-height: 480px) { #howto .box { padding: 8px 12px; } #howto h2 { font-size: 22px; } #howto .tabs { margin: 6px 0; } #howto button { font-size: 13px; padding: 4px 9px; } }`;
document.head.appendChild(css);

const keys = (rows) => `<div class="keys">${rows.map(([k, v]) => `<span>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</span><span>${v}</span>`).join('')}</div>`;

const PAGES = {
  'THE BASICS': () => `
    <h3>Welcome to Sol City</h3>
    <ul>
      <li>An open city by the sea: <b>story missions</b>, <b>side jobs</b>, <b>street races</b>, shops, a gym, a nightclub, beaches and boats, and <b>multiplayer</b> with your friends.</li>
      <li>Walk, drive, swim, fight and shoot your way around; the money you make buys guns, cars, upgrades and houses.</li>
      <li>Your progress (money, guns, armour, missions) is saved in the browser every few seconds.</li>
      <li>Press <kbd>M</kbd> for the city map: every shop, job and contact has its icon. <b>Click the map to set a waypoint</b>: the way there shows on the minimap.</li>
    </ul>
    <h3>On the city's own server</h3>
    <ul>
      <li>Sol City is for holders of <b>at least 10,000 $SOLCITY</b>. Without such a wallet you get <b>5 minutes of free play</b>, then connect one (Phantom) to keep playing.</li>
      <li>Holders also earn <b>DaCity</b> for story missions and races (see MULTIPLAYER &amp; DACITY).</li>
    </ul>`,
  CONTROLS: () => (isTouch()
    ? `<h3>Touch (hold the phone sideways)</h3>${keys([
      ['LEFT-THUMB', 'joystick: walk, push it all the way to sprint; in a car it steers'],
      ['RIGHT-SIDE', 'drag to look around, pinch to zoom'],
      ['FIRE', 'punch / shoot (hold and drag to aim while firing)'],
      ['AIM JUMP ROLL', 'on foot'],
      ['CAR', 'get in / out of the nearest car'],
      ['USE', 'talk, buy, help, open'],
      ['WEAPON RELOAD', 'switch guns, reload'],
      ['GAS BRAKE DRIFT', 'drive; NITRO, HORN, RADIO in a car'],
      ['JOB', 'start the job of a working vehicle (taxi, ambulance, bus...)'],
      ['MAP FULL GFX', 'the map, full screen, graphics quality'],
    ])}`
    : '') + `
    <h3>On foot</h3>${keys([
      ['W A S D', 'move'], ['Shift', 'run'], ['Space', 'jump (while aiming: dodge roll)'], ['C', 'dodge roll'],
      ['Mouse', 'look around (click the game to take the mouse), wheel to zoom'],
      ['Left-click', 'punch, keep clicking for combos / shoot'], ['Right-click', 'aim over the shoulder'],
      ['1 2 3 4 Q', 'switch weapons'], ['R', 'reload'], ['F', 'get in the nearest car (you pull out the driver)'], ['E', 'talk, buy, help, use'],
    ])}
    <h3>In a car</h3>${keys([
      ['W S', 'gas / brake and reverse'], ['A D', 'steer'], ['Space', 'handbrake (drift)'], ['Shift', 'nitro (once fitted at Sol Customs)'],
      ['F', 'get out (at speed you dive out)'], ['R', 'next radio station'], ['G', 'horn'], ['T', 'start the job in a working vehicle'], ['E', 'start a street race at an R marker'],
    ])}
    <h3>Anywhere</h3>${keys([
      ['M', 'city map (click it to set a waypoint)'], ['N', 'skip to night / morning'], ['K', 'change the weather'], ['P', 'graphics quality'], ['H', 'hide / show the help'],
    ])}`,
  STORY: () => `
    <h3>Fifteen missions, one story</h3>
    <ul>
      <li>Nico helps Little Havana, the docks and a crooked cop against the <b>Russo brothers</b>, and ends up working for <b>Zara</b>, the woman behind DaCity.</li>
      <li>Four contacts give the jobs: <b>Rosa</b> (her cafe, Little Havana), <b>Vince</b> (the docks, Old Harbor), <b>Lt. Diaz</b> (Downtown precinct) and <b>Zara</b> (her penthouse, South Beach).</li>
      <li>On the map they are <b>person icons with their name</b>; the ones with work for you now also show on the edge of the minimap. Walk into the <b>yellow ring</b> at their door.</li>
      <li>Missions: beat-ups, timed deliveries, car thefts, chases, shoot-outs, a getaway… and at the end, <b>the bank job</b>.</li>
      <li>Follow the <b>yellow GPS line</b>; <kbd>Space</kbd> / a click moves the dialogue on. During a mission small crimes don't bring the police.</li>
    </ul>`,
  'MAKE MONEY': () => `
    <h3>Side jobs (get in the vehicle, press <kbd>T</kbd>)</h3>
    <ul>
      <li><b>Taxi</b>: pick up fares, drive them before the meter runs out.</li>
      <li><b>Paramedic</b> (Sol General): load the injured, rush them to the hospital.</li>
      <li><b>Firefighter</b> (Fire Station 3): put out burning cars with the roof cannon.</li>
      <li><b>Bus driver</b> (Sol Transit): six stops, on time.</li>
      <li><b>Trucker</b> (Port of Sol): hitch a trailer, deliver it. <b>Tow truck</b> (City Impound): haul broken cars.</li>
      <li><b>Vigilante</b> (in a police cruiser): ram the getaway car until it burns.</li>
    </ul>
    <h3>More ways</h3>
    <ul>
      <li><b>Street races</b>: drive into an R marker, <kbd>E</kbd>, hit every checkpoint. Gold, silver, bronze pay.</li>
      <li><b>Stunt jumps</b>: the yellow-black ramps on the beaches.</li>
      <li><b>Hidden packages</b>: 20 parcels hidden around the city, bonuses every fifth.</li>
      <li><b>Bounties</b>: the notice board by the Downtown precinct; bring the wanted man in alive for the full bounty.</li>
      <li><b>Street events</b>: a purse snatcher, a mugging, a broken-down driver, a getaway car: help for a reward.</li>
      <li><b>Hold-ups</b>: point a gun at the clerk of a 24/7 or a diner and keep him covered while the till empties (the police come after).</li>
      <li>Knocked-out people drop cash; pick it up.</li>
    </ul>`,
  'SPEND IT': () => `
    <ul>
      <li><b>Ammu-Nation</b>: pistol, SMG, shotgun, ammo, body armour. Green rings in the street are free weapons.</li>
      <li><b>Restaurants</b> (Burger Sol, Taco Loco, Pizza Sol): meals heal you. <b>24/7</b>: snacks, first aid, scratch cards.</li>
      <li><b>Sol Threads</b>: new clothes. <b>Sol Cuts</b>: haircuts and dyes. <b>Ink Sol</b>: tattoos.</li>
      <li><b>Sol Customs</b> (Pay 'n' Spray, Little Havana): respray, engine, brakes, suspension, nitro, tinted windows, rims, repair. A respray also loses the cops.</li>
      <li><b>Safehouses</b>: a free flat, a loft, a villa. The door saves the game, the bed heals you, the parking bays keep your cars.</li>
      <li><b>Iron Sol Gym</b>: treadmill for stamina, bench press for harder punches.</li>
      <li><b>Club Solar</b>: dance to the beat, darts against Eddie, drinks. <b>Pixel Palace</b>: two arcade games, high scores pay.</li>
    </ul>`,
  POLICE: () => `
    <ul>
      <li>Crimes seen by someone bring <b>stars</b> (anything done to an officer always counts). More stars, more patrol cars; from 3 a <b>helicopter</b> with a searchlight, from 4 roadblocks and armed officers.</li>
      <li>Lose them: get out of every officer's sight until the stars stop blinking, or drive into the <b>Pay 'n' Spray</b>.</li>
      <li>Caught: <b>BUSTED</b>, a fine and your guns gone. Killed: <b>WASTED</b>, a hospital bill.</li>
      <li>Cars take damage: smoke, then fire, then they explode. Get out in time!</li>
    </ul>`,
  'THE CITY': () => `
    <ul>
      <li>Districts: <b>Downtown</b>, <b>Little Havana</b>, <b>Old Harbor</b>, <b>Vinewood Hills</b>, <b>South Beach</b> and the <b>Port of Sol</b>; up on <b>Mount Sol</b>, the SOL CITY sign.</li>
      <li><b>Swim</b> off the beaches; <b>speedboats and jetskis</b> wait at the harbour and the beach jetty (<kbd>F</kbd>).</li>
      <li>Day and night, sunsets, rain and thunderstorms (wet roads are slippery!). <kbd>N</kbd> skips to night or morning, <kbd>K</kbd> changes the weather.</li>
      <li>People walk, chat, sit on benches; traffic stops at the lights. Any car can be yours: pull the driver out and they run off (if anyone sees it, the police come).</li>
    </ul>`,
  'MULTIPLAYER & DACITY': () => `
    <h3>Multiplayer</h3>
    <ul>
      <li>For holders of <b>at least 10,000 $SOLCITY</b>: connect your Phantom wallet (you only sign a message, no funds move) and pick a <b>username</b>; the others see it over your head.</li>
      <li><b>MULTIPLAYER LOBBY</b>: join the public lobby, or create a private room and send its code to your friends. Chat, press READY; the host starts the game for everyone.</li>
      <li>You start side by side in the same city and see each other walking, fighting, swimming and driving.</li>
    </ul>
    <h3>DaCity</h3>
    <ul>
      <li>Holders earn <b>DaCity</b> tokens: each story mission pays once, street races a little every day (daily limits apply).</li>
      <li>Connect your wallet with the DACITY chip at the top right; the <b>DaCity ATMs</b> by the bank and the 24/7 stores show your balance and payouts.</li>
      <li>In-game dollars stay in the game; only DaCity is real.</li>
    </ul>`,
};

const el = document.createElement('div');
el.id = 'howto';
el.innerHTML = `<div class="box"><h2>HOW TO PLAY <button data-a="close">✕</button></h2><div class="tabs">${Object.keys(PAGES).map((n, i) => `<button data-p="${n}" class="${i ? '' : 'on'}">${n}</button>`).join('')}</div><div class="page"></div></div>`;
document.body.appendChild(el);
// nothing in it reaches the game (the title screen's click starts it)
for (const ev of ['click', 'touchstart', 'mousedown', 'keydown', 'keyup']) el.addEventListener(ev, (e) => e.stopPropagation());
const page = el.querySelector('.page');
const show = (name) => {
  page.innerHTML = PAGES[name]();
  page.scrollTop = 0;
  el.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === name));
};
el.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return e.target === el && el.classList.remove('show');
  if (t.dataset.a === 'close') el.classList.remove('show');
  else if (t.dataset.p) show(t.dataset.p);
});
addEventListener('keydown', (e) => e.key === 'Escape' && el.classList.remove('show'));

export function openHowTo() {
  show(Object.keys(PAGES)[0]);
  el.classList.add('show');
}
