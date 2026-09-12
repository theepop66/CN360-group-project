// Minimal WebXR "immersive-ar" session used purely as a passthrough
// carrier. It draws no 3D geometry: the platform composites the headset's
// real-world camera feed, and the existing 2D HUD (topbar, camera panel,
// prompt form) is shown on top through the WebXR DOM Overlay feature,
// styled to float via the `.xr-ar-active` rules in styles.css.
export async function startArPassthrough({ overlayRoot, onEnd } = {}) {
  const xr = globalThis.navigator?.xr;
  if (!xr?.requestSession) {
    throw new Error("WebXR is not available in this browser.");
  }
  if (!overlayRoot) {
    throw new Error("startArPassthrough requires a DOM overlay root element.");
  }

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { xrCompatible: true, alpha: true });
  if (!gl) {
    throw new Error("Could not create a WebGL context for the AR session.");
  }

  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["dom-overlay"],
    domOverlay: { root: overlayRoot }
  });

  if (gl.makeXRCompatible) {
    await gl.makeXRCompatible();
  }
  await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  let active = true;
  session.addEventListener("end", () => {
    active = false;
    onEnd?.();
  }, { once: true });

  const renderLoop = () => {
    if (!active) return;
    session.requestAnimationFrame(renderLoop);
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    // Fully transparent clear: there is nothing to draw here on purpose,
    // the passthrough camera and the DOM overlay do all the visible work.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };
  session.requestAnimationFrame(renderLoop);

  return {
    session,
    stop() {
      if (active) session.end().catch(() => {});
    }
  };
}
