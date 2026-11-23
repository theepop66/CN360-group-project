Historical result: superseded by phone camera source zoom

This records the earlier HUD image enlargement. The user clarified that the
joystick must control the phone camera before upload. See
`phone-camera-source-zoom-2026-10-29.md` for that replacement and its limits.

# HUD joystick zoom software verification — 2026-10-29

Spec: `../specs/hud-joystick-zoom.md`.

- HUD suite: **79/79 passed**. Focused geometry/controller suite: 25/25.
- Regression tests were run before implementation and exposed missing zoom,
  left-stick servo interference and absent geometry handling. Final tests prove
  independent simultaneous hands, left horizontal/deadzone suppression, bounded
  repeat, zoom limits/reset, toolbar synchronization and session end/stop.
- Pixel and normalized boxes use the same centered crop as the media, including
  portrait/square DOM viewports and the separate 16:9 VR viewport.
- Browser inspection on the actual local HUD confirmed plus changes 1.0× to
  1.1× and the media CSS transform to scale 1.1. Minus returns to 1.0× with the
  minimum button disabled. Reset returns to 1.0×. All controls fit the narrow
  app browser panel after the responsive layout adjustment.
- Syntax checks and diff whitespace checks passed.

## Standards

0 remaining findings, including the final responsive CSS delta.

## Spec

0 remaining findings, including the final responsive CSS delta.

Physical Pico joystick mapping, AR/VR display, and live iPhone image behavior
still require device verification. The browser control check had no active
phone feed; it is not evidence of camera, AI accuracy or actuator acceptance.
This work changes only viewer zoom and controller routing, not capture pixels,
AI input, stored frames or firmware. No GitHub issue was closed.
#
