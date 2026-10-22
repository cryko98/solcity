import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildCity } from './city.js';
import { Player } from './player.js';
import { Vehicles } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { Input } from './input.js';
import { FollowCamera } from './camera.js';
import { Hud } from './hud.js';
import { CarAudio } from './audio.js';
import { Wanted, Police } from './police.js';
import { TaxiMissions } from './taxi.js';
import { Weapons } from './weapons.js';
import { Fx } from './fx.js';
import { Environment } from './environment.js';
import { PaySpray } from './spray.js';
import { Races } from './races.js';
import { Radio } from './radio.js';
import { Stunts } from './stunts.js';
import { Packages } from './packages.js';
import { Birds } from './birds.js';
import { PoliceHeli } from './heli.js';
import { Shops } from './shops.js';
import { Vigilante } from './vigilante.js';
import { Story } from './story.js';
import { DaCity } from './dacity.js';
import { CarEntry } from './carentry.js';

const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const overlay = document.getElementById('overlay');
const help = document.getElementById('help');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);

// ------------------------------------------------------------------ post-processing
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 2 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// final touch: soft vignette and a hint of contrast (after tone mapping)
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - strength * smoothstep(0.25, 0.8, dot(d, d) * 2.2);
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.18) * v;
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);

// red / blue flashers that follow the nearest patrol car (fixed light count: no shader recompiles)
const sirenLights = [new THREE.PointLight(0xff2020, 0, 26, 2), new THREE.PointLight(0x2050ff, 0, 26, 2)];
scene.add(...sirenLights);

// driven car headlights
const headlight = new THREE.SpotLight(0xfff1d6, 0, 45, 0.55, 0.45, 1.2);
const headTarget = new THREE.Object3D();
scene.add(headlight, headTarget);
headlight.target = headTarget;

// shop signs are drawn with the Anton web font
await document.fonts.load('38px Anton').catch(() => {});
const city = buildCity(scene);
let hud = null;
const audio = new CarAudio();
const env = new Environment({ scene, renderer, bloom, city, audio });
const fx = new Fx(scene, city);
const radio = new Radio(audio);
const viewH = () => renderer.getDrawingBufferSize(new THREE.Vector2()).y;
fx.setViewport(viewH());
let night = env.night;

// ------------------------------------------------------------------ game objects
const mainInput = new Input(renderer.domElement);
// while a cutscene plays the game sees no input at all
const NO_INPUT = { down: () => false, pressed: () => false, mouse: () => false, consumeMouse: () => ({ dx: 0, dy: 0, wheel: 0 }), pressedOnce: new Set(), keys: new Set() };
const follow = new FollowCamera(camera, city);
let player = null;
let vehicles = null;
let traffic = null;
let peds = null;
let driving = null; // car data entry while in a car
let police = null;
let taxiJobs = null;
let weapons = null;
let spray = null;
let races = null;
let stunts = null;
let heli = null;
let shop = null;
let vigilante = null;
let story = null;
let dacity = null;
let packages = null;
let birds = null;
let entry = null;
let savedStory = null;
const stats = { km: 0, wrecks: 0, uniqueJumps: 0, races: 0, fares: 0, suspects: 0, maxWanted: 0 };
let gunfireCooldown = 0;
let crashCooldown = 0;
const wanted = new Wanted();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  fx.setViewport(viewH());
});

const loader = new GLTFLoader();
const manager = { total: 13, done: 0 };
// bump when the models are rebuilt, so no browser keeps showing an old cached copy
const ASSET_VERSION = '2026-10-23e';
const load = (url, optional = false) =>
  new Promise((res, rej) =>
    loader.load(url + '?v=' + ASSET_VERSION, (g) => {
      manager.done++;
      loadingBar.style.width = `${Math.round((manager.done / manager.total) * 100)}%`;
      res(g);
    }, undefined, (err) => {
      // optional models (newer vehicles, police officer) fall back gracefully
      if (optional) {
        console.warn('optional model missing:', url);
        res(null);
      } else rej(err);
    })
  );

