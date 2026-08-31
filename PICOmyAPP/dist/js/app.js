import { mapBoxToDisplay, parseDetectionPayload } from "./overlay.js";
import { createDetectionOrderTracker } from "./detection-order.js";
import { sendPrompt } from "./prompt.js";

const STORAGE_KEY = "cn360-hud-connections";
const defaults = window.HUD_CONFIG ?? {};

const elements = {
  stage: document.querySelector("#video-stage"),
  stream: document.querySelector("#live-stream"),
  canvas: document.querySelector("#detection-overlay"),
  placeholder: document.querySelector("#stream-placeholder"),
  streamStatus: document.querySelector("#stream-status"),
  socketStatus: document.querySelector("#socket-status"),
  summary: document.querySelector("#detection-summary"),
  promptForm: document.querySelector("#prompt-form"),
  promptInput: document.querySelector("#prompt-input"),
  promptSubmit: document.querySelector("#prompt-submit"),
  promptFeedback: document.querySelector("#prompt-feedback"),
  settingsForm: document.querySelector("#settings-form"),
  streamUrl: document.querySelector("#stream-url"),
  healthUrl: document.querySelector("#health-url"),
  websocketUrl: document.querySelector("#websocket-url"),
  promptUrl: document.querySelector("#prompt-url"),
  resetSettings: document.querySelector("#reset-settings"),
  fullscreenButton: document.querySelector("#fullscreen-button")
};

let config = loadConfig();
let socket = null;
let reconnectTimer = null;
let streamRetryTimer = null;
let healthPollTimer = null;
let healthRequestController = null;
let healthPollGeneration = 0;
let staleTimer = null;
let latestResult = null;
const detectionOrder = createDetectionOrderTracker();
let cameraHealthState = null;
let awaitingFreshFrame = true;
let connectionGeneration = 0;
let streamConnectionGeneration = 0;
let activeStreamUrl = "";
let streamResetObserved = false;
let detachStreamListeners = () => {};

function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    streamUrl: saved.streamUrl ?? defaults.raspberryPiStreamUrl ?? "",
    healthUrl: saved.healthUrl ?? defaults.raspberryPiHealthUrl ?? "",
    websocketUrl: saved.websocketUrl ?? defaults.n8nDetectionWebSocketUrl ?? "",
    promptUrl: saved.promptUrl ?? defaults.n8nPromptWebhookUrl ?? "",
    reconnectDelayMs: Number(defaults.reconnectDelayMs) || 2000,
    healthPollIntervalMs: Number(defaults.healthPollIntervalMs) || 2000,
    healthRequestTimeoutMs: Number(defaults.healthRequestTimeoutMs) || 1500,
    detectionTtlMs: Number(defaults.detectionTtlMs) || 3000,
    promptTimeoutMs: Number(defaults.promptTimeoutMs) || 8000
  };
}

function setStatus(element, text, state = "idle") {
  element.textContent = text;
  element.className = `status status--${state}`;
}

function populateSettings() {
  elements.streamUrl.value = config.streamUrl;
  elements.healthUrl.value = config.healthUrl;
  elements.websocketUrl.value = config.websocketUrl;
  elements.promptUrl.value = config.promptUrl;
}

function hideStaleVideo() {
  elements.stream.classList.add("video-feed--hidden");
  elements.canvas.classList.add("video-feed--hidden");
  elements.placeholder.hidden = false;
  clearDetections();
}

function revealFreshVideo() {
  elements.stream.classList.remove("video-feed--hidden");
  elements.canvas.classList.remove("video-feed--hidden");
  elements.placeholder.hidden = true;
}

function isActiveStream(generation = streamConnectionGeneration) {
  return (
    generation === streamConnectionGeneration &&
    activeStreamUrl &&
    elements.stream.currentSrc === activeStreamUrl
  );
}

function markStreamLive() {
  window.clearTimeout(streamRetryTimer);
  awaitingFreshFrame = false;
  revealFreshVideo();
  setStatus(elements.streamStatus, "Camera: live", "ok");
}

