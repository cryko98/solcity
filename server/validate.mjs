// Is a reported mission / race real? The game samples the player's position about once a
// second while a run is open and sends the trace when it finishes. A trace only passes if:
//   - it is well formed (numbers, time going forward, no long silent gaps on the move)
//   - it lasts no longer than the server's own clock says the run has been open
//   - it lasts at least the fastest believable time for that run
//   - it starts where the run starts (the contact's door, the race start line)
//   - nothing in it moves faster than a supercar can (no teleports)
//   - it passes through every place the run takes you, in order
// Faking all that means actually driving the route in real time; with the daily caps on top a
// bot can't earn more than a player.
import { storyById, missionSpots, missionMinSeconds, contactStand, RACES, raceRoute, raceMinSeconds, MAX_SPEED, RACE_CP_RADIUS, CHASE_MIN_TRAVEL } from '../src/shared/world.mjs';

export const MAX_SAMPLES = 4000;

export function runPlan(kind, ref) {
  if (kind === 'story') {
    const m = storyById[ref];
    if (!m) return null;
    return { start: { ...contactStand(m.contact), r: 30 }, spots: missionSpots(m), minSec: missionMinSeconds(m), maxSec: 45 * 60, minTravel: m.type === 'chase' ? CHASE_MIN_TRAVEL : 0 };
  }
  if (kind === 'race') {
    const r = RACES.find((q) => q.id === ref);
    if (!r) return null;
    const route = raceRoute(r);
    const start = { x: (route[0].x + route[1].x) / 2, z: (route[0].z + route[1].z) / 2, r: 25 };
    let length = 0;
    for (let k = 1; k < route.length; k++) length += Math.hypot(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z);
    // gold as in the game (length / 22 from GO), plus the 3.5 s countdown and a little network slack
    return { start, spots: route.slice(1).map((p) => ({ ...p, r: RACE_CP_RADIUS + 5 })), minSec: raceMinSeconds(r), maxSec: 20 * 60, gold: length / 22 + 5 };
  }
  return null;
}

// trace: [[t, x, z], ...] with t in seconds since the run started (client clock)
export function checkTrace(trace, plan, elapsedSec) {
  if (!Array.isArray(trace) || trace.length < 3 || trace.length > MAX_SAMPLES) return 'bad trace';
  for (const s of trace) {
    if (!Array.isArray(s) || s.length !== 3 || !s.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'bad sample';
    if (Math.abs(s[1]) > 5000 || Math.abs(s[2]) > 5000) return 'bad sample';
  }
  const dur = trace[trace.length - 1][0] - trace[0][0];
  if (trace[0][0] < -2 || trace[0][0] > 10) return 'bad start time';
  if (dur > elapsedSec + 3) return 'trace longer than the run';
  if (dur < elapsedSec - 25) return 'trace too short for the run';
  if (elapsedSec < plan.minSec) return 'too fast';
  if (elapsedSec > plan.maxSec) return 'too slow';
  // about one sample a second; a longer gap (indoors, a paused game) is fine as long as the
  // player didn't move during it
  for (let k = 1; k < trace.length; k++) {
    const [t0, x0, z0] = trace[k - 1], [t1, x1, z1] = trace[k];
    const dt = t1 - t0, d = Math.hypot(x1 - x0, z1 - z0);
    if (dt <= 0) return 'time going backwards';
    if (dt < 0.2 && d > 1) return 'samples too close together';
    if (d / Math.max(dt, 0.2) > MAX_SPEED) return 'moved impossibly fast';
    if (dt > 6 && d > 8) return 'gap in the trace while moving';
  }
  if (plan.minTravel) {
    let travel = 0;
    for (let k = 1; k < trace.length; k++) travel += Math.hypot(trace[k][1] - trace[k - 1][1], trace[k][2] - trace[k - 1][2]);
    if (travel < plan.minTravel) return 'did not go anywhere';
  }
  // starts at the right place
  const [, sx, sz] = trace[0];
  if (Math.hypot(sx - plan.start.x, sz - plan.start.z) > plan.start.r) return 'started somewhere else';
  // goes to every place (in order, unless the spots say any order). Samples are a second
  // apart, so the path between two samples counts: a car at 40 m/s crosses a checkpoint between them.
  const near = (k, s) => {
    const [, x0, z0] = trace[Math.max(0, k - 1)], [, x1, z1] = trace[k];
    const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz;
    const u = L ? Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.z - z0) * dz) / L)) : 0;
    return Math.hypot(x0 + dx * u - s.x, z0 + dz * u - s.z) <= s.r;
  };
  const anyOrder = plan.spots.some((s) => s.any);
  if (anyOrder) {
    const left = new Set(plan.spots.map((_, i) => i));
    for (let k = 0; k < trace.length; k++) for (const i of left) if (near(k, plan.spots[i])) left.delete(i);
    if (left.size) return 'missed a place';
  } else {
    let i = 0;
    for (let k = 0; k < trace.length; k++) while (i < plan.spots.length && near(k, plan.spots[i])) i++;
    if (i < plan.spots.length) return 'missed a place';
  }
  return null;
}