Promise.all([
  load('assets/models/protagonist.glb'), load('assets/models/car_sedan.glb'), load('assets/models/car_coupe.glb'),
  load('assets/models/npc_male.glb'), load('assets/models/npc_female.glb'),
  load('assets/models/car_van.glb', true), load('assets/models/car_police.glb', true), load('assets/models/car_bike.glb', true),
  load('assets/models/npc_police.glb', true),
  load('assets/models/car_taxi.glb', true), load('assets/models/car_super.glb', true), load('assets/models/car_lux.glb', true),
  load('assets/models/heli_police.glb', true),
])
  .then(([hero, sedan, coupe, npcMale, npcFemale, van, policeCar, bike, npcPolice, taxi, superCar, lux, heliModel]) => {
    player = new Player(hero, city);
    player.position.copy(city.spawn);
    player.yaw = city.spawnYaw;
    player.object.rotation.y = player.yaw;
    follow.yaw = city.spawnYaw;
    follow.zoom = follow.mode.zoom;
    follow.pitch = follow.mode.pitch;
    scene.add(player.object);
    const carModels = Object.fromEntries(Object.entries({ sedan, coupe, van, police: policeCar, bike, taxi, super: superCar, lux }).filter(([, g]) => g));
    vehicles = new Vehicles(scene, city, carModels);
    traffic = new Traffic(city, vehicles);
    peds = new Peds(scene, city, hero, { male: npcMale, female: npcFemale, police: npcPolice }, vehicles);
    hud = new Hud(city);
    police = new Police(city, vehicles, peds);
    taxiJobs = new TaxiMissions(scene, city, peds, hud, audio);
    weapons = new Weapons({ scene, city, player, peds, vehicles, hud, audio, camera, follow, heroScene: hero.scene });
    weapons.worldFx = fx;
    vehicles.fx = fx;
    spray = new PaySpray({ city, hud, audio, wanted });
    races = new Races({ scene, city, hud, audio });
    stunts = new Stunts({ scene, city, hud, audio });
    packages = new Packages({ scene, city, hud, audio, stunts });
    birds = new Birds({ scene, city, env });
    packages.onFound = (n) => (stats.packages = n);
    stats.packages = packages.count;
    shop = new Shops({ scene, city, hud, audio, weapons, player, env, follow, peds, wanted, models: { male: npcMale, female: npcFemale } });
    vigilante = new Vigilante({ city, vehicles, hud, audio });
    story = new Story({ scene, city, peds, vehicles, hud, audio, wanted, player, fx, camera, weapons, env, follow, getDriving: () => driving });
    story.onSave = () => saveGame();
    // DaCity rewards (only when the game runs on the Sol City server, see server/README.md)
    dacity = new DaCity({ hud });
    story.dacity = dacity;
    story.shop = shop;
    shop.onBuy = (b, it) => {
      if (b.type === 'gun' && it.it?.key !== 'armor') story.boughtGun = true; // a gun or ammo, not a vest
    };
    story.onMissionStart = (id) => dacity.start('story', id);
    story.onMissionEnd = (id, passed) => dacity.finish(passed);
    races.onStart = (r) => dacity.start('race', r.id);
    races.onAbandon = () => dacity.finish(false);
    entry = new CarEntry({ player, peds, city, audio, hud });
    entry.onEntered = (c) => seatPlayer(c);
    entry.onExited = (c, bailed) => {
      const v = c.vehicle;
      v.driven = false;
      driving = null;
      exitQueued = false;
      follow.setMode('foot');
      if (bailed) {
        follow.shake = 0.35;
        hud.setHealth(player.health);
      }
    };
    entry.onJack = (c) => wanted.crime(c.ai?.police ? 'ram_cop' : 'carjack');
    story.exitCar = () => {
      if (!driving) return;
      exitQueued = false;
      exitVehicle();
    };
    story.load(savedStory);
    story.entry = entry;
    // stars gone (lost them, paint shop): officers on foot stand down
    const onWanted = wanted.onChange;
    wanted.onChange = (l) => {
      onWanted?.(l);
      if (!l) peds.standDown();
    };
    hud.stats = stats;
    stunts.onStunt = () => (stats.uniqueJumps = stunts.doneCount);
    races.onFinish = () => {
      stats.races++;
      dacity.finish(true);
    };
    races.onCheckpoint = () => dacity.mark();
    vigilante.onStopped = () => stats.suspects++;
    taxiJobs.onFare = () => stats.fares++;
    if (heliModel) {
      heli = new PoliceHeli({ scene, gltf: heliModel, city, audio, fx });
      weapons.heli = heli;
      // shot down: a blast where it lands, and the cops are furious
      heli.onDown = (p) => {
        const dCam = camera.position.distanceTo(p);
        audio.explosion(Math.max(0.2, 1 - dCam / 160));
        follow.shake = Math.max(follow.shake, Math.min(1, 9 / (dCam + 4)));
        blast(p, null);
        wanted.crime('ko_cop');
        hud.say('You shot down the police chopper!', 3);
      };
    }
    hud.setArmor(0);
    loadGame();
    setInterval(saveGame, 10000);
    addEventListener('visibilitychange', () => {
      if (document.hidden) saveGame();
      // nothing is updated in the background: don't leave engine, siren or radio droning on
      if (document.hidden) {
        audio.ctx?.suspend?.();
        radio.track?.pause();
      } else audio.ctx?.resume?.();
    });
    addEventListener('pagehide', saveGame);
    vehicles.onExplode = explosion;
    vehicles.onFire = (c) => {
      const v = c.vehicle;
      if (v.driven) hud.say('Your car is on fire! <em>Get out!</em>', 3);
      else if (c.ai && !c.ai.police && v.npcDriver) {
        // the driver bails out and runs
        peds.unseatDriver(v);
        c.ai = null;
        peds.spawnFleeing(v.pos.x + Math.cos(v.heading) * 1.6, v.pos.z - Math.sin(v.heading) * 1.6, v.pos);
      }
    };
    vehicles.onCrash = (x, z, speed) => {
      if (Math.hypot(x - camera.position.x, z - camera.position.z) > 60) return;
      fx.sparks({ x, y: city.groundHeight(x, z) + 0.55, z }, speed > 9 ? 12 : 5);
      if (crashCooldown <= 0) {
        crashCooldown = 0.2;
        audio.crash(speed * Math.max(0.2, 1 - Math.hypot(x - camera.position.x, z - camera.position.z) / 60));
      }
    };
    player.onStep = (run) => {
      audio.step(run, env.wet);
      if (env.wet > 0.4) fx.splash(player.position.x, player.position.y, player.position.z, run ? 3 : 1);
    };
    player.onLand = (v) => {
      if (v < 5) return;
      audio.land(v);
      follow.shake = Math.max(follow.shake, Math.min(0.12, v * 0.01));
    };
    peds.onCopFire = (p) => weapons.copFire(p);
    // gunfire is heard far away and bystanders scatter, but shots into the air, a wall or the
    // street are no crime: only hitting a vehicle (seen or heard) is. Hitting a person is
    // reported by the peds themselves.
    weapons.onShot = (pos, struck) => {
      peds.scare(pos.x, pos.z, null, 35);
      if (!struck || gunfireCooldown > 0) return;
      gunfireCooldown = 2;
      if (peds.witnesses(pos, 45).n > 0 || police.units.some((u) => police.visible(u.c.vehicle.pos, pos, 80))) wanted.crime('gunfire');
    };
    // crimes against civilians count only when someone sees them; officers are always witnesses
    peds.onCrime = (type, victim) => {
      if (type.endsWith('_cop') || witnessed(victim, victim)) wanted.crime(type);
    };
    // boxing: auto-aim at whoever is in front, land the punch at the right frame
    player.findTarget = () => peds.target(player.position, player.yaw);
    player.onPunch = () => {
      if (peds.punch(player.position, player.yaw)) {
        audio.punch();
        follow.shake = 0.06;
      } else audio.swing();
    };
    player.onHurt = () => {
      audio.punch();
      follow.shake = 0.12;
      hud.setHealth(player.health);
      hud.setArmor(player.armor);
    };
    player.onDeath = () => {
      slowmo = 2.6;
      wanted.clear();
      police.clear();
      hud.wasted(true);
      setTimeout(() => {
        player.respawn(city.spawn, city.spawnYaw);
        follow.yaw = city.spawnYaw;
        follow.zoom = follow.mode.zoom;
        follow.pitch = follow.mode.pitch;
        peds.calm();
        hud.setHealth(100);
        hud.setArmor(0);
        hud.wasted(false);
        // the hospital sends a bill
        const bill = Math.min(hud.money, 100);
        if (bill) {
          hud.addMoney(-bill);
          hud.say(`Hospital bill: <em>$${bill}</em>`, 3);
        }
      }, 4500);
    };
    peds.onCash = (amount) => {
      hud.addMoney(amount);
      audio.cash();
    };
    // compile every shader now, so nothing stalls the first time it comes into view
    renderer.compile(scene, camera);
    loadingText.textContent = 'Click to play';
    overlay.classList.add('ready');
    window.__game = {
      player, city, follow, camera, renderer, scene, input: mainInput, story: () => story, vehicles, traffic, peds, composer, bloom, audio, police, wanted, taxi: () => taxiJobs, weapons: () => weapons,
      env, fx, spray: () => spray, packages: () => packages, races: () => races, stunts: () => stunts, heli: () => heli, vigilante: () => vigilante, shop: () => shop, entry: () => entry, dacity: () => dacity, hud, radio,
      state: () => ({ driving }),
      step,
      render: () => composer.render(),
      setNight: (n) => {
        env.setTime(n ? 23 : 17, 30);
        env.setWeather('clear', true);
      },
      toggleVehicle,
      seat: (c) => seatPlayer(c),
      exit: () => exitVehicle(),
      setCinematic: (fn) => (cinematic = fn),
      resize: (w, h) => {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        composer.setPixelRatio(1);
        composer.setSize(w, h);
        fx.setViewport(h);
      },
    };
    if (new URLSearchParams(location.search).has('trailer')) import('./trailer.js');
  })
  .catch((err) => {
    loadingText.textContent = 'Could not load the 3D models. Run the game through a local server (see README).';
    console.error(err);
  });

