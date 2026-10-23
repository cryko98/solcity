// Shops you can walk into: three Ammu-Nations, three restaurants, three clothes stores and two
// 24/7 stores spread over the districts. Each has a real shop front on a building (door, sign,
// awning, lit windows, an entrance ring) and its own furnished interior, built far outside
// the island like the story rooms. Walking into the ring fades to the interior (indoor camera,
// the room's own lights); the clerk serves you at the counter (keys 1-6); the ring by the door
// takes you back out to the street.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { checker, planks } from './interiors.js';
import { ICONS, iconImage } from './icons.js';
import { chooseOutfit } from './materials.js';
import { HAIRCUTS, TATTOOS, tattooArt } from './fun.js';
import { SHOP_BRANCHES } from './shared/world.mjs';

const FADE = 0.45;
const IN_X = 2200, IN_Z = 1700, IN_STEP = 160; // interiors: one row far east of the story rooms

// what each kind of shop sells
const GUN_ITEMS = [
  { key: 'pistol', name: 'Pistol', price: 150 },
  { key: 'smg', name: 'SMG', price: 450 },
  { key: 'shotgun', name: 'Shotgun', price: 600 },
  { key: 'armor', name: 'Body armor', price: 250 },
];
const MENUS = {
  'BURGER SOL': [['Sol Burger', 8, 25], ['Double Stack + fries', 14, 50], ['Family Feast', 25, 100]],
  'TACO LOCO': [['Street tacos', 7, 25], ['Loco burrito', 13, 50], ['Fiesta platter', 24, 100]],
  'PIZZA SOL': [['Pizza slice', 6, 25], ['Large pepperoni', 15, 50], ['Party box', 26, 100]],
};
const MART_ITEMS = [['Chips & candy', 3, 10], ['Energy drink', 6, 20], ['First-aid kit', 45, 100], ['Scratch card', 10, 0]];
const CLOTHES = [
  { name: 'White tank top', part: 'shirt', color: '#f2f1ec', price: 40 },
  { name: 'Black tank top', part: 'shirt', color: '#2a2a2e', price: 40 },
  { name: 'Red tank top', part: 'shirt', color: '#b8202c', price: 60 },
  { name: 'Sky blue tank top', part: 'shirt', color: '#5a9ad8', price: 60 },
  { name: 'Classic blue jeans', part: 'jeans', color: '#ffffff', price: 80 },
  { name: 'Black jeans', part: 'jeans', color: '#45484f', price: 80 },
];

// branches: [type, name, block i, block j] (shared with the city, which keeps their fronts plain)
const BRANCHES = SHOP_BRANCHES;
// the look of each kind of shop front: wall, trim, what the windows show
const FRONT_LOOK = {
  gun: { wall: 0x2e3136, trim: 0x585e66, metal: true, inside: '#3b3d40', goods: ['#1d1d1f', '#4a4d52', '#7a6a50', '#2b2f35', '#8a8f96'] },
  food: { wall: 0xf1e3c8, trim: 0xb8452a, inside: '#f4e7cb', goods: ['#d2452c', '#f2c12e', '#7cbf4a', '#e98b2e', '#8a5032'] },
  clothes: { wall: 0xf4f2ee, trim: 0x2b2b30, inside: '#efe9df', goods: ['#c0392b', '#2c3e70', '#e8d8b0', '#4a7a5a', '#222', '#d98cb3'] },
  bank: { wall: 0xe6dfcd, trim: 0x8a7650, inside: '#e9e1cc', goods: ['#c9a24a', '#5a3a24', '#2e6b3c', '#8e959c'] },
  mart: { wall: 0xf2f4f1, trim: 0x1f7a45, inside: '#e8eef0', goods: ['#d63a3a', '#f2c12e', '#3d6ea8', '#2bb673', '#ef8a3c', '#8a5fb0'] },
  barber: { wall: 0xe9eef0, trim: 0x2c4f9e, inside: '#eef0ec', goods: ['#b3202a', '#2c4f9e', '#f4f2ee', '#c0c4c8'] },
  tattoo: { wall: 0x1f1d22, trim: 0x7a1450, inside: '#2a2328', goods: ['#ff3fa8', '#efe7d2', '#d8b23a', '#111'] },
  gym: { wall: 0x2a2c30, trim: 0xb3202a, metal: true, inside: '#3a3c40', goods: ['#141416', '#8a9096', '#b3202a', '#ffd23f'] },
  club: { wall: 0x141018, trim: 0x5d2e8c, metal: true, inside: '#1a1020', goods: ['#ff3fa8', '#41d6ff', '#b46bff', '#ffd23f'] },
  arcade: { wall: 0x161624, trim: 0x2a7ad8, inside: '#141428', goods: ['#ff4fa3', '#41d6ff', '#ffcf3f', '#7dff6a', '#b46bff'] },
};
const ROB_TIME = 6; // seconds of holding the clerk at gunpoint to empty the till
const ROB_COOLDOWN = 5 * 60 * 1000; // before the same till has cash in it again
const STYLE = {
  bank: { sign: '#d9b44a', awning: 0x1d2a44 },
  gun: { sign: '#ff4040', awning: 0x8e1b1b },
  food: { sign: '#ffb02e', awning: 0xc8541c },
  clothes: { sign: '#c38bff', awning: 0x5d2e8c },
  mart: { sign: '#55e08a', awning: 0x1f7a45 },
  barber: { sign: '#ff6b6b', awning: 0x2c4f9e },
  tattoo: { sign: '#ff3fa8', awning: 0x3a1420 },
  gym: { sign: '#ffd23f', awning: 0x8e1b1b },
  club: { sign: '#ff3fa8', awning: 0x2a1240 },
  arcade: { sign: '#41d6ff', awning: 0x1d2a64 },
};
// the counters at the venues: [name, price, health]
const VENUE_MENUS = {
  gym: [['Protein shake', 8, 25], ['Energy bar', 4, 10]],
  club: [['Beer', 6, 5], ['Mojito', 12, 10], ['Solar Shot <small>(strong)</small>', 20, 0]],
  arcade: [['Soda', 2, 5], ['Nachos', 5, 15]],
};

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const pegboard = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6a5a44';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a241c';
  for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) {
    g.beginPath();
    g.arc(x, y, 2.2, 0, Math.PI * 2);
    g.fill();
  }
}, true);
const tiles = (a, b) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = a;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = b;
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, h);
    g.moveTo(0, i * 64);
    g.lineTo(w, i * 64);
    g.stroke();
  }
}, true);
const target = () => canvasTex(128, 192, (g, w, h) => {
  g.fillStyle = '#f2ead6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  g.beginPath();
  g.ellipse(64, 70, 30, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(24, 100, 80, 90);
  g.strokeStyle = '#f2ead6';
  g.lineWidth = 3;
  for (const r of [10, 22, 36]) {
    g.beginPath();
    g.ellipse(64, 120, r, r * 1.2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#d23';
  g.beginPath();
  g.arc(64, 120, 5, 0, Math.PI * 2);
  g.fill();
});
const neonCarpet = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#12102a';
  g.fillRect(0, 0, w, h);
  const cols = ['#ff4fa3', '#41d6ff', '#ffcf3f', '#7dff6a'];
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = cols[k % 4];
    g.lineWidth = 3;
    const x = (k * 71) % w, y = (k * 113) % h;
    g.beginPath();
    if (k % 3 === 0) g.arc(x, y, 9, 0, Math.PI * 2);
    else if (k % 3 === 1) {
      g.moveTo(x - 10, y + 8);
      g.lineTo(x, y - 9);
      g.lineTo(x + 10, y + 8);
      g.closePath();
    } else {
      g.moveTo(x - 12, y);
      g.quadraticCurveTo(x - 6, y - 10, x, y);
      g.quadraticCurveTo(x + 6, y + 10, x + 12, y);
    }
    g.stroke();
  }
}, true);
function menuBoard(brand, items, color) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#121214';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = '44px Anton, Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(brand, w / 2, 54);
    g.fillRect(40, 70, w - 80, 3);
    g.font = '28px Anton, Impact, sans-serif';
    items.forEach(([name, price], i) => {
      const y = 116 + i * 46;
      g.fillStyle = '#f4f0e6';
      g.textAlign = 'left';
      g.fillText(name.toUpperCase(), 48, y);
      g.fillStyle = color;
      g.textAlign = 'right';
      g.fillText('$' + price, w - 48, y);
    });
  });
}
const poster = (text, bg, fg) => canvasTex(256, 360, (g, w, h) => {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = '54px Anton, Impact, sans-serif';
  g.textAlign = 'center';
  text.split('\n').forEach((l, i) => g.fillText(l, w / 2, 110 + i * 70));
});

// ------------------------------------------------------------------ an interior under construction
class Room {
  constructor(scene, ox, oz, W, D, H, { floor, wall, wallBack, ceiling }) {
    Object.assign(this, { ox, oz, W, D, H });
    this.group = new THREE.Group();
    this.group.position.set(ox, 0, oz);
    scene.add(this.group);
    this.colliders = [];
    this.lights = [];
    this.loose = []; // meshes that stay separate (instanced, transparent glow, animated)
    const T = 0.3;
    this.box(floor, W, 0.1, D, 0, -0.1, 0);
    // walls (solid, thick) and a ceiling seen from below only
    this.box(wall, T, H, D + 2 * T, -W / 2 - T / 2, 0, 0, 0, true);
    this.box(wall, T, H, D + 2 * T, W / 2 + T / 2, 0, 0, 0, true);
    this.box(wallBack || wall, W, H, T, 0, 0, D / 2 + T / 2, 0, true);
    this.box(wall, W, H, T, 0, 0, -D / 2 - T / 2, 0, true);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), ceiling);
    ceil.position.y = H;
    ceil.castShadow = true;
    this.group.add(ceil);
    // the street door on the front wall (inside face), with a push bar and an EXIT sign
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x9fb3c2, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.55 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.6 });
    this.box(frame, 2.3, 2.5, 0.08, 0, 0, -D / 2 + 0.04);
    this.box(doorMat, 0.98, 2.3, 0.04, -0.52, 0.05, -D / 2 + 0.09);
    this.box(doorMat, 0.98, 2.3, 0.04, 0.52, 0.05, -D / 2 + 0.09);
    this.box(frame, 1.9, 0.05, 0.06, 0, 1.0, -D / 2 + 0.13);
    const exitT = canvasTex(128, 48, (g, w, h) => {
      g.fillStyle = '#0d5a2a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8dff9a';
      g.font = '34px Anton, Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText('EXIT', w / 2, 38);
    });
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: exitT }));
    exitSign.position.set(0, 2.8, -D / 2 + 0.1);
    this.group.add(exitSign);
  }

  // a box with its base at height y, in room coordinates; solid: the player bumps into it
  box(m, w, h, d, x, y, z, ry = 0, solid = false) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y + h / 2, z);
    b.rotation.y = ry;
    b.castShadow = b.receiveShadow = true;
    this.group.add(b);
    if (solid) {
      const q = Math.abs(Math.sin(ry)) > 0.7;
      const hw = (q ? d : w) / 2, hd = (q ? w : d) / 2;
      this.colliders.push({ type: 'box', minX: this.ox + x - hw, maxX: this.ox + x + hw, minZ: this.oz + z - hd, maxZ: this.oz + z + hd, h: y + h });
    }
    return b;
  }

  cyl(m, r0, r1, h, x, y, z, seg = 16, rz = 0) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
    c.position.set(x, y + (rz ? 0 : h / 2), z);
    c.rotation.z = rz;
    c.castShadow = c.receiveShadow = true;
    this.group.add(c);
    return c;
  }

  plane(m, w, h, x, y, z, ry = 0) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    this.group.add(p);
    return p;
  }

  chair(m, x, z, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.box(m, 0.44, 0.05, 0.44, x, 0.44, z, yaw);
    for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      this.box(m, 0.04, 0.44, 0.04, x + a * fz + b * fx, 0, z - a * fx + b * fz, yaw);
    }
    this.box(m, 0.44, 0.48, 0.05, x - fx * 0.2, 0.49, z - fz * 0.2, yaw);
  }

  // a light the Environment switches on while the player is inside (+ a visible fitting)
  lamp(x, y, z, style = 'tube') {
    const glow = new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0xfff0d8, emissiveIntensity: 2.5 });
    if (style === 'tube') this.box(glow, 1.8, 0.06, 0.16, x, this.H - 0.08, z);
    else {
      const shade = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 18, 1, true), shade);
      s.position.set(x, y + 0.12, z);
      this.group.add(s);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow);
      b.position.set(x, y, z);
      this.group.add(b);
      this.box(shade, 0.015, this.H - y - 0.2, 0.015, x, y + 0.2, z);
    }
    this.lights.push(new THREE.Vector3(this.ox + x, y - 0.2, this.oz + z));
  }

  // lots of small things (products, ammo boxes, bottles) as one instanced mesh
  scatter(geo, items, color) {
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6, color: 0xffffff }), items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    items.forEach(([x, y, z, sx, sy, sz, col, ry = 0], i) => {
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz)));
      im.setColorAt(i, c.set(col ?? color));
    });
    im.castShadow = im.receiveShadow = true;
    this.group.add(im);
    this.loose.push(im);
    return im;
  }

  world(x, z) {
    return { x: this.ox + x, z: this.oz + z };
  }

  // merge everything static by material: one draw call per material per room
  finish() {
    const byMat = new Map();
    const keep = new Set(this.loose);
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    for (const o of [...this.group.children]) {
      if (!o.isMesh || o.isInstancedMesh || keep.has(o) || o.userData.keep) continue;
      const g = o.geometry.index ? o.geometry : o.geometry;
      const geo = g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!geo.attributes.uv) continue;
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(geo);
      this.group.remove(o);
    }
    for (const [m, geos] of byMat) {
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}

