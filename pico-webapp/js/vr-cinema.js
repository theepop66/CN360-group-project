// VR cinema mode: an immersive-vr session showing the annotated camera
// feed on a floating screen, built with A-Frame (loaded lazily from a CDN
// on first use) instead of hand-rolled WebGL. A-Frame owns the WebXR
// session lifecycle here (scene.enterVR()/exitVR()); this module just
// wires the scene to whatever canvas the caller keeps updated with the
// composited video + detection-box frame (see app.js's compositeVrFrame).
//
// Look: light-blue "glass card" HUD (same palette as the AR overlay) —
// gradient sky, a white card holding the title, status pills, the camera
// screen, the detection summary bar and a controller-shortcut legend.
const AFRAME_SRC = "https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js";

const THEME = Object.freeze({
  ink: "#14284b",
  inkSoft: "#3d5a85",
  blue: "#2f5597",
  navy: "#1c3a6b",
  white: "#ffffff",
  line: "rgba(86, 128, 190, 0.38)",
  states: { ok: "#1fa65a", error: "#d1344a", busy: "#f0a81c", idle: "#8aa0c0" }
});

const PX_PER_METER = 400;
const CARD_Z = -2.4;

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

let currentOnFrame = null;

function registerScreenTextureComponent() {
  if (globalThis.AFRAME.components["screen-texture-updater"]) return;

  // A three.js CanvasTexture only re-uploads pixels when flagged, so the
  // live composite canvas needs an explicit needsUpdate tick each frame.
  // In WebXR immersive mode, DOM window.requestAnimationFrame is paused by
  // the browser, so the canvas must be redrawn here inside the XR loop.
  globalThis.AFRAME.registerComponent("screen-texture-updater", {
    tick() {
      if (typeof currentOnFrame === "function") {
        try {
          currentOnFrame();
        } catch (error) {
          console.warn("Error compositing VR frame:", error);
        }
      }
      const map = this.el.getObject3D("mesh")?.material?.map;
      if (map) map.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Texture helpers (drawn once on a 2D canvas, used as flat-shaded textures)
// ---------------------------------------------------------------------------

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Rounded rectangle sized in metres. Returns the data URL plus the plane
// size (slightly larger than the shape when a soft shadow margin is drawn).
function makePanel({ width, height, radius = 0.06, fill, stroke = null, shadow = false }) {
  const margin = shadow ? 36 : 2;
  const shapeW = Math.round(width * PX_PER_METER);
  const shapeH = Math.round(height * PX_PER_METER);
  const canvas = document.createElement("canvas");
  canvas.width = shapeW + margin * 2;
  canvas.height = shapeH + margin * 2;
  const ctx = canvas.getContext("2d");

  if (shadow) {
    ctx.shadowColor = "rgba(28, 58, 107, 0.30)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
  }
  roundRectPath(ctx, margin, margin, shapeW, shapeH, radius * PX_PER_METER);
  if (typeof fill === "function") {
    ctx.fillStyle = fill(ctx, margin, margin, shapeW, shapeH);
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
  ctx.shadowColor = "transparent";

  if (stroke) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  return {
    url: canvas.toDataURL("image/png"),
    planeW: canvas.width / PX_PER_METER,
    planeH: canvas.height / PX_PER_METER
  };
}

function makeSkyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#f4f8ff");
  gradient.addColorStop(0.5, "#dbe8f9");
  gradient.addColorStop(1, "#b4cdee");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft layered "hills" below the horizon, same motif as the 2D mock-up.
  const layers = [
    { base: 0.66, amp: 14, freq: 5, alpha: 0.22 },
    { base: 0.74, amp: 18, freq: 3, alpha: 0.28 },
    { base: 0.84, amp: 22, freq: 2, alpha: 0.34 }
  ];
  for (const layer of layers) {
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 8) {
      const y = canvas.height * layer.base
        + Math.sin((x / canvas.width) * Math.PI * 2 * layer.freq) * layer.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fillStyle = `rgba(80, 130, 200, ${layer.alpha})`;
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Scene-building helpers
// ---------------------------------------------------------------------------

function entity(parent, tag, attributes = {}) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.appendChild(node);
  return node;
}

function panel(parent, spec, position) {
  const built = makePanel(spec);
  const node = entity(parent, "a-entity", { position: `${position.x} ${position.y} ${position.z}` });
  node.setAttribute("geometry", { primitive: "plane", width: built.planeW, height: built.planeH });
  node.setAttribute("material", { shader: "flat", src: built.url, transparent: true, side: "front" });
  return node;
}

function label(parent, value, { x, y, z, width, wrapCount, color = THEME.ink, align = "left", anchor = "left" }) {
  const node = entity(parent, "a-entity", { position: `${x} ${y} ${z}` });
  node.setAttribute("text", { value, color, align, anchor, baseline: "center", width, wrapCount, font: "roboto" });
  return node;
}

function truncate(text, max) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export async function startVrCinema({ compositeCanvasId, onEnd, onFrame } = {}) {
  if (!compositeCanvasId) {
    throw new Error("startVrCinema requires the id of the composite canvas element.");
  }

  currentOnFrame = onFrame ?? null;
  await loadAframe();
  registerScreenTextureComponent();

  const scene = document.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute("vr-mode-ui", "enabled: true");
  scene.style.position = "fixed";
  scene.style.inset = "0";
  scene.style.zIndex = "5";

  entity(scene, "a-sky", { src: makeSkyTexture() });

  const root = entity(scene, "a-entity", { id: "vr-hud-root" });

  // --- Card ---------------------------------------------------------------
  const CARD_W = 2.8;
  const CARD_H = 2.44;
  const CARD_Y = 1.5;
  const L = -1.2; // left text edge

  panel(root, {
    width: CARD_W,
    height: CARD_H,
    radius: 0.14,
    shadow: true,
    stroke: THEME.line,
    fill: (ctx, x, y, w, h) => {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "rgba(255,255,255,0.97)");
      g.addColorStop(1, "rgba(231,241,253,0.97)");
      return g;
    }
  }, { x: 0, y: CARD_Y, z: CARD_Z });

  // --- Title block --------------------------------------------------------
  label(root, "Adaptive AI Quality Control HUD · LIVE INSPECTION", {
    x: L, y: 2.63, z: CARD_Z + 0.02, width: 1.75, wrapCount: 52, color: THEME.blue
  });
  label(root, "Quality Control HUD", {
    x: L, y: 2.5, z: CARD_Z + 0.02, width: 1.5, wrapCount: 20, color: THEME.ink
  });

  // --- Status pills (camera / AI data) ------------------------------------
  const pillSpec = { width: 0.95, height: 0.105, radius: 0.052, fill: "rgba(255,255,255,0.96)", stroke: THEME.line };
  const pillX = 0.88;
  const makePill = (y, initialText) => {
    panel(root, pillSpec, { x: pillX, y, z: CARD_Z + 0.01 });
    const dot = entity(root, "a-circle", {
      radius: 0.015,
      position: `${pillX - pillSpec.width / 2 + 0.06} ${y} ${CARD_Z + 0.02}`
    });
    dot.setAttribute("material", { shader: "flat", color: THEME.states.idle });
    const text = label(root, initialText, {
      x: pillX - pillSpec.width / 2 + 0.1, y, z: CARD_Z + 0.02, width: 0.8, wrapCount: 34, color: THEME.ink
    });
    return { dot, text };
  };
  const cameraPill = makePill(2.6, "Camera: waiting");
  const socketPill = makePill(2.47, "AI data: waiting");

  // --- Camera screen (live composite canvas) ------------------------------
  const SCREEN_Y = 1.72;
  panel(root, {
    width: 2.46,
    height: 1.41,
    radius: 0.05,
    fill: "#ffffff",
    stroke: "rgba(60, 100, 165, 0.55)"
  }, { x: 0, y: SCREEN_Y, z: CARD_Z + 0.01 });

  const screen = entity(root, "a-plane", {
    "screen-texture-updater": "",
    geometry: "primitive: plane; width: 2.4; height: 1.35",
    material: `shader: flat; src: #${compositeCanvasId}`,
    position: `0 ${SCREEN_Y} ${CARD_Z + 0.02}`
  });
  screen.setAttribute("id", "vr-camera-screen");

  // --- Summary bar (detections + zoom) ------------------------------------
  const BAR_Y = 0.94;
  panel(root, {
    width: 2.46, height: 0.19, radius: 0.095, fill: "rgba(255,255,255,0.96)", stroke: THEME.line
  }, { x: 0, y: BAR_Y, z: CARD_Z + 0.01 });
  const hudSummary = label(root, "No recent detections", {
    x: L + 0.02, y: BAR_Y, z: CARD_Z + 0.02, width: 1.4, wrapCount: 46, color: THEME.ink
  });

  const zoomStatus = label(root, "Phone camera zoom: waiting", {
    x: 0, y: 0.78, z: CARD_Z + 0.02, width: 2.3, wrapCount: 84, color: THEME.inkSoft, align: "center", anchor: "center"
  });
  const servoStatus = label(root, "", {
    x: 0, y: 0.67, z: CARD_Z + 0.02, width: 2.3, wrapCount: 84, color: THEME.blue, align: "center", anchor: "center"
  });

  // --- Controller legend (mirrors the HUD buttons) -------------------------
  const chips = [
    { text: "Reject · A", primary: true },
    { text: "Pass · B" },
    { text: "Sweep · Grip" },
    { text: "Manual · X   Auto · Y" }
  ];
  const chipW = 0.58;
  const chipGap = 0.05;
  const lastChipW = 0.8;
  const totalW = chipW * (chips.length - 1) + lastChipW + chipGap * (chips.length - 1);
  let cursor = -totalW / 2;
  for (const [index, chip] of chips.entries()) {
    const w = index === chips.length - 1 ? lastChipW : chipW;
    const cx = cursor + w / 2;
    cursor += w + chipGap;
    panel(root, {
      width: w,
      height: 0.13,
      radius: 0.065,
      fill: chip.primary ? THEME.navy : "rgba(255,255,255,0.96)",
      stroke: chip.primary ? THEME.navy : THEME.line
    }, { x: cx, y: 0.46, z: CARD_Z + 0.01 });
    label(root, chip.text, {
      x: cx, y: 0.46, z: CARD_Z + 0.02, width: w - 0.1, wrapCount: Math.max(14, chip.text.length + 2),
      color: chip.primary ? THEME.white : THEME.ink, align: "center", anchor: "center"
    });
  }

  // Head-locked hint stays out of the way: nothing is attached to the camera
  // except look/wasd controls, so the card is the only HUD in the scene.
  entity(scene, "a-entity", { camera: "", "look-controls": "", "wasd-controls": "", position: "0 1.6 0" });

  document.body.appendChild(scene);

  let ended = false;
  const cleanUp = () => {
    if (ended) return;
    ended = true;
    currentOnFrame = null;
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

  // A-Frame owns the session, but three.js exposes it, which is what the
  // controller shortcut poller in app.js needs.
  const session = scene.renderer?.xr?.getSession?.() ?? null;

  const setText = (node, text) => node?.setAttribute("text", "value", text);

  return {
    session,
    setSummaryText(text) {
      setText(hudSummary, truncate(text, 60));
    },
    setServoStatusText(text) {
      setText(servoStatus, truncate(text, 110));
    },
    setZoomText(text) {
      setText(zoomStatus, truncate(text, 110));
    },
    // kind: "camera" | "socket"; state: ok | error | busy | idle
    setStatusText(kind, text, state = "idle") {
      const pill = kind === "camera" ? cameraPill : kind === "socket" ? socketPill : null;
      if (!pill) return;
      setText(pill.text, truncate(text, 38));
      pill.dot.setAttribute("material", "color", THEME.states[state] ?? THEME.states.idle);
    },
    stop() {
      if (!ended) scene.exitVR();
    }
  };
}