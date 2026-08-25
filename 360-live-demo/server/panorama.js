// panorama.js
// ------------------------------------------------------------------
// Simulated 360 camera source + spherical reprojection math.
//
// This module has two jobs:
//   1. generateSimulatedFrame(): produce a fake "live" equirectangular
//      (360, 2:1) RGBA frame, standing in for a real 360 camera feed.
//      A real camera integration replaces this frame buffer only
//      (see /api/camera/push in server.js) -- everything downstream
//      (the API, the reprojection math, the client) stays the same.
//
//   2. extractView(): given a source equirectangular frame, produce a
//      cropped RGBA buffer for a requested viewing mode:
//        - "equirect"     -> full or partial equirectangular window
//        - "rectilinear"  -> a normal flat-perspective viewport (the
//                            classic "pan/tilt/zoom into a 360 photo")
// ------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Simple deterministic PRNG so the "stars" pattern doesn't flicker every frame. */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates a synthetic equirectangular frame that visibly changes over
 * time, so a viewer can confirm the "stream" is live.
 *
 * Content:
 *  - Sky/ground gradient (so up/down is obvious)
 *  - A grid every 30 degrees of longitude/latitude (compass reference)
 *  - Four colored quadrant bands at the horizon marking N / E / S / W
 *  - A moving "sun" that sweeps across the longitude over time
 *  - A field of static "stars" for texture/parallax cues
 *
 * @param {number} width  equirect width in px (height = width/2)
 * @param {number} height equirect height in px
 * @param {number} t      time in seconds, drives the animation
 * @returns {Buffer} RGBA buffer, length = width*height*4
 */
