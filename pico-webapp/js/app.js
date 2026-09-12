import { getCoveredImageRect, mapBoxToDisplay, parseDetectionPayload } from "./overlay.js";
import { createDetectionOrderTracker } from "./detection-order.js";
import { sendPrompt } from "./prompt.js";
import { parseCameraMessage } from "./camera-message.js";
import { VIEW_MODES, isImmersiveArSupported, isImmersiveVrSupported } from "./xr-modes.js";
import { startArPassthrough } from "./ar-passthrough.js";
import { startVrCinema } from "./vr-cinema.js";
import { installXrEmulatorIfRequested } from "./dev-xr-emulator.js";

const STORAGE_KEY = "cn360-hud-connections";
const defaults = window.HUD_CONFIG ?? {};

const elements = {
  appShell: document.querySelector(".app-shell"),
  stage: document.querySelector("#video-stage"),
  stream: document.querySelector("#live-stream"),
  snapshot: document.querySelector("#n8n-frame"),
  webcam: document.querySelector("#local-webcam"),
  canvas: document.querySelector("#detection-overlay"),
  vrCompositeCanvas: document.querySelector("#vr-composite-canvas"),
  modeButtons: document.querySelectorAll(".mode-button"),
  placeholder: document.querySelector("#stream-placeholder"),
  placeholderMessage: document.querySelector("#stream-placeholder-message"),
  streamStatus: document.querySelector("#stream-status"),
  socketStatus: document.querySelector("#socket-status"),
  summary: document.querySelector("#detection-summary"),
  promptForm: document.querySelector("#prompt-form"),
  promptInput: document.querySelector("#prompt-input"),
  promptSubmit: document.querySelector("#prompt-submit"),
  promptFeedback: document.querySelector("#prompt-feedback"),
  settingsForm: document.querySelector("#settings-form"),
  cameraSource: document.querySelector("#camera-source"),
  streamUrl: document.querySelector("#stream-url"),
  healthUrl: document.querySelector("#health-url"),
  websocketUrl: document.querySelector("#websocket-url"),
  promptUrl: document.querySelector("#prompt-url"),
  resetSettings: document.querySelector("#reset-settings"),
  fullscreenButton: document.querySelector("#fullscreen-button"),
  viewerToolbar: document.querySelector(".viewer-toolbar")
};

