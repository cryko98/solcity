// Story missions, GTA style: three contacts around the city (yellow letter blips).
// Walk up to one on foot and a cutscene plays - letterbox, shot / reverse-shot
// camera, typed-out dialogue with mumbled "voices" - then the mission starts.
// Each contact has two missions; progress is saved with the game.
//   R  Rosa Marquez   - Little Havana, runs a cafe
//   V  Vince Moretti  - Old Harbor, owns the docks
//   D  Lt. Carla Diaz - Downtown, a cop on the take
import * as THREE from 'three';
import { Vigilante } from './vigilante.js';
import { buildInteriors, SEAT_Y } from './interiors.js';
import { chooseOutfit } from './materials.js';

const FLOOR = -0.03;
const FADE = 0.45;

const PLAYER = 'NICO';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ dialogue + missions
const CONTACTS = [
  {
    id: 'rosa', name: 'ROSA', letter: 'R', room: 'cafe', kind: 'female', color: '#ff8ab8', voice: 300, block: [2, 5], t: 28,
    outfit: { Skin: '#a8714c', Shirt: '#b0203a', Denim: '#1c1c22', Hair: '#120c08', Sneaker: '#2a2a2a', wear: 'female_casualsuit01' },
    missions: [
      {
        title: 'PROTECTION MONEY', pay: 400, pose: 'sit',
        lines: [
          ['ROSA', 'Nico! Thank God you came. Sit... no, there is no time to sit.'],
          [PLAYER, "What's wrong, Rosa?"],
          ['ROSA', "A punk called Tito. Every week he walks in, takes my money and calls it 'protection'."],
          ['ROSA', 'Protection from who? From him!'],
          [PLAYER, 'Where do I find him?'],
          ['ROSA', 'He hangs around on the next block. Go and teach him some manners. Not too many manners.'],
        ],
        type: 'beat', where: [3, 6],
      },
      {
        title: 'HOT DELIVERY', pay: 600, pose: 'stand',
        lines: [
          ['ROSA', "Tito won't be coming back. Half the street saw it. Business is booming!"],
          ['ROSA', 'Too booming. My delivery boy quit this morning.'],
          [PLAYER, 'Let me guess. You need a driver.'],
          ['ROSA', 'The van is out front. Forty empanadas for a party on the beach. Hot, Nico. HOT.'],
          [PLAYER, 'And if they arrive cold?'],
          ['ROSA', "Then don't come back."],
        ],
        type: 'deliver',
      },
    ],
  },
  {
    id: 'vince', name: 'VINCE', letter: 'V', room: 'office', kind: 'male', color: '#ffd23f', voice: 115, block: [1, 2], t: 30,
    outfit: { Skin: '#e6b897', Shirt: '#ece6da', Denim: '#24242a', Hair: '#16100c', Sneaker: '#121212', wear: 'male_elegantsuit01' },
    missions: [
      {
        title: 'SINK THE COMPETITION', pay: 700, pose: 'sit',
        lines: [
          ['VINCE', "So you're the guy who put Tito in the hospital. Rosa talks a lot."],
          [PLAYER, "Depends who's asking."],
          ['VINCE', 'Vince Moretti. These docks are mine. South Beach... is getting crowded.'],
          ['VINCE', "The Russo brothers just bought a shiny new car. It's parked outside their club."],
          [PLAYER, 'You want it?'],
          ['VINCE', 'I want it on fire.'],
        ],
        type: 'destroy', where: [6, 6],
      },
      {
        title: 'HOT WHEELS', pay: 900, pose: 'stand',
        lines: [
          ['VINCE', 'The Russos are still crying about their car. Beautiful.'],
          ['VINCE', 'Now, business. A client in Miami wants a supercar. Yellow. Very yellow.'],
          [PLAYER, 'Where?'],
          ['VINCE', 'Some movie producer leaves one on the street in Vinewood Hills. Bring it here.'],
          ['VINCE', 'And Nico... not a scratch. Scratches come out of your cut.'],
        ],
        type: 'steal', where: [6, 1],
      },
    ],
  },
  {
    id: 'diaz', name: 'DIAZ', letter: 'D', room: 'interview', kind: 'police', color: '#6fb7ff', voice: 210, block: [3, 4], t: 30,
    outfit: { Skin: '#7a4a30', Hair: '#0e0a08' },
    missions: [
      {
        title: 'THE SNITCH', pay: 800, pose: 'sit',
        lines: [
          ['DIAZ', "Relax. If I wanted to arrest you, you'd already be in cuffs."],
          [PLAYER, 'Lieutenant. To what do I owe the pleasure?'],
          ['DIAZ', 'Eddie Pruitt. Small-time dealer, big mouth. Tomorrow he testifies, and my name comes up.'],
          ['DIAZ', "He's leaving town in a grey sedan. Right now."],
          [PLAYER, 'And you want him stopped.'],
          ['DIAZ', "Stop the car. Whatever happens after that, I didn't hear about it."],
        ],
        type: 'chase',
      },
      {
        title: 'EVIDENCE', pay: 1000, pose: 'stand',
        lines: [
          ['DIAZ', 'Eddie decided to retire. Smart man.'],
          ['DIAZ', 'One problem left. Internal Affairs found a bag of evidence at the Port of Sol.'],
          ['DIAZ', 'Grab it before they log it. Every cop on the radio will be after you.'],
          [PLAYER, 'Your own guys?'],
          ['DIAZ', "They don't know they work for me. Shake them off and bring the bag back here."],
        ],
        type: 'evidence',
      },
    ],
  },
];

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
    this.progress = { rosa: 0, vince: 0, diaz: 0 };
    this.cut = null;
    this.mission = null;
    this.t = 0;
    this.el = document.getElementById('cutscene');
    this.dlg = document.getElementById('dialogue');
    this.rooms = buildInteriors(this.scene);
    this.fadeEl = document.getElementById('fade');
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
      const c = outfit[/^(Hair|Brow)Cards$/.test(o.material.name) ? 'Hair' : o.material.name];
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
    const p = this.peds.add(c.kind, h.x, h.z, Math.PI);
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
    const m = c.missions[this.progress[c.id]];
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
    const hips = p.body.getObjectByName('hips').position.y * p.scale;
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
  roadside(bi, bj, along) {
    // kerbside parking spot on the road north of block (bi, bj), facing +x
    const { ROAD } = this.city;
    return { x: this.city.blockMin(bi) + along, z: this.city.roadC(bj) + ROAD / 2 - 1.15, yaw: Math.PI / 2 };
  }

  startMission(c, m) {
    const ms = { c, m, step: null, data: {} };
    this.mission = ms;
    this.showTitle(m.title);
    const v = this.vehicles, ped = this.peds, city = this.city;
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

    if (m.type === 'beat') {
      const x0 = city.blockMin(m.where[0]), z0 = city.blockMin(m.where[1]);
      const tito = ped.add('male', x0 + 22, z0 + 2.2, Math.PI);
      tito.state = 'contact';
      tito.keep = true;
      this.dress(tito, { Shirt: '#d8b83a', Denim: '#33333a', Hair: '#0a0a0a', wear: 'male_casualsuit05' });
      ms.data.target = tito;
      ms.steps = [S('Find <em>Tito</em> and beat him up.', () => {
        this.arrowOn(tito.x, tito.y + 2.4, tito.z);
        this.hud.blips = [{ x: tito.x, z: tito.z, color: '#ff3b3b' }];
        this.routeTo(me(), tito);
        if (tito.state === 'down') return 'next';
        if (!ped.list.includes(tito)) return 'fail:Tito got away.';
        return null;
      })];
      ms.cleanup = () => (tito.keep = false);
    } else if (m.type === 'deliver') {
      const spot = this.roadside(c.block[0], c.block[1], c.t + 7);
      const van = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: 0xf2efe6, model: 'van' });
      const dest = { x: 20, z: city.HALF + 16 };
      ms.data.car = van;
      ms.steps = [
        S("Get in Rosa's <em>van</em>.", () => {
          if (van.wrecked) return 'fail:The van was destroyed.';
          const p = posOf(van);
          this.arrowOn(p.x, 3, p.z);
          this.hud.blips = [{ x: p.x, z: p.z, color: '#4fa3ff' }];
          this.routeTo(me(), p);
          return this.getDriving() === van ? 'next' : null;
        }),
        S('Deliver the food to the <em>beach party</em> before it gets cold.', (dt) => {
          ms.data.time -= dt;
          if (van.wrecked || van.health < 35) return 'fail:The food is ruined.';
          if (ms.data.time <= 0) return 'fail:The empanadas went cold.';
          if (this.getDriving() !== van) {
            this.arrowOn(posOf(van).x, 3, posOf(van).z);
            this.goalOn(null);
            return null;
          }
          this.arrow.visible = false;
          this.goalOn(dest);
          this.routeTo(van.vehicle.pos, dest);
          return stoppedAt(van.vehicle, dest, 7) ? 'next' : null;
        }, () => (ms.data.time = Math.round(Math.hypot(posOf(van).x - dest.x, posOf(van).z - dest.z) * 1.4 / 11 + 25))),
      ];
    } else if (m.type === 'destroy') {
      const spot = this.roadside(m.where[0], m.where[1], 25);
      const car = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: 0x5a0f18, model: 'lux' });
      ms.data.car = car;
      ms.steps = [
        S("Destroy the <em>Russos' car</em>.", () => {
          const p = car.vehicle ? car.vehicle.pos : car;
          this.arrowOn(p.x, 3, p.z);
          this.hud.blips = [{ x: p.x, z: p.z, color: '#ff3b3b' }];
          this.routeTo(me(), p);
          return car.wrecked ? 'next' : null;
        }),
        loseCops,
      ];
    } else if (m.type === 'steal') {
      const spot = this.roadside(m.where[0], m.where[1], 22);
      const car = v.spawn({ x: spot.x, z: spot.z, yaw: spot.yaw, color: 0xf5c400, model: 'super' });
      const drop = this.roadside(c.block[0], c.block[1], c.t + 8);
      ms.data.car = car;
      ms.steps = [
        S('Steal the <em>yellow supercar</em> in Vinewood Hills.', () => {
          if (car.wrecked) return 'fail:The car was destroyed.';
          const p = posOf(car);
          this.arrowOn(p.x, 2.6, p.z);
          this.hud.blips = [{ x: p.x, z: p.z, color: '#4fa3ff' }];
          this.routeTo(me(), p);
          return this.getDriving() === car ? 'next' : null;
        }),
        S('Bring it to <em>Vince</em> without a scratch.', () => {
          if (car.wrecked || car.health < 55) return 'fail:The car is too damaged.';
          if (this.getDriving() !== car) {
            this.arrowOn(posOf(car).x, 2.6, posOf(car).z);
            this.goalOn(null);
            return null;
          }
          this.arrow.visible = false;
          this.goalOn(drop);
          this.routeTo(car.vehicle.pos, drop);
          return stoppedAt(car.vehicle, drop, 6) ? (this.wanted.level ? null : 'next') : null;
        }),
      ];
    } else if (m.type === 'chase') {
      // a getaway driver run by the vigilante flee logic
      const chase = Object.assign(Object.create(Vigilante.prototype), { city, vehicles: v, hud: this.hud, audio: this.audio, level: 2, wp: null, stuck: 0, reverse: 0 });
      const P = this.player.position;
      let car = null;
      for (let k = 0; k < 40 && !car; k++) {
        const n = [Math.floor(Math.random() * (city.N + 1)), Math.floor(Math.random() * (city.N + 1))];
        const p = chase.pos(n);
        const d = Math.hypot(p.x - P.x, p.z - P.z);
        if (d < 70 || d > 160) continue;
        car = v.spawn({ x: p.x, z: p.z, yaw: Math.atan2(p.x - P.x, p.z - P.z), color: 0x8a8f96, model: 'sedan', ai: { suspect: true, ctl: { throttle: 0, steer: 0, handbrake: false } } });
      }
      chase.suspect = car;
      ms.data.car = car;
      ms.data.time = 150;
      ms.steps = [S("Stop <em>Eddie's</em> grey sedan.", (dt) => {
        if (car.burning || car.wrecked || car.health <= 30 || !car.ai) {
          car.ai = null;
          return 'next';
        }
        ms.data.time -= dt;
        const p = posOf(car), me = this.getDriving()?.vehicle.pos || this.player.position;
        if (ms.data.time <= 0 || Math.hypot(p.x - me.x, p.z - me.z) > 450) return 'fail:Eddie got away.';
        chase.drive(dt, me);
        this.routeTo(me, p);
        this.arrowOn(p.x, 3, p.z);
        this.hud.blips = [{ x: p.x, z: p.z, color: '#ff3b3b' }];
        return null;
      })];
      ms.cleanup = () => {
        if (car.ai) car.ai = null;
      };
    } else if (m.type === 'evidence') {
      const bag = { x: -60, z: -city.HALF - 20 };
      ms.steps = [
        S('Pick up the <em>evidence</em> at the Port of Sol.', () => {
          this.goalOn(bag, 2);
          this.routeTo(this.getDriving()?.vehicle.pos || this.player.position, bag);
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
          this.goalOn(c.stand, 2);
          this.routeTo(this.getDriving()?.vehicle.pos || this.player.position, c.stand);
          if (this.wanted.level) return 'back';
          return at(c.stand, 4) ? 'next' : null;
        }),
      ];
    }
    this.enterStep(0);
  }

  enterStep(i) {
    const ms = this.mission;
    ms.i = i;
    const s = ms.steps[i];
    s.enter?.();
    this.hud.say(s.text, 5);
  }

  routeTo(from, to) {
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
    this.mission = null;
    this.needLeave = true; // step out of the ring before the next scene can start
    this.clearMarkers();
    if (passed) {
      this.progress[ms.c.id]++;
      this.hud.addMoney(ms.m.pay);
      this.result('MISSION PASSED!', `$${ms.m.pay}`, true);
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.audio.blip({ tone: f, toneEnd: f, dur: 0.22, gain: 0.22 }), i * 120));
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

    // contacts stand in front of their door; rings show who has work
    CONTACTS.forEach((c, i) => {
      const has = this.progress[c.id] < c.missions.length;
      const ring = this.contactRings[i];
      ring.visible = has && !this.active;
      ring.position.set(c.stand.x, this.city.groundHeight(c.stand.x, c.stand.z), c.stand.z);

    });
    this.blips = this.active ? [] : CONTACTS.filter((c) => this.progress[c.id] < c.missions.length)
      .map((c) => ({ x: c.pos.x, z: c.pos.z, color: '#ffd23f', r: 6, label: c.letter }));

    if (this.cut) return this.updateCutscene(dt, input);

    if (this.mission) {
      const ms = this.mission;
      if (P.dead || P.busted) return this.finish(false, P.dead ? 'You died.' : 'You were busted.');
      const r = ms.steps[ms.i].update(dt);
      const time = ms.data.time;
      this.hud.mission({ title: ms.m.title, time: time ?? null, rows: [['CONTACT', ms.c.name]] });
      if (r === 'next') {
        if (ms.i + 1 >= ms.steps.length) return this.finish(true);
        this.goal.visible = this.arrow.visible = false;
        this.hud.route = null;
        this.enterStep(ms.i + 1);
      } else if (r === 'back') this.enterStep(ms.i - 1);
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
    for (const c of CONTACTS) {
      if (this.progress[c.id] >= c.missions.length) continue;
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

  // the contacts' missions as saved data
  load(p) {
    if (p) Object.assign(this.progress, p);
  }
}
