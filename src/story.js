// Story missions, GTA style: four contacts around the city (yellow letter blips).
// Walk up to one on foot and a cutscene plays - letterbox, shot / reverse-shot
// camera, typed-out dialogue with mumbled "voices" - then the mission starts.
// One story runs through all twelve missions: Nico takes Sol City back from the Russo
// brothers, and ends up working for Zara, who built DaCity, the city's new money.
//   R  Rosa Marquez   - Little Havana, runs a cafe
//   V  Vince Moretti  - Old Harbor, owns the docks
//   D  Carla Diaz     - Downtown, a lawyer who works both sides
//   Z  Zara Vale      - South Beach penthouse, the woman behind DaCity
// Where each mission happens comes from src/shared/world.mjs: the reward server checks a
// finished mission against the same places. Progress is saved with the game.
import * as THREE from 'three';
import { Vigilante } from './vigilante.js';
import { buildInteriors, SEAT_Y } from './interiors.js';
import { chooseOutfit } from './materials.js';
import { STORY, CONTACT_PLACES, missionSpots, getawaySpot } from './shared/world.mjs';

const FLOOR = -0.03;
const FADE = 0.45;

const PLAYER = 'NICO';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const GUARD = { Shirt: '#24324d', Denim: '#1a2133', Hair: '#120d0a', Sneaker: '#0d0d0d', wear: 'male_elegantsuit01' };
const DRILL = 20; // seconds at the vault door
const GOON = { Shirt: '#1a1a1e', Denim: '#141417', Hair: '#0a0a0a', Sneaker: '#101010', wear: 'male_elegantsuit01' };

// ------------------------------------------------------------------ dialogue
const SCRIPT = {
  rosa1: {
    title: 'PROTECTION MONEY', pay: 400, pose: 'sit',
    lines: [
      ['ROSA', 'Nico! Thank God you came. Sit... no, there is no time to sit.'],
      [PLAYER, "What's wrong, Rosa?"],
      ['ROSA', "A punk called Tito. Every week he walks in, takes my money and calls it 'protection'."],
      ['ROSA', 'He says he collects for the Russo brothers. Protection from who? From them!'],
      [PLAYER, 'Where do I find him?'],
      ['ROSA', 'He hangs around a few blocks up. Go and teach him some manners. Not too many manners.'],
    ],
    text: 'Find <em>Tito</em> and beat him up.',
  },
  rosa2: {
    title: 'HOT DELIVERY', pay: 600, pose: 'stand',
    lines: [
      ['ROSA', "Tito won't be coming back. Half the street saw it. Business is booming!"],
      ['ROSA', 'Too booming. My delivery boy quit this morning.'],
      [PLAYER, 'Let me guess. You need a driver.'],
      ['ROSA', 'The van is out front. Forty empanadas for a party on the beach. Hot, Nico. HOT.'],
      [PLAYER, 'And if they arrive cold?'],
      ['ROSA', "Then don't come back. Oh, and Vince Moretti at the docks wants to meet you."],
    ],
  },
  vince1: {
    title: 'SINK THE COMPETITION', pay: 700, pose: 'sit',
    lines: [
      ['VINCE', "So you're the guy who put Tito in the hospital. Rosa talks a lot."],
      [PLAYER, "Depends who's asking."],
      ['VINCE', 'Vince Moretti. These docks are mine. The Russo brothers think the whole city is theirs.'],
      ['VINCE', "They just bought a shiny new car. It's parked outside their club in South Beach."],
      [PLAYER, 'You want it?'],
      ['VINCE', 'I want it on fire.'],
    ],
  },
  vince2: {
    title: 'HOT WHEELS', pay: 900, pose: 'stand',
    lines: [
      ['VINCE', 'The Russos are still crying about their car. Beautiful.'],
      ['VINCE', 'Now, business. A client in Miami wants a supercar. Yellow. Very yellow.'],
      [PLAYER, 'Where?'],
      ['VINCE', 'Some movie producer leaves one on the street in Vinewood Hills. Bring it here.'],
      ['VINCE', 'And Nico... not a scratch. Scratches come out of your cut.'],
    ],
    stealText: 'Steal the <em>yellow supercar</em> in Vinewood Hills.',
    dropText: 'Bring it to <em>Vince</em> without a scratch.',
  },
  diaz1: {
    title: 'THE SNITCH', pay: 800, pose: 'sit',
    lines: [
      ['DIAZ', "Sit down, Nico. I bill by the minute, so let's be quick."],
      [PLAYER, 'Counselor. To what do I owe the pleasure?'],
      ['DIAZ', 'Eddie Pruitt. Russo errand boy, big mouth. Tomorrow he testifies, and my name comes up.'],
      ['DIAZ', "He's leaving town in a grey sedan. Right now."],
      [PLAYER, 'And you want him stopped.'],
      ['DIAZ', "Stop the car. Whatever happens after that, I didn't hear about it."],
    ],
  },
  diaz2: {
    title: 'EVIDENCE', pay: 1000, pose: 'stand',
    lines: [
      ['DIAZ', 'Eddie decided to retire. Smart man.'],
      ['DIAZ', "One problem left. The DA's people found a bag of evidence at the Port of Sol."],
      ['DIAZ', 'Grab it before they log it. Every cop on the radio will be after you.'],
      [PLAYER, 'And you just happen to know where it is.'],
      ['DIAZ', 'I know where everything is. Shake them off and bring the bag back here.'],
    ],
  },
  rosa3: {
    title: 'SUPPLY RUN', pay: 1100, pose: 'sit',
    lines: [
      ['ROSA', 'Nico, the Russos told every supplier in Little Havana: sell to Rosa and you lose your hands.'],
      [PLAYER, 'So nobody sells to you.'],
      ['ROSA', 'So we sell to each other. Four cafes, four sacks of coffee, one van.'],
      ['ROSA', 'Be quick. The Russos have boys watching the streets.'],
      [PLAYER, 'A coffee run. Got it.'],
      ['ROSA', 'And Nico... a woman from South Beach was asking about you. Zara. Be careful.'],
    ],
    getIn: "Get in Rosa's <em>van</em>.",
    stopText: 'Drop the coffee at the <em>four cafes</em>. Stop at each one.',
    stopWord: 'Cafe', wreck: 'The van was destroyed.', stop: true,
  },
  vince3: {
    title: 'DOCK WAR', pay: 1300, pose: 'sit',
    lines: [
      ['VINCE', 'The Russos took my north pier last night. Six of their boys, sitting on my crates.'],
      [PLAYER, 'Want me to ask them nicely to leave?'],
      ['VINCE', 'I want them carried out. Every one of them.'],
      ['VINCE', 'Marco and Sal Russo think they own this city because they own the banks. Banks!'],
      ['VINCE', "They carry guns. Fists won't do it: get yourself something at Ammu-Nation first."],
      ['VINCE', 'Then go. Clear my pier.'],
    ],
    text: 'Clear the <em>Russo crew</em> off the north pier.', armed: 2,
  },
  diaz3: {
    title: 'DIRTY MONEY', pay: 2750, pose: 'stand',
    lines: [
      ['DIAZ', 'The Russos pay half the precinct. Every Friday a bagman drops cash on five corners.'],
      ['DIAZ', 'Today the bagman had an accident. The bags are still sitting there.'],
      [PLAYER, 'And you want them picked up before the cops get there.'],
      ['DIAZ', 'Five bags, four minutes. After that the patrols roll by.'],
      ['DIAZ', 'Without that money the Russos lose the cops. Then they are just two rich brothers.'],
    ],
    text: 'Pick up the <em>five cash bags</em> before the patrols do.',
  },
  zara1: {
    title: 'MEET ZARA', pay: 1600, pose: 'sit',
    lines: [
      ['ZARA', 'Nico. Rosa says you are fast. Vince says you are loud. Diaz says you are useful.'],
      [PLAYER, 'And who are you?'],
      ['ZARA', 'Zara. I built DaCity, the money this city is starting to pay with. No banks. No Russos.'],
      ['ZARA', 'That scares them. Tonight their armored van moves the keys to their vaults through the Harbor.'],
      [PLAYER, 'And you want the keys.'],
      ['ZARA', 'I want the van. In one piece, and without a parade of police behind you.'],
    ],
    stealText: 'Steal the <em>Russo armored van</em> in the Old Harbor.',
    dropText: 'Bring the van to <em>Zara</em>.',
  },
  zara2: {
    title: 'COLD STORAGE', pay: 1800, pose: 'stand',
    lines: [
      ['ZARA', 'The van was full of hardware wallets. The Russos were buying up DaCity to crash it.'],
      ['ZARA', 'My couriers hid them all over the city. Five drops, before the Russos find them.'],
      [PLAYER, 'On a bike?'],
      ['ZARA', "Traffic is a bike's best friend. Go."],
    ],
    getIn: "Get on Zara's <em>bike</em>.",
    stopText: 'Ride through the <em>five drops</em> before the Russos get there.',
    stopWord: 'Drop', wreck: 'The bike was destroyed.',
  },
  zara3: {
    title: 'THE RUSSO BROTHERS', pay: 5000, pose: 'sit',
    lines: [
      ['ZARA', 'The Russos know it was you. They are holed up in their club with everyone they have left.'],
      [PLAYER, 'Then I go to them.'],
      ['ZARA', "Marco runs when it gets hot. Don't let him get away."],
      ['ZARA', 'Every one of them will be armed. Stock up at Ammu-Nation before you go.'],
      ['ZARA', 'Finish this, and Sol City runs on DaCity. And DaCity looks after its friends.'],
      [PLAYER, 'See you at the top, Zara.'],
    ],
    text: 'Take out the <em>Russo crew</em> at their club.', armed: 4,
  },
  zara4: {
    title: 'THE RESERVE', pay: 2000, pose: 'sit',
    lines: [
      ['ZARA', 'The Russos are gone. Their money is not. It sits in the vault of the Sol City Reserve, downtown.'],
      [PLAYER, 'You want to rob a bank.'],
      ['ZARA', 'I want back what they bled out of this city. Every dollar of it goes into DaCity.'],
      ['ZARA', 'First, eyes on the place. Photograph the front, the side street and the loading bay out back.'],
      [PLAYER, 'A tourist with a camera. Easy.'],
    ],
    text: 'Take <em>photos</em> of the bank: stand still at each marker.',
  },
  zara5: {
    title: 'WHEELS OUT', pay: 3000, pose: 'stand',
    lines: [
      ['ZARA', 'Good photos. The street behind the Reserve is our way out.'],
      ['ZARA', 'We need a getaway car nobody looks at twice and nothing catches. A black saloon, up in Vinewood Hills.'],
      ['ZARA', 'Leave it on the street behind the bank. Clean: no cops, no scratches.'],
    ],
    stealText: 'Steal the <em>black saloon</em> in Vinewood Hills.',
    dropText: 'Park it on the street <em>behind the bank</em>.',
  },
  zara6: {
    title: 'THE BIG SCORE', pay: 25000, pose: 'sit',
    lines: [
      ['ZARA', 'Tonight. Three guards inside, armed. The cameras are mine.'],
      ['ZARA', 'Take them out, drill the vault, grab the bags. The alarm goes the moment you walk out with them.'],
      [PLAYER, 'And then every cop in Sol City.'],
      ['ZARA', 'Then you lose them, like you always do, and bring the money here. The car is waiting behind the bank.'],
      ['ZARA', 'Do this, Nico, and you never have to work for anyone again.'],
    ],
  },
};

