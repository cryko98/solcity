// Touch controls for phones and tablets (only shown on touch screens).
//   left half:  a joystick that appears under your thumb (walk / gas, brake, steer)
//   right half: drag to look around
//   buttons:    shoot/punch, aim, jump (handbrake in a car), run (nitro in a car),
//               car in/out, E (use / talk / buy), weapon, map
// Everything is fed into the normal Input object as keys and mouse moves, so the rest of
// the game doesn't know the difference.
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.stick = null; // { id, x0, y0, dx, dy }
    this.look = null; // { id, x, y }
    this.held = new Set();
    const css = document.createElement('style');
    css.textContent = `
      #touch { position: fixed; inset: 0; z-index: 8; pointer-events: none; user-select: none; -webkit-user-select: none; }
      #touch .tb { position: absolute; pointer-events: auto; width: 62px; height: 62px; border-radius: 50%; background: rgba(0,0,0,.38);
        border: 2px solid rgba(255,255,255,.45); color: #fff; font: 700 11px Inter, sans-serif; display: flex; align-items: center; justify-content: center;
        text-align: center; line-height: 1.1; touch-action: none; }
      #touch .tb.on { background: rgba(255,210,63,.55); }
      #touch .tb.small { width: 46px; height: 46px; font-size: 10px; }
      #touch .stick { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
        background: rgba(0,0,0,.2); display: none; }
      #touch .knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,255,255,.5); }
      body.touch #help { display: none !important; }
      body.touch canvas { touch-action: none; }`;
    document.head.appendChild(css);
    document.body.classList.add('touch');
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = '<div class="stick"><div class="knob"></div></div>';
    document.body.appendChild(root);
    this.stickEl = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');
    // [label, key or mouse button, right, bottom, hold?, small?]
    const B = [
      ['SHOOT\nPUNCH', 'Mouse0', 24, 120, true],
      ['AIM', 'Mouse2', 100, 175, 'toggle'],
      ['JUMP\nBRAKE', 'Space', 100, 90, true],
      ['RUN\nNITRO', 'ShiftLeft', 24, 205, 'toggle'],
      ['CAR', 'KeyF', 24, 30, false],
      ['E', 'KeyE', 100, 20, true],
      ['GUN', 'KeyQ', 176, 20, false, true],
      ['MAP', 'KeyM', 176, 74, false, true],
    ];
    for (const [label, key, right, bottom, mode, small] of B) {
      const b = document.createElement('div');
      b.className = 'tb' + (small ? ' small' : '');
      b.style.right = right + 'px';
      b.style.bottom = bottom + 'px';
      b.innerHTML = label.replace('\n', '<br>');
      root.appendChild(b);
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mode === 'toggle') {
          const on = !b.classList.contains('on');
          b.classList.toggle('on', on);
          this.set(key, on);
          return;
        }
        b.classList.add('on');
        this.set(key, true);
        if (!mode) setTimeout(() => {
          b.classList.remove('on');
          this.set(key, false);
        }, 120);
      };
      const up = (e) => {
        e.preventDefault();
        if (mode !== true) return;
        b.classList.remove('on');
        this.set(key, false);
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    }
    addEventListener('touchstart', (e) => this.start(e), { passive: false });
    addEventListener('touchmove', (e) => this.move(e), { passive: false });
    addEventListener('touchend', (e) => this.end(e), { passive: false });
    addEventListener('touchcancel', (e) => this.end(e), { passive: false });
  }

  // press / release a key or a mouse button the way the keyboard and mouse would
  set(key, on) {
    const I = this.input;
    if (key.startsWith('Mouse')) {
      const n = Number(key.slice(5));
      if (on) {
        if (n === 0) I.pressedOnce.add('Mouse0');
        I.buttons.add(n);
      } else I.buttons.delete(n);
      return;
    }
    if (on) {
      if (!I.keys.has(key)) I.pressedOnce.add(key);
      I.keys.add(key);
    } else I.keys.delete(key);
  }

  start(e) {
    for (const t of e.changedTouches) {
      if (t.target.closest?.('.tb, #shop, #dacity, button, a')) continue;
      e.preventDefault();
      if (t.clientX < innerWidth * 0.45 && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.stickEl.style.display = 'block';
        this.stickEl.style.left = t.clientX + 'px';
        this.stickEl.style.top = t.clientY + 'px';
        this.knob.style.transform = '';
      } else if (!this.look) this.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }

  move(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        e.preventDefault();
        let dx = t.clientX - this.stick.x0, dy = t.clientY - this.stick.y0;
        const d = Math.hypot(dx, dy), max = 46;
        if (d > max) {
          dx *= max / d;
          dy *= max / d;
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        // eight-way: a key per direction once the thumb is a third of the way out
        const k = 0.35 * max;
        this.dir('KeyW', dy < -k);
        this.dir('KeyS', dy > k);
        this.dir('KeyA', dx < -k);
        this.dir('KeyD', dx > k);
      } else if (this.look && t.identifier === this.look.id) {
        e.preventDefault();
        this.input.dx += (t.clientX - this.look.x) * 1.7;
        this.input.dy += (t.clientY - this.look.y) * 1.7;
        this.look.x = t.clientX;
        this.look.y = t.clientY;
      }
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
        this.stickEl.style.display = 'none';
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) this.dir(k, false);
      } else if (this.look && t.identifier === this.look.id) this.look = null;
    }
  }
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