overlay.addEventListener('click', () => {
  if (!player) return;
  overlay.classList.add('hidden');
  audio.start();
  renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  showTips();
});

// first time after the big update: a few tips about what's new, one every few seconds
const TIPS = [
  'Press <em>M</em> for the city map: races (R), stunt jumps (J), Pay \'n\' Spray ($), Ammu-Nation (G).',
  'Shoot or crash a car enough and it catches fire, then explodes. Get out in time!',
  'Press <em>C</em> to dodge roll. Red kits heal, blue vests are body armor.',
  'From three stars a police helicopter hunts you with its searchlight. It can be shot down.',
  'In a car: <em>R</em> changes the radio station. In a police car, <em>T</em> starts vigilante missions.',
  'Weather and time change by themselves. <em>K</em> weather, <em>N</em> skip time, <em>P</em> graphics quality.',
];
let tipsShown = false;
function showTips() {
  if (tipsShown) return;
  tipsShown = true;
  try {
    if (localStorage.getItem('solcity.tips') === '2') return;
    localStorage.setItem('solcity.tips', '2');
  } catch {}
  TIPS.forEach((t, i) => setTimeout(() => hud.say(t, 6), 2500 + i * 7000));
}

let exitQueued = false;
function exitVehicle() {
  if (entry.active) entry.cancel();
  if (!driving) return;
  const v = driving.vehicle;
  v.driven = false;
  player.exitVehicle();
  player.collide(player.position);
  vehicles.collideCircle(player.position, 0.32);
  driving = null;
  follow.setMode('foot');
  follow.yaw = v.heading;
  exitQueued = false;
}

