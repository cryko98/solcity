// Bounty hunting: a notice board outside the Downtown precinct (next to Diaz's law office).
// Take a bounty and the board tells you roughly where the man was last seen (a yellow area
// blip). Get close and he either runs or pulls a gun. Bring him in alive (knock him down
// with your fists, walk up, E to cuff him) for the full price; shot or run over, half.
import * as THREE from 'three';
import { CONTACT_PLACES, blockMin } from './shared/world.mjs';

const NAMES = ['"Knuckles" Moreno', 'Danny "The Eel" Price', 'Big Sal Romano', 'Tommy Vargas', 'Leon "Ghost" Mercer', 'Ricky Duarte',
  'Frankie Lutz', 'Hector "Hex" Salas', 'Marty Klein', 'Vic Torres'];
const CRIMES = ['armed robbery', 'skipping bail', 'running guns', 'a jewellery heist', 'assaulting an officer', 'fraud'];
const DRESS = { Shirt: '#5a4a32', Denim: '#22252c', Hair: '#0a0a0a' };

export class Bounties {
  constructor({ scene, city, peds, hud, audio, player, weapons }) {
    Object.assign(this, { scene, city, peds, hud, audio, player, weapons });
    // the board: a cork notice board on two posts, with a ring in front of it
    const d = CONTACT_PLACES.diaz;
    this.board = { x: blockMin(d.block[0]) + d.t + 6, z: blockMin(d.block[1]) + 1.05 };
    const y = city.groundHeight(this.board.x, this.board.z);
    const g = new THREE.Group();
    g.position.set(this.board.x, y, this.board.z + 0.9);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 });
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#b8895a';
    x2.fillRect(0, 0, 256, 160);
    for (let k = 0; k < 5; k++) {
      x2.fillStyle = '#f3ecd8';
      x2.fillRect(12 + k * 48, 26 + (k % 2) * 10, 40, 54);
      x2.fillStyle = '#222';
      x2.fillRect(20 + k * 48, 34 + (k % 2) * 10, 24, 22);
    }
    x2.fillStyle = '#7a1010';
    x2.font = 'bold 26px Anton, Impact, sans-serif';
    x2.textAlign = 'center';
    x2.fillText('WANTED  BOUNTIES', 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.06), [wood, wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })]);
    board.position.y = 1.55;
    g.add(board);
    for (const s of [-0.8, 0.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), wood);
      post.position.set(s, 0.8, 0);
      g.add(post);
    }
    g.traverse((o) => (o.castShadow = true));
    scene.add(g);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xd8b04a, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.position.set(this.board.x, y + 0.04, this.board.z);
    scene.add(this.ring);
    this.job = null;
    this.t = 0;
  }

  get active() {
    return !!this.job;
  }

  blips() {
    const b = [{ x: this.board.x, z: this.board.z, color: '#d8b04a', r: 5, kind: 'bounty' }];
    const j = this.job;
    if (j) b.push(j.seen ? { x: j.p.x, z: j.p.z, color: '#ff3b3b', r: 5, kind: 'bounty' } : { x: j.area.x, z: j.area.z, color: '#ffd23f', r: 9, kind: 'bounty' });
    return b;
  }

  offer() {
    const name = NAMES[Math.floor(Math.random() * NAMES.length)], crime = CRIMES[Math.floor(Math.random() * CRIMES.length)];
    const alive = 1500 + Math.round(Math.random() * 15) * 100;
    return { name, crime, alive, dead: Math.round(alive / 2), armed: Math.random() < 0.5 };
  }

  take(o) {
    const P = this.player.position, { N, BLOCK } = this.city;
    let spot = null;
    for (let k = 0; k < 40 && !spot; k++) {
      const bi = Math.floor(Math.random() * N), bj = Math.floor(Math.random() * N);
      const x = this.city.blockMin(bi) + 5 + Math.random() * (BLOCK - 10), z = this.city.blockMin(bj) + 1.6;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d > 150 && d < 320) spot = { x, z };
    }
    if (!spot) return;
    const p = this.peds.add('male', spot.x, spot.z, Math.random() * 6.28);
    p.state = 'contact';
    p.keep = true;
    p.hostile = true;
    p.body.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const col = DRESS[/^(Hair|Brow)Cards$/.test(m.material.name) ? 'Hair' : m.material.name.endsWith('__shirt') ? 'Shirt' : m.material.name];
      if (col) {
        m.material = m.material.clone();
        m.material.color.set(col);
      }
    });
    if (o.armed) this.arm(p);
    // the area is a guess: the real spot is somewhere within ~45 m of it
    const a = Math.random() * 6.28, r = 15 + Math.random() * 30;
    this.job = { ...o, p, area: { x: spot.x + Math.cos(a) * r, z: spot.z + Math.sin(a) * r }, seen: false, t: 0 };
    const where = this.city.locationName(spot.x, spot.z);
    this.hud.say(`Bounty: <em>${o.name}</em>, wanted for ${o.crime}. Last seen around <em>${where.street}, ${where.district}</em> (yellow blip). $${o.alive} alive, $${o.dead} dead.`, 6);
  }

  // a pistol in his hand (a copy of the hero's, like the Russo gunmen)
  arm(p) {
    const src = this.player.model.getObjectByName('Weapon_Pistol'), hand = p.body.getObjectByName(src?.parent?.name || 'hand.R');
    if (!src || !hand) return;
    const gun = src.clone(true);
    gun.traverse((o) => (o.visible = true));
    hand.add(gun);
    p.body.userData.gun = gun;
    p.gunman = true;
  }

  finish(msg, pay) {
    const j = this.job;
    this.job = null;
    j.p.keep = false;
    j.p.hostile = false;
    j.p.aimingGun = false;
    if (pay) {
      this.hud.addMoney(pay);
      this.audio.cash();
    }
    if (msg) this.hud.say(msg, 4);
  }

  update(dt, { input, driving, busy }) {
    this.t += dt;
    this.ring.material.opacity = 0.55 + 0.25 * Math.sin(this.t * 4);
    const P = this.player.position;
    // the notice board
    const atBoard = !driving && Math.hypot(P.x - this.board.x, P.z - this.board.z) < 0.9;
    if (atBoard && !this.atBoard) {
      if (this.job) this.hud.say(`You're already after <em>${this.job.name}</em>.`, 3);
      else if (busy) this.hud.say('Finish what you are doing first.', 3);
      else {
        this.pending = this.offer();
        this.hud.say(`WANTED: <em>${this.pending.name}</em> for ${this.pending.crime}${this.pending.armed ? ', armed' : ''}. <em>$${this.pending.alive}</em> alive, $${this.pending.dead} dead. Press <em>E</em> to take it.`, 6);
      }
    }
    this.atBoard = atBoard;
    if (atBoard && this.pending && !this.job && input.pressed('KeyE')) {
      this.take(this.pending);
      this.pending = null;
    }
    const j = this.job;
    if (!j) return;
    j.t += dt;
    if (this.player.dead || this.player.busted) return this.finish(`${j.name} slipped away.`);
    const p = j.p, me = driving ? driving.vehicle.pos : P, d = Math.hypot(p.x - me.x, p.z - me.z);
    if (!this.peds.list.includes(p)) return this.finish(`${j.name} slipped away.`);
    if (p.state === 'down') {
      if (p.wasShot || p.runOver) return this.finish(`${j.name} won't be standing trial. Half the bounty: <em>$${j.dead}</em>.`, j.dead);
      // alive: cuff him
      p.timer = Math.min(p.timer, 5); // he stays down while you walk over
      if (!driving && d < 2) {
        if (!j.cuffHint) this.hud.say('Press <em>E</em> to cuff him.', 3);
        j.cuffHint = true;
        if (input.pressed('KeyE')) return this.finish(`${j.name} is going back to jail, alive. Bounty: <em>$${j.alive}</em>.`, j.alive);
      }
      return;
    }
    // spotted: he runs, or stands and shoots (fists when you're on top of him)
    if (!j.seen && d < 28) {
      j.seen = true;
      this.hud.say(j.armed ? `That's <em>${j.name}</em>, and he's armed!` : `That's <em>${j.name}</em>! He's running!`, 3);
    }
    if (!j.seen) return;
    if (j.armed) {
      if (d < 2.5 && !driving) {
        if (p.state !== 'fight') {
          p.state = 'fight';
          p.attackTimer = 0.4;
        }
      } else {
        if (p.state !== 'contact') p.state = 'contact';
        p.yaw = Math.atan2(me.x - p.x, me.z - p.z);
        p.aimingGun = d < 30 && this.peds.canSee(p, me.x, me.z);
        if (p.aimingGun && (p.fireTimer = (p.fireTimer ?? 1.2) - dt) <= 0) {
          p.fireTimer = 1.6 + Math.random() * 1.2;
          this.peds.onCopFire?.(p);
        }
      }
    } else {
      p.state = 'flee';
      p.timer = 999;
      p.fleeFrom = { x: me.x, z: me.z };
      if (d > 220) return this.finish(`${j.name} got away.`);
    }
  }
}