const std = (o) => new THREE.MeshStandardMaterial(o);
const glowMat = (color, k = 1.8) => std({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const neonSign = (r, text, color, w, x, y, z, ry = 0) => {
  const t = TX.sign(text, color);
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.5 });
  const p = r.plane(m, w, w / 4, x, y, z, ry);
  p.userData.keep = true;
  return p;
};

// ------------------------------------------------------------------ the four kinds of interior
function gunInterior(r, guns) {
  const { W, D } = r;
  const steel = std({ color: 0x5a5e66, roughness: 0.35, metalness: 0.85 });
  const dark = std({ color: 0x1c1d21, roughness: 0.6 });
  const red = std({ color: 0x8e1b1b, roughness: 0.55 });
  const glass = std({ color: 0xbfd6e6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28 });
  const peg = std({ map: pegboard(), roughness: 0.9 });
  peg.map.repeat.set(5, 1);
  // red stripe round the room at hip height
  r.box(red, W, 0.12, 0.02, 0, 1.05, D / 2 - 0.01);
  r.box(red, 0.02, 0.12, D, -W / 2 + 0.01, 1.05, 0);
  r.box(red, 0.02, 0.12, D, W / 2 - 0.01, 1.05, 0);
  // pegboard wall behind the counter with guns hanging on it
  r.box(peg, W - 1.2, 1.7, 0.04, 0, 1.3, D / 2 - 0.04);
  const hang = (key, x, y, s = 1) => {
    const src = guns[key];
    if (!src) return;
    const g = src.clone(true);
    g.visible = true;
    g.traverse((o) => (o.visible = true));
    g.position.set(x, y, D / 2 - 0.12);
    g.rotation.set(0, Math.PI / 2, 0);
    g.scale.setScalar(s);
    r.group.add(g);
  };
  for (let i = 0; i < 4; i++) {
    hang('Weapon_Shotgun', -4.2 + i * 1.3, 2.55, 1.3);
    hang('Weapon_SMG', -4.2 + i * 1.3 + 0.3, 1.85, 1.3);
  }
  for (let i = 0; i < 4; i++) hang('Weapon_Pistol', 1.4 + i * 0.75, 1.6, 1.3);
  // glass display counter across the shop with pistols inside
  const cz = D / 2 - 2.3;
  r.box(dark, 9, 0.9, 0.75, -0.5, 0, cz, 0, true);
  r.box(glass, 9, 0.12, 0.75, -0.5, 0.9, cz);
  r.box(steel, 9.04, 0.03, 0.79, -0.5, 1.02, cz);
  r.box(std({ color: 0x7a1414, roughness: 0.9 }), 8.8, 0.02, 0.7, -0.5, 0.88, cz); // red felt
  for (let i = 0; i < 8; i++) {
    const src = guns.Weapon_Pistol;
    if (!src) break;
    const g = src.clone(true);
    g.traverse((o) => (o.visible = true));
    g.position.set(-4.4 + i * 1.1, 0.93, cz);
    g.rotation.set(Math.PI / 2, 0, 0.3);
    g.scale.setScalar(1.25);
    r.group.add(g);
  }
  // register
  r.box(dark, 0.4, 0.22, 0.35, 3.3, 1.05, cz);
  r.box(glowMat(0x2aff7a, 0.8), 0.24, 0.1, 0.02, 3.3, 1.2, cz - 0.16);
  // ammo shelves along the left wall
  const items = [];
  const cols = ['#4b5320', '#a8261c', '#d8b23a', '#2f4f6f', '#6b4a2c'];
  for (let s = 0; s < 4; s++) {
    r.box(steel, 0.45, 0.04, 6, -W / 2 + 0.3, 0.5 + s * 0.55, -0.5, 0, s === 0);
    for (let k = 0; k < 18; k++) items.push([-W / 2 + 0.32, 0.6 + s * 0.55, -3.2 + k * 0.32, 0.26, 0.16, 0.2, cols[(k + s * 2) % cols.length]]);
  }
  r.box(steel, 0.5, 2.3, 0.05, -W / 2 + 0.3, 0, 2.5);
  r.box(steel, 0.5, 2.3, 0.05, -W / 2 + 0.3, 0, -3.5);
  r.colliders.push({ type: 'box', minX: r.ox - W / 2, maxX: r.ox - W / 2 + 0.6, minZ: r.oz - 3.5, maxZ: r.oz + 2.5, h: 2.3 });
  r.scatter(new THREE.BoxGeometry(1, 1, 1), items);
  // targets and a poster on the right wall
  const tm = std({ map: target(), roughness: 0.9 });
  for (let i = 0; i < 3; i++) r.plane(tm, 0.7, 1.05, W / 2 - 0.02, 1.7, -2.5 + i * 1.2, -Math.PI / 2);
  r.plane(std({ map: poster('PROTECT\nYOUR\nFAMILY', '#1d1d22', '#ff4b4b'), roughness: 0.9 }), 1.0, 1.4, W / 2 - 0.02, 1.8, 2.2, -Math.PI / 2);
  // body armour on stands by the door
  for (const x of [-3, 3]) {
    r.cyl(steel, 0.03, 0.03, 1.1, x, 0, -D / 2 + 1.6, 8);
    r.box(std({ color: 0x2a3446, roughness: 0.8 }), 0.5, 0.6, 0.28, x, 1.0, -D / 2 + 1.6);
    r.cyl(dark, 0.25, 0.3, 0.06, x, 0, -D / 2 + 1.6, 16);
  }
  // rubber mat by the door, crates of stock in the corner
  r.box(std({ color: 0x232325, roughness: 1 }), 2.4, 0.015, 1.4, 0, 0, -D / 2 + 1.0);
  const crate = std({ map: planks('#7a5a34'), roughness: 0.9 });
  r.box(crate, 0.9, 0.7, 0.7, W / 2 - 0.7, 0, D / 2 - 0.6, 0, true);
  r.box(crate, 0.8, 0.6, 0.6, W / 2 - 0.7, 0.7, D / 2 - 0.6, 0.3);
  neonSign(r, 'AMMU-NATION', '#ff4040', 4.2, 0, 3.1, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-3, -1], [3, -1], [-3, 2.4], [3, 2.4]]) r.lamp(x, 3.2, z, 'tube');
  return { counter: { x: 0, z: cz - 0.95 }, clerk: { x: 0, z: cz + 0.8, yaw: Math.PI }, clerkKind: 'male', wear: 'male_casualsuit05' };
}

function foodInterior(r, brand) {
  const { W, D } = r;
  const pal = {
    'BURGER SOL': { a: 0xc8202a, b: 0xffc22e, sign: '#ffb02e' },
    'TACO LOCO': { a: 0x2a8a3e, b: 0xff8a1e, sign: '#7dff6a' },
    'PIZZA SOL': { a: 0xb3202a, b: 0x2a8a3e, sign: '#ff5a4a' },
  }[brand];
  const accent = std({ color: pal.a, roughness: 0.5 });
  const accent2 = std({ color: pal.b, roughness: 0.5 });
  const steel = std({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.85 });
  const cream = std({ color: 0xf2ead8, roughness: 0.6 });
  const wood = std({ map: planks('#7a4e2c'), roughness: 0.6 });
  const dark = std({ color: 0x1d1d20, roughness: 0.6 });
  // wainscot round the room
  r.box(accent, W, 1.0, 0.03, 0, 0, D / 2 - 0.02);
  r.box(accent, 0.03, 1.0, D, -W / 2 + 0.02, 0, 0);
  r.box(accent, 0.03, 1.0, D, W / 2 - 0.02, 0, 0);
  // counter with the register; the kitchen behind it
  const cz = D / 2 - 2.6;
  r.box(accent, 7, 1.0, 0.8, 1.5, 0, cz, 0, true);
  r.box(steel, 7.1, 0.05, 0.9, 1.5, 1.0, cz);
  r.box(dark, 0.42, 0.24, 0.36, 0.2, 1.05, cz);
  r.box(glowMat(0x36ff9a, 0.8), 0.26, 0.1, 0.02, 0.2, 1.2, cz - 0.17);
  r.box(dark, 0.6, 0.6, 0.5, 3.8, 1.05, cz); // soda fountain
  for (let i = 0; i < 4; i++) r.box(glowMat([0xff3b3b, 0xffd23f, 0x3bb0ff, 0x7dff6a][i], 0.6), 0.1, 0.18, 0.02, 3.6 + i * 0.13, 1.4, cz - 0.26);
  // trays and cups on the counter
  for (let i = 0; i < 3; i++) r.box(accent2, 0.42, 0.03, 0.32, -1.2 + i * 0.6, 1.05, cz - 0.1);
  // kitchen line: grill, fryer, fridge, extractor hood
  r.box(steel, 6, 0.95, 0.7, 1.5, 0, D / 2 - 0.45, 0, true);
  r.box(dark, 1.4, 0.05, 0.6, 0.2, 0.95, D / 2 - 0.45);
  r.box(steel, 2.2, 0.5, 0.8, 1.0, 2.4, D / 2 - 0.45);
  r.box(steel, 1.0, 2.1, 0.8, 4.6, 0, D / 2 - 0.5, 0, true);
  // menu board over the kitchen
  const items = MENUS[brand].map(([n, p]) => [n, p]);
  const mb = std({ map: menuBoard(brand, items, pal.sign), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6 });
  mb.emissiveMap = mb.map;
  r.plane(mb, 3.4, 1.7, 1.5, 3.0, D / 2 - 0.05, Math.PI).userData.keep = true;
  // dining room: booths along the left wall, tables in the middle
  for (let i = 0; i < 3; i++) {
    const z = -2.6 + i * 2.1;
    r.box(accent, 1.6, 0.45, 0.5, -W / 2 + 1.1, 0, z - 0.7);
    r.box(accent, 1.6, 0.85, 0.12, -W / 2 + 1.1, 0.45, z - 0.98);
    r.box(accent, 1.6, 0.45, 0.5, -W / 2 + 1.1, 0, z + 0.7);
    r.box(accent, 1.6, 0.85, 0.12, -W / 2 + 1.1, 0.45, z + 0.98);
    r.box(wood, 1.3, 0.05, 0.8, -W / 2 + 1.1, 0.74, z, 0, true);
    r.cyl(steel, 0.04, 0.04, 0.74, -W / 2 + 1.1, 0, z, 8);
  }
  for (const [x, z] of [[-1.4, -1.6], [1.6, -1.6], [-1.4, 0.8], [1.6, 0.8]]) {
    r.box(wood, 0.9, 0.05, 0.9, x, 0.74, z, 0, true);
    r.cyl(steel, 0.05, 0.25, 0.74, x, 0, z, 12);
    r.chair(accent2, x, z - 0.75, 0);
    r.chair(accent2, x, z + 0.75, Math.PI);
    r.cyl(cream, 0.04, 0.035, 0.12, x + 0.15, 0.79, z + 0.1, 10);
    r.box(accent, 0.18, 0.12, 0.12, x - 0.2, 0.79, z - 0.15);
  }
  // potted plants in the corners
  for (const [x, z] of [[W / 2 - 0.6, -D / 2 + 0.6], [-W / 2 + 0.6, D / 2 - 0.6]]) {
    r.cyl(std({ color: 0x8a5a3a, roughness: 0.8 }), 0.22, 0.17, 0.45, x, 0, z, 12);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), std({ color: 0x2f6a2a, roughness: 0.8, flatShading: true }));
    leaves.position.set(x, 0.85, z);
    leaves.scale.set(1, 1.3, 1);
    r.group.add(leaves);
  }
  neonSign(r, brand, pal.sign, 3.2, W / 2 - 0.05, 2.3, -0.5, -Math.PI / 2);
  for (const [x, z] of [[-1.4, -1.6], [1.6, -1.6], [-1.4, 0.8], [1.6, 0.8]]) r.lamp(x, 2.4, z, 'pendant');
  r.lamp(1.5, 3.2, cz + 0.3, 'tube');
  r.lamp(-4.5, 3.2, 0, 'tube');
  return { counter: { x: 0.2, z: cz - 1.0 }, clerk: { x: 0.2, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'female', wear: 'female_casualsuit01' };
}

