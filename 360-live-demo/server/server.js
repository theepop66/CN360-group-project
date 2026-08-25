// server.js
// ------------------------------------------------------------------
// Mock 360 live-stream server.
//
//  Frame source
//    - By default, a simulated equirectangular panorama is regenerated
//      every FRAME_INTERVAL_MS so the feed visibly changes over time
//      (moving sun, live-ness proof).
//    - A real camera can replace it at any time by POSTing frames to
//      /api/camera/push (see README for an ffmpeg example). Once a
//      pushed frame arrives, the simulator stops overwriting it until
//      CAMERA_TIMEOUT_MS passes without a new push.
//
//  API
//    GET  /api/status
//    GET  /api/frame/full.png          ?width&height
//    GET  /api/frame/hemisphere.png    ?yaw&fov(<=180)&width&height
//    GET  /api/frame/viewport.png      ?yaw&pitch&fov(<=150)&width&height
//    POST /api/camera/push             multipart/form-data field "frame"
//                                       (any image; must be equirectangular
//                                       2:1, e.g. from your 360 camera)
// ------------------------------------------------------------------

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { PNG } = require('pngjs');
const sharpLike = require('./decode'); // lightweight image decode helper
const { generateSimulatedFrame, extractView } = require('./panorama');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

const PORT = process.env.PORT || 5000;
const SRC_W = 13644, SRC_H = 6822; // internal working resolution of the simulated source
const FRAME_INTERVAL_MS = 200;    // ~5fps simulated refresh
const CAMERA_TIMEOUT_MS = 15000;  // fall back to static/simulator if no real push for this long

// Source priority: fresh real-camera push > assets/panorama.jpg (static scene) > simulator
let currentFrame = null;
let frameW = SRC_W, frameH = SRC_H;
let staticScene = null; // { buffer, width, height } loaded from server/assets/
let lastRealPushAt = 0;
let startedAt = Date.now();

function setFrame(buffer, width, height) {
  currentFrame = buffer;
  frameW = width;
  frameH = height;
}

async function loadStaticScene() {
  const candidates = ['panorama.jpg', 'panorama.jpeg', 'panorama.png'];
  for (const name of candidates) {
    const file = path.join(__dirname, 'assets', name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file);
      const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { buffer, width, height } = await sharpLike.decodeToRGBA(raw, mime);
      staticScene = { buffer, width, height };
      setFrame(staticScene.buffer, staticScene.width, staticScene.height);
      console.log(`Loaded static scene: server/assets/${name} (${width}x${height})`);
      return;
    } catch (err) {
      console.warn(`Failed to load server/assets/${name}: ${err.message}`);
    }
  }
}

setInterval(() => {
  const usingReal = Date.now() - lastRealPushAt < CAMERA_TIMEOUT_MS;
  if (usingReal) return; // keep the freshest pushed camera frame
  if (staticScene) {
    // revert to the persistent static panorama (also covers post-timeout revert)
    if (currentFrame !== staticScene.buffer) setFrame(staticScene.buffer, staticScene.width, staticScene.height);
    return;
  }
  const t = (Date.now() - startedAt) / 1000;
  setFrame(generateSimulatedFrame(SRC_W, SRC_H, t), SRC_W, SRC_H);
}, FRAME_INTERVAL_MS);

function encodePNG(buf, w, h) {
  const png = new PNG({ width: w, height: h });
  buf.copy(png.data);
  return PNG.sync.write(png);
}

function parseIntSafe(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (req, res) => {
  const usingReal = Date.now() - lastRealPushAt < CAMERA_TIMEOUT_MS;
  res.json({
    ok: true,
    sourceUsingRealCamera: usingReal,
    sourceUsingStaticScene: !usingReal && !!staticScene,
    lastRealPushAgoMs: lastRealPushAt ? Date.now() - lastRealPushAt : null,
    sourceResolution: { width: frameW, height: frameH },
    serverTime: Date.now()
  });
});

app.get('/api/frame/full.png', (req, res) => {
  const w = parseIntSafe(req.query.width, 2048);
  const h = parseIntSafe(req.query.height, w / 2);
  const out = extractView(currentFrame, frameW, frameH, {
    mode: 'equirect', yaw: 0, fov: 360, outW: w, outH: h
  });
  res.set('Cache-Control', 'no-store');
  res.type('png').send(encodePNG(out, w, h));
});

app.get('/api/frame/hemisphere.png', (req, res) => {
  const yaw = parseFloat(req.query.yaw ?? '0');
  const fov = Math.min(parseFloat(req.query.fov ?? '180'), 180);
  const w = parseIntSafe(req.query.width, 1600);
  const h = parseIntSafe(req.query.height, w); // near-square works well for 180 crops
  const out = extractView(currentFrame, frameW, frameH, {
    mode: 'equirect', yaw, fov, outW: w, outH: h
  });
  res.set('Cache-Control', 'no-store');
  res.type('png').send(encodePNG(out, w, h));
});

app.get('/api/frame/viewport.png', (req, res) => {
  const yaw = parseFloat(req.query.yaw ?? '0');
  const pitch = parseFloat(req.query.pitch ?? '0');
  const fov = Math.min(Math.max(parseFloat(req.query.fov ?? '90'), 10), 150);
  const w = parseIntSafe(req.query.width, 960);
  const h = parseIntSafe(req.query.height, 540);
  const out = extractView(currentFrame, frameW, frameH, {
    mode: 'rectilinear', yaw, pitch, fov, outW: w, outH: h
  });
  res.set('Cache-Control', 'no-store');
  res.type('png').send(encodePNG(out, w, h));
});

// Real-camera ingestion endpoint. Point an ffmpeg/RTSP frame-grabber script
// at this to replace the simulated source with your actual 360 camera feed.
// The pushed image must already be equirectangular (2:1). It is resampled
// to the server's internal working resolution.
app.post('/api/camera/push', upload.single('frame'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'missing "frame" file field' });
    const { buffer, width, height } = await sharpLike.decodeToRGBA(req.file.buffer, req.file.mimetype);
    setFrame(buffer, width, height);
    lastRealPushAt = Date.now();
    res.json({ ok: true, receivedAt: lastRealPushAt });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

(async () => {
  await loadStaticScene();
  if (!currentFrame && !staticScene) {
    console.log('No server/assets/panorama.jpg found — using simulated source.');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`360 live demo server running:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  Network: http://${net.address}:${PORT}  (${name})`);
        }
      }
    }
    console.log(`  On the Pico 4 browser, open one of the Network URLs above.`);
  });
})();
