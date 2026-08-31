# Pico 4 Web HUD

A build-free 2D quality-control HUD for the Pico 4 browser. It displays the Raspberry Pi MJPEG feed, draws n8n detection results on a canvas, and sends a new text prompt to n8n.

## Run locally

The browser must load the files through HTTP (not by opening `index.html` directly):

```bash
cd pico-webapp
python -m http.server 8080
```

Open `http://<DEVELOPMENT-PC-IP>:8080` from the Pico browser. Do not use `localhost` on the headset; it points to the headset itself.

Connection URLs can be changed in `config.js` or in **Connection settings** inside the HUD. Values saved in the HUD are stored only in that browser's local storage.

The HUD polls the Pi `/health` endpoint while it is open. It hides stale video on `503` and, as a safety-first default, on any other reachable non-2xx health response; non-503 errors are shown as health/configuration errors. When health returns to `200`, the MJPEG source reconnects with a unique URL and stays hidden until the browser observes a fresh frame. The Pi must allow this HUD origin through CORS (the Pi scaffold defaults to `*` for prototype use).

## Integration contract

### Raspberry Pi video

The default stream URL is:

```text
GET http://raspberrypi.local:8000/stream.mjpg
Content-Type: multipart/x-mixed-replace; boundary=frame
```

The HUD uses an `<img>` for MJPEG and a separate `<canvas>` for the overlay.

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

The tests cover payload parsing, result ordering, normalized coordinates, validation, letterbox-aware box scaling, prompt payloads, HTTP errors, and request timeouts.

Before a demo, also smoke-test on the physical Pico 4: rotate/resize the view, disconnect and restore Wi-Fi, verify that stale boxes clear, submit a prompt through the real n8n CORS policy, and compare one known box against the inference snapshot.
