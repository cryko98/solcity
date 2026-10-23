// GTA-style orbit/follow camera with building collision. Works on foot and in cars.
import * as THREE from 'three';

const MODES = {
  foot: { height: 1.55, zoom: 4.6, minZoom: 2.2, maxZoom: 10, pitch: 0.2, idle: 1.5, follow: 1.4, fov: 62 },
  // inside shops: closer and a little higher, under the ceiling
  indoor: { height: 1.5, zoom: 3.1, minZoom: 1.6, maxZoom: 4.6, pitch: 0.32, idle: 1.5, follow: 1.4, fov: 66 },
  car: { height: 1.35, zoom: 6.8, minZoom: 4.5, maxZoom: 14, pitch: 0.17, idle: 0.9, follow: 3.2, fov: 64 },
  // trucks, the bus, the fire truck: from high up and further back, looking down over the roof
  // (and over a trailer: `tow` is how much longer the rig is than the cab)
  big: { height: 3.6, zoom: 12, minZoom: 8, maxZoom: 24, pitch: 0.36, idle: 0.9, follow: 2.6, fov: 66 },
};

export class FollowCamera {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;
    this.yaw = 0;
    this.pitch = 0.2;
    this.distance = 4.6;
    this.mode = MODES.foot;
    this.zoom = this.mode.zoom;
    this.idleTime = 10;
    this.target = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.shake = 0;
    this.aim = false;
    this.aimK = 0;
    this.recoil = 0; // view kick from a shot; it settles back by itself
    this.assist = null; // aim assist: turn onto a target { yaw, pitch, t }
    this.slow = false; // crosshair over a target: finer mouse
    this.lift = 0; // backed up against a wall: the camera rises to look down over the subject
    this.tow = 0; // length of whatever the driven vehicle is towing (the camera backs off over it)
  }

  // the pitch the camera actually looks with (recoil included)
  get viewPitch() {
    return THREE.MathUtils.clamp(this.pitch - this.recoil, -0.35, 1.15);
  }

  // aim assist: aim() -> { yaw, pitch } (null to stop), asked again every frame for t seconds
  assistTo(aim, t = 0.2) {
    this.assist = { aim, t };
  }

  setAim(on) {
    this.aim = on;
  }

  kick(amount) {
    this.recoil = Math.min(0.22, this.recoil + amount); // muzzle climb: the view kicks up, then settles
  }

  setMode(name) {
    this.mode = MODES[name];
    this.zoom = this.mode.zoom;
    this.idleTime = 10;
  }

  // subject: { position, yaw, speed }
  update(dt, input, subject) {
    const M = this.mode;
    const m = input.consumeMouse();
    // aiming through the narrower lens: slower mouse, slower still over a target
    const sens = (1 - 0.42 * this.aimK) * (this.slow ? 0.6 : 1);
    if (m.dx || m.dy) {
      this.yaw -= m.dx * 0.0026 * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch + m.dy * 0.0022 * sens, -0.35, 1.15);
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }
    if (this.assist) {
      const a = this.assist, want = a.aim();
      // a real mouse movement takes over at once
      if (!want || Math.abs(m.dx) + Math.abs(m.dy) > 25) this.assist = null;
      else {
        const k = 1 - Math.exp(-dt * 22);
        this.yaw += Math.atan2(Math.sin(want.yaw - this.yaw), Math.cos(want.yaw - this.yaw)) * k;
        this.pitch += (THREE.MathUtils.clamp(want.pitch, -0.35, 1.15) - this.pitch) * k;
        if ((a.t -= dt) <= 0) this.assist = null;
      }
    }
    this.recoil *= Math.exp(-7 * dt);
    this.zoom = THREE.MathUtils.clamp(this.zoom + m.wheel * 0.004, M.minZoom, M.maxZoom);

    // drift back behind the subject while it moves and the mouse is untouched
    const moving = Math.abs(subject.speed) > 0.6;
    if (this.idleTime > M.idle && moving) {
      const d = Math.atan2(Math.sin(subject.yaw - this.yaw), Math.cos(subject.yaw - this.yaw));
      this.yaw += d * (1 - Math.exp(-M.follow * dt));
      this.pitch += (M.pitch - this.pitch) * (1 - Math.exp(-1.2 * dt));
    }

    const p = subject.position;
    const ty = p.y + M.height;
    const k = Math.min(1, dt * 10);
    if (!this.init) {
      this.target.set(p.x, ty, p.z);
      this.init = true;
    }
    this.target.set(p.x, this.target.y + (ty - this.target.y) * k, p.z);

    // aiming: closer, over the right shoulder, narrower view
    this.aimK += ((this.aim ? 1 : 0) - this.aimK) * Math.min(1, dt * 10);
    if (this.aim) this.idleTime = 0;
    // speed pulls the camera back a touch in cars
    const inCar = M === MODES.car || M === MODES.big;
    this.towK = (this.towK || 0) + (this.tow - (this.towK || 0)) * Math.min(1, dt * 2);
    const want0 = THREE.MathUtils.lerp(this.zoom + (inCar ? Math.min(3, Math.abs(subject.speed) * 0.06) + this.towK * 0.75 : 0), 2.1, this.aimK);
    // the pitch to look with: the player's, a little steeper over a trailer so the cab shows over it
    const base = this.viewPitch + this.towK * 0.014;
    const ray = (pitch) => {
      const cp = Math.cos(pitch);
      this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(pitch), -Math.cos(this.yaw) * cp);
      const d = this.city.raycast(this.target, this.dir, want0 + 0.3) - 0.3;
      // lifted: no higher than 1.5 m over the head (up there are the awnings and cornices)
      return pitch > base + 0.05 ? Math.min(d, 1.5 / Math.sin(pitch)) : d;
    };
    // a wall right behind (backed up against it): rather than pushing in through the head, the
    // camera rises and looks down over the shoulders, as far as it needs to see past the wall
    let liftWant = 0;
    if (!this.ceiling && this.aimK < 0.5 && ray(base) < 1.3) {
      let best = ray(base);
      for (const extra of [0.3, 0.6, 0.9, 1.2]) {
        const p2 = Math.min(1.45, base + extra), h2 = ray(p2);
        if (h2 > best + 0.3) {
          best = h2;
          liftWant = p2 - base;
        }
        if (best >= 1.6) break;
      }
    }
    this.lift += (liftWant - this.lift) * Math.min(1, dt * 4);
    const hit = ray(base + this.lift);
    const want = Math.max(0.25, Math.min(want0, hit));
    this.distance = want < this.distance ? want : this.distance + (want - this.distance) * Math.min(1, dt * 3);

    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(this.dir, this.distance);
    // shoulder offset (to the right of the view direction)
    let so = 0.6 * this.aimK;
    if (so > 0.01) {
      // not through a wall on the right
      const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      so = Math.min(so, Math.max(0, this.city.raycast(cam.position, side, so + 0.25) - 0.25));
    }
    cam.position.x += -Math.cos(this.yaw) * so;
    cam.position.z += Math.sin(this.yaw) * so;
    cam.position.y += 0.1 * this.aimK;
    // the lens never touches a wall: keep a small ball of room around it (sideways only)
    const R = 0.35, cp_ = cam.position;
    for (const c of this.city.query ? this.city.query(cp_.x - 1, cp_.x + 1, cp_.z - 1, cp_.z + 1) : []) {
      if (cp_.y > c.h) continue;
      if (c.type === 'box') {
        const qx = THREE.MathUtils.clamp(cp_.x, c.minX, c.maxX), qz = THREE.MathUtils.clamp(cp_.z, c.minZ, c.maxZ);
        const dx = cp_.x - qx, dz = cp_.z - qz, d = Math.hypot(dx, dz);
        if (d >= R || d < 1e-6) continue;
        cp_.x += (dx / d) * (R - d);
        cp_.z += (dz / d) * (R - d);
      } else if (c.r > 0.5) {
        const dx = cp_.x - c.x, dz = cp_.z - c.z, d = Math.hypot(dx, dz), r = c.r + R;
        if (d >= r || d < 1e-6) continue;
        cp_.x += (dx / d) * (r - d);
        cp_.z += (dz / d) * (r - d);
      }
    }
    cam.position.y = Math.max(cam.position.y, this.city.groundHeight(cam.position.x, cam.position.z) + 0.4);
    if (this.ceiling) cam.position.y = Math.min(cam.position.y, this.ceiling);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-8 * dt);
    }
    if (this.aimK > 0.01) {
      // look along the view direction from the shoulder, not at the head
      const look = cam.position.clone().addScaledVector(this.dir, -10);
      cam.lookAt(this.target.clone().lerp(look, this.aimK));
    } else cam.lookAt(this.target);

    const fov = THREE.MathUtils.lerp(M.fov + (inCar ? Math.min(14, Math.abs(subject.speed) * 0.3) : 0), 48, this.aimK);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
