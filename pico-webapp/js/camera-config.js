export function cameraConfig(saved, defaults, location) {
  if (new URLSearchParams(location.search).get("camera") === "phone") {
    return {
      cameraSource: "remote",
      streamUrl: new URL("/phone-camera/stream.mjpg", location.href).href,
      healthUrl: new URL("/phone-camera/health", location.href).href
    };
  }
  return {
    cameraSource: (saved.cameraSource ?? defaults.cameraSource) === "remote" ? "remote" : "local",
    streamUrl: saved.streamUrl ?? defaults.raspberryPiStreamUrl ?? "",
    healthUrl: saved.healthUrl ?? defaults.raspberryPiHealthUrl ?? ""
  };
}
