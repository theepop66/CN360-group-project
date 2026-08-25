// decode.js
// Minimal, dependency-light helpers to turn an uploaded PNG/JPEG into a raw
// RGBA buffer, and to nearest-neighbor resize it. Used only by the real
// camera ingestion endpoint (/api/camera/push) -- the simulated source and
// the reprojection math never touch this file.

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

async function decodeToRGBA(fileBuffer, mimetype) {
  if (mimetype && mimetype.includes('png')) {
    const png = PNG.sync.read(fileBuffer);
    return { buffer: png.data, width: png.width, height: png.height };
  }
  // default to JPEG for anything else (covers image/jpeg from most cameras/ffmpeg)
  const decoded = jpeg.decode(fileBuffer, { useTArray: true, maxMemoryUsageInMB: 2048 });
  return { buffer: Buffer.from(decoded.data), width: decoded.width, height: decoded.height };
}

function resizeNearest(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / dstH) * srcH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / dstW) * srcW));
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return out;
}

module.exports = { decodeToRGBA, resizeNearest };