function clothesInterior(r, models) {
  const { W, D } = r;
  const chrome = std({ color: 0xd8dadc, roughness: 0.2, metalness: 0.95 });
  const wood = std({ map: planks('#a8865a'), roughness: 0.6 });
  const white = std({ color: 0xf2f0ea, roughness: 0.8 });
  const purple = std({ color: 0x5d2e8c, roughness: 0.6 });
  const shirtCols = ['#f2f2ee', '#262626', '#b93a3a', '#3d6ea8', '#e3bd52', '#6fa893', '#d98fa8', '#8a5fb0', '#ef8a3c', '#9aa3ab', '#2f4f6f', '#c9b99c'];
  // purple feature wall at the back
  r.box(purple, W, 3.6, 0.03, 0, 0, D / 2 - 0.02);
  // clothes rails with shirts on hangers
  const shirts = [];
  for (const [rx, rz] of [[-3.5, -1.2], [0, -1.2], [-3.5, 1.4], [0, 1.4]]) {
    r.cyl(chrome, 0.02, 0.02, 2.2, rx, 1.5, rz, 8, Math.PI / 2);
    for (const s of [-1, 1]) {
      r.cyl(chrome, 0.02, 0.02, 1.5, rx + s * 1.1, 0, rz, 8);
      r.cyl(chrome, 0.22, 0.25, 0.04, rx + s * 1.1, 0, rz, 14);
    }
    r.colliders.push({ type: 'box', minX: r.ox + rx - 1.2, maxX: r.ox + rx + 1.2, minZ: r.oz + rz - 0.3, maxZ: r.oz + rz + 0.3, h: 1.6 });
    for (let k = 0; k < 13; k++) shirts.push([rx - 0.95 + k * 0.16, 1.1, rz, 0.04, 0.72, 0.5, shirtCols[(k * 5 + Math.round(rx)) % shirtCols.length]]);
  }
  // shelves of folded stacks on the left wall
  for (let s = 0; s < 4; s++) {
    r.box(wood, 0.5, 0.04, 5.5, -W / 2 + 0.3, 0.4 + s * 0.6, 0);
    for (let k = 0; k < 9; k++) for (let h = 0; h < 3; h++) shirts.push([-W / 2 + 0.32, 0.47 + s * 0.6 + h * 0.08, -2.4 + k * 0.6, 0.36, 0.07, 0.42, shirtCols[(k + s * 3 + h) % shirtCols.length]]);
  }
  r.colliders.push({ type: 'box', minX: r.ox - W / 2, maxX: r.ox - W / 2 + 0.6, minZ: r.oz - 2.8, maxZ: r.oz + 2.8, h: 2.4 });
  r.scatter(new THREE.BoxGeometry(1, 1, 1), shirts);
  // mannequins (the street models, stood still in their bind pose, white like the real thing)
  const dummies = [];
  for (const [x, z, kind, wear] of [[3.0, -2.4, 'female', 'female_elegantsuit01'], [4.4, -2.4, 'male', 'male_elegantsuit01'], [3.7, -0.6, 'female', 'female_sportsuit01']]) {
    const m = models[kind];
    if (!m) continue;
    const body = SkeletonUtils.clone(m.scene);
    chooseOutfit(body, wear);
    body.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material.name || '';
      if (/^(Hair|HairCards|BrowCards|Iris|Pupil|EyeWhite)$/.test(n)) o.visible = false;
      if (n === 'Skin') {
        o.material = o.material.clone();
        o.material.color.set(0xe8e6e2);
        o.material.map = null;
        o.material.emissive?.set(0x000000);
      }
      o.castShadow = true;
    });
    body.position.set(x, 0.12, z);
    body.rotation.y = Math.PI * 0.85;
    r.group.add(body);
    body.userData.keep = true;
    r.cyl(white, 0.38, 0.4, 0.12, x, 0, z, 20);
    dummies.push(body);
  }
  // fitting rooms with curtains and a tall mirror
  const curtain = std({ color: 0x7a1d3a, roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 2; i++) {
    const x = W / 2 - 0.8 - i * 1.4;
    r.box(white, 0.06, 2.3, 1.4, x - 0.7, 0, D / 2 - 0.7, 0, true);
    r.plane(curtain, 1.3, 2.1, x, 1.15, D / 2 - 1.42).material = curtain;
  }
  r.box(white, 0.06, 2.3, 1.4, W / 2 - 0.06, 0, D / 2 - 0.7);
  const mirror = std({ color: 0xc8d0d8, roughness: 0.02, metalness: 1 });
  r.plane(mirror, 0.8, 1.9, -1.8, 1.2, D / 2 - 0.05, Math.PI);
  // counter by the back wall
  const cz = D / 2 - 1.9;
  r.box(white, 2.6, 1.0, 0.7, -3.6, 0, cz, 0, true);
  r.box(wood, 2.7, 0.05, 0.8, -3.6, 1.0, cz);
  r.box(std({ color: 0x1d1d20, roughness: 0.5 }), 0.38, 0.22, 0.32, -3.0, 1.05, cz);
  neonSign(r, 'SOL THREADS', '#c38bff', 3.6, 0, 2.9, D / 2 - 0.06, Math.PI);
  for (const [x, z] of [[-3.5, -1], [0, -1], [3.5, -1], [-3.5, 2], [0, 2], [3.5, 2]]) r.lamp(x, 3.3, z, 'tube');
  return { counter: { x: -3.6, z: cz - 0.95 }, clerk: { x: -3.6, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'female', wear: 'female_elegantsuit01' };
}

// the Sol City Reserve: marble hall, a teller counter with glass screens across the
// middle (a gate at the right end), benches and plants, and the round vault door at the back
function bankInterior(r) {
  const { W, D } = r;
  const stone = std({ color: 0xe9e2d0, roughness: 0.45 });
  const wood = std({ map: planks('#5a3a24'), roughness: 0.5 });
  const brass = std({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 });
  const steel = std({ color: 0x8e959c, roughness: 0.3, metalness: 0.85 });
  const dark = std({ color: 0x2a2c30, roughness: 0.5, metalness: 0.5 });
  const screen = std({ color: 0xbfd6e2, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  const green = std({ color: 0x2e6b3c, roughness: 0.8 });
  // columns along the side walls
  for (const x of [-W / 2 + 0.6, W / 2 - 0.6]) for (const z of [-D / 2 + 2.5, 0, D / 2 - 2.5]) r.cyl(stone, 0.32, 0.36, r.H, x, 0, z, 18);
  // the teller counter across the room (gate at the right end), glass screens and brass rails on top
  const cz = 0.6, gate = 1.6, cw = W - 2.4 - gate;
  const cx0 = -W / 2 + 1.2 + cw / 2;
  r.box(wood, cw, 1.1, 0.7, cx0, 0, cz, 0, true);
  r.box(stone, cw + 0.1, 0.06, 0.8, cx0, 1.1, cz);
  r.box(screen, cw, 1.0, 0.03, cx0, 1.16, cz + 0.1);
  r.box(brass, cw, 0.04, 0.05, cx0, 2.17, cz + 0.1);
  for (let x = -W / 2 + 1.4; x < -W / 2 + 1.2 + cw; x += 2.2) r.box(brass, 0.05, 1.0, 0.05, x, 1.16, cz + 0.1);
  r.box(wood, 0.12, 1.1, 0.7, W / 2 - 1.2 - gate / 2 + gate / 2, 0, cz); // gate post
  // teller stations behind the glass: chairs, monitors
  for (let x = cx0 - cw / 2 + 1.2; x < cx0 + cw / 2 - 0.6; x += 2.2) {
    r.box(dark, 0.42, 0.3, 0.06, x, 1.16, cz + 0.32);
    r.chair(dark, x, cz + 1.0, Math.PI);
  }
  // waiting benches and plants in the front half
  for (const x of [-3.5, 3.5]) {
    r.box(wood, 2.4, 0.08, 0.5, x, 0.45, -D / 2 + 2.6, 0, true);
    r.box(dark, 2.2, 0.45, 0.06, x, 0, -D / 2 + 2.6);
  }
  for (const [x, z] of [[-W / 2 + 1.4, -D / 2 + 1.2], [W / 2 - 1.4, -D / 2 + 1.2]]) {
    r.cyl(dark, 0.3, 0.24, 0.5, x, 0, z, 14);
    r.cyl(green, 0.05, 0.45, 1.2, x, 0.5, z, 8);
  }
  // the vault door: a thick round steel door in a steel frame, bolts, the wheel
  const vz = D / 2 - 0.2;
  r.box(steel, 3.4, 3.2, 0.4, 0, 0, vz, 0, true);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.35, 40).rotateX(Math.PI / 2), steel);
  door.position.set(0, 1.55, vz - 0.32);
  r.group.add(door);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 8, 40), brass);
  ring.position.set(0, 1.55, vz - 0.52);
  r.group.add(ring);
  for (let k = 0; k < 3; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.07), brass);
    spoke.position.set(0, 1.55, vz - 0.6);
    spoke.rotation.z = (k * Math.PI) / 3;
    r.group.add(spoke);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    r.cyl(dark, 0.06, 0.06, 0.12, Math.cos(a) * 1.15, 1.55 + Math.sin(a) * 1.15 - 0.06, vz - 0.52, 8);
  }
  neonSign(r, 'SOL CITY RESERVE', '#d9b44a', 4.4, 0, 3.6, D / 2 - 0.25, Math.PI);
  for (const [x, z] of [[-4, -3], [0, -3], [4, -3], [-4, 2.5], [0, 2.5], [4, 2.5]]) r.lamp(x, 3.6, z, 'tube');
  return {
    counter: { x: -2, z: cz - 0.75 }, clerk: { x: -2, z: cz + 0.95, yaw: Math.PI }, clerkKind: 'female', wear: 'female_elegantsuit01',
    vault: { x: 0, z: vz - 1.4 },
    // where the night guards stand
    guards: [{ x: -4.5, z: -1.5 }, { x: 4.6, z: -0.8 }, { x: 2.0, z: D / 2 - 2.2 }],
  };
}

