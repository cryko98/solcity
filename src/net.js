// Multiplayer in the city: once the lobby's room has started (src/lobby.js, server/lobby.mjs), each
// player sends where they are and what they're doing about eight times a second, and the server's
// event stream brings everyone else's ("world" events, ten a second). Every other player is drawn
// as the hero's Rocketbox avatar (a pedestrian driven from the network, src/peds.js) with their
// username over their head; in a car, as that car with them at the wheel. Nothing else is shared
// yet: each player's traffic, people, missions and fights are their own.
import * as THREE from 'three';

const API = '/api/lobby/';
const SEND = 0.125; // s between my states
const ONE_SHOTS = ['punchl', 'punchr', 'hit', 'knockdown', 'getup'];
const _w = new THREE.Vector3();

// what the hero is doing, as one word (the heaviest of his blend weights)
function animOf(P) {
  if (P.dead) return 'dead';
  if (P.swimming) return P.speed > 0.3 ? 'swim' : 'tread';
  let best = 'idle', bw = 0;
  for (const [n, w] of Object.entries(P.weights)) {
    if (n.endsWith('_lo') || w <= bw) continue;
    best = n;
    bw = w;
  }
  if (/^(pistol|smg|shotgun)_/.test(best)) return 'aim';
  if (best === 'walk' || best === 'run') return P.speed > 4.6 ? 'sprint' : P.speed > 2.1 ? 'run' : P.speed > 0.2 ? 'walk' : 'idle';
  return best;
}

// a name tag over a head: the username on a dark rounded plate (drawn once)
function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Inter, Arial, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 10, w, 44, 12);
  g.fill();
  g.fillStyle = '#ffd23f';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  s.renderOrder = 10;
  return s;
}

