export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.pressedOnce = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.dragging = false;
    this.buttons = new Set();

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.pressedOnce.add('Mouse0');
      this.buttons.add(e.button);
      this.dragging = true;
      // pointer lock can be refused (e.g. embedded frames); mouse-drag look still works then
      if (document.pointerLockElement !== dom) dom.requestPointerLock?.()?.catch?.(() => {});
    });
    addEventListener('mouseup', (e) => {
      this.dragging = false;
      this.buttons.delete(e.button);
    });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom || this.dragging) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    dom.addEventListener('wheel', (e) => {
      this.wheel += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  mouse(button) {
    return this.buttons.has(button);
  }

  pressed(code) {
    return this.pressedOnce.has(code);
  }

  consumeMouse() {
    const m = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = this.dy = this.wheel = 0;
    return m;
  }

  endFrame() {
    this.pressedOnce.clear();
  }
}