function martInterior(r) {
  const { W, D } = r;
  const white = std({ color: 0xeef0f2, roughness: 0.5 });
  const steel = std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
  const green = std({ color: 0x1f7a45, roughness: 0.5 });
  const productCols = ['#d63a3a', '#f2c12e', '#3d6ea8', '#2bb673', '#ef8a3c', '#8a5fb0', '#f2f2ee', '#6b4a2c', '#e0407e', '#1c1c1f'];
  const items = [];
  // three aisles of double-sided shelving
  for (const ax of [-2.6, 0, 2.6]) {
    r.box(white, 0.7, 1.8, 6, ax, 0, 0, 0, true);
    for (let s = 0; s < 4; s++) {
      r.box(steel, 0.9, 0.03, 6, ax, 0.25 + s * 0.45, 0);
      for (const side of [-1, 1]) for (let k = 0; k < 24; k++) {
        const h = 0.14 + ((k * 7 + s) % 4) * 0.05;
        items.push([ax + side * 0.36, 0.28 + s * 0.45 + h / 2, -2.85 + k * 0.245, 0.14, h, 0.16, productCols[(k * 3 + s * 5 + (side > 0 ? 1 : 0)) % productCols.length]]);
      }
    }
  }
  // fridges along the back wall, lit
  const fz = D / 2 - 0.45;
  r.box(steel, W - 1.0, 2.1, 0.8, 0, 0, fz, 0, true);
  for (let i = 0; i < 6; i++) {
    const x = -W / 2 + 1.4 + i * 1.6;
    const panel = r.plane(glowMat(0xd8f0ff, 0.9), 1.4, 1.8, x, 1.1, fz - 0.41, Math.PI);
    panel.material.transparent = true;
    panel.material.opacity = 0.55;
    panel.userData.keep = true;
    for (let s = 0; s < 4; s++) for (let k = 0; k < 7; k++) items.push([x - 0.55 + k * 0.18, 0.4 + s * 0.42, fz - 0.2, 0.07, 0.24, 0.07, productCols[(k + s + i) % productCols.length]]);
  }
  r.scatter(new THREE.BoxGeometry(1, 1, 1), items);
  // counter by the door with the register, a cigarette rack and the lottery stand
  const cx = W / 2 - 1.6, cz = -D / 2 + 2.4;
  r.box(green, 0.8, 1.0, 2.2, cx, 0, cz, 0, true);
  r.box(white, 0.9, 0.05, 2.3, cx, 1.0, cz);
  r.box(std({ color: 0x1d1d20, roughness: 0.5 }), 0.38, 0.22, 0.34, cx, 1.05, cz - 0.4);
  r.box(steel, 0.25, 1.4, 1.8, W / 2 - 0.2, 0.9, cz);
  r.plane(std({ map: poster('SCRATCH\n& WIN\n$1000', '#f2c12e', '#b3202a'), roughness: 0.8 }), 0.6, 0.85, cx - 0.45, 1.5, cz + 0.9, -Math.PI / 2);
  neonSign(r, '24/7', '#55e08a', 2.2, -2, 2.8, D / 2 - 0.06, Math.PI);
  for (const [x, z] of [[-2.6, -2], [0, -2], [2.6, -2], [-2.6, 2], [0, 2], [2.6, 2]]) r.lamp(x, 3.0, z, 'tube');
  return { counter: { x: cx - 1.0, z: cz }, clerk: { x: cx + 0.75, z: cz, yaw: -Math.PI / 2 }, clerkKind: 'male', wear: 'male_casualsuit04' };
}

// ------------------------------------------------------------------ the venues (see fun.js)
// Stations are spots you step onto and press E: { kind, x, z, yaw, y?, off?, bar? } in room
// coordinates (the shop converts them). off: where you step off the machine.
function barberInterior(r) {
  const { W, D } = r;
  const chrome = std({ color: 0xd0d4d8, roughness: 0.15, metalness: 0.95 });
  const leather = std({ color: 0x8e1b1b, roughness: 0.45 });
  const dark = std({ color: 0x1d1d20, roughness: 0.6 });
  const wood = std({ map: planks('#6b4a2c'), roughness: 0.6 });
  const mirror = std({ color: 0xc8d6e0, roughness: 0.02, metalness: 1 });
  // the mirror wall with three barber's chairs facing it
  r.box(wood, 0.5, 0.85, D - 2.5, W / 2 - 0.25, 0, 0.6, 0, true);
  r.box(std({ color: 0xf2f2ee, roughness: 0.3 }), 0.55, 0.04, D - 2.5, W / 2 - 0.27, 0.85, 0.6);
  for (let i = 0; i < 3; i++) {
    const z = -1.4 + i * 2.2;
    r.plane(mirror, 1.6, 1.2, W / 2 - 0.02, 1.75, z, -Math.PI / 2).userData.keep = true;
    r.cyl(chrome, 0.28, 0.32, 0.08, W / 2 - 1.7, 0, z, 18);
    r.cyl(chrome, 0.06, 0.06, 0.38, W / 2 - 1.7, 0.08, z, 10);
    r.box(leather, 0.62, 0.14, 0.6, W / 2 - 1.7, 0.46, z, 0, true);
    r.box(leather, 0.12, 0.72, 0.6, W / 2 - 2.0, 0.6, z);
    r.box(chrome, 0.5, 0.04, 0.08, W / 2 - 1.7, 0.66, z - 0.32);
    r.box(chrome, 0.5, 0.04, 0.08, W / 2 - 1.7, 0.66, z + 0.32);
    r.box(chrome, 0.2, 0.04, 0.4, W / 2 - 1.25, 0.12, z); // footrest
  }
  // waiting bench and magazine table along the left wall
  r.box(wood, 0.55, 0.45, 3.6, -W / 2 + 0.4, 0, 1.2, 0, true);
  r.box(leather, 0.5, 0.1, 3.5, -W / 2 + 0.4, 0.45, 1.2);
  r.box(dark, 0.6, 0.42, 0.6, -W / 2 + 1.3, 0, 1.2, 0, true);
  // reception desk by the door with the register
  const cx = -W / 2 + 2.2, cz = -D / 2 + 2.4;
  r.box(wood, 1.8, 1.0, 0.6, cx, 0, cz, 0, true);
  r.box(dark, 0.36, 0.2, 0.3, cx + 0.5, 1.0, cz);
  // a barber's pole and a price list
  const pole = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#f4f2ee';
    g.fillRect(0, 0, w, h);
    for (let k = -4; k < 12; k++) {
      g.fillStyle = k % 2 ? '#b3202a' : '#2c4f9e';
      g.beginPath();
      g.moveTo(0, k * 32);
      g.lineTo(w, k * 32 + 40);
      g.lineTo(w, k * 32 + 56);
      g.lineTo(0, k * 32 + 16);
      g.fill();
    }
  });
  r.cyl(std({ map: pole, roughness: 0.3 }), 0.12, 0.12, 0.9, -W / 2 + 0.3, 1.4, -D / 2 + 0.6, 16);
  r.plane(std({ map: menuBoard('SOL CUTS', HAIRCUTS.slice(0, 4).map((h) => [h.name, h.price]), '#e8c35a'), roughness: 0.8 }), 1.6, 0.8, -W / 2 + 0.02, 1.9, -1.2, Math.PI / 2);
  neonSign(r, 'SOL CUTS', '#ff6b6b', 3.4, 0, 2.7, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-2.5, -1.5], [2.5, -1.5], [-2.5, 2], [2.5, 2]]) r.lamp(x, 3.0, z, 'tube');
  return { counter: { x: cx, z: cz - 0.95 }, clerk: { x: cx, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'male', wear: 'male_casualsuit04' };
}

function tattooInterior(r) {
  const { W, D } = r;
  const dark = std({ color: 0x1b1a1e, roughness: 0.6 });
  const black = std({ color: 0x0f0f11, roughness: 0.4 });
  const chrome = std({ color: 0xc8ccd0, roughness: 0.2, metalness: 0.9 });
  const glass = std({ color: 0xbfd6e6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28 });
  // flash sheets: the designs on the walls
  const sheet = (id) => std({ map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#efe7d2';
    g.fillRect(0, 0, w, h);
    const t = tattooArt(id).image;
    g.drawImage(t, 0, 0, t.width, t.height, 10, 60, w - 20, ((w - 20) * t.height) / t.width);
    g.strokeStyle = '#222';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  }), roughness: 0.9 });
  const ids = ['skull', 'star', 'script', 'tribal'];
  for (let i = 0; i < 8; i++) r.plane(sheet(ids[i % 4]), 0.7, 0.7, -W / 2 + 0.02, 1.4 + (i % 2) * 0.8, -2.4 + Math.floor(i / 2) * 1.2, Math.PI / 2);
  // the artist's station: a reclining chair, a stool, a lamp on an arm, the ink tray
  const sx = W / 2 - 2.2, sz = 1.2;
  r.box(black, 0.7, 0.5, 1.9, sx, 0, sz, 0, true);
  r.box(std({ color: 0x2a2a2e, roughness: 0.35 }), 0.68, 0.12, 1.2, sx, 0.5, sz - 0.3);
  r.box(std({ color: 0x2a2a2e, roughness: 0.35 }), 0.68, 0.1, 0.8, sx, 0.62, sz + 0.75);
  r.cyl(chrome, 0.2, 0.22, 0.05, sx - 0.9, 0, sz, 14);
  r.cyl(black, 0.2, 0.2, 0.08, sx - 0.9, 0.55, sz, 14);
  r.cyl(chrome, 0.03, 0.03, 0.55, sx - 0.9, 0, sz, 8);
  r.cyl(chrome, 0.02, 0.02, 1.6, sx + 0.6, 0, sz + 1.0, 8);
  r.box(chrome, 0.9, 0.03, 0.03, sx + 0.2, 1.6, sz + 1.0);
  r.lamp(sx, 1.55, sz + 0.4, 'shade');
  r.box(chrome, 0.5, 0.03, 0.35, sx + 0.7, 0.85, sz - 0.6);
  r.scatter(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), [0, 1, 2, 3, 4].map((k) => [sx + 0.52 + k * 0.08, 0.92, sz - 0.6, 0.05, 0.12, 0.05, ['#111', '#b3202a', '#1f7a45', '#2c4f9e', '#d8b23a'][k]]));
  // glass counter by the door with jewellery inside
  const cx = -W / 2 + 2.6, cz = -D / 2 + 2.4;
  r.box(dark, 2.4, 0.9, 0.65, cx, 0, cz, 0, true);
  r.box(glass, 2.4, 0.14, 0.65, cx, 0.9, cz);
  r.scatter(new THREE.TorusGeometry(0.5, 0.18, 6, 12), [0, 1, 2, 3, 4, 5].map((k) => [cx - 0.9 + k * 0.36, 0.93, cz, 0.05, 0.05, 0.05, '#d8b23a']));
  r.box(std({ color: 0x3a1420, roughness: 0.9 }), 2.6, 0.015, 1.6, 0, 0, 0); // rug
  neonSign(r, 'INK SOL', '#ff3fa8', 3.0, 0, 2.6, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-2, -1.6], [2, -1.6], [-2, 2.2]]) r.lamp(x, 2.8, z, 'shade');
  return { counter: { x: cx, z: cz - 0.95 }, clerk: { x: cx, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'female', wear: 'female_casualsuit01' };
}