// Where the prompt form lives outside fullscreen, so it can be moved back
// there when the user exits fullscreen (see the fullscreenchange handler).
const promptFormHome = {
  parent: elements.promptForm.parentElement,
  nextSibling: elements.promptForm.nextElementSibling
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
let activeStreamRequiresHealth = false;
let streamResetObserved = false;
let detachStreamListeners = () => {};
let localWebcamStream = null;
let localWebcamGeneration = 0;
let n8nFrameGeneration = 0;
let n8nFrameTimer = null;
let pendingN8nFrame = null;
let currentViewMode = VIEW_MODES.FLAT;
let activeXrController = null;
let vrRenderLoopHandle = null;

function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  const cameraSource = saved.cameraSource ?? defaults.cameraSource;
  return {
    cameraSource: cameraSource === "remote" ? "remote" : "local",
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
  elements.cameraSource.value = config.cameraSource;
  elements.streamUrl.value = config.streamUrl;
  elements.healthUrl.value = config.healthUrl;
  elements.websocketUrl.value = config.websocketUrl;
  elements.promptUrl.value = config.promptUrl;
}

function setPlaceholder(message) {
  elements.placeholderMessage.textContent = message;
  elements.placeholder.hidden = false;
}

function hideStaleVideo(message = "Waiting for a camera source…") {
  elements.stream.classList.add("video-feed--hidden");
  elements.snapshot.classList.add("video-feed--hidden");
  elements.webcam.classList.add("video-feed--hidden");
  elements.canvas.classList.add("video-feed--hidden");
  setPlaceholder(message);
  clearDetections();
}

function revealFreshVideo(mediaElement = elements.stream) {
  elements.stream.classList.toggle("video-feed--hidden", mediaElement !== elements.stream);
  elements.snapshot.classList.toggle("video-feed--hidden", mediaElement !== elements.snapshot);
  elements.webcam.classList.toggle("video-feed--hidden", mediaElement !== elements.webcam);
  elements.canvas.classList.remove("video-feed--hidden");
  elements.placeholder.hidden = true;
}

function activeMediaElement() {
  if (config.cameraSource === "local") return elements.webcam;
  return isN8nFrameVisible() ? elements.snapshot : elements.stream;
}

function activeMediaDimensions() {
  const media = activeMediaElement();
  if (media === elements.webcam) {
    return { width: media.videoWidth, height: media.videoHeight };
  }
  return { width: media.naturalWidth, height: media.naturalHeight };
}

function isN8nFrameVisible() {
  return !elements.snapshot.classList.contains("video-feed--hidden");
}

function isActiveStream(generation = streamConnectionGeneration) {
  return (
    generation === streamConnectionGeneration &&
    activeStreamUrl &&
    elements.stream.currentSrc === activeStreamUrl
  );
}

function remoteHealthAllowsDisplay() {
  return !activeStreamRequiresHealth || cameraHealthState !== false;
}

function markStreamLive(statusText = "Camera: remote live") {
  window.clearTimeout(streamRetryTimer);
  awaitingFreshFrame = false;
  revealFreshVideo(elements.stream);
  setStatus(elements.streamStatus, statusText, "ok");
}

function stopRemoteStream() {
  window.clearTimeout(streamRetryTimer);
  detachStreamListeners();
  streamConnectionGeneration += 1;
  activeStreamUrl = "";
  activeStreamRequiresHealth = false;
  awaitingFreshFrame = true;
  elements.stream.removeAttribute("src");
  elements.stream.classList.add("video-feed--hidden");
}

function sourceWithCacheKey(source, keyName, generation) {
  try {
    const url = new URL(source, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.searchParams.set(keyName, `${generation}-${Date.now()}`);
    }
    return url.href;
  } catch {
    return source;
  }
}

function showRemoteSource(source, {
  cacheKey = "",
  retryOnError = false,
  requiresHealth = false,
  connectingText = "Camera: connecting",
  liveText = "Camera: remote live"
} = {}) {
  if (config.cameraSource !== "remote") return;

  window.clearTimeout(streamRetryTimer);
  detachStreamListeners();
  streamConnectionGeneration += 1;
  const generation = streamConnectionGeneration;
  awaitingFreshFrame = true;
  hideStaleVideo("Connecting to remote camera…");
  setStatus(elements.streamStatus, connectingText, "busy");
  activeStreamUrl = "";
  activeStreamRequiresHealth = requiresHealth;
  elements.stream.removeAttribute("src");
  streamResetObserved = elements.stream.naturalWidth === 0;

  const onLoad = () => {
    if (isActiveStream(generation) && remoteHealthAllowsDisplay()) {
      markStreamLive(liveText);
      drawDetections();
    }
  };

  const onError = () => {
    if (!isActiveStream(generation)) return;

    awaitingFreshFrame = true;
    hideStaleVideo("Remote camera could not be loaded.");
    setStatus(elements.streamStatus, "Camera: unavailable", "error");
    if (retryOnError) {
      window.clearTimeout(streamRetryTimer);
      streamRetryTimer = window.setTimeout(() => {
        if (generation === streamConnectionGeneration) connectStream();
      }, config.reconnectDelayMs);
    }
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
    activeStreamUrl = cacheKey ? sourceWithCacheKey(source, cacheKey, generation) : source;
    elements.stream.src = activeStreamUrl;
  });
}

function connectStream() {
  if (config.cameraSource !== "remote") return;
  if (!config.streamUrl) {
    stopRemoteStream();
    hideStaleVideo("Waiting for a remote URL or n8n camera.source message…");
    setStatus(elements.streamStatus, "Camera: waiting for remote source", "busy");
    return;
  }

  showRemoteSource(config.streamUrl, {
    cacheKey: "hudStream",
    retryOnError: true,
    requiresHealth: Boolean(config.healthUrl)
  });
}

function stopLocalWebcam() {
  localWebcamGeneration += 1;
  for (const track of localWebcamStream?.getTracks?.() ?? []) track.stop();
  localWebcamStream = null;
  elements.webcam.srcObject = null;
  elements.webcam.classList.add("video-feed--hidden");
}

function localCameraErrorMessage(error) {
  if (!window.isSecureContext) return "Local webcam requires HTTPS or localhost.";
  if (error?.name === "NotAllowedError") return "Camera permission was denied.";
  if (error?.name === "NotFoundError") return "No webcam was found on this device.";
  if (error?.name === "NotReadableError") return "The webcam is already in use by another app.";
  return `Could not start the local webcam${error?.message ? `: ${error.message}` : "."}`;
}

