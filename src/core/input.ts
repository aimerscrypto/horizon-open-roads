// Keyboard (and basic gamepad) input.
import { CarInput } from '../vehicle/physics';

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  enabled = true;
  constructor() {
    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }
  /** true once per key press */
  hit(...codes: string[]): boolean { for (const c of codes) if (this.pressed.has(c)) return true; return false; }
  held(...codes: string[]): boolean { for (const c of codes) if (this.down.has(c)) return true; return false; }
  endFrame() { this.pressed.clear(); }
  read(out: CarInput): CarInput {
    out.accel = this.held('KeyW', 'ArrowUp') ? 1 : 0; out.decel = this.held('KeyS', 'ArrowDown') ? 1 : 0;
    out.steer = (this.held('KeyD', 'ArrowRight') ? 1 : 0) - (this.held('KeyA', 'ArrowLeft') ? 1 : 0);
    out.handbrake = this.held('Space'); out.boost = this.held('ShiftLeft', 'ShiftRight');
    const gp = navigator.getGamepads?.()[0];
    if (gp && gp.connected) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) out.steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.6);
      out.accel = Math.max(out.accel, gp.buttons[7]?.value || 0); out.decel = Math.max(out.decel, gp.buttons[6]?.value || 0);
      out.handbrake = out.handbrake || !!gp.buttons[0]?.pressed; out.boost = out.boost || !!gp.buttons[2]?.pressed;
    }
    if (!this.enabled) { out.accel = out.decel = out.steer = 0; out.handbrake = false; out.boost = false; }
    return out;
  }
}
