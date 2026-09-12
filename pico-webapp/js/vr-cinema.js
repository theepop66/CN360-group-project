// VR cinema mode: an immersive-vr session showing the annotated camera
// feed on a floating screen, built with A-Frame (loaded lazily from a CDN
// on first use) instead of hand-rolled WebGL. A-Frame owns the WebXR
// session lifecycle here (scene.enterVR()/exitVR()); this module just
// wires the scene to whatever canvas the caller keeps updated with the
// composited video + detection-box frame (see app.js's compositeVrFrame).
const AFRAME_SRC = "https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js";

let aframeLoadPromise = null;

function loadAframe() {
  if (globalThis.AFRAME) return Promise.resolve();
  if (aframeLoadPromise) return aframeLoadPromise;

  aframeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = AFRAME_SRC;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load A-Frame from the CDN. Is this device online?")),
      { once: true }
    );
    document.head.appendChild(script);
  });
  return aframeLoadPromise;
}

function registerScreenTextureComponent() {
  if (globalThis.AFRAME.components["screen-texture-updater"]) return;

  // A three.js CanvasTexture only re-uploads pixels when flagged, so the
  // live composite canvas needs an explicit needsUpdate tick each frame.
  globalThis.AFRAME.registerComponent("screen-texture-updater", {
    tick() {
      const map = this.el.getObject3D("mesh")?.material?.map;
      if (map) map.needsUpdate = true;
    }
  });
}

export async function startVrCinema({ compositeCanvasId, onEnd } = {}) {
  if (!compositeCanvasId) {
    throw new Error("startVrCinema requires the id of the composite canvas element.");
  }

  await loadAframe();
  registerScreenTextureComponent();

  const scene = document.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute("vr-mode-ui", "enabled: true");
  scene.style.position = "fixed";
  scene.style.inset = "0";
  scene.style.zIndex = "5";
  scene.innerHTML = `
    <a-sky color="#05110d"></a-sky>
    <a-entity light="type: ambient; color: #9fd9c2; intensity: 0.9"></a-entity>
    <a-plane
      screen-texture-updater
      geometry="primitive: plane; width: 2.4; height: 1.35"
      material="shader: flat; src: #${compositeCanvasId}"
      position="0 1.6 -2.2"
    ></a-plane>
    <a-entity
      text="value: VisionQC · Live inspection; align: center; color: #68efb3; width: 3"
      position="0 2.45 -2.2"
    ></a-entity>
    <a-entity camera look-controls wasd-controls position="0 1.6 0">
      <a-entity
        id="vr-hud-summary"
        text="value: No recent detections; align: center; color: #eafff5; width: 1.7; wrapCount: 36"
        position="0 -0.4 -1"
      ></a-entity>
    </a-entity>
  `;

  document.body.appendChild(scene);

  let ended = false;
  const cleanUp = () => {
    if (ended) return;
    ended = true;
    scene.removeEventListener("exit-vr", cleanUp);
    scene.remove();
    onEnd?.();
  };
  scene.addEventListener("exit-vr", cleanUp);

  await new Promise((resolve) => {
    if (scene.hasLoaded) resolve();
    else scene.addEventListener("loaded", () => resolve(), { once: true });
  });

  try {
    await scene.enterVR();
  } catch (error) {
    cleanUp();
    throw error;
  }

  const hudSummary = scene.querySelector("#vr-hud-summary");

  return {
    setSummaryText(text) {
      hudSummary?.setAttribute("text", "value", text);
    },
    stop() {
      if (!ended) scene.exitVR();
    }
  };
}
