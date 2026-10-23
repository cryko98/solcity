// Touch controls for phones and tablets (only on touch screens).
//   left side:  a joystick that appears under your thumb (walk, push it all the way to sprint;
//               in a car: steer, and gas / brake if you like)
//   right side: drag to look around, pinch to zoom the camera
//   buttons:    on foot  FIRE (drag it to aim while shooting), AIM, JUMP, CAR, USE (E), ROLL,
//                        weapon, reload
//               driving  GAS, BRAKE, HANDBRAKE, EXIT, NITRO, HORN, RADIO, JOB (T)
//               always   MAP, full screen, graphics quality
// Everything is fed into the normal Input object as keys and mouse moves, so the rest of the
// game doesn't know the difference. Phones play in landscape only: held upright, the game
// pauses behind a "rotate your phone" screen.
export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// a phone or a tablet (a touch screen and no mouse): the lighter graphics by default
export const isPhone = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

// full screen and landscape, where the browser allows it (Android Chrome does; iPhones don't,
// the rotate screen covers that). Must be called from a tap.
export async function goLandscape() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else el.webkitRequestFullscreen?.();
    }
  } catch {}
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {}
}
const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

// ------------------------------------------------------------------ the phone layout of the HUD
const MOBILE_CSS = `
  body.touch { --safe-l: env(safe-area-inset-left, 0px); --safe-r: env(safe-area-inset-right, 0px); --safe-t: env(safe-area-inset-top, 0px); }
  body.touch #help { display: none !important; }
  body.touch, body.touch canvas { touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  #rotate { position: fixed; inset: 0; z-index: 100; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    background: radial-gradient(ellipse at center, #241433, #000 75%); text-align: center; padding: 24px; }
  #rotate .phone { width: 46px; height: 80px; border: 4px solid #ffd23f; border-radius: 9px; position: relative; animation: rot 2.2s ease-in-out infinite; }
  #rotate .phone::after { content: ''; position: absolute; left: 50%; bottom: 5px; width: 10px; height: 3px; margin-left: -5px; border-radius: 2px; background: #ffd23f; }
  @keyframes rot { 0%, 25% { transform: rotate(0); } 55%, 85% { transform: rotate(-90deg); } 100% { transform: rotate(0); } }
  #rotate b { font: 34px Anton, Impact, sans-serif; letter-spacing: 2px; color: #fff; }
  #rotate span { font: 600 14px Inter, sans-serif; color: #c9c2d6; max-width: 280px; line-height: 1.5; }
  @media (orientation: portrait) { body.touch #rotate { display: flex; } }

  /* small landscape screens: everything smaller and out of the thumbs' way */
  body.touch #stats { top: calc(6px + var(--safe-t)); right: calc(10px + var(--safe-r)); }
  body.touch #clock { font-size: 18px; }
  body.touch #clock small { font-size: 11px; }
  body.touch #money { font-size: 22px; }
  body.touch #money-add { font-size: 18px; }
  body.touch #wanted { font-size: 15px; letter-spacing: 1px; }
  body.touch #weapon { margin-top: 2px; }
  body.touch #weapon .w-name { font-size: 10px; letter-spacing: 2px; }
  body.touch #weapon .w-ammo { font-size: 18px; }
  body.touch #weapon .w-ammo small { font-size: 13px; }
  body.touch #radar { left: calc(8px + var(--safe-l)); top: calc(6px + var(--safe-t)); bottom: auto; width: 150px; }
  body.touch #minimap { width: 150px; height: 96px; border-width: 2px; }
  body.touch .bars { gap: 3px; margin-top: 3px; }
  body.touch .bar { height: 5px; }
  body.touch #street { left: 50%; right: auto; top: calc(44px + var(--safe-t)); bottom: auto; text-align: center; transform: translate(-50%, -6px); }
  body.touch #street.show { transform: translate(-50%, 0); }
  body.touch #street-name { font-size: 18px; }
  body.touch #district-name { font-size: 9px; letter-spacing: 2px; }
  body.touch #speedo { left: 50%; right: auto; bottom: 6px; transform: translateX(-50%); text-align: center; }
  body.touch #kmh { font-size: 32px; }
  body.touch #speedo small { font-size: 9px; letter-spacing: 2px; }
  body.touch #hint { top: auto; bottom: 30%; font-size: 13px; pointer-events: auto; }
  body.touch #hint kbd { display: none; }
  body.touch #subtitle-line { bottom: 64px; max-width: 54vw; font-size: 14px; line-height: 1.35; }
  body.touch #radio { top: calc(86px + var(--safe-t)); }
  body.touch #radio .r-name { font-size: 22px; }
  body.touch #radio .r-sub { font-size: 9px; letter-spacing: 3px; }
  body.touch #mission { left: calc(8px + var(--safe-l)); right: auto; top: calc(124px + var(--safe-t)); min-width: 150px; max-width: 34vw; padding: 6px 10px; }
  body.touch #mission .m-title { font-size: 15px; margin-bottom: 2px; }
  body.touch #mission .m-row { font-size: 10px; gap: 10px; line-height: 1.6; }
  body.touch #mission .m-row b { font-size: 13px; }
  body.touch #shop { left: 42%; top: 46%; transform: translate(-50%, -50%); min-width: 240px; max-width: 42vw; max-height: 78vh; overflow-y: auto;
    padding: 8px 12px; pointer-events: auto; z-index: 9; }
  body.touch #shop .s-title { font-size: 18px; margin-bottom: 2px; }
  body.touch #shop .s-row { font-size: 12px; line-height: 1.3; min-height: 34px; border-radius: 6px; padding: 0 4px; }
  body.touch #shop .s-row:has(kbd):active { background: rgba(255,210,63,.3); }
  body.touch #shop .s-row b { font-size: 15px; }
  body.touch #shop .s-foot { font-size: 9px; }
  body.touch #shop .s-foot::before { content: 'Tap an item to buy · '; }
  body.touch #mission-title { font-size: 30px; letter-spacing: 2px; top: 24%; }
  body.touch #mission-result .r-title { font-size: 38px; }
  body.touch #mission-result .r-sub { font-size: 22px; }
  body.touch #wasted-screen span { font-size: 64px; }
  body.touch #dialogue { font-size: 14px; bottom: calc(12vh + 8px); width: 80vw; }
  body.touch #dialogue b { font-size: 13px; }
  body.touch #cutscene .skip { font-size: 0; }
  body.touch #cutscene .skip::after { content: 'TAP: NEXT'; font-size: 10px; }
  body.touch #bigmap .legend { display: none; }
  body.touch #fun { left: 50%; right: auto; transform: translate(-50%, -50%); max-width: 48vw; max-height: 92vh; padding: 6px 10px 6px; }
  body.touch #fun .f-title { font-size: 18px; }
  body.touch #fun canvas { max-height: 56vh; width: auto; max-width: 100%; }
  body.touch #fun .f-help { font-size: 11px; }
  body.touch #title { font-size: min(96px, 19vh); }
  body.touch #subtitle { font-size: 12px; letter-spacing: 5px; }
  body.touch #loading { margin-top: 5vh; }

  #touch { position: fixed; inset: 0; z-index: 8; pointer-events: none; user-select: none; -webkit-user-select: none; }
  #touch .tb { position: absolute; pointer-events: auto; border-radius: 50%; background: rgba(8,10,16,.42); border: 2px solid rgba(255,255,255,.5);
    color: #fff; font: 700 11px Inter, sans-serif; letter-spacing: .5px; display: flex; align-items: center; justify-content: center; flex-direction: column;
    text-align: center; line-height: 1.05; touch-action: none; transition: background .08s, transform .08s; text-shadow: 0 1px 2px #000; }
  #touch .tb svg { width: 46%; height: 46%; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; margin-bottom: 1px; }
  #touch .tb.l { font-size: 12px; border-width: 3px; }
  #touch .tb.s { font-size: 9px; }
  #touch .tb.s svg { display: none; }
  #touch .tb i { position: absolute; right: 12%; top: 8%; font: 700 8px Inter, sans-serif; font-style: normal; opacity: .65; }
  #touch .tb.on { background: rgba(255,210,63,.6); transform: scale(.94); }
  #touch .tb.toggled { background: rgba(255,210,63,.45); border-color: #ffd23f; }
  #touch .tb.fire { border-color: rgba(255,110,90,.85); }
  #touch .tb.fire.on { background: rgba(255,90,70,.6); }
  #touch .tb.gas { border-color: rgba(122,214,91,.9); }
  #touch .tb.gas.on { background: rgba(122,214,91,.55); }
  #touch .tb[hidden] { display: none; }
  #touch .tb.top { border-radius: 10px; font-size: 10px; background: rgba(8,10,16,.5); }
  #touch .stick { position: absolute; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); background: rgba(0,0,0,.18); transition: opacity .2s; }
  #touch .stick.idle { opacity: .35; }
  #touch .knob { position: absolute; left: 50%; top: 50%; width: 44%; height: 44%; transform: translate(-50%, -50%); border-radius: 50%; background: rgba(255,255,255,.55);
    box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  #touch .knob.sprint { background: rgba(255,210,63,.85); }
  #touch.cut .tb, #touch.cut .stick { display: none; }
  #touch.map .tb:not(.top) { display: none; }
  body.cutscene #touch .tb { display: none; }`;

