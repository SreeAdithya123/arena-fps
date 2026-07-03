// Input sampling: raw browser events accumulate here, and sample() flattens
// them into one per-tick command object for the sim. The sim never touches
// browser APIs — a networked client ships these same commands.
//
// Glitch fixes baked in:
// - Crouch is C (Ctrl combos trigger browser shortcuts — Ctrl+W closed the tab).
// - Pointer lock uses the promise API with retry: Chrome enforces a ~1.3s
//   cooldown after exiting lock, which used to leave the mouse dead if you
//   clicked a weapon card too fast after dying.
// - Mouse deltas are clamped (Chrome occasionally reports huge movementX spikes)
//   and unadjustedMovement (raw input, no OS acceleration) is requested.
// - Keys clear when pointer lock drops, so nothing sticks through a pause.

const MAX_DELTA = 250; // px per event; anything above is a browser glitch

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0022;
    this.mouseDown = false;
    this.aimDown = false;
    this.fireEdge = false;
    this.reloadEdge = false;
    this.jumpEdge = false;
    this.locked = false;
    this.wantLock = false;
    this.onUnlock = null;
    // for viewmodel sway: mouse delta accumulated per frame
    this.frameDX = 0;
    this.frameDY = 0;
    // test seam: when set, sample() returns driven commands instead of real input
    this.drive = null;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpEdge = true;
      if (e.code === 'KeyR') this.reloadEdge = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementX));
      const dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementY));
      this.yaw -= dx * this.sensitivity;
      this.pitch -= dy * this.sensitivity;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      this.frameDX += dx;
      this.frameDY += dy;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.fireEdge = true;
      } else if (e.button === 2) {
        this.aimDown = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (this.locked) {
        this.wantLock = false;
      } else {
        this.releaseAll();
        if (this.onUnlock) this.onUnlock();
      }
    });
    // If a lock request is denied (cooldown), retry on the next user click.
    document.addEventListener('pointerlockerror', () => {
      this.wantLock = true;
    });
    document.addEventListener('click', () => {
      if (this.wantLock && !this.locked) this.lock();
    });
  }

  releaseAll() {
    this.keys.clear();
    this.mouseDown = false;
    this.aimDown = false;
  }

  lock() {
    this.wantLock = true;
    let p;
    try {
      p = this.target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      p = this.target.requestPointerLock(); // older API: returns undefined
    }
    if (p && p.catch) {
      p.catch(() => {
        // NotSupportedError => retry without raw input; otherwise cooldown —
        // wantLock stays set and the next click retries.
        const p2 = this.target.requestPointerLock();
        if (p2 && p2.catch) p2.catch(() => {});
      });
    }
  }

  unlock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setView(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  sample() {
    if (this.drive) {
      const c = this.drive();
      this.yaw = c.yaw;
      this.pitch = c.pitch;
      return c;
    }
    const k = this.keys;
    const cmd = {
      yaw: this.yaw,
      pitch: this.pitch,
      mx: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      mz: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      jumpEdge: this.jumpEdge,
      crouch: k.has('KeyC'),
      sprint: k.has('ShiftLeft'),
      aim: this.aimDown && this.locked,
      fire: this.mouseDown && this.locked,
      fireEdge: this.fireEdge && this.locked,
      reload: this.reloadEdge,
    };
    this.jumpEdge = false;
    this.fireEdge = false;
    this.reloadEdge = false;
    return cmd;
  }

  // called once per rendered frame by the viewmodel for sway
  consumeFrameDelta() {
    const d = { x: this.frameDX, y: this.frameDY };
    this.frameDX = 0;
    this.frameDY = 0;
    return d;
  }
}