export class Net {
  // me: { id, key } in the room; es: the room's event stream (kept open); slot: my place in the
  // room (everyone starts side by side at the city's spawn, not wherever their last game left them)
  constructor(game, me, es, slot = 0) {
    this.g = game;
    this.me = me;
    this.es = es;
    this.others = new Map(); // id -> { name, s, ped, car, tag }
    this.sendT = 0;
    this.busy = false;
    const P = game.player, c = game.city, yaw = c.spawnYaw || 0;
    const side = (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 2.5; // 0, -2.5, 2.5, -5, 5...
    const x = c.spawn.x + Math.cos(yaw) * side, z = c.spawn.z - Math.sin(yaw) * side;
    if (!game.state().driving) {
      P.position.set(x, c.groundHeight(x, z), z);
      P.yaw = yaw;
      P.object.rotation.y = yaw;
      if (game.follow) game.follow.yaw = yaw;
    }
    es.addEventListener('world', (ev) => {
      try {
        this.world(JSON.parse(ev.data));
      } catch {}
    });
    addEventListener('pagehide', () => navigator.sendBeacon?.(API + 'act', JSON.stringify({ id: me.id, key: me.key, type: 'leave' })));
  }

  // the latest states from the server: new players appear, gone ones go
  world(w) {
    const seen = new Set();
    for (const { id, name, s } of w.p) {
      if (id === this.me.id || !s) continue;
      seen.add(id);
      let o = this.others.get(id);
      if (!o) this.others.set(id, (o = { name, s, at: performance.now() }));
      o.prev = o.s;
      o.s = s;
      o.name = name;
    }
    for (const [id, o] of this.others) if (!seen.has(id)) this.drop(id, o);
  }

  drop(id, o) {
    if (o.ped) this.g.peds.remove(o.ped);
    this.parkCar(o);
    this.others.delete(id);
  }

  parkCar(o) {
    if (!o.car) return;
    if (o.car.vehicle) this.g.peds.unseatDriver(o.car.vehicle);
    this.g.vehicles.remove(o.car);
    o.car = null;
  }

  // every frame: send mine now and then, move everyone else toward their latest state
  update(dt) {
    this.sendT += dt;
    if (this.sendT >= SEND && !this.busy) {
      this.sendT = 0;
      this.send();
    }
    const k = 1 - Math.exp(-dt * 10);
    for (const o of this.others.values()) this.place(o, dt, k);
  }

  send() {
    const P = this.g.player, d = this.g.state().driving;
    const s = { x: P.position.x, y: P.position.y, z: P.position.z, h: P.yaw, v: Math.max(0, P.speed || 0), a: animOf(P) };
    if (d?.vehicle) {
      const v = d.vehicle;
      s.a = v.spec?.bike ? 'ride' : 'drive';
      s.c = { m: d.model, k: typeof d.color === 'number' ? d.color : 0x8a8f96, x: v.pos.x, y: v.pos.y || 0, z: v.pos.z, h: v.heading, v: v.vf || 0 };
    }
    for (const key of ['x', 'y', 'z', 'h', 'v']) if (!Number.isFinite(s[key])) return;
    this.busy = true;
    fetch(API + 'state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: this.me.id, key: this.me.key, s }), keepalive: true })
      .catch(() => {})
      .finally(() => (this.busy = false));
  }

  place(o, dt, k) {
    const s = o.s, G = this.g;
    if (s.c) {
      // at the wheel: their car (its driver wears the hero too), moved where they are
      if (o.ped) {
        G.peds.remove(o.ped);
        o.ped = null;
      }
      if (!o.car || o.car.model !== s.c.m) {
        this.parkCar(o);
        o.car = G.vehicles.spawn({ x: s.c.x, z: s.c.z, yaw: s.c.h, model: s.c.m, color: s.c.k, keep: true, remote: true });
        if (o.car.vehicle) G.peds.seatDriver(o.car.vehicle, 'male', 'Hero');
        o.tag?.parent?.remove(o.tag);
        o.tag = null;
      }
      const v = o.car.vehicle;
      if (!v) return;
      v.pos.x += (s.c.x - v.pos.x) * k;
      v.pos.z += (s.c.z - v.pos.z) * k;
      v.heading += Math.atan2(Math.sin(s.c.h - v.heading), Math.cos(s.c.h - v.heading)) * k;
      v.vel.set(Math.sin(v.heading) * s.c.v, 0, Math.cos(v.heading) * s.c.v);
      this.tagOn(o, v.body, 2.1);
      return;
    }
    if (o.car) this.parkCar(o);
    // on foot: a pedestrian the network moves
    if (!o.ped) {
      o.ped = G.peds.add('male', s.x, s.z, s.h, 'Hero');
      Object.assign(o.ped, { state: 'remote', keep: true, invulnerable: true, remote: true });
      o.tag = null;
    }
    const p = o.ped;
    p.x += (s.x - p.x) * k;
    p.z += (s.z - p.z) * k;
    p.y += (s.y - p.y) * k;
    p.yaw += Math.atan2(Math.sin(s.h - p.yaw), Math.cos(s.h - p.yaw)) * k;
    p.cur = s.v;
    // a punch, a hit, a fall: played once when it starts
    if (s.a !== o.lastAnim) {
      o.lastAnim = s.a;
      if (ONE_SHOTS.includes(s.a) && p.anim.actions[s.a]) p.overlay = { name: s.a, t: 0, dur: p.anim.once(s.a) };
    }
    p.netAnim = s.a;
    this.tagOn(o, p.body, 2.05 / (p.scale || 1));
  }

  tagOn(o, parent, h) {
    if (!o.tag) o.tag = nameTag(o.name);
    if (o.tag.parent !== parent) parent.add(o.tag);
    o.tag.position.set(0, h, 0);
    // (near enough to matter: from where I am, the camera may not have moved yet this frame)
    const me = this.g.player.position, w = o.tag.getWorldPosition(_w);
    o.tag.visible = Math.hypot(w.x - me.x, w.z - me.z) < 90;
  }

  leave() {
    navigator.sendBeacon?.(API + 'act', JSON.stringify({ id: this.me.id, key: this.me.key, type: 'leave' }));
    this.es.close();
    for (const [id, o] of this.others) this.drop(id, o);
  }
}