// little line icons for the big buttons
const ICON = {
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  aim: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
  jump: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  car: '<path d="M4 15l2-6h12l2 6v4H4zM7 19v2M17 19v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/>',
  use: '<path d="M8 12V6a2 2 0 0 1 4 0v5M12 11V4a2 2 0 0 1 4 0v8M16 9a2 2 0 0 1 4 0v5a7 7 0 0 1-14 0v-2a2 2 0 0 1 4 0"/>',
  gas: '<path d="M12 4v16M6 10l6-6 6 6"/>',
  brake: '<path d="M12 20V4M6 14l6 6 6-6"/>',
  hand: '<path d="M6 18h12M12 4v14M8 8h8"/>',
  exit: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
};

// [id, label, key, mode, size, icon, x, y]  x, y: the centre, in button units from the right / bottom edge
//   mode: 'hold' (down while touched), 'tap' (a short press), 'toggle' (on / off)
const FOOT = [
  ['fire', 'FIRE', 'Mouse0', 'hold', 'l', 'fire', 1.05, 1.05],
  ['jump', 'JUMP', 'Space', 'hold', 'm', 'jump', 2.5, 0.72],
  ['aim', 'AIM', 'Mouse2', 'toggle', 'm', 'aim', 2.28, 1.95],
  ['car', 'CAR', 'KeyF', 'tap', 'm', 'car', 1.05, 2.45],
  ['use', 'USE', 'KeyE', 'tap', 's', 'use', 3.55, 0.62],
  ['roll', 'ROLL', 'KeyC', 'tap', 's', null, 3.5, 1.62],
  ['gun', 'WEAPON', 'KeyQ', 'tap', 's', null, 2.0, 3.05],
  ['reload', 'RELOAD', 'KeyR', 'tap', 's', null, 0.62, 3.38],
];
const DRIVE = [
  ['gas', 'GAS', 'KeyW', 'hold', 'l', 'gas', 1.05, 1.05],
  ['brake', 'BRAKE', 'KeyS', 'hold', 'm', 'brake', 2.5, 0.72],
  ['hand', 'DRIFT', 'Space', 'hold', 'm', 'hand', 2.28, 1.95],
  ['exit', 'EXIT', 'KeyF', 'tap', 'm', 'exit', 1.05, 2.45],
  ['nitro', 'NITRO', 'ShiftLeft', 'hold', 's', null, 3.55, 0.62],
  ['horn', 'HORN', 'KeyG', 'hold', 's', null, 3.5, 1.62],
  ['radio', 'RADIO', 'KeyR', 'tap', 's', null, 2.0, 3.05],
  ['job', 'JOB', 'KeyT', 'tap', 's', null, 0.62, 3.38],
];
const SIZE = { l: 1.4, m: 1.0, s: 0.74 };
// the keyboard key each button stands for: the game's hints ("Press E ...") still make sense
const KEYCAP = { KeyE: 'E', KeyF: 'F', KeyT: 'T', KeyR: 'R', KeyQ: 'Q', KeyC: 'C', KeyG: 'G' };

