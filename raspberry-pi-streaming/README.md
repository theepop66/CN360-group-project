# Raspberry Pi camera streaming

A single-camera Flask service for the CN360 quality-control pipeline. One background producer owns OpenCV's `VideoCapture`; every Pico/n8n client shares the latest frame instead of opening the camera again.

## API contract

| Endpoint | Purpose | Success response |
|---|---|---|
| `GET /stream.mjpg` | Live feed for Pico 4 `<img>` | `multipart/x-mixed-replace; boundary=frame` |
| `GET /capture` | Latest full-resolution still for n8n inference | `image/jpeg` |
| `POST /push` | Trigger an immediate push to the n8n webhook | `202` when push is configured, otherwise `409` |
| `GET /health` | Readiness/freshness probe | `200` when a recent frame is available, otherwise `503` |
| `GET /info` | Safe runtime configuration and endpoint discovery | JSON, always `200` |

`/capture` is the **pull** integration: n8n requests a JPEG when triggered.

## Pushing captures to n8n

Set `N8N_WEBHOOK_URL` to make the service **push** full-resolution captures to the n8n image-ingestion webhook. Every `PUSH_INTERVAL_SECONDS` (when greater than zero), and immediately on `POST /push`, the pusher takes the newest frame it has not sent yet and POSTs it as `multipart/form-data`:

| Multipart field | Value |
|---|---|
| `image_id` | `{session_id}-{frame_sequence}` — stable trace id for one capture |
| `timestamp` | Capture time, UTC ISO-8601 with milliseconds (same value as `X-Captured-At`) |
| `session_id` | Camera session; changes when the Pi process restarts |
| `frame_sequence` | 1-based frame counter within the session |
| `width` / `height` | Full-resolution capture dimensions |
| `source` | Public camera source (credentials redacted) |
| `trigger` | `interval` or `manual` |
| `image` | Full-resolution JPEG file part (`CAPTURE_JPEG_QUALITY`) |

The n8n workflow should use `image_id` as the correlation key between the capture, the inference result, and the HUD payload, and `timestamp` as the capture time.

**Failure behavior.** If the webhook answers non-2xx or is unreachable, the pusher retries the *same* frame up to `PUSH_MAX_ATTEMPTS` attempts, `PUSH_RETRY_SECONDS` apart, then drops it and moves on to the next fresh frame. It never re-sends an already-sent frame, and a stopped camera or webhook simply pauses pushing until it recovers. `GET /info` reports `push.totalPushed`, `push.totalDropped`, `push.consecutiveFailures`, `push.lastImageId`, `push.lastStatus`, `push.lastLatencyMs`, and `push.lastError`.

**Latency.** `push.lastLatencyMs` measures capture → webhook-accepted (camera `read()` to successful POST). The n8n workflow should measure webhook → inference → HUD separately; end-to-end capture-to-detection latency is the sum of the two.

Both `/capture` and each MJPEG part include `X-Camera-Session` and `X-Frame-Sequence`. `/capture` also includes `X-Captured-At`, `X-Frame-Width`, and `X-Frame-Height`. The n8n flow should copy these into the HUD detection payload so ordering still works after the Pi process restarts and its sequence resets.

## Development setup

Python 3.10 or newer is required.

```bash
cd raspberry-pi-streaming
python -m venv .venv
```

Activate the environment and install dependencies:

