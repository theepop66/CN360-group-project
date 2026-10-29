# iPhone camera receiver software verification — 2026-10-29

Scope: an iPhone sender page, paired JPEG receiver, existing PC/Pico remote HUD
feed and the n8n pull-capture contract. Spec: `../specs/iphone-camera-hud.md`.

## Verification

- HUD: 72/72 Node tests passed, including 12 phone sender/receiver regressions.
- n8n: 228/228 tests passed; workflows and deployment were not modified.
- Detection relay: 26/26 tests passed.
- Focused tests use an actual repository JPEG over HTTP and verify byte equality
  between upload and capture, five identity headers, MJPEG bytes, stale closure,
  ordering, publisher ownership/replacement, invalid/oversized input and viewer
  limits. Sender lifecycle tests use controlled camera callbacks, not an iPhone.
- A frozen video cannot generate newly timestamped uploads; backgrounding or
  muting invalidates the pending upload/frame wait and releases the camera.
- Real Windows launcher start, owned-process stop, certificate reuse and restart
  succeeded on HTTP 8080 / HTTPS 8443. HTTPS GET was validated using the generated
  development CA. Its downloadable DER certificate matched the local file byte
  for byte. No browser warning was bypassed or OS trust changed by automation.
- Browser UI inspection confirmed the Thai sender form and remote phone HUD
  route. With no phone sender connected, the camera correctly showed unavailable.

## Standards

0 remaining findings. The initial review found a frozen-frame freshness defect;
the sender now requires newly presented frames and stops on interruption.

## Spec

0 remaining findings. The initial review additionally found an HTTP-only startup
readiness race; the launcher now waits for the pairing code after both listeners
start and validates the HTTPS endpoint against the generated CA.

## Pending physical checks

The iPhone must trust the local certificate, allow its camera and start sending.
Confirm its real image on the PC and physical Pico, then test Stop/background,
stale disappearance and restart/new session. Pico XR needs its own browser trust
and device acceptance. No real phone/Pico camera run is claimed by this report.

The launcher is camera-only and does not connect the actual actuator. n8n/model
deployment, prompt echo, inference from a phone image, the matching inspected
snapshot and sensor-to-action timing remain separate integration work. These
receiver checks do not close #23, #24 or #25 or establish AI accuracy.

Private keys, pairing code and runtime logs are outside the repository under the
local application-data camera directory. Do not copy them into evidence commits.
