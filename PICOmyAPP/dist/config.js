// These defaults can be overridden from the HUD's Connection settings panel.
window.HUD_CONFIG = Object.freeze({
  raspberryPiStreamUrl: "http://raspberrypi.local:8000/stream.mjpg",
  raspberryPiHealthUrl: "http://raspberrypi.local:8000/health",
  // Stock n8n has no WebSocket broadcast route; detection-relay/ serves this
  // on the n8n machine.
  n8nDetectionWebSocketUrl: "ws://n8n.local:8081/detections",
  n8nPromptWebhookUrl: "http://n8n.local:5678/webhook/detection-prompt",
  reconnectDelayMs: 2000,
  healthPollIntervalMs: 2000,
  healthRequestTimeoutMs: 1500,
  detectionTtlMs: 3000,
  promptTimeoutMs: 8000
});
