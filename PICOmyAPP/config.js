// These defaults can be overridden from the HUD's Connection settings panel.
window.HUD_CONFIG = Object.freeze({
  raspberryPiStreamUrl: "http://raspberrypi.local:8000/stream.mjpg",
  raspberryPiHealthUrl: "http://raspberrypi.local:8000/health",
  // Stock n8n does not expose an arbitrary WebSocket broadcast route. Point
  // this at the gateway/proxy owned by the n8n integration.
  n8nDetectionWebSocketUrl: "ws://n8n-gateway.local:8081/detections",
  n8nPromptWebhookUrl: "http://n8n.local:5678/webhook/detection-prompt",
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
