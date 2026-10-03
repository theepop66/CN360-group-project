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
  // 360ControlUnit (ESP32) defaults — matches the static IP in
  // 360ControlUnit/src/main.cpp. /verdict is derived from servoUrl at
  // runtime (see js/servo.js), not configured separately.
  controlUnitServoUrl: "http://192.168.1.50/servo",
  controlUnitModeUrl: "http://192.168.1.50/mode",
  reconnectDelayMs: 2000,
  healthPollIntervalMs: 2000,
  healthRequestTimeoutMs: 1500,
  detectionTtlMs: 3000,
  promptTimeoutMs: 8000,
  servoRequestTimeoutMs: 5000
});
