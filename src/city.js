// Procedural GTA-style downtown: road grid, blocks with shops / mid-rises / towers,
// parks, street furniture, parked cars, traffic lights, plus collision + minimap data.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { colorFor } from './vehicles.js';
import * as W from './shared/world.mjs';

const NS_NAMES = ['Harbor Rd', 'Palm Ave', 'Ocean Dr', 'Coral Way', 'Sunset Blvd', 'Main St', 'Vine St', 'Cypress Ave', 'Union Ave', 'Seaside Ave', 'Bayview Rd'];
const EW_NAMES = ['Pier St', '1st St', 'Mission St', 'Grand Ave', 'Lake St', 'Market St', 'Elm St', 'Bay St', 'Pine St', 'Flamingo Rd', 'Canal St'];
const SHOPS = ['LIQUOR', 'PAWN SHOP', '24/7', 'TACOS', 'LAUNDRY', 'PIZZA', 'BAR', 'MOTEL', 'DONUTS', 'TATTOO',
  'PHARMACY', 'CHECKS CASHED', 'NAILS', 'AUTO PARTS', 'DINER', 'ARCADE', 'RECORDS', 'NOODLES', 'GYM', 'CLUB'];
const NEON = ['#ff3b6b', '#34e6ff', '#ffd23f', '#7cff5b', '#ff8a2b', '#d36bff'];
const CAR_COLORS = [0xb3202a, 0x1f4fa8, 0xe8e8e8, 0x1b1b1d, 0x8a8f96, 0xd9a21b, 0x2e6b3c, 0x5b2a86, 0xd8622a, 0x6fb7d9];
const CONTAINER_COLORS = [0xb8352a, 0x2f5f9e, 0x2e7d4f, 0xd28a1e, 0x8a8f96, 0x6b3f8e, 0x1f7f8a, 0xc9c4b8];
// which vehicles park in each district (model, weight)
const PARKED_MIX = {
  Downtown: [['sedan', 4], ['taxi', 3], ['coupe', 2], ['lux', 1], ['van', 1], ['bike', 1]],
  'South Beach': [['coupe', 3], ['sedan', 2], ['super', 1.5], ['lux', 1], ['taxi', 1], ['bike', 2]],
  'Little Havana': [['sedan', 5], ['taxi', 1.5], ['van', 1.5], ['bike', 2], ['coupe', 1]],
  'Old Harbor': [['van', 5], ['sedan', 3], ['bike', 1]],
  'Vinewood Hills': [['coupe', 3], ['super', 2.5], ['lux', 2.5], ['sedan', 1]],
};

const HALF_PI = Math.PI / 2;

function scaleUV(geo, su, sv, ou = 0, ov = 0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return geo;
}

// rotation that maps local +Z onto a face normal (nx, nz)
const faceYaw = (nx, nz) => Math.atan2(nx, nz);

