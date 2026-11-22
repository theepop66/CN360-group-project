// An HTTP 200 is not proof of acceptance, and acceptance is not a position sensor.
export function controlFeedback(result, describeSuccess) {
  if (result?.accepted === true) return { state: "ok", text: describeSuccess(result) };
  if (result?.accepted !== false) {
    return { state: "error", text: "Control acceptance is unknown. Check the controller before retrying." };
  }
  const reasons = {
    manual_mode_required: "Servo requires Manual mode. Press X, wait for confirmation, then press Grip to Sweep.",
    controller_busy: "Controller is busy. Wait for the cycle to finish before using the servo.",
    servo_command_refused: "Servo command was refused. Check the controller mode and state."
  };
  return { state: "idle", text: reasons[result.reason] ??
    `Control unit ignored this request (${result.reason ?? "wrong mode, or mid-cycle"}).` };
}
