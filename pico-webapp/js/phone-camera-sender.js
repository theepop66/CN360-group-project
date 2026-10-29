const form = document.querySelector("#sender-form");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const codeInput = document.querySelector("#pairing-code");
const status = document.querySelector("#status");
const video = document.querySelector("#preview");
const canvas = document.createElement("canvas");
let generation = 0;
let media = null;
let session = null;
let pending = null;

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

function stop(message = "หยุดส่งภาพแล้ว") {
  generation++;
  pending?.abort();
  if (session) {
    void fetch("/phone-camera/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` }, keepalive: true }).catch(() => {});
    session = null;
  }
  media?.getTracks().forEach(track => track.stop());
  media = null; video.srcObject = null;
  startButton.disabled = false; stopButton.disabled = true; codeInput.disabled = false;
  status.textContent = message;
}

async function publish(current, serverTime, clockStart) {
  let sequence = 0;
  while (current === generation) {
    if (!video.videoWidth || video.readyState < 2) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    const scale = Math.min(1, 960 / video.videoWidth, 720 / video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const capturedMs = Math.floor(serverTime + performance.now() - clockStart);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.75));
    if (current !== generation) return;
    if (!blob) throw new Error("ไม่สามารถแปลงภาพจากกล้องได้");
    const result = await api("/phone-camera/frame", {
      method: "POST", body: blob,
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "image/jpeg", "X-Frame-Sequence": String(++sequence), "X-Captured-At-Ms": String(capturedMs) }
    });
    if (current !== generation) return;
    status.textContent = `กำลังส่งภาพ · ${canvas.width} × ${canvas.height} · ภาพที่ ${result.sequence}`;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { status.textContent = "ต้องเปิดผ่าน HTTPS ที่เชื่อถือได้ก่อนจึงใช้กล้องได้"; return; }
  const current = ++generation;
  startButton.disabled = true; stopButton.disabled = false; codeInput.disabled = true;
  status.textContent = "กำลังขอใช้กล้อง…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
    if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
    media = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (current === generation) stop("กล้องหยุดทำงาน กรุณาเริ่มใหม่"); });
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
    codeInput.value = "";
    await publish(current, paired.serverTime, clockStart);
  } catch (error) { if (current === generation) stop(`ส่งภาพไม่ได้: ${error.message}`); }
});
stopButton.addEventListener("click", () => stop());
document.addEventListener("visibilitychange", () => { if (document.hidden) stop("หยุดส่งภาพเมื่อออกจากหน้านี้ กดเริ่มเพื่อเชื่อมต่ออีกครั้ง"); });
window.addEventListener("pagehide", () => stop());