const CONTACTS = [
  {
    id: 'rosa', name: 'ROSA', letter: 'R', room: 'cafe', kind: 'female', avatar: 'Female_Adult_03', color: '#ff8ab8', voice: 300,
    outfit: { Skin: '#a8714c', Shirt: '#b0203a', Denim: '#1c1c22', Hair: '#120c08', Sneaker: '#2a2a2a', wear: 'female_casualsuit01' },
  },
  {
    id: 'vince', name: 'VINCE', letter: 'V', room: 'office', kind: 'male', avatar: 'Business_Male_02', color: '#ffd23f', voice: 115,
    outfit: { Skin: '#e6b897', Shirt: '#ece6da', Denim: '#24242a', Hair: '#16100c', Sneaker: '#121212', wear: 'male_elegantsuit01' },
  },
  {
    id: 'diaz', name: 'DIAZ', letter: 'D', room: 'lawoffice', kind: 'female', avatar: 'Female_Adult_05', color: '#6fb7ff', voice: 210,
    outfit: { Skin: '#b07a52', Shirt: '#e8e2d6', Denim: '#1a1c22', Hair: '#0e0a08', Sneaker: '#141414', wear: 'female_elegantsuit01' },
  },
  {
    id: 'zara', name: 'ZARA', letter: 'Z', room: 'penthouse', kind: 'female', avatar: 'Business_Female_02', color: '#ffd23f', voice: 260,
    outfit: { Skin: '#d9a688', Shirt: '#f4efe6', Denim: '#15151a', Hair: '#c9a24a', Sneaker: '#151515', wear: 'female_elegantsuit01' },
  },
];
// where they are and their missions, in story order
for (const c of CONTACTS) {
  Object.assign(c, CONTACT_PLACES[c.id]);
  c.missions = STORY.filter((m) => m.contact === c.id).map((m) => ({ ...m, ...SCRIPT[m.id] }));
}