function connectStream() {
  window.clearTimeout(streamRetryTimer);
  detachStreamListeners();
  streamConnectionGeneration += 1;
  const generation = streamConnectionGeneration;
  awaitingFreshFrame = true;
  hideStaleVideo();
  setStatus(elements.streamStatus, "Camera: connecting", "busy");
  activeStreamUrl = "";
  elements.stream.removeAttribute("src");
  streamResetObserved = elements.stream.naturalWidth === 0;

  const onLoad = () => {
    if (isActiveStream(generation) && cameraHealthState !== false) {
      markStreamLive();
      drawDetections();
    }
  };

  const onError = () => {
    if (!isActiveStream(generation)) return;

    awaitingFreshFrame = true;
    hideStaleVideo();
    setStatus(elements.streamStatus, "Camera: unavailable", "error");
    window.clearTimeout(streamRetryTimer);
    streamRetryTimer = window.setTimeout(() => {
      if (generation === streamConnectionGeneration) connectStream();
    }, config.reconnectDelayMs);
  };

  elements.stream.addEventListener("load", onLoad);
  elements.stream.addEventListener("error", onError);
  detachStreamListeners = () => {
    elements.stream.removeEventListener("load", onLoad);
    elements.stream.removeEventListener("error", onError);
  };

  window.requestAnimationFrame(() => {
    if (generation !== streamConnectionGeneration) return;
    streamResetObserved ||= elements.stream.naturalWidth === 0;

    try {
      const url = new URL(config.streamUrl, window.location.href);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.searchParams.set("hudStream", `${generation}-${Date.now()}`);
      }
      activeStreamUrl = url.href;
    } catch {
      activeStreamUrl = config.streamUrl;
    }

    elements.stream.src = activeStreamUrl;
  });
}

// Some Chromium builds do not emit a useful load event for a never-ending
// multipart MJPEG response. The intrinsic width becomes available after the
// first frame, so use it as a second signal that video is actually visible.
window.setInterval(() => {
  if (
    awaitingFreshFrame &&
    streamResetObserved &&
    isActiveStream() &&
    elements.stream.naturalWidth > 0 &&
    !elements.stream.complete &&
    cameraHealthState !== false
  ) {
    markStreamLive();
  }
}, 500);

function startHealthPolling() {
  healthPollGeneration += 1;
  healthRequestController?.abort();
  window.clearTimeout(healthPollTimer);
  void pollCameraHealth(healthPollGeneration);
}

async function pollCameraHealth(generation) {
  if (generation !== healthPollGeneration) return;

  const controller = new AbortController();
  healthRequestController = controller;
  const requestTimeout = window.setTimeout(
    () => controller.abort(),
    config.healthRequestTimeoutMs
  );

  try {
    const response = await fetch(config.healthUrl, {
      cache: "no-store",
      signal: controller.signal
    });
    if (generation !== healthPollGeneration) return;

    if (!response.ok) {
      cameraHealthState = false;
      awaitingFreshFrame = true;
      hideStaleVideo();
      const message = response.status === 503
        ? "Camera: unavailable"
        : `Camera: health error (${response.status})`;
      setStatus(elements.streamStatus, message, "error");
      return;
    }

    const health = await response.json();
    if (generation !== healthPollGeneration) return;
    const recovered = cameraHealthState === false;
    cameraHealthState = health.status === "ok";

    if (!cameraHealthState) {
      awaitingFreshFrame = true;
      hideStaleVideo();
      setStatus(elements.streamStatus, "Camera: unavailable", "error");
      return;
    }

    if (recovered) {
      connectStream();
    } else if (elements.stream.naturalWidth > 0 && !awaitingFreshFrame) {
      revealFreshVideo();
      setStatus(elements.streamStatus, "Camera: live", "ok");
    } else {
      setStatus(elements.streamStatus, "Camera: ready", "busy");
    }
  } catch (error) {
    if (generation !== healthPollGeneration) return;
    // A failed health read can also be caused by CORS. Let the image's own
    // load/error signal remain authoritative instead of hiding a working feed.
    cameraHealthState = null;
    if (elements.stream.naturalWidth === 0) {
      elements.placeholder.hidden = false;
      setStatus(elements.streamStatus, "Camera: health unknown", "busy");
    }
  } finally {
    window.clearTimeout(requestTimeout);
    if (healthRequestController === controller) healthRequestController = null;
    if (generation === healthPollGeneration) {
      healthPollTimer = window.setTimeout(
        () => pollCameraHealth(generation),
        config.healthPollIntervalMs
      );
    }
  }
}

