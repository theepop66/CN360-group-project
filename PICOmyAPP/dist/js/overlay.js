const PASS_STATUSES = new Set(["accepted", "clear", "ok", "pass", "passed"]);

function asFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readBox(candidate) {
  const box = candidate.bbox ?? candidate.box ?? candidate;

  if (Array.isArray(box) && box.length >= 4) {
    return box.slice(0, 4).map(asFiniteNumber);
  }

  if (box && typeof box === "object") {
    return [box.x1, box.y1, box.x2, box.y2].map(asFiniteNumber);
  }

  return [null, null, null, null];
}

export function getContainedImageRect(container, source) {
  if (container.width <= 0 || container.height <= 0 || source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(container.width / source.width, container.height / source.height);
  // Clamp the fitted dimensions to avoid tiny floating-point overflows such as
  // 1000.0000000000001 pixels at the container edge.
  const width = Math.min(container.width, source.width * scale);
  const height = Math.min(container.height, source.height * scale);

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height
  };
}

export function mapBoxToDisplay(box, source, container) {
  const imageRect = getContainedImageRect(container, source);
  const sourceWidth = box.normalized ? 1 : source.width;
  const sourceHeight = box.normalized ? 1 : source.height;

  return {
    x: imageRect.x + (box.x1 / sourceWidth) * imageRect.width,
    y: imageRect.y + (box.y1 / sourceHeight) * imageRect.height,
    width: ((box.x2 - box.x1) / sourceWidth) * imageRect.width,
    height: ((box.y2 - box.y1) / sourceHeight) * imageRect.height
  };
}

export function parseDetectionPayload(rawPayload) {
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

  if (!payload || typeof payload !== "object") {
    throw new TypeError("Detection message must be a JSON object.");
  }

  if (["heartbeat", "ping", "connected"].includes(payload.type)) {
    return null;
  }

  const frame = payload.frame ?? {};
  const sourceWidth = asFiniteNumber(frame.width ?? payload.imageWidth ?? payload.width);
  const sourceHeight = asFiniteNumber(frame.height ?? payload.imageHeight ?? payload.height);
  const hasSourceDimensions = Boolean(
    sourceWidth && sourceWidth > 0 && sourceHeight && sourceHeight > 0
  );
  const candidates = payload.detections ?? payload.boxes ?? (payload.bbox || payload.box ? [payload] : []);

  if (!Array.isArray(candidates)) {
    throw new TypeError("Detection message must contain a detections or boxes array.");
  }

  const detections = candidates.map((candidate, index) => {
    const [x1, y1, x2, y2] = readBox(candidate);
    if ([x1, y1, x2, y2].some((value) => value === null) || x2 <= x1 || y2 <= y1) {
      throw new TypeError(`Invalid bounding box at index ${index}.`);
    }

    const coordinateSpace = candidate.coordinateSpace ?? payload.coordinateSpace;
    const inferredNormalized = Math.min(x1, y1, x2, y2) >= 0 && Math.max(x1, y1, x2, y2) <= 1;
    const normalized = coordinateSpace === "normalized" || (!coordinateSpace && inferredNormalized);

    if (!normalized && !hasSourceDimensions) {
      throw new TypeError("Pixel bounding boxes require positive frame width and height.");
    }

    const status = String(candidate.status ?? payload.status ?? "defect").toLowerCase();
    return {
      x1,
      y1,
      x2,
      y2,
      normalized,
      label: String(candidate.label ?? candidate.class ?? payload.label ?? "defect"),
      confidence: asFiniteNumber(candidate.confidence ?? candidate.score),
      status,
      color: PASS_STATUSES.has(status) ? "#68efb3" : "#ff5f67"
    };
  });

  return {
    // Normalized boxes do not require dimensions. When they are omitted, the
    // renderer uses the MJPEG image's intrinsic size to preserve letterboxing.
    source: hasSourceDimensions ? { width: sourceWidth, height: sourceHeight } : null,
    frameId: frame.id ?? payload.frameId ?? null,
    sessionId: frame.sessionId ?? payload.sessionId ?? null,
    sequence: asFiniteNumber(frame.sequence ?? payload.sequence),
    timestamp: payload.timestamp ?? null,
    detections
  };
}
