// Shared between the game (browser) and the reward server (Node): the layout of the city and
// where every rewarded activity happens. The server uses it to check a player's trace: a story
// mission only pays if the player really went to its places, in order, at believable speeds.
// Keep this file free of browser or Node APIs.

// ------------------------------------------------------------------ city grid
export const N = 10; // blocks per side
export const BLOCK = 50, ROAD = 14, SW = 4, CURB = 0.15;
export const PITCH = BLOCK + ROAD, SIZE = N * PITCH + ROAD, HALF = SIZE / 2;
export const roadC = (i) => -HALF + ROAD / 2 + i * PITCH;
export const blockMin = (i) => -HALF + ROAD + i * PITCH;

// deterministic random numbers (race routes are the same everywhere)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ street races
export const RACES = [
  { id: 'race_downtown', name: 'Downtown Dash', start: [5, 5], seed: 11, len: 10 },
  { id: 'race_havana', name: 'Havana Nights', start: [2, 8], seed: 23, len: 12 },
  { id: 'race_harbor', name: 'Harbor Run', start: [1, 1], seed: 37, len: 12 },
  { id: 'race_hills', name: 'Hills Sprint', start: [8, 2], seed: 52, len: 11 },
  { id: 'race_beach', name: 'Beachfront Blitz', start: [8, 8], seed: 64, len: 13 },
];
export const RACE_CP_RADIUS = 10;

// a self-avoiding walk over the intersections, the same every session
export function raceRoute(r) {
  for (let tries = 0; tries < 50; tries++) {
    const rand = rng(r.seed + tries * 101);
    let [i, j] = r.start;
    const seen = new Set([`${i},${j}`]);
    const nodes = [[i, j]];
    let dir = null;
    while (nodes.length <= r.len) {
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => {
        const ni = i + di, nj = j + dj;
        return ni >= 0 && nj >= 0 && ni <= N && nj <= N && !seen.has(`${ni},${nj}`);
      });
      if (!opts.length) break;
      let pick = opts[Math.floor(rand() * opts.length)];
      if (dir && rand() < 0.4 && opts.some(([a, b]) => a === dir[0] && b === dir[1])) pick = dir;
      dir = pick;
      i += pick[0];
      j += pick[1];
      seen.add(`${i},${j}`);
      nodes.push([i, j]);
    }
    if (nodes.length > r.len) return nodes.map(([a, b]) => ({ x: roadC(a), z: roadC(b) }));
  }
  throw new Error('no race route for ' + r.name);
}

// ------------------------------------------------------------------ walk-in shops
// [type, name, block i, block j]: the shop takes the street (south) face of a building on that
// block; the city leaves that ground floor plain so the shop front can be built onto it
export const SHOP_BRANCHES = [
  ['gun', 'AMMU-NATION', 4, 4], ['gun', 'AMMU-NATION', 2, 2], ['gun', 'AMMU-NATION', 6, 5],
  ['food', 'BURGER SOL', 2, 6], ['food', 'TACO LOCO', 0, 4], ['food', 'PIZZA SOL', 5, 4],
  ['clothes', 'SOL THREADS', 3, 6], ['clothes', 'SOL THREADS', 6, 7], ['clothes', 'SOL THREADS', 7, 5],
  ['mart', '24/7', 0, 2], ['mart', '24/7', 7, 6], ['mart', '24/7', 5, 8], ['food', 'BURGER SOL', 9, 7],
  ['bank', 'SOL CITY RESERVE', 5, 6],
];

// the bank job (Zara's last three missions)
export const BANK_BLOCK = [5, 6];
// the bank's street face, middle (its door is somewhere along it, depending on the building)
export const bankFront = () => ({ x: blockMin(BANK_BLOCK[0]) + BLOCK / 2, z: blockMin(BANK_BLOCK[1]) - 1.5 });
// the getaway car waits on the street behind the bank
export const getawaySpot = () => roadside(BANK_BLOCK[0], BANK_BLOCK[1] + 1, 30);

// ------------------------------------------------------------------ story
// contacts stand at a door on the south side of their block
export const CONTACT_PLACES = {
  rosa: { block: [2, 5], t: 28 },
  vince: { block: [1, 2], t: 30 },
  diaz: { block: [3, 4], t: 30 },
  zara: { block: [8, 6], t: 26 },
};
export const contactStand = (id) => {
  const c = CONTACT_PLACES[id];
  return { x: blockMin(c.block[0]) + c.t, z: blockMin(c.block[1]) + 1.05 };
};
// kerbside parking spot on the road north of block (bi, bj), facing +x
export const roadside = (bi, bj, along) => ({ x: blockMin(bi) + along, z: roadC(bj) + ROAD / 2 - 1.15, yaw: Math.PI / 2 });