export function buildCity(scene) {
  const rand = TX.rng(20261022);
  // the grid is shared with the reward server (src/shared/world.mjs)
  const { N, BLOCK, ROAD, SW, CURB, PITCH, SIZE, HALF, roadC, blockMin } = W;
  const PARKS = new Set(['4,3', '1,6', '6,8']);
  // blocks with a walk-in shop: one building's street face keeps a plain ground floor for it
  const SHOP_BLOCKS = new Set(W.SHOP_BRANCHES.map(([, , i, j]) => `${i},${j}`));
  let reserve = null; // the shop block being built, until its front is taken

  const city = { N, BLOCK, ROAD, SW, CURB, PITCH, SIZE, HALF, colliders: [], nightMats: [], wetMats: [], nightGlow: [], benches: [], shopFronts: {} };
  // the south (street) face of this building becomes the shop's: record it, dress nothing on it
  const takeFront = (nx, nz, cx, cz, w, d, h, glass = false) => {
    if (!reserve || nx !== 0 || nz !== -1 || city.shopFronts[reserve] || w < 9) return false;
    city.shopFronts[reserve] = { x: cx, z: cz - d / 2, w, top: CURB + h, glass };
    return true;
  };

  // ------------------------------------------------------------- materials
  const buckets = new Map();
  const add = (mat, geo) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };
  const std = (o) => new THREE.MeshStandardMaterial(o);

  const sidewalkMat = std({ map: TX.sidewalk(), roughness: 0.9 });
  const roofMat = std({ map: TX.roof(), roughness: 0.95 });
  const grassTex = TX.grass();
  grassTex.repeat.set(10, 10);
  const grassMat = std({ map: grassTex, roughness: 1 });
  const metalMat = std({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 });
  const stoneMat = std({ color: 0xbdb5a6, roughness: 0.85 });
  const woodMat = std({ color: 0x7a5232, roughness: 0.8 });
  const ventMat = std({ color: 0x9a9d9f, roughness: 0.6, metalness: 0.3 });

  const nightEmissive = (mat, day, night) => {
    mat.userData.day = day;
    mat.userData.night = night;
    mat.emissiveIntensity = day;
    city.nightMats.push(mat);
    return mat;
  };

  // walls darken softly toward the pavement, as the light under a building's foot does (ambient
  // occlusion for free: by height, in the material; the lit windows are left alone)
  const groundShade = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying float vGroundY;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 gpos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gpos = instanceMatrix * gpos;
        #endif
        vGroundY = (modelMatrix * gpos).y;`);
      sh.fragmentShader = 'varying float vGroundY;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.58, 1.0, smoothstep(0.1, 2.6, vGroundY));`);
    };
    mat.customProgramCacheKey = () => 'groundshade';
    return mat;
  };
  const facadeMat = (style, seed) => {
    const { map, emissive } = TX.facade({ ...style, seed });
    return nightEmissive(
      groundShade(std({ map, emissiveMap: emissive, emissive: 0xffffff, roughness: style.glass ? 0.22 : 0.85, metalness: style.glass ? 0.4 : 0 })),
      0, 0.55
    );
  };
  const pastel = [
    { wall: '#e8a99b' }, { wall: '#9fd3c1' }, { wall: '#f2c48f' }, { wall: '#d8c8a6', frame: '#8b795d' },
    { wall: '#c9d4e3' }, { wall: '#f0e1b8', frame: '#6f8f86' },
  ].map((s, i) => facadeMat(s, i * 31 + 1));
  const urban = [
    { wall: '#8e4b3b', frame: '#d8d0c0', brick: true }, { wall: '#6f3a30', frame: '#e3dccb', brick: true },
    { wall: '#9a9b97', frame: '#5d6266' }, { wall: '#7d7466', frame: '#d9d2c4' },
  ].map((s, i) => facadeMat(s, i * 53 + 7));
  const glassy = [
    { wall: '#24425a', frame: '#9fb0bd', glass: true, litChance: 0.35 }, { wall: '#2e5a55', frame: '#a7b9b6', glass: true },
    { wall: '#3a3f4a', frame: '#c9c9c9', glass: true }, { wall: '#5a4a3a', frame: '#d5c3a0', glass: true },
  ].map((s, i) => facadeMat(s, i * 71 + 13));
  const shopMats = [1, 2, 3, 4, 5].map((s) => {
    const { map, emissive } = TX.shopfront(s * 17);
    return nightEmissive(groundShade(std({ map, emissiveMap: emissive, emissive: 0xffffff, roughness: 0.4 })), 0.15, 0.85);
  });
  const awningMats = [['#c8202f', '#f2efe6'], ['#1d5ea8', '#f2efe6'], ['#2b7a3f', '#f2efe6'], ['#e2b33a', '#3a2a1a']].map(
    ([a, b]) => std({ map: TX.awning(a, b), roughness: 0.9, side: THREE.DoubleSide })
  );
  const signBody = std({ color: 0x1b1c20, roughness: 0.6 });
  const signCache = new Map();
  const signMat = (text, color) => {
    const k = text + color;
    if (!signCache.has(k)) {
      const t = TX.sign(text, color);
      signCache.set(k, nightEmissive(std({ map: t, emissiveMap: t, emissive: 0xffffff, roughness: 0.5 }), 0.55, 2.4));
    }
    return signCache.get(k);
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // ---- district materials
  const decoMats = [
    { wall: '#f6c9d0', frame: '#ffffff' }, { wall: '#a8e0d8', frame: '#ffffff' }, { wall: '#fde7a6', frame: '#ffffff' },
    { wall: '#c7d9f5', frame: '#ffffff' }, { wall: '#f8f4ec', frame: '#3fb6b0' }, { wall: '#e9c6f2', frame: '#ffffff' },
  ].map((s, i) => facadeMat(s, i * 37 + 101));
  const havanaMats = [
    { wall: '#e8b94a', frame: '#f4efe4' }, { wall: '#4fb3a4', frame: '#f4efe4' }, { wall: '#e0704f', frame: '#f4efe4' },
    { wall: '#8f63b0', frame: '#f4efe4' }, { wall: '#5d8fd0', frame: '#f4efe4' }, { wall: '#f2a0b6', frame: '#ffffff' },
  ].map((s, i) => facadeMat(s, i * 41 + 201));
  const lit = (mapPair, opts, night) => nightEmissive(groundShade(std({ map: mapPair.map, emissiveMap: mapPair.emissive, emissive: 0xffffff, ...opts })), 0, night);
  const warehouseMats = [
    { wall: '#7a3b2e' }, { wall: '#6a5a4a' }, { wall: '#7d8c93', metal: true }, { wall: '#5f7a64', metal: true }, { wall: '#9a8a6e', metal: true },
  ].map((o, i) => lit(TX.warehouse({ ...o, seed: i * 13 + 301 }), { roughness: o.metal ? 0.55 : 0.9, metalness: o.metal ? 0.35 : 0 }, 0.5));
  const villaMats = [
    { wall: '#f4efe4', shutter: '#3e6e8f' }, { wall: '#efe2c8', shutter: '#6b8e4e' }, { wall: '#f6f3ee', shutter: '#2e3b4c' }, { wall: '#e8d4bf', shutter: '#8a4b2f' },
  ].map((o, i) => lit(TX.villa({ ...o, seed: i * 17 + 401 }), { roughness: 0.85 }, 0.6));
  const rollerMat = std({ map: TX.rollerDoor(), roughness: 0.6, metalness: 0.3 });
  const trimWhite = std({ color: 0xf3f0e8, roughness: 0.7 });
  const fasciaMats = [0x24262b, 0x1f2a3a, 0x3a2224, 0xe9e3d6].map((c) => std({ color: c, roughness: 0.6 })); // sign boards
  const finMat = std({ color: 0xaab3bb, roughness: 0.3, metalness: 0.75 }); // tower fins and bands (brushed aluminium)
  const graniteMat = std({ color: 0x45474c, roughness: 0.5, metalness: 0.1 }); // tower podiums
  const poolMat = std({ color: 0x48c0e0, roughness: 0.04, metalness: 0.1 });
  const hedgeTex = TX.grass();
  hedgeTex.repeat.set(2, 1);
  const hedgeMat = std({ map: hedgeTex, color: 0x9fbf80, roughness: 1 });
  const concreteTex = TX.concrete();
  concreteTex.repeat.set(12, 12);
  const concreteMat = std({ map: concreteTex, roughness: 0.95 });
  const neonMats = NEON.map((c) => nightEmissive(std({ color: 0x333333, emissive: c, roughness: 0.4 }), 0.8, 3.2));
  const craneMat = std({ color: 0xe0a21b, roughness: 0.6, metalness: 0.4 });

  // the city is split into five districts with their own architecture
  const districtOf = (x, z) => {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return x < 0 && z < 0 ? 'Port of Sol' : 'Sol Beach';
    return Math.hypot(x, z) < HALF * 0.35 ? 'Downtown' : x < 0 ? (z < 0 ? 'Old Harbor' : 'Little Havana') : z < 0 ? 'Vinewood Hills' : 'South Beach';
  };

  // ------------------------------------------------------------- ground + roads
  // the city is an island: asphalt grid, a ring of beach (a container port in the north-west) and the sea
  const EXT = HALF + 52; // outer edge of beach / quay
  const asphaltTex = TX.asphalt();
  asphaltTex.repeat.set(SIZE / 12, SIZE / 12);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-HALF_PI), std({ map: asphaltTex, roughness: 0.95 }));
  ground.receiveShadow = true;
  city.wetMats.push(ground.material, sidewalkMat);
  scene.add(ground);
  // the sea bed: the beach flat to EXT, then shelving down under the water; along the quays of
  // the port (north-west) the water is deep right off the edge, so boats can tie up there
  const seaBed = (x, z) => {
    const out = Math.max(Math.abs(x), Math.abs(z)) - EXT;
    const beach = out > 0 ? Math.max(-12, -0.03 - out * 0.06) : -0.03;
    const hw = x < -EXT ? THREE.MathUtils.clamp((-40 - z) / 25, 0, 1) : 0;
    const hn = z < -EXT ? THREE.MathUtils.clamp(-x / 25, 0, 1) : 0;
    return THREE.MathUtils.lerp(beach, Math.min(beach, -6), Math.max(hw, hn));
  };
  // beach: flat to EXT, then slopes down under the water
  const sandTex = TX.sand();
  const SAND = EXT + 40;
  sandTex.repeat.set(SAND / 8, SAND / 8);
  const sandGeo = new THREE.PlaneGeometry(SAND * 2, SAND * 2, 64, 64).rotateX(-HALF_PI);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    sp.setY(i, seaBed(sp.getX(i), sp.getZ(i)));
  }
  sandGeo.computeVertexNormals();
  const sandMesh = new THREE.Mesh(sandGeo, std({ map: sandTex, roughness: 1 }));
  sandMesh.receiveShadow = true;
  scene.add(sandMesh);
  // container port quay (Port of Sol): raised concrete in the north-west corner
  const QUAY_Z1 = -40;
  const quayMat = std({ map: TX.concrete(), roughness: 0.95 });
  quayMat.map.repeat.set(20, 20);
  city.wetMats.push(quayMat);
  const quayParts = [
    [-EXT, -HALF, -EXT, QUAY_Z1], // west strip
    [-HALF, 0, -EXT, -HALF], // north strip
  ];
  for (const [ax, bx, az, bz] of quayParts) {
    const q = new THREE.Mesh(new THREE.BoxGeometry(bx - ax, 2.4, bz - az), quayMat);
    q.position.set((ax + bx) / 2, -1.2 + 0.01, (az + bz) / 2);
    q.receiveShadow = true;
    scene.add(q);
  }
  // the sea
  // The sea: a swell rolling across it (vertex waves), ripples on top (two layers of the normal
  // map drifting different ways), the sky reflected in it. Its colour comes from the depth of
  // the water, which is known exactly (the beach shelves down at 6 cm a metre): clear turquoise
  // over the sand where you can see the bottom, deep blue further out, and surf where it laps
  // onto the beach.
  const waterNormal = TX.waterNormal();
  waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  waterNormal.repeat.set(90, 90);
  // (Mount Sol's slopes run down into the sea: their heights, baked once the hill is built)
  const noHill = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
  noHill.unpackAlignment = 1;
  noHill.needsUpdate = true;
  const seaU = { uTime: { value: 0 }, uExt: { value: EXT }, uHill: { value: noHill }, uHillRect: { value: new THREE.Vector4(0, 0, 1, 1) } };
  const seaMat = std({ color: 0xffffff, roughness: 0.04, metalness: 0.32, normalMap: waterNormal, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true });
  seaMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seaU);
    const waves = `
      uniform float uTime;
      uniform float uExt;
      varying vec2 vSea;
      varying float vCrest;
      // three swells from different directions: height and its slope
      vec3 swell(vec2 p) {
        vec3 r = vec3(0.0);
        vec4 W[3];
        W[0] = vec4(normalize(vec2(1.0, 0.35)), 0.075, 19.0);
        W[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.05, 11.0);
        W[2] = vec4(normalize(vec2(0.8, -0.7)), 0.03, 6.5);
        for (int i = 0; i < 3; i++) {
          float k = 6.2831 / W[i].w, c = sqrt(9.8 / k);
          float ph = k * dot(W[i].xy, p) - k * c * uTime * 0.55;
          r.x += W[i].z * sin(ph);
          r.yz += W[i].z * k * cos(ph) * W[i].xy;
        }
        return r;
      }
`;
    sh.vertexShader = waves + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `vec3 sw = swell(position.xz);
        vec3 objectNormal = normalize(vec3(-sw.y, 1.0, -sw.z));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        transformed.y += sw.x;
        vSea = position.xz;
        vCrest = sw.x;`);
    sh.fragmentShader = `uniform float uTime;
      uniform float uExt;
      uniform sampler2D uHill;
      uniform vec4 uHillRect;
      varying vec2 vSea;
      varying float vCrest;
    ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        // depth of the water here: the same shelf as city.groundHeight
        float out_ = max(abs(vSea.x), abs(vSea.y)) - uExt;
        float bed = out_ > 0.0 ? max(-12.0, -0.03 - out_ * 0.06) : -0.03;
        float hw = vSea.x < -uExt ? clamp((-40.0 - vSea.y) / 25.0, 0.0, 1.0) : 0.0;
        float hn = vSea.y < -uExt ? clamp(-vSea.x / 25.0, 0.0, 1.0) : 0.0;
        bed = mix(bed, min(bed, -6.0), max(hw, hn));
        vec2 huv = (vSea - uHillRect.xy) / uHillRect.zw;
        if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) bed = max(bed, texture2D(uHill, huv).r * 14.0 - 12.0);
        float depth = max(0.0, -0.55 + vCrest - bed);
        vec3 shallow = vec3(0.05, 0.72, 0.72), mid = vec3(0.03, 0.5, 0.62), deep = vec3(0.01, 0.16, 0.34);
        vec3 sea = mix(shallow, mid, smoothstep(0.0, 1.6, depth));
        sea = mix(sea, deep, smoothstep(1.5, 9.0, depth));
        // surf: a band of foam where the waves run up the sand, broken up and moving
        float n = sin(vSea.x * 1.7 + uTime * 1.3) * sin(vSea.y * 1.9 - uTime * 1.1) + sin((vSea.x + vSea.y) * 0.9 + uTime * 2.0);
        // (a thin line where it laps the sand, and lines of surf rolling in behind it)
        float edge = 1.0 - smoothstep(0.0, 0.05 + 0.02 * n, depth);
        float rolls = smoothstep(0.82, 1.0, sin(depth * 22.0 - uTime * 2.2 + n * 0.8)) * (1.0 - smoothstep(0.05, 0.4, depth));
        float foam = edge * 0.8 + rolls * 0.55;
        // white crests on the tallest swells out at sea
        foam += smoothstep(0.1, 0.15, vCrest) * smoothstep(1.0, 4.0, depth) * 0.35 * (0.5 + 0.5 * n);
        diffuseColor.rgb = mix(sea, vec3(0.95, 0.97, 0.98), clamp(foam, 0.0, 1.0));
        diffuseColor.a = clamp(mix(0.5, 0.95, smoothstep(0.0, 3.0, depth)) + foam, 0.0, 1.0);`)
      // shallow water is mostly see-through: less of the pale sky mirrored in it
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= mix(0.35, 1.0, smoothstep(0.2, 3.0, depth));`)
      // a second, finer layer of ripples crossing the first
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n2 = texture2D(normalMap, vSea * 0.11 + vec2(-uTime * 0.021, uTime * 0.013)).xyz * 2.0 - 1.0;
          n2.xy *= normalScale * 0.8;
          normal = normalize(normal + tbn * n2 * 0.6);
        #endif`);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(EXT * 8, EXT * 8, 240, 240).rotateX(-HALF_PI), seaMat);
  water.position.y = -0.55;
  water.renderOrder = 1;
  scene.add(water);

  const marks = { white: [], yellow: [] };
  const mark = (color, x, z, sx, sz) => marks[color].push([x, z, sx, sz]);
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      const c = roadC(i);
      const s0 = blockMin(j), s1 = s0 + BLOCK, mid = s0 + BLOCK / 2;
      for (const vertical of [true, false]) {
        const put = (color, across, along, sa, sl) =>
          vertical ? mark(color, c + across, along, sa, sl) : mark(color, along, c + across, sl, sa);
        put('yellow', -0.13, mid, 0.12, BLOCK - 7);
        put('yellow', 0.13, mid, 0.12, BLOCK - 7);
        for (let a = s0 + 7; a < s1 - 6; a += 8) {
          put('white', -3.5, a + 1.5, 0.13, 3);
          put('white', 3.5, a + 1.5, 0.13, 3);
        }
        for (const end of [s0 + 1.8, s1 - 1.8]) {
          for (let k = -6; k <= 6; k++) put('white', k, end, 0.5, 2.8);
        }
        put('white', -ROAD / 4, s0 + 3.6, ROAD / 2 - 0.4, 0.4);
        put('white', ROAD / 4, s1 - 3.6, ROAD / 2 - 0.4, 0.4);
      }
    }
  }
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI);
  for (const [color, hex] of [['white', 0xe9e7e0], ['yellow', 0xe6b62e]]) {
    const list = marks[color];
    const m = new THREE.InstancedMesh(
      plane,
      std({ color: hex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      list.length
    );
    city.wetMats.push(m.material);
    const mat4 = new THREE.Matrix4();
    list.forEach(([x, z, sx, sz], k) => {
      mat4.makeScale(sx, 1, sz).setPosition(x, 0.015, z);
      m.setMatrixAt(k, mat4);
    });
    m.receiveShadow = true;
    scene.add(m);
  }

  // ------------------------------------------------------------- minimap canvas
  const MAP_PX = 2;
  const mapCanvas = document.createElement('canvas');
  const MAP_EXT = EXT + 30;
  mapCanvas.width = mapCanvas.height = Math.ceil(MAP_EXT * 2 * MAP_PX);
  const mg = mapCanvas.getContext('2d');
  mg.fillStyle = '#3d7d99';
  mg.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  const mrect = (x0, z0, w, d, col) => {
    mg.fillStyle = col;
    mg.fillRect((x0 + MAP_EXT) * MAP_PX, (z0 + MAP_EXT) * MAP_PX, w * MAP_PX, d * MAP_PX);
  };
  mrect(-EXT - 6, -EXT - 6, (EXT + 6) * 2, (EXT + 6) * 2, '#d8c79e');
  for (const [ax, bx, az, bz] of quayParts) mrect(ax, az, bx - ax, bz - az, '#8c8a86');
  mrect(-HALF, -HALF, SIZE, SIZE, '#7b828a');

  // ------------------------------------------------------------- colliders
  const box = (minX, maxX, minZ, maxZ, h) => city.colliders.push({ type: 'box', minX, maxX, minZ, maxZ, h });
  const circle = (x, z, r, h = 10) => {
    const c = { type: 'circle', x, z, r, h };
    city.colliders.push(c);
    return c;
  };

  // ------------------------------------------------------------- building pieces
  const walls = (mat, cx, cz, w, d, y0, h, roof = true, tw = 16, th = 14) => {
    const ou = Math.floor(rand() * 4) / 4;
    for (const [fw, ry, ox, oz] of [[w, 0, 0, d / 2], [w, Math.PI, 0, -d / 2], [d, HALF_PI, w / 2, 0], [d, -HALF_PI, -w / 2, 0]]) {
      const g = new THREE.PlaneGeometry(fw, h);
      scaleUV(g, fw / tw, h / th, ou, 0);
      g.rotateY(ry).translate(cx + ox, y0 + h / 2, cz + oz);
      add(mat, g);
    }
    if (roof) {
      const r = new THREE.PlaneGeometry(w, d).rotateX(-HALF_PI);
      scaleUV(r, w / 8, d / 8);
      add(roofMat, r.translate(cx, y0 + h, cz));
    }
  };
  const solid = (mat, x, y, z, sx, sy, sz) => add(mat, new THREE.BoxGeometry(sx, sy, sz).translate(x, y + sy / 2, z));

  // The facade textures are a grid: a floor every 3.5 m from the pavement (the window from 0.77 to
  // 2.84 m up it) and a window column every 4 m from a face's left edge (the wall between two
  // windows on the multiples of 4). Whatever goes on a face lines up with it, so no window is cut.
  // u: metres from the face's left edge (as its texture runs) for a point \`along\` the face
  const uSign = (nx, nz) => (nz > 0 || nx < 0 ? 1 : -1);
  const storefront = (cx, cz, w, d, nx, nz, withSign, h = 99) => {
    const fw = nx ? d : w;
    const wx = cx + nx * (w / 2), wz = cz + nz * (d / 2);
    const ry = faceYaw(nx, nz);
    const place = (g) => g.rotateY(ry).translate(wx, 0, wz);
    // the whole width of the ground floor (no sliver of the facade's own windows at the sides)
    const front = new THREE.PlaneGeometry(fw, 3.6);
    scaleUV(front, fw / 8, 1);
    add(pick(shopMats), place(front.translate(0, CURB + 1.8, 0.04)));
    if (!withSign) return null;
    const aw = Math.min(fw * 0.8, 10);
    const awn = new THREE.PlaneGeometry(aw, 1.7).rotateX(-HALF_PI + 0.36).translate(0, CURB + 3.5, 0.8);
    scaleUV(awn, aw / 3, 1);
    add(pick(awningMats), place(awn));
    // the sign on a fascia board over the shop: from the shopfront's top up past the first-floor
    // windows (to 6.6 m, between two rows of them), across whole window columns
    const sw = Math.min(fw * 0.7, 8);
    const top = Math.min(CURB + 6.6, CURB + h - 0.4), fh = top - (CURB + 3.6);
    const u0 = Math.max(0, Math.floor((fw / 2 - sw / 2 - 0.3) / 4) * 4), u1 = Math.min(fw, Math.ceil((fw / 2 + sw / 2 + 0.3) / 4) * 4);
    const mid = uSign(nx, nz) * ((u0 + u1) / 2 - fw / 2);
    faceBox(fasciaMats[Math.floor(hr(cx, cz + nx, 31) * fasciaMats.length)], cx, cz, w, d, nx, nz, mid, CURB + 3.6, u1 - u0, fh, 0.12);
    const sh = Math.min(sw / 4, fh - 0.5);
    const text = pick(SHOPS);
    const sm = signMat(text, pick(NEON));
    const s = new THREE.Mesh(new THREE.BoxGeometry(sh * 4, sh, 0.25), [signBody, signBody, signBody, signBody, sm, signBody]);
    const [sx, sz] = onFace(cx, cz, w, d, nx, nz, mid, 0.25);
    s.position.set(sx, CURB + 3.6 + fh / 2, sz);
    s.rotation.y = ry;
    s.castShadow = true;
    scene.add(s);
    return [mid - (u1 - u0) / 2, mid + (u1 - u0) / 2];
  };

  const rooftopJunk = (cx, cz, w, d, top) => {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const sx = 1.2 + rand() * 2, sz = 1.2 + rand() * 2;
      solid(ventMat, cx + (rand() - 0.5) * (w - sx - 1), top, cz + (rand() - 0.5) * (d - sz - 1), sx, 0.8 + rand(), sz);
    }
    // parapet
    for (const [x, z, sx, sz] of [[cx, cz - d / 2 + 0.15, w, 0.3], [cx, cz + d / 2 - 0.15, w, 0.3], [cx - w / 2 + 0.15, cz, 0.3, d], [cx + w / 2 - 0.15, cz, 0.3, d]]) {
      solid(stoneMat, x, top, z, sx, 0.7, sz);
    }
  };

  const streetSides = (lot, core) => {
    const street = [];
    if (lot.z0 <= core.z0 + 0.01) street.push([0, -1]);
    if (lot.z1 >= core.z1 - 0.01) street.push([0, 1]);
    if (lot.x0 <= core.x0 + 0.01) street.push([-1, 0]);
    if (lot.x1 >= core.x1 - 0.01) street.push([1, 0]);
    return street;
  };
  // ring of boxes around a footprint (cornices, parapets, ledges)
  const band = (mat, cx, cz, w, d, y, t, p) => {
    solid(mat, cx, y, cz - d / 2, w + 2 * p, t, 2 * p);
    solid(mat, cx, y, cz + d / 2, w + 2 * p, t, 2 * p);
    solid(mat, cx - w / 2, y, cz, 2 * p, t, d);
    solid(mat, cx + w / 2, y, cz, 2 * p, t, d);
  };
  // point on a building face: centre of the face + offset along it
  const onFace = (cx, cz, w, d, nx, nz, along, out = 0) => [
    cx + nx * (w / 2 + out) + Math.abs(nz) * along,
    cz + nz * (d / 2 + out) + Math.abs(nx) * along,
  ];
  const faceBox = (mat, cx, cz, w, d, nx, nz, along, y, len, h, depth) => {
    const [x, z] = onFace(cx, cz, w, d, nx, nz, along, depth / 2);
    solid(mat, x, y, z, nx ? depth : len, h, nx ? len : depth);
  };

  // ---------------------------------------------------- district buildings
  const districtBuilding = (lot, core, dist) => {
    const street = streetSides(lot, core);
    const x0 = lot.x0 + 0.6, x1 = lot.x1 - 0.6, z0 = lot.z0 + 0.6, z1 = lot.z1 - 0.6;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let h;
    if (dist === 'South Beach') {
      // art deco: pastel stucco, white cornices and speed lines, stepped crown, neon
      h = 7 + rand() * 8;
      walls(pick(decoMats), cx, cz, w, d, CURB, h);
      band(trimWhite, cx, cz, w, d, CURB, 0.55, 0.07);
      band(trimWhite, cx, cz, w, d, CURB + h - 0.6, 0.6, 0.2);
      for (let y = CURB + 3.9; y < CURB + h - 2; y += 3.5) band(trimWhite, cx, cz, w, d, y, 0.12, 0.08);
      const cw = w * (0.4 + rand() * 0.2), cd = d * (0.4 + rand() * 0.2);
      solid(trimWhite, cx, CURB + h, cz, cw, 1.4, cd);
      solid(trimWhite, cx, CURB + h + 1.4, cz, cw * 0.6, 0.9, cd * 0.6);
      const neon = pick(neonMats);
      for (const [nx, nz] of street) {
        const fw = nx ? d : w;
        faceBox(neon, cx, cz, w, d, nx, nz, 0, CURB + h - 0.95, fw * 0.92, 0.14, 0.1);
        if (takeFront(nx, nz, cx, cz, w, d, h)) continue;
        storefront(cx, cz, w, d, nx, nz, true, h);
      }
      mrect(x0, z0, w, d, '#7f6a78');
    } else if (dist === 'Little Havana') {
      // colourful two/three-storey shophouses with balconies and awnings
      h = 6.8 + rand() * 4.4;
      walls(pick(havanaMats), cx, cz, w, d, CURB, h);
      band(stoneMat, cx, cz, w, d, CURB, 0.5, 0.07);
      for (const [nx, nz] of street) acUnits(cx, cz, w, d, nx, nz, 2, CURB + h); // (over the shop signs)
      rooftopJunk(cx, cz, w, d, CURB + h);
      band(trimWhite, cx, cz, w, d, CURB + h - 0.35, 0.35, 0.12);
      if (rand() < 0.4) {
        // rooftop water tank
        const tx = cx + (rand() - 0.5) * (w - 4), tz = cz + (rand() - 0.5) * (d - 4);
        add(woodMat, new THREE.CylinderGeometry(1, 1, 1.8, 12).translate(tx, CURB + h + 2.1, tz));
        add(metalMat, new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6).translate(tx + 0.7, CURB + h + 0.6, tz + 0.7));
        add(metalMat, new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6).translate(tx - 0.7, CURB + h + 0.6, tz - 0.7));
      }
      for (const [nx, nz] of street) {
        if (takeFront(nx, nz, cx, cz, w, d, h)) continue;
        const fw = nx ? d : w;
        const [b0, b1] = storefront(cx, cz, w, d, nx, nz, true, h);
        const n = Math.max(1, Math.floor(fw / 6));
        for (let k = 0; k < n; k++) {
          const along = (k + 0.5) * (fw / n) - fw / 2;
          if (along + 1.3 > b0 && along - 1.3 < b1) continue; // (not on the sign board)
          faceBox(stoneMat, cx, cz, w, d, nx, nz, along, CURB + 4.1, 2.6, 0.14, 0.95);
          // railing along the balcony's outer edge
          const [rx, rz] = onFace(cx, cz, w, d, nx, nz, along, 0.92);
          solid(metalMat, rx, CURB + 4.24, rz, nx ? 0.05 : 2.6, 0.95, nx ? 2.6 : 0.05);
        }
      }
      mrect(x0, z0, w, d, '#7a6656');
    } else if (dist === 'Old Harbor') {
      // brick / ribbed-metal warehouses with roller doors and painted company signs
      h = 8 + rand() * 4.5;
      walls(pick(warehouseMats), cx, cz, w, d, CURB, h);
      band(stoneMat, cx, cz, w, d, CURB, 0.7, 0.06);
      // downpipes at the corners
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(metalMat, new THREE.CylinderGeometry(0.09, 0.09, h, 6).translate(cx + sx * (w / 2 + 0.1), CURB + h / 2, cz + sz * (d / 2 + 0.1)));
      for (let k = 0; k < 2; k++) solid(ventMat, cx + (rand() - 0.5) * (w - 3), CURB + h, cz + (rand() - 0.5) * (d - 3), 1.6, 0.9, 1.6);
      band(stoneMat, cx, cz, w, d, CURB + h, 0.5, 0.1);
      for (const [nx, nz] of street) {
        if (takeFront(nx, nz, cx, cz, w, d, h)) continue;
        const fw = nx ? d : w;
        const n = fw > 15 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const along = (k + 0.5) * (fw / n) - fw / 2;
          const [dx, dz] = onFace(cx, cz, w, d, nx, nz, along, 0.04);
          const g = new THREE.PlaneGeometry(4.2, 4.4).rotateY(faceYaw(nx, nz)).translate(dx, CURB + 2.2, dz);
          add(rollerMat, g);
          faceBox(metalMat, cx, cz, w, d, nx, nz, along, CURB + 4.4, 4.6, 0.3, 0.25);
        }
        if (rand() < 0.45) {
          const sw = Math.min(fw * 0.6, 10);
          const s = new THREE.Mesh(new THREE.BoxGeometry(sw, sw / 4, 0.2), [signBody, signBody, signBody, signBody,
            signMat(pick(['SOL SHIPPING', 'HARBOR FREIGHT', 'DOCK 7', 'COLD STORAGE', 'PIER SUPPLY', 'MARINE PARTS']), '#f2e6c4'), signBody]);
          const [sx, sz] = onFace(cx, cz, w, d, nx, nz, 0, 0.12);
          s.position.set(sx, CURB + h - 1.6, sz);
          s.rotation.y = faceYaw(nx, nz);
          scene.add(s);
        }
      }
      mrect(x0, z0, w, d, '#5e5650');
    }
    box(x0, x1, z0, z1, CURB + h);
  };

  // Vinewood Hills: villas with lawns, hedges and pools
  const villaBlock = (x0, z0) => {
    const core = { x0: x0 + SW, z0: z0 + SW, x1: x0 + BLOCK - SW, z1: z0 + BLOCK - SW };
    const S = core.x1 - core.x0, cxB = (core.x0 + core.x1) / 2, czB = (core.z0 + core.z1) / 2;
    add(grassMat, new THREE.PlaneGeometry(S, S).rotateX(-HALF_PI).translate(cxB, CURB + 0.01, czB));
    mrect(core.x0, core.z0, S, S, '#5b8f50');
    const half = S / 2;
    for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const lot = { x0: core.x0 + qx * half, x1: core.x0 + (qx + 1) * half, z0: core.z0 + qz * half, z1: core.z0 + (qz + 1) * half };
      const sx = qx ? 1 : -1, sz = qz ? 1 : -1; // outward (street) directions of this corner lot
      const lw = half - 7, ld = half - 8;
      const cx = (lot.x0 + lot.x1) / 2 + sx * 1.5, cz = (lot.z0 + lot.z1) / 2 + sz * 2.2;
      const two = rand() < 0.6;
      const h = two ? 7 : 3.6;
      walls(pick(villaMats), cx, cz, lw, ld, CURB, h, true, 8, 7);
      band(trimWhite, cx, cz, lw, ld, CURB + h, 0.55, 0.12);
      if (two && rand() < 0.5) {
        // roof terrace pergola
        solid(woodMat, cx, CURB + h + 2.4, cz, lw * 0.5, 0.12, ld * 0.5);
        for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid(trimWhite, cx + px * lw * 0.24, CURB + h, cz + pz * ld * 0.24, 0.2, 2.4, 0.2);
      }
      box(cx - lw / 2, cx + lw / 2, cz - ld / 2, cz + ld / 2, CURB + h);
      mrect(cx - lw / 2, cz - ld / 2, lw, ld, '#d9d2c4');
      // pool in the back yard (toward the block centre)
      const px = (lot.x0 + lot.x1) / 2 - sx * 4.5, pz = (lot.z0 + lot.z1) / 2 - sz * 5.5;
      add(stoneMat, new THREE.BoxGeometry(4.4, 0.06, 7.4).translate(px, CURB + 0.03, pz));
      add(poolMat, new THREE.PlaneGeometry(3.6, 6.6).rotateX(-HALF_PI).translate(px, CURB + 0.07, pz));
      mrect(px - 1.8, pz - 3.3, 3.6, 6.6, '#4fb8dc');
      // hedges along both street edges, with a gap for the path
      const ex = sx > 0 ? lot.x1 - 0.5 : lot.x0 + 0.5, ez = sz > 0 ? lot.z1 - 0.5 : lot.z0 + 0.5;
      const lx = (lot.x0 + lot.x1) / 2, lz = (lot.z0 + lot.z1) / 2;
      const gap0 = lx - 1.6, gap1 = lx + 1.6; // garden path to the front door
      const hedges = [
        [(lot.x0 + gap0) / 2, ez, gap0 - lot.x0, 0.8],
        [(gap1 + lot.x1) / 2, ez, lot.x1 - gap1, 0.8],
        [ex, lz - sz * 0.5, 0.8, half - 1],
      ];
      add(concreteMat, new THREE.PlaneGeometry(2.4, 5).rotateX(-HALF_PI).translate(lx, CURB + 0.02, ez - sz * 2.5));
      for (const [hx, hz, hw, hd] of hedges) {
        add(hedgeMat, new THREE.BoxGeometry(hw, 1.2, hd).translate(hx, CURB + 0.6, hz));
        box(hx - hw / 2, hx + hw / 2, hz - hd / 2, hz + hd / 2, CURB + 1.2);
      }
      for (let k = 0; k < 2; k++) {
        const tx = (lot.x0 + lot.x1) / 2 + (rand() - 0.5) * 6 - sx * 6, tz = (lot.z0 + lot.z1) / 2 + (rand() - 0.5) * 4 + sz * 1;
        props.palm.push([tx, tz, rand() * 6.28, 0.7 + rand() * 0.35]);
        circle(tx, tz, 0.3);
      }
    }
  };

  // Old Harbor container yard
  const containerYard = (x0, z0) => {
    const core = { x0: x0 + SW, z0: z0 + SW, x1: x0 + BLOCK - SW, z1: z0 + BLOCK - SW };
    const S = core.x1 - core.x0, cxB = (core.x0 + core.x1) / 2, czB = (core.z0 + core.z1) / 2;
    add(concreteMat, new THREE.PlaneGeometry(S, S).rotateX(-HALF_PI).translate(cxB, CURB + 0.01, czB));
    mrect(core.x0, core.z0, S, S, '#6d6a66');
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        if (rand() < 0.15) continue;
        const x = core.x0 + 6 + col * 12.5, z = core.z0 + 5 + row * 10;
        const levels = 1 + Math.floor(rand() * 3);
        for (let l = 0; l < levels; l++) props.container.push([x, CURB + l * 2.6, z, rand() < 0.5 ? 0 : 0.02, pick(CONTAINER_COLORS)]);
        box(x - 3.1, x + 3.1, z - 1.3, z + 1.3, CURB + levels * 2.6);
        mrect(x - 3, z - 1.2, 6, 2.4, '#8a6a52');
      }
    }
  };

  // ---------------------------------------------------- facade detail
  // The pieces that make a box read as a building: a plinth, floor ledges, a cornice, corner
  // pilasters, air-conditioners, fire escapes, rooftop tanks; on towers fins and bands. All of it
  // merges into the per-material meshes (no extra draw calls). It draws from its own random
  // numbers, hashed from the position, so the city's own sequence (lots, heights, shops) is unchanged.
  const hr = (x, z, k) => {
    const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const FLOOR = 3.5; // (the facade textures' floor height)
  // a slab tilted along a face (a fire-escape flight): from (a0, y0) to (a1, y1), out from the wall
  const flight = (cx, cz, w, d, nx, nz, a0, y0, a1, y1, out) => {
    const len = Math.hypot(a1 - a0, y1 - y0), ang = Math.atan2(y1 - y0, a1 - a0);
    const [x, z] = onFace(cx, cz, w, d, nx, nz, (a0 + a1) / 2, out);
    // (along the face is +x on the north / south walls and +z on the east / west ones)
    const g = new THREE.BoxGeometry(len, 0.07, 0.75).rotateZ(ang);
    if (nx) g.rotateY(-HALF_PI);
    add(metalMat, g.translate(x, (y0 + y1) / 2, z));
  };
  const fireEscape = (cx, cz, w, d, nx, nz, along, top) => {
    const fl = [];
    for (let y = CURB + FLOOR + 0.72; y < top - 1.8; y += FLOOR) fl.push(y); // (at the sills)
    fl.forEach((y, i) => {
      faceBox(metalMat, cx, cz, w, d, nx, nz, along, y, 3.6, 0.07, 1.15); // the landing
      const [rx, rz] = onFace(cx, cz, w, d, nx, nz, along, 1.13);
      solid(metalMat, rx, y, rz, nx ? 0.04 : 3.6, 0.95, nx ? 3.6 : 0.04); // its railing
      for (const e of [-1.78, 1.78]) {
        const [ex, ez] = onFace(cx, cz, w, d, nx, nz, along + e, 0.58);
        solid(metalMat, ex, y, ez, nx ? 1.15 : 0.04, 0.95, nx ? 0.04 : 1.15);
      }
      // the flight up to the next landing, switching back each floor
      if (i < fl.length - 1) {
        const dir = i % 2 ? 1 : -1;
        flight(cx, cz, w, d, nx, nz, along - dir * 1.4, y + 0.04, along + dir * 1.4, y + FLOOR, 0.6);
      }
    });
    // the drop ladder under the lowest landing
    if (fl.length) {
      const [lx, lz] = onFace(cx, cz, w, d, nx, nz, along + 1.4, 0.95);
      solid(metalMat, lx, fl[0] - 2.2, lz, nx ? 0.05 : 0.5, 2.2, nx ? 0.5 : 0.05);
    }
  };
  // window air-conditioners: in a window, on its sill, from floor `from` (0 = the ground floor) up
  const acUnits = (cx, cz, w, d, nx, nz, from, top) => {
    const fw = nx ? d : w, cols = Math.floor(fw / 4);
    for (let f = from; CURB + f * FLOOR + 2.84 < top - 0.8; f++) {
      for (let c = 0; c < cols; c++) {
        if (hr(cx + c * 3.1 + nx, cz + f * 1.7 + nz, 3) > 0.22) continue;
        const along = uSign(nx, nz) * (c * 4 + 2 - fw / 2);
        faceBox(ventMat, cx, cz, w, d, nx, nz, along, CURB + f * FLOOR + 0.77, 0.85, 0.5, 0.45);
      }
    }
  };
  const midDetail = (cx, cz, w, d, h, street, trim, brick) => {
    const top = CURB + h;
    band(stoneMat, cx, cz, w, d, CURB, 0.3, 0.07); // plinth (low: the shop doors start right above it)
    for (let y = CURB + 2 * FLOOR + 0.08; y < top - 1.6; y += FLOOR) band(trim, cx, cz, w, d, y, 0.14, 0.06); // floor ledges (between the window rows)
    band(trim, cx, cz, w, d, top - 0.75, 0.16, 0.12); // the cornice: a fillet and the crown moulding
    band(trim, cx, cz, w, d, top - 0.55, 0.55, 0.24);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid(trim, cx + (sx * w) / 2, CURB + 0.3, cz + (sz * d) / 2, 0.62, h - 0.85, 0.62); // pilasters
    if (h < 8) return;
    street.forEach(([nx, nz], i) => {
      acUnits(cx, cz, w, d, nx, nz, 2, top); // (over the shop signs)
      const fw = nx ? d : w;
      if (brick && i === 0 && fw > 9 && hr(cx, cz, 7) < 0.7) fireEscape(cx, cz, w, d, nx, nz, (hr(cz, cx, 9) - 0.5) * (fw - 6), top);
    });
    // up top: a stair housing, sometimes a water tank on legs
    solid(stoneMat, cx + (hr(cx, cz, 11) - 0.5) * (w - 5), top, cz + (hr(cz, cx, 12) - 0.5) * (d - 5), 2.6, 2.5, 2.6);
    if (hr(cx, cz, 13) < 0.45) {
      const tx = cx + (hr(cx, cz, 14) - 0.5) * (w - 4), tz = cz + (hr(cx, cz, 15) - 0.5) * (d - 4);
      add(woodMat, new THREE.CylinderGeometry(1.1, 1.1, 2, 12).translate(tx, top + 2.6, tz));
      add(metalMat, new THREE.ConeGeometry(1.2, 0.6, 12).translate(tx, top + 3.9, tz));
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid(metalMat, tx + px * 0.75, top, tz + pz * 0.75, 0.12, 1.6, 0.12);
    }
  };
  const towerDetail = (cx, cz, w, d, h, cw, cd, ch) => {
    const top = CURB + h;
    band(graniteMat, cx, cz, w, d, CURB, 0.5, 0.1);
    band(graniteMat, cx, cz, w, d, CURB + 3.6, 0.38, 0.45); // the canopy ledge over the ground floor
    // vertical fins up the glass on the mullions between window columns, and a band every four
    // floors on the dark strip under a row of windows
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const fw = nx ? d : w;
      for (let u = 8; u < fw - 2; u += 8) faceBox(finMat, cx, cz, w, d, nx, nz, uSign(nx, nz) * (u - fw / 2), CURB + 3.98, 0.16, h - 3.98, 0.32);
    }
    for (let y = CURB + 4 * FLOOR; y < top - 3; y += 4 * FLOOR) band(finMat, cx, cz, w, d, y, 0.4, 0.2);
    band(finMat, cx, cz, w, d, top - 0.2, 0.7, 0.28); // the roof edge
    band(finMat, cx, cz, cw, cd, top + ch - 0.2, 0.6, 0.22); // and the crown's
    for (let k = 0; k < 3; k++) {
      const a = hr(cx + k, cz, 21) * 6.28, r = 0.3 + hr(cx, cz + k, 22) * 0.12;
      const px = cx + Math.cos(a) * w * r, pz = cz + Math.sin(a) * d * r;
      if (Math.abs(px - cx) < cw / 2 + 1.5 && Math.abs(pz - cz) < cd / 2 + 1.5) continue; // not inside the crown
      solid(ventMat, px, top, pz, 2.2, 1.3, 1.6);
    }
  };

  const building = (lot, core, df) => {
    const street = streetSides(lot, core);

    let type = lot.kind;
    if (!type) {
      const r = rand();
      type = r < df * 0.45 ? 'tower' : r < 0.5 - df * 0.2 ? 'shop' : 'mid';
    }
    const inset = type === 'tower' ? 2 + rand() * 2 : 0.6;
    const x0 = lot.x0 + inset, x1 = lot.x1 - inset, z0 = lot.z0 + inset, z1 = lot.z1 - inset;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let h;
    if (type === 'tower') {
      h = 32 + rand() * 55 * (0.55 + df);
      const mat = pick(glassy);
      walls(mat, cx, cz, w, d, CURB, h);
      const cw = w * (0.55 + rand() * 0.2), cd = d * (0.55 + rand() * 0.2), ch = 6 + rand() * 12;
      walls(mat, cx, cz, cw, cd, CURB + h, ch);
      if (rand() < 0.6) solid(metalMat, cx, CURB + h + ch, cz, 0.3, 6 + rand() * 10, 0.3);
      towerDetail(cx, cz, w, d, h, cw, cd, ch);
      for (const [nx, nz] of street) {
        if (takeFront(nx, nz, cx, cz, w, d, h, true)) continue;
        const fw = nx ? d : w;
        const g = new THREE.PlaneGeometry(fw, 3.6);
        scaleUV(g, fw / 8, 1);
        g.translate(0, CURB + 1.8, 0.04).rotateY(faceYaw(nx, nz)).translate(cx + nx * (w / 2), 0, cz + nz * (d / 2));
        add(shopMats[2], g);
      }
      mrect(x0, z0, w, d, '#56666f');
    } else {
      h = type === 'shop' ? 5.4 + rand() * 2.6 : 10 + rand() * 16 + df * 18;
      const fam = type === 'shop' ? pastel : rand() < 0.5 ? urban : pastel;
      walls(pick(fam), cx, cz, w, d, CURB, h);
      rooftopJunk(cx, cz, w, d, CURB + h);
      midDetail(cx, cz, w, d, h, street, fam === urban ? stoneMat : trimWhite, fam === urban);
      for (const [nx, nz] of street) {
        if (takeFront(nx, nz, cx, cz, w, d, h)) continue;
        if (type === 'shop' || rand() < 0.65) storefront(cx, cz, w, d, nx, nz, type === 'shop' || rand() < 0.55, h);
      }
      mrect(x0, z0, w, d, type === 'shop' ? '#5c6870' : '#52616a');
    }
    box(x0, x1, z0, z1, CURB + h);
  };

  const splitLots = (c, df) => {
    const W = c.x1 - c.x0, D = c.z1 - c.z0;
    const r = rand();
    if (df > 0.5 && r < 0.5) return [{ ...c, kind: 'tower' }];
    if (r < 0.45) {
      const mx = c.x0 + W * (0.4 + rand() * 0.2), mz = c.z0 + D * (0.4 + rand() * 0.2);
      return [
        { x0: c.x0, z0: c.z0, x1: mx, z1: mz }, { x0: mx, z0: c.z0, x1: c.x1, z1: mz },
        { x0: c.x0, z0: mz, x1: mx, z1: c.z1 }, { x0: mx, z0: mz, x1: c.x1, z1: c.z1 },
      ];
    }
    // three strips, each split front/back so every lot touches a street
    const lots = [];
    const alongX = rand() < 0.5;
    for (let k = 0; k < 3; k++) {
      if (alongX) {
        const a = c.x0 + (W * k) / 3, b = c.x0 + (W * (k + 1)) / 3, m = c.z0 + D * (0.45 + rand() * 0.1);
        lots.push({ x0: a, x1: b, z0: c.z0, z1: m }, { x0: a, x1: b, z0: m, z1: c.z1 });
      } else {
        const a = c.z0 + (D * k) / 3, b = c.z0 + (D * (k + 1)) / 3, m = c.x0 + W * (0.45 + rand() * 0.1);
        lots.push({ z0: a, z1: b, x0: c.x0, x1: m }, { z0: a, z1: b, x0: m, x1: c.x1 });
      }
    }
    return lots;
  };

  // ------------------------------------------------------------- instanced props
  const props = { lamp: [], palm: [], light: [], hydrant: [], bin: [], car: [], container: [], umbrella: [] };
  const PALM_RATE = { Downtown: 0.4, 'South Beach': 1, 'Little Havana': 0.45, 'Old Harbor': 0, 'Vinewood Hills': 0.9 };
  const sidewalkProps = (x0, z0, dist) => {
    const sides = [
      [0, -1, (t) => [x0 + t, z0 + 0.8]], [0, 1, (t) => [x0 + t, z0 + BLOCK - 0.8]],
      [-1, 0, (t) => [x0 + 0.8, z0 + t]], [1, 0, (t) => [x0 + BLOCK - 0.8, z0 + t]],
    ];
    for (const [nx, nz, at] of sides) {
      for (const t of [9, 25, 41]) {
        const [x, z] = at(t);
        props.lamp.push([x, z, faceYaw(nx, nz)]);
        circle(x, z, 0.16);
      }
      for (const t of [17, 33]) {
        const [x, z] = at(t);
        if (rand() < PALM_RATE[dist]) {
          props.palm.push([x, z, rand() * 6.28, 0.8 + rand() * 0.45]);
          circle(x, z, 0.3);
        } else if (rand() < 0.3) {
          props.hydrant.push([x, z, circle(x, z, 0.22)]);
        } else if (rand() < 0.4) {
          const [bx, bz] = at(t + 2);
          props.bin.push([bx - nx * 0.3, bz - nz * 0.3, circle(bx - nx * 0.3, bz - nz * 0.3, 0.32)]);
        }
      }
    }
  };

  const park = (x0, z0) => {
    const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2, S = BLOCK - 2 * SW;
    add(grassMat, new THREE.PlaneGeometry(S, S).rotateX(-HALF_PI).translate(cx, CURB + 0.01, cz));
    add(sidewalkMat, scaleUV(new THREE.PlaneGeometry(4, S).rotateX(-HALF_PI), 1, S / 4).translate(cx, CURB + 0.02, cz));
    add(sidewalkMat, scaleUV(new THREE.PlaneGeometry(S, 4).rotateX(-HALF_PI), S / 4, 1).translate(cx, CURB + 0.02, cz));
    mrect(x0 + SW, z0 + SW, S, S, '#4f8a4f');
    mrect(cx - 2, z0 + SW, 4, S, '#9b9690');
    mrect(x0 + SW, cz - 2, S, 4, '#9b9690');
    // fountain
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.2, 0.7, 28, 1, true), stoneMat);
    ring.position.set(cx, CURB + 0.35, cz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4, 0.22, 8, 32).rotateX(HALF_PI), stoneMat);
    rim.position.set(cx, CURB + 0.7, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.95, 28).rotateX(-HALF_PI), std({ color: 0x3d8fb8, roughness: 0.08, metalness: 0.2 }));
    water.position.set(cx, CURB + 0.55, cz);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.4, 12), stoneMat);
    pillar.position.set(cx, CURB + 1.2, cz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.4, 0.4, 16), stoneMat);
    bowl.position.set(cx, CURB + 2.3, cz);
    for (const m of [ring, rim, water, pillar, bowl]) {
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    circle(cx, cz, 4.3, 1);
    mg.fillStyle = '#4aa3d8';
    mg.beginPath();
    mg.arc((cx + MAP_EXT) * MAP_PX, (cz + MAP_EXT) * MAP_PX, 4 * MAP_PX, 0, Math.PI * 2);
    mg.fill();
    // palms + benches
    for (let k = 0; k < 18; k++) {
      const x = cx + (rand() - 0.5) * (S - 4), z = cz + (rand() - 0.5) * (S - 4);
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      props.palm.push([x, z, rand() * 6.28, 0.85 + rand() * 0.5]);
      circle(x, z, 0.3);
    }
    for (const [bx, bz, rot] of [[cx - 2.8, cz - 10, 1], [cx + 2.8, cz + 10, 1], [cx - 10, cz + 2.8, 0], [cx + 10, cz - 2.8, 0]]) {
      const [sx, sz] = rot ? [0.6, 2.2] : [2.2, 0.6];
      solid(woodMat, bx, CURB + 0.42, bz, sx, 0.08, sz);
      const back = rot ? [bx + Math.sign(bx - cx) * 0.28, bz, 0.08, 2.2] : [bx, bz + Math.sign(bz - cz) * 0.28, 2.2, 0.08];
      solid(woodMat, back[0], CURB + 0.5, back[1], back[2], 0.45, back[3]);
      solid(metalMat, bx, CURB, bz, sx * 0.9, 0.42, sz * 0.9);
      box(bx - sx / 2, bx + sx / 2, bz - sz / 2, bz + sz / 2, CURB + 0.95);
      // where people sit: facing into the park, two places along the bench
      const fx = rot ? Math.sign(cx - bx) : 0, fz = rot ? 0 : Math.sign(cz - bz);
      city.benches.push({ x: bx - fx * 0.05, z: bz - fz * 0.05, yaw: Math.atan2(fx, fz), ax: rot ? 0 : 1, az: rot ? 1 : 0, y: CURB + 0.46, used: 0 });
    }
  };

  // ------------------------------------------------------------- blocks
  for (let bi = 0; bi < N; bi++) {
    for (let bj = 0; bj < N; bj++) {
      const x0 = blockMin(bi), z0 = blockMin(bj), cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
      const slab = new THREE.BoxGeometry(BLOCK, CURB, BLOCK);
      scaleUV(slab, BLOCK / 4, BLOCK / 4);
      add(sidewalkMat, slab.translate(cx, CURB / 2, cz));
      mrect(x0, z0, BLOCK, BLOCK, '#3b474e');
      const dist = districtOf(cx, cz);
      reserve = SHOP_BLOCKS.has(`${bi},${bj}`) ? `${bi},${bj}` : null;
      sidewalkProps(x0, z0, dist);
      if (PARKS.has(`${bi},${bj}`)) {
        park(x0, z0);
        continue;
      }
      const df = THREE.MathUtils.clamp(1 - Math.hypot(cx, cz) / (HALF * 0.8), 0, 1);
      const core = { x0: x0 + SW, z0: z0 + SW, x1: x0 + BLOCK - SW, z1: z0 + BLOCK - SW };
      mrect(core.x0, core.z0, core.x1 - core.x0, core.z1 - core.z0, '#34414a');
      if (dist === 'Vinewood Hills') villaBlock(x0, z0);
      else if (dist === 'Old Harbor' && rand() < 0.35 && !reserve) containerYard(x0, z0); // a shop block always gets buildings
      else if (dist === 'Old Harbor') {
        // fewer, bigger lots for warehouses
        const W = core.x1 - core.x0, alongX = rand() < 0.5, m = 0.45 + rand() * 0.1;
        const lots = alongX
          ? [{ ...core, x1: core.x0 + W * m }, { ...core, x0: core.x0 + W * m }]
          : [{ ...core, z1: core.z0 + W * m }, { ...core, z0: core.z0 + W * m }];
        for (const lot of lots) districtBuilding(lot, core, dist);
      } else if (dist === 'Downtown') for (const lot of splitLots(core, df)) building(lot, core, df);
      else for (const lot of splitLots(core, 0)) districtBuilding(lot, core, dist);
    }
  }

  // parked cars + traffic lights
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      const c = roadC(i), s0 = blockMin(j);
      for (const vertical of [true, false]) {
        for (const side of [-1, 1]) {
          for (let a = s0 + 7; a < s0 + BLOCK - 7; a += 6.5) {
            if (rand() > 0.12) continue;
            const across = c + side * (ROAD / 2 - 1.15);
            const along = a + rand() * 0.6;
            const [x, z] = vertical ? [across, along] : [along, across];
            const yaw = vertical ? (side > 0 ? Math.PI : 0) : side > 0 ? HALF_PI : -HALF_PI;
            const mix = PARKED_MIX[districtOf(x, z)] || PARKED_MIX.Downtown;
            let r = rand() * mix.reduce((s, m) => s + m[1], 0), model = mix[0][0];
            for (const [m, wgt] of mix) if ((r -= wgt) <= 0) { model = m; break; }
            props.car.push({ x, z, yaw, color: colorFor(model, pick(CAR_COLORS)), model });
          }
        }
      }
    }
  }
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const ix = roadC(i), iz = roadC(j);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = ix + sx * (ROAD / 2 + 0.6), z = iz + sz * (ROAD / 2 + 0.6);
          if (Math.abs(x) > HALF - ROAD || Math.abs(z) > HALF - ROAD) continue;
          const axisZ = sx * sz > 0;
          props.light.push([x, z, axisZ ? faceYaw(0, sz) : faceYaw(sx, 0), axisZ, circle(x, z, 0.14)]);
        }
      }
    }
  }

  // ------------------------------------------------------------- port: container stacks + gantry cranes
  const stackRows = (ax, bx, az, bz) => {
    for (let x = ax + 6; x < bx - 6; x += 7.2) {
      for (let z = az + 8, row = 0; z < bz - 6; z += 3.1, row++) {
        if (row % 5 === 4 || rand() < 0.12) continue; // straddle-carrier lanes
        const levels = 1 + Math.floor(rand() * 3.4);
        for (let l = 0; l < levels; l++) props.container.push([x, l * 2.6, z, (rand() - 0.5) * 0.03, pick(CONTAINER_COLORS)]);
        box(x - 3.05, x + 3.05, z - 1.25, z + 1.25, levels * 2.6);
        mrect(x - 3, z - 1.2, 6, 2.4, '#8a6a52');
      }
    }
  };
  stackRows(-EXT + 22, -HALF - 6, -EXT + 4, QUAY_Z1 - 4);
  stackRows(-HALF + 30, -10, -EXT + 18, -HALF - 6);
  for (const cz of [-EXT + 30, -EXT + 80, -EXT + 130, -EXT + 180]) {
    const cx = -EXT + 6, top = 32;
    for (const [lx, lz] of [[-5, -6], [5, -6], [-5, 6], [5, 6]]) {
      solid(craneMat, cx + lx, 0, cz + lz, 0.9, top, 0.9);
      circle(cx + lx, cz + lz, 0.7, top);
    }
    solid(craneMat, cx, top, cz - 6, 14, 1.4, 1.2);
    solid(craneMat, cx, top, cz + 6, 14, 1.4, 1.2);
    solid(craneMat, cx - 14, top + 1.4, cz, 44, 1.6, 2.2); // boom reaching out over the water
    solid(metalMat, cx + 2, top + 3, cz, 6, 3.2, 4); // machinery house
    solid(metalMat, cx - 10, top - 4, cz, 2.4, 3.6, 2.4); // trolley + spreader
    mrect(cx - 7, cz - 7, 14, 14, '#c9921c');
  }
  // ------------------------------------------------------------- beach: palms, umbrellas, lifeguard towers
  const onQuay = (x, z) => quayParts.some(([ax, bx, az, bz]) => x > ax - 4 && x < bx + 4 && z > az - 4 && z < bz + 4);
  const onQuayDeck = (x, z) => quayParts.some(([ax, bx, az, bz]) => x > ax - 0.2 && x < bx + 0.2 && z > az - 0.2 && z < bz + 0.2);
  for (let a = -EXT + 10; a < EXT - 10; a += 16) {
    for (const [x, z] of [[a, HALF + 7], [a, -HALF - 7], [HALF + 7, a], [-HALF - 7, a]]) {
      if (onQuay(x, z) || rand() < 0.3) continue;
      props.palm.push([x, z, rand() * 6.28, 0.85 + rand() * 0.4]);
      circle(x, z, 0.3);
    }
  }
  for (let k = 0; k < 70; k++) {
    // umbrellas on the south and east beaches
    const south = rand() < 0.65;
    const x = south ? -HALF + 40 + rand() * (SIZE - 20) : HALF + 14 + rand() * (EXT - HALF - 20);
    const z = south ? HALF + 14 + rand() * (EXT - HALF - 20) : -HALF + 60 + rand() * (SIZE - 70);
    props.umbrella.push([x, z, rand() * 6.28, pick([0xe0463c, 0x2f7fd0, 0xf2c14e, 0x3fb68a, 0xffffff]), circle(x, z, 0.15, 2.3)]);
  }
  for (const x of [-120, -30, 60, 150, 230]) {
    const z = HALF + 26;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid(woodMat, x + lx * 1.1, -0.03, z + lz * 1.1, 0.2, 2.6, 0.2);
    solid(trimWhite, x, 2.55, z, 3, 2.1, 3);
    solid(neonMats[0], x, 4.65, z, 3.6, 0.25, 3.6);
    box(x - 1.5, x + 1.5, z - 1.5, z + 1.5, 4.9);
    mrect(x - 1.5, z - 1.5, 3, 3, '#e8e2d4');
  }

  // ------------------------------------------------------------- Pay 'n' Spray
  // a drive-in paint shop in the north-west corner of the Little Havana park
  {
    const x0 = blockMin(1), z0 = blockMin(6);
    const gx0 = x0 + 10, gx1 = x0 + 16.8, gz0 = z0 + 4.2, gz1 = z0 + 14.5, H = 4.4, T = 0.35;
    const gcx = (gx0 + gx1) / 2, gcz = (gz0 + gz1) / 2, GW = gx1 - gx0, GD = gz1 - gz0;
    // clear palms, bins and parked cars out of the way of the garage and its driveway
    const blocked = (x, z) => x > gx0 - 1.5 && x < gx1 + 1.5 && z > z0 - 8 && z < gz1 + 1.5;
    props.palm = props.palm.filter(([x, z]) => !blocked(x, z));
    props.bin = props.bin.filter(([x, z]) => !blocked(x, z));
    props.hydrant = props.hydrant.filter(([x, z]) => !blocked(x, z));
    props.car = props.car.filter((c) => !blocked(c.x, c.z));
    city.colliders = city.colliders.filter((c) => c.type !== 'circle' || !blocked(c.x, c.z));
    const wallMat = std({ color: 0xece4d2, roughness: 0.85 });
    const pink = std({ color: 0xe0407e, roughness: 0.5 });
    const teal = std({ color: 0x2fb5b0, roughness: 0.5 });
    solid(wallMat, gx0 + T / 2, CURB, gcz, T, H, GD);
    solid(wallMat, gx1 - T / 2, CURB, gcz, T, H, GD);
    solid(wallMat, gcx, CURB, gz1 - T / 2, GW, H, T);
    solid(wallMat, gcx, CURB + H - 1.0, gz0 + 0.2, GW, 1.0, 0.4); // lintel over the door
    solid(roofMat, gcx, CURB + H, gcz, GW + 0.6, 0.3, GD + 0.6);
    for (const [x, m] of [[gx0 - 0.02, pink], [gx1 + 0.02, pink]]) {
      solid(m, x, CURB + 1.0, gcz, T + 0.06, 0.35, GD + 0.02);
      solid(teal, x, CURB + 1.5, gcz, T + 0.06, 0.18, GD + 0.02);
    }
    // concrete floor
    add(concreteMat, new THREE.PlaneGeometry(GW - 2 * T, GD).rotateX(-HALF_PI).translate(gcx, CURB + 0.02, gcz));
    box(gx0, gx0 + T, gz0, gz1, H);
    box(gx1 - T, gx1, gz0, gz1, H);
    box(gx0, gx1, gz1 - T, gz1, H);
    const sm = signMat("SPRAY & CUSTOMS", '#ff4fa0');
    const sign = new THREE.Mesh(new THREE.BoxGeometry(GW - 0.4, 1.3, 0.25), [signBody, signBody, signBody, signBody, sm, signBody]);
    sign.position.set(gcx, CURB + H + 0.95, gz0 - 0.05);
    sign.rotation.y = Math.PI;
    sign.castShadow = true;
    scene.add(sign);
    // roller door: opened / closed by the game
    // its top edge hangs from the lintel; scale.y 0 = rolled up, 1 = shut
    const door = new THREE.Mesh(new THREE.PlaneGeometry(GW - 2 * T, H - 1.0).translate(0, -(H - 1.0) / 2, 0), Object.assign(rollerMat.clone(), { side: THREE.DoubleSide }));
    door.rotation.y = Math.PI;
    door.position.set(gcx, CURB + H - 1.0, gz0 + 0.25);
    door.scale.y = 0.03;
    door.receiveShadow = true;
    scene.add(door);
    mrect(gx0, gz0, GW, GD, '#d94a86');
    city.spray = {
      x: gcx, z: gcz + 1, door,
      entrance: { x: gcx, z: z0 - 3.5 },
      inside: (x, z) => x > gx0 + 0.8 && x < gx1 - 0.8 && z > gz0 + 2.6 && z < gz1 - 1.2,
    };
  }

  // ------------------------------------------------------------- Mount Sol + the SOL CITY sign
  // A big hill rising out of the sea behind Vinewood Hills (north-east). Its lower southern
  // slope is inside the island's bounds, so you can walk or drive up to the sign; the summit
  // is scenery. Heights are analytic so cars, people and the camera can follow the ground.
  const MC = { x: 175, z: -HALF - 118 }, MR = 116, MH = 118;
  let hillPatch = () => 0.5;
  // the height of the hill's mesh itself (its triangles), so feet and tyres sit on what you see
  let hillMesh = () => null;
  const bell = (d, r) => (d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r));
  const mountainRaw = (x, z) => {
    if (z > -HALF - 5) return 0;
    // a broad east-west ridge with a rounded summit and two lower shoulders
    let h = MH * Math.pow(bell(Math.hypot((x - MC.x) / 1.5, z - MC.z), MR), 1.15);
    h += 48 * bell(Math.hypot(x - (MC.x - 100), z - (MC.z + 18)), 80);
    h += 38 * bell(Math.hypot(x - (MC.x + 115), z - (MC.z - 8)), 75);
    if (h <= 0) return 0;
    // ridges and gullies running down the slopes
    const n = Math.sin(x * 0.05 + Math.sin(z * 0.035) * 2.4) * 0.55 + Math.sin(z * 0.07 + x * 0.025) * 0.45;
    h *= 1 + 0.1 * n * Math.min(1, h / 25);
    // never reaches into the street grid
    return h * THREE.MathUtils.smoothstep(-z, HALF + 6, HALF + 72);
  };
  // the landmark cuts through the haze: half the fog density on the hill and the sign
  const lightFog = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.25);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif`);
    };
    mat.customProgramCacheKey = () => 'lightfog';
    return mat;
  };
  // (the hill above sea level, as its mesh is built: cars follow the same triangles as feet)
  city.terrain = (x, z) => (z > -HALF - 5 ? 0 : Math.max(0, hillMesh(x, z) ?? 0));
  {
    const W = 2 * MR * 1.5 + 60, D = 2 * MR + 30, SX = 120, SZ = 76;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ).rotateX(-HALF_PI);
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + MC.x, z = pos.getZ(i) + MC.z;
      // (where the hill has run out it lies just under the beach and the sea bed)
      const raw = mountainRaw(x, z);
      pos.setXYZ(i, x, Math.max(raw > 0 ? raw - 0.6 : -99, seaBed(x, z) - 0.3), z);
    }
    // the sea shader needs the hill's shore: shallow water and surf where it runs into the sea
    {
      const NX = Math.ceil(W / 2), NZ = Math.ceil(D / 2), data = new Uint8Array(NX * NZ);
      for (let j = 0; j < NZ; j++) {
        for (let i = 0; i < NX; i++) {
          const x = MC.x - W / 2 + ((i + 0.5) / NX) * W, z = MC.z - D / 2 + ((j + 0.5) / NZ) * D;
          const raw = mountainRaw(x, z);
          // (the sea bed where there is no hill, so the two blend without a seam)
          const y = Math.max(raw > 0 ? raw - 0.6 : -12, seaBed(x, z));
          data[j * NX + i] = Math.round(THREE.MathUtils.clamp((y + 12) / 14, 0, 1) * 255);
        }
      }
      const tex = new THREE.DataTexture(data, NX, NZ, THREE.RedFormat);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      seaU.uHill.value = tex;
      seaU.uHillRect.value.set(MC.x - W / 2, MC.z - D / 2, W, D);
    }
    geo.computeVertexNormals();
    {
      const ys = pos.array, X0 = MC.x - W / 2, Z0 = MC.z - D / 2, dx = W / SX, dz = D / SZ, NX = SX + 1;
      const h = (i, j) => ys[(j * NX + i) * 3 + 1];
      hillMesh = (x, z) => {
        const fi = (x - X0) / dx, fj = (z - Z0) / dz;
        if (!(fi >= 0 && fj >= 0 && fi < SX && fj < SZ)) return null;
        const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
        // (the plane's two triangles per cell: i,j / i,j+1 / i+1,j and i,j+1 / i+1,j+1 / i+1,j)
        if (a + b <= 1) return h(i, j) + (h(i + 1, j) - h(i, j)) * a + (h(i, j + 1) - h(i, j)) * b;
        return h(i + 1, j + 1) + (h(i, j + 1) - h(i + 1, j + 1)) * (1 - a) + (h(i + 1, j) - h(i + 1, j + 1)) * (1 - b);
      };
    }
    const nrm = geo.attributes.normal, c = new THREE.Color();
    // California hills: golden dry grass, patches of olive chaparral, rock on the steep parts
    const sand = new THREE.Color(0xc7b48a), dry = new THREE.Color(0xb59a5c), scrub = new THREE.Color(0x6b6a38), bush = new THREE.Color(0x4a5329), rock = new THREE.Color(0x8c8172);
    const patch = (x, z) => 0.5 + 0.25 * Math.sin(x * 0.045 + Math.sin(z * 0.031) * 2) + 0.25 * Math.sin(z * 0.052 + Math.sin(x * 0.027) * 2.3);
    hillPatch = patch;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), up = nrm.getY(i), x = pos.getX(i), z = pos.getZ(i);
      const green = THREE.MathUtils.smoothstep(patch(x, z), 0.45, 0.75) * THREE.MathUtils.smoothstep(y, 4, 14);
      c.copy(sand).lerp(dry, THREE.MathUtils.smoothstep(y, 0.3, 3)).lerp(scrub, green * 0.8).lerp(bush, green * THREE.MathUtils.smoothstep(y, 20, 60) * 0.6);
      c.lerp(rock, THREE.MathUtils.smoothstep(1 - up, 0.3, 0.55) * 0.85);
      const v = 0.92 + ((i * 2654435761) % 1000) / 1000 * 0.16; // a little speckle
      col.push(c.r * v, c.g * v, c.b * v);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // a neutral grainy texture for detail: the colour comes from the vertex colours
    const ground = TX.sand();
    ground.repeat.set(70, 46);
    const hill = new THREE.Mesh(geo, lightFog(std({ map: ground, color: 0xffffff, vertexColors: true, roughness: 1 })));
    hill.receiveShadow = true;
    hill.castShadow = true;
    scene.add(hill);
    // scrub: one instanced mesh of squashed bushes on the gentler slopes
    const r2 = TX.rng(4242);
    const spots = [];
    // chaparral clumps, thicker in the green patches, a few on the dry grass
    for (let k = 0; k < 6000 && spots.length < 1300; k++) {
      const x = MC.x + (r2() - 0.5) * W, z = MC.z + (r2() - 0.5) * D;
      const h = mountainRaw(x, z) - 0.6;
      if (h < 2) continue;
      const p = THREE.MathUtils.smoothstep(hillPatch(x, z), 0.4, 0.8);
      if (r2() > 0.12 + p * 0.88) continue;
      spots.push([x, h, z, 0.6 + r2() * 1.5, r2() * 6.28, p]);
    }
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), lightFog(std({ color: 0xffffff, roughness: 1, flatShading: true })), spots.length);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), bc = new THREE.Color();
    const shades = [0x3c4524, 0x4a5229, 0x575a2e, 0x6a6436, 0x34401f];
    spots.forEach(([x, y, z, s, a, p], k) => {
      bushes.setMatrixAt(k, m4.compose(p4.set(x, y + s * 0.25, z), q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), s4.set(s, s * 0.55, s * (0.8 + 0.4 * ((k * 7) % 5) / 5))));
      bushes.setColorAt(k, bc.set(shades[(k * 13) % shades.length]).multiplyScalar(0.85 + 0.3 * p));
    });
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    scene.add(bushes);

    // the sign: chunky white block letters on posts, facing the city (south, +Z)
    const LW = 7.6, LH = 11.5, T = 1.75, GAP = 2.3, DEPTH = 0.4;
    const white = lightFog(nightEmissive(std({ color: 0xf4f2ec, emissive: 0xffffff, roughness: 0.55 }), 0, 0.45));
    const strut = std({ color: 0x3a3a3c, roughness: 0.7, metalness: 0.5 });
    // strokes per letter in a 0..1 box: [x0, y0, x1, y1] (rectangles) or ['d', x0, y0, x1, y1] (diagonal bar)
    const t = T / LW, th = T / LH;
    const GLYPHS = {
      S: [[0, 1 - th, 1, 1], [0, 0.5 - th / 2, 1, 0.5 + th / 2], [0, 0, 1, th], [0, 0.5, t, 1], [1 - t, 0, 1, 0.5]],
      O: [[0, 1 - th, 1, 1], [0, 0, 1, th], [0, 0, t, 1], [1 - t, 0, 1, 1]],
      L: [[0, 0, t, 1], [0, 0, 1, th]],
      C: [[0, 1 - th, 1, 1], [0, 0, 1, th], [0, 0, t, 1]],
      I: [[0.5 - t / 2, 0, 0.5 + t / 2, 1]],
      T: [[0, 1 - th, 1, 1], [0.5 - t / 2, 0, 0.5 + t / 2, 1]],
      Y: [['d', 0.06, 1, 0.5, 0.48], ['d', 0.94, 1, 0.5, 0.48], [0.5 - t / 2, 0, 0.5 + t / 2, 0.5]],
    };
    const text = 'SOL CITY';
    const total = text.length * LW + (text.length - 1) * GAP;
    const SZ0 = -HALF - 46; // just inside the island bounds
    let lx = MC.x - total / 2 - 25;
    const parts = [];
    for (const ch of text) {
      if (ch !== ' ') {
        const base = Math.min(mountainRaw(lx + 0.5, SZ0), mountainRaw(lx + LW - 0.5, SZ0)) - 0.6;
        for (const s of GLYPHS[ch]) {
          if (s[0] === 'd') {
            const [, x0, y0, x1, y1] = s;
            const ax = lx + x0 * LW, ay = base + 1.2 + y0 * LH, bx = lx + x1 * LW, by = base + 1.2 + y1 * LH;
            const len = Math.hypot(bx - ax, by - ay);
            const g = new THREE.BoxGeometry(T, len, DEPTH).rotateZ(-Math.atan2(bx - ax, by - ay)).translate((ax + bx) / 2, (ay + by) / 2, SZ0);
            parts.push(g);
          } else {
            const [x0, y0, x1, y1] = s;
            parts.push(new THREE.BoxGeometry((x1 - x0) * LW, (y1 - y0) * LH, DEPTH).translate(lx + ((x0 + x1) / 2) * LW, base + 1.2 + ((y0 + y1) / 2) * LH, SZ0));
          }
        }
        // two posts behind each letter, down into the slope
        for (const px of [lx + 1.2, lx + LW - 1.2]) {
          const g0 = mountainRaw(px, SZ0 - 1.2) - 0.6;
          const top = base + 1.2 + LH * 0.8;
          solid(strut, px, g0 - 1, SZ0 - 0.6, 0.25, top - g0 + 1, 0.25);
        }
        box(lx, lx + LW, SZ0 - 0.9, SZ0 + 0.3, base + 1.2 + LH);
        mrect(lx, SZ0 - 1, LW, 2, '#f4f2ec');
      }
      lx += LW + GAP;
    }
    const sign = new THREE.Mesh(mergeGeometries(parts), white);
    sign.castShadow = sign.receiveShadow = true;
    scene.add(sign);
    // the foothills on the minimap
    for (let x = MC.x - 240; x < MC.x + 240; x += 4) {
      for (let z = -MAP_EXT; z < -HALF; z += 4) {
        const h = mountainRaw(x, z);
        if (h < 1) continue;
        const k = Math.min(1, h / 60);
        mg.fillStyle = `rgb(${Math.round(196 - 90 * k)},${Math.round(180 - 70 * k)},${Math.round(130 - 60 * k)})`;
        mg.fillRect((x + MAP_EXT) * MAP_PX, (z + MAP_EXT) * MAP_PX, 4 * MAP_PX, 4 * MAP_PX);
      }
    }
  }

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const instanced = (geo, mat, list, fn, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => {
      fn(it, k);
      m.setMatrixAt(k, M);
    });
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const at = (x, y, z, yaw = 0, s = 1) => M.compose(P.set(x, y, z), Q.setFromAxisAngle(UP, yaw), Sc.set(s, s, s));

  // lamps
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 7, 8).translate(0, 3.5, 0),
    new THREE.BoxGeometry(0.08, 0.08, 1.7).translate(0, 6.95, 0.8),
    new THREE.CylinderGeometry(0.16, 0.2, 0.3, 8).translate(0, 0.15, 0),
  ]);
  instanced(lampGeo, metalMat, props.lamp, ([x, z, yaw]) => at(x, CURB, z, yaw));
  const lampHeadMat = nightEmissive(std({ color: 0xdedad0, emissive: 0xffd49a, roughness: 0.4 }), 0.1, 10);
  instanced(new THREE.BoxGeometry(0.34, 0.12, 0.6).translate(0, 6.87, 1.55), lampHeadMat, props.lamp, ([x, z, yaw]) => at(x, CURB, z, yaw), false);
  {
    const glow = (inner, outer) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, inner);
      gr.addColorStop(0.35, outer);
      gr.addColorStop(1, 'rgba(255,200,130,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    // warm pool of light on the pavement / road under each lamp head
    const poolMat = new THREE.MeshBasicMaterial({ map: glow('rgba(255,196,120,1)', 'rgba(255,180,105,.42)'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pools = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI), poolMat, props.lamp, ([x, z, yaw]) => {
      at(x + Math.sin(yaw) * 1.7, CURB + 0.02, z + Math.cos(yaw) * 1.7, yaw, 15);
    }, false);
    pools.receiveShadow = false;
    pools.renderOrder = 1;
    // soft halo around each lamp head
    const pos = new Float32Array(props.lamp.length * 3);
    props.lamp.forEach(([x, z, yaw], k) => pos.set([x + Math.sin(yaw) * 1.55, CURB + 6.75, z + Math.cos(yaw) * 1.55], k * 3));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const haloMat = new THREE.PointsMaterial({ map: glow('rgba(255,236,200,1)', 'rgba(255,205,140,.35)'), size: 2.6, sizeAttenuation: true,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    // up close a camera-facing halo fills the screen with glare: fade it out under the lamp
    haloMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvNear = smoothstep(4.0, 14.0, -mvPosition.z);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
        .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vNear; gl_FragColor.rgb *= vNear;\n#include <premultiplied_alpha_fragment>');
    };
    const halos = new THREE.Points(hg, haloMat);
    scene.add(halos);
    city.nightGlow.push({ mat: poolMat, k: 0.38 }, { mat: haloMat, k: 0.85 });
    // lamp head positions: the nearest ones get real point lights (Environment)
    city.lampHeads = props.lamp.map(([x, z, yaw]) => new THREE.Vector3(x + Math.sin(yaw) * 1.55, CURB + 6.6, z + Math.cos(yaw) * 1.55));
  }

  // palms
  const trunkTex = TX.bark();
  trunkTex.repeat.set(1, 3);
  instanced(
    new THREE.CylinderGeometry(0.17, 0.28, 9, 7).translate(0, 4.5, 0),
    std({ map: trunkTex, roughness: 0.95 }),
    props.palm,
    ([x, z, r, s]) => at(x, CURB, z, r, s)
  );
  const leafGeos = [];
  for (let k = 0; k < 9; k++) {
    const g = leafGeometry(4.3, 1.2);
    g.rotateX(-0.25 + (k % 3) * 0.18).rotateY((k / 9) * Math.PI * 2 + (k % 2) * 0.2);
    leafGeos.push(g);
  }
  const frondTex = TX.frond();
  instanced(
    mergeGeometries(leafGeos).translate(0, 8.9, 0),
    std({ map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }),
    props.palm,
    ([x, z, r, s]) => at(x, CURB, z, r, s)
  );

  // hydrants + bins
  const hydrants = instanced(
    mergeGeometries([
      new THREE.CylinderGeometry(0.13, 0.15, 0.6, 10).translate(0, 0.3, 0),
      new THREE.SphereGeometry(0.14, 10, 6).translate(0, 0.6, 0),
      new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6).rotateZ(HALF_PI).translate(0, 0.42, 0),
    ]),
    std({ color: 0xc8251f, roughness: 0.5 }),
    props.hydrant,
    ([x, z]) => at(x, CURB, z)
  );
  const bins = instanced(
    new THREE.CylinderGeometry(0.3, 0.26, 0.95, 12).translate(0, 0.475, 0),
    std({ color: 0x2d4a3a, roughness: 0.6, metalness: 0.3 }),
    props.bin,
    ([x, z]) => at(x, CURB, z)
  );

  // shipping containers (tinted per instance)
  const contTex = TX.corrugated();
  contTex.repeat.set(3, 1);
  const containers = instanced(
    new THREE.BoxGeometry(6.06, 2.59, 2.44).translate(0, 1.295, 0),
    std({ map: contTex, roughness: 0.7, metalness: 0.3 }),
    props.container,
    ([x, y, z, yaw]) => at(x, y, z, yaw)
  );
  props.container.forEach(([, , , , col], k) => containers.setColorAt(k, new THREE.Color(col)));
  // beach umbrellas
  const umb = instanced(
    mergeGeometries([new THREE.ConeGeometry(1.4, 0.55, 10, 1, true).translate(0, 2.25, 0)]),
    std({ roughness: 0.8, side: THREE.DoubleSide }),
    props.umbrella,
    ([x, z, r]) => at(x, -0.03, z, r)
  );
  props.umbrella.forEach(([, , , col], k) => umb.setColorAt(k, new THREE.Color(col)));
  const umbPoles = instanced(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6).translate(0, 1.15, 0), metalMat, props.umbrella, ([x, z]) => at(x, -0.03, z));

  // traffic lights (animated colours)
  const poles = instanced(
    mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8).translate(0, 1.7, 0),
      new THREE.BoxGeometry(0.36, 1.0, 0.3).translate(0, 3.6, 0),
    ]),
    metalMat,
    props.light,
    ([x, z, yaw]) => at(x, CURB, z, yaw)
  );
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial(), props.light.length * 3);
  props.light.forEach(([x, z, yaw], k) => {
    for (let b = 0; b < 3; b++) {
      M.compose(P.set(0, 3.92 - b * 0.31, 0.16).applyAxisAngle(UP, yaw).add(new THREE.Vector3(x, CURB, z)), Q.identity(), Sc.set(1, 1, 1));
      bulbs.setMatrixAt(k * 3 + b, M);
    }
  });
  scene.add(bulbs);

  // what a car knocks flying instead of stopping dead on: the hydrants, bins, beach umbrellas and
  // traffic lights. Each one's collider knows which instances are it; hit hard enough it leaves the
  // instanced mesh and flies as a real one, tips over, lies where it lands. A hydrant leaves a
  // fountain behind. Out of sight a while later it's back on its spot.
  // per kind: how hard a hit it takes (m/s), how much it slows the car, its fly-off (fraction of
  // the car's speed, upward kick), how far it tips over (rad) and how high it lies
  const KNOCK = {
    hydrant: { min: 3, slow: 0.86, carry: 0.6, up: 2.5, tip: HALF_PI, lie: 0.14 },
    bin: { min: 2, slow: 0.94, carry: 0.85, up: 3, tip: HALF_PI, lie: 0.28 },
    umbrella: { min: 1.5, slow: 0.97, carry: 0.9, up: 5, tip: 0.95, lie: 0 },
    light: { min: 4, slow: 0.78, carry: 0.35, up: 1.2, tip: HALF_PI, lie: 0.1 },
  };
  const debris = [];
  function knockable(kinds, bulbMesh) {
    for (const [kind, meshes] of Object.entries(kinds)) {
      props[kind].forEach((it, k) => {
        const c = it.find((v) => v && v.type === 'circle');
        if (c) c.prop = { kind, k, meshes, x: it[0], z: it[1], yaw: kind === 'light' || kind === 'umbrella' ? it[2] : 0, color: kind === 'umbrella' ? it[3] : null };
      });
    }
    city.bulbs = bulbMesh;
  }
  const _km = new THREE.Matrix4(), _kz = new THREE.Matrix4().makeScale(0, 0, 0), _kq = new THREE.Quaternion(), _kv = new THREE.Vector3();
  const showInstances = (p, on) => {
    const list = p.kind === 'light' ? [...p.meshes.map((m) => [m, p.k]), ...[0, 1, 2].map((b) => [city.bulbs, p.k * 3 + b])] : p.meshes.map((m) => [m, p.k]);
    for (const [m, k] of list) {
      if (!on) {
        m.getMatrixAt(k, _km);
        (p.saved ??= new Map()).set(m.uuid + k, _km.clone());
      }
      m.setMatrixAt(k, on ? p.saved.get(m.uuid + k) : _kz);
      m.instanceMatrix.needsUpdate = true;
    }
  };
  // a car hits this collider at velocity vel (m/s, a Vector3): does it go flying? (0: no; else
  // what's left of the car's speed)
  city.knock = (c, vel) => {
    const p = c.prop, K = p && KNOCK[p.kind], speed = Math.hypot(vel.x, vel.z);
    if (!p || c.off || speed < K.min) return 0;
    c.off = true;
    showInstances(p, false);
    const g = new THREE.Group();
    for (const m of p.meshes) {
      let mat = m.material;
      if (p.color != null) (mat = mat.clone()).color.set(p.color);
      const piece = new THREE.Mesh(m.geometry, mat);
      piece.castShadow = true;
      g.add(piece);
    }
    const y0 = p.kind === 'umbrella' ? -0.03 : CURB;
    g.position.set(p.x, y0, p.z);
    g.rotation.y = p.yaw;
    scene.add(g);
    // it flies off the way the car was going, a little to one side, and tips over that way
    const side = (Math.random() - 0.5) * 0.6;
    const v = new THREE.Vector3(vel.x + vel.z * side, 0, vel.z - vel.x * side).multiplyScalar(K.carry);
    v.y = K.up + speed * 0.08;
    const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
    debris.push({ c, p, K, g, v, axis, tilt: 0, spin: (Math.random() - 0.5) * (p.kind === 'umbrella' ? 8 : 3), yaw: p.yaw, rate: Math.min(9, 2 + speed * 0.35), t: 0, fountain: p.kind === 'hydrant' ? 25 : 0 });
    return K.slow;
  };
  // (fx: the water of a broken hydrant; near: where the player is, to put things back out of sight)
  city.tickDebris = (dt, fx, near) => {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], { g, v, K } = d;
      d.t += dt;
      const ground = d.p.kind === 'umbrella' ? -0.03 : city.groundHeight(g.position.x, g.position.z);
      const lying = d.tilt >= K.tip;
      if (!d.rest) {
        v.y -= 9.8 * dt;
        g.position.addScaledVector(v, dt);
        d.tilt = Math.min(K.tip, d.tilt + d.rate * dt);
        d.yaw += d.spin * dt;
        const floor = ground + K.lie * Math.sin(d.tilt);
        if (g.position.y <= floor) {
          g.position.y = floor;
          // bounce a little, then slide to a stop
          v.y = v.y < -2 ? -v.y * 0.25 : 0;
          const f = Math.max(0, 1 - 6 * dt);
          v.x *= f;
          v.z *= f;
          d.spin *= f;
          if (lying && Math.hypot(v.x, v.z) < 0.05 && v.y === 0) d.rest = true;
        }
        g.quaternion.setFromAxisAngle(d.axis, d.tilt).multiply(_kq.setFromAxisAngle(_kv.set(0, 1, 0), d.yaw));
      }
      if (d.fountain > 0 && fx) {
        d.fountain -= dt;
        const k = Math.min(1, d.fountain / 4);
        for (let n = 0; n < 3; n++) fx.jet(d.p.x, CURB + 0.5, d.p.z, (Math.random() - 0.5) * 1.5, (7 + Math.random() * 3) * k, (Math.random() - 0.5) * 1.5);
      }
      // back on its spot once nobody's looking
      if (d.t > 45 && d.fountain <= 0 && near && Math.hypot(near.x - d.p.x, near.z - d.p.z) > 110 && Math.hypot(near.x - g.position.x, near.z - g.position.z) > 110) {
        scene.remove(g);
        if (d.p.color != null) g.children.forEach((m) => m.material.dispose());
        showInstances(d.p, true);
        d.c.off = false;
        debris.splice(i, 1);
      }
    }
  };
  knockable({ hydrant: [hydrants], bin: [bins], umbrella: [umb, umbPoles], light: [poles] }, bulbs);
  const BULB_ON = [new THREE.Color(0xff2a2a), new THREE.Color(0xffb020), new THREE.Color(0x2aff6a)];
  const BULB_OFF = [new THREE.Color(0x3a0d0d), new THREE.Color(0x3a2a08), new THREE.Color(0x0d3a14)];
  let lightState = -1;
  const setLights = (state) => {
    // state 0: Z green, 1: Z amber, 2: X green, 3: X amber
    props.light.forEach(([, , , axisZ], k) => {
      const mine = axisZ ? state < 2 : state >= 2;
      const on = mine ? (state % 2 ? 1 : 2) : 0;
      for (let b = 0; b < 3; b++) bulbs.setColorAt(k * 3 + b, b === on ? BULB_ON[b] : BULB_OFF[b]);
    });
    bulbs.instanceColor.needsUpdate = true;
  };

  // ------------------------------------------------------------- merge static geometry per material
  // ...split into 128m chunks so frustum (and shadow-frustum) culling can skip most of the city
  const CHUNK = 128;
  for (const [mat, geos] of buckets) {
    const chunks = new Map();
    for (const g of geos) {
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      const k = `${Math.floor(c.x / CHUNK)},${Math.floor(c.z / CHUNK)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(g);
    }
    for (const list of chunks.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // ------------------------------------------------------------- spatial queries
  const CELL = 8, grid = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  const insert = (c, idx) => {
    const [minX, maxX, minZ, maxZ] = c.type === 'box' ? [c.minX, c.maxX, c.minZ, c.maxZ] : [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r];
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
        const k = key(gx, gz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  };
  city.colliders.forEach(insert);
  let stamp = 0;
  let seen = new Uint32Array(city.colliders.length);
  // solids added later (shop fronts, shop interiors)
  city.addColliders = (list) => {
    for (const c of list) insert(c, city.colliders.push(c) - 1);
    const s2 = new Uint32Array(city.colliders.length);
    s2.set(seen);
    seen = s2;
  };
  city.query = (minX, maxX, minZ, maxZ) => {
    stamp++;
    const out = [];
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
        const list = grid.get(key(gx, gz));
        if (!list) continue;
        for (const idx of list) {
          if (seen[idx] === stamp) continue;
          seen[idx] = stamp;
          if (!city.colliders[idx].off) out.push(city.colliders[idx]);
        }
      }
    }
    return out;
  };

  city.groundHeight = (x, z) => {
    const lx = x + HALF - ROAD, lz = z + HALF - ROAD;
    const ix = Math.floor(lx / PITCH), iz = Math.floor(lz / PITCH);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return 0;
    return lx - ix * PITCH <= BLOCK && lz - iz * PITCH <= BLOCK ? CURB : 0;
  };

  // segment (origin + dir * t, t in [0, maxT]) vs building boxes; returns nearest hit t
  city.raycast = (o, dir, maxT) => {
    const e = o.clone().addScaledVector(dir, maxT);
    let best = maxT;
    for (const c of city.query(Math.min(o.x, e.x) - 1, Math.max(o.x, e.x) + 1, Math.min(o.z, e.z) - 1, Math.max(o.z, e.z) + 1)) {
      if (c.type !== 'box' || c.h < 2.5) continue;
      let t0 = 0, t1 = best, hit = true;
      for (const [p, d, lo, hi] of [[o.x, dir.x, c.minX, c.maxX], [o.y, dir.y, 0, c.h], [o.z, dir.z, c.minZ, c.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) { hit = false; break; }
          continue;
        }
        let a = (lo - p) / d, b = (hi - p) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  };

  city.locationName = (x, z) => {
    const fi = (v) => Math.round((v + HALF - ROAD / 2) / PITCH);
    const i = THREE.MathUtils.clamp(fi(x), 0, N), j = THREE.MathUtils.clamp(fi(z), 0, N);
    const dx = Math.abs(x - roadC(i)), dz = Math.abs(z - roadC(j));
    const district = districtOf(x, z);
    const offGrid = Math.abs(x) > HALF || Math.abs(z) > HALF;
    const street = offGrid ? (district === 'Port of Sol' ? 'Container Terminal' : 'Beachfront') : dx < dz ? NS_NAMES[i] : EW_NAMES[j];
    return { street, district };
  };
  city.districtOf = districtOf;

  city.update = (t) => {
    waterNormal.offset.set(t * 0.006, t * 0.0035);
    seaU.uTime.value = t;
    const cyc = t % 24;
    const state = cyc < 10 ? 0 : cyc < 12 ? 1 : cyc < 22 ? 2 : 3;
    if (state !== lightState) setLights((lightState = state));
    city.lightState = state;
  };

  const parkX = blockMin(4) + BLOCK / 2 + 4, parkZ = blockMin(3) + BLOCK - 2.2;
  city.spawn = new THREE.Vector3(parkX, CURB, parkZ);
  // a sports coupe waiting at the curb next to the spawn point
  const hero = { x: parkX + 6, z: blockMin(3) + BLOCK + 1.15, yaw: HALF_PI, color: 0xd8622a, model: "coupe", owned: true };
  city.parkedCars = [hero, ...props.car.filter((c) => Math.hypot(c.x - hero.x, c.z - hero.z) > 6)];
  city.spawnYaw = 0;
  // you can wade and swim out to sea (and take a boat further); the edge of the world is out there
  city.bounds = EXT + 170;
  city.EXT = EXT;
  city.WATER_Y = -0.55; // the sea's surface
  // the beach shelves down under the water past EXT (the same slope as the sand mesh), then deep sea
  // (the shop and story rooms are built far out past the edge of the world: level floor there)
  const seabed = (x, z) => (Math.max(Math.abs(x), Math.abs(z)) - EXT < 200 ? seaBed(x, z) : -0.03);
  // wooden jetties and pontoons you can walk out on: { minX, maxX, minZ, maxZ, y }
  city.decks = [];
  // quay deck is level with the roads; the hill rises out of the sea; elsewhere the beach and the seabed
  const baseGround = city.groundHeight;
  city.groundHeight = (x, z) => {
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) return baseGround(x, z);
    for (const d of city.decks) if (x > d.minX && x < d.maxX && z > d.minZ && z < d.maxZ) return d.y;
    if (onQuayDeck(x, z)) return 0;
    // (the hill all the way down to where it meets the sea bed: its mesh's own triangles)
    const m = hillMesh(x, z);
    return m !== null ? Math.max(m, seabed(x, z)) : seabed(x, z);
  };
  // how deep the water is here (0 on dry land)
  city.waterDepth = (x, z) => Math.max(0, city.WATER_Y - city.groundHeight(x, z));
  city.roadC = roadC;
  city.blockMin = blockMin;

  // GPS: shortest path over the road grid (Dijkstra on the intersections). A point on a road
  // joins the graph at both ends of its road segment; anything off the roads joins at the
  // nearest intersection. Returns a polyline from -> to that follows the streets.
  city.gpsRoute = (from, to) => {
    const idx = (v) => THREE.MathUtils.clamp((v + HALF - ROAD / 2) / PITCH, 0, N);
    const key = (i, j) => i * (N + 1) + j;
    const node = (k) => ({ x: roadC(Math.floor(k / (N + 1))), z: roadC(k % (N + 1)) });
    const ends = (p) => {
      const fi = idx(p.x), fj = idx(p.z);
      const ri = Math.round(fi), rj = Math.round(fj);
      const offCol = Math.abs(p.x - roadC(ri)), offRow = Math.abs(p.z - roadC(rj));
      const inside = Math.abs(p.x) <= HALF && Math.abs(p.z) <= HALF;
      if (inside && offRow <= ROAD / 2 + 0.5 && offRow <= offCol) return [key(Math.floor(fi), rj), key(Math.ceil(fi), rj)]; // on an east-west road
      if (inside && offCol <= ROAD / 2 + 0.5) return [key(ri, Math.floor(fj)), key(ri, Math.ceil(fj))]; // north-south road
      return [key(ri, rj)];
    };
    const d2 = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
    const S = ends(from), T = ends(to);
    // same road segment: straight there
    if (S.length === 2 && T.length === 2 && S[0] === T[0] && S[1] === T[1]) return [from, to];
    const count = (N + 1) * (N + 1);
    const dist = new Float64Array(count).fill(Infinity), prev = new Int32Array(count).fill(-1), done = new Uint8Array(count);
    for (const k of S) dist[k] = Math.min(dist[k], d2(from, node(k)));
    for (;;) {
      let u = -1;
      for (let k = 0; k < count; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
      if (u < 0) break;
      done[u] = 1;
      const i = Math.floor(u / (N + 1)), j = u % (N + 1);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
        const v = key(ni, nj);
        if (dist[u] + PITCH < dist[v]) {
          dist[v] = dist[u] + PITCH;
          prev[v] = u;
        }
      }
    }
    let best = T[0], bd = Infinity;
    for (const k of T) {
      const d = dist[k] + d2(node(k), to);
      if (d < bd) [best, bd] = [k, d];
    }
    const path = [];
    for (let k = best; k >= 0; k = prev[k]) path.unshift(node(k));
    return [from, ...path, to];
  };
  city.lightState = 0;
  city.map = { canvas: mapCanvas, px: MAP_PX, half: MAP_EXT };
  return city;
}

// palm leaf strip: base at origin, extends along +Z, rises then droops
function leafGeometry(len, width) {
  const seg = 8, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = width * (0.25 + Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * 0.75) * 0.5;
    const y = 0.9 * t - 2.4 * t * t;
    const z = len * t;
    pos.push(-w, y, z, w, y, z);
    uv.push(0, t, 1, t);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
