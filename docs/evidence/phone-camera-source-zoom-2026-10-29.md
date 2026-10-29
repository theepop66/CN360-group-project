# Phone camera source zoom — 2026-10-29

Spec: `../specs/phone-camera-source-zoom.md`. This replaces the earlier
HUD-only enlargement recorded in `hud-joystick-zoom-2026-10-29.md`.

The left XR stick and PC toolbar send authenticated, session-bound commands to
the PC receiver. The sender applies them to its video capture track, waits for
new presented frames, and reads the actual camera setting before acknowledging.
No CSS or canvas viewer zoom remains. A queued target never becomes the displayed
applied value merely because the request was accepted.

Software evidence:

- Camera API tests cover discrete device steps (including 0.01/0.05×), continuous
  min/max-only ranges, ignored constraints, unavailable capabilities/readback,
  and hung operations. A timeout stops the sender to avoid a later camera change
  producing incorrectly labelled frames.
- Sender tests observe the camera API call before the next canvas capture and
  verify the acknowledged revision on the subsequent JPEG upload. These use a
  simulated track, not a physical iPhone.
- HTTP tests cover pairing-code control, sender-token reports, replaced phone
  sessions, mismatched acknowledgements, bounded bodies, stale camera control,
  unavailable captures while pending, rejected old frame revisions after
  confirmation, new-frame recovery, and apply failure with actual settings.
- Viewer tests cover actual-versus-pending state, session/authentication,
  unsupported/offline/locked controls, stale poll suppression and exit aborts.
  Controller tests retain left-camera/right-servo isolation and session cleanup.
- Two-axis code review found one device-step mismatch; it was fixed and covered
  by regression assertions. Final review: Standards 0 remaining, Spec 0 remaining.
- HUD suite: **91/91 passed**; n8n: **228/228 passed**; relay: **26/26 passed**.
  Syntax and whitespace checks passed.
  One preceding HUD run reported only a test-worker failure for the HTTP camera
  file without an assertion diagnostic. Its direct run and subsequent complete
  HUD run passed unchanged; the transient failure's cause is unconfirmed.
- The updated camera-only receiver was restarted at the PC's current Wi-Fi IP,
  `192.168.0.5`, with trusted-CA HTTPS startup verification. The actual HUD page
  showed disabled zoom buttons, an empty password control-code field and
  “Waiting for the iPhone camera.” Computed camera transform was `none`.
  No phone was paired during this browser check.

Compatibility: W3C describes track zoom capabilities/settings and applying
constraints. WebKit's current capability conversion exposes zoom as a
min/max-only DoubleRange, so absence of a discrete step does not falsely mark
it unsupported. We use 0.1× requests for that range and still require readback.
These sources establish the API approach, not support on an unobserved phone:
[W3C Image Capture](https://www.w3.org/TR/image-capture/),
[WebKit capabilities](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediastream/MediaTrackCapabilities.cpp).

Physical iPhone capability availability, visible source zoom, camera recovery,
Pico joystick operation and end-to-end AI inspection of the zoomed source remain
pending. Optical zoom/lens switching is not guaranteed by this API. No hardware
acceptance or closure of #23, #24 or #25 is claimed.