// is a crime at pos seen by anyone (people nearby, or a patrol that can see it)?
function witnessed(pos, victim) {
  const w = peds.witnesses(pos, 28);
  const others = w.n - (victim && victim.state !== 'down' ? 1 : 0);
  return others > 0 || w.cop || police.units.some((u) => police.visible(u.c.vehicle.pos, pos, 60));
}

function toggleVehicle() {
  if (entry?.active) {
    // changed your mind on the way to the door
    if (entry.steering) entry.cancel();
    return;
  }
  if (driving) {
    const v = driving.vehicle;
    // going fast: jump out and roll; otherwise brake to a stop and climb out
    if (v.speed > 7) entry.bail(driving);
    else exitQueued = true;
    return;
  }
  if (player.busted || player.dead || player.overlay) return;
  const c = vehicles.nearest(player.position, 6);
  if (!c) return;
  if (c.vehicle && c.vehicle.speed > 9) return; // too fast to catch
  if (!c.ai && !c.owned) {
    // stealing a parked car is only a crime if an officer sees it
    const w = peds.witnesses(player.position, 30);
    if (w.cop || police.units.some((u) => police.visible(u.c.vehicle.pos, player.position, 60))) wanted.crime('theft');
  }
  const v = vehicles.activate(c);
  // motorbikes: straight on; cars: walk to the door, open it (drag the driver out), get in
  if (v.spec.bike) {
    if (c.ai) {
      peds.unseatDriver(v);
      peds.spawnFleeing(v.pos.x + Math.cos(v.heading) * 1.4, v.pos.z - Math.sin(v.heading) * 1.4, player.position);
      wanted.crime(c.ai.police ? 'ram_cop' : 'carjack');
    }
    seatPlayer(c);
    return;
  }
  entry.enter(c);
}

