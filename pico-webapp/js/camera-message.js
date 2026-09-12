const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i;

function parsePayload(rawPayload) {
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Camera message must be a JSON object.");
  }
  return payload;
}

function networkUrl(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty URL.`);
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError(`${fieldName} must be an absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${fieldName} must use HTTP or HTTPS.`);
  }
  return url.href;
}

function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Camera frame image must be a non-empty URL or image data URL.");
  }

  const source = value.trim();
  if (source.startsWith("data:")) {
    if (!SAFE_DATA_IMAGE.test(source) || source.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new TypeError("Camera frame contains an unsupported or oversized image data URL.");
    }
    return source;
  }

  return networkUrl(source, "Camera frame image URL");
}

export function parseCameraMessage(rawPayload) {
  const payload = parsePayload(rawPayload);

  if (payload.type === "camera.source") {
    const camera = payload.camera;
    if (!camera || typeof camera !== "object" || Array.isArray(camera)) {
      throw new TypeError("camera.source must contain a camera object.");
    }

    const mode = String(camera.mode ?? "mjpeg").toLowerCase();
    if (!["image", "mjpeg", "remote", "snapshot"].includes(mode)) {
      throw new TypeError("camera.source only supports remote image or MJPEG modes.");
    }

    return {
      kind: "source",
      streamUrl: networkUrl(camera.streamUrl ?? camera.url, "camera.streamUrl"),
      healthUrl: camera.healthUrl
        ? networkUrl(camera.healthUrl, "camera.healthUrl")
        : "",
      cameraId: camera.id ?? null,
      sessionId: camera.sessionId ?? null
    };
  }

  const frame = payload.frame && typeof payload.frame === "object" ? payload.frame : {};
  const frameSource = frame.snapshotUrl
    ?? frame.imageUrl
    ?? frame.imageDataUrl
    ?? payload.snapshotUrl
    ?? payload.imageUrl
    ?? payload.imageDataUrl;

  if (frameSource !== undefined && frameSource !== null) {
    return {
      kind: "frame",
      imageUrl: imageUrl(frameSource),
      frameId: frame.id ?? payload.frameId ?? null
    };
  }

  if (payload.type === "camera.frame") {
    throw new TypeError("camera.frame must contain an image URL or image data URL.");
  }

  return null;
}
