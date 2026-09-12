import test from "node:test";
import assert from "node:assert/strict";

import { parseCameraMessage } from "../js/camera-message.js";

test("parses a remote camera source command from the n8n gateway", () => {
  assert.deepEqual(
    parseCameraMessage({
      type: "camera.source",
      camera: {
        id: "inspection-1",
        mode: "mjpeg",
        streamUrl: "http://192.168.1.20:8000/stream.mjpg",
        healthUrl: "http://192.168.1.20:8000/health",
        sessionId: "pi-boot-7"
      }
    }),
    {
      kind: "source",
      streamUrl: "http://192.168.1.20:8000/stream.mjpg",
      healthUrl: "http://192.168.1.20:8000/health",
      cameraId: "inspection-1",
      sessionId: "pi-boot-7"
    }
  );
});

test("extracts an analyzed snapshot URL from a detection frame", () => {
  assert.deepEqual(
    parseCameraMessage({
      type: "detections",
      frame: { id: "frame-9", snapshotUrl: "https://camera.example.test/snapshots/frame-9.jpg" },
      detections: []
    }),
    {
      kind: "frame",
      imageUrl: "https://camera.example.test/snapshots/frame-9.jpg",
      frameId: "frame-9"
    }
  );
});

test("accepts bounded raster image data URLs for individual n8n frames", () => {
  const dataUrl = "data:image/jpeg;base64,ZmFrZQ==";
  assert.equal(
    parseCameraMessage({ type: "camera.frame", imageDataUrl: dataUrl }).imageUrl,
    dataUrl
  );
});

test("rejects unsafe protocols in remote camera commands", () => {
  assert.throws(
    () => parseCameraMessage({
      type: "camera.source",
      camera: { mode: "mjpeg", streamUrl: "javascript:alert(1)" }
    }),
    /HTTP or HTTPS/
  );
});

test("rejects relative n8n image URLs to avoid using the wrong host", () => {
  assert.throws(
    () => parseCameraMessage({
      type: "camera.frame",
      frame: { imageUrl: "/snapshots/frame-9.jpg" }
    }),
    /absolute URL/
  );
});
