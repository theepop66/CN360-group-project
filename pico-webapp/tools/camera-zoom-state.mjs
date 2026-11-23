import { requestedCameraZoom, validateCameraZoom } from "../js/camera-zoom.js";

export function createCameraZoomState() {
  let camera = { supported: false, reason: "waiting_for_phone_camera_report" };
  let command = null;
  let nextId = 0;
  let error = null;
  return {
    report(body) {
      const validated = validateCameraZoom(body);
      const ack = body.commandId ?? 0;
      if (!Number.isSafeInteger(ack) || ack < 0 || ack !== (command?.id ?? nextId)) throw new Error("zoom_ack_mismatch");
      if (command && !body.error && (!validated.supported || Math.abs(validated.value - command.value) > 0.00001)) throw new Error("zoom_not_confirmed");
      camera = validated;
      error = body.error ? "camera_zoom_apply_failed" : null;
      command = null;
    },
    request(action) {
      if (command) throw new Error("zoom_command_pending");
      const value = requestedCameraZoom(camera, action);
      if (Math.abs(value - camera.value) < 0.00001) return null;
      command = { id: ++nextId, value };
      error = null;
      return command;
    },
    state() { return { ...camera, status: command ? "pending" : error ? "error" : camera.supported ? "ready" : "unsupported", error, commandId: command?.id ?? nextId }; },
    pending() { return command ? { ...command } : null; }
  };
}
