// Tiny synthesized engine + tyre screech (no audio files needed).
export class CarAudio {
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 4;
    this.lp = lp;
    this.oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.15]].map(([type, mul, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(lp);
      o.start();
      return { o, mul };
    });
    lp.connect(this.engineGain).connect(this.master);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 6;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    noise.connect(bp).connect(this.skidGain).connect(this.master);
    noise.start();
  }

  // short one-off sound: a filtered noise burst plus an optional pitched tone
  blip({ noise = 0, cutoff = 800, tone = 0, toneEnd = tone, dur = 0.15, gain = 0.5 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(this.master);
    if (noise) {
      // one shared 4 s noise buffer, played from a random point (no new buffer per gunshot / step)
      if (!this.noiseBuf) {
        const len = ctx.sampleRate * 4;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      src.connect(ng).connect(f).connect(g);
      src.start(t, Math.random() * 3.5);
      src.stop(t + dur);
    }
    if (tone) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(tone, t);
      o.frequency.exponentialRampToValueAtTime(toneEnd, t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur);
    }
  }

  // police siren: a wailing two-oscillator sweep, volume by distance to the nearest patrol car
  siren(dist) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.sirenGain) {
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      lp.connect(this.sirenGain).connect(this.master);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.32;
      const depth = ctx.createGain();
      depth.gain.value = 380;
      lfo.connect(depth);
      for (const [type, mul, g] of [['sawtooth', 1, 0.25], ['square', 1.004, 0.12]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 980 * mul;
        depth.connect(o.frequency);
        const gn = ctx.createGain();
        gn.gain.value = g;
        o.connect(gn).connect(lp);
        o.start();
      }
      lfo.start();
    }
    const v = Number.isFinite(dist) ? Math.max(0, 1 - dist / 140) ** 1.6 * 0.22 : 0;
    this.sirenGain.gain.setTargetAtTime(v, t, 0.15);
  }

  gunshot(kind = 'pistol', vol = 1) {
    const g = { pistol: [0.85, 2200, 0.16], smg: [0.6, 2600, 0.1], shotgun: [1, 1400, 0.32] }[kind] || [0.8, 2000, 0.15];
    this.blip({ noise: 1, cutoff: g[1], tone: 120, toneEnd: 40, dur: g[2], gain: g[0] * vol });
  }

  punch() {
    this.blip({ noise: 1, cutoff: 900, tone: 110, toneEnd: 45, dur: 0.18, gain: 0.9 });
  }

  swing() {
    this.blip({ noise: 0.5, cutoff: 2500, dur: 0.12, gain: 0.25 });
  }

  // deep boom: low noise burst with a falling tone, then a rumble
  explosion(vol = 1) {
    this.blip({ noise: 1, cutoff: 700, tone: 70, toneEnd: 22, dur: 1.6, gain: 1.1 * vol });
    this.blip({ noise: 1, cutoff: 3000, dur: 0.25, gain: 0.6 * vol });
  }

  thunder(vol = 1) {
    this.blip({ noise: 1, cutoff: 220, tone: 45, toneEnd: 25, dur: 3.2, gain: 0.9 * Math.max(0.2, vol) });
  }

  crash(speed) {
    const v = Math.min(1, speed / 18);
    this.blip({ noise: 1, cutoff: 1400 + v * 1500, tone: 160, toneEnd: 60, dur: 0.18 + v * 0.2, gain: 0.25 + v * 0.6 });
  }

  step(run, wet) {
    this.blip({ noise: 0.6, cutoff: wet > 0.3 ? 2600 : 900, dur: run ? 0.07 : 0.06, gain: (run ? 0.13 : 0.07) * (wet > 0.3 ? 1.3 : 1) });
  }

  land(v) {
    this.blip({ noise: 1, cutoff: 600, tone: 90, toneEnd: 50, dur: 0.12, gain: Math.min(0.5, v * 0.04) });
  }

  hiss(dur = 1.4) {
    this.blip({ noise: 0.7, cutoff: 6000, dur, gain: 0.22 });
  }

  // steady rain noise, 0..1
  rain(k) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 3200;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 300;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(f).connect(hp).connect(this.rainGain).connect(this.master);
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(k * 0.12, this.ctx.currentTime, 0.5);
  }

  // car horn: two detuned square waves through a band-pass, on while held
  horn(on) {
    if (!this.ctx) return;
    if (!this.hornGain) {
      const ctx = this.ctx;
      this.hornGain = ctx.createGain();
      this.hornGain.gain.value = 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      for (const f of [415, 523]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(bp);
        o.start();
      }
      bp.connect(this.hornGain).connect(this.master);
    }
    this.hornGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.02);
  }

  // helicopter: low noise chopped by the blade-pass frequency
  chopper(k) {
    if (!this.ctx) return;
    if (!this.chopGain) {
      const ctx = this.ctx;
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const mod = ctx.createGain();
      mod.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 16;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(mod.gain);
      this.chopGain = ctx.createGain();
      this.chopGain.gain.value = 0;
      src.connect(lp).connect(mod).connect(this.chopGain).connect(this.master);
      src.start();
      lfo.start();
    }
    this.chopGain.gain.setTargetAtTime(k * k * 0.9, this.ctx.currentTime, 0.2);
  }

  cash() {
    this.blip({ tone: 1320, toneEnd: 1320, dur: 0.08, gain: 0.25 });
    setTimeout(() => this.blip({ tone: 1760, toneEnd: 1760, dur: 0.18, gain: 0.25 }), 80);
  }

  // speed in m/s, vmax of the car, throttle 0..1, slip m/s
  update(active, speed, vmax, throttle, slip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor((Math.abs(speed) / vmax) * gears * 1.05));
    const lo = (g / gears) * vmax, hi = ((g + 1) / gears) * vmax;
    const rpm = active ? 0.18 + 0.82 * Math.min(1, (Math.abs(speed) - lo) / (hi - lo) * (g ? 0.75 : 1) + (g ? 0.25 : 0)) : 0;
    const base = 32 + rpm * 120 + throttle * 6;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(base * mul, t, 0.05);
    this.lp.frequency.setTargetAtTime(500 + rpm * 1400 + throttle * 600, t, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.1 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(active && slip > 3 ? Math.min(0.25, (slip - 3) * 0.05) : 0, t, 0.05);
  }
}
