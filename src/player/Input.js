export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;
    this.onWheel = null;

    this.handleKeyDown = (event) => {
      // F5 is the camera toggle and must not reload the Electron window.
      if (event.code === 'F5') {
        event.preventDefault();
        return;
      }
      if (event.code === 'F3' || event.code === 'F11') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) {
        event.preventDefault();
      }
      this.keys.add(event.code);
    };
    this.handleKeyUp = (event) => {
      this.keys.delete(event.code);
    };
    this.handleBlur = () => {
      this.keys.clear();
      this.mouse.clear();
    };
    this.handleMouseMove = (event) => {
      if (!this.locked || !this.enabled) return;
      this.dx += event.movementX || 0;
      this.dy += event.movementY || 0;
    };
    this.handleMouseDown = (event) => {
      if (!this.locked || !this.enabled) return;
      this.mouse.add(event.button);
    };
    this.handleMouseUp = (event) => {
      this.mouse.delete(event.button);
    };
    this.handleWheelEvent = (event) => {
      if (!this.locked || !this.enabled) return;
      event.preventDefault();
      this.wheel += Math.sign(event.deltaY);
      this.onWheel?.(Math.sign(event.deltaY));
    };
    this.handlePointerLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouse.clear();
      }
      this.onLockChange?.(this.locked);
    };

    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('wheel', this.handleWheelEvent, { passive: false });
    document.addEventListener('pointerlockchange', this.handlePointerLock);
    document.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  isDown(code) {
    return this.keys.has(code);
  }

  isMouseDown(button) {
    return this.mouse.has(button);
  }

  consumeMouseDelta() {
    const result = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return result;
  }

  clearMouseButtons() {
    this.mouse.clear();
  }

  /**
   * Requests pointer lock.
   *
   * The browser only honours this call inside a user gesture (click/keydown).
   * Outside of one it throws "A user gesture is required to request Pointer
   * Lock." — which must never escape, or it would bubble up to the global
   * error handler and blank the whole game. Instead we skip the request and
   * let the caller show a "click to capture the mouse" hint.
   *
   * @returns {boolean} true when the lock was already held or the request was
   *   accepted, false when it was skipped or rejected.
   */
  requestLock() {
    if (document.pointerLockElement === this.canvas) return true;
    if (!this.hasUserActivation()) return false;
    return this.tryRequestLock({ unadjustedMovement: true }, () => this.tryRequestLock());
  }

  hasUserActivation() {
    // navigator.userActivation is available in Chromium/Electron. When it is
    // missing we still try: older engines may allow the request anyway.
    const activation = navigator.userActivation;
    if (!activation) return true;
    return activation.isActive === true;
  }

  tryRequestLock(options, fallback) {
    try {
      const result = options === undefined
        ? this.canvas.requestPointerLock()
        : this.canvas.requestPointerLock(options);
      if (result && typeof result.catch === 'function') {
        // Rejections (no gesture, unsupported options) must stay here.
        result.catch(() => {
          try {
            fallback?.();
          } catch {
            /* ignore: the caller shows a hint instead */
          }
        });
      }
      return true;
    } catch {
      // Synchronous throw: no user gesture, unsupported options, sandboxed frame.
      try {
        return fallback ? fallback() : false;
      } catch {
        return false;
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('wheel', this.handleWheelEvent);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
  }
}