// in the seat: the car is ours now
function seatPlayer(c) {
  const v = vehicles.activate(c);
  if (c.ai && !c.ai.police) c.ai = null;
  if (v.npcDriver) peds.unseatDriver(v);
  v.driven = true;
  driving = c;
  player.enterVehicle(v);
  follow.setMode('car');
  follow.yaw = v.heading;
}

let rammedCooldown = 0;
let driverTimer = 0;

// ------------------------------------------------------------------ graphics quality (P)
// resolution scale and shadow-map size; HIGH is the default look, LOW for weak integrated GPUs
const QUALITY = [
  { name: 'HIGH', ratio: 1.25, shadow: 2048, lamps: 6 },
  { name: 'MEDIUM', ratio: 0.9, shadow: 2048, lamps: 4 },
  { name: 'LOW', ratio: 0.75, shadow: 1024, lamps: 2 },
];
let quality = 0;
let autoQuality = true;
try {
  quality = Math.min(QUALITY.length - 1, Math.max(0, parseInt(localStorage.getItem('solcity.quality'), 10) || 0));
} catch {}
function setQuality(q, announce, auto = false) {
  if (!auto) autoQuality = false;
  quality = q;
  const Q = QUALITY[q];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.ratio));
  composer.setPixelRatio(renderer.getPixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  const sh = env.sun.shadow;
  if (sh.mapSize.x !== Q.shadow) {
    sh.mapSize.set(Q.shadow, Q.shadow);
    sh.map?.dispose();
    sh.map = null;
  }
  fx.setViewport(viewH());
  env.setLampLights(Q.lamps);
  try {
    localStorage.setItem('solcity.quality', String(q));
  } catch {}
  if (announce) hud?.say(`Graphics: <em>${Q.name}</em>${auto ? ' (auto, P to change)' : ''}`, 3);
}
if (quality) setQuality(quality, false, true);

// ------------------------------------------------------------------ save game
const SAVE_KEY = 'solcity.save';
function saveGame() {
  if (!player || window.__trailer) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, money: hud.money, inv: weapons.inv, current: weapons.current, armor: player.armor, time: env.minutes, stats, story: story?.progress }));
  } catch {}
}
function loadGame() {
  if (new URLSearchParams(location.search).has('trailer')) return;
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {}
  if (!s || s.v !== 1) return;
  hud.setMoney(s.money ?? 500);
  if (s.inv) {
    weapons.inv = s.inv;
    weapons.equip(s.inv[s.current] ? s.current : null);
  }
  player.armor = s.armor || 0;
  hud.setArmor(player.armor);
  if (s.time != null) env.minutes = s.time;
  if (s.stats) Object.assign(stats, s.stats);
  savedStory = s.story;
  story?.load(s.story);
  stats.uniqueJumps = stunts.doneCount;
  stats.packages = packages.count;
  hud.say('Welcome back to <em>Sol City</em>.', 3);
}

// a car blew up: shake, sound, people and cars nearby are thrown, the driver doesn't make it
function explosion(c) {
  const v = c.vehicle, p = v.pos;
  stats.wrecks++;
  const dCam = Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
  audio.explosion(Math.max(0.15, 1 - dCam / 140));
  follow.shake = Math.max(follow.shake, Math.min(0.9, 7 / (dCam + 4)));
  if (v.npcDriver) peds.unseatDriver(v);
  if (driving && driving.vehicle === v) {
    exitQueued = false;
    exitVehicle();
    player.takeHit(999, p);
  }
  blast(p, c);
}

// area damage around an explosion: people thrown, cars pushed and set alight, the player hurt
function blast(p, c) {
  for (const q of [...peds.list]) {
    if (q.state === 'down' || q.state === 'riding') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d < 7.5) peds.knockOut(q, (dx / (d || 1)) * 7, (dz / (d || 1)) * 7, false);
    else if (d < 30) peds.scare(p.x, p.z, null, 30);
  }
  for (const o of [...vehicles.cars]) {
    if (o === c || o.wrecked) continue;
    const [x, z] = vehicles.pose(o);
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > 8) continue;
    const ov = vehicles.activate(o);
    const k = 1 - d / 8;
    ov.vel.x += (dx / (d || 1)) * 9 * k;
    ov.vel.z += (dz / (d || 1)) * 9 * k;
    ov.angVel += (Math.random() - 0.5) * 3 * k;
    ov.hopV = Math.max(ov.hopV, 3.5 * k);
    ov.damage(60 * k * k);
  }
  if (player.dead) return;
  const pd = Math.hypot(player.position.x - p.x, player.position.z - p.z);
  if (pd < 8 && !player.dead) {
    const dmg = 140 * (1 - pd / 8);
    if (driving) {
      player.health = Math.max(1, player.health - dmg * 0.3);
      hud.setHealth(player.health);
    } else {
      player.takeHit(dmg, p);
      if (!player.dead && pd < 6) player.knockDown(p, 1.8);
    }
  }
}

