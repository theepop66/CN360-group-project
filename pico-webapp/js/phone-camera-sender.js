import { readCameraZoom, applyCameraZoom } from "./camera-zoom.js";

const form = document.querySelector("#sender-form");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const codeInput = document.querySelector("#pairing-code");
const status = document.querySelector("#status");
const video = document.querySelector("#preview");
const zoomStatus = document.querySelector("#camera-zoom-status");
const qualityInput = document.querySelector("#camera-quality");
const rateInput = document.querySelector("#camera-rate");
const canvas = document.createElement("canvas");
const original = { width: 960, height: 720, jpegQuality: 0.75 };
const highDetail = { width: 1920, height: 1080, jpegQuality: 0.90 };
const legacyFrameBytes = 512 * 1024;
let generation = 0;
let media = null;
let session = null;
let pending = null;
let cancelFrameWait = null;
let zoomApplyingGeneration = null;

function nextVideoFrame() {
  return new Promise((resolve, reject) => {
    let callbackId;
    const finish = error => {
      clearTimeout(timer);
      if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId);
      if (cancelFrameWait === cancel) cancelFrameWait = null;
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(new Error("Stopped waiting for a camera frame"));
    const timer = setTimeout(() => finish(new Error("No new camera frame. Please restart the camera.")), 2000);
    cancelFrameWait = cancel;
    callbackId = video.requestVideoFrameCallback(() => finish());
  });
}

async function api(path, options) {
  const controller = new AbortController();
  pending = controller;
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  } finally { clearTimeout(timer); if (pending === controller) pending = null; }
}

function stop(message = "Streaming stopped") {
  generation++;
  zoomApplyingGeneration = null;
  pending?.abort();
  cancelFrameWait?.();
  if (session) {
    void fetch("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` }, keepalive: true }).catch(() => {});
    session = null;
  }
  media?.getTracks().forEach(track => track.stop());
  media = null; video.srcObject = null;
  startButton.disabled = false; stopButton.disabled = true; codeInput.disabled = false;
  for (const input of [qualityInput, rateInput]) if (input) input.disabled = false;
  status.textContent = message;
}

function encodeJpeg(quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob?.type === "image/jpeg") resolve(blob);
    else reject(new Error("Could not encode the camera frame as JPEG"));
  }, "image/jpeg", quality));
}

async function publish(current, serverTime, clockStart, profile, fps, maxFrameBytes) {
  let sequence = 0;
  let confirmedZoomCommand = 0;
  let nextCapture = null;
  let sizeReduction = 1;
  const track = media.getVideoTracks()[0];
  while (current === generation) {
    await nextVideoFrame();
    if (current !== generation) return;
    const frameTime = performance.now();
    if (fps) {
      const period = 1000 / fps;
      nextCapture ??= frameTime;
      if (frameTime < nextCapture - 1) continue;
      const missedPeriods = Math.floor(Math.max(0, frameTime - nextCapture) / period);
      nextCapture += (missedPeriods + 1) * period;
    }
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight || video.readyState < 2 || track.muted) throw new Error("Camera paused. Please restart the camera.");
    const portrait = profile === highDetail && videoHeight > videoWidth;
    const maxWidth = portrait ? profile.height : profile.width;
    const maxHeight = portrait ? profile.width : profile.height;
    const scale = Math.min(1, maxWidth / videoWidth, maxHeight / videoHeight) * sizeReduction;
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const capturedMs = Math.floor(serverTime + frameTime - clockStart);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    let jpegQuality = profile.jpegQuality;
    let blob = await encodeJpeg(jpegQuality);
    if (current !== generation) return;
    if (blob.size > maxFrameBytes && profile === highDetail) {
      jpegQuality = original.jpegQuality;
      blob = await encodeJpeg(jpegQuality);
      if (current !== generation) return;
    }
    if (blob.size > maxFrameBytes) {
      // Try a smaller, fresh frame next time. Do not upload or re-timestamp this image.
      if (sizeReduction <= 0.25) throw new Error("Could not fit the camera frame within the server JPEG limit");
      sizeReduction = Math.max(0.25, sizeReduction * 0.75);
      status.textContent = "Reducing image size to fit the server limit…";
      continue;
    }
    let result;
    try {
      result = await api("/phone-camera/frame", {
        method: "POST", body: blob,
        headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "image/jpeg", "X-Frame-Sequence": String(++sequence), "X-Captured-At-Ms": String(capturedMs), "X-Camera-Zoom-Command": String(confirmedZoomCommand) }
      });
    } catch (error) {
      if (current !== generation) return;
      if (error.message !== "stale_frame") throw error;
      status.textContent = "A frame arrived too late. Waiting for a fresh frame…";
      continue;
    }
    if (current !== generation) return;
    if (result.zoomCommand) {
      zoomApplyingGeneration = current;
      let error = null;
      try {
        await applyCameraZoom(track, result.zoomCommand.value, async () => {
          if (current !== generation) throw new Error("sender_stopped");
          await nextVideoFrame();
          if (current !== generation) throw new Error("sender_stopped");
          await nextVideoFrame();
        });
      } catch (failure) {
        // A timed-out camera operation may still finish later. Stop this track
        // instead of uploading pixels with an uncertain zoom revision.
        if (failure.message === "camera_zoom_timeout") throw failure;
        error = "camera_zoom_apply_failed";
      }
      finally { if (zoomApplyingGeneration === current) zoomApplyingGeneration = null; }
      if (current !== generation) return;
      await reportZoom(track, result.zoomCommand.id, error);
      confirmedZoomCommand = result.zoomCommand.id;
      if (current !== generation) return;
    }
    if (result.accepted) {
      status.textContent = `Camera ${videoWidth} × ${videoHeight} · Sent ${width} × ${height} · JPEG ${jpegQuality.toFixed(2)} · Frame ${result.sequence}`;
    }
    if (!fps) await new Promise(resolve => setTimeout(resolve, 125));
  }
}