async function startLocalWebcam() {
  const generation = ++localWebcamGeneration;
  let mediaStream = null;
  let markLocalLive = null;
  hideStaleVideo("Allow camera access to start the local webcam…");
  setStatus(elements.streamStatus, "Camera: requesting permission", "busy");

  if (!navigator.mediaDevices?.getUserMedia) {
    const message = window.isSecureContext
      ? "This browser does not expose a webcam API."
      : "Local webcam requires HTTPS or localhost.";
    setPlaceholder(message);
    setStatus(elements.streamStatus, "Camera: unavailable", "error");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (generation !== localWebcamGeneration || config.cameraSource !== "local") {
      for (const track of mediaStream.getTracks()) track.stop();
      return;
    }

    localWebcamStream = mediaStream;
    markLocalLive = () => {
      if (generation !== localWebcamGeneration || config.cameraSource !== "local") return;
      revealFreshVideo(elements.webcam);
      setStatus(elements.streamStatus, "Camera: local live", "ok");
      drawDetections();
    };

    elements.webcam.addEventListener("loadedmetadata", markLocalLive, { once: true });
    elements.webcam.addEventListener("playing", markLocalLive, { once: true });
    elements.webcam.srcObject = mediaStream;
    await elements.webcam.play();
    if (elements.webcam.videoWidth > 0) markLocalLive();

    for (const track of mediaStream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (generation !== localWebcamGeneration || config.cameraSource !== "local") return;
        hideStaleVideo("The local webcam stopped.");
        setStatus(elements.streamStatus, "Camera: stopped", "error");
      }, { once: true });
    }
  } catch (error) {
    if (markLocalLive) {
      elements.webcam.removeEventListener("loadedmetadata", markLocalLive);
      elements.webcam.removeEventListener("playing", markLocalLive);
    }
    for (const track of mediaStream?.getTracks?.() ?? []) track.stop();
    if (localWebcamStream === mediaStream) {
      localWebcamStream = null;
      elements.webcam.srcObject = null;
    }
    if (generation !== localWebcamGeneration || config.cameraSource !== "local") return;
    setPlaceholder(localCameraErrorMessage(error));
    setStatus(elements.streamStatus, "Camera: unavailable", "error");
  }
}

function connectCamera() {
  stopN8nFrame();
  stopLocalWebcam();
  stopRemoteStream();
  stopHealthPolling();
  cameraHealthState = null;

  if (config.cameraSource === "local") {
    void startLocalWebcam();
  } else {
    connectStream();
    startHealthPolling();
  }
}

function applyRemoteCameraSource(command) {
  config = {
    ...config,
    cameraSource: "remote",
    streamUrl: command.streamUrl,
    healthUrl: command.healthUrl
  };
  populateSettings();
  detectionOrder.reset();
  clearDetections();
  connectCamera();
}

function stopN8nFrame() {
  n8nFrameGeneration += 1;
  window.clearTimeout(n8nFrameTimer);
  pendingN8nFrame = null;
  elements.snapshot.classList.add("video-feed--hidden");
  elements.snapshot.removeAttribute("src");
}

function restoreLiveRemoteFeed() {
  stopN8nFrame();
  if (config.cameraSource !== "remote") return;

  if (
    isActiveStream() &&
    elements.stream.naturalWidth > 0 &&
    !awaitingFreshFrame &&
    remoteHealthAllowsDisplay()
  ) {
    revealFreshVideo(elements.stream);
    setStatus(elements.streamStatus, "Camera: remote live", "ok");
    drawDetections();
    return;
  }

  connectStream();
}