// arrested: hands up, pay a fine, start over at the spawn point
function bust() {
  if (entry.active) entry.cancel();
  if (driving) {
    exitQueued = false;
    exitVehicle();
  }
  player.surrender();
  slowmo = 2.2;
  // arrested: the police take your guns
  weapons.inv = {};
  weapons.equip(null);
  hud.wasted(true, 'BUSTED');
  const fine = -Math.min(hud.money, Math.round(100 + hud.money * 0.1));
  setTimeout(() => {
    player.respawn(city.spawn, city.spawnYaw);
    follow.yaw = city.spawnYaw;
    follow.zoom = follow.mode.zoom;
    follow.pitch = follow.mode.pitch;
    wanted.clear();
    police.clear();
    peds.calm();
    hud.setHealth(100);
    hud.wasted(false);
    if (fine) hud.addMoney(fine);
  }, 4000);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let elapsed = 0;
const tmp = new THREE.Vector3();

let cinematic = null; // trailer mode: (camera) => void, overrides the follow camera

// automatic quality: if the game runs below ~24 fps for a few seconds, drop the resolution
// a step (until the player picks a quality with P)
let perfT = 0, perfN = 0, perfWarm = 0;
function measure(raw) {
  if (raw > 0.25) return void (perfWarm = perfT = perfN = 0); // tab was in the background
  if (!player || !overlay.classList.contains('hidden') || document.hidden || story?.cutscene) return void (perfWarm = 0);
  if ((perfWarm += raw) < 6) return; // let shaders and textures settle first
  perfT += raw;
  perfN++;
  if (perfT < 5) return;
  const fps = perfN / perfT;
  perfT = perfN = 0;
  if (autoQuality && fps < 24 && quality < QUALITY.length - 1) setQuality(quality + 1, true, true);
}

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  const dt = Math.min(raw, 1 / 20);
  if (window.__trailer) return; // the trailer recorder steps the game itself
  measure(raw);
  step(dt);
  composer.render();
}