function connectWebSocket() {
  window.clearTimeout(reconnectTimer);
  connectionGeneration += 1;
  const generation = connectionGeneration;

  if (socket) {
    socket.onclose = null;
    socket.close();
  }

  setStatus(elements.socketStatus, "AI data: connecting", "busy");

  try {
    socket = new WebSocket(config.websocketUrl);
  } catch (error) {
    setStatus(elements.socketStatus, "AI data: invalid URL", "error");
    scheduleReconnect(generation);
    return;
  }

  socket.addEventListener("open", () => {
    if (generation === connectionGeneration) {
      // A transport reconnect is not a camera restart. Keep ordering state;
      // only a new producer sessionId may reset its frame sequence.
      setStatus(elements.socketStatus, "AI data: connected", "ok");
    }
  });

  socket.addEventListener("message", (event) => {
    if (generation !== connectionGeneration) return;

    try {
      const parsed = parseDetectionPayload(event.data);
      if (!parsed) return;
      if (!detectionOrder.accept(parsed)) {
        console.info("Ignored an out-of-order detection result.");
        return;
      }

      latestResult = parsed;
      const count = parsed.detections.length;
      const eventTime = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
      elements.summary.textContent = count === 0
        ? "AI reports no detections"
        : `${count} detection${count === 1 ? "" : "s"} · ${eventTime.toLocaleTimeString()}`;
      setStatus(elements.socketStatus, "AI data: receiving", "ok");
      drawDetections();

      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(clearDetections, config.detectionTtlMs);
    } catch (error) {
      console.warn("Ignored invalid detection message:", error);
      setStatus(elements.socketStatus, "AI data: invalid message", "error");
    }
  });

  socket.addEventListener("error", () => {
    if (generation === connectionGeneration) {
      setStatus(elements.socketStatus, "AI data: connection error", "error");
    }
  });

  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    setStatus(elements.socketStatus, "AI data: reconnecting", "busy");
    scheduleReconnect(generation);
  });
}

function scheduleReconnect(generation) {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    if (generation === connectionGeneration) connectWebSocket();
  }, config.reconnectDelayMs);
}

function clearDetections() {
  latestResult = null;
  elements.summary.textContent = "No recent detections";
  drawDetections();
}

function drawDetections() {
  const rect = elements.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  elements.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  elements.canvas.height = Math.max(1, Math.round(rect.height * dpr));

  const context = elements.canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  if (!latestResult) return;

  const overlaySource = latestResult.source ?? {
    width: elements.stream.naturalWidth || rect.width,
    height: elements.stream.naturalHeight || rect.height
  };

  for (const detection of latestResult.detections) {
    const displayBox = mapBoxToDisplay(detection, overlaySource, {
      width: rect.width,
      height: rect.height
    });

    context.strokeStyle = detection.color;
    context.fillStyle = detection.color;
    context.lineWidth = Math.max(3, Math.min(rect.width, rect.height) / 180);
    context.strokeRect(displayBox.x, displayBox.y, displayBox.width, displayBox.height);

    const confidence = detection.confidence === null
      ? ""
      : ` ${Math.round(detection.confidence * 100)}%`;
    const label = `${detection.label}${confidence}`;
    context.font = "700 15px system-ui, sans-serif";
    const textWidth = context.measureText(label).width;
    const labelY = Math.max(0, displayBox.y - 28);
    context.fillRect(displayBox.x, labelY, textWidth + 18, 28);
    context.fillStyle = "#07110f";
    context.fillText(label, displayBox.x + 9, labelY + 19);
  }
}

elements.promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = elements.promptInput.value.trim();
  if (!prompt) return;

  elements.promptSubmit.disabled = true;
  elements.promptFeedback.className = "feedback";
  elements.promptFeedback.textContent = "Updating detection target…";

  try {
    await sendPrompt({
      url: config.promptUrl,
      prompt,
      timeoutMs: config.promptTimeoutMs
    });

    elements.promptFeedback.className = "feedback feedback--ok";
    elements.promptFeedback.textContent = `Detection target updated to “${prompt}”.`;
  } catch (error) {
    elements.promptFeedback.className = "feedback feedback--error";
    elements.promptFeedback.textContent = error.name === "AbortError"
      ? "Could not update n8n: request timed out."
      : `Could not update n8n: ${error.message}`;
  } finally {
    elements.promptSubmit.disabled = false;
  }
});

elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const previousWebsocketUrl = config.websocketUrl;
  config = {
    ...config,
    streamUrl: elements.streamUrl.value.trim(),
    healthUrl: elements.healthUrl.value.trim(),
    websocketUrl: elements.websocketUrl.value.trim(),
    promptUrl: elements.promptUrl.value.trim()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  if (config.websocketUrl !== previousWebsocketUrl) detectionOrder.reset();
  clearDetections();
  connectStream();
  startHealthPolling();
  connectWebSocket();
});

elements.resetSettings.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  config = loadConfig();
  populateSettings();
});

elements.fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await elements.stage.requestFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen is unavailable:", error);
  }
});

if ("ResizeObserver" in window) {
  new ResizeObserver(drawDetections).observe(elements.stage);
} else {
  window.addEventListener("resize", drawDetections);
}
populateSettings();
connectStream();
startHealthPolling();
connectWebSocket();