function showN8nFrame(imageUrl, {
  clearOverlayOnDisplay = false,
  deferOverlay = false,
  returnToLive = false
} = {}) {
  if (config.cameraSource !== "remote") return;

  n8nFrameGeneration += 1;
  const generation = n8nFrameGeneration;
  window.clearTimeout(n8nFrameTimer);
  if (deferOverlay) elements.canvas.classList.add("video-feed--hidden");
  setStatus(elements.streamStatus, "Camera: loading n8n frame", "busy");

  const candidate = new Image();
  candidate.id = "n8n-frame";
  candidate.className = "camera-feed video-feed--hidden";
  candidate.alt = "Analyzed inspection frame received from n8n";
  candidate.decoding = "async";
  pendingN8nFrame = candidate;

  candidate.addEventListener("load", () => {
    if (generation !== n8nFrameGeneration || config.cameraSource !== "remote") return;

    elements.snapshot.replaceWith(candidate);
    elements.snapshot = candidate;
    pendingN8nFrame = null;
    if (clearOverlayOnDisplay) clearDetections();
    revealFreshVideo(candidate);
    setStatus(elements.streamStatus, "Camera: n8n frame", "ok");
    drawDetections();

    if (returnToLive) {
      n8nFrameTimer = window.setTimeout(() => {
        if (generation !== n8nFrameGeneration) return;
        clearDetections();
        restoreLiveRemoteFeed();
      }, config.detectionTtlMs);
    }
  }, { once: true });

  candidate.addEventListener("error", () => {
    if (generation !== n8nFrameGeneration || config.cameraSource !== "remote") return;

    pendingN8nFrame = null;
    if (deferOverlay) {
      elements.canvas.classList.remove("video-feed--hidden");
      drawDetections();
    }

    if (isN8nFrameVisible()) {
      setStatus(elements.streamStatus, "Camera: n8n frame", "ok");
    } else if (isActiveStream() && elements.stream.naturalWidth > 0) {
      setStatus(elements.streamStatus, "Camera: remote live", "ok");
    } else {
      setStatus(elements.streamStatus, "Camera: n8n frame unavailable", "error");
    }
    console.warn("Could not load the n8n camera frame.");
  }, { once: true });

  candidate.src = imageUrl;
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
    remoteHealthAllowsDisplay()
  ) {
    markStreamLive();
  }
}, 500);

function stopHealthPolling() {
  healthPollGeneration += 1;
  healthRequestController?.abort();
  healthRequestController = null;
  window.clearTimeout(healthPollTimer);
}

function startHealthPolling() {
  stopHealthPolling();
  if (config.cameraSource !== "remote" || !config.healthUrl) return;
  void pollCameraHealth(healthPollGeneration);
}

async function pollCameraHealth(generation) {
  if (
    generation !== healthPollGeneration ||
    config.cameraSource !== "remote" ||
    !config.healthUrl
  ) return;

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
      if (isN8nFrameVisible()) return;
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
      if (isN8nFrameVisible()) return;
      hideStaleVideo();
      setStatus(elements.streamStatus, "Camera: unavailable", "error");
      return;
    }

    if (isN8nFrameVisible()) return;

    if (recovered) {
      connectStream();
    } else if (elements.stream.naturalWidth > 0 && !awaitingFreshFrame) {
      revealFreshVideo(elements.stream);
      setStatus(elements.streamStatus, "Camera: remote live", "ok");
    } else {
      setStatus(elements.streamStatus, "Camera: ready", "busy");
    }
  } catch (error) {
    if (generation !== healthPollGeneration) return;
    // A failed health read can also be caused by CORS. Let the image's own
    // load/error signal remain authoritative instead of hiding a working feed.
    cameraHealthState = null;
    if (!isN8nFrameVisible() && elements.stream.naturalWidth === 0) {
      elements.placeholder.hidden = false;
      setStatus(elements.streamStatus, "Camera: health unknown", "busy");
    }
  } finally {
    window.clearTimeout(requestTimeout);
    if (healthRequestController === controller) healthRequestController = null;
    if (
      generation === healthPollGeneration &&
      config.cameraSource === "remote" &&
      config.healthUrl
    ) {
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
      const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const cameraMessage = parseCameraMessage(payload);

      if (cameraMessage?.kind === "source") {
        applyRemoteCameraSource(cameraMessage);
        setStatus(elements.socketStatus, "AI data: camera source received", "ok");
        return;
      }

      const hasDetectionData = payload?.type === "detections"
        || payload?.detections !== undefined
        || payload?.boxes !== undefined
        || payload?.bbox !== undefined
        || payload?.box !== undefined;
      if (cameraMessage?.kind === "frame" && !hasDetectionData) {
        if (config.cameraSource === "remote") {
          showN8nFrame(cameraMessage.imageUrl, {
            clearOverlayOnDisplay: true,
            returnToLive: true
          });
        }
        setStatus(elements.socketStatus, "AI data: frame received", "ok");
        return;
      }

      const parsed = parseDetectionPayload(payload);
      if (!parsed) return;
      if (!detectionOrder.accept(parsed)) {
        console.info("Ignored an out-of-order detection result.");
        return;
      }

      latestResult = parsed;
      const count = parsed.detections.length;
      const eventTime = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
      setSummary(count === 0
        ? "AI reports no detections"
        : `${count} detection${count === 1 ? "" : "s"} · ${eventTime.toLocaleTimeString()}`);
      setStatus(elements.socketStatus, "AI data: receiving", "ok");

      if (cameraMessage?.kind === "frame" && config.cameraSource === "remote") {
        showN8nFrame(cameraMessage.imageUrl, { deferOverlay: true });
      } else {
        if (isN8nFrameVisible() || pendingN8nFrame) restoreLiveRemoteFeed();
        drawDetections();
      }

      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        clearDetections();
        if (isN8nFrameVisible() || pendingN8nFrame) restoreLiveRemoteFeed();
      }, config.detectionTtlMs);
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

