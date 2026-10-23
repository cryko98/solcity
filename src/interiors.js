// Interiors for the story cutscenes, built far outside the island (beyond the fog):
//   cafe        Rosa's cafe in Little Havana: checkered floor, counter, tables, neon
//   office      Vince's office in a dock warehouse: desk, crates, hanging lamp
//   lawoffice   Diaz's law office Downtown: walnut desk, law books, blinds, a banker's lamp
//   penthouse   Zara's penthouse over South Beach: skyline window, DaCity screens, sofas, bar
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

  // ------------------------------------------------------------- Diaz's law office Downtown
  {
    const panel = std({ map: planks('#3a2216'), roughness: 0.55 });
    panel.map.repeat.set(3, 1);
    const r = room('lawoffice', 1560, 8, 7, 3.2, {
      wall: panel, wall2: std({ color: 0xe8e0cf, roughness: 0.9 }),
      ceiling: std({ color: 0xf2efe8, roughness: 0.95 }), floor: std({ color: 0x5a1e22, roughness: 0.95 }),
    });
    const walnut = std({ map: planks('#4a2a18'), roughness: 0.4 });
    const leather = std({ color: 0x1e1410, roughness: 0.4 });
    const brass = std({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 });
    const paper = std({ color: 0xf2eee2, roughness: 0.9 });
    // the desk, her chair behind it, a client's chair in front
    r.box(walnut, 2.2, 0.06, 1.0, 0, 0.74, 0.6);
    r.box(walnut, 2.1, 0.7, 0.06, 0, 0.04, 0.12);
    r.box(walnut, 0.06, 0.74, 0.95, -1.05, 0, 0.6);
    r.box(walnut, 0.06, 0.74, 0.95, 1.05, 0, 0.6);
    r.chair(leather, 0, 1.45, Math.PI, brass);
    r.box(leather, 0.52, 0.75, 0.08, 0, 0.95, 1.7);
    r.chair(leather, 0, -0.45, 0, brass);
    // on the desk: files, a banker's lamp, a pen set
    r.box(paper, 0.3, 0.02, 0.4, 0.45, 0.8, 0.5, 0.25);
    r.box(std({ color: 0xb8925a, roughness: 0.9 }), 0.32, 0.05, 0.42, 0.42, 0.82, 0.48, 0.2);
    r.cyl(brass, 0.07, 0.09, 0.02, -0.65, 0.8, 0.75);
    r.cyl(brass, 0.012, 0.012, 0.3, -0.65, 0.82, 0.75, 6);
    r.box(std({ color: 0x1f6a3a, emissive: 0x2a5a30, emissiveIntensity: 0.4, roughness: 0.3 }), 0.34, 0.1, 0.14, -0.65, 1.1, 0.75);
    // bookshelves along the back wall, the spines in law-book colours
    const shelf = std({ map: planks('#2c180e'), roughness: 0.6 });
    const spines = [0x5a1a1a, 0x1c2a4a, 0x2a3a22, 0x6a4a1a, 0x3a1a2a].map((c) => std({ color: c, roughness: 0.7 }));
    for (const x of [-2.6, 2.6]) {
      r.box(shelf, 1.6, 2.4, 0.4, x, 0, 3.25);
      for (let k = 0; k < 4; k++) {
        let bx = x - 0.7;
        while (bx < x + 0.68) {
          const w = 0.05 + ((bx * 97 + k * 13) % 0.04);
          r.box(spines[Math.floor(Math.abs(bx * 31 + k * 7)) % spines.length], w, 0.32, 0.26, bx + w / 2, 0.15 + k * 0.58, 3.12);
          bx += w + 0.005;
        }
      }
    }
    // a window with the blinds half open, daylight behind them
    const day = std({ color: 0xfff4dc, emissive: 0xffe6b0, emissiveIntensity: 1.2, roughness: 1 });
    r.box(day, 0.02, 1.4, 2.2, 3.98, 0.9, -0.6);
    for (let k = 0; k < 14; k++) r.box(paper, 0.03, 0.04, 2.2, 3.94, 0.92 + k * 0.1, -0.6);
    // diplomas behind her chair, a plant in the corner
    for (const x of [-0.5, 0.5]) {
      r.box(brass, 0.5, 0.38, 0.03, x, 1.75, 3.47);
      r.box(paper, 0.42, 0.3, 0.02, x, 1.79, 3.45);
    }
    r.cyl(std({ color: 0x2a2a2a, roughness: 0.6 }), 0.22, 0.18, 0.45, -3.4, 0, -2.9);
    r.box(std({ color: 0x2f5a2a, roughness: 0.8 }), 0.5, 0.9, 0.5, -3.4, 0.45, -2.9, 0.6);
    r.lights.push(r.bulb(0, 2.75, 0.4, std({ color: 0xd8c8a0, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide })));
    // sit: Diaz behind the desk, Nico in the client's chair; stand: by the window
    r.arr.sit = { C: { ...r.world(0, 1.45), sit: true }, P: { ...r.world(0, -0.45), sit: true } };
    r.arr.stand = { C: { ...r.world(2.4, -0.4), sit: false }, P: { ...r.world(1.4, 0.4), sit: false } };
    r.home = r.world(2.4, -0.4);
  }

  // ------------------------------------------------------------- Zara's penthouse above South Beach
  {
    const marble = std({ map: checker('#f2f0ec', '#e4e1da', 4), roughness: 0.18, metalness: 0.05 });
    marble.map.repeat.set(3, 3);
    const r = room('penthouse', 1640, 13, 10, 3.6, {
      wall: std({ color: 0xf4f1ec, roughness: 0.8 }), wall2: std({ color: 0x23262c, roughness: 0.7 }),
      ceiling: std({ color: 0xfafafa, roughness: 0.9 }), floor: marble,
    });
    const white = std({ color: 0xf2efe8, roughness: 0.75 });
    const black = std({ color: 0x15161a, roughness: 0.4, metalness: 0.3 });
    const gold = std({ color: 0xd8b04a, roughness: 0.3, metalness: 0.9 });
    const glass = std({ color: 0x9fc8d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
    // the night skyline through the glass wall behind Zara
    const sky = document.createElement('canvas');
    sky.width = 512;
    sky.height = 128;
    {
      const g = sky.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, '#1a1036');
      grd.addColorStop(0.6, '#c2457a');
      grd.addColorStop(1, '#ffb36b');
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 128);
      for (let x = 0; x < 512; x += 14 + ((x * 7) % 11)) {
        const h = 30 + ((x * 13) % 70);
        g.fillStyle = '#0d0b1a';
        g.fillRect(x, 128 - h, 12, h);
        g.fillStyle = 'rgba(255,220,140,.8)';
        for (let y = 128 - h + 4; y < 124; y += 7) if ((x + y) % 3) g.fillRect(x + 3, y, 2, 2);
      }
    }
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const view = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 3.0), std({ map: skyTex, emissiveMap: skyTex, emissive: 0xffffff, emissiveIntensity: 1.1 }));
    view.position.set(0, FLOOR + 1.75, 4.97);
    view.rotation.y = Math.PI;
    r.group.add(view);
    for (let x = -6; x <= 6; x += 2.4) r.box(black, 0.08, 3.6, 0.08, x, 0, 4.92); // window mullions
    // a wall of trading screens: the DaCity chart going up
    const scr = document.createElement('canvas');
    scr.width = 256;
    scr.height = 160;
    {
      const g = scr.getContext('2d');
      g.fillStyle = '#071018';
      g.fillRect(0, 0, 256, 160);
      g.strokeStyle = 'rgba(80,140,160,.25)';
      for (let y = 20; y < 160; y += 20) g.strokeRect(0, y, 256, 0.5);
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0, y = 130; x <= 256; x += 8) {
        y = Math.max(28, y - 3 + Math.sin(x * 0.21) * 9);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.font = 'bold 22px Arial';
      g.fillText('DACITY', 10, 24);
    }
    const scrTex = new THREE.CanvasTexture(scr);
    scrTex.colorSpace = THREE.SRGBColorSpace;
    const scrMat = std({ map: scrTex, emissiveMap: scrTex, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3 });
    for (const [z, y] of [[-2.2, 1.4], [-0.6, 1.4], [-2.2, 2.4], [-0.6, 2.4]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.92), scrMat);
      s.position.set(-6.44, FLOOR + y, z);
      s.rotation.y = Math.PI / 2;
      r.group.add(s);
      r.box(black, 0.04, 1.0, 1.58, -6.47, y - 0.5, z);
    }
    // two white sofas facing over a glass table
    const sofa = (x, z, yaw) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      r.box(white, 2.2, SEAT_Y, 0.9, x, 0, z, yaw);
      r.box(white, 2.2, 0.55, 0.22, x - fx * 0.42, SEAT_Y, z - fz * 0.42, yaw);
      for (const s of [-1, 1]) r.box(white, 0.2, 0.28, 0.9, x + s * 1.05 * fz, SEAT_Y, z - s * 1.05 * fx, yaw);
    };
    sofa(0, 1.47, Math.PI); // front edge a thigh's length ahead of the sitter, like a chair
    sofa(0, -1.47, 0);
    r.box(glass, 1.4, 0.04, 0.8, 0, 0.4, 0);
    for (const [x, z] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]]) r.box(gold, 0.03, 0.4, 0.03, x, 0, z);
    r.cyl(gold, 0.04, 0.035, 0.24, 0.3, 0.44, 0.1, 10); // champagne
    r.cyl(glass, 0.03, 0.02, 0.14, -0.2, 0.44, -0.1, 8);
    // a bar along the east wall
    r.box(black, 0.7, 1.05, 4, 5.6, 0, -1.5);
    r.box(gold, 0.8, 0.05, 4.1, 5.6, 1.05, -1.5);
    for (let i = 0; i < 9; i++) r.cyl(i % 2 ? gold : glass, 0.04, 0.04, 0.28, 6.2, 1.5, -3.2 + i * 0.42, 8);
    r.box(black, 0.3, 0.05, 4, 6.2, 1.45, -1.5);
    r.lights.push(r.bulb(0, 3.1, 0, gold), r.bulb(4.6, 3.1, -1.5, gold), r.bulb(-4.6, 3.1, -1.4, gold));
    r.arr.sit = { C: { ...r.world(0, 1.25), sit: true }, P: { ...r.world(0, -1.25), sit: true } };
    r.arr.stand = { C: { ...r.world(-3.2, 3.2), sit: false }, P: { ...r.world(-2.4, 2.0), sit: false } };
    r.home = r.world(-3.2, 3.2);
  }
  return rooms;
}