// ------------------------------------------------------------------ helpers
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(color) }, t: { value: 0 } },
    vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color; uniform float t; varying float vY;
      void main(){ float a = (1.0 - clamp(vY / 20.0, 0.0, 1.0)) * (0.32 + 0.12 * sin(t * 4.0 - vY * 0.5)); gl_FragColor = vec4(color * a, a); }`,
  });
}

export class Story {
  constructor(ctx) {
    // ctx: scene, city, peds, vehicles, hud, audio, wanted, player, fx, camera, getDriving()
    Object.assign(this, ctx);
    this.done = new Set(); // ids of the missions passed
    this.replays = {}; // once the story is over: contact id -> which of their missions they offer again
    this.cut = null;
    this.mission = null;
    this.t = 0;
    this.el = document.getElementById('cutscene');
    this.dlg = document.getElementById('dialogue');
    this.rooms = buildInteriors(this.scene);
    this.fadeEl = document.getElementById('fade');
    this.contacts = CONTACTS;
    this.makeMarkers();
    for (const c of CONTACTS) this.placeContact(c);
  }

  get cutscene() {
    return !!this.cut;
  }

  get active() {
    return !!this.cut || !!this.mission;
  }

  // ---------------------------------------------------------------- world objects
  makeMarkers() {
    const beam = (color, r) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 20, 28, 1, true).translate(0, 10, 0), beamMaterial(color));
      b.renderOrder = 5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      ring.position.y = 0.06;
      g.add(b, ring);
      g.visible = false;
      g.userData.mat = b.material;
      this.scene.add(g);
      return g;
    };
    this.beam = beam;
    this.goal = beam(0xffd23f, 3.5);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.65, 4).rotateX(Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 1.2 }));
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    // small yellow rings in front of each contact
    this.contactRings = CONTACTS.map(() => beam(0xffd23f, 1.7));
  }

  dress(p, outfit) {
    if (outfit.wear) p.body.userData.outfit = chooseOutfit(p.body, outfit.wear);
    p.body.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const c = outfit[/^(Hair|Brow)Cards$/.test(o.material.name) ? 'Hair' : o.material.name.endsWith('__shirt') ? 'Shirt' : o.material.name];
      if (!c) return;
      o.material = o.material.clone();
      o.material.color.set(c);
    });
  }

  // the contact waits in their room; outside there is only the yellow marker at the door
  placeContact(c) {
    const x0 = this.city.blockMin(c.block[0]), z0 = this.city.blockMin(c.block[1]);
    c.pos = { x: x0 + c.t, z: z0 + 2.5 }; // the door (map blip)
    c.stand = { x: x0 + c.t, z: z0 + 1.05 }; // marker in front of it
    c.roomData = this.rooms[c.room];
    const h = c.roomData.home;
    const p = this.peds.add(c.kind, h.x, h.z, Math.PI, c.avatar); // (each one the same Rocketbox avatar every time)
    p.hipsRest = p.body.getObjectByName('hips').position.y; // rest pose, before any animation moves it
    p.state = 'contact';
    p.keep = true;
    p.invulnerable = true;
    this.dress(p, c.outfit);
    c.ped = p;
  }

  fade(on) {
    this.fadeEl.classList.toggle('show', on);
  }

  // ---------------------------------------------------------------- cutscene
  // fade to black -> into the room -> conversation -> fade -> back at the door -> mission
  startCutscene(c) {
    this.entry?.cancel();
    const m = this.next(c) || c.missions[0];
    const P = this.player;
    P.vel.set(0, 0, 0);
    P.moveSpeed = P.speed = 0;
    // put the gun away for the conversation
    this.holstered = this.weapons?.current ?? null;
    this.weapons?.equip(null);
    this.cut = { c, m, i: -1, chars: 0, t: 0, phase: 'in', pt: 0 };
    document.body.classList.add('cutscene');
    this.fade(true);
  }

  // sit someone down: hips just above the seat, the drive pose keeps the hands on the table
  enterRoom() {
    const { c, m } = this.cut;
    const room = c.roomData;
    const arr = room.arr[m.pose] || room.arr.stand;
    const P = this.player, A = arr.P, C = arr.C;
    const yawP = Math.atan2(C.x - A.x, C.z - A.z), yawC = Math.atan2(A.x - C.x, A.z - C.z);
    this.outside = { x: c.stand.x, z: c.stand.z };
    P.posed = this.clipFor(P.actions, A.sit, false);
    P.yaw = yawP;
    P.object.rotation.set(0, yawP, 0);
    P.model.rotation.set(0, 0, 0);
    P.lookYaw = 0;
    const back = A.sit ? 0.06 : 0;
    P.position.set(A.x - Math.sin(yawP) * back, A.sit ? FLOOR + SEAT_Y + 0.1 - P.hipsRest : FLOOR, A.z - Math.cos(yawP) * back);
    for (const n of Object.keys(P.weights)) P.weights[n] = n === P.posed ? 1 : 0;
    const p = c.ped;
    const hips = p.hipsRest * p.scale;
    p.state = 'talking';
    p.x = C.x - Math.sin(yawC) * (C.sit ? 0.06 : 0);
    p.z = C.z - Math.cos(yawC) * (C.sit ? 0.06 : 0);
    p.y = C.sit ? FLOOR + SEAT_Y + 0.1 - hips : FLOOR;
    p.yaw = yawC;
    p.cur = 0;
    p.vel.set(0, 0, 0);
    const clip = this.clipFor(p.anim.actions, C.sit, false);
    p.pose = clip;
    p.anim.target = { [clip]: 1 };
    for (const n in p.anim.weights) p.anim.weights[n] = n === clip ? 1 : 0;
    this.cut.arr = arr;
    this.env.indoor = { lights: room.lights, intensity: 26 };
  }

  // talking / listening body animation, sitting or standing (older exports: drive / idle)
  clipFor(actions, sit, talking) {
    const n = (sit ? 'sit' : 'stand') + (talking ? 'talk' : 'listen');
    return actions[n] ? n : sit ? 'drive' : 'idle';
  }

  leaveRoom() {
    const { c } = this.cut;
    const P = this.player;
    P.posed = null;
    P.position.set(this.outside.x, this.city.groundHeight(this.outside.x, this.outside.z), this.outside.z);
    P.yaw = Math.PI; // stepping out of the door onto the street
    P.object.rotation.set(0, P.yaw, 0);
    for (const n of Object.keys(P.weights)) P.weights[n] = n === 'idle' ? 1 : 0;
    this.follow.yaw = P.yaw;
    this.follow.pitch = 0.2;
    const p = c.ped, h = c.roomData.home;
    p.state = 'contact';
    p.x = h.x;
    p.z = h.z;
    p.y = FLOOR;
    this.env.indoor = null;
  }

  nextLine() {
    const cut = this.cut;
    cut.i++;
    if (cut.i >= cut.m.lines.length) return this.endCutscene();
    cut.chars = 0;
    cut.t = 0;
    const [who] = cut.m.lines[cut.i];
    // first line: wide two-shot, then the camera cuts to whoever speaks
    cut.shot = cut.i === 0 ? 'two' : who === PLAYER ? 'player' : 'contact';
    // the speaker talks with their hands, the other one listens
    if (cut.arr) {
      const P = this.player, p = cut.c.ped;
      P.posed = this.clipFor(P.actions, cut.arr.P.sit, who === PLAYER);
      p.pose = this.clipFor(p.anim.actions, cut.arr.C.sit, who !== PLAYER);
    }
  }

  endCutscene() {
    this.cut.phase = 'out';
    this.cut.pt = 0;
    this.el.classList.remove('show');
    this.fade(true);
  }

  // the scene is over and the screen is black: back outside, then start the job
  finishCutscene() {
    const { c, m } = this.cut;
    this.leaveRoom();
    this.cut = null;
    document.body.classList.remove('cutscene');
    this.fade(false);
    if (this.holstered && this.weapons?.inv[this.holstered]) this.weapons.equip(this.holstered);
    this.startMission(c, m);
  }

  updateCutscene(dt, input) {
    const cut = this.cut;
    cut.pt += dt;
    if (cut.phase === 'in') {
      if (cut.pt < FADE) return;
      this.enterRoom();
      cut.phase = 'talk';
      this.el.classList.add('show');
      this.fade(false);
      this.nextLine();
    }
    if (cut.phase === 'out') {
      if (cut.pt >= FADE) this.finishCutscene();
      return;
    }
    const [who, text] = cut.m.lines[cut.i];
    cut.t += dt;
    const before = Math.floor(cut.chars);
    cut.chars = Math.min(text.length, cut.chars + dt * 42);
    // mumbled voice: a short tone every few letters while the line is being typed out
    const speaker = who === PLAYER ? { voice: 150 } : cut.c;
    if (Math.floor(cut.chars) > before && Math.floor(cut.chars) % 3 === 0 && cut.chars < text.length && text[Math.floor(cut.chars)] !== ' ') {
      const f = speaker.voice * (0.85 + Math.random() * 0.35);
      this.audio.blip({ tone: f, toneEnd: f * (0.8 + Math.random() * 0.3), dur: 0.07, gain: 0.07 });
    }
    const color = who === PLAYER ? '#9fe0ff' : cut.c.color;
    this.dlg.innerHTML = `<b style="color:${color}">${who}</b><span>${text.slice(0, Math.floor(cut.chars))}</span>`;
    const typed = cut.chars >= text.length;
    const skip = input.pressed('Space') || input.pressed('Enter') || input.pressed('Mouse0');
    if (skip && !typed) cut.chars = text.length;
    else if (skip || (typed && cut.t > text.length / 42 + 1.8)) this.nextLine();
  }

  // shot / reverse-shot camera
  cameraShot(camera) {
    const cut = this.cut;
    if (!cut || !cut.arr) return;
    const C = cut.arr.C, P = cut.arr.P;
    const dx = P.x - C.x, dz = P.z - C.z, d = Math.hypot(dx, dz) || 1;
    const fx = dx / d, fz = dz / d; // contact -> player
    const rx = fz, rz = -fx;
    const drift = Math.min(1, cut.t * 0.15) * 0.25;
    const hC = FLOOR + (C.sit ? 1.2 : 1.6), hP = FLOOR + (P.sit ? 1.2 : 1.6);
    let pos, look;
    if (cut.shot === 'two') {
      const mx = (C.x + P.x) / 2, mz = (C.z + P.z) / 2;
      pos = [mx + rx * (3.0 - drift), Math.max(hC, hP) + 0.15, mz + rz * (3.0 - drift)];
      look = [mx, (hC + hP) / 2 - 0.1, mz];
    } else if (cut.shot === 'contact') {
      // over the player's shoulder onto the contact
      pos = [P.x + fx * 0.85 + rx * 0.5, hP + 0.12, P.z + fz * 0.85 + rz * 0.5];
      look = [C.x + rx * drift * 0.3, hC - 0.05, C.z + rz * drift * 0.3];
    } else {
      pos = [C.x - fx * 0.85 - rx * 0.5, hC + 0.12, C.z - fz * 0.85 - rz * 0.5];
      look = [P.x, hP - 0.05, P.z];
    }
    camera.position.set(...pos);
    camera.lookAt(...look);
    if (Math.abs(camera.fov - 40) > 0.01) {
      camera.fov = 40;
      camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- missions
  // the next mission a contact has, and whether the story has got that far; once the whole story
  // is done, every contact offers their missions again, one after the other
  get finished() {
    return this.done.size === STORY.length;
  }

  next(c) {
    if (this.finished) return c.missions[(this.replays[c.id] || 0) % c.missions.length];
    return c.missions.find((m) => !this.done.has(m.id)) || null;
  }

  available(c) {
    const m = this.next(c);
    return m && (this.finished || !m.after || this.done.has(m.after)) ? m : null;
  }

  // a getaway driver run by the vigilante flee logic
  chaser(car) {
    const chase = Object.assign(Object.create(Vigilante.prototype), { city: this.city, vehicles: this.vehicles, hud: this.hud, audio: this.audio, level: 2, wp: null, stuck: 0, reverse: 0 });
    chase.suspect = car;
    return chase;
  }

  startMission(c, m) {
    const ms = { c, m, step: null, data: {} };
    this.mission = ms;
    this.showTitle(m.title);
    this.onMissionStart?.(m.id);
    const ped = this.peds, city = this.city;
    // mission cars stay in the world (far-away parked cars are normally swept away) until the end
    const mcars = [];
    const v = { spawn: (d) => {
      const c = this.vehicles.spawn({ ...d, keep: true });
      mcars.push(c);
      return c;
    } };
    ms.release = () => mcars.forEach((c) => (c.keep = false));
    ms.gone = (c) => !this.vehicles.cars.includes(c);
    const spots = missionSpots(m); // the same places the reward server checks
    const S = (text, update, enter) => ({ text, update, enter });
    const at = (pos, r) => {
      const d = this.getDriving();
      const p = d ? d.vehicle.pos : this.player.position;
      return Math.hypot(p.x - pos.x, p.z - pos.z) < r;
    };
    const stoppedAt = (car, pos, r) => this.getDriving()?.vehicle === car && car.speed < 2 && Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z) < r;
    const loseCops = S('Lose the cops.', () => (this.wanted.level === 0 ? 'next' : null));
    const posOf = (car) => (car.vehicle ? car.vehicle.pos : { x: car.x, z: car.z });
    const me = () => this.getDriving()?.vehicle.pos || this.player.position;
    // step: get into a mission vehicle
    const getIn = (car, text, wreck, y = 3) => S(text, () => {
      if (car.wrecked || ms.gone(car)) return 'fail:' + wreck;
      const p = posOf(car);
      this.arrowOn(p.x, y, p.z);
      this.hud.blips = [{ x: p.x, z: p.z, color: '#4fa3ff' }];
      this.routeTo(me(), p);
      return this.getDriving() === car ? 'next' : null;
    });
    // while out of the mission vehicle: point back at it
    const backTo = (car, y = 3) => {
      this.arrowOn(posOf(car).x, y, posOf(car).z);
      this.goalOn(null);
      return null;
    };
    // a crew standing on the pavement; they fight when you come close on foot
    const crew = (spot, n) => {
      const x0 = spot.x - 17, z0 = city.blockMin(m.where[1]);
      const goons = [];
      for (let k = 0; k < n; k++) {
        const g = ped.add('male', x0 + (k * 34) / (n - 1), z0 + 1.6 + (k % 2) * 1.4, Math.PI);
        g.state = 'contact';
        g.keep = true;
        g.hostile = true;
        // every other one carries a pistol and shoots from where he stands
        g.gunman = k % 2 === 0 && goons.filter((q) => q.gunman).length < (m.armed || 0);
        if (g.gunman) this.arm(g);
        this.dress(g, GOON);
        goons.push(g);
      }
      return goons;
    };
    const fightCrew = (goons, dt) => {
      const driving = !!this.getDriving(), p = me();
      for (const g of goons) {
        if (g.beaten) continue;
        if (g.state === 'down' || !ped.list.includes(g)) {
          g.beaten = true;
          continue;
        }
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (g.gunman && d > 2.5) {
          // stand and shoot when he can see you
          if (g.state !== 'contact') g.state = 'contact';
          g.aimingGun = d < 34 && this.inSight(g, p);
          if (g.aimingGun && (g.fireTimer = (g.fireTimer ?? 1 + Math.random()) - dt) <= 0) {
            g.fireTimer = 1.8 + Math.random() * 1.5;
            ped.onCopFire?.(g);
          }
        } else if (!driving && d < 15) {
          if (g.state !== 'fight') {
            g.state = 'fight';
            g.attackTimer = 0.3 + Math.random() * 0.7;
          }
        } else if (g.state !== 'fight' && g.state !== 'contact') g.state = 'contact'; // stays at the post
        if (g.state === 'contact' && d < 50) g.yaw = Math.atan2(p.x - g.x, p.z - g.z);
      }
      const left = goons.filter((g) => !g.beaten);
      ms.rows = [['CREW LEFT', `${left.length} / ${goons.length}`]];
      if (!left.length) return true;
      const near = left.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
      this.arrowOn(near.x, near.y + 2.4, near.z);
      this.hud.blips = left.map((g) => ({ x: g.x, z: g.z, color: '#ff3b3b' }));
      this.routeTo(p, near);
      return false;
    };

    if (m.type === 'beat') {
      const tito = ped.add('male', spots[0].x, spots[0].z, Math.PI);
      tito.state = 'contact';
      tito.keep = true;
      this.dress(tito, { Shirt: '#d8b83a', Denim: '#33333a', Hair: '#0a0a0a', wear: 'male_casualsuit05' });
      ms.data.target = tito;
      ms.steps = [S(m.text, () => {
        this.arrowOn(tito.x, tito.y + 2.4, tito.z);
        this.hud.blips = [{ x: tito.x, z: tito.z, color: '#ff3b3b' }];
        this.routeTo(me(), tito);
        if (tito.state === 'down') return 'next';
        if (!ped.list.includes(tito)) return 'fail:Tito got away.';
        return null;
      })];
      ms.cleanup = () => (tito.keep = false);
    } else if (m.type === 'deliver') {
      const [spot, dest] = spots;
      const van = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: 0xf2efe6, model: 'van' });
      ms.data.car = van;
      ms.steps = [
        getIn(van, "Get in Rosa's <em>van</em>.", 'The van was destroyed.'),
        S('Deliver the food to the <em>beach party</em> before it gets cold.', (dt) => {
          ms.data.time -= dt;
          if (van.wrecked || van.health < 35) return 'fail:The food is ruined.';
          if (ms.data.time <= 0) return 'fail:The empanadas went cold.';
          if (this.getDriving() !== van) return backTo(van);
          this.arrow.visible = false;
          this.goalOn(dest);
          this.hud.blips = [{ x: dest.x, z: dest.z, color: '#ffd23f' }];
          this.routeTo(van.vehicle.pos, dest);
          return stoppedAt(van.vehicle, dest, 7) ? 'next' : null;
        }, () => (ms.data.time = Math.round(Math.hypot(posOf(van).x - dest.x, posOf(van).z - dest.z) * 1.4 / 11 + 25))),
      ];
    } else if (m.type === 'destroy') {
      const spot = spots[0];
      const car = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: 0x5a0f18, model: 'lux' });
      ms.data.car = car;
      ms.steps = [
        S("Destroy the <em>Russos' car</em>.", () => {
          const p = posOf(car);
          this.arrowOn(p.x, 3, p.z);
          this.hud.blips = [{ x: p.x, z: p.z, color: '#ff3b3b' }];
          this.routeTo(me(), p);
          return car.wrecked ? 'next' : null;
        }),
        loseCops,
      ];
    } else if (m.type === 'steal') {
      const [spot, drop] = spots;
      const van = m.vehicle === 'van';
      const car = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: van ? 0x2c3036 : m.vehicle === 'lux' ? 0x111114 : 0xf5c400, model: m.vehicle || 'super' });
      const minHealth = van ? 30 : 55;
      ms.data.car = car;
      ms.steps = [
        S(m.stealText, () => {
          if (car.wrecked || ms.gone(car)) return 'fail:The car was destroyed.';
          const p = posOf(car);
          this.arrowOn(p.x, 2.6, p.z);
          this.hud.blips = [{ x: p.x, z: p.z, color: '#4fa3ff' }];
          this.routeTo(me(), p);
          if (this.getDriving() !== car) return null;
          // the armored van has an alarm
          if (van) this.wanted.crime('ko_cop', true);
          return 'next';
        }),
        S(m.dropText, () => {
          if (car.wrecked || ms.gone(car) || car.health < minHealth) return 'fail:The car is too damaged.';
          if (this.getDriving() !== car) return backTo(car, 2.6);
          this.arrow.visible = false;
          this.goalOn(drop);
          this.hud.blips = [{ x: drop.x, z: drop.z, color: '#ffd23f' }];
          this.routeTo(car.vehicle.pos, drop);
          ms.rows = this.wanted.level ? [['COPS', 'Lose them first']] : null;
          return stoppedAt(car.vehicle, drop, 6) ? (this.wanted.level ? null : 'next') : null;
        }),
      ];
    } else if (m.type === 'chase') {
      const P = this.player.position;
      let car = null;
      for (let k = 0; k < 40 && !car; k++) {
        const p = { x: city.roadC(Math.floor(Math.random() * (city.N + 1))), z: city.roadC(Math.floor(Math.random() * (city.N + 1))) };
        const d = Math.hypot(p.x - P.x, p.z - P.z);
        if (d < 70 || d > 160) continue;
        car = v.spawn({ x: p.x, z: p.z, yaw: Math.atan2(p.x - P.x, p.z - P.z), color: 0x8a8f96, model: 'sedan', ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } } });
      }
      if (!car) car = v.spawn({ x: city.roadC(0), z: city.roadC(0), yaw: 0, color: 0x8a8f96, model: 'sedan', ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } } });
      const chase = this.chaser(car);
      ms.data.car = car;
      ms.data.time = 150;
      ms.steps = [S("Stop <em>Eddie's</em> grey sedan.", (dt) => this.chaseStep(dt, chase, 'Eddie got away.'))];
      ms.cleanup = () => {
        if (car.ai) car.ai = null;
      };
    } else if (m.type === 'evidence') {
      const [bag, back] = spots;
      ms.steps = [
        S('Pick up the <em>evidence</em> at the Port of Sol.', () => {
          this.goalOn(bag, 2);
          this.routeTo(me(), bag);
          if (at(bag, 3.5)) {
            this.wanted.crime('ko_cop', true);
            this.wanted.crime('ko_cop', true);
            this.audio.cash();
            return 'next';
          }
          return null;
        }),
        loseCops,
        S('Bring the bag to <em>Diaz</em>.', () => {
          this.goalOn(back, 2);
          this.routeTo(me(), back);
          if (this.wanted.level) return 'back';
          return at(back, 4) ? 'next' : null;
        }),
      ];
    } else if (m.type === 'route') {
      // drive a set of stops in order against the clock: the van stops at each, the bike rides through
      const [spot, ...stops] = spots;
      const car = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: m.vehicle === 'van' ? 0x7a4a2a : 0xffd23f, model: m.vehicle });
      let budget = 25, from = spot;
      for (const s of stops) {
        budget += (Math.hypot(s.x - from.x, s.z - from.z) * 1.35) / (m.vehicle === 'bike' ? 15 : 12) + (m.stop ? 6 : 2);
        from = s;
      }
      ms.data.car = car;
      ms.data.k = 0;
      ms.steps = [
        getIn(car, m.getIn, m.wreck),
        S(m.stopText, (dt) => {
          if (car.wrecked || car.health < 20) return 'fail:' + m.wreck;
          ms.data.time -= dt;
          if (ms.data.time <= 0) return 'fail:Out of time.';
          ms.rows = [[m.stopWord.toUpperCase(), `${ms.data.k} / ${stops.length}`]];
          if (this.getDriving() !== car) return backTo(car);
          this.arrow.visible = false;
          const p = stops[ms.data.k], cv = car.vehicle;
          this.goalOn(p, 5);
          this.routeTo(cv.pos, p);
          this.hud.blips = stops.slice(ms.data.k).map((q, i) => ({ x: q.x, z: q.z, color: i ? '#9a8a40' : '#ffd23f' }));
          if (Math.hypot(cv.pos.x - p.x, cv.pos.z - p.z) < (m.stop ? 7 : 8) && (!m.stop || cv.speed < 4)) {
            ms.data.k++;
            this.audio.cash();
            this.dacity?.mark();
            if (ms.data.k >= stops.length) return 'next';
            this.hud.say(`${m.stopWord} <em>${ms.data.k} / ${stops.length}</em>`, 2);
          }
          return null;
        }, () => (ms.data.time = Math.round(budget))),
      ];
    } else if (m.type === 'gang') {
      const goons = crew(spots[0], m.goons);
      ms.steps = [this.gunShopStep(me), S(m.text, (dt) => (fightCrew(goons, dt) ? 'next' : null)), loseCops];
      ms.cleanup = () => this.disarm(goons);
    } else if (m.type === 'collect') {
      const bags = spots.map((s) => {
        const g = new THREE.Group();
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.34), new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 0.8 }));
        bag.position.y = 0.2;
        bag.castShadow = true;
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
        strap.position.y = 0.37;
        g.add(bag, strap);
        g.position.set(s.x, city.groundHeight(s.x, s.z), s.z);
        this.scene.add(g);
        const beam = this.beam(0x57d67a, 1.4);
        beam.visible = true;
        beam.position.copy(g.position);
        return { ...s, g, beam, got: false };
      });
      ms.data.time = 240;
      ms.steps = [
        S(m.text, (dt) => {
          ms.data.time -= dt;
          if (ms.data.time <= 0) return 'fail:The patrols got there first.';
          const p = me(), left = bags.filter((b) => !b.got);
          for (const b of left) {
            b.g.rotation.y += dt * 2;
            if (Math.hypot(p.x - b.x, p.z - b.z) < (this.getDriving() ? 4.5 : 3)) {
              b.got = true;
              b.g.visible = b.beam.visible = false;
              this.audio.cash();
              this.dacity?.mark();
            }
          }
          const rest = bags.filter((b) => !b.got);
          ms.rows = [['BAGS', `${bags.length - rest.length} / ${bags.length}`]];
          if (!rest.length) {
            this.wanted.crime('ko_cop', true); // somebody saw the last one
            return 'next';
          }
          this.hud.blips = rest.map((b) => ({ x: b.x, z: b.z, color: '#57d67a' }));
          const near = rest.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
          this.routeTo(p, near);
          return null;
        }),
        loseCops,
      ];
      ms.cleanup = () => bags.forEach((b) => {
        this.scene.remove(b.g, b.beam);
      });
    } else if (m.type === 'scout') {
      // photos of the bank: stand (or stop the car) at each marker for a moment
      const names = ['the front', 'the side street', 'the loading bay'];
      let k = 0, still = 0;
      ms.steps = [S(m.text, (dt) => {
        const p = spots[k], here = me(), d = this.getDriving();
        this.goalOn(p, 3);
        this.hud.blips = spots.slice(k).map((q, i) => ({ x: q.x, z: q.z, color: i ? '#9a8a40' : '#ffd23f' }));
        this.routeTo(here, p);
        ms.rows = [['PHOTOS', k + ' / ' + spots.length]];
        const slow = d ? d.vehicle.speed < 1 : this.player.speed < 0.3;
        still = Math.hypot(here.x - p.x, here.z - p.z) < 3.5 && slow ? still + dt : 0;
        if (still < 1.5) return null;
        still = 0;
        k++;
        this.audio.blip({ noise: 0.5, cutoff: 3000, dur: 0.06, gain: 0.3 }); // shutter
        this.dacity?.mark();
        this.hud.say('Photo of ' + names[k - 1] + '.', 2);
        return k >= spots.length ? 'next' : null;
      })];
    } else if (m.type === 'heist') {
      // in through the front, the guards, the vault, out with the money, lose the police
      const bank = this.shop?.branches.find((q) => q.type === 'bank');
      const drop = spots[1], ga = getawaySpot();
      const getaway = v.spawn({ x: ga.x, z: ga.z, yaw: ga.yaw, color: 0x111114, model: 'lux' });
      const inBank = () => !!bank && this.shop.inside === bank;
      let guards = [], drill = 0;
      ms.steps = [
        S('Go into the <em>Sol City Reserve</em>.', () => {
          if (!bank || inBank()) return 'next';
          this.arrowOn(bank.door.x, 3.2, bank.door.z);
          this.hud.blips = [{ x: bank.door.x, z: bank.door.z, color: '#ffd23f' }];
          this.routeTo(me(), bank.door);
          return null;
        }),
        S('Take out the <em>guards</em>.', (dt) => {
          if (!inBank()) return 'fail:You left the bank.';
          return fightCrew(guards, dt) ? 'next' : null;
        }, () => {
          guards = (bank?.guardSpots || []).map((p) => {
            const g = ped.add('male', p.x, p.z, Math.PI);
            g.state = 'contact';
            g.keep = g.hostile = g.gunman = true;
            this.arm(g);
            this.dress(g, GUARD);
            return g;
          });
        }),
        S('Drill the <em>vault</em>: stay at the vault door.', (dt) => {
          if (!inBank()) return 'fail:You left the bank.';
          this.goalOn(bank.vault, 1.2);
          this.hud.blips = [];
          if (at(bank.vault, 1.5)) {
            const before = Math.floor(drill * 3);
            drill += dt;
            if (Math.floor(drill * 3) !== before) this.audio.blip({ noise: 0.7, cutoff: 900, dur: 0.25, gain: 0.18 }); // the drill
          }
          ms.rows = [['DRILL', Math.min(100, Math.round((drill / DRILL) * 100)) + '%']];
          if (drill < DRILL) return null;
          this.audio.cash();
          return 'next';
        }),
        S('The vault is open: grab the money and <em>get out</em>!', () => {
          if (inBank()) {
            this.goalOn(bank.exitRing, 1);
            return null;
          }
          // out on the street with the bags: the alarm has every patrol on its way
          this.wanted.crime('ko_cop', true);
          this.wanted.crime('ko_cop', true);
          return 'next';
        }),
        S('Lose the cops and bring the money to <em>Zara</em>. The getaway car is behind the bank.', () => {
          this.goalOn(drop);
          this.routeTo(me(), drop);
          const blips = [{ x: drop.x, z: drop.z, color: '#ffd23f' }];
          if (!getaway.wrecked && this.getDriving() !== getaway && !ms.gone(getaway)) {
            const p = posOf(getaway);
            blips.push({ x: p.x, z: p.z, color: '#4fa3ff' });
          }
          this.hud.blips = blips;
          ms.rows = this.wanted.level ? [['COPS', 'Lose them first']] : null;
          return !this.wanted.level && at(drop, 5) ? 'next' : null;
        }),
      ];
      ms.cleanup = () => this.disarm(guards);
    } else if (m.type === 'finale') {
      // the crew outside the club, then Marco Russo makes a run for it
      const goons = crew(spots[0], m.goons);
      let chase = null;
      ms.steps = [
        this.gunShopStep(me),
        S(m.text, (dt) => (fightCrew(goons, dt) ? 'next' : null)),
        S('<em>Marco Russo</em> is getting away. Stop his car!', (dt) => this.chaseStep(dt, chase, 'Marco Russo got away.'), () => {
          const s = this.roadside(m.where[0], m.where[1], 47);
          const car = v.spawn({ x: s.x, z: s.z, yaw: s.yaw, color: 0x111114, model: 'lux', ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } } });
          chase = this.chaser(car);
          ms.data.car = car;
          ms.data.time = 150;
        }),
      ];
      ms.cleanup = () => {
        this.disarm(goons);
        if (ms.data.car?.ai) ms.data.car.ai = null;
      };
    }
    this.enterStep(0);
  }

  // first step of an armed job: buy a gun or ammo at an Ammu-Nation (it has to be bought now)
  gunShopStep(me) {
    return {
      text: "You'll need firepower: buy a gun or ammo at <em>Ammu-Nation</em>.",
      enter: () => {
        this.boughtGun = false;
        // broke (a fine, a hospital bill): the contact puts up the price of a pistol
        if (this.hud.money < 150) {
          this.hud.addMoney(150 - this.hud.money);
          setTimeout(() => this.hud.say('Here is some cash for it. <em>Don’t</em> spend it on tacos.', 3.5), 2600);
        }
      },
      update: () => {
        if (this.boughtGun) return this.shop?.inside ? null : 'next';
        if (this.shop?.inside) {
          this.arrow.visible = false;
          this.hud.route = null;
          return null;
        }
        const shops = (this.shop?.branches || []).filter((b) => b.type === 'gun');
        if (!shops.length) return 'next';
        const p = me();
        const near = shops.reduce((a, b) => (Math.hypot(a.door.x - p.x, a.door.z - p.z) < Math.hypot(b.door.x - p.x, b.door.z - p.z) ? a : b));
        this.arrowOn(near.door.x, 3.4, near.door.z);
        this.hud.blips = shops.map((b) => ({ x: b.door.x, z: b.door.z, color: '#ff4040' }));
        this.routeTo(p, near.door);
        this.mission.rows = [['AMMU-NATION', 'Buy a gun or ammo']];
        return null;
      },
    };
  }

  // only officers' bodies come with a pistol: give a gunman a copy of the hero's, in the same hand
  arm(g) {
    let gun = g.body.userData.gun;
    if (!gun) {
      const src = this.player.model.getObjectByName('Weapon_Pistol'), hand = g.body.getObjectByName(src?.parent?.name || 'hand.R');
      if (!src || !hand) return;
      gun = src.clone(true);
      gun.traverse((o) => (o.visible = true));
      hand.add(gun);
      g.body.userData.gun = gun;
    }
    gun.visible = true;
  }

  // can this gunman see the player? (no building in between)
  inSight(g, p) {
    const o = new THREE.Vector3(g.x, g.y + 1.5, g.z), d = new THREE.Vector3(p.x - g.x, (p.y ?? 0) + 1.2 - g.y - 1.5, p.z - g.z), L = d.length();
    return this.city.raycast(o, d.normalize(), L) >= L - 0.6;
  }

  disarm(goons) {
    for (const g of goons) {
      g.keep = false;
      g.hostile = false;
      g.aimingGun = false;
      if (g.body.userData.gun) g.body.userData.gun.visible = false;
      if (g.state !== 'down' && this.peds.list.includes(g)) this.peds.rejoin(g);
    }
  }

  // follow and stop a fleeing car (chase / finale)
  chaseStep(dt, chase, lost) {
    const ms = this.mission, car = chase.suspect;
    if (car.burning || car.wrecked || car.health <= 30 || !car.ai) {
      car.ai = null;
      return 'next';
    }
    ms.data.time -= dt;
    const p = car.vehicle ? car.vehicle.pos : car, me = this.getDriving()?.vehicle.pos || this.player.position;
    if (ms.data.time <= 0 || Math.hypot(p.x - me.x, p.z - me.z) > 450) return 'fail:' + lost;
    chase.drive(dt, me);
    this.routeTo(me, p);
    this.arrowOn(p.x, 3, p.z);
    this.hud.blips = [{ x: p.x, z: p.z, color: '#ff3b3b' }];
    return null;
  }

  roadside(bi, bj, along) {
    // kerbside parking spot on the road north of block (bi, bj), facing +x
    const { ROAD } = this.city;
    return { x: this.city.blockMin(bi) + along, z: this.city.roadC(bj) + ROAD / 2 - 1.15, yaw: Math.PI / 2 };
  }

  enterStep(i) {
    const ms = this.mission;
    ms.i = i;
    ms.rows = null;
    const s = ms.steps[i];
    s.enter?.();
    this.hud.say(s.text, 5);
  }

  routeTo(from, to) {
    // no GPS line from inside a building
    if (this.shop?.inside) {
      this.hud.route = null;
      return;
    }
    this.hud.route = this.city.gpsRoute({ x: from.x, z: from.z }, { x: to.x, z: to.z });
    this.hud.routeColor = '#ffd23f';
  }

  arrowOn(x, y, z) {
    this.arrow.visible = true;
    this.arrow.position.set(x, y + Math.sin(this.t * 4) * 0.15, z);
    this.arrow.rotation.y += 0.04;
  }

  goalOn(p, r = 3.5) {
    this.goal.visible = !!p;
    if (!p) return;
    this.goal.position.set(p.x, this.city.groundHeight(p.x, p.z), p.z);
    const s = r / 3.5;
    this.goal.scale.set(s, 1, s);
  }

  clearMarkers() {
    this.goal.visible = this.arrow.visible = false;
    this.hud.route = null;
    this.hud.blips = [];
    this.hud.mission(null);
  }

  finish(passed, reason) {
    const ms = this.mission;
    ms.cleanup?.();
    ms.release?.();
    this.mission = null;
    this.needLeave = true; // step out of the ring before the next scene can start
    this.clearMarkers();
    this.onMissionEnd?.(ms.m.id, passed);
    if (passed) {
      const replay = this.finished;
      if (replay) this.replays[ms.c.id] = (this.replays[ms.c.id] || 0) + 1;
      this.done.add(ms.m.id);
      this.hud.addMoney(ms.m.pay);
      this.result('MISSION PASSED!', `$${ms.m.pay}`, true);
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.audio.blip({ tone: f, toneEnd: f, dur: 0.22, gain: 0.22 }), i * 120));
      if (!replay && this.finished) setTimeout(() => this.hud.say('<em>Sol City is yours.</em> The four still have work if you want it, and street races pay DaCity every day.', 8), 4000);
      this.onSave?.();
    } else {
      this.result('MISSION FAILED', reason || '', false);
      this.audio.blip({ tone: 330, toneEnd: 165, dur: 0.6, gain: 0.25 });
    }
  }

  showTitle(text) {
    const el = document.getElementById('mission-title');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  result(title, sub, passed) {
    document.getElementById('mission-title').classList.remove('show');
    const el = document.getElementById('mission-result');
    el.innerHTML = `<div class="r-title ${passed ? 'pass' : 'fail'}">${title}</div><div class="r-sub">${sub}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------------------------------------------------------------- update
  update(dt, input, { busy }) {
    this.t += dt;
    for (const m of [this.goal.userData.mat, ...this.contactRings.map((r) => r.userData.mat)]) m.uniforms.t.value += dt;
    const driving = this.getDriving();
    const P = this.player;

    // rings at the doors of the contacts who have work for you now
    const open = CONTACTS.filter((c) => this.available(c));
    CONTACTS.forEach((c, i) => {
      const ring = this.contactRings[i];
      ring.visible = open.includes(c) && !this.active;
      ring.position.set(c.stand.x, this.city.groundHeight(c.stand.x, c.stand.z), c.stand.z);
    });
    // on the maps: the ones with work, by name and held on the minimap's rim so they can be found
    // from anywhere; the others greyed out, so you know where they are for later
    this.blips = this.active
      ? []
      : CONTACTS.map((c) => (open.includes(c)
        ? { x: c.pos.x, z: c.pos.z, color: '#ffd23f', r: 6, label: c.name, icon: 'contact', edge: true }
        : { x: c.pos.x, z: c.pos.z, color: '#8d8d8d', r: 5, label: c.letter }));

    if (this.cut) return this.updateCutscene(dt, input);

    if (this.mission) {
      const ms = this.mission;
      if (P.dead || P.busted) return this.finish(false, P.dead ? 'You died.' : 'You were busted.');
      const r = ms.steps[ms.i].update(dt);
      if (!this.mission) return;
      const time = ms.data.time;
      this.hud.mission({ title: ms.m.title, time: time ?? null, rows: [['CONTACT', ms.c.name], ...(ms.rows || [])] });
      if (r === 'next') {
        if (ms.i + 1 >= ms.steps.length) return this.finish(true);
        this.goal.visible = this.arrow.visible = false;
        this.hud.route = null;
        this.hud.blips = [];
        this.enterStep(ms.i + 1);
      } else if (r === 'back') {
        this.goal.visible = this.arrow.visible = false;
        this.hud.route = null;
        this.hud.blips = [];
        this.enterStep(ms.i - 1);
      }
      else if (r && r.startsWith('fail:')) this.finish(false, r.slice(5));
      return;
    }

    // start a mission: walk (or drive and stop) into the yellow ring at the door
    if (P.dead || P.busted) return;
    const me = driving ? driving.vehicle.pos : P.position;
    const dist = (c) => Math.hypot(me.x - c.stand.x, me.z - c.stand.z);
    if (this.needLeave) {
      if (CONTACTS.every((c) => dist(c) > 4)) this.needLeave = false;
      return;
    }
    // at the door of someone with nothing for you yet: say who has
    for (const c of CONTACTS) {
      if (open.includes(c) || dist(c) > 2.5) {
        if (this.hinted === c && !open.includes(c)) this.hinted = null;
        continue;
      }
      if (this.hinted !== c) {
        const who = open.map((o) => `<em>${o.name[0] + o.name.slice(1).toLowerCase()}</em>`).join(' or ');
        this.hud.say(`<em>${c.name}:</em> "Nothing for you yet.${who ? ` Go and see ${who}.` : ''}"`, 4);
        this.hinted = c;
      }
    }
    for (const c of open) {
      if (dist(c) > (driving ? 4 : 2)) {
        if (this.hinted === c) this.hinted = null;
        continue;
      }
      // say once per visit why the scene can't start yet
      const why = this.wanted.level ? 'Not with the cops on your tail. Lose them first.' : busy ? 'Finish what you are doing first.' : null;
      if (why) {
        if (this.hinted !== c) this.hud.say(`<em>${c.name}:</em> "${why}"`, 3);
        this.hinted = c;
        continue;
      }
      if (driving) {
        // stop in the ring and the hero gets out by himself
        if (driving.vehicle.speed > 2) continue;
        this.exitCar?.();
      }
      this.startCutscene(c);
      return;
    }
  }

  // saved progress: { done: [mission ids] }
  get progress() {
    return { done: [...this.done], replays: this.replays };
  }

  load(p) {
    if (!p) return;
    if (Array.isArray(p.done)) {
      this.done = new Set(p.done.filter((id) => STORY.some((m) => m.id === id)));
      if (p.replays && typeof p.replays === 'object') this.replays = { ...p.replays };
      return;
    }
    // older saves counted missions per contact
    for (const c of CONTACTS) for (const m of c.missions.slice(0, p[c.id] || 0)) this.done.add(m.id);
  }
}
