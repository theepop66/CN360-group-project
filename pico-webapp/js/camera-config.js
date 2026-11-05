const VALID_SOURCES = new Set(["local", "remote", "webrtc"]);

export function cameraConfig(saved, defaults, location) {
  const param = new URLSearchParams(location.search).get("camera");
  if (param === "phone") {
    return {
      cameraSource: "remote",
      streamUrl: new URL("/phone-camera/stream.mjpg", location.href).href,
      healthUrl: new URL("/phone-camera/health", location.href).href
    };
  }
  if (param === "webrtc") {
    return { cameraSource: "webrtc", streamUrl: "", healthUrl: "" };
  }
  const source = saved.cameraSource ?? defaults.cameraSource;
  return {
    cameraSource: VALID_SOURCES.has(source) ? source : "local",
    streamUrl: saved.streamUrl ?? defaults.raspberryPiStreamUrl ?? "",
    healthUrl: saved.healthUrl ?? defaults.raspberryPiHealthUrl ?? ""
  };
}
