// Keyboard + mouse input with pointer lock. Polled once per frame by the game.

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  enabled = true;
  private el: HTMLElement;
  onLockChange?: (locked: boolean) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Keep the browser from scrolling / tab-focusing while playing
      if (this.locked && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'AltLeft', 'F5', 'F9'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => {
      const k = `Mouse${e.button}`;
      this.down.add(k);
      this.pressed.add(k);
    });
    window.addEventListener('mouseup', (e) => {
      const k = `Mouse${e.button}`;
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Clamp spikes some browsers emit when pointer lock engages
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => { /* user gesture required; handled by click-to-resume */ });
    } catch { /* ignore */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) { return this.enabled && this.down.has(code); }
  /** headless tests drive the game without pointer lock */
  allowUnlocked = false;
  wasPressed(code: string) {
    // mouse clicks only count while the pointer is captured (the capture click itself is ignored)
    if (code.startsWith('Mouse') && !this.locked && !this.allowUnlocked) return false;
    return this.enabled && this.pressed.has(code);
  }
  wasReleased(code: string) { return this.enabled && this.released.has(code); }
  anyPressed(...codes: string[]) { return codes.some((c) => this.wasPressed(c)); }
  anyDown(...codes: string[]) { return codes.some((c) => this.isDown(c)); }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  clear() {
    this.down.clear();
    this.endFrame();
  }
}
