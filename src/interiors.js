// Interiors for the story cutscenes, built far outside the island (beyond the fog):
//   cafe        Rosa's cafe in Little Havana: checkered floor, counter, tables, neon
//   office      Vince's office in a dock warehouse: desk, crates, hanging lamp
//   interview   an interview room at the precinct: steel table, mirror, one bulb
// Each room returns where its light bulbs are (the Environment lights them) and the
// spots where the contact and the player sit or stand for the 'sit' and 'stand' scenes.
import * as THREE from 'three';
import * as TX from './textures.js';

const FLOOR = -0.03; // ground level off the island (see city.groundHeight)
export const SEAT_Y = 0.47;

export function checker(a, b, n = 8) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? a : b;
    g.fillRect(i * s, j * s, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function planks(base) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = `rgba(0,0,0,${0.08 + ((y / 32) % 3) * 0.04})`;
    g.fillRect(0, y, 256, 30);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, y + 30, 256, 2);
    g.fillRect(((y * 37) % 200) + 20, y, 2, 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildInteriors(scene) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const rooms = {};

  const room = (name, ox, W, D, H, mats) => {
    const g = new THREE.Group();
    g.position.set(ox, 0, 1400);
    scene.add(g);
    // the shell: a box seen from the inside (faces: +x, -x, ceiling, floor, +z, -z)
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [mats.wall, mats.wall, mats.ceiling, mats.floor, mats.wall2 || mats.wall, mats.wall2 || mats.wall]);
    shell.material.forEach((m) => (m.side = THREE.BackSide));
    shell.position.y = FLOOR + H / 2;
    shell.receiveShadow = shell.castShadow = true; // the walls and roof keep the sun out
    g.add(shell);
    const box = (m, w, h, d, x, y, z, ry = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, FLOOR + y + h / 2, z);
      b.rotation.y = ry;
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      return b;
    };
    const cyl = (m, r0, r1, h, x, y, z, seg = 16) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
      c.position.set(x, FLOOR + y + h / 2, z);
      c.castShadow = c.receiveShadow = true;
      g.add(c);
      return c;
    };
    const chair = (m, x, z, yaw, legs = m) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      box(m, 0.46, 0.06, 0.46, x, SEAT_Y - 0.06, z, yaw);
      for (const [a, b] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
        box(legs, 0.04, SEAT_Y - 0.06, 0.04, x + a * fz + b * fx, 0, z - a * fx + b * fz, yaw);
      }
      // backrest behind the sitter (opposite the facing direction)
      box(m, 0.46, 0.5, 0.05, x - fx * 0.22, SEAT_Y, z - fz * 0.22, yaw);
    };
    const bulb = (x, y, z, shade) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe2a8, emissiveIntensity: 6 }));
      b.position.set(x, FLOOR + y, z);
      g.add(b);
      if (shade) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.26, 18, 1, true), shade);
        s.position.set(x, FLOOR + y + 0.1, z);
        g.add(s);
        box(shade, 0.015, H - y - 0.2, 0.015, x, y + 0.2, z);
      }
      return new THREE.Vector3(ox + x, FLOOR + y - 0.15, 1400 + z);
    };
    const world = (x, z) => ({ x: ox + x, z: 1400 + z });
    rooms[name] = { group: g, box, cyl, chair, bulb, world, lights: [], arr: {} };
    return rooms[name];
  };

  // ------------------------------------------------------------- Rosa's cafe
  {
    const floor = std({ map: checker('#e9e4d8', '#1e1e22'), roughness: 0.35 });
    floor.map.repeat.set(5, 4);
    const r = room('cafe', 1400, 11, 9, 3.3, {
      wall: std({ color: 0xe9dcc0, roughness: 0.85 }), wall2: std({ color: 0x3fa39a, roughness: 0.8 }),
      ceiling: std({ color: 0xf2ece0, roughness: 0.9 }), floor,
    });
    const red = std({ color: 0xb3202a, roughness: 0.5 });
    const chrome = std({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 });
    const wood = std({ map: planks('#6a4228'), roughness: 0.6 });
    const cream = std({ color: 0xf1ead8, roughness: 0.5 });
    // counter along the back wall with stools
    r.box(red, 6, 1.0, 0.7, 1.2, 0, 3.3);
    r.box(cream, 6.1, 0.06, 0.8, 1.2, 1.0, 3.3);
    for (let i = 0; i < 5; i++) {
      r.cyl(chrome, 0.04, 0.05, 0.68, -1.2 + i * 1.2, 0, 2.55);
      r.cyl(red, 0.2, 0.2, 0.09, -1.2 + i * 1.2, 0.68, 2.55);
    }
    // shelves with bottles behind the counter
    r.box(wood, 5.5, 0.05, 0.3, 1.2, 1.7, 4.3);
    r.box(wood, 5.5, 0.05, 0.3, 1.2, 2.2, 4.3);
    const glassMats = [0x2f7a3a, 0x8a3b1a, 0xd8c070, 0x5a2a6a].map((c) => std({ color: c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
    for (let i = 0; i < 18; i++) r.cyl(glassMats[i % 4], 0.04, 0.04, 0.26, -1.4 + i * 0.3, i % 2 ? 1.75 : 2.25, 4.3, 8);
    // the table where the talk happens, plus a few more
    for (const [tx, tz] of [[0, 0], [-3.4, -1.5], [3.4, -1.8]]) {
      r.cyl(chrome, 0.05, 0.25, 0.75, tx, 0, tz);
      r.cyl(cream, 0.55, 0.55, 0.05, tx, 0.75, tz, 24);
    }
    r.chair(red, 0, 0.82, Math.PI, chrome);
    r.chair(red, 0, -0.82, 0, chrome);
    r.chair(red, -3.4, -0.7, Math.PI, chrome);
    r.chair(red, 3.4, -2.6, 0, chrome);
    // coffee cups on the table
    r.cyl(cream, 0.045, 0.04, 0.09, 0.15, 0.8, 0.25, 10);
    r.cyl(cream, 0.045, 0.04, 0.09, -0.12, 0.8, -0.28, 10);
    // neon sign on the side wall
    const t = TX.sign('CAFE ROSA', '#ff6fa8');
    const sm = std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.5 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), sm);
    sign.position.set(-5.45, 2.2, 0.8);
    sign.rotation.y = Math.PI / 2;
    r.group.add(sign);
    r.lights.push(r.bulb(0, 2.5, 0, red), r.bulb(1.6, 2.6, 3.0, red), r.bulb(-3.4, 2.6, -1.5, red));
    // sit: both at the table; stand: by the counter
    r.arr.sit = { C: { ...r.world(0, 0.82), sit: true }, P: { ...r.world(0, -0.82), sit: true } };
    r.arr.stand = { C: { ...r.world(2.4, 2.3), sit: false }, P: { ...r.world(2.4, 0.9), sit: false } };
    r.home = r.world(2.4, 2.3);
  }

  // ------------------------------------------------------------- Vince's office in the warehouse
  {
    const conc = TX.concrete();
    conc.repeat.set(3, 3);
    const corr = TX.corrugated();
    corr.repeat.set(4, 1);
    const r = room('office', 1480, 12, 10, 4.2, {
      wall: std({ map: corr, color: 0x9aa3a8, roughness: 0.6, metalness: 0.4 }), wall2: std({ color: 0x6b5f52, roughness: 0.9 }),
      ceiling: std({ color: 0x3a3a3c, roughness: 0.9 }), floor: std({ map: conc, roughness: 0.9 }),
    });
    const desk = std({ map: planks('#4a2c18'), roughness: 0.5 });
    const leather = std({ color: 0x2a1a12, roughness: 0.45 });
    const metal = std({ color: 0x4d5257, roughness: 0.5, metalness: 0.7 });
    const crate = std({ map: planks('#9a7448'), roughness: 0.85 });
    const shade = std({ color: 0x2f4a3a, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
    // big desk, leather chair behind it, a chair for visitors in front
    r.box(desk, 2.2, 0.06, 1.0, 0, 0.74, 0.6);
    r.box(desk, 2.1, 0.7, 0.06, 0, 0.04, 0.12); // front panel (visitor side)
    r.box(desk, 0.06, 0.74, 0.95, -1.05, 0, 0.6);
    r.box(desk, 0.06, 0.74, 0.95, 1.05, 0, 0.6);
    r.chair(leather, 0, 1.45, Math.PI, metal);
    r.box(leather, 0.5, 0.7, 0.08, 0, 0.95, 1.7); // high back
    r.chair(leather, -1.6, -0.6, 0.4, metal);
    // things on the desk: lamp, papers, an ashtray
    r.box(std({ color: 0xf0ece0, roughness: 0.9 }), 0.3, 0.02, 0.4, 0.4, 0.8, 0.55, 0.3);
    r.cyl(metal, 0.08, 0.1, 0.03, -0.5, 0.8, 0.5);
    // crates and a filing cabinet
    for (const [x, z, s, y] of [[-4.5, 3.5, 1.2, 0], [-4.5, 3.5, 1.0, 1.2], [-3.2, 3.8, 1.2, 0], [4.6, 3.6, 1.3, 0], [4.4, -3.4, 1.1, 0], [4.6, 2.2, 1.0, 0]]) {
      r.box(crate, s, s, s, x, y, z, (x * 7) % 1);
    }
    r.box(metal, 0.6, 1.4, 0.6, -5.5, 0, -1.5);
    // a safe
    r.box(std({ color: 0x1c2a22, roughness: 0.35, metalness: 0.6 }), 0.8, 0.9, 0.7, 2.4, 0, 2.2);
    r.lights.push(r.bulb(0, 2.6, 0.3, shade), r.bulb(-3.8, 3.2, 2.5, shade));
    // sit: Vince behind the desk, Nico standing in front; stand: next to the safe
    r.arr.sit = { C: { ...r.world(0, 1.45), sit: true }, P: { ...r.world(0, -0.35), sit: false } };
    r.arr.stand = { C: { ...r.world(1.6, 1.4), sit: false }, P: { ...r.world(1.2, 0.0), sit: false } };
    r.home = r.world(1.6, 1.4);
  }

  // ------------------------------------------------------------- interview room at the precinct
  {
    const r = room('interview', 1560, 7, 7, 3, {
      wall: std({ color: 0x8c9590, roughness: 0.9 }), wall2: std({ color: 0x7c8580, roughness: 0.9 }),
      ceiling: std({ color: 0x55595a, roughness: 0.9 }), floor: std({ map: checker('#3a3c3e', '#4a4c4e', 10), roughness: 0.8 }),
    });
    const steel = std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
    const dark = std({ color: 0x2a2c30, roughness: 0.5, metalness: 0.4 });
    r.box(steel, 1.8, 0.05, 0.95, 0, 0.75, 0);
    for (const [x, z] of [[-0.85, -0.42], [0.85, -0.42], [-0.85, 0.42], [0.85, 0.42]]) r.box(steel, 0.05, 0.75, 0.05, x, 0, z);
    r.chair(dark, 0, 0.82, Math.PI);
    r.chair(dark, 0, -0.82, 0);
    // one-way mirror and a door
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), std({ color: 0x101418, roughness: 0.05, metalness: 0.9 }));
    mirror.position.set(3.45, 1.6, 0);
    mirror.rotation.y = -Math.PI / 2;
    r.group.add(mirror);
    r.box(std({ color: 0x5a4a3a, roughness: 0.7 }), 1.0, 2.1, 0.06, -1.8, 0, 3.45);
    // a file and a coffee cup on the table
    r.box(std({ color: 0xd8c08a, roughness: 0.9 }), 0.25, 0.02, 0.33, 0.3, 0.8, 0.15, 0.2);
    r.cyl(std({ color: 0xf2f2f2, roughness: 0.5 }), 0.045, 0.04, 0.1, -0.35, 0.8, -0.2, 10);
    r.lights.push(r.bulb(0, 2.35, 0, dark));
    r.arr.sit = { C: { ...r.world(0, 0.82), sit: true }, P: { ...r.world(0, -0.82), sit: true } };
    r.arr.stand = { C: { ...r.world(-1.4, 1.6), sit: false }, P: { ...r.world(-0.6, 0.5), sit: false } };
    r.home = r.world(-1.4, 1.6);
  }
  return rooms;
}
