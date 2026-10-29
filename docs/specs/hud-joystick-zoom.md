# Camera zoom with the Pico joystick

Add centered digital zoom from 1× to 4× to the existing HUD. It changes only
viewing: iPhone capture, AI inputs, stored frames and detection coordinates
remain unchanged.

- In active WebXR AR/VR sessions, left thumbstick up/down zooms in/out with
  deadzone and bounded repeat. Left thumbstick click resets to 1×. Horizontal
  left-stick movement does not zoom or operate the servo.
- Reserve the right stick for the existing servo jog. Keep other actuator
  buttons unchanged. Stop input polling on session end or explicit stop.
- Provide minus/plus/reset and visible zoom level for PC/Pico 2D, where headset
  sticks are not exposed by the browser. Controls work without a camera or AI.
- Render live remote/local images, analyzed snapshots and detection boxes using
  the same centered crop. AR DOM overlay and VR screen use their own viewport
  dimensions so boxes align even at different aspect ratios or after resize.
- Keep zoom when switching view modes or reconnecting the camera. Begin a new
  page at 1×; no new persistent settings are needed.

Verify independent hands and simultaneous input, deadzone/repeat, min/max/reset,
session stop, and shared image/box geometry across aspect ratios. Browser-check
the 2D controls. Physical Pico joystick/XR verification remains pending unless
observed; do not claim hardware acceptance.