// WASTED / BUSTED: the world slows down and the camera pulls up and away
let slowmo = 0;
function step(dt) {
  const input = story && story.cutscene ? NO_INPUT : mainInput;
  if (slowmo > 0) {
    slowmo -= dt;
    dt *= 0.3;
    follow.zoom += (9.5 - follow.zoom) * Math.min(1, dt * 2);
    follow.pitch += (0.75 - follow.pitch) * Math.min(1, dt * 1.5);
    follow.idleTime = -1;
  }
  elapsed += dt;
  city.update(elapsed);

  if (player) {
    if (input.pressed('KeyN')) env.skipTime();
    if (input.pressed('KeyK')) {
      env.cycleWeather();
      hud.say(`Weather: <em>${env.weather}</em>`, 2);
    }
    if (input.pressed('KeyH')) help.classList.toggle('hidden');
    if (input.pressed('KeyM')) hud.toggleMap();
    if (input.pressed('KeyP')) setQuality((quality + 1) % QUALITY.length, true);
    if (input.pressed('KeyF') || input.pressed('Enter')) toggleVehicle();

    // stopped: climb out (motorbikes: just step off)
    if (driving && exitQueued && driving.vehicle.speed < 1.5) {
      if (driving.vehicle.spec.bike || !driving.vehicle.doorMesh) exitVehicle();
      else if (!entry.active) {
        exitQueued = false;
        entry.exit(driving);
      }
    }
    entry.update(dt);
    // a hard crash throws you off a motorbike
    if (driving && driving.vehicle.spec.bike && driving.vehicle.impact > 7) {
      const v = driving.vehicle;
      exitVehicle();
      player.knockDown(v.pos);
      player.health = Math.max(1, player.health - 15);
      hud.setHealth(player.health);
      follow.shake = 0.4;
    }
    // brake to a stop: getting out, inside the paint shop, on the start line
    const hold = spray.busy || races.holdCar;
    const ctl = driving && (exitQueued || hold)
      ? { throttle: Math.abs(driving.vehicle.vf) < 0.3 ? 0 : driving.vehicle.vf > 0 ? -1 : 1, steer: 0, handbrake: true }
      : driving
      ? {
          throttle: (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0),
          steer: (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0),
          handbrake: input.down('Space'),
        }
      : null;
    // in a contact's room (far outside the map) the street outside stays populated
    const focusPos = driving ? driving.vehicle.pos : story.cutscene && story.cut.c.stand ? story.cut.c.stand : shop.inside ? shop.inside.door : player.position;
    const people = peds.obstacles;
    traffic.update(dt, focusPos, driving ? people : [...people, player.position]);
    vehicles.wet = env.wet;
    vehicles.update(dt, driving, ctl, night, camera.position);
    stunts.update(dt, vehicles, driving?.vehicle ? driving : null);
    packages.update(dt, driving ? driving.vehicle.pos : player.position);
    birds.update(dt);
    crashCooldown -= dt;
    if (driving) stats.km += (driving.vehicle.speed * dt) / 1000;
    stats.maxWanted = Math.max(stats.maxWanted, wanted.level);
    gunfireCooldown -= dt;
    shop.update(dt, input, !driving && !player.dead && !player.busted);
    weapons.update(dt, entry.active ? NO_INPUT : input, { onFoot: !driving && !player.dead && !player.busted && !entry.active });
    player.aimPitch = follow.viewPitch;
    // walking to a car door: the entry sequence steers the hero
    player.update(dt, entry.steering ? entry.input : entry.active ? NO_INPUT : input, entry.steering ? entry.yaw : follow.yaw, vehicles, peds);
    // health slowly comes back once you're out of a fight
    if (!player.dead && player.health < 100 && player.guardTimer < -6) {
      player.health = Math.min(100, player.health + 4 * dt);
      hud.setHealth(player.health);
    }
    peds.hurry = env.rain;
    peds.update(dt, focusPos, player);
    // NPCs at the wheel of traffic / patrol cars near the camera
    if ((driverTimer -= dt) <= 0) {
      driverTimer = 0.4;
      for (const c of vehicles.active) {
        const v = c.vehicle;
        // hands off while the hero is climbing in: the driver is his to drag out
        if (c.entering) continue;
        const near = (v.pos.x - camera.position.x) ** 2 + (v.pos.z - camera.position.z) ** 2 < 60 * 60;
        const wantDriver = c.ai && near && !v.driven && !(c.ai.police && v.officersOut);
        if (wantDriver && !v.npcDriver) peds.seatDriver(v, c.ai.police ? 'police' : Math.random() < 0.4 ? 'female' : 'male');
        else if (!wantDriver && v.npcDriver && !v.driven) {
          if (c.ai || !near) peds.unseatDriver(v);
          else if (v.speed < 1) {
            peds.unseatDriver(v);
            peds.spawnFleeing(v.pos.x + Math.cos(v.heading) * 1.4, v.pos.z - Math.sin(v.heading) * 1.4, player.position);
          }
        }
      }
    }
    peds.updateDrivers(dt);

    // police: ramming a patrol car is a crime, sightings keep the wanted level, arrests
    if (driving && driving.vehicle.impact > 4 && (rammedCooldown -= dt) <= 0) {
      const v = driving.vehicle;
      if (police.units.some((u) => Math.hypot(u.c.vehicle.pos.x - v.pos.x, u.c.vehicle.pos.z - v.pos.z) < 6)) {
        wanted.crime('ram_cop');
        rammedCooldown = 1.5;
      }
    }
    if (!player.dead && !player.busted) {
      if (police.update(dt, wanted, player) === 'busted') bust();
      wanted.update(dt, police.seen || (heli && heli.seen));
    }
    if (heli) heli.update(dt, { level: wanted.level, target: driving ? driving.vehicle.pos : player.position, nightK: env.nightK, camera });
    if (!races.active && !story.active) taxiJobs.update(dt, { player, driving, input, wanted });
    races.dim = env.nightK;
    races.update(dt, { driving, input, wanted, blocked: taxiJobs.state !== 'off' || vigilante.state !== 'off' || story.active, dead: player.dead || player.busted });
    spray.update(dt, driving);
    if (!races.active && !story.active) vigilante.update(dt, { driving, input, dead: player.dead || player.busted });
    wanted.frozen = !!story.mission || !!shop.inside;
    story.update(dt, mainInput, { busy: races.active || taxiJobs.state !== 'off' || vigilante.state !== 'off' });
    dacity.update(dt, driving ? driving.vehicle.pos : player.position, !!shop.inside || !!story.cut);
    radio.update(dt, !!driving && !player.dead, input);
    // horn: people in front of the car jump out of the way
    const honk = !!driving && input.down('KeyG');
    audio.horn(honk);
    if (honk) {
      const v = driving.vehicle;
      peds.scare(v.pos.x + Math.sin(v.heading) * 6, v.pos.z + Math.cos(v.heading) * 6, null, 9);
    }
    if (!races.active) hud.poiBlips = [...(hud.poiBlips || []).filter((b) => b.kind !== 'stunt' && b.kind !== 'shop' && !b.story), ...stunts.blips(), ...shop.blips(), ...story.blips.map((b) => ({ ...b, story: true }))];
    hud.setWanted(wanted.level, wanted.flashing, elapsed);
    audio.siren(Math.min(police.nearestSiren(focusPos), ...(traffic.sirens || []).map((v) => Math.hypot(v.pos.x - focusPos.x, v.pos.z - focusPos.z))));
    let near = null, nd = 90;
    for (const v of traffic.sirens || []) {
      const d = v && v.siren ? Math.hypot(v.pos.x - focusPos.x, v.pos.z - focusPos.z) : Infinity;
      if (d < nd) [near, nd] = [v, d];
    }
    sirenLights.forEach((l, i) => {
      if (!near) return void (l.intensity = 0);
      const ph = Math.floor(near.sirenT * 6) % 4;
      const sx = i === 0 ? 0.4 : -0.4;
      l.position.set(near.pos.x + Math.cos(near.heading) * sx, 1.9, near.pos.z - Math.sin(near.heading) * sx);
      l.intensity = (i === 0) === ph < 2 ? (night ? 26 : 12) : 0;
    });

    let subject, focus;
    if (driving) {
      const v = driving.vehicle;
      subject = { position: v.object.position, yaw: v.heading, speed: v.vf };
      focus = v.pos;
      if (v.impact > 3) follow.shake = Math.min(0.5, v.impact * 0.04);
      audio.update(true, v.vf, v.spec.vmax, v.throttle, v.slip);
      // headlight beam at night
      headlight.intensity = night ? 60 : 0;
      tmp.set(Math.sin(v.heading), 0, Math.cos(v.heading));
      headlight.position.copy(v.pos).addScaledVector(tmp, 2.2).setY(0.8);
      headTarget.position.copy(v.pos).addScaledVector(tmp, 14).setY(0);
    } else {
      subject = { position: player.position, yaw: player.yaw, speed: player.speed };
      focus = player.position;
      audio.update(false, 0, 1, 0, 0);
      headlight.intensity = 0;
    }
    follow.update(dt, input, subject);
    if (story.cutscene) {
      story.cameraShot(camera);
      mainInput.consumeMouse(); // no camera jump after the scene
    }
    if (cinematic) cinematic(camera, dt);
    env.update(dt, focus, camera);
    night = env.lightsOn;
    fx.setAmbient(env.ambient);
    // raindrops bouncing off the ground around the camera
    if (env.rain > 0.1 && !shop.inside) {
      for (let n = Math.floor(env.rain * 6 + Math.random()); n > 0; n--) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 16;
        const x = camera.position.x + Math.sin(follow.yaw) * 10 + Math.cos(a) * r, z = camera.position.z + Math.cos(follow.yaw) * 10 + Math.sin(a) * r;
        fx.splash(x, city.groundHeight(x, z), z, 1);
      }
    }
    fx.update(dt);
    hud.minutes = env.minutes;
    hud.update(dt, shop.inside ? shop.inside.door : focus, subject.yaw, follow.yaw, driving ? driving.vehicle.vf : null, !driving && !entry.active && vehicles.nearest(player.position));

  } else {
    camera.position.set(Math.sin(elapsed * 0.1) * 90, 45, Math.cos(elapsed * 0.1) * 90);
    camera.lookAt(0, 10, 0);
    env.update(dt, camera.position, camera);
  }
  mainInput.endFrame();
}

frame();