// The story in play order; `after` must be done first in the game. (The server does not need the
// order: every mission is checked on its own and pays once per wallet.)
export const STORY = [
  { id: 'rosa1', contact: 'rosa', type: 'beat', where: [3, 7] },
  { id: 'rosa2', contact: 'rosa', type: 'deliver', after: 'rosa1' },
  { id: 'vince1', contact: 'vince', type: 'destroy', where: [7, 7], after: 'rosa2' },
  { id: 'vince2', contact: 'vince', type: 'steal', where: [7, 1], after: 'vince1' },
  { id: 'diaz1', contact: 'diaz', type: 'chase', after: 'vince2' },
  { id: 'diaz2', contact: 'diaz', type: 'evidence', after: 'diaz1' },
  { id: 'rosa3', contact: 'rosa', type: 'route', vehicle: 'van', stops: [[0, 7], [3, 9], [5, 7], [4, 5]], after: 'diaz2' },
  { id: 'vince3', contact: 'vince', type: 'gang', where: [0, 0], goons: 6, after: 'rosa3' },
  { id: 'diaz3', contact: 'diaz', type: 'collect', bags: [[4, 3], [5, 2], [6, 4], [3, 5], [5, 5]], after: 'vince3' },
  { id: 'zara1', contact: 'zara', type: 'steal', where: [2, 0], vehicle: 'van', after: 'diaz3' },
  { id: 'zara2', contact: 'zara', type: 'route', vehicle: 'bike', stops: [[9, 3], [6, 0], [2, 3], [5, 9], [8, 8]], after: 'zara1' },
  { id: 'zara3', contact: 'zara', type: 'finale', where: [7, 7], goons: 7, after: 'zara2' },
  { id: 'zara4', contact: 'zara', type: 'scout', after: 'zara3' },
  { id: 'zara5', contact: 'zara', type: 'steal', where: [7, 2], vehicle: 'lux', drop: 'getaway', after: 'zara4' },
  { id: 'zara6', contact: 'zara', type: 'heist', after: 'zara5' },
];
export const storyById = Object.fromEntries(STORY.map((m) => [m.id, m]));

// The places a mission takes you to, in order: [{ x, z, r }]. `any: true` = in any order.
export function missionSpots(m) {
  const home = contactStand(m.contact);
  const c = CONTACT_PLACES[m.contact];
  const blockSpot = ([bi, bj], dx = 25, dz = 2) => ({ x: blockMin(bi) + dx, z: blockMin(bj) + dz });
  switch (m.type) {
    case 'beat':
      return [{ ...blockSpot(m.where, 22, 2.2), r: 25 }];
    case 'deliver':
      return [{ ...roadside(c.block[0], c.block[1], c.t + 7), r: 15 }, { x: 20, z: HALF + 16, r: 14 }];
    case 'destroy':
      return [{ ...roadside(m.where[0], m.where[1], 25), r: 45 }];
    case 'steal':
      return [{ ...roadside(m.where[0], m.where[1], 22), r: 15 }, m.drop === 'getaway' ? { ...getawaySpot(), r: 14 } : { ...roadside(c.block[0], c.block[1], c.t + 8), r: 14 }];
    case 'scout': {
      // photos of the bank: the front from across the street, the side street, the back
      const [bi, bj] = BANK_BLOCK, x0 = blockMin(bi), z0 = blockMin(bj);
      return [{ x: x0 + BLOCK / 2, z: roadC(bj) - ROAD / 2 - 1.5, r: 12 }, { x: roadC(bi + 1), z: z0 + BLOCK / 2, r: 12 }, { x: x0 + BLOCK / 2, z: roadC(bj + 1), r: 12 }];
    }
    case 'heist':
      // in through the front door, then the money to Zara's garage
      return [{ ...bankFront(), r: 30 }, { ...roadside(c.block[0], c.block[1], c.t + 8), r: 14 }];
    case 'chase':
      return [];
    case 'evidence':
      return [{ x: -60, z: -HALF - 20, r: 10 }, { ...home, r: 10 }];
    case 'route':
      return [{ ...roadside(c.block[0], c.block[1], c.t + 7), r: 15 }, ...m.stops.map(([i, j]) => ({ x: roadC(i), z: roadC(j), r: 14 }))];
    case 'gang':
    case 'finale':
      return [{ ...blockSpot(m.where, 25, -3), r: 40 }];
    case 'collect':
      return m.bags.map(([i, j]) => ({ x: roadC(i), z: roadC(j), r: 8, any: true }));
  }
  return [];
}

// Fastest believable time for a mission, seconds: the whole route at a supercar's top speed,
// plus what has to happen on the spot.
export const MAX_SPEED = 90; // m/s anywhere in a trace (supercar top speed + ramps + blasts)
export function missionMinSeconds(m) {
  const pts = [contactStand(m.contact), ...missionSpots(m)];
  let d = 0;
  for (let k = 1; k < pts.length; k++) d += Math.max(0, Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z) - pts[k].r);
  const extra = { beat: 8, deliver: 6, destroy: 6, steal: 8, chase: 12, evidence: 15, route: 10, gang: 25, collect: 10, finale: 45, scout: 12, heist: 90 }[m.type] || 10;
  return Math.max(15, d / 55 + extra);
}

export function raceMinSeconds(r) {
  const route = raceRoute(r);
  let d = 0;
  for (let k = 1; k < route.length; k++) d += Math.hypot(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z);
  // the 3.5 s countdown, then the route at 34 m/s on average: faster than a supercar can
  // take the corners (gold is 22 m/s)
  return 3.5 + d / 34;
}

// a getaway chase has no fixed places, but you have to have driven after the car
export const CHASE_MIN_TRAVEL = 120; // Eddie starts at least 70 m away
