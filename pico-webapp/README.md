# Pico 4 Web HUD

A build-free 2D quality-control HUD for the Pico 4 browser. It can display this device's local webcam or a remote MJPEG/image feed, draws n8n detection results on a canvas, and sends a new text prompt to n8n.

## View modes

The viewer toolbar has a **2D HUD / AR passthrough / VR cinema** switcher (top-right of the video panel):

- **2D HUD** (default) — the flat page described above. Its **Fullscreen** button fills the whole browser viewport with the camera feed and re-docks the topbar and prompt panel as floating, semi-transparent panels over it (see `.app-shell:fullscreen` in `styles.css`).
- **AR passthrough** — requests a WebXR `immersive-ar` session with a [DOM Overlay](https://immersive-web.github.io/dom-overlays/) (`js/ar-passthrough.js`). The headset's own real-world passthrough cameras show through natively; this page draws no 3D content at all. The camera panel shrinks into a small floating "monitor" (top-right) and the prompt panel floats bottom-center, both over a transparent background (`.xr-ar-active` in `styles.css`), so what you actually see through the lenses is the real room with the QC HUD floating in it.
- **VR cinema** — requests an `immersive-vr` session built with [A-Frame](https://aframe.io/) (`js/vr-cinema.js`, loaded lazily from a CDN on first use — the headset needs internet access for this mode). The live camera feed plus its detection-box overlay are composited onto an offscreen canvas (`compositeVrFrame()` in `js/app.js`) and shown on a floating screen inside a simple virtual room, with a head-locked text HUD for the detection summary. There is no in-VR keyboard, so change the inspection prompt before entering, or exit back to 2D HUD mode to edit it.

Both XR modes require the headset's browser to support the relevant WebXR session mode; unsupported devices get an inline error and stay on 2D HUD instead of failing silently. Verify camera-passthrough- and detection-related logic with the 2D HUD first — it is the only mode this project's `npm test` suite and a desktop browser can exercise directly. Test the XR modes with the [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) in desktop Chrome/Edge for quick iteration, then confirm on a physical Pico 4 before a demo — an emulator cannot verify stereo rendering, head tracking, controller input, or real passthrough latency.

## Run locally

The browser must load the files through HTTP (not by opening `index.html` directly):

```bash
cd pico-webapp
python -m http.server 8080
```

For desktop webcam development, open `http://localhost:8080`. From the PICO browser, open `http://<DEVELOPMENT-PC-IP>:8080` and select the remote source mode. Do not use `localhost` on the headset; it points to the headset itself.

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

> **WebSocket ownership:** a standard n8n Webhook node is HTTP-only and does not automatically create `ws://n8n...` routes. The n8n side must provide a real WebSocket-capable gateway/community node or change this transport by agreement. The default `n8n-gateway.local` URL is a placeholder, not a built-in n8n endpoint.

### Prompt update to n8n

The HUD submits:

```http
POST /webhook/detection-prompt
Content-Type: application/json

{"prompt":"scratch"}
```

Any `2xx` response is treated as success. The browser aborts the request after `promptTimeoutMs` (8 seconds by default) so the control does not remain stuck when n8n is unreachable.

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