function gymInterior(r) {
  const { W, D } = r;
  const steel = std({ color: 0x8a9096, roughness: 0.3, metalness: 0.9 });
  const black = std({ color: 0x141416, roughness: 0.55 });
  const red = std({ color: 0xb3202a, roughness: 0.5 });
  const pad = std({ color: 0x1d2a44, roughness: 0.5 });
  const mirror = std({ color: 0xc8d6e0, roughness: 0.02, metalness: 1 });
  r.plane(mirror, W - 2, 1.6, 0, 1.5, D / 2 - 0.02, Math.PI).userData.keep = true;
  r.plane(std({ map: poster('NO PAIN\nNO GAIN', '#141416', '#ffd23f'), roughness: 0.9 }), 1.0, 1.4, -W / 2 + 0.02, 1.7, -1, Math.PI / 2);
  // two treadmills on the left, facing the mirror
  const st = [];
  for (let i = 0; i < 2; i++) {
    const x = -W / 2 + 1.6 + i * 1.5, z = D / 2 - 2.6;
    r.box(black, 0.85, 0.16, 1.9, x, 0, z); // (low enough to step onto)
    r.box(std({ color: 0x232325, roughness: 0.95 }), 0.6, 0.02, 1.6, x, 0.16, z);
    for (const s of [-1, 1]) r.box(steel, 0.05, 1.15, 0.05, x + s * 0.38, 0.16, z + 0.85);
    r.box(black, 0.85, 0.3, 0.2, x, 1.25, z + 0.9);
    r.box(glowMat(0x41d6ff, 1.2), 0.4, 0.14, 0.02, x, 1.33, z + 0.79);
    if (i === 0) st.push({ kind: 'treadmill', x, z: z - 0.15, y: 0.18, yaw: 0, off: { x, z: z - 1.4 } });
  }
  // the bench press: a padded bench, uprights with hooks, the bar on the hooks
  const bx = 1.6, bz = D / 2 - 3.2;
  r.box(pad, 0.36, 0.1, 1.35, bx, 0.35, bz, 0, true);
  r.box(steel, 0.08, 0.35, 0.08, bx, 0, bz - 0.5);
  r.box(steel, 0.08, 0.35, 0.08, bx, 0, bz + 0.5);
  for (const s of [-1, 1]) r.box(steel, 0.07, 1.25, 0.07, bx + s * 0.55, 0, bz + 0.62);
  const bar = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.9, 8).rotateZ(Math.PI / 2), steel);
  bar.add(rod);
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20).rotateZ(Math.PI / 2), black);
    plate.position.x = s * 0.72;
    bar.add(plate);
  }
  bar.traverse((o) => (o.castShadow = true));
  bar.position.set(bx, 1.22, bz + 0.62);
  // he lies with his hips over the foot end and his head under the bar
  st.push({ kind: 'bench', x: bx, z: bz - 0.35, yaw: Math.PI, bar, off: { x: bx - 0.9, z: bz - 0.3 } });
  // dumbbell rack, a heavy bag on a chain, rubber mats
  r.box(steel, 2.6, 0.06, 0.5, W / 2 - 1.6, 0.55, -0.6, 0, true);
  r.box(steel, 0.06, 0.55, 0.5, W / 2 - 2.9, 0, -0.6);
  r.box(steel, 0.06, 0.55, 0.5, W / 2 - 0.3, 0, -0.6);
  r.scatter(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateX(Math.PI / 2), Array.from({ length: 10 }, (_, k) =>
    [W / 2 - 2.7 + (k % 5) * 0.55 + (k > 4 ? 0.2 : 0), 0.66, -0.6 + (k > 4 ? 0.1 : -0.1), 0.12 + k * 0.004, 0.12 + k * 0.004, 0.32, '#141416']));
  r.cyl(red, 0.2, 0.2, 1.1, W / 2 - 1.4, 0.55, 2.2, 16);
  r.cyl(steel, 0.008, 0.008, 1.5, W / 2 - 1.4, 1.65, 2.2, 4);
  r.colliders.push({ type: 'circle', x: r.ox + W / 2 - 1.4, z: r.oz + 2.2, r: 0.22, h: 1.7 });
  r.box(std({ color: 0x232325, roughness: 1 }), W - 1, 0.012, 4, 0, 0, D / 2 - 3);
  // the front desk
  const cx = W / 2 - 2.4, cz = -D / 2 + 2.2;
  r.box(black, 2.2, 1.0, 0.6, cx, 0, cz, 0, true);
  r.box(red, 2.24, 0.06, 0.64, cx, 1.0, cz);
  neonSign(r, 'IRON SOL', '#ffd23f', 3.4, 0, 3.4, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-4, -3], [0, -3], [4, -3], [-4, 2], [0, 2], [4, 2]]) r.lamp(x, 3.8, z, 'tube');
  return { counter: { x: cx, z: cz - 0.95 }, clerk: { x: cx, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'male', wear: 'male_casualsuit05', stations: st };
}

function clubInterior(r) {
  const { W, D } = r;
  const black = std({ color: 0x0c0c10, roughness: 0.5 });
  const chrome = std({ color: 0xd0d4d8, roughness: 0.15, metalness: 0.95 });
  const purple = std({ color: 0x2a1240, roughness: 0.6 });
  // the dance floor: lit tiles that change colour with the beat (shops.update animates them)
  const fx = 1.5, fz = 2.2, N = 6, S = 1.0;
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(S - 0.04, 0.05, S - 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff }), N * N); // unlit: the tile colour is its light
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tiles.setMatrixAt(i * N + j, m4.makeTranslation(fx + (i - (N - 1) / 2) * S, 0.025, fz + (j - (N - 1) / 2) * S));
  tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * N * 3).fill(1), 3);
  r.group.add(tiles);
  r.loose.push(tiles);
  // the DJ: a stage at the back with decks and speaker stacks
  r.box(purple, 6, 0.6, 2.2, fx, 0, D / 2 - 1.1, 0, true);
  r.box(black, 2.4, 1.0, 0.7, fx, 0.6, D / 2 - 1.3, 0, true);
  for (const s of [-1, 1]) {
    r.cyl(chrome, 0.2, 0.2, 0.03, fx + s * 0.6, 1.6, D / 2 - 1.3, 20);
    r.box(black, 0.9, 2.2, 0.8, fx + s * 2.6, 0.6, D / 2 - 0.9, 0, true);
    for (const y of [1.0, 2.0]) r.cyl(std({ color: 0x222226, roughness: 0.4 }), 0.28, 0.28, 0.04, fx + s * 2.6, y, D / 2 - 1.31, 18, Math.PI / 2);
  }
  // the bar along the left wall: counter, stools, shelves of lit bottles
  const bx = -W / 2 + 1.6;
  r.box(black, 0.8, 1.1, 7, bx, 0, 0.5, 0, true);
  r.box(chrome, 0.9, 0.05, 7.1, bx, 1.1, 0.5);
  r.box(glowMat(0xff3fa8, 1.6), 0.02, 0.05, 7, bx + 0.41, 1.0, 0.5);
  for (let k = 0; k < 6; k++) {
    r.cyl(chrome, 0.03, 0.03, 0.7, bx + 0.9, 0, -2.2 + k * 1.1, 8);
    r.cyl(std({ color: 0x8e1b1b, roughness: 0.4 }), 0.2, 0.2, 0.08, bx + 0.9, 0.7, -2.2 + k * 1.1, 14);
  }
  const bottles = [];
  for (let s = 0; s < 3; s++) {
    r.box(glowMat(0xffc27a, 0.5), 0.3, 0.03, 6, -W / 2 + 0.2, 1.2 + s * 0.45, 0.5);
    for (let k = 0; k < 22; k++) bottles.push([-W / 2 + 0.2, 1.36 + s * 0.45, -2.3 + k * 0.27, 0.07, 0.3, 0.07, ['#2b6b3c', '#8a5032', '#c9d6e0', '#d8b23a', '#5a1a2a'][(k + s) % 5]]);
  }
  r.scatter(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), bottles);
  // the darts corner on the right wall: a board and an oche line
  const dz = -2.6;
  const board = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 20; i++) for (const [r0, r1, a, b] of [[0.62, 0.95, '#1a1a1a', '#efe4c8'], [0.1, 0.58, '#1a1a1a', '#efe4c8'], [0.95, 1, '#b3202a', '#1f7a45'], [0.58, 0.62, '#b3202a', '#1f7a45']]) {
      const a0 = -Math.PI / 2 - Math.PI / 20 + (i * Math.PI) / 10;
      g.fillStyle = i % 2 ? b : a;
      g.beginPath();
      g.arc(w / 2, h / 2, r1 * w * 0.42, a0, a0 + Math.PI / 10);
      g.arc(w / 2, h / 2, r0 * w * 0.42, a0 + Math.PI / 10, a0, true);
      g.fill();
    }
    g.fillStyle = '#b3202a';
    g.beginPath();
    g.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
    g.fill();
  });
  r.box(std({ map: planks('#5a3a24'), roughness: 0.7 }), 0.04, 1.2, 1.2, W / 2 - 0.02, 1.15, dz);
  r.plane(std({ map: board, roughness: 0.7 }), 0.55, 0.55, W / 2 - 0.05, 1.73, dz, -Math.PI / 2);
  r.box(glowMat(0xffd23f, 0.8), 0.05, 0.01, 0.8, W / 2 - 2.4, 0, dz);
  // a disco ball over the floor
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), std({ color: 0xffffff, roughness: 0.05, metalness: 1, flatShading: true }));
  ball.position.set(fx, r.H - 0.7, fz);
  r.group.add(ball);
  r.loose.push(ball);
  r.box(chrome, 0.01, 0.35, 0.01, fx, r.H - 0.35, fz);
  neonSign(r, 'CLUB SOLAR', '#ff3fa8', 4.4, -2.5, 3.9, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-6, -4], [-6, 3], [5, -4], [5, 1]]) r.lamp(x, 4.4, z, 'shade');
  r.lamp(fx, 4.4, fz, 'shade');
  return {
    counter: { x: bx + 1.05, z: -1.6 }, clerk: { x: bx - 0.85, z: -1.6, yaw: Math.PI / 2 }, clerkKind: 'female', wear: 'female_elegantsuit01',
    stations: [{ kind: 'dance', x: fx, z: fz - 0.6, yaw: Math.PI }, { kind: 'darts', x: W / 2 - 2.45, z: dz, yaw: Math.PI / 2, off: { x: W / 2 - 3.2, z: dz } }],
    floor: { x: fx, z: fz }, tiles, ball,
  };
}