```bash
# Raspberry Pi / Linux
source .venv/bin/activate
python -m pip install -r requirements-dev.txt

# Windows PowerShell
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

Copy `.env.example` values into your shell or service environment. The app intentionally does not read `.env` by itself, so production secrets are not silently loaded from the working directory.

Run the development server:

```bash
python app.py
```

Then open:

```text
http://<RASPBERRY-PI-IP>:8000/stream.mjpg
http://<RASPBERRY-PI-IP>:8000/capture
http://<RASPBERRY-PI-IP>:8000/health
```

## Configuration

| Variable | Default | Meaning |
|---|---:|---|
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `8000` | HTTP port expected by the Pico scaffold |
| `CORS_ALLOWED_ORIGIN` | `*` | Origin allowed to poll `/health`; restrict to the HUD origin outside prototype use |
| `CAMERA_SOURCE` | `0` | USB device index, file path, or RTSP URL |
| `CAMERA_WIDTH` / `CAMERA_HEIGHT` | `1920` / `1080` | Requested capture size |
| `CAMERA_FPS` | `15` | Producer frame rate cap |
| `CAMERA_OPEN_TIMEOUT_SECONDS` | `5` | Network camera open timeout (FFmpeg/GStreamer) |
| `CAMERA_READ_TIMEOUT_SECONDS` | `5` | Network camera read timeout (FFmpeg/GStreamer) |
| `STREAM_WIDTH` | `1280` | MJPEG width; height preserves aspect ratio |
| `STREAM_JPEG_QUALITY` | `80` | MJPEG JPEG quality |
| `CAPTURE_JPEG_QUALITY` | `95` | Full-resolution snapshot JPEG quality |
| `CAMERA_RETRY_SECONDS` | `2` | Delay after open/read failure |
| `FRAME_STALE_SECONDS` | `3` | Maximum usable frame age |
| `INITIAL_FRAME_WAIT_SECONDS` | `2` | Initial `/stream.mjpg` readiness wait |
| `CAPTURE_WAIT_SECONDS` | `2` | `/capture` readiness wait |
| `N8N_WEBHOOK_URL` | *(empty)* | n8n image-ingestion webhook; empty disables push |
| `PUSH_INTERVAL_SECONDS` | `0` | Push cadence; `0` disables periodic push (manual `POST /push` still works) |
| `PUSH_TIMEOUT_SECONDS` | `10` | Per-attempt webhook POST timeout |
| `PUSH_RETRY_SECONDS` | `2` | Delay between push retry attempts |
| `PUSH_MAX_ATTEMPTS` | `3` | Attempts per frame before it is dropped |
| `LOG_LEVEL` | `INFO` | Python log level |

The service requests camera dimensions/FPS, but a driver may choose a different mode. Check `/info` after the first frame. Keep the stream and inference capture at the same aspect ratio or send exact source dimensions with n8n bounding boxes.

## Tests (no camera required)

```bash
python -m pytest
```

The test suite uses fake OpenCV/camera objects and covers lifecycle, reconnects, corrupt-frame suppression, full-resolution capture quality, MJPEG framing, cache headers, health states, configuration validation, credential redaction, and webhook pushing (multipart contract, retry/drop, camera and webhook outage recovery, no re-sends).

## Raspberry Pi deployment

1. Install the project under `/opt/cn360/raspberry-pi-streaming` and create its `.venv`.
2. Create a dedicated `cn360` user and grant it access to the `video` group.
3. Copy environment values to `/etc/cn360-camera.env`.
4. Copy `deploy/cn360-camera.service` to `/etc/systemd/system/`.
5. Run `sudo systemd-analyze verify /etc/systemd/system/cn360-camera.service`.
6. Enable and start it with `sudo systemctl enable --now cn360-camera`.

The unit deliberately uses Gunicorn with **one worker and eight threads**. More than one worker would create multiple `CameraService` instances and make them contend for the same camera. Each long-lived MJPEG client occupies one thread, so keep client count below the configured thread count or raise it while reserving capacity for `/capture` and `/health`. `deploy/gunicorn.conf.py` reads `HOST` and `PORT` from the environment file. Do not add `PrivateDevices=true`; it hides `/dev/video*` from the service.

## Production notes

- This scaffold is intended for a trusted prototype LAN. The default CORS origin is `*`; restrict it to the deployed HUD origin and put authentication/TLS plus network access control in front of the service before production use.
- `/capture` sends the newest fresh image; it does not trigger the ESP32 or call n8n itself.
- With `N8N_WEBHOOK_URL` set, the pusher runs in a background thread next to the camera producer; it never blocks the MJPEG stream or `/capture`. Pushing is disabled until the variable is set, so the service can be deployed before the n8n webhook exists.
- When the camera fails, the producer releases it and retries. `/health` reports `503` until a new frame arrives, while an existing MJPEG response waits and resumes with the recovered stream.
- Network sources such as RTSP receive OpenCV's open/read timeout parameters. These are backend-dependent (supported by FFmpeg/GStreamer); systemd still provides a process-level stop timeout.
- `opencv-python-headless` covers USB/UVC cameras through `VideoCapture`. The official CSI camera may work better through a future Picamera2 backend; keep that backend behind the existing `CameraService` interface.
