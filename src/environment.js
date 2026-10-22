// Sky, sun / moon, time of day and weather.
// The clock runs one game minute per real second; lighting is blended between
// key presets (night, dawn, noon, golden hour, dusk). Weather cycles between
// clear, cloudy, rain and thunderstorms: procedural clouds in the sky shader,
// GPU-animated rain streaks around the camera, wet glossy roads, lightning.
import * as THREE from 'three';

const PRESETS = {
  night: { top: 0x0a1430, horizon: 0x343060, bottom: 0x10101a, fog: 0x272443, sun: 0x9db4ff, sunI: 0.85, hemi: 0.6, hemiSky: 0x6a7ab8, env: 0.5, exposure: 1.3, bloom: 0.6, thr: 0.78, lamps: 1 },
  dawn: { top: 0x4f6fae, horizon: 0xf2b293, bottom: 0x6a5a5a, fog: 0xd2aba0, sun: 0xffc4a0, sunI: 2.0, hemi: 0.7, hemiSky: 0xb8c8ef, env: 0.6, exposure: 1.0, bloom: 0.35, thr: 0.85, lamps: 0.3 },
  noon: { top: 0x2c6bd0, horizon: 0xbcd8f0, bottom: 0x8a8070, fog: 0xc6d6e4, sun: 0xfff1dc, sunI: 3.4, hemi: 1.0, hemiSky: 0xc4d8ff, env: 0.85, exposure: 1.0, bloom: 0.2, thr: 0.95, lamps: 0 },
  golden: { top: 0x3f74c4, horizon: 0xffc58a, bottom: 0x8a6a5a, fog: 0xe8b98f, sun: 0xffd6a8, sunI: 3.2, hemi: 0.9, hemiSky: 0xbcd3ff, env: 0.75, exposure: 1.0, bloom: 0.22, thr: 0.95, lamps: 0 },
  dusk: { top: 0x1b2352, horizon: 0xe0764a, bottom: 0x2a2030, fog: 0x7a5060, sun: 0xff9a60, sunI: 1.4, hemi: 0.65, hemiSky: 0x7a7ab8, env: 0.55, exposure: 1.15, bloom: 0.5, thr: 0.8, lamps: 0.7 },
};
const KEYS = [[0, 'night'], [4.6, 'night'], [6.2, 'dawn'], [8.6, 'noon'], [15.6, 'noon'], [18, 'golden'], [19.7, 'dusk'], [21.2, 'night'], [24, 'night']];
const COLOR_KEYS = ['top', 'horizon', 'bottom', 'fog', 'sun', 'hemiSky'];
const NUM_KEYS = ['sunI', 'hemi', 'env', 'exposure', 'bloom', 'thr', 'lamps'];
const C = Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, Object.fromEntries(COLOR_KEYS.map((c) => [c, new THREE.Color(p[c])]))]));
const WEATHER = ['clear', 'cloudy', 'rain', 'storm'];
const W_TARGET = { clear: [0.08, 0], cloudy: [0.6, 0], rain: [0.85, 0.75], storm: [1, 1] };
const GRAY = new THREE.Color(0x8a9096), GRAY_N = new THREE.Color(0x15171c);
const MOON = new THREE.Vector3(0.4, 0.55, -0.6).normalize();
const AZ18 = Math.atan2(-0.5, -0.62);

