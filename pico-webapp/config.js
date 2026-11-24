// These defaults can be overridden from the HUD's Connection settings panel.
window.HUD_CONFIG = Object.freeze({
  // Use "local" while developing on a computer. Switch to "remote" on the
  // PICO headset so it loads a LAN-reachable MJPEG/image source.
  cameraSource: "local",
  raspberryPiStreamUrl: "http://raspberrypi.local:8000/stream.mjpg",
  raspberryPiHealthUrl: "http://raspberrypi.local:8000/health",
  // hud-server proxies this same-origin channel to the relay. HTTPS pages use
  // wss:// so WebXR does not block the overlay as mixed content.
  n8nDetectionWebSocketUrl: (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/detections",
  n8nPromptWebhookUrl: "http://n8n.local:5678/webhook/detection-prompt",
  // "Take a photo" (left Y button, or Capture & inspect in the 2D panel): one unpaired n8n
  // inspection. hud-server forwards this same-origin path to its --n8n-origin, so it works
  // over the HTTPS page WebXR needs. The n8n workflow must be active.
  captureWebhookUrl: "/n8n/inspect-now",
  // 360ControlUnit (ESP32) endpoints are same-origin paths served by
  // tools/hud-server.mjs, which proxies /esp/* to the ESP32 (172.20.10.5).
  // Same-origin keeps WebXR working over HTTPS without mixed-content blocking.
  // /verdict is derived from servoUrl at runtime (see js/servo.js), not
  // configured separately.
  controlUnitServoUrl: "/esp/servo",
  controlUnitModeUrl: "/esp/mode",
  // PICO 4 controller shortcuts, active only inside the AR/VR XR modes: the
  // flat 2D browser never exposes controller buttons to the page. The right
  // stick controls the servo. Left up/down controls the conveyor, left/right
  // zooms the paired phone camera, and left stick click resets to 1x.
  // Camera control needs the phone pairing code entered in Connection settings.
  // Left Y ("capture") takes a photo: one n8n inspection that only advises the operator.
  // Auto mode has no controller button any more; use the Auto toggle in the 2D panel.
  // Buttons use the
  // PICO xr-standard indices (1 grip, 3 stick click, 4 A/X, 5 B/Y); open the HUD with
  // ?xrdebug=1 to log the real indices if PICO reports a different layout.
  controllerShortcuts: {
    stepDeg: 5,
    repeatMs: 220,
    firstRepeatMs: 350,
    deadzone: 0.35,
    buttonCooldownMs: 350,
    buttons: {
      squeeze: "sweep",
      rightPrimary: "reject",
      rightSecondary: "pass",
      leftPrimary: "manual",
      leftSecondary: "capture",
      leftStick: "reset-zoom"
    }
  },
  reconnectDelayMs: 2000,
  healthPollIntervalMs: 2000,
  healthRequestTimeoutMs: 1500,
  detectionTtlMs: 3000,
  promptTimeoutMs: 8000,
  servoRequestTimeoutMs: 5000,
  // hud-server gives up on n8n after 12 s, so wait a little longer than that.
  captureTimeoutMs: 15000
});