function setSummary(text) {
  elements.summary.textContent = text;
  activeXrController?.setSummaryText?.(text);
}

function clearDetections() {
  latestResult = null;
  setSummary("No recent detections");
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

  const mediaDimensions = activeMediaDimensions();
  const overlaySource = latestResult.source ?? {
    width: mediaDimensions.width || rect.width,
    height: mediaDimensions.height || rect.height
  };

  for (const detection of latestResult.detections) {
    const displayBox = mapBoxToDisplay(detection, overlaySource, {
      width: rect.width,
      height: rect.height
    }, "cover");

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

// Fixed resolution for the VR screen texture. It must NOT track the 2D
// detection-overlay canvas's live (dpr-scaled, layout-dependent) size:
// resizing a <canvas> that a three.js CanvasTexture is actively reading
// from mid-session spams `glCopySubTextureCHROMIUM: Offset overflows
// texture dimensions` GL errors every frame (confirmed while testing
// this mode against a WebXR emulator).
const VR_CANVAS_WIDTH = 1280;
const VR_CANVAS_HEIGHT = 720;

function compositeVrFrame() {
  if (elements.vrCompositeCanvas.width !== VR_CANVAS_WIDTH) elements.vrCompositeCanvas.width = VR_CANVAS_WIDTH;
  if (elements.vrCompositeCanvas.height !== VR_CANVAS_HEIGHT) elements.vrCompositeCanvas.height = VR_CANVAS_HEIGHT;

  const context = elements.vrCompositeCanvas.getContext("2d");
  const media = activeMediaElement();
  const mediaDimensions = activeMediaDimensions();

  if (mediaDimensions.width > 0 && mediaDimensions.height > 0 && !media.classList.contains("video-feed--hidden")) {
    const destRect = getCoveredImageRect(
      { width: VR_CANVAS_WIDTH, height: VR_CANVAS_HEIGHT },
      mediaDimensions
    );
    context.drawImage(media, destRect.x, destRect.y, destRect.width, destRect.height);
  } else {
    context.fillStyle = "#030807";
    context.fillRect(0, 0, VR_CANVAS_WIDTH, VR_CANVAS_HEIGHT);
  }

  // Layer the existing bounding-box overlay on top instead of recomputing
  // detection boxes a second time for the VR screen texture. The overlay
  // canvas's own size can differ from the fixed VR canvas; drawImage
  // rescales it to fit, which stretches boxes slightly if the aspect
  // ratios differ but keeps them aligned with the video underneath.
  context.drawImage(elements.canvas, 0, 0, VR_CANVAS_WIDTH, VR_CANVAS_HEIGHT);
}

function stopVrRenderLoop() {
  if (vrRenderLoopHandle !== null) {
    window.cancelAnimationFrame(vrRenderLoopHandle);
    vrRenderLoopHandle = null;
  }
}

function startVrRenderLoop() {
  stopVrRenderLoop();
  const tick = () => {
    compositeVrFrame();
    vrRenderLoopHandle = window.requestAnimationFrame(tick);
  };
  tick();
}

function setModeButtonsState(mode) {
  for (const button of elements.modeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  elements.fullscreenButton.disabled = mode !== VIEW_MODES.FLAT;
}

async function exitCurrentXrMode() {
  stopVrRenderLoop();
  document.documentElement.classList.remove("xr-ar-active");
  const controller = activeXrController;
  activeXrController = null;
  if (controller) controller.stop();
}

async function enterViewMode(targetMode) {
  if (targetMode === currentViewMode) return;

  await exitCurrentXrMode();
  currentViewMode = VIEW_MODES.FLAT;
  setModeButtonsState(VIEW_MODES.FLAT);

  if (targetMode === VIEW_MODES.FLAT) return;

  if (targetMode === VIEW_MODES.AR) {
    if (!(await isImmersiveArSupported())) {
      setStatus(elements.streamStatus, "AR passthrough is not supported on this browser/device.", "error");
      return;
    }
    try {
      activeXrController = await startArPassthrough({
        overlayRoot: elements.appShell,
        onEnd: () => { void enterViewMode(VIEW_MODES.FLAT); }
      });
      document.documentElement.classList.add("xr-ar-active");
      currentViewMode = VIEW_MODES.AR;
      setModeButtonsState(VIEW_MODES.AR);
    } catch (error) {
      console.warn("Could not start AR passthrough:", error);
      setStatus(elements.streamStatus, "Could not start AR passthrough.", "error");
    }
    return;
  }

  if (targetMode === VIEW_MODES.VR) {
    if (!(await isImmersiveVrSupported())) {
      setStatus(elements.streamStatus, "VR cinema mode is not supported on this browser/device.", "error");
      return;
    }
    try {
      activeXrController = await startVrCinema({
        compositeCanvasId: elements.vrCompositeCanvas.id,
        onEnd: () => { void enterViewMode(VIEW_MODES.FLAT); }
      });
      startVrRenderLoop();
      currentViewMode = VIEW_MODES.VR;
      setModeButtonsState(VIEW_MODES.VR);
    } catch (error) {
      console.warn("Could not start VR cinema mode:", error);
      setStatus(elements.streamStatus, "Could not start VR cinema mode.", "error");
    }
  }
}

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => {
    void enterViewMode(button.dataset.mode);
  });
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
  const previousCameraSource = config.cameraSource;
  const previousWebsocketUrl = config.websocketUrl;
  config = {
    ...config,
    cameraSource: elements.cameraSource.value === "remote" ? "remote" : "local",
    streamUrl: elements.streamUrl.value.trim(),
    healthUrl: elements.healthUrl.value.trim(),
    websocketUrl: elements.websocketUrl.value.trim(),
    promptUrl: elements.promptUrl.value.trim()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  if (
    config.cameraSource !== previousCameraSource ||
    config.websocketUrl !== previousWebsocketUrl
  ) detectionOrder.reset();
  clearDetections();
  connectCamera();
  connectWebSocket();
});

elements.resetSettings.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  config = loadConfig();
  populateSettings();
  detectionOrder.reset();
  clearDetections();
  connectCamera();
  connectWebSocket();
});

