# Pico 4 Web HUD

A build-free 2D quality-control HUD for the Pico 4 browser. It can display this device's local webcam or a remote MJPEG/image feed, draws n8n detection results on a canvas, and sends a new text prompt to n8n.

## View modes

The viewer toolbar has a **2D HUD / AR passthrough / VR cinema** switcher (top-right of the video panel):

- **2D HUD** (default) — the flat page described above. Its **Fullscreen** button fills the whole browser viewport with the camera feed and re-docks the topbar and prompt panel as floating, semi-transparent panels over it (see `.app-shell:fullscreen` in `styles.css`).
- **AR passthrough** — requests a WebXR `immersive-ar` session with a [DOM Overlay](https://immersive-web.github.io/dom-overlays/) (`js/ar-passthrough.js`). The headset's own real-world passthrough cameras show through natively; this page draws no 3D content at all. The camera panel shrinks into a small floating "monitor" (top-right) and the prompt panel floats bottom-center, both over a transparent background (`.xr-ar-active` in `styles.css`), so what you actually see through the lenses is the real room with the QC HUD floating in it.
- **VR cinema** — requests an `immersive-vr` session built with [A-Frame](https://aframe.io/) (`js/vr-cinema.js`, loaded lazily from a CDN on first use — the headset needs internet access for this mode). The live camera feed plus its detection-box overlay are composited onto an offscreen canvas (`compositeVrFrame()` in `js/app.js`) and shown on a floating screen inside a simple virtual room, with a head-locked text HUD for the detection summary. There is no in-VR keyboard, so change the inspection prompt before entering, or exit back to 2D HUD mode to edit it.

Both XR modes require the headset's browser to support the relevant WebXR session mode; unsupported devices get an inline error and stay on 2D HUD instead of failing silently. Verify camera-passthrough- and detection-related logic with the 2D HUD first — it is the only mode this project's `npm test` suite and a desktop browser can exercise directly. Test the XR modes with the [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) in desktop Chrome/Edge for quick iteration, then confirm on a physical Pico 4 before a demo — an emulator cannot verify stereo rendering, head tracking, controller input, or real passthrough latency.

### Controller shortcuts (AR / VR only)

The flat 2D browser never exposes controller buttons to page script — there the controller is only a pointer. Inside AR passthrough or VR cinema, `js/xr-controller.js` polls the XR gamepads:

| Input | Action |
| --- | --- |
| Left thumbstick up / down | Command the paired iPhone camera to zoom in / out within its reported range |
| Left thumbstick click | Reset the phone camera to its nearest supported 1× |
| Right thumbstick up / right | Jog the servo +`stepDeg` (repeats while held) |
| Right thumbstick down / left | Jog the servo −`stepDeg` |
| Right **A** (primary) | Reject now (`/verdict`) |
| Right **B** (secondary) | Pass now (`/verdict`) |
| **Grip** (either hand) | Sweep |
| Left **X** (primary) | Mode → Manual |
| Left **Y** (secondary) | Mode → Auto |

The action mapping, step size, repeat cadence, and deadzone live in `controllerShortcuts` in `config.js`. The current PICO button indices are defined in `js/xr-controller.js`; open the HUD with `?xrdebug=1` to print which index each press reports if a firmware/browser update changes it. The firmware still enforces its own rules — angle jogs need Manual mode and an idle unit, reject/pass only apply while an item is in the beam — and the HUD mirrors that feedback to the VR status line or the AR panel.

Zoom controls the **capture camera on the iPhone before upload**. Enter the
current phone pairing code in **Connection settings → Phone camera control
code** on the HUD. The code stays in memory for this page only. Use the
**− / actual zoom / +** toolbar on PC/Pico 2D, or the left thumbstick in an
active WebXR AR/VR session over trusted HTTPS; click the level/stick to reset.
In 2D the controller acts as a pointer. Left-stick horizontal movement is
ignored; the right stick retains its separate servo mapping.

The phone reports its camera track's actual range, step when exposed, and current
setting. Min/max-only ranges use 0.1× requests with the same readback check.
The HUD shows a pending state until the phone applies the command, observes
new camera frames and confirms its setting. Captures are unavailable during
the change, and frames from an older zoom command are discarded. Future HUD
and n8n captures receive the changed source image; existing saved inspections
retain their original pixels. Each new phone session starts with its reported
camera setting. No extra viewer zoom is applied; detection boxes still use the
source dimensions and each viewport's normal cover geometry.

Safari/device support is checked on the live camera. If zoom capabilities or
settings are unavailable, the HUD explicitly disables control. This web API
does not guarantee optical zoom or lens switching. The API changes the capture
track as described by [W3C Image Capture](https://www.w3.org/TR/image-capture/);
actual iPhone support and Pico controls must be checked on those devices.
An ignored constraint is reported as a failure. A camera operation that times
out stops the sender, requiring Start again rather than uploading uncertain
pixels. Physical camera zoom and headset acceptance remain pending.

## Run locally

### iPhone camera → PC / Pico HUD

The optional phone receiver serves a dedicated sender page and exposes the
uploaded JPEGs through the HUD's existing remote camera support. On Windows
PowerShell 7.2+, run this from the repository root with the PC's **Wi-Fi IPv4**:

```powershell
./pico-webapp/tools/start-phone-camera.ps1 -IpAddress 192.168.1.20
```

It starts a camera-only bench on HTTP 8080 / HTTPS 8443. It creates a 30-day
development CA and IP-specific server certificate under
`%LOCALAPPDATA%/CN360/phone-camera/<IP>/`; private keys never enter the repository.
It does not install trust or change firewall rules. The pairing code, URLs and
public CA SHA256 fingerprint are in `connection.txt` in that private directory.
The local CA signing key is discarded after issuing the server certificate.
Keep the generated server private key private and remove the trusted CA from
devices when testing ends. Restarting at the same IP reuses unexpired files;
changing IP needs a new setup and trust. Expired files must be preserved/moved
aside before regenerating and trusting the replacement CA.

1. Connect iPhone, PC and Pico to the same network. Allow Node on the Windows
   Private network if prompted. Guest/campus Wi-Fi may isolate devices; if so,
   use a private shared network with device-to-device access.
2. On iPhone open `http://<PC-IP>:8080/phone-camera-ca.cer`, install the downloaded
   CA in **Settings → General → VPN & Device Management**, then enable it in
   **General → About → Certificate Trust Settings**. Compare its fingerprint
   with the PC file before trusting it. This is development-only local trust.
3. In Safari open `https://<PC-IP>:8443/phone-camera.html`, enter the PC pairing
   code, tap Start and allow camera access. The rear camera is preferred. Keep
   this page visible; hiding it stops capture. Stop the old sender or wait ten
   seconds before pairing a replacement. The code is never stored in browser
   storage or in a URL.
4. On the PC open `http://localhost:8080/?camera=phone`. On Pico open
   `http://<PC-IP>:8080/?camera=phone` for 2D, or the HTTPS equivalent after
   trusting the CA in its browser for XR. Physical Pico/XR acceptance is separate.
5. For remote camera zoom, enter the same pairing code in the HUD's Connection
   settings. Check the phone's camera zoom status and HUD range. If supported,
   use the toolbar or left joystick and verify that the phone preview changes
   along with the PC/Pico image. An unsupported status means this browser/camera
   cannot provide remote zoom through the current web sender.

The phone shortcut temporarily selects same-origin stream/health URLs and takes
precedence over saved camera settings. Other saved connections, including n8n
and relay URLs, are unchanged. A relay connection warning is expected if only
the camera server is running; live camera display does not require AI or relay.

For n8n pull ingestion, use `piBaseUrl: "http://host.docker.internal:8080"`
when n8n runs in Docker Desktop on this PC, or `http://<PC-IP>:8080` from another
host. `/capture` returns the exact accepted JPEG and all five existing frame
identity headers; `/health` is also available. Use the existing local runtime
configuration/deployment procedure; starting the camera does **not** modify or
activate n8n workflows, start the model or establish a physical controller.
The camera-only launcher sends `/esp/*` to an unused loopback port, so it cannot
operate the actual servo. For an already configured HUD server, use its normal
launch command with `--phone-camera` (and optional `--phone-ca <public-ca-file>`).

Transport bounds: one active publisher, at most eight MJPEG viewers, JPEG only,
512 KiB per upload, at most 1920×1080 pixels; the sender fits within 960×720 and
uploads one frame at a time with a 125 ms minimum gap. Camera sessions change
on every start. Uploads require a newly presented video frame; a muted/paused
camera stops the sender, and two seconds without a new video frame ends it.
The sender requires `requestVideoFrameCallback` (update Safari if unavailable).
Duplicate/reordered sequence numbers, replaced sessions,
future-dated or more-than-two-second-old images are rejected. `/capture` and
health return 503 when stale; existing streams end rather than replaying a
stale image. Timestamping uses the PC pairing clock plus the phone's monotonic
clock, anchored conservatively when the pairing response arrives. It estimates
capture time; physical sensor-to-camera latency still requires measurement.
Frames and viewer buffers are memory-only; no snapshots are saved by this
receiver. Authorized n8n inspection can separately persist its captured image.

Stop the owned camera server with:

```powershell
./pico-webapp/tools/stop-phone-camera.ps1 -IpAddress 192.168.1.20
```

This adds an alternative live camera for #23. It does not by itself complete
Pi deployment, prompt/inference integration, AI accuracy, physical timing or
system acceptance. Verify a live iPhone image, camera stop/reconnect and the
matching inspected snapshot on the physical PC/Pico before claiming those.

Start the detection relay first with `npm start --prefix detection-relay` from
the repository root. `npm run serve` in this folder proxies the default
same-origin `/detections` WebSocket to the relay on `127.0.0.1:8081`.
The HTTPS listener also tunnels this channel, so the default becomes `wss://`
on a secure page. Use `--relay-origin` to point the HUD server at another relay.
If using a different static server, set an explicit relay URL in Connection
settings; that server does not automatically provide the tunnel.

The browser must load the files through HTTP (not by opening `index.html` directly):

```bash
cd pico-webapp
npm run serve -- --control-unit http://172.20.10.5
```

For desktop webcam development, open `http://localhost:8080`. From the PICO browser, open `http://<DEVELOPMENT-PC-IP>:8080` and select the remote source mode. Do not use `localhost` on the headset; it points to the headset itself.

The bundled server serves the HUD and forwards `/esp/*` to the control unit. Its default target is `http://172.20.10.5`, matching the current bench firmware. Use `--control-unit http://<ESP32-IP>` for another network.

### HTTPS for AR / VR controller input

WebXR on the headset needs HTTPS. Place a certificate trusted by the PICO browser at `tools/dev-cert.pem` and its private key at `tools/dev-key.pem`, with a certificate valid for the hostname or IP address used by the headset. These local files and server logs are gitignored.

```bash
npm run serve:vr -- --control-unit http://172.20.10.5
```

Open `https://<DEVELOPMENT-PC-IP>:8443/?xrdebug=1` on the headset, then enter AR passthrough or VR cinema. Servo requests use the same HTTPS origin (`/esp/mode`, `/esp/servo`, `/esp/verdict`); the server forwards them to the ESP32 over HTTP. `npm run serve` keeps the flat HUD available on port 8080, but does not enable headset WebXR by itself.

The default development source is **Local webcam**. Allow camera permission when prompted. `getUserMedia()` always opens the camera attached to the device running the browser; it does not relay a computer webcam to a PICO headset. It also requires a secure browser context, normally HTTPS or localhost.

For a headset, select **Remote stream / n8n source (PICO)** and enter a URL reachable from the headset over the LAN. Connection values can be changed in `config.js` or in **Connection settings** inside the HUD. Values saved in the HUD are stored only in that browser's local storage.

The HUD polls the Pi `/health` endpoint while it is open. It hides stale video on `503` and, as a safety-first default, on any other reachable non-2xx health response; non-503 errors are shown as health/configuration errors. When health returns to `200`, the MJPEG source reconnects with a unique URL and stays hidden until the browser observes a fresh frame. The Pi must allow this HUD origin through CORS (the Pi scaffold defaults to `*` for prototype use).

## Integration contract

### Camera sources

The viewer uses `object-fit: cover`, so the active camera fills the entire video section and may crop its outer edges. Bounding-box rendering uses the same cover calculation so overlays remain aligned.

- `local`: uses `navigator.mediaDevices.getUserMedia()` on the current device.
- `remote`: uses an `<img>` for a still image or MJPEG source and a separate `<canvas>` for the overlay.

### Raspberry Pi video

The default stream URL is:

```text
GET http://raspberrypi.local:8000/stream.mjpg
Content-Type: multipart/x-mixed-replace; boundary=frame
```

For live video on the PICO, the preferred route is camera/Pi -> PICO directly. n8n should orchestrate the workflow and send detection metadata or a stream URL, rather than relaying every video frame.

### Camera source or analyzed frame from n8n

The WebSocket gateway may switch the HUD to a remote camera at runtime. This update is temporary and does not overwrite the browser's saved settings:

```json
{
  "schemaVersion": 1,
  "type": "camera.source",
  "timestamp": "2026-08-24T12:00:00Z",
  "camera": {
    "id": "inspection-1",
    "mode": "mjpeg",
    "streamUrl": "http://192.168.1.20:8000/stream.mjpg",
    "healthUrl": "http://192.168.1.20:8000/health",
    "sessionId": "pi-boot-7f8c"
  }
}
```

If the HUD is already in `remote` mode, n8n may also send an individual analyzed frame using `type: "camera.frame"`, or include `frame.snapshotUrl` / `frame.imageUrl` in a detection event:

```json
{
  "type": "camera.frame",
  "frame": {
    "id": "frame-42",
    "imageUrl": "http://192.168.1.20:8000/snapshots/frame-42.jpg"
  }
}
```

HTTP(S) image URLs are preferred. Bounded `data:image/jpeg|png|webp|gif|avif;base64,...` values are accepted for single frames, but Base64 should not be used as a live-video transport.

### Detection events from n8n

The configured WebSocket gateway should broadcast messages in this shape:

```json
{
  "type": "detections",
  "timestamp": "2026-08-23T12:00:00Z",
  "frame": {
    "id": "frame-42",
    "sessionId": "pi-boot-7f8c",
    "sequence": 42,
    "width": 1920,
    "height": 1080
  },
  "detections": [
    {
      "bbox": { "x1": 120, "y1": 80, "x2": 420, "y2": 310 },
      "label": "scratch",
      "confidence": 0.91,
      "status": "defect"
    }
  ]
}
```

- Pixel boxes require the source frame `width` and `height` so the canvas can scale them correctly.
- Normalized coordinates from `0` to `1` are also accepted. Set `"coordinateSpace": "normalized"` when possible instead of relying on automatic detection. If frame dimensions are omitted, the HUD uses the MJPEG image's intrinsic aspect ratio.
- `status` values `pass`, `passed`, `accepted`, `clear`, or `ok` draw green; other values draw red.
- Send an empty `detections` array to clear the overlay immediately. Old boxes also clear after `detectionTtlMs`.
- Include a capture `timestamp`, increasing `frame.sequence`, and producer `frame.sessionId`; the HUD ignores older results that arrive after a newer n8n execution and accepts a reset sequence after a new producer session. If `timestamp` is omitted, ordering falls back to `sequence` rather than inventing a receive-time timestamp. The n8n flow should copy these values from the Pi capture response headers.
- The parser also accepts `boxes`, `imageWidth`, and `imageHeight` as compatibility aliases.

> **WebSocket ownership:** a standard n8n Webhook node is HTTP-only. The [detection relay](../detection-relay/README.md) serves port 8081, and the HUD server tunnels its `/detections` channel on the page's own host and port. The default therefore follows HTTP/HTTPS as `ws://`/`wss://`; set `--relay-origin` on the HUD server when the relay is on another machine. Connection settings can override this for a different deployment.

### Prompt update to n8n

The HUD submits:

```http
POST /webhook/detection-prompt
Content-Type: application/json

{"prompt":"scratch"}
```

Any `2xx` response is treated as success. The browser aborts the request after `promptTimeoutMs` (8 seconds by default) so the control does not remain stuck when n8n is unreachable.

### Reject actuator (360ControlUnit / ESP32)

The **360ControlUnit servo** panel (`js/servo.js`) talks directly to the ESP32 firmware in `360ControlUnit/src/main.cpp` — not through n8n. It uses two configured URLs, `servoUrl` and `modeUrl` (Connection settings, or `controlUnitServoUrl`/`controlUnitModeUrl` in `config.js`):

```http
POST {modeUrl}          {"mode":"auto"|"manual"}       -> {"accepted":bool,"mode":"auto"|"manual"}
POST {servoUrl}         {"angle":0-180} or {"sweep":true} -> {"accepted":bool}
POST {servoUrl}/../verdict  {"action":"reject"|"pass","controller_session":"...","item_id":"..."}  -> {"accepted":bool,"status":"rejected"|"passed"|"ignored"}
```

The `/verdict` endpoint is derived from `servoUrl` by replacing its last path segment (e.g. `http://192.168.1.50/servo` → `http://192.168.1.50/verdict`) rather than being a third configured field.

The panel reads `/status` on the same controller before a manual Verdict and
requires `awaiting_verdict` plus its active session/item. The original deadline
is retained; a later reply for A cannot control B. Manual angle/sweep still
require Manual mode and an idle controller. An ignored command reports its
reason. Acceptance requires a boolean `accepted` and a matching echoed item;
missing or mismatched replies display unknown acceptance. A network timeout
can occur after the controller acted, so it does not prove non-delivery.

The ESP32 firmware sends permissive CORS headers (`Access-Control-Allow-Origin: *`) so the browser can call it directly without a gateway.

## Network notes

- The Raspberry Pi and n8n endpoints must be reachable from the Pico headset on the LAN.
- A local webcam belongs to the device running the page. To show a PC webcam on a PICO headset, publish that webcam as a LAN-reachable MJPEG/WebRTC endpoint and use remote mode.
- n8n must allow the HUD origin for the prompt request and must accept the browser's WebSocket origin.
- Use one security scheme end to end. An HTTPS HUD may block `http://` video and `ws://` detection data as mixed content.
- The inference frame must have the same crop/aspect ratio as the stream, or the n8n payload must describe the displayed source dimensions.
- A box belongs to the captured inference frame, while the MJPEG feed keeps moving. For a moving conveyor, agree on synchronization before production use (for example: show the analyzed snapshot, address/buffer frames by `frame.id`, or render annotations next to rather than over unsynchronized live video).
- The plain `http://` and `ws://` defaults are suitable only for an isolated prototype LAN. Before controlling a real actuator, put authentication and TLS at a gateway/reverse proxy and restrict allowed origins. Do not place reusable secrets in the URL fields or browser local storage.

## Tests

No packages need to be installed. With Node.js 18 or newer:

```bash
npm test
```

The tests cover camera-message parsing, payload parsing, result ordering, normalized coordinates, validation, contain/cover-aware box scaling, prompt payloads, HTTP errors, and request timeouts.

Before a demo, also smoke-test on the physical Pico 4: rotate/resize the view, disconnect and restore Wi-Fi, verify that stale boxes clear, submit a prompt through the real n8n CORS policy, and compare one known box against the inference snapshot.