function generateSimulatedFrame(width, height, t) {
  const buf = Buffer.alloc(width * height * 4);
  const sunLon = (t * 0.15) % 1; // sun sweeps a full lap every ~40s

  const quadrantColors = [
    [64, 130, 200],  // N - blue
    [200, 120, 60],  // E - orange
    [90, 170, 90],   // S - green
    [170, 80, 160]   // W - purple
  ];

  for (let y = 0; y < height; y++) {
    const v = y / height; // 0 top .. 1 bottom
    const phi = (0.5 - v) * Math.PI; // latitude, +up
    for (let x = 0; x < width; x++) {
      const u = x / width; // 0..1 longitude
      const idx = (y * width + x) * 4;

      // base sky-to-ground gradient
      let r, g, b;
      if (phi > 0) {
        // sky: light blue at horizon -> deep blue at zenith
        const k = phi / (Math.PI / 2);
        r = lerp(180, 20, k);
        g = lerp(210, 40, k);
        b = lerp(240, 90, k);
      } else {
        // ground: brownish, darker further down
        const k = -phi / (Math.PI / 2);
        r = lerp(120, 30, k);
        g = lerp(100, 24, k);
        b = lerp(80, 20, k);
      }

      // quadrant tint near the horizon band, marks N/E/S/W
      const quadrant = Math.floor(u * 4) % 4;
      const distToHorizon = Math.abs(phi);
      if (distToHorizon < 0.12) {
        const [qr, qg, qb] = quadrantColors[quadrant];
        const k = 1 - distToHorizon / 0.12;
        r = lerp(r, qr, k * 0.6);
        g = lerp(g, qg, k * 0.6);
        b = lerp(b, qb, k * 0.6);
      }

      // 30-degree reference grid
      const lonDeg = u * 360;
      const latDeg = (phi * 180) / Math.PI;
      const onLon = mod(lonDeg, 30) < 0.6;
      const onLat = mod(latDeg + 90, 30) < 0.6;
      if (onLon || onLat) {
        r = lerp(r, 255, 0.5);
        g = lerp(g, 255, 0.5);
        b = lerp(b, 255, 0.5);
      }

      // sun disc
      const dLon = angDist(u, sunLon);
      const dLat = Math.abs(phi - 0.35);
      if (dLon < 0.02 && dLat < 0.05) {
        r = 255; g = 235; b = 120;
      }

      // stars (only in upper sky, sparse)
      if (phi > 0.15) {
        const cellX = Math.floor(x / 3);
        const cellY = Math.floor(y / 3);
        if (hash(cellX, cellY) > 0.985) {
          r = 255; g = 255; b = 255;
        }
      }

      buf[idx] = clamp8(r);
      buf[idx + 1] = clamp8(g);
      buf[idx + 2] = clamp8(b);
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

function lerp(a, b, k) { return a + (b - a) * k; }
function clamp8(v) { return Math.max(0, Math.min(255, v | 0)); }
function mod(a, n) { return ((a % n) + n) % n; }
function angDist(a, b) {
  // shortest distance between two [0,1) wrapped longitudes
  let d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

/** Bilinear sample of an RGBA source buffer at fractional (x,y), with horizontal wrap. */
function sampleBilinear(src, srcW, srcH, x, y) {
  x = mod(x, srcW);
  y = Math.max(0, Math.min(srcH - 1.0001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = (x0 + 1) % srcW, y1 = Math.min(y0 + 1, srcH - 1);
  const fx = x - x0, fy = y - y0;

  const i00 = (y0 * srcW + x0) * 4;
  const i10 = (y0 * srcW + x1) * 4;
  const i01 = (y1 * srcW + x0) * 4;
  const i11 = (y1 * srcW + x1) * 4;

  const out = [0, 0, 0, 255];
  for (let c = 0; c < 3; c++) {
    const top = lerp(src[i00 + c], src[i10 + c], fx);
    const bot = lerp(src[i01 + c], src[i11 + c], fx);
    out[c] = clamp8(lerp(top, bot, fy));
  }
  return out;
}

/**
 * Extracts a view from an equirectangular source frame.
 *
 * @param {Buffer} src source RGBA buffer
 * @param {number} srcW source width
 * @param {number} srcH source height
 * @param {object} opts
 *   mode: "equirect" | "rectilinear"
 *   yaw:   center yaw in degrees   (0..360, 0 = center of source image)
 *   pitch: center pitch in degrees (-90..90)
 *   fov:   for "rectilinear": horizontal FOV in degrees (max ~150)
 *          for "equirect": total horizontal span in degrees (e.g. 360 or 180)
 *   outW, outH: output image size
 * @returns {Buffer} RGBA buffer, length = outW*outH*4
 */
function extractView(src, srcW, srcH, opts) {
  const { mode, outW, outH } = opts;
  const yaw = ((opts.yaw || 0) * Math.PI) / 180;
  const pitch = ((opts.pitch || 0) * Math.PI) / 180;
  const fov = ((opts.fov || 90) * Math.PI) / 180;

  const out = Buffer.alloc(outW * outH * 4);

  if (mode === 'equirect') {
    // Simple horizontal window crop centered on yaw, spanning `fov` degrees,
    // full vertical range mapped proportionally. Used for "360" (fov=360)
    // and "180" (fov=180) pulls at an arbitrary heading.
    const spanFrac = Math.min(fov / TAU, 1);
    const centerFrac = (opts.yaw || 0) / 360;
    for (let oy = 0; oy < outH; oy++) {
      const srcY = (oy / outH) * srcH;
      for (let ox = 0; ox < outW; ox++) {
        const frac = centerFrac - spanFrac / 2 + (ox / outW) * spanFrac;
        const srcX = mod(frac, 1) * srcW;
        const [r, g, b, a] = sampleBilinear(src, srcW, srcH, srcX, srcY);
        const idx = (oy * outW + ox) * 4;
        out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = a;
      }
    }
    return out;
  }

  // "rectilinear": classic gnomonic/perspective projection -- pan/tilt/zoom
  // into the sphere, like looking through a normal camera lens pointed at
  // (yaw, pitch) with the given horizontal field of view.
  const aspect = outW / outH;
  const halfW = Math.tan(fov / 2);
  const halfH = halfW / aspect;

  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

  for (let oy = 0; oy < outH; oy++) {
    const ndcY = (0.5 - oy / outH) * 2 * halfH;
    for (let ox = 0; ox < outW; ox++) {
      const ndcX = (ox / outW - 0.5) * 2 * halfW;

      // camera-space ray, +z forward
      let dx = ndcX, dy = ndcY, dz = 1;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= len; dy /= len; dz /= len;

      // pitch (rotate around x axis)
      let dy2 = dy * cosP - dz * sinP;
      let dz2 = dy * sinP + dz * cosP;
      // yaw (rotate around y axis)
      let dx3 = dx * cosY + dz2 * sinY;
      let dz3 = -dx * sinY + dz2 * cosY;

      const theta = Math.atan2(dx3, dz3); // longitude
      const phi = Math.asin(Math.max(-1, Math.min(1, dy2))); // latitude

      const srcX = (theta / TAU + 0.5) * srcW;
      const srcY = (0.5 - phi / Math.PI) * srcH;

      const [r, g, b, a] = sampleBilinear(src, srcW, srcH, srcX, srcY);
      const idx = (oy * outW + ox) * 4;
      out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = a;
    }
  }
  return out;
}

module.exports = { generateSimulatedFrame, extractView };