export class Environment {
  constructor({ scene, renderer, bloom, city, audio }) {
    Object.assign(this, { scene, renderer, bloom, city, audio });
    this.minutes = 18 * 60 + 40;
    this.timeScale = 1; // game minutes per real second
    this.weather = 'clear';
    this.weatherTimer = 150 + Math.random() * 120;
    this.cloud = 0.08;
    this.rain = 0;
    this.wet = 0;
    this.flash = 0;
    this.thunderT = 6;
    this.nightK = 0;
    this.envSig = '';
    this.envCool = 0;
    this.L = Object.fromEntries([...COLOR_KEYS.map((k) => [k, new THREE.Color()]), ...NUM_KEYS.map((k) => [k, 0])]);
    this.makeSky();
    this.makeLights();
    this.makeRain();
    this.wetMats = (city.wetMats || []).map((m) => ({ m, r: m.roughness, c: m.color.clone() }));
    // real lights for the street lamps nearest the camera: they light walls, cars and people;
    // they fade out with distance so swapping lamps never pops
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc27a, 0, 30, 1.7);
      l.position.set(0, -100, 0);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.lampCount = 6;
    this.lampTimer = 0;
    this.nearLamps = [];
  }

  // ---------------------------------------------------------------- sky
  makeSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, moonDir: { value: MOON.clone() },
        nightK: { value: 0 }, cloud: { value: 0 }, time: { value: 0 }, flash: { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, horizon, bottom, sunDir, sunColor, moonDir;
        uniform float nightK, cloud, time, flash;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.45)) : mix(horizon, bottom, pow(-h, 0.6));
          float s = max(dot(d, sunDir), 0.0);
          float sunVis = (1.0 - nightK) * (1.0 - cloud * 0.9) * smoothstep(-0.05, 0.03, sunDir.y);
          c += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.35) * sunVis;
          // moon and stars
          float m = max(dot(d, moonDir), 0.0);
          float clear = 1.0 - cloud * 0.92;
          c += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99935, 0.9996, m) * 1.4 + pow(m, 80.0) * 0.06) * nightK * clear;
          if (h > 0.0) {
            vec3 q = d * 260.0, cell = floor(q);
            float r = hash3(cell);
            float st = step(0.9965, r) * smoothstep(0.32, 0.0, length(fract(q) - 0.5));
            st *= 0.6 + 0.4 * sin(time * (2.0 + r * 9.0) + r * 40.0);
            c += vec3(st) * nightK * clear * smoothstep(0.02, 0.25, h) * 1.4;
            // clouds: a domain-warped fbm layer projected on a plane overhead
            vec2 uv = d.xz / (h + 0.18) * 1.15 + vec2(time * 0.006, time * 0.0025);
            float n = fbm(uv * 1.6 + fbm(uv * 0.7) * 0.6);
            float cover = mix(0.66, 0.2, cloud);
            float cl = smoothstep(cover, cover + 0.22 + cloud * 0.2, n) * smoothstep(0.0, 0.12, h);
            float lum = mix(1.0, 0.07, nightK) * (1.0 - cloud * 0.5);
            vec3 cc = mix(horizon, vec3(1.0), 0.6) * lum;
            cc = mix(cc, cc * 0.55, smoothstep(0.5, 0.95, n) * cloud); // darker bellies when it's overcast
            cc += sunColor * pow(s, 5.0) * 0.45 * sunVis;
            c = mix(c, cc, cl * 0.92);
          }
          c += flash * vec3(0.55, 0.6, 0.8) * (0.4 + 0.6 * smoothstep(-0.1, 0.5, h));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // environment reflections (cars, glass, wet roads) come from the same sky
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat));
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3632 }));
    this.envGround.position.y = -2;
    this.envScene.add(this.envGround);
    this.envRT = null;
  }

  makeLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd3ff, 0x7a644e, 1.2);
    this.sun = new THREE.DirectionalLight(0xffd2a0, 2.8);
    this.sunDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
    this.lightDir = this.sunDir.clone();
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, sun, sun.target);
    this.scene.fog = new THREE.FogExp2(0xe8b98f, 0.0042);
  }

  // ---------------------------------------------------------------- rain
  makeRain() {
    const N = 7000, BOX = 46, HGT = 26;
    const seed = new Float32Array(N * 2 * 3), tip = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      seed.set([x, y, z, x, y, z], i * 6);
      tip[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    this.rainN = N;
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { t: { value: 0 }, cam: { value: new THREE.Vector3() }, alpha: { value: 0 }, light: { value: 1 }, wind: { value: new THREE.Vector2(1.2, 0.5) } },
      vertexShader: `
        attribute float tip; uniform float t; uniform vec3 cam; uniform vec2 wind; varying float vA;
        void main(){
          vec3 box = vec3(${BOX.toFixed(1)}, ${HGT.toFixed(1)}, ${BOX.toFixed(1)});
          vec3 p = position * box;
          p.y -= t * 19.0 + position.x * 7.0;
          p.xz += wind * t * 0.5;
          vec3 o = cam - box * vec3(0.5, 0.3, 0.5);
          vec3 w = o + mod(p - o, box);
          w.y += tip * 0.62;
          w.xz -= wind * tip * 0.035;
          vA = tip;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float alpha, light; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.72, 0.76, 0.82) * light, alpha * (0.35 + 0.65 * vA)); }`,
    });
    this.rainLines = new THREE.LineSegments(g, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 6;
    this.rainLines.visible = false;
    this.scene.add(this.rainLines);
  }

  // ---------------------------------------------------------------- controls
  get hour() {
    return this.minutes / 60;
  }

  setTime(h, m = 0) {
    this.minutes = h * 60 + m;
    this.envSig = '';
  }

  // N: jump to the next night / morning
  skipTime() {
    this.setTime(this.nightK > 0.5 ? 7 : 21, 30);
  }

  // K: next weather (instant fade)
  cycleWeather() {
    this.setWeather(WEATHER[(WEATHER.indexOf(this.weather) + 1) % WEATHER.length]);
  }

  setWeather(w, instant = false) {
    this.weather = w;
    this.weatherTimer = 120 + Math.random() * 160;
    if (instant) [this.cloud, this.rain] = W_TARGET[w];
  }

  get night() {
    return this.nightK > 0.45;
  }

  // headlights on: dark or pouring
  get lightsOn() {
    return this.nightK > 0.35 || this.cloud > 0.8;
  }

  // graphics quality: fewer real lamp lights on weaker GPUs (changing the count recompiles shaders once)
  setLampLights(n) {
    this.lampCount = n;
    this.lampLights.forEach((l, i) => (l.visible = i < n));
  }

  updateLampLights(dt, camera, k) {
    const heads = this.city.lampHeads;
    if (!heads) return;
    // look a little ahead of the camera, where the player is
    const fx = camera.position.x, fz = camera.position.z;
    if ((this.lampTimer -= dt) <= 0) {
      this.lampTimer = 0.25;
      const near = [];
      for (const h of heads) {
        const d = Math.abs(h.x - fx) + Math.abs(h.z - fz);
        if (d < 70) near.push([d, h]);
      }
      near.sort((a, b) => a[0] - b[0]);
      this.nearLamps = near.slice(0, this.lampCount).map(([, h]) => h);
    }
    const R0 = 18, R1 = 34;
    this.lampLights.forEach((l, i) => {
      const h = this.nearLamps[i];
      if (!h || k <= 0 || i >= this.lampCount) {
        l.intensity = 0;
        return;
      }
      l.position.copy(h);
      const d = Math.hypot(h.x - fx, h.z - fz);
      l.intensity = 70 * k * (1 - THREE.MathUtils.smoothstep(d, R0, R1));
    });
  }

  // ---------------------------------------------------------------- update
  blend() {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
    const t = THREE.MathUtils.smoothstep(h, h0, h1);
    const L = this.L;
    for (const k of COLOR_KEYS) L[k].copy(C[a][k]).lerp(C[b][k], t);
    for (const k of NUM_KEYS) L[k] = PRESETS[a][k] + (PRESETS[b][k] - PRESETS[a][k]) * t;
    this.nightK = L.lamps >= 0.99 ? 1 : THREE.MathUtils.clamp(PRESETS[a].lamps + (PRESETS[b].lamps - PRESETS[a].lamps) * t, 0, 1);
    return L;
  }

  update(dt, focus, camera) {
    this.minutes = (this.minutes + dt * this.timeScale) % (24 * 60);
    const L = this.blend();

    // weather state machine with slow transitions
    if ((this.weatherTimer -= dt) <= 0) {
      const r = Math.random();
      const next = this.weather === 'clear' ? (r < 0.6 ? 'cloudy' : 'clear') : this.weather === 'cloudy' ? (r < 0.45 ? 'rain' : r < 0.6 ? 'storm' : 'clear') : r < 0.6 ? 'cloudy' : 'clear';
      this.setWeather(next);
    }
    const [tc, tr] = W_TARGET[this.weather];
    this.cloud += (tc - this.cloud) * (1 - Math.exp(-dt / 12));
    this.rain += ((this.cloud > 0.7 ? tr : 0) - this.rain) * (1 - Math.exp(-dt / 8));
    // roads get wet quickly and dry slowly
    const wantWet = Math.min(1, this.rain * 1.5);
    this.wet += (wantWet - this.wet) * (1 - Math.exp(-dt / (wantWet > this.wet ? 10 : 70)));

    // lightning in storms
    this.flash *= Math.exp(-dt * 9);
    if (this.weather === 'storm' && this.rain > 0.6) {
      if ((this.thunderT -= dt) <= 0) {
        this.thunderT = 5 + Math.random() * 12;
        this.flash = 1.4;
        this.flash2 = 0.12 + Math.random() * 0.1;
        const delay = 0.4 + Math.random() * 2.2;
        setTimeout(() => this.audio?.thunder?.(1.2 - delay * 0.3), delay * 1000);
      }
      if (this.flash2 > 0 && (this.flash2 -= dt) <= 0) this.flash = 1.1;
    }

    // weather on top of the time-of-day palette
    const cl = this.cloud, rn = this.rain, nk = this.nightK;
    const gray = GRAY.clone().lerp(GRAY_N, nk);
    const u = this.skyMat.uniforms;
    u.top.value.copy(L.top).lerp(gray, cl * 0.75);
    u.horizon.value.copy(L.horizon).lerp(gray, cl * 0.6);
    u.bottom.value.copy(L.bottom).lerp(gray, cl * 0.4);
    u.nightK.value = nk;
    u.cloud.value = cl;
    u.time.value += dt;
    u.flash.value = this.flash;

    // sun path: rises in the east, the golden-hour angle at 18:00, sets around 20:00
    const a = THREE.MathUtils.clamp((this.hour - 5.8) / 14.4, 0, 1);
    const elev = Math.sin(a * Math.PI) * 1.05 - 0.04;
    const az = AZ18 + (this.hour - 18) * 0.21;
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
    u.sunDir.value.copy(this.sunDir);
    u.sunColor.value.set(0xffcf8a).lerp(new THREE.Color(0xff8a50), THREE.MathUtils.clamp(1 - elev / 0.4, 0, 1));
    // the shadow-casting light: the sun (kept above ~14 degrees) by day, the moon at night
    const sd = this.sunDir.clone();
    sd.y = Math.max(sd.y, 0.25);
    this.lightDir.copy(sd.normalize()).lerp(MOON, nk).normalize();

    const sunI = L.sunI * (1 - cl * 0.72);
    this.sun.color.copy(L.sun).lerp(gray, cl * 0.5);
    this.sun.intensity = sunI;
    this.sun.shadow.intensity = 1 - cl * 0.55;
    this.hemi.intensity = L.hemi * (1 - cl * 0.12) + this.flash * 1.6;
    this.hemi.color.copy(L.hemiSky).lerp(gray, cl * 0.5);
    this.scene.fog.color.copy(L.fog).lerp(gray, cl * 0.7);
    this.scene.fog.density = 0.0042 + rn * 0.0065 + cl * 0.0012;
    this.renderer.toneMappingExposure = L.exposure * (1 - cl * 0.08);
    const bloomOn = nk > 0.2 || this.flash > 0.05;
    this.bloom.enabled = bloomOn;
    this.bloom.strength = L.bloom + this.flash * 0.3;
    this.bloom.threshold = L.thr;
    const lampK = Math.max(nk, cl * 0.35);
    for (const m of this.city.nightMats) m.emissiveIntensity = m.userData.day + (m.userData.night - m.userData.day) * lampK;
    const glowK = THREE.MathUtils.smoothstep(lampK, 0.25, 0.8);
    for (const g of this.city.nightGlow || []) g.mat.opacity = g.k * glowK;
    this.updateLampLights(dt, camera, glowK);
    this.ambient = THREE.MathUtils.lerp(1, 0.22, nk) * (1 - cl * 0.25);

    // wet roads: darker and glossy
    for (const w of this.wetMats) {
      w.m.roughness = w.r * (1 - 0.62 * this.wet);
      w.m.color.copy(w.c).multiplyScalar(1 - 0.32 * this.wet);
    }

    // rain streaks follow the camera
    this.rainLines.visible = rn > 0.02;
    if (this.rainLines.visible) {
      this.rainMat.uniforms.t.value += dt;
      this.rainMat.uniforms.cam.value.copy(camera.position);
      this.rainMat.uniforms.alpha.value = Math.min(0.55, rn * 0.6);
      this.rainMat.uniforms.light.value = THREE.MathUtils.lerp(1, 0.35, nk) + this.flash;
      this.rainLines.geometry.setDrawRange(0, Math.floor(this.rainN * 2 * Math.min(1, rn * 1.2)));
    }
    this.audio?.rain?.(rn);

    // reflections: rebuild the environment map when the sky changed noticeably
    const sig = `${Math.round(nk * 20)}|${Math.round(cl * 10)}|${Math.round(this.hour * 2)}|${this.flash > 0.5 ? 1 : 0}`;
    if ((this.envCool -= dt) <= 0 && sig !== this.envSig) {
      this.envSig = sig;
      this.envCool = 0.5;
      this.envGround.material.color.set(0x3a3632).lerp(new THREE.Color(0x08080c), nk);
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
      this.scene.environment = this.envRT.texture;
    }
    this.scene.environmentIntensity = L.env * (1 - cl * 0.3) + this.wet * 0.15;

    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 140);
  }
}
