// Car radio. R in a vehicle flips through the stations; the radio fades in when you
// get in and out when you get out.
//   SOL FM   - "Cyberpunk Beat" by Disquantic (CC0), streamed from the music folder
//   BEAT 102 - a little synthwave groove sequenced live with WebAudio (kick, snare,
//              hats, bass line and pad over an Am-F-C-G loop)
const STATIONS = [
  { name: 'SOL FM', sub: 'cyberpunk beats', kind: 'file', url: 'vendor/music/cyberpunk_beat_disquantic_cc0.mp3' },
  { name: 'BEAT 102', sub: 'synthwave all night', kind: 'synth' },
  { name: 'RADIO OFF', kind: 'off' },
];
const BPM = 104, STEP = 60 / BPM / 4; // 16th notes
// Am F C G (root midi notes) and their triads
const PROG = [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [52, 55, 60]], [55, [55, 59, 62]]];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export class Radio {
  constructor(audio) {
    this.audio = audio;
    this.index = 0;
    this.vol = 0;
    this.el = document.getElementById('radio');
    this.showT = 0;
  }

  get station() {
    return STATIONS[this.index];
  }

  show() {
    const s = this.station;
    this.el.innerHTML = `<div class="r-name">${s.name}</div>${s.sub ? `<div class="r-sub">${s.sub}</div>` : ''}`;
    this.el.classList.add('show');
    this.showT = 2.6;
  }

  // ---------------------------------------------------------------- synth station
  buildSynth() {
    const ctx = this.audio.ctx;
    this.synthOut = ctx.createGain();
    this.synthOut.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.synthOut.connect(comp).connect(this.audio.master);
    // a short noise buffer shared by snare and hats
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextT = ctx.currentTime + 0.1;
    this.step = 0;
  }

  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  voice(type, freq, t, dur, peak, cutoff) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    this.env(g, t, 0.01, peak, dur);
    o.connect(f).connect(g).connect(this.synthOut);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hit(t, kind) {
    const ctx = this.audio.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this.env(g, t, 0.003, 0.9, 0.32);
      o.connect(g).connect(this.synthOut);
      o.start(t);
      o.stop(t + 0.4);
      return;
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    this.env(g, t, 0.002, kind === 'hat' ? 0.12 : 0.45, kind === 'hat' ? 0.05 : 0.2);
    src.connect(f).connect(g).connect(this.synthOut);
    src.start(t);
    src.stop(t + 0.3);
  }

  schedule() {
    const ctx = this.audio.ctx;
    while (this.nextT < ctx.currentTime + 0.25) {
      const t = this.nextT, s = this.step % 16, bar = Math.floor(this.step / 16) % 4;
      const [root, chord] = PROG[bar];
      if (s % 4 === 0) this.hit(t, 'kick');
      if (s === 4 || s === 12) this.hit(t, 'snare');
      if (s % 2 === 1) this.hit(t, 'hat');
      // driving eighth-note bass, octave jump on the off-beats
      if (s % 2 === 0) this.voice('sawtooth', midi(root - 24 + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.8, 0.22, 600);
      // pad on every bar, arpeggio on top
      if (s === 0) for (const n of chord) this.voice('triangle', midi(n), t, STEP * 15, 0.05, 1800);
      if (s % 2 === 0) this.voice('square', midi(chord[(s / 2) % 3] + 12), t, STEP * 0.9, 0.035, 2600);
      this.nextT += STEP;
      this.step++;
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, inCar, input) {
    if (!this.audio.ctx) return;
    if (inCar && !this.wasIn) this.show();
    this.wasIn = inCar;
    if (inCar && input.pressed('KeyR')) {
      this.index = (this.index + 1) % STATIONS.length;
      this.show();
    }
    if ((this.showT -= dt) <= 0) this.el.classList.remove('show');
    const want = inCar ? 1 : 0;
    this.vol += (want - this.vol) * Math.min(1, dt * (want ? 1.5 : 3));
    const st = this.station;

    // file station
    if (st.kind === 'file' && this.vol > 0.01) {
      if (!this.track) {
        this.track = new Audio(st.url);
        this.track.loop = true;
      }
      this.track.volume = Math.min(1, this.vol * 0.55);
      if (this.track.paused) this.track.play().catch(() => {});
    } else if (this.track && !this.track.paused) this.track.pause();

    // synth station
    if (st.kind === 'synth' && this.vol > 0.01) {
      if (!this.synthOut) this.buildSynth();
      if (this.nextT < this.audio.ctx.currentTime) this.nextT = this.audio.ctx.currentTime + 0.05;
      this.schedule();
      this.synthOut.gain.setTargetAtTime(this.vol * 0.32, this.audio.ctx.currentTime, 0.1);
    } else if (this.synthOut) this.synthOut.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.1);
  }
}
