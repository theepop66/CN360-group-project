// PICO 4 controller shortcuts while a WebXR session is running. In the flat
// 2D browser the controller is only a pointer: page script never receives its
// buttons or thumbstick, so everything here is XR-only (AR passthrough or VR
// cinema). Pure helpers are exported separately so they stay testable with
// node --test, which cannot create a real XRSession.
//
// Current PICO controller button indices used by this deployment:
//   0 trigger, 1 squeeze (grip), 2 thumbstick click, 3 primary (A/X),
//   4 secondary (B/Y).
// The discovery helper (?xrdebug=1) logs the real indices per hand because
// the browser's reported layout can vary between controller profiles.

export const DEFAULT_CONTROLLER_SHORTCUTS = Object.freeze({
  stepDeg: 5,
  repeatMs: 220,
  firstRepeatMs: 350,
  deadzone: 0.35,
  buttonCooldownMs: 350,
  buttons: Object.freeze({
    squeeze: "sweep",
    rightPrimary: "reject",
    rightSecondary: "pass",
    leftPrimary: "manual",
    leftSecondary: "auto"
  })
});

const SQUEEZE_BUTTON = 1;
const PRIMARY_BUTTON = 3;
const SECONDARY_BUTTON = 4;

export function clampAngle(angle) {
  const value = Math.round(Number(angle));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(180, value));
}

// xr-standard puts the thumbstick on axes[2]/[3]; a gamepad that only reports
// two axes uses [0]/[1]. Returns [x, y] with gamepad signs (up is negative).
export function stickAxes(axes) {
  if (!Array.isArray(axes) || axes.length === 0) return [0, 0];
  const fourAxis = axes.length >= 4;
  return [Number(axes[fourAxis ? 2 : 0]) || 0, Number(axes[fourAxis ? 3 : 1]) || 0];
}

// Collapses both sticks to one direction: +1 increases the angle (push right
// or up), -1 decreases it (push left or down), 0 inside the deadzone.
export function stickDirection(axes, deadzone = DEFAULT_CONTROLLER_SHORTCUTS.deadzone) {
  const [x, y] = stickAxes(axes);
  const vertical = -y;
  const dominant = Math.abs(vertical) >= Math.abs(x) ? vertical : x;
  if (Math.abs(dominant) < deadzone) return 0;
  return dominant > 0 ? 1 : -1;
}

export function resolveButtonAction(
  { handedness = "", buttonIndex },
  buttons = DEFAULT_CONTROLLER_SHORTCUTS.buttons
) {
  if (buttonIndex === SQUEEZE_BUTTON) return buttons.squeeze ?? null;
  const hand = handedness === "left" || handedness === "right" ? handedness : null;
  if (!hand) return null;
  if (buttonIndex === PRIMARY_BUTTON) return buttons[`${hand}Primary`] ?? null;
  if (buttonIndex === SECONDARY_BUTTON) return buttons[`${hand}Secondary`] ?? null;
  return null;
}

// One press = one action even if the button stays held, with a cooldown so a
// chattering or doubly-reported gamepad cannot fire twice for one press.
export function createEdgeTracker({ cooldownMs = 350 } = {}) {
  const held = new Set();
  const lastFiredAt = new Map();
  return {
    update(key, isDown, now) {
      if (!isDown) {
        held.delete(key);
        return false;
      }
      const wasHeld = held.has(key);
      held.add(key);
      if (wasHeld) return false;
      const last = lastFiredAt.get(key);
      if (last !== undefined && now - last < cooldownMs) return false;
      lastFiredAt.set(key, now);
      return true;
    }
  };
}

// First tilt fires immediately, then the servo jogs at a steady cadence while
// the stick is held. Returning to centre cancels the repeat.
export function createStickRepeater({ repeatMs = 220, firstRepeatMs = 350 } = {}) {
  let direction = 0;
  let nextAt = 0;
  return {
    update(nextDirection, now) {
      if (nextDirection === 0) {
        direction = 0;
        return 0;
      }
      if (nextDirection !== direction) {
        direction = nextDirection;
        nextAt = now + firstRepeatMs;
        return nextDirection;
      }
      if (now < nextAt) return 0;
      nextAt = now + repeatMs;
      return nextDirection;
    }
  };
}

function pulse(source, intensity = 0.45, durationMs = 45) {
  const actuator = source?.gamepad?.hapticActuators?.[0];
  const result = actuator?.pulse?.(intensity, durationMs);
  Promise.resolve(result).catch(() => {});
}

export function attachXrControllerShortcuts({
  session,
  shortcuts = DEFAULT_CONTROLLER_SHORTCUTS,
  initialAngle = 0,
  onAngle = () => {},
  onAction = () => {},
  onDebug = null,
  now = () => performance.now()
} = {}) {
  if (!session?.requestAnimationFrame) {
    throw new TypeError("attachXrControllerShortcuts requires a WebXR session.");
  }

  const edges = createEdgeTracker({ cooldownMs: shortcuts.buttonCooldownMs });
  const repeater = createStickRepeater({
    repeatMs: shortcuts.repeatMs,
    firstRepeatMs: shortcuts.firstRepeatMs
  });
  let angle = clampAngle(initialAngle);
  let active = true;

  const poll = (time) => {
    if (!active) return;
    const stamp = Number.isFinite(time) ? time : now();
    let direction = 0;

    for (const source of session.inputSources ?? []) {
      const gamepad = source?.gamepad;
      if (!gamepad) continue;

      const buttons = gamepad.buttons ?? [];
      for (let index = 0; index < buttons.length; index += 1) {
        const button = buttons[index];
        const down = Boolean(button?.pressed) || Number(button?.value ?? 0) > 0.5;
        const key = `${source.handedness || "unknown"}:${index}`;
        if (!edges.update(key, down, stamp)) continue;

        const action = resolveButtonAction(
          { handedness: source.handedness, buttonIndex: index },
          shortcuts.buttons
        );
        onDebug?.(`${source.handedness || "unknown"} button ${index} → ${action ?? "unmapped"}`);
        if (action) {
          onAction(action, { handedness: source.handedness, buttonIndex: index });
          pulse(source);
        }
      }

      direction += stickDirection(gamepad.axes, shortcuts.deadzone);
    }

    const step = repeater.update(Math.sign(direction), stamp);
    if (step !== 0) {
      angle = clampAngle(angle + step * shortcuts.stepDeg);
      onAngle(angle, step);
    }

    session.requestAnimationFrame(poll);
  };

  session.requestAnimationFrame(poll);
  session.addEventListener?.("end", () => {
    active = false;
  }, { once: true });

  return {
    stop() {
      active = false;
    },
    angle() {
      return angle;
    },
    setAngle(next) {
      angle = clampAngle(next);
    }
  };
}
