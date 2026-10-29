export function validateCameraZoom(report) {
  if (report?.supported === false) return { supported: false, reason: "camera_zoom_not_supported" };
  if (!report || report.supported !== true ||
      ![report.min, report.max, report.step, report.value].every(Number.isFinite) ||
      report.min <= 0 || report.max <= report.min || report.max > 1000 ||
      report.step < 0 || report.step > report.max - report.min ||
      report.value < report.min || report.value > report.max) {
    throw new TypeError("invalid_camera_zoom_report");
  }
  return { supported: true, min: report.min, max: report.max, step: report.step, value: report.value };
}

export function readCameraZoom(track) {
  try {
    const range = track.getCapabilities?.().zoom;
    const value = track.getSettings?.().zoom;
    if (!range || typeof track.applyConstraints !== "function") return { supported: false, reason: "camera_zoom_not_supported" };
    // WebKit exposes a DoubleRange (min/max), without a discrete step.
    // Zero denotes a continuous range; only an applied setting confirms it.
    return validateCameraZoom({ supported: true, ...range, step: range.step ?? 0, value });
  } catch { return { supported: false, reason: "camera_zoom_not_supported" }; }
}

export function requestedCameraZoom(report, action) {
  const range = validateCameraZoom(report);
  if (!range.supported) throw new Error("camera_zoom_not_supported");
  if (!["in", "out", "reset"].includes(action)) throw new Error("invalid_zoom_action");
  const desired = action === "reset" ? 1 : range.value + (action === "in" ? 1 : -1) * (range.step || 0.1);
  const grid = range.step ? range.min + Math.round((desired - range.min) / range.step) * range.step : desired;
  return Number(Math.max(range.min, Math.min(range.max, grid)).toFixed(8));
}

export async function applyCameraZoom(track, value, afterApply = async () => {}, timeoutMs = 2000) {
  const before = readCameraZoom(track);
  if (!before.supported) throw new Error("camera_zoom_not_supported");
  if (!Number.isFinite(value) || value < before.min || value > before.max) throw new Error("invalid_zoom_value");
  let timer;
  try {
    await Promise.race([
      (async () => {
        await track.applyConstraints({ advanced: [{ zoom: value }] });
        await afterApply();
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("camera_zoom_timeout")), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
  const actual = readCameraZoom(track);
  if (!actual.supported || Math.abs(actual.value - value) > 0.00001) throw new Error("camera_zoom_not_confirmed");
  return actual;
}