if (isTouch()) {
  const css = document.createElement('style');
  css.textContent = MOBILE_CSS;
  document.head.appendChild(css);
  document.body.classList.add('touch');
  const rot = document.createElement('div');
  rot.id = 'rotate';
  rot.innerHTML = '<div class="phone"></div><b>ROTATE YOUR PHONE</b><span>Sol City is played in landscape. Turn your phone sideways to continue.</span>';
  document.body.appendChild(rot);
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.stick = null; // { id, x0, y0 }
    this.looks = new Map(); // touch id -> { x, y } (two of them: pinch to zoom)
    this.held = new Set(); // keys the joystick holds
    this.pinch = 0;
    this.mode = '';
    this.canvas = document.querySelector('#game canvas');
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = '<div class="stick idle"><div class="knob"></div></div>';
    document.body.appendChild(root);
    this.stickEl = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');
    this.buttons = [];
    for (const [set, list] of [['foot', FOOT], ['drive', DRIVE]]) for (const b of list) this.addButton(set, ...b);
    // the small row at the top, next to the minimap
    this.addTop('MAP', () => this.tap('KeyM'));
    if (canFullscreen()) this.addTop('FULL', () => goLandscape());
    this.addTop('GFX', () => this.tap('KeyP'));
    this.quit = this.addTop('QUIT', () => this.tap('Backspace'));
    this.layout();
    addEventListener('resize', () => this.layout());

    addEventListener('touchstart', (e) => this.start(e), { passive: false });
    addEventListener('touchmove', (e) => this.move(e), { passive: false });
    addEventListener('touchend', (e) => this.end(e), { passive: false });
    addEventListener('touchcancel', (e) => this.end(e), { passive: false });
    // shops, the paint shop: tap a row to buy it (the number key it shows)
    document.getElementById('shop')?.addEventListener('click', (e) => {
      const k = e.target.closest('.s-row')?.querySelector('kbd');
      if (k && /^\d$/.test(k.textContent)) this.tap('Digit' + k.textContent);
    });
    // "get in" hint: tap it
    document.getElementById('hint')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.tap('KeyF');
    }, { passive: false });
    // held upright the game pauses (and goes quiet) behind the rotate screen
    const portrait = matchMedia('(orientation: portrait)');
    const pause = () => {
      window.__paused = portrait.matches;
      const ctx = window.__game?.audio?.ctx;
      if (ctx) portrait.matches ? ctx.suspend?.() : ctx.resume?.();
      if (portrait.matches) this.releaseAll();
    };
    portrait.addEventListener?.('change', pause);
    pause();
    goLandscape();
    const tick = () => {
      requestAnimationFrame(tick);
      this.update();
    };
    tick();
  }

  addButton(set, id, label, key, mode, size, icon, x, y) {
    const b = document.createElement('div');
    b.className = `tb ${size}${id === 'fire' ? ' fire' : id === 'gas' ? ' gas' : ''}`;
    b.innerHTML = (icon ? `<svg viewBox="0 0 24 24">${ICON[icon]}</svg>` : '') + label + (KEYCAP[key] ? `<i>${KEYCAP[key]}</i>` : '');
    this.root.appendChild(b);
    const btn = { el: b, set, id, key, mode, size, x, y, touch: null };
    this.buttons.push(btn);
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      if (mode === 'toggle') {
        const on = !b.classList.contains('toggled');
        b.classList.toggle('toggled', on);
        this.set(key, on);
        return;
      }
      if (mode === 'tap') return this.tap(key, b);
      btn.touch = t.identifier;
      b.classList.add('on');
      this.set(key, true);
      // FIRE: keep the finger down and drag it to aim while shooting
      if (id === 'fire') this.looks.set(t.identifier, { x: t.clientX, y: t.clientY, fire: true });
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      if (mode !== 'hold') return;
      for (const t of e.changedTouches) {
        if (t.identifier !== btn.touch) continue;
        btn.touch = null;
        this.looks.delete(t.identifier);
        b.classList.remove('on');
        this.set(key, false);
      }
    };
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
  }

  addTop(label, fn) {
    const b = document.createElement('div');
    b.className = 'tb s top';
    b.textContent = label;
    this.root.appendChild(b);
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('on');
      setTimeout(() => b.classList.remove('on'), 140);
      fn();
    }, { passive: false });
    this.tops = [...(this.tops || []), b];
    return b;
  }

  // sizes follow the screen's height: a thumb is a thumb on any phone
  layout() {
    const u = (this.unit = Math.max(44, Math.min(72, innerHeight * 0.165)));
    const pad = 6;
    for (const b of this.buttons) {
      const d = Math.round(u * SIZE[b.size]);
      Object.assign(b.el.style, { width: d + 'px', height: d + 'px', right: `calc(${Math.round(b.x * u - d / 2 + pad)}px + var(--safe-r, 0px))`, bottom: Math.round(b.y * u - d / 2 + pad) + 'px' });
    }
    // the top row starts right of the minimap
    let x = 168;
    for (const b of this.tops) {
      Object.assign(b.style, { left: `calc(${x}px + var(--safe-l, 0px))`, top: 'calc(8px + var(--safe-t, 0px))', width: '46px', height: '30px' });
      if (!b.hidden) x += 52;
    }
    const s = Math.round(u * 1.75);
    this.stickR = s * 0.4; // how far the knob travels
    Object.assign(this.stickEl.style, { width: s + 'px', height: s + 'px', margin: `${-s / 2}px 0 0 ${-s / 2}px` });
    if (!this.stick) this.restStick();
  }

  // where the joystick waits (faintly) when no thumb is on it
  restStick() {
    this.stickEl.classList.add('idle');
    this.stickEl.style.left = `calc(${Math.round(this.unit * 1.75)}px + var(--safe-l, 0px))`;
    this.stickEl.style.top = innerHeight - Math.round(this.unit * 1.55) + 'px';
    this.knob.style.transform = '';
    this.knob.classList.remove('sprint');
  }

  // what the game is doing decides which buttons are shown
  update() {
    const g = window.__game;
    if (!g) return;
    const driving = !!g.state?.().driving;
    const cut = !!g.story?.()?.cutscene;
    const map = !!g.hud?.mapOpen;
    const fun = !!g.fun?.()?.active;
    const mode = `${driving ? 'drive' : 'foot'}${cut ? ' cut' : ''}${map ? ' map' : ''}${fun ? ' fun' : ''}`;
    if (mode === this.mode) return;
    const was = this.mode.split(' ')[0];
    this.mode = mode;
    this.root.className = mode;
    if (was !== (driving ? 'drive' : 'foot')) this.releaseAll(true);
    for (const b of this.buttons) b.el.hidden = b.set !== (driving ? 'drive' : 'foot');
    this.quit.hidden = !fun;
    this.layout();
  }

  // let go of everything (getting in / out of a car, the phone turned upright)
  releaseAll(keepStick = false) {
    for (const b of this.buttons) {
      if (b.touch !== null || b.el.classList.contains('toggled') || b.el.classList.contains('on')) this.set(b.key, false);
      b.touch = null;
      b.el.classList.remove('on', 'toggled');
    }
    this.looks.clear();
    // in and out of a car the thumb can stay on the stick (but a sprint is not nitro)
    this.dir('ShiftLeft', false);
    if (keepStick && this.stick) return;
    for (const k of [...this.held]) this.dir(k, false);
    this.stick = null;
    this.restStick();
  }

  // press / release a key or a mouse button the way the keyboard and mouse would
  set(key, on) {
    const I = this.input;
    if (key.startsWith('Mouse')) {
      const n = Number(key.slice(5));
      if (on) {
        I.pressedOnce.add(key);
        I.buttons.add(n);
      } else I.buttons.delete(n);
      return;
    }
    if (on) {
      if (!I.keys.has(key)) I.pressedOnce.add(key);
      I.keys.add(key);
    } else I.keys.delete(key);
  }

  // a short press (long enough for a frame to see it)
  tap(key, el) {
    this.set(key, true);
    el?.classList.add('on');
    setTimeout(() => {
      this.set(key, false);
      el?.classList.remove('on');
    }, 110);
  }

  // only touches on the 3D view itself; menus, the lobby, the wallet keep theirs
  onView(t) {
    const el = t.target;
    return el === this.canvas || el === document.body || el === document.documentElement || el?.id === 'game';
  }

  start(e) {
    for (const t of e.changedTouches) {
      if (!this.onView(t)) continue;
      e.preventDefault();
      // a story scene: a tap moves the dialogue on
      if (window.__game?.story?.()?.cutscene) {
        this.tap('Space');
        continue;
      }
      if (t.clientX < innerWidth * 0.42 && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.stickEl.classList.remove('idle');
        this.stickEl.style.left = t.clientX + 'px';
        this.stickEl.style.top = t.clientY + 'px';
        this.knob.style.transform = '';
      } else if (this.looks.size < 2) {
        this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
        this.pinch = 0;
      }
    }
  }

  move(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        e.preventDefault();
        let dx = t.clientX - this.stick.x0, dy = t.clientY - this.stick.y0;
        const max = this.stickR, d = Math.hypot(dx, dy);
        // a thumb that goes far past the edge drags the stick along
        if (d > max * 1.6) {
          const k = (d - max * 1.6) / d;
          this.stick.x0 += dx * k;
          this.stick.y0 += dy * k;
          this.stickEl.style.left = this.stick.x0 + 'px';
          this.stickEl.style.top = this.stick.y0 + 'px';
          dx = t.clientX - this.stick.x0;
          dy = t.clientY - this.stick.y0;
        }
        const r = Math.min(1, Math.hypot(dx, dy) / max), a = Math.atan2(dy, dx);
        this.knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * r * max}px), calc(-50% + ${Math.sin(a) * r * max}px))`;
        // eight even directions: a key is down within 67.5 degrees of its own direction
        const on = r > 0.28;
        const near = (dir) => on && Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir))) < Math.PI * 0.375;
        this.dir('KeyD', near(0));
        this.dir('KeyS', near(Math.PI / 2));
        this.dir('KeyA', near(Math.PI));
        this.dir('KeyW', near(-Math.PI / 2));
        // on foot: all the way out is a sprint
        const sprint = r > 0.94 && !this.mode.startsWith('drive');
        this.dir('ShiftLeft', sprint);
        this.knob.classList.toggle('sprint', sprint);
        continue;
      }
      const L = this.looks.get(t.identifier);
      if (!L) continue;
      e.preventDefault();
      if (this.looks.size === 2 && ![...this.looks.values()].some((l) => l.fire)) {
        // two fingers: pinch to zoom the camera in and out
        L.x = t.clientX;
        L.y = t.clientY;
        const [p, q] = [...this.looks.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (this.pinch) this.input.wheel -= (d - this.pinch) * 4;
        this.pinch = d;
        continue;
      }
      // the view turns a little faster on small screens
      const k = 1.5 * Math.max(1, 760 / Math.max(innerWidth, 1)) ** 0.5;
      this.input.dx += (t.clientX - L.x) * k;
      this.input.dy += (t.clientY - L.y) * k;
      L.x = t.clientX;
      L.y = t.clientY;
    }
  }

  dir(key, on) {
    if (on === this.held.has(key)) return;
    if (on) this.held.add(key);
    else this.held.delete(key);
    this.set(key, on);
  }

  end(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        for (const k of [...this.held]) this.dir(k, false);
        this.restStick();
      } else if (this.looks.has(t.identifier) && !this.buttons.some((b) => b.touch === t.identifier)) {
        this.looks.delete(t.identifier);
        this.pinch = 0;
      }
    }
  }
}
