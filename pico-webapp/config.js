// These defaults can be overridden from the HUD's Connection settings panel.
//
// The detection relay (relay/) and n8n normally run on the same machine that
// serves this page, so their defaults follow the page's own host. Point them
// elsewhere in Connection settings if they live on another machine.
const HUD_PAGE_HOST = window.location.hostname || "localhost";
// Match the page's scheme: an https page may not call plain http/ws.
const HUD_PAGE_IS_HTTPS = window.location.protocol === "https:";
const HUD_SOCKET_SCHEME = HUD_PAGE_IS_HTTPS ? "wss" : "ws";
const HUD_HTTP_SCHEME = HUD_PAGE_IS_HTTPS ? "https" : "http";

window.HUD_CONFIG = Object.freeze({
  // Use "local" while developing on a computer. Switch to "remote" on the
  // PICO headset so it loads a LAN-reachable MJPEG/image source.
  cameraSource: "local",
  raspberryPiStreamUrl: "http://raspberrypi.local:8000/stream.mjpg",
  raspberryPiHealthUrl: "http://raspberrypi.local:8000/health",
  // Stock n8n cannot broadcast to a WebSocket; n8n POSTs to relay/ and the
  // relay fans each message out on this socket.
  n8nDetectionWebSocketUrl: `${HUD_SOCKET_SCHEME}://${HUD_PAGE_HOST}:8081/detections`,
  n8nPromptWebhookUrl: `${HUD_HTTP_SCHEME}://${HUD_PAGE_HOST}:5678/webhook/detection-prompt`,
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
