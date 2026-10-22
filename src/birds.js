// Seagulls: small flocks wheeling over the beaches and the parks during the day (they
// roost at night), wings flapping and gliding in turns. One instanced mesh, two triangles
// per wing; the flap is baked into each instance's matrix every frame.
import * as THREE from 'three';

const PER_FLOCK = 9;

function wingGeometry() {
  // body + two wings in the bird's local frame (+Z forward); wings hinge on the body
  const g = new THREE.BufferGeometry();
  const v = [
    // body
    0, 0, 0.32, -0.05, 0, -0.18, 0.05, 0, -0.18,
    // left wing (x < 0), tip lifted by the flap in the vertex shader through `position.y`
    0, 0, 0.1, -0.62, 0, -0.06, 0, 0, -0.1,
    // right wing
    0, 0, 0.1, 0, 0, -0.1, 0.62, 0, -0.06,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  constructor({ scene, city, env }) {
    Object.assign(this, { city, env });
    const H = city.HALF;
    // beaches on all four sides, the downtown park
    const homes = [
      { x: 0, z: H + 30, r: 40 }, { x: -H - 28, z: 40, r: 35 }, { x: H + 28, z: -60, r: 35 },
      { x: 120, z: H + 32, r: 30 }, { x: city.spawn.x, z: city.spawn.z, r: 22 },
    ];
    this.birds = [];
    for (const [i, h] of homes.entries()) {
      for (let k = 0; k < PER_FLOCK; k++) {
        this.birds.push({ h, a: Math.random() * 6.28, r: h.r * (0.5 + Math.random() * 0.6), y: 6 + Math.random() * 9,
          w: (0.25 + Math.random() * 0.2) * (k % 2 ? 1 : -1) * (i % 2 ? 1 : -1), ph: Math.random() * 10, bob: Math.random() * 6.28 });
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9, side: THREE.DoubleSide });
    // flap: the wing tips (|x| > 0.3) move up and down, per instance phase in instanceColor.r
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceColor.g * 40.0;
          float glide = step(0.0, sin(uTime * 0.7 + ph));
          float flap = mix(sin(uTime * 13.0 + ph) * 0.35, 0.08, glide);
          transformed.y += flap * smoothstep(0.05, 0.62, abs(transformed.x));`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = vec3(0.93);');
    };
    this.mesh = new THREE.InstancedMesh(wingGeometry(), mat, this.birds.length);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    this.birds.forEach((b, i) => this.mesh.setColorAt(i, c.setRGB(1, b.ph / 40, 1)));
    scene.add(this.mesh);
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    if (this.uTime) this.uTime.value = this.t;
    // roosting at night: out of sight
    const day = 1 - (this.env.nightK || 0);
    this.mesh.visible = day > 0.3;
    if (!this.mesh.visible) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    this.birds.forEach((b, i) => {
      b.a += b.w * dt;
      const x = b.h.x + Math.cos(b.a) * b.r, z = b.h.z + Math.sin(b.a) * b.r;
      const y = b.y + Math.sin(this.t * 0.4 + b.bob) * 2 + this.city.groundHeight(x, z);
      // heading along the circle, banked into the turn
      const yaw = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
      q.setFromEuler(e.set(0, yaw, -0.35 * Math.sign(b.w), 'YXZ'));
      this.mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.setScalar(1.6)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
