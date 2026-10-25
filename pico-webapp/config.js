// These defaults can be overridden from the HUD's Connection settings panel.
window.HUD_CONFIG = Object.freeze({
  // Use "local" while developing on a computer. Switch to "remote" on the
  // PICO headset so it loads a LAN-reachable MJPEG/image source.
  cameraSource: "local",
  raspberryPiStreamUrl: "http://raspberrypi.local:8000/stream.mjpg",
  raspberryPiHealthUrl: "http://raspberrypi.local:8000/health",
  // Stock n8n does not expose an arbitrary WebSocket broadcast route. Point
  // this at the gateway/proxy owned by the n8n integration.
  n8nDetectionWebSocketUrl: "ws://n8n-gateway.local:8081/detections",
  n8nPromptWebhookUrl: "http://n8n.local:5678/webhook/detection-prompt",
  // 360ControlUnit (ESP32) endpoints are same-origin paths served by
  // tools/hud-server.mjs, which proxies /esp/* to the ESP32 (172.20.10.5).
  // Same-origin keeps WebXR working over HTTPS without mixed-content blocking.
  // /verdict is derived from servoUrl at runtime (see js/servo.js), not
  // configured separately.
  controlUnitServoUrl: "/esp/servo",
  controlUnitModeUrl: "/esp/mode",
  // PICO 4 controller shortcuts, active only inside the AR/VR XR modes: the
  // flat 2D browser never exposes controller buttons to the page. Thumbstick
  // up/right increases the angle, down/left decreases it. Buttons use the
  // current PICO indices (1 squeeze, 3 A/X, 4 B/Y); open the HUD with
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
      leftSecondary: "auto"
    }
  },
  reconnectDelayMs: 2000,
  healthPollIntervalMs: 2000,
  healthRequestTimeoutMs: 1500,
  detectionTtlMs: 3000,
  promptTimeoutMs: 8000,
  servoRequestTimeoutMs: 5000
});
