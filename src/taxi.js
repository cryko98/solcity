// Taxi side missions (GTA-style "Taxi Driver").
// In a taxi press T to go on duty: a fare waits at the kerb (yellow blip + arrow),
// stop next to them and they get in the back, then get them to their destination
// (GPS route on the minimap, light beam on the street) before the meter runs out.
// Pay = fare + tip for the time left; every 5 fares in a row pays a bonus.
import * as THREE from 'three';

const STOP_RADIUS = 9;
const lerpPts = (a, b) => ({ x: a.x, z: b.z });

export class TaxiMissions {
  constructor(scene, city, peds, hud, audio) {
    this.scene = scene;
    this.city = city;
    this.peds = peds;
    this.hud = hud;
    this.audio = audio;
    this.state = 'off';
    this.streak = 0;
    this.fare = null;
    this.vehicle = null;
    this.hinted = null;
    this.routeTimer = 0;
    this.makeMarkers();
  }

  // ---------------------------------------------------------------- 3D markers
  makeMarkers() {
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(0xffc21a) }, t: { value: 0 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 color; uniform float t; varying float vY;
        void main(){ float a = (1.0 - clamp(vY / 30.0, 0.0, 1.0)) * (0.45 + 0.15 * sin(t * 4.0 - vY * 0.4));
          gl_FragColor = vec4(color * a, a); }`,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 30, 32, 1, true).translate(0, 15, 0), beamMat);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(STOP_RADIUS * 0.55, 0.12, 6, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.85 })
    );
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.6, 4).rotateX(Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0xffaa00, emissiveIntensity: 1.2 })
    );
    this.beam.renderOrder = 5;
    for (const m of [this.beam, this.ring, this.arrow]) {
      m.visible = false;
      this.scene.add(m);
    }
  }

  showMarkers(beamAt, arrowOn) {
    this.beam.visible = this.ring.visible = !!beamAt;
    if (beamAt) {
      this.beam.position.set(beamAt.x, 0, beamAt.z);
      this.ring.position.set(beamAt.x, 0.06, beamAt.z);
    }
    this.arrow.visible = !!arrowOn;
  }

  // ---------------------------------------------------------------- places
  // a kerbside spot: where the fare stands and where the cab should stop
  kerbSpot(bi, bj) {
    const { BLOCK } = this.city;
    const x0 = this.city.blockMin(bi), z0 = this.city.blockMin(bj);
    const t = 8 + Math.random() * (BLOCK - 16);
    const side = Math.floor(Math.random() * 4);
    // [fare x, z, stop x, z, fare facing yaw]
    const S = [
      [x0 + t, z0 + 1.3, x0 + t, z0 - 1.9, Math.PI],
      [x0 + t, z0 + BLOCK - 1.3, x0 + t, z0 + BLOCK + 1.9, 0],
      [x0 + 1.3, z0 + t, x0 - 1.9, z0 + t, -Math.PI / 2],
      [x0 + BLOCK - 1.3, z0 + t, x0 + BLOCK + 1.9, z0 + t, Math.PI / 2],
    ][side];
    const { street, district } = this.city.locationName(S[2], S[3]);
    return { fare: { x: S[0], z: S[1] }, stop: { x: S[2], z: S[3] }, yaw: S[4], street, district };
  }

  pickSpot(from, minD, maxD) {
    const { N } = this.city;
    for (let i = 0; i < 40; i++) {
      const s = this.kerbSpot(Math.floor(Math.random() * N), Math.floor(Math.random() * N));
      const d = Math.abs(s.stop.x - from.x) + Math.abs(s.stop.z - from.z);
      if (d > minD && d < maxD) return s;
    }
    return this.kerbSpot(Math.floor(Math.random() * N), Math.floor(Math.random() * N));
  }

  // ---------------------------------------------------------------- GPS route along the road grid
  nodeOf(x, z) {
    const { N, HALF, ROAD, PITCH } = this.city;
    const f = (v) => THREE.MathUtils.clamp(Math.round((v + HALF - ROAD / 2) / PITCH), 0, N);
    return { x: this.city.roadC(f(x)), z: this.city.roadC(f(z)) };
  }

  route(from, to) {
    if (this.city.gpsRoute) return this.city.gpsRoute({ x: from.x, z: from.z }, { x: to.x, z: to.z });
    const a = this.nodeOf(from.x, from.z), b = this.nodeOf(to.x, to.z);
    // leave along the road the car is on, turn once, arrive along the destination's road
    const pts = [{ x: from.x, z: from.z }];
    const onX = Math.abs(from.z - a.z) < Math.abs(from.x - a.x); // driving along an x-road
    if (onX) pts.push({ x: b.x, z: a.z }, lerpPts(b, b));
    else pts.push({ x: a.x, z: b.z }, lerpPts(b, b));
    pts.push({ x: to.x, z: to.z });
    return pts;
  }

  routeLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].z - pts[i - 1].z);
    return L;
  }

  // ---------------------------------------------------------------- flow
  start(v) {
    this.vehicle = v;
    this.state = 'seek';
    this.hud.say('Taxi missions. Pick up the fare marked on the radar.');
    this.newFare(v.pos);
  }

  stop(msg = 'Taxi missions over.') {
    if (this.fare) {
      this.fare.keep = false;
      if (this.fare.state === 'riding') this.peds.alight(this.fare);
      else if (this.fare.state === 'fare' || this.fare.state === 'board') {
        this.fare.keep = false;
        this.peds.rejoin(this.fare);
      }
    }
    this.fare = null;
    this.vehicle = null;
    this.state = 'off';
    this.showMarkers(null, false);
    this.hud.route = null;
    this.hud.blips = [];
    this.hud.mission(null);
    if (msg) this.hud.say(msg, 3);
  }

  newFare(from) {
    const s = this.pickSpot(from, 70, 220);
    this.pickup = s;
    this.fare = this.peds.spawnFare(s.fare.x, s.fare.z, s.yaw);
  }

  boarded() {
    const v = this.vehicle;
    this.dest = this.pickSpot(v.pos, 250, 750);
    const len = this.routeLength(this.route(v.pos, this.dest.stop));
    this.timeLeft = Math.round(len / 10 + 15);
    this.fareValue = Math.round(15 + len * 0.12);
    this.state = 'ride';
    this.hud.say(`Take me to <em>${this.dest.street}, ${this.dest.district}</em>.`, 5);
    this.audio.blip?.({ tone: 880, toneEnd: 1320, dur: 0.18, gain: 0.25 });
  }

  passengerOut(msg) {
    this.peds.alight(this.fare);
    this.fare = null;
    if (msg) this.hud.say(msg, 3.5);
  }

  update(dt, { player, driving, input, wanted }) {
    const v = driving?.vehicle;
    const inTaxi = v && driving.model === 'taxi';
    this.beam.material.uniforms.t.value += dt;

    if (this.state === 'off') {
      if (inTaxi && this.hinted !== driving) {
        this.hinted = driving;
        this.hud.say('Press <em>T</em> to start taxi missions.', 4);
      }
      if (!inTaxi) this.hinted = null;
      if (inTaxi && input.pressed('KeyT')) this.start(v);
      return;
    }
    // left the cab or switched it off
    if (v !== this.vehicle || player.dead || player.busted) return this.stop();
    if (input.pressed('KeyT')) return this.stop();

    const at = (p, r) => Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < r;
    const stopped = v.speed < 1.5;
    if ((this.routeTimer -= dt) <= 0) {
      this.routeTimer = 0.5;
      const target = this.state === 'ride' ? this.dest.stop : this.pickup.stop;
      this.hud.route = this.route(v.pos, target);
    }

    if (this.state === 'seek') {
      // fare got hurt / scared off: find another
      if (!this.fare || !this.peds.list.includes(this.fare) || this.fare.state !== 'fare') {
        if (this.fare) this.fare.keep = false;
        this.newFare(v.pos);
      }
      this.hud.blips = [{ x: this.fare.x, z: this.fare.z, color: '#4fa3ff' }];
      this.arrow.position.set(this.fare.x, 2.5 + Math.sin(performance.now() / 250) * 0.15, this.fare.z);
      this.arrow.rotation.y += dt * 2;
      this.showMarkers(null, true);
      if (stopped && Math.hypot(v.pos.x - this.fare.x, v.pos.z - this.fare.z) < 7) {
        this.state = 'board';
        this.peds.board(this.fare, v, () => this.boarded());
        this.hud.say('Hop in.', 2);
      }
    } else if (this.state === 'board') {
      this.showMarkers(null, false);
      this.boardT = (this.boardT || 0) + dt;
      if (this.fare.state !== 'board') {
        // knocked down, scared off: find someone else
        if (this.fare.state !== 'riding') {
          this.fare.keep = false;
          this.fare = null;
          this.boardT = 0;
          this.state = 'seek';
        }
      } else if (!at(this.fare, 14)) {
        // drove off before they got in: they wait again
        this.fare.state = 'fare';
        this.boardT = 0;
        this.state = 'seek';
      } else if (this.boardT > 8) {
        // something is in the way of the door: in they get anyway
        this.boardT = 0;
        const cb = this.fare.onBoarded;
        this.peds.seatIn(this.fare, v);
        cb?.();
      }
    } else if (this.state === 'ride') {
      this.timeLeft -= dt;
      this.hud.blips = [{ x: this.dest.stop.x, z: this.dest.stop.z, color: '#ffd23f' }];
      this.showMarkers(this.dest.stop, false);
      if (wanted.level > 0) {
        this.streak = 0;
        this.passengerOut("Are you crazy? I'm getting out!");
        this.fare = null;
        this.state = 'seek';
        this.newFare(v.pos);
      } else if (this.timeLeft <= 0) {
        this.streak = 0;
        this.passengerOut("You're too slow! I'll walk from here.");
        this.state = 'seek';
        this.newFare(v.pos);
      } else if (stopped && at(this.dest.stop, STOP_RADIUS)) {
        const tip = Math.round(this.timeLeft * 1.2);
        let pay = this.fareValue + tip;
        this.streak++;
        this.onFare?.();
        let msg = `Fare <em>$${this.fareValue}</em> + tip <em>$${tip}</em>.`;
        if (this.streak % 5 === 0) {
          pay += 200;
          msg += ` ${this.streak} fares in a row! Bonus <em>$200</em>.`;
        }
        this.hud.addMoney(pay);
        this.audio.cash();
        this.passengerOut(msg);
        this.state = 'seek';
        this.showMarkers(null, false);
        this.newFare(v.pos);
      }
    }
    this.hud.mission({
      title: 'TAXI',
      time: this.state === 'ride' ? this.timeLeft : null,
      fare: this.state === 'ride' ? this.fareValue : null,
      streak: this.streak,
    });
  }
}
