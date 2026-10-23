// Test: the hero as a Microsoft Rocketbox avatar with its motion-captured walk / run / idle (open the
// game with ?rb). It stands in for the hero's own model while he is on foot, unarmed and just
// walking, running or standing; everything else (fists, guns, cars, swimming...) still shows the
// hero's own model, which has those clips.
import * as THREE from 'three';

// the clips' own speed (m/s) and cycle (two steps): the feet stay planted when played in step
const GAITS = { walk: 1.42, run: 3.7, sprint: 5.6 };

export class RbHero {
  constructor(gltf, player) {
    this.player = player;
    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    player.object.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const c of gltf.animations) {
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[c.name] = a;
    }
    // locomotion is stepped by one shared phase, so walk, run and sprint stay in step as they blend
    for (const n of Object.keys(GAITS)) if (this.actions[n]) this.actions[n].timeScale = 0;
    this.weights = Object.fromEntries(Object.keys(this.actions).map((n) => [n, n === 'idle' ? 1 : 0]));
    this.phase = 0;
    this.on = false;
  }

  update(dt) {
    const P = this.player;
    const weaponShown = Object.values(P.weaponNodes || {}).some((o) => o.visible);
    const on = !P.vehicle && !P.posed && !P.overlay && !P.swimming && !P.busted && !P.dead && P.grounded && !weaponShown && !P.aiming;
    if (on !== this.on) {
      this.on = on;
      this.model.visible = on;
      P.model.visible = !on;
    }
    if (!on) return;
    // the weights: idle to walk to run to sprint by speed
    const s = P.speed;
    const tw = { idle: 0, walk: 0, run: 0, sprint: 0 };
    if (s < 1.0) [tw.idle, tw.walk] = [1 - s, s];
    else if (s < GAITS.walk + 0.4) tw.walk = 1;
    else if (s < GAITS.run) {
      const k = (s - GAITS.walk - 0.4) / (GAITS.run - GAITS.walk - 0.4);
      [tw.walk, tw.run] = [1 - k, k];
    } else {
      const k = Math.min(1, (s - GAITS.run) / (GAITS.sprint - GAITS.run));
      [tw.run, tw.sprint] = [1 - k, k];
    }
    const k = 1 - Math.exp(-10 * dt);
    for (const n of Object.keys(this.actions)) {
      this.weights[n] += ((tw[n] || 0) - this.weights[n]) * k;
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    // one gait phase: the blended stride (metres per cycle) sets how fast it turns
    let stride = 0, wsum = 0;
    for (const n of Object.keys(GAITS)) {
      const a = this.actions[n];
      if (!a) continue;
      stride += this.weights[n] * GAITS[n] * a.getClip().duration;
      wsum += this.weights[n];
    }
    if (wsum > 0.01 && s > 0.05) this.phase = (this.phase + (dt * s) / (stride / wsum)) % 1;
    for (const n of Object.keys(GAITS)) if (this.actions[n]) this.actions[n].time = this.phase * this.actions[n].getClip().duration;
    this.mixer.update(dt);
  }
}
