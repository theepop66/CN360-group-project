export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;

export function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_ZOOM;
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, number)) * 100) / 100;
}
