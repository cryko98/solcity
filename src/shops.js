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

// branches: [type, name, block i, block j]
const BRANCHES = [
  ['gun', 'AMMU-NATION', 4, 4], ['gun', 'AMMU-NATION', 2, 2], ['gun', 'AMMU-NATION', 6, 5],
  ['food', 'BURGER SOL', 2, 6], ['food', 'TACO LOCO', 0, 4], ['food', 'PIZZA SOL', 5, 4],
  ['clothes', 'SOL THREADS', 3, 6], ['clothes', 'SOL THREADS', 6, 7], ['clothes', 'SOL THREADS', 8, 4],
  ['mart', '24/7', 0, 2], ['mart', '24/7', 7, 6], ['mart', '24/7', 5, 8], ['food', 'BURGER SOL', 9, 7],
];
const STYLE = {
  gun: { sign: '#ff4040', awning: 0x8e1b1b },
  food: { sign: '#ffb02e', awning: 0xc8541c },
  clothes: { sign: '#c38bff', awning: 0x5d2e8c },
  mart: { sign: '#55e08a', awning: 0x1f7a45 },
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
      const W = type === 'mart' ? 12 : type === 'food' ? 14 : 13, D = type === 'food' ? 11 : 10, H = type === 'mart' ? 3.4 : 3.6;
      const floors = {
        gun: std({ map: TX.concrete(), roughness: 0.85, color: 0x9a9a9a }),
        food: std({ map: checker('#ece6d6', '#26262a'), roughness: 0.35 }),
        clothes: std({ map: planks('#b89a6e'), roughness: 0.55 }),
        mart: std({ map: tiles('#eceae4', '#c9c6be'), roughness: 0.4 }),
      };
      floors[type].map.repeat.set(W / 2, D / 2);
      floors[type].map.wrapS = floors[type].map.wrapT = THREE.RepeatWrapping;
      const walls = { gun: 0x34373d, food: 0xf1e2c6, clothes: 0xf4f2ee, mart: 0xf0f2f4 };
      const r = new Room(this.scene, IN_X + k * IN_STEP, IN_Z, W, D, H, {
        floor: floors[type], wall: std({ color: walls[type], roughness: 0.85 }), ceiling: std({ color: 0xe8e6e0, roughness: 0.9, side: THREE.DoubleSide }),
      });
      const spec = type === 'gun' ? gunInterior(r, guns) : type === 'food' ? foodInterior(r, name) : type === 'clothes' ? clothesInterior(r, this.models) : martInterior(r);
      r.finish();
      colliders.push(...r.colliders);
      b.room = r;
      b.spec = spec;
      b.entry = r.world(0, -D / 2 + 1.9);
      b.exitRing = r.world(0, -D / 2 + 0.9);
      b.counter = r.world(spec.counter.x, spec.counter.z);
      b.ringIn = this.ring(STYLE[type].sign, b.exitRing.x, b.exitRing.z);
      b.ringCounter = this.ring(STYLE[type].sign, b.counter.x, b.counter.z, 0.55);
      this.branches.push(b);
    });
    this.city.addColliders(colliders);
    this.clerks = new Map();
    this.loadOutfit();
  }

  // ---------------------------------------------------------------- the shop front on the street
  front(type, name, bi, bj) {
    const C = this.city, x0 = C.blockMin(bi), z0 = C.blockMin(bj);
    // the building facing the street on the south side of the block
    let best = null;
    for (const c of C.query(x0, x0 + C.BLOCK, z0, z0 + C.BLOCK)) {
      if (c.type !== 'box' || c.h < 5 || c.maxX - c.minX < 7 || c.minZ < z0 + 3 || c.minZ > z0 + 12) continue;
      if (!best || c.minZ < best.minZ) best = c;
    }
    if (!best) return null;
    const x = (best.minX + best.maxX) / 2, z = best.minZ;
    const st = STYLE[type];
    const g = new THREE.Group();
    g.position.set(x, C.groundHeight(x, z - 1), z);
    this.scene.add(g);
    const dark = std({ color: 0x1c1d21, roughness: 0.5, metalness: 0.5 });
    const glass = std({ color: 0x9fb3c2, roughness: 0.08, metalness: 0.3, emissive: 0xffd9a0, emissiveIntensity: 0 });
    // display windows: a lit view of the shop inside
    const shelves = canvasTex(256, 192, (c2, w, h) => {
      c2.fillStyle = '#e8dcc0';
      c2.fillRect(0, 0, w, h);
      c2.fillStyle = 'rgba(0,0,0,.25)';
      for (let y = 40; y < h; y += 46) c2.fillRect(0, y, w, 6);
      const cols = ['#d63a3a', '#f2c12e', '#3d6ea8', '#2bb673', '#8a5fb0', '#ef8a3c', '#333'];
      for (let y = 10; y < h - 20; y += 46) for (let x = 6; x < w - 10; x += 14 + ((x * 7) % 9)) {
        c2.fillStyle = cols[(x + y) % cols.length];
        c2.fillRect(x, y + 6, 10, 28);
      }
      const gr = c2.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,240,210,.35)');
      gr.addColorStop(1, 'rgba(0,0,0,.25)');
      c2.fillStyle = gr;
      c2.fillRect(0, 0, w, h);
    });
    const window_ = std({ map: shelves, emissiveMap: shelves, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.2 });
    const add = (m, w, h, d, px, py, pz, rx = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py + h / 2, pz);
      b.rotation.x = rx;
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    // door surround, double glass door, display windows on both sides
    add(dark, 2.8, 3.0, 0.3, 0, 0, -0.1);
    add(glass, 1.1, 2.4, 0.06, -0.57, 0.05, -0.27);
    add(glass, 1.1, 2.4, 0.06, 0.57, 0.05, -0.27);
    add(std({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.2 }), 0.04, 0.6, 0.05, -0.08, 0.9, -0.32);
    add(std({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.2 }), 0.04, 0.6, 0.05, 0.08, 0.9, -0.32);
    for (const s of [-1, 1]) {
      add(dark, 2.4, 2.2, 0.2, s * 2.7, 0.3, -0.06);
      add(window_, 2.2, 1.9, 0.05, s * 2.7, 0.45, -0.18);
    }
    // a fascia across the whole front with the shop's name: covers whatever sign the
    // building had there before
    add(dark, 8.8, 2.4, 0.9, 0, 3.7, -0.6); // deep enough to hide whatever the building had on its front
    add(std({ color: st.awning, roughness: 0.6 }), 8.9, 0.14, 0.34, 0, 3.62, -0.3);
    add(dark, 8.8, 0.9, 0.2, 0, 2.75, -0.1); // between the door head and the awning
    // awning and the lit sign above it
    const aw = std({ map: TX.awning ? TX.awning('#' + st.awning.toString(16).padStart(6, '0'), '#f2efe6') : null, color: TX.awning ? 0xffffff : st.awning, roughness: 0.8 });
    add(aw, 9.0, 0.08, 2.1, 0, 3.32, -1.0, -0.36); // over the building's own awning
    const t = TX.sign(name, st.sign);
    const sm = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 0.2), [dark, dark, dark, dark, dark, sm]);
    sign.position.set(0, 4.9, -0.85);
    g.add(sign);
    // the building's own shop sign above this door goes (the fascia replaces it)
    for (const o of [...this.scene.children]) {
      if (!o.isMesh || o.isInstancedMesh || !Array.isArray(o.material) || o.parent !== this.scene) continue;
      const p = o.position;
      if (Math.abs(p.x - x) < 6.5 && p.z > z - 2.5 && p.z < z + 1.5 && p.y > 3 && p.y < 9) o.visible = false;
    }
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

  applyOutfit() {
    this.player.model.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material.name || '';
      if (/^Shirt/.test(n) && this.outfit.shirt) o.material.color.set(this.outfit.shirt);
      if (/^Jeans/.test(n) && this.outfit.jeans) o.material.color.set(this.outfit.jeans);
    });
  }

  // ---------------------------------------------------------------- menus
  items(b) {
    if (b.type === 'gun') {
      return GUN_ITEMS.map((it) => {
        const own = it.key !== 'armor' && this.weapons.inv[it.key];
        return { label: it.name + (own ? ' ammo' : ''), price: own ? Math.round(it.price * 0.4) : it.price, it };
      });
    }
    if (b.type === 'food') return MENUS[b.name].map(([n, p, hp]) => ({ label: `${n} <small>+${hp} HP</small>`, price: p, hp }));
    if (b.type === 'mart') return MART_ITEMS.map(([n, p, hp]) => ({ label: hp ? `${n} <small>+${hp} HP</small>` : n, price: p, hp, lottery: !hp }));
    return CLOTHES.map((c) => ({ label: c.name + (this.outfit[c.part] === c.color ? ' <small>(wearing)</small>' : ''), price: c.price, c }));
  }

  show(b) {
    const money = this.hud.money, color = STYLE[b.type].sign;
    this.el.style.borderLeftColor = color;
    this.el.innerHTML = `<div class="s-title" style="color:${color}">${b.name}</div>` + this.items(b).map((it, i) =>
      `<div class="s-row${money < it.price ? ' poor' : ''}"><kbd>${i + 1}</kbd><span>${it.label}</span><b>$${it.price}</b></div>`).join('') +
      '<div class="s-foot">Walk away to leave</div>';
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
      try {
        localStorage.setItem('solcity.outfit', JSON.stringify(this.outfit));
      } catch {}
      this.applyOutfit();
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
