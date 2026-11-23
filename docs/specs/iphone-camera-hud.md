# iPhone camera for the PC and Pico HUD

Use the iPhone rear camera as a LAN camera source. The phone opens a dedicated
HTTPS sender page; a PC-hosted receiver publishes the same JPEG bytes as an
MJPEG feed for the existing HUD and a pull `/capture` endpoint for n8n.

- Opt in with the HUD server's `--phone-camera` switch. Existing camera defaults
  and workflows continue to work. `/?camera=phone` selects the same-origin feed
  without replacing saved connection settings.
- Pair one phone with a code shown on the PC. Never put the code in a URL or
  broadcast it to viewers. Bound upload size, dimensions and stream clients.
- Assign a new camera session on every sender start and reject old-session or
  out-of-order uploads. Return the existing five capture identity headers.
- Use the PC clock anchored at pairing to timestamp frames. Reject delayed
  uploads and return 503 for missing/stale images. Stop publishing when the
  phone stops, goes into the background, or disconnects. Do not replay stale
  images to new viewers or n8n.
- Use a rear camera, muted inline preview, bounded JPEG resolution, and one
  upload at a time. Provide clear start/stop/status instructions and a HUD link.
- Provide local HTTPS setup and iPhone certificate-trust instructions. Keep
  private keys outside the repository. Do not enable actuators or claim #23,
  #24 or #25 acceptance from receiver-only tests.

Validate actual HTTP capture bytes/identity, MJPEG, publisher ownership,
ordering, stale rejection/recovery, malformed/oversized uploads and the HUD
shortcut. Physical iPhone/Pico operation requires a manual run and remains
explicitly pending until observed. Native AI correctness/timing is separate.
