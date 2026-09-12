// Pure helpers for the three HUD view modes: a normal 2D page, a WebXR
// "immersive-ar" passthrough session, and a WebXR "immersive-vr" cinema
// session. Kept dependency-free so it can be unit tested with node --test,
// unlike the WebXR session code in ar-passthrough.js/vr-cinema.js which
// needs a real browser.

export const VIEW_MODES = Object.freeze({
  FLAT: "flat",
  AR: "ar",
  VR: "vr"
});

export function isViewMode(value) {
  return value === VIEW_MODES.FLAT || value === VIEW_MODES.AR || value === VIEW_MODES.VR;
}

export async function isSessionModeSupported(sessionMode, xr = globalThis.navigator?.xr) {
  if (!xr?.isSessionSupported) return false;
  try {
    return await xr.isSessionSupported(sessionMode);
  } catch {
    return false;
  }
}

export function isImmersiveArSupported(xr = globalThis.navigator?.xr) {
  return isSessionModeSupported("immersive-ar", xr);
}

export function isImmersiveVrSupported(xr = globalThis.navigator?.xr) {
  return isSessionModeSupported("immersive-vr", xr);
}
