import test from "node:test";
import assert from "node:assert/strict";
import { clampZoom } from "../js/zoom.js";
import { getCoveredImageRect, mapBoxToDisplay } from "../js/overlay.js";

test("digital zoom is bounded to 1–4x without floating-point drift", () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(5), 4);
  assert.equal(clampZoom(Number.NaN), 1);
  let zoom = 1;
  for (let i = 0; i < 30; i++) zoom = clampZoom(zoom + 0.1);
  assert.equal(zoom, 4);
});

test("center zoom crops video and pixel/normalized boxes using the same rectangle", () => {
  const source = { width: 200, height: 100 };
  const viewport = { width: 100, height: 100 };
  assert.deepEqual(getCoveredImageRect(viewport, source, 2), { x: -150, y: -50, width: 400, height: 200 });
  for (const box of [
    { x1: 75, y1: 25, x2: 125, y2: 75, normalized: false },
    { x1: 0.375, y1: 0.25, x2: 0.625, y2: 0.75, normalized: true }
  ]) assert.deepEqual(mapBoxToDisplay(box, source, viewport, "cover", 2), { x: 0, y: 0, width: 100, height: 100 });
});

test("a VR viewport gets its own cover geometry instead of stretching the 2D overlay", () => {
  const box = { x1: 75, y1: 25, x2: 125, y2: 75, normalized: false };
  const source = { width: 200, height: 100 };
  assert.deepEqual(mapBoxToDisplay(box, source, { width: 200, height: 100 }, "cover", 2), { x: 50, y: 0, width: 100, height: 100 });
  assert.deepEqual(mapBoxToDisplay(box, source, { width: 100, height: 200 }, "cover", 2), { x: -50, y: 0, width: 200, height: 200 });
});