function arcadeInterior(r) {
  const { W, D } = r;
  const black = std({ color: 0x101016, roughness: 0.5 });
  const st = [];
  const screens = ['SOL INVADERS', 'NEON SNAKE', 'TURBO SOL', 'KUNG-FU 2', 'STREET BRAWL', 'PINBALL', 'GALAXY X', 'RACER'];
  const cols = ['#ff4fa3', '#41d6ff', '#ffcf3f', '#7dff6a', '#ff7a3a', '#b46bff', '#41d6ff', '#ff4fa3'];
  // a row of cabinets along each side wall; the first two on the right work
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 1 : -1, k = i % 4, x = side * (W / 2 - 0.55), z = -1.6 + k * 1.3, yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    r.box(black, 0.75, 1.75, 0.8, x, 0, z, 0, true);
    const trim = std({ color: new THREE.Color(cols[i]).multiplyScalar(0.6), roughness: 0.4 });
    for (const e of [-1, 1]) r.box(trim, 0.8, 1.8, 0.04, x, 0, z + e * 0.41); // side panels
    r.box(black, 0.45, 0.06, 0.8, x - side * 0.5, 0.95, z); // control deck
    const scr = canvasTex(128, 112, (g, w, h) => {
      g.fillStyle = '#05060c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = cols[i];
      g.font = 'bold 15px monospace';
      g.textAlign = 'center';
      screens[i].split(' ').forEach((l, n) => g.fillText(l, w / 2, 38 + n * 20));
      g.fillStyle = '#fff';
      g.font = '10px monospace';
      g.fillText('INSERT COIN', w / 2, 96);
    });
    r.plane(std({ map: scr, emissiveMap: scr, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.2 }), 0.62, 0.52, x - side * 0.39, 1.25, z, yaw).userData.keep = true;
    r.plane(glowMat(new THREE.Color(cols[i]).getHex(), 1.6), 0.7, 0.16, x - side * 0.4, 1.86, z, yaw).userData.keep = true;
    if (i < 2) st.push({ kind: i === 0 ? 'invaders' : 'snake', x: x - side * 1.05, z, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  // a neon-carpet island of claw machines in the middle
  for (const s of [-1, 1]) {
    r.box(black, 0.9, 0.9, 0.9, s * 0.6, 0, 1.6, 0, true);
    const glass = std({ color: 0xbfe6ff, roughness: 0.05, transparent: true, opacity: 0.25 });
    r.box(glass, 0.86, 0.9, 0.86, s * 0.6, 0.9, 1.6);
    r.box(glowMat(s > 0 ? 0xff4fa3 : 0x41d6ff, 1.4), 0.9, 0.12, 0.9, s * 0.6, 1.8, 1.6);
  }
  r.scatter(new THREE.SphereGeometry(0.5, 8, 6), Array.from({ length: 18 }, (_, k) => [(k % 2 ? 1 : -1) * 0.6 + ((k * 37) % 7) / 10 - 0.3, 0.98, 1.6 + ((k * 53) % 7) / 10 - 0.3, 0.12, 0.12, 0.12, cols[k % 8]]));
  // the prize counter by the door
  const cx = -W / 2 + 2.4, cz = -D / 2 + 2.2;
  r.box(black, 2.2, 1.0, 0.6, cx, 0, cz, 0, true);
  r.box(glowMat(0xb46bff, 1.0), 2.24, 0.05, 0.64, cx, 1.0, cz);
  neonSign(r, 'PIXEL PALACE', '#41d6ff', 4.0, 0, 2.7, D / 2 - 0.05, Math.PI);
  for (const [x, z] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) r.lamp(x, 3.2, z, 'shade');
  return { counter: { x: cx, z: cz - 0.95 }, clerk: { x: cx, z: cz + 0.75, yaw: Math.PI }, clerkKind: 'male', wear: 'male_casualsuit04', stations: st };
}

// ------------------------------------------------------------------ the shops
export class Shops {
  constructor(ctx) {
    // ctx: scene, city, hud, audio, weapons, player, env, follow, peds, models, wanted
    Object.assign(this, ctx);
    this.el = document.getElementById('shop');
    this.fadeEl = document.getElementById('fade');
    this.inside = null;
    this.trans = null;
    this.menuOpen = false;
    this.t = 0;
    const guns = this.player.weaponNodes || {};
    this.branches = [];
    const colliders = [];
    BRANCHES.forEach(([type, name, bi, bj], k) => {
      const b = this.front(type, name, bi, bj);
      if (!b) return;
      const [W, D, H] = { bank: [16, 12, 4.4], mart: [12, 10, 3.4], food: [14, 11, 3.6], barber: [12, 9, 3.4], tattoo: [11, 9, 3.2], gym: [16, 13, 4.2], club: [18, 15, 5], arcade: [14, 11, 3.6] }[type] || [13, 10, 3.6];
      const floors = {
        gun: std({ map: TX.concrete(), roughness: 0.85, color: 0x9a9a9a }),
        food: std({ map: checker('#ece6d6', '#26262a'), roughness: 0.35 }),
        clothes: std({ map: planks('#b89a6e'), roughness: 0.55 }),
        mart: std({ map: tiles('#eceae4', '#c9c6be'), roughness: 0.4 }),
        bank: std({ map: checker('#ece6da', '#b9b2a2', 6), roughness: 0.2 }),
        barber: std({ map: checker('#f2f2ee', '#1d1d20'), roughness: 0.3 }),
        tattoo: std({ map: planks('#3a2a22'), roughness: 0.6 }),
        gym: std({ map: tiles('#2a2a2e', '#1c1c1f'), roughness: 0.95 }),
        club: std({ map: checker('#151218', '#0c0a0e', 6), roughness: 0.25 }),
        arcade: std({ map: neonCarpet(), roughness: 1 }),
      };
      floors[type].map.repeat.set(W / 2, D / 2);
      floors[type].map.wrapS = floors[type].map.wrapT = THREE.RepeatWrapping;
      const walls = { gun: 0x34373d, food: 0xf1e2c6, clothes: 0xf4f2ee, mart: 0xf0f2f4, bank: 0xe4dcc8, barber: 0xcfe4e2, tattoo: 0x231f26, gym: 0x9aa0a8, club: 0x120e16, arcade: 0x14142a };
      const r = new Room(this.scene, IN_X + k * IN_STEP, IN_Z, W, D, H, {
        floor: floors[type], wall: std({ color: walls[type], roughness: 0.85 }), ceiling: std({ color: 0xe8e6e0, roughness: 0.9, side: THREE.DoubleSide }),
      });
      const spec = type === 'gun' ? gunInterior(r, guns) : type === 'food' ? foodInterior(r, name) : type === 'clothes' ? clothesInterior(r, this.models) : type === 'bank' ? bankInterior(r)
        : type === 'barber' ? barberInterior(r) : type === 'tattoo' ? tattooInterior(r) : type === 'gym' ? gymInterior(r) : type === 'club' ? clubInterior(r) : type === 'arcade' ? arcadeInterior(r) : martInterior(r);
      r.finish();
      colliders.push(...r.colliders);
      b.room = r;
      b.spec = spec;
      b.entry = r.world(0, -D / 2 + 1.9);
      b.exitRing = r.world(0, -D / 2 + 0.9);
      b.counter = r.world(spec.counter.x, spec.counter.z);
      if (spec.vault) {
        b.vault = r.world(spec.vault.x, spec.vault.z);
        b.guardSpots = spec.guards.map((p) => r.world(p.x, p.z));
      }
      b.ringIn = this.ring(STYLE[type].sign, b.exitRing.x, b.exitRing.z);
      b.ringCounter = this.ring(STYLE[type].sign, b.counter.x, b.counter.z, 0.55);
      // the venues' stations (fun.js), in world coordinates, each with a ring to step into
      for (const st of spec.stations || []) {
        Object.assign(st, r.world(st.x, st.z));
        if (st.off) st.off = r.world(st.off.x, st.off.z);
        if (st.bar) {
          st.bar.position.x += r.ox;
          st.bar.position.z += r.oz;
          this.scene.add(st.bar);
          st.barRest = st.bar.position.clone();
        }
        st.ring = this.ring(STYLE[type].sign, st.x, st.z, 0.5);
      }
      if (spec.floor) spec.floor = r.world(spec.floor.x, spec.floor.z);
      this.branches.push(b);
    });
    this.city.addColliders(colliders);
    this.clerks = new Map();
    this.loadOutfit();
  }

  // ---------------------------------------------------------------- the shop front on the street
  // A shop front built onto the plain ground floor the city kept for it (city.shopFronts):
  // pilasters, a bulkhead, display windows across the whole width with mullions, a glass
  // double door in the middle, a fascia with the lit name and an awning over the windows.
  front(type, name, bi, bj) {
    const C = this.city, f = C.shopFronts?.[`${bi},${bj}`];
    if (!f) return null;
    // The building's facade texture is a grid: a window column every 4 m from the face's right end
    // (seen from the street) with wall between them on the multiples of 4, and a row of windows a
    // floor (3.5 m) from 0.77 to 2.84 m up it (glass towers: 0.49 to 3.33). The front is cut to
    // that grid, so it never shows half a window at its sides or over its top.
    const right = f.x + f.w / 2, left = f.x - f.w / 2;
    const snap = (xw) => Math.min(right, Math.max(left, right - Math.round((right - xw) / 4) * 4));
    const want = Math.min(f.w - 0.6, 18);
    let xl = snap(f.x - want / 2), xr = snap(f.x + want / 2);
    if (xr - xl < 8) [xl, xr] = [Math.max(left, xl - 4), Math.min(right, xr + 4)];
    const x = (xl + xr) / 2, z = f.z;
    const W = xr - xl; // the shop's width along the street
    const st = STYLE[type];
    const g = new THREE.Group();
    g.position.set(x, C.groundHeight(x, z - 1), z);
    this.scene.add(g);
    const look = FRONT_LOOK[type];
    const facade = std({ color: look.wall, roughness: 0.75 });
    const trim = std({ color: look.trim, roughness: 0.55, metalness: look.metal ? 0.5 : 0 });
    const frame = std({ color: 0x1f2226, roughness: 0.4, metalness: 0.7 });
    const glass = std({ color: 0x9fb3c2, roughness: 0.08, metalness: 0.3, emissive: 0xffd9a0, emissiveIntensity: 0, transparent: true, opacity: 0.55 });
    // display windows: a lit view of the shop inside
    const shelves = canvasTex(256, 192, (c2, w, h) => {
      c2.fillStyle = look.inside;
      c2.fillRect(0, 0, w, h);
      c2.fillStyle = 'rgba(0,0,0,.22)';
      for (let y = 40; y < h; y += 46) c2.fillRect(0, y, w, 6);
      const cols = look.goods;
      for (let y = 10; y < h - 20; y += 46) for (let xx = 6; xx < w - 10; xx += 14 + ((xx * 7) % 9)) {
        c2.fillStyle = cols[(xx + y) % cols.length];
        c2.fillRect(xx, y + 6, 10, 28);
      }
      const gr = c2.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,210,.35)');
      gr.addColorStop(1, 'rgba(0,0,0,.3)');
      c2.fillStyle = gr;
      c2.fillRect(0, 0, w, h);
    }, true);
    const window_ = std({ map: shelves, emissiveMap: shelves, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.2 });
    const box = (m, w, h, d, px, py, pz, rx = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py + h / 2, pz);
      b.rotation.x = rx;
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    // the ground floor only: under the first row of upper windows (on a glass tower, under its canopy)
    const T0 = f.glass ? 3.56 : 4.2;
    const SH = T0 - 0.86; // shop-floor height (top of the windows / door head)
    // the shop's face over the whole ground floor, standing just proud of the building's wall
    box(facade, W, T0 - 0.1, 0.12, 0, 0, -0.06);
    // pilasters at both ends, a cornice on top
    for (const s of [-1, 1]) box(trim, 0.42, T0 - 0.1, 0.34, s * (W / 2 - 0.21), 0, -0.17);
    box(trim, W + 0.3, 0.1, 0.42, 0, T0 - 0.1, -0.2);
    // the door: steel frame, two glass leaves with push bars, a step
    const DW = 2.1, DH = Math.min(2.55, SH - 0.2);
    box(frame, DW + 0.24, DH + 0.12, 0.16, 0, 0, -0.14);
    for (const s of [-1, 1]) {
      box(glass, DW / 2 - 0.08, DH - 0.1, 0.04, s * (DW / 4), 0.06, -0.2);
      box(std({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.2 }), 0.7, 0.04, 0.05, s * (DW / 4), 1.0, -0.25);
    }
    box(trim, DW + 0.6, 0.12, 0.5, 0, -0.05, -0.3); // step
    box(facade, DW + 0.24, SH - DH - 0.12, 0.16, 0, DH + 0.12, -0.14); // transom panel over the door
    // display windows from the door to the pilasters, in panes no wider than ~2.4 m
    const span = W / 2 - 0.42 - (DW / 2 + 0.12);
    if (span > 0.6) {
      const n = Math.max(1, Math.round(span / 2.4)), pw = span / n;
      for (const s of [-1, 1]) {
        const x0 = s * (DW / 2 + 0.12);
        box(trim, span, 0.55, 0.22, x0 + s * span / 2, 0, -0.16); // bulkhead
        for (let k = 0; k < n; k++) {
          const cx = x0 + s * (k + 0.5) * pw;
          box(window_, pw - 0.1, SH - 0.75, 0.04, cx, 0.6, -0.12);
          box(glass, pw - 0.1, SH - 0.75, 0.02, cx, 0.6, -0.17);
        }
        for (let k = 0; k <= n; k++) box(frame, 0.09, SH - 0.65, 0.14, x0 + s * k * pw, 0.55, -0.16); // mullions
        box(frame, span, 0.09, 0.14, x0 + s * span / 2, SH - 0.1, -0.16); // head
      }
    }
    // fascia across the front, in the shop's colour
    const brand = std({ color: st.awning, roughness: 0.5 });
    const fh = T0 - 0.2 - SH;
    box(brand, W - 0.84, fh, 0.3, 0, SH + 0.08, -0.2);
    // the name, lit, on a sign board over the shop: from the front's top up past the first row of
    // upper windows (to the wall between two rows), across whole window columns. A low building
    // without room for one has it on the fascia.
    const t = TX.sign(name, st.sign);
    const sm = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 });
    const b0 = f.glass ? 3.98 : T0, b1 = Math.min(f.glass ? 6.9 : 6.6, f.top - g.position.y - 0.4);
    let sw = Math.min(W - 1.4, 7.5), signY = SH + 0.08 + fh / 2;
    if (b1 - b0 > 1.2) {
      const bl = snap(x - sw / 2 - 1.5), br = snap(x + sw / 2 + 1.5);
      box(brand, br - bl, b1 - b0, 0.14, (bl + br) / 2 - x, b0, -0.07);
      sw = Math.min(sw, br - bl - 0.6, (b1 - b0 - 0.5) * 4.2);
      signY = (b0 + b1) / 2;
    } else sw = Math.min(sw, (fh - 0.1) * 4.2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 4.2), sm);
    sign.position.set(0, signY, signY > T0 ? -0.16 : -0.36);
    sign.rotation.y = Math.PI; // faces the street (-z)
    g.add(sign);
    // striped awning over each run of windows (the door stays open to the sky)
    if (span > 0.6) {
      const hex = '#' + st.awning.toString(16).padStart(6, '0');
      const stripes = canvasTex(128, 32, (c2, w, h) => {
        for (let i = 0; i < 8; i++) {
          c2.fillStyle = i % 2 ? '#f2efe6' : hex;
          c2.fillRect((i * w) / 8, 0, w / 8, h);
        }
      }, true);
      stripes.repeat.set((span + 0.2) / 1.6, 1);
      const aw = std({ map: stripes, roughness: 0.8 });
      for (const s of [-1, 1]) {
        const a = box(aw, span + 0.2, 0.05, 1.25, s * (DW / 2 + 0.12 + span / 2), SH - 0.02, -0.72, -0.38);
        a.castShadow = true;
      }
    }
    // a DaCity ATM on the pavement by the bank and the 24/7s
    if (type === 'bank' || type === 'mart') {
      const ax = W / 2 - 0.75, az = -0.62;
      const body = std({ color: 0x2b2e33, roughness: 0.45, metalness: 0.6 });
      box(body, 0.72, 1.62, 0.46, ax, 0, az);
      box(std({ color: 0xffd23f, roughness: 0.5 }), 0.74, 0.18, 0.48, ax, 1.62, az); // DaCity yellow top
      const scr = canvasTex(128, 96, (c2, w, h) => {
        c2.fillStyle = '#081a24';
        c2.fillRect(0, 0, w, h);
        c2.fillStyle = '#ffd23f';
        c2.font = 'bold 22px Arial';
        c2.textAlign = 'center';
        c2.fillText('DACITY', w / 2, 40);
        c2.fillStyle = '#7fd6ff';
        c2.font = '14px Arial';
        c2.fillText('ATM', w / 2, 66);
      });
      const sm2 = new THREE.MeshStandardMaterial({ map: scr, emissiveMap: scr, emissive: 0xffffff, emissiveIntensity: 0.9 });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), sm2);
      screen.position.set(ax, 1.22, az - 0.235);
      screen.rotation.y = Math.PI;
      g.add(screen);
      box(std({ color: 0x8e959c, roughness: 0.3, metalness: 0.8 }), 0.36, 0.05, 0.18, ax, 0.9, az - 0.28); // keypad shelf
      this.atms = this.atms || [];
      this.atms.push({ x: x + ax, z: z + az - 0.75 });
      C.addColliders([{ type: 'box', minX: x + ax - 0.38, maxX: x + ax + 0.38, minZ: z + az - 0.25, maxZ: z + az + 0.25, h: g.position.y + 1.8 }]);
    }
    // the front stands ~0.35 m proud of the building: solid, so nobody walks into it
    C.addColliders([{ type: 'box', minX: x - W / 2, maxX: x + W / 2, minZ: z - 0.36, maxZ: z + 0.05, h: g.position.y + T0 }]);
    // the entrance ring on the pavement and a floating icon above it
    const door = { x, z: z - 1.4 };
    const ring = this.ring(st.sign, door.x, door.z, 0.9, g.position.y);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, depthWrite: false }));
    sprite.scale.setScalar(0.8);
    sprite.position.set(door.x, g.position.y + 2.2, door.z);
    this.scene.add(sprite);
    return { type, name, x, z, door, ring, sprite, glass, window: window_, sign: sm, group: g };
  }

  ring(color, x, z, r = 0.9, y = 0) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y + 0.04, z);
    m.renderOrder = 2;
    this.scene.add(m);
    return m;
  }

  blips() {
    return this.branches.map((b) => ({ x: b.x, z: b.z - 1, color: ICONS[b.type].color, r: 6, icon: b.type, kind: 'shop' }));
  }

  // ---------------------------------------------------------------- clothes for the hero
  loadOutfit() {
    try {
      this.outfit = JSON.parse(localStorage.getItem('solcity.outfit') || '{}');
    } catch {
      this.outfit = {};
    }
    this.applyOutfit();
  }

  saveOutfit() {
    try {
      localStorage.setItem('solcity.outfit', JSON.stringify(this.outfit));
    } catch {}
    this.applyOutfit();
  }

  applyOutfit() {
    this.player.model.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material.name || '';
      if (/^Shirt/.test(n) && this.outfit.shirt) o.material.color.set(this.outfit.shirt);
      if (/^Jeans/.test(n) && this.outfit.jeans) o.material.color.set(this.outfit.jeans);
    });
    this.fun?.applyLook(this.outfit);
  }

  // ---------------------------------------------------------------- menus
  items(b) {
    if (b.type === 'gun') {
      return GUN_ITEMS.map((it) => {
        const own = it.key !== 'armor' && this.weapons.inv[it.key];
        return { label: it.name + (own ? ' ammo' : ''), price: own ? Math.round(it.price * 0.4) : it.price, it };
      });
    }
    if (b.type === 'bank') return [];
    if (b.type === 'barber') return HAIRCUTS.map((h) => ({ label: h.name + ((this.outfit.hair || 'crop') === h.id ? ' <small>(now)</small>' : ''), price: h.price, cut: h }));
    if (b.type === 'tattoo') {
      const have = this.outfit.tattoos || [];
      return TATTOOS.map((t) => ({ label: t.name + (have.includes(t.id) ? ' <small>(have)</small>' : ''), price: t.price, tat: t }));
    }
    if (VENUE_MENUS[b.type]) return VENUE_MENUS[b.type].map(([n, p, hp]) => ({ label: hp ? `${n} <small>+${hp} HP</small>` : n, price: p, hp, drunk: !hp }));
    if (b.type === 'food') return MENUS[b.name].map(([n, p, hp]) => ({ label: `${n} <small>+${hp} HP</small>`, price: p, hp }));
    if (b.type === 'mart') return MART_ITEMS.map(([n, p, hp]) => ({ label: hp ? `${n} <small>+${hp} HP</small>` : n, price: p, hp, lottery: !hp }));
    return CLOTHES.map((c) => ({ label: c.name + (this.outfit[c.part] === c.color ? ' <small>(wearing)</small>' : ''), price: c.price, c }));
  }

  show(b) {
    const money = this.hud.money, color = STYLE[b.type].sign;
    this.el.style.borderLeftColor = color;
    this.el.innerHTML = `<div class="s-title" style="color:${color}">${b.name}</div>` + this.items(b).map((it, i) =>
      `<div class="s-row${money < it.price ? ' poor' : ''}"><kbd>${i + 1}</kbd><span>${it.label}</span><b>$${it.price}</b></div>`).join('') +
      (b.type === 'bank' ? '<div class="s-row"><span>Accounts by appointment only.</span></div>' : '') +
      (b.type === 'gym' && this.fun ? `<div class="s-row"><span>Strength <b>${this.fun.fit.str}</b>/100 · Stamina <b>${this.fun.fit.sta}</b>/100</span></div>` : '') + '<div class="s-foot">Walk away to leave</div>';
  }

  buy(b, i) {
    const it = this.items(b)[i];
    if (!it) return;
    const no = (msg) => {
      this.hud.say(msg, 2);
      this.audio.blip({ tone: 220, toneEnd: 180, dur: 0.15, gain: 0.25 });
    };
    if (this.hud.money < it.price) return no("You can't afford that.");
    const P = this.player;
    if (b.type === 'gun') {
      if (it.it.key === 'armor') {
        if (P.armor >= 100) return no('You already have full armor.');
        P.armor = 100;
        this.hud.setArmor(100);
        this.hud.say('Body armor fitted.', 2);
      } else {
        this.weapons.give(it.it.key, true);
        this.weapons.equip(it.it.key);
      }
    } else if (it.cut) {
      if ((this.outfit.hair || 'crop') === it.cut.id) return no('That is how you wear it now.');
      this.outfit.hair = it.cut.id;
      this.saveOutfit();
      this.hud.say(`Fresh cut: <em>${it.cut.name}</em>.`, 2);
    } else if (it.tat) {
      const have = this.outfit.tattoos || [];
      if (it.tat.remove) {
        if (!have.length) return no('There is nothing to remove.');
        this.outfit.tattoos = [];
      } else {
        if (have.includes(it.tat.id)) return no('You already have that one.');
        this.outfit.tattoos = [...have, it.tat.id];
      }
      this.saveOutfit();
      this.hud.say(it.tat.remove ? 'Clean skin again. That stung.' : 'Fresh ink. Keep it out of the sun.', 2.5);
    } else if (it.drunk) {
      this.fun && (this.fun.drunk = 45);
      this.hud.say('Whoa. That one has a kick.', 2.5);
    } else if (it.hp) {
      if (P.health >= 100) return no("You're not hungry.");
      P.health = Math.min(100, P.health + it.hp);
      this.hud.setHealth(P.health);
      this.hud.say(b.type === 'food' ? 'Mmm. That hit the spot.' : 'Feeling better.', 2);
    } else if (it.lottery) {
      const win = Math.random() < 0.25 ? [20, 50, 100, 1000][Math.floor(Math.random() ** 3 * 4)] : 0;
      this.hud.addMoney(-it.price);
      if (win) this.hud.addMoney(win);
      this.hud.say(win ? `Scratch card: you won <em>$${win}</em>!` : 'Scratch card: no luck this time.', 2.5);
      this.audio.cash();
      return this.show(b);
    } else {
      if (this.outfit[it.c.part] === it.c.color) return no("You're already wearing that.");
      this.outfit[it.c.part] = it.c.color;
      this.saveOutfit();
      this.hud.say(`New look: <em>${it.c.name}</em>.`, 2);
    }
    this.audio.cash();
    this.hud.addMoney(-it.price);
    this.onBuy?.(b, it);
    this.show(b);
  }

  // ---------------------------------------------------------------- going in and out
  go(b, inward) {
    this.trans = { b, inward, t: 0, done: false };
    this.fadeEl.classList.add('show');
    this.closeMenu();
  }

  arrive() {
    const { b, inward } = this.trans;
    const P = this.player;
    P.vel?.set(0, 0, 0);
    P.speed = P.moveSpeed = 0;
    if (inward) {
      this.inside = b;
      this.player.indoors = true;
      P.position.set(b.entry.x, 0, b.entry.z);
      P.yaw = 0;
      this.follow.setMode('indoor');
      this.follow.ceiling = b.room.H - 0.25;
      this.env.indoor = { lights: b.room.lights, intensity: 24 };
      this.spawnClerk(b);
      this.fun?.enter(b);
      this.needLeave = true;
    } else {
      this.leave();
      P.position.set(b.door.x, this.city.groundHeight(b.door.x, b.door.z), b.door.z - 0.9);
      P.yaw = Math.PI;
      this.needLeaveOut = b;
    }
    P.object.rotation.y = P.yaw;
    this.follow.yaw = P.yaw;
    this.follow.pitch = inward ? 0.32 : 0.2;
  }

  leave() {
    const b = this.inside;
    if (b && this.clerks.get(b)) this.clerks.get(b).cower = false;
    if (this.robbery) {
      this.robbery = null;
      this.hud.mission(null);
    }
    // walking out of a robbed shop: the police are already on the way
    if (this.alarm) {
      this.alarm = false;
      this.wanted.crime('ko_cop', true);
      this.hud.say('The shop alarm called the <em>police</em>!', 3);
    }
    this.fun?.leave(b);
    this.inside = null;
    this.player.indoors = false;
    this.follow.setMode('foot');
    this.follow.ceiling = null;
    this.env.indoor = null;
    this.closeMenu();
  }

  spawnClerk(b) {
    if (this.clerks.has(b)) return;
    const s = b.spec, w = b.room.world(s.clerk.x, s.clerk.z);
    const p = this.peds.add(s.clerkKind, w.x, w.z, s.clerk.yaw);
    p.state = 'contact';
    p.keep = true;
    p.invulnerable = true;
    chooseOutfit(p.body, s.wear);
    this.clerks.set(b, p);
  }

  // is the gun pointed at this person (through the crosshair)?
  aimedAt(p) {
    const cam = this.weapons.camera, d = new THREE.Vector3();
    cam.getWorldDirection(d);
    const to = new THREE.Vector3(p.x - cam.position.x, p.y + 1.3 - cam.position.y, p.z - cam.position.z);
    return to.length() < 10 && to.angleTo(d) < 0.3;
  }

  startRobbery(b, clerk) {
    this.closeMenu();
    const till = b.type === 'mart' ? 350 + Math.random() * 450 : 250 + Math.random() * 350;
    this.robbery = { b, t: 0, slack: 0, till: Math.round(till / 10) * 10 };
    clerk.cower = true;
    this.hud.say('<em>Clerk:</em> "OK, OK! Don’t shoot! Take it!"', 2.5);
  }

  // keep him covered and the till comes out; look away too long and he hits the alarm
  updateRobbery(dt, b, clerk) {
    const r = this.robbery, P = this.player.position;
    if (clerk) clerk.yaw = Math.atan2(P.x - clerk.x, P.z - clerk.z);
    const covered = this.weapons.aiming && clerk && this.aimedAt(clerk);
    if (covered) {
      r.t += dt;
      r.slack = 0;
    } else r.slack += dt;
    const cash = Math.round((r.till * Math.min(1, r.t / ROB_TIME)) / 10) * 10;
    this.hud.mission({ title: 'HOLD-UP', time: null, rows: [['TILL', `$${cash} / $${r.till}`], ['', covered ? 'Keep him covered' : 'Aim at the clerk!']] });
    if (r.t < ROB_TIME && r.slack < 1.6) return;
    // done, or he slammed the alarm button while you looked away: either way the alarm is on
    this.robbery = null;
    this.hud.mission(null);
    b.robbedAt = performance.now();
    this.alarm = true;
    if (cash > 0) {
      this.hud.addMoney(cash);
      this.audio.cash();
    }
    this.hud.say(r.t >= ROB_TIME ? `Got <em>$${cash}</em>. The alarm’s ringing: get out of here!` : `He hit the alarm! You got <em>$${cash}</em>. Get out!`, 4);
  }

  // the club's floor: tiles change colour on the beat, the mirror ball turns
  discoLights(spec) {
    spec.ball.rotation.y += 0.01;
    const beat = Math.floor(this.t * 2);
    if (beat === spec.beat) return;
    spec.beat = beat;
    const c = new THREE.Color(), pal = [0xff3fa8, 0x41d6ff, 0xb46bff, 0xffd23f, 0x7dff6a, 0x101014];
    for (let i = 0; i < spec.tiles.count; i++) spec.tiles.setColorAt(i, c.set(pal[(i * 7 + beat * (1 + (i % 3))) % pal.length]));
    spec.tiles.instanceColor.needsUpdate = true;
  }

  closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.el.classList.remove('show');
  }

  // ---------------------------------------------------------------- per frame
  update(dt, input, onFoot) {
    this.t += dt;
    const P = this.player.position;
    const night = this.env.nightK || 0;
    // fades
    if (this.trans) {
      const tr = this.trans;
      tr.t += dt;
      if (!tr.done && tr.t >= FADE) {
        tr.done = true;
        this.arrive();
      }
      if (tr.t >= FADE + 0.15) {
        this.fadeEl.classList.remove('show');
        this.trans = null;
      }
      return;
    }
    // respawned elsewhere (died, busted) while inside: we're out
    if (this.inside && Math.hypot(P.x - this.inside.room.ox, P.z - this.inside.room.oz) > 40) this.leave();

    if (!this.inside) {
      for (const b of this.branches) {
        const d = Math.hypot(P.x - b.door.x, P.z - b.door.z);
        // shop fronts: lit windows and sign at night, the ring and icon pulse when near
        b.glass.emissiveIntensity = night * 0.35;
        b.window.emissiveIntensity = 0.35 + night * 0.35;
        b.sign.emissiveIntensity = 0.7 + night * 0.5;
        const near = d < 40;
        b.ring.visible = b.sprite.visible = near;
        if (!near) continue;
        b.ring.material.opacity = 0.7 + 0.25 * Math.sin(this.t * 4);
        if (!b.sprite.material.map) {
          const img = iconImage(b.type);
          if (img) {
            b.sprite.material.map = new THREE.Texture(img);
            b.sprite.material.map.needsUpdate = true;
            b.sprite.material.map.colorSpace = THREE.SRGBColorSpace;
            b.sprite.material.needsUpdate = true;
          }
        }
        b.sprite.position.y = b.group.position.y + 2.2 + Math.sin(this.t * 2.2) * 0.08;
        if (this.needLeaveOut === b) {
          if (d > 1.6) this.needLeaveOut = null;
          continue;
        }
        if (d < 0.85 && onFoot) {
          if (this.wanted.level > 0) {
            if (!b.warned) this.hud.say('Lose the cops before you go shopping.', 2.5);
            b.warned = true;
          } else this.go(b, true);
        } else b.warned = false;
      }
      return;
    }

    const b = this.inside;
    b.ringIn.material.opacity = b.ringCounter.material.opacity = 0.45 + 0.3 * Math.sin(this.t * 4);
    if (b.spec.tiles) this.discoLights(b.spec);
    if (this.fun?.active) return;
    // the venues' stations: step into the ring, E to play / work out
    for (const st of b.spec.stations || []) {
      st.ring.material.opacity = 0.45 + 0.3 * Math.sin(this.t * 4);
      const on = onFoot && Math.hypot(P.x - st.x, P.z - st.z) < 0.6;
      if (on && !st.on) this.hud.say(this.fun.hint(st), 3);
      st.on = on;
      if (on && input.pressed('KeyE')) {
        input.pressedOnce.delete('KeyE');
        this.fun.start(st, b);
        return;
      }
    }
    // a gun pointed at the clerk: a hold-up (24/7s and diners; Ammu-Nation shoots back, so no)
    const clerk = this.clerks.get(b);
    if (this.robbery) {
      this.updateRobbery(dt, b, clerk);
      if (this.robbery) return;
    } else if (clerk && onFoot && this.weapons.aiming && this.aimedAt(clerk)) {
      if (b.type === 'gun') {
        if (!this.rebuffed) this.hud.say('<em>Clerk:</em> "In <em>here</em>? Put it away before I use one of mine."', 3.5);
        this.rebuffed = true;
      } else if (b.type === 'bank') {
        if (!this.rebuffed) this.hud.say('<em>Teller:</em> "The tills are time-locked. The real money is in the vault, and you’d need a crew for that."', 4);
        this.rebuffed = true;
      } else if (b.type === 'clothes') {
        if (!this.rebuffed) this.hud.say('<em>Clerk:</em> "We take cards only, genius. There’s no cash here."', 3.5);
        this.rebuffed = true;
      } else if (b.robbedAt && performance.now() - b.robbedAt < ROB_COOLDOWN) {
        if (!this.rebuffed) this.hud.say('<em>Clerk:</em> "Again?! You already emptied the till!"', 3.5);
        this.rebuffed = true;
      } else this.startRobbery(b, clerk);
      if (this.robbery) return;
    } else this.rebuffed = false;
    // out through the door
    const dOut = Math.hypot(P.x - b.exitRing.x, P.z - b.exitRing.z);
    if (this.needLeave) {
      if (dOut > 1.3) this.needLeave = false;
    } else if (dOut < 0.75) return this.go(b, false);
    // served at the counter
    const atCounter = onFoot && Math.hypot(P.x - b.counter.x, P.z - b.counter.z) < 1.1;
    if (atCounter !== this.menuOpen) {
      this.menuOpen = atCounter;
      this.el.classList.toggle('show', atCounter);
      if (atCounter) this.show(b);
    }
    if (!atCounter) return;
    const n = this.items(b).length;
    for (let i = 0; i < n; i++) {
      const code = 'Digit' + (i + 1);
      if (input.pressed(code)) {
        input.pressedOnce.delete(code);
        this.buy(b, i);
      }
    }
  }
}
