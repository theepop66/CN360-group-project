import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_MODES,
  isViewMode,
  isSessionModeSupported,
  isImmersiveArSupported,
  isImmersiveVrSupported
} from "../js/xr-modes.js";

test("recognizes only the three declared view modes", () => {
  assert.equal(isViewMode(VIEW_MODES.FLAT), true);
  assert.equal(isViewMode(VIEW_MODES.AR), true);
  assert.equal(isViewMode(VIEW_MODES.VR), true);
  assert.equal(isViewMode("immersive-ar"), false);
  assert.equal(isViewMode(undefined), false);
});

test("reports unsupported when navigator.xr is missing", async () => {
  assert.equal(await isSessionModeSupported("immersive-ar", undefined), false);
});

test("reports unsupported when isSessionSupported is not a function", async () => {
  assert.equal(await isSessionModeSupported("immersive-ar", {}), false);
});

test("forwards the session mode to navigator.xr.isSessionSupported", async () => {
  const requestedModes = [];
  const xr = {
    isSessionSupported: async (mode) => {
      requestedModes.push(mode);
      return mode === "immersive-ar";
    }
  };

  assert.equal(await isImmersiveArSupported(xr), true);
  assert.equal(await isImmersiveVrSupported(xr), false);
  assert.deepEqual(requestedModes, ["immersive-ar", "immersive-vr"]);
});

test("treats a rejected support check as unsupported instead of throwing", async () => {
  const xr = { isSessionSupported: async () => { throw new Error("boom"); } };
  assert.equal(await isSessionModeSupported("immersive-vr", xr), false);
});