async function reportZoom(track, commandId = 0, error = null) {
  const camera = readCameraZoom(track);
  await api("/phone-camera/camera-state", {
    method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...camera, commandId, error })
  });
  zoomStatus.textContent = !camera.supported ? "This browser/camera does not support remote camera zoom" :
    `Actual camera zoom ${camera.value.toFixed(2)}× (${camera.min}–${camera.max}×)${error ? " · Zoom command failed" : ""}`;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { status.textContent = "Open this page over trusted HTTPS to use the camera"; return; }
  if (!video.requestVideoFrameCallback) { status.textContent = "This browser cannot confirm new frames. Please update Safari."; return; }
  const current = ++generation;
  const profile = qualityInput?.value === "detail" ? highDetail : original;
  const requestedFps = Number(rateInput?.value);
  const fps = [10, 15].includes(requestedFps) ? requestedFps : 0;
  startButton.disabled = true; stopButton.disabled = false; codeInput.disabled = true;
  for (const input of [qualityInput, rateInput]) if (input) input.disabled = true;
  status.textContent = "Requesting camera access...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: profile.width }, height: { ideal: profile.height }, zoom: true }, audio: false });
    if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    media = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (current === generation) stop("Camera ended. Please restart the camera."); });
    stream.getVideoTracks()[0].addEventListener("mute", () => { if (current === generation && zoomApplyingGeneration !== current) stop("Camera paused. Please restart the camera."); });
    video.srcObject = stream;
    await video.play();
    if (current !== generation) return;
    const paired = await api("/phone-camera/session", { method: "POST", headers: { Authorization: `Bearer ${codeInput.value.trim()}` } });
    if (current !== generation) {
      void fetch("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${paired.token}` }, keepalive: true }).catch(() => {});
      return;
    }
    session = paired;
    const clockStart = performance.now();
    await reportZoom(stream.getVideoTracks()[0]);
    if (current !== generation) return;
    const limit = Number.isSafeInteger(paired.maxFrameBytes) && paired.maxFrameBytes > 0 ? paired.maxFrameBytes : legacyFrameBytes;
    await publish(current, paired.serverTime, clockStart, profile, fps, limit);
  } catch (error) { if (current === generation) stop(`Streaming failed: ${error.message}`); }
});
stopButton.addEventListener("click", () => stop());
document.addEventListener("visibilitychange", () => { if (document.hidden) stop("Streaming stopped because this page was hidden. Tap Start to reconnect."); });
window.addEventListener("pagehide", () => stop());
video.addEventListener("pause", () => { if (media && video.paused) stop("Video paused. Please restart the camera."); });
