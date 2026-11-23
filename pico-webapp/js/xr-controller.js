// PICO 4 controller shortcuts while a WebXR session is running. In the flat
// 2D browser the controller is only a pointer: page script never receives its
// buttons or thumbstick, so everything here is XR-only (AR passthrough or VR
// cinema). Pure helpers are exported separately so they stay testable with
// node --test, which cannot create a real XRSession.
//
// Current PICO controller button indices used by this deployment:
//   0 trigger, 1 squeeze (grip), 2 unused touchpad placeholder,
//   3 thumbstick click, 4 primary (A/X), 5 secondary (B/Y).
// Source: immersive-web/webxr-input-profiles, registry/profiles/pico/pico-4.json.
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
    leftSecondary: "auto",
    leftStick: "reset-zoom"
  })
});

const SQUEEZE_BUTTON = 1;
const THUMBSTICK_BUTTON = 3;
const PRIMARY_BUTTON = 4;
const SECONDARY_BUTTON = 5;

export function controllerButtonLabel(handedness, buttonIndex) {
  if (buttonIndex === 0) return "Trigger";
  if (buttonIndex === SQUEEZE_BUTTON) return "Grip";
  if (buttonIndex === THUMBSTICK_BUTTON) return "Stick click";
  if (buttonIndex === PRIMARY_BUTTON) return handedness === "left" ? "X" : "A";
  if (buttonIndex === SECONDARY_BUTTON) return handedness === "left" ? "Y" : "B";
  return `Button ${buttonIndex}`;
}

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

// Collapses one stick's axes to a direction: +1 increases the angle (push right
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
  const hand = handedness === "left" || handedness === "right" ? handedness : null;
  if (!hand) return null;
  if (buttonIndex === SQUEEZE_BUTTON) return buttons.squeeze ?? null;
  if (buttonIndex === THUMBSTICK_BUTTON && hand === "left") return buttons.leftStick ?? null;
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
    releaseMissing(keys) {
      for (const key of held) if (!keys.has(key)) held.delete(key);
    },
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
  // Haptics are optional. Driver errors must not stop input polling.
  try {
    const actuator = source?.gamepad?.hapticActuators?.[0];
    const result = actuator?.pulse?.(intensity, durationMs);
    Promise.resolve(result).catch(() => {});
  } catch { /* Controller input remains usable without vibration. */ }
}

export function attachXrControllerShortcuts({
  session,
  shortcuts = DEFAULT_CONTROLLER_SHORTCUTS,
  initialAngle = 0,
  onAngle = () => {},
  onCameraZoom = () => {},
  onConveyor = () => {},
  onStop = () => {},
  onAction = () => {},
  onDebug = null,
  now = () => performance.now()
} = {}) {
  if (!session?.requestAnimationFrame) {
    throw new TypeError("attachXrControllerShortcuts requires a WebXR session.");
  }

  shortcuts = {
    ...DEFAULT_CONTROLLER_SHORTCUTS,
    ...shortcuts,
    buttons: { ...DEFAULT_CONTROLLER_SHORTCUTS.buttons, ...shortcuts?.buttons }
  };
  const edges = createEdgeTracker({ cooldownMs: shortcuts.buttonCooldownMs });
  const repeater = createStickRepeater({
    repeatMs: shortcuts.repeatMs,
    firstRepeatMs: shortcuts.firstRepeatMs
  });
  const zoomRepeater = createStickRepeater({ repeatMs: shortcuts.repeatMs, firstRepeatMs: shortcuts.firstRepeatMs });
  let angle = clampAngle(initialAngle);
  let active = true;

  const poll = (time) => {
    if (!active) return;
    const stamp = Number.isFinite(time) ? time : now();
    let direction = 0;
    let zoomDirection = 0;
    let zoomReset = false;
    let conveyorDirection = null;
    const observedButtons = new Set();

    for (const source of session.inputSources ?? []) {
      const gamepad = source?.gamepad;
      if (!gamepad || gamepad.connected === false) continue;

      const buttons = gamepad.buttons ?? [];
      for (let index = 0; index < buttons.length; index += 1) {
        const button = buttons[index];
        const down = Boolean(button?.pressed) || Number(button?.value ?? 0) > 0.5;
        const key = `${source.handedness || "unknown"}:${index}`;
        observedButtons.add(key);
        if (!edges.update(key, down, stamp)) continue;

        const action = resolveButtonAction(
          { handedness: source.handedness, buttonIndex: index },
          shortcuts.buttons
        );
        onDebug?.(`${source.handedness || "unknown"} ${controllerButtonLabel(source.handedness, index)} [${index}] -> ${action ?? "no shortcut"}`);
        if (action) {
          if (action === "reset-zoom") {
            zoomReset = true; onCameraZoom("reset");
          } else {
            onAction(action, { handedness: source.handedness, buttonIndex: index });
          }
          pulse(source);
        }
      }

      if (source.handedness === "right") {
        direction += stickDirection(gamepad.axes, shortcuts.deadzone);
      }
      if (source.handedness === "left") {
        const horizontal = stickAxes(gamepad.axes)[0];
        if (Math.abs(horizontal) >= (shortcuts.deadzone ?? DEFAULT_CONTROLLER_SHORTCUTS.deadzone)) zoomDirection += Math.sign(horizontal);
        const axes = gamepad.axes;
        const index = axes?.length >= 4 ? 3 : 1;
        if (Number.isFinite(axes?.[index])) {
          const y = axes[index];
          conveyorDirection = Math.abs(y) >= (shortcuts.deadzone ?? DEFAULT_CONTROLLER_SHORTCUTS.deadzone) ? (y < 0 ? 1 : -1) : 0;
        }
      }
    }

    edges.releaseMissing(observedButtons);
    onConveyor(conveyorDirection);

    const step = repeater.update(Math.sign(direction), stamp);
    if (step !== 0) {
      angle = clampAngle(angle + step * shortcuts.stepDeg);
      onAngle(angle, step);
    }
    const zoomStep = zoomRepeater.update(zoomReset ? 0 : Math.sign(zoomDirection), stamp);
    if (zoomStep !== 0) {
      onCameraZoom(zoomStep > 0 ? "in" : "out");
    }

    session.requestAnimationFrame(poll);
  };

  session.requestAnimationFrame(poll);
  session.addEventListener?.("end", () => {
    active = false;
    onStop();
  }, { once: true });

  return {
    stop() {
      active = false;
      onStop();
    },
    angle() {
      return angle;
    },
    setAngle(next) {
      angle = clampAngle(next);
    }
  };
}