elements.fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      // Fullscreen the whole app shell (not just the video stage) so the
      // prompt panel and status HUD stay in the DOM subtree and can float
      // over the camera feed instead of disappearing.
      await elements.appShell.requestFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen is unavailable:", error);
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === elements.appShell;
  elements.fullscreenButton.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";

  // Fold the prompt form into the same floating bar as the detection
  // summary/mode buttons instead of leaving it as a second, separate
  // floating card — merging the two was cluttering the fullscreen view.
  if (isFullscreen && currentViewMode === VIEW_MODES.FLAT) {
    elements.viewerToolbar.appendChild(elements.promptForm);
    elements.promptForm.classList.add("prompt-form--docked");
  } else if (!isFullscreen && elements.promptForm.classList.contains("prompt-form--docked")) {
    promptFormHome.parent.insertBefore(elements.promptForm, promptFormHome.nextSibling);
    elements.promptForm.classList.remove("prompt-form--docked");
  }

  drawDetections();
});

if ("ResizeObserver" in window) {
  new ResizeObserver(drawDetections).observe(elements.stage);
} else {
  window.addEventListener("resize", drawDetections);
}

window.addEventListener("pagehide", () => {
  connectionGeneration += 1;
  socket?.close();
  stopLocalWebcam();
  stopRemoteStream();
  stopHealthPolling();
});

populateSettings();
connectCamera();
connectWebSocket();
void installXrEmulatorIfRequested();
