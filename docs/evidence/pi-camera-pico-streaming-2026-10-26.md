# Raspberry Pi Camera & Pico 4 Live Streaming Evidence — 2026-10-26

Evidence documentation for Issue #22: `[HIGH][INT-03] ติดตั้งกล้อง Raspberry Pi และแสดง live stream บน Pico 4`

---

## 1. ข้อมูลอุปกรณ์ (Hardware & Environment)

* **Single Board Computer (SBC)**: Raspberry Pi (Running Arch Linux ARM, aarch64, kernel with `dwc_otg`)
* **Camera Model**: Generalplus Technology Inc. `GENERAL WEBCAM` (USB / UVC Webcam)
  * USB Vendor ID: `1b3f`
  * USB Product ID: `2247`
  * Bus Driver: `uvcvideo` with `quirks=0x80` (Bandwidth workaround for Generalplus chip)
  * Device Node: `/dev/video0` (Stream), `/dev/video1` (Metadata)
* **Client / Display Device**: Pico 4 VR Headset
  * Operating System: Pico OS (Chromium-based Browser)
  * Modes Verified: 2D HUD / WebXR Immersive VR Cinema Mode
* **Network Environment**: Local Area Network (Subnet `10.133.148.0/24`)
  * Raspberry Pi IP: `10.133.148.135`
  * Streaming Port: `8000` (Gunicorn WSGI)
  * HUD Web Server Port: `8080` (HTTP) / `8443` (HTTPS for WebXR)

---

## 2. ค่าตั้งต้น (Configuration — Sanitized, No Credentials)

### Configuration File: `/etc/cn360-camera.env`

```ini
HOST=0.0.0.0
PORT=8000
CAMERA_SOURCE=0
CAMERA_WIDTH=1920
CAMERA_HEIGHT=1080
CAMERA_FPS=15
STREAM_WIDTH=1280
STREAM_JPEG_QUALITY=80
CAPTURE_JPEG_QUALITY=95
CAMERA_RETRY_SECONDS=2
FRAME_STALE_SECONDS=3
INITIAL_FRAME_WAIT_SECONDS=2
CAPTURE_WAIT_SECONDS=2
CORS_ALLOWED_ORIGIN=*
LOG_LEVEL=INFO
# Push integration intentionally disabled during initial stream acceptance
N8N_WEBHOOK_URL=
PUSH_INTERVAL_SECONDS=0
```

### Systemd Service Unit: `/etc/systemd/system/cn360-camera.service`

```ini
[Unit]
Description=CN360 Raspberry Pi camera streaming
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=cn360
Group=cn360
SupplementaryGroups=video
WorkingDirectory=/opt/cn360/raspberry-pi-streaming
EnvironmentFile=/etc/cn360-camera.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/cn360/raspberry-pi-streaming/.venv/bin/gunicorn --config deploy/gunicorn.conf.py app:app
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

---

## 3. ผลการทดสอบ Service & API Verification

### 3.1 ตรวจสอบ `/health` (Fresh Frame & Readiness)

```bash
curl -i http://10.133.148.135:8000/health
```

**Response:**
```http
HTTP/1.1 200 OK
Server: gunicorn
Content-Type: application/json
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Access-Control-Allow-Origin: *

{
  "camera": {
    "frameAgeMs": 28,
    "frameSequence": 50037,
    "fresh": true,
    "healthy": true,
    "height": 480,
    "lastError": null,
    "sessionId": "16959b6606c94a84803103d29ed6e03a",
    "state": "running",
    "width": 640
  },
  "status": "ok"
}
```

* ผลตรวจรับ: **PASS** (Status 200, `healthy: true`, `fresh: true`, `frameAgeMs: 28 ms`)

---

### 3.2 ตรวจสอบ `/capture` (5 Frame Context Headers Contract)

```bash
curl -i http://10.133.148.135:8000/capture -o test.jpg
```

**Response:**
```http
HTTP/1.1 200 OK
Server: gunicorn
Content-Type: image/jpeg
Content-Length: 79956
Content-Disposition: inline; filename="capture-20261026T091116553Z.jpg"
X-Frame-Sequence: 49940
X-Camera-Session: 16959b6606c94a84803103d29ed6e03a
X-Captured-At: 2026-10-26T09:11:16.553Z
X-Frame-Width: 640
X-Frame-Height: 480
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Access-Control-Allow-Origin: *
```

* ผลตรวจรับ: **PASS** (คืนค่า JPEG พร้อม Header ครบทั้ง 5 ค่าตาม System Contract):
  1. `X-Camera-Session`: `16959b6606c94a84803103d29ed6e03a`
  2. `X-Frame-Sequence`: `49940`
  3. `X-Captured-At`: `2026-10-26T09:11:16.553Z`
  4. `X-Frame-Width`: `640`
  5. `X-Frame-Height`: `480`

---

### 3.3 ตรวจสอบ `/info` (Sanitized Runtime Discovery)

```bash
curl -s http://10.133.148.135:8000/info
```

**Response:**
```json
{
  "camera": {
    "actualHeight": 480,
    "actualWidth": 640,
    "captureJpegQuality": 95,
    "openTimeoutSeconds": 5.0,
    "readTimeoutSeconds": 5.0,
    "requestedFps": 15.0,
    "requestedHeight": 1080,
    "requestedWidth": 1920,
    "sessionId": "16959b6606c94a84803103d29ed6e03a",
    "source": 0,
    "streamJpegQuality": 80,
    "streamWidth": 1280
  },
  "endpoints": ["/stream.mjpg", "/capture", "/push", "/health", "/info"],
  "mjpegBoundary": "frame",
  "push": { "enabled": false },
  "service": "cn360-raspberry-pi-streaming",
  "version": "0.1.0"
}
```

---

## 4. ผลทดสอบบน Pico 4 (Display, Resolution, FPS, Latency)

* **Stream URL**: `http://10.133.148.135:8000/stream.mjpg`
* **Resolution**: `640 x 480` (Native hardware capture from Generalplus USB camera, scaled to HUD view)
* **FPS**: ~15 FPS (Stable video playback on Pico Browser)
* **Glass-to-glass Latency**: ~150 – 220 ms (วัดเทียบกับ Stopwatch ในเฟรมเดียวกัน)
* **เกณฑ์ที่ทีมยอมรับ**: Latency < 300 ms สำหรับงาน Live Visual Quality Inspection บน HUD

---

## 5. ผลทดสอบ Disconnect & Fault Recovery

| สถานการณ์ทดสอบ | พฤติกรรมที่สังเกตได้ | ผลลัพธ์ |
|---|---|:---:|
| **ถอดสาย USB กล้อง** | • Service ตรวจพบ `camera read failed`<br>• `/health` เปลี่ยนเป็น `503 Unavailable` ทันที<br>• Pico HUD ซ่อนภาพค้าง (`hideStaleVideo`) และขึ้น `Camera: unavailable` | **PASS** |
| **เสียบสาย USB กล้องกลับ** | • Producer ตรวจพบอุปกรณ์และ re-open `/dev/video0` ภายใน 2 วินาที<br>• `/health` กลับเป็น `200 OK`<br>• Pico HUD reconnect สตรีมสดใหม่อัตโนมัติโดยไม่ต้องรีเฟรชหน้า | **PASS** |
| **ตัดการเชื่อมต่อเครือข่าย (Wi-Fi drop)** | • การส่งเฟรมหยุดลง, HUD ตรวจพบการขาดหายของสัญญาณ<br>• เมื่อต่อ Wi-Fi คืน HUD ทำการ Auto-reconnect และแสดงผลต่อเนื่อง | **PASS** |
| **Reboot Raspberry Pi** | • Systemd unit `cn360-camera` start เองอัตโนมัติเมื่อระบบบูตเสร็จ (`Active: active (running)`)<br>• `sessionId` เปลี่ยนเป็น UUID ใหม่ (`X-Frame-Sequence` เริ่มต้นนับใหม่จาก 1)<br>• ไม่มีการส่งเฟรมค้างจาก session เก่า | **PASS** |

---

## 6. Service Runtime Log (Cleaned / No Credentials)

```text
-- Logs begin at Mon 2026-10-26 14:08:12 +07. --
systemd[1]: Started CN360 Raspberry Pi camera streaming.
gunicorn[842]: [2026-10-26 14:08:15 +0700] [842] [INFO] Starting gunicorn 23.0.0
gunicorn[842]: [2026-10-26 14:08:15 +0700] [842] [INFO] Listening at: http://0.0.0.0:8000 (842)
gunicorn[842]: [2026-10-26 14:08:15 +0700] [842] [INFO] Using worker: sync
gunicorn[846]: [2026-10-26 14:08:15 +0700] [846] [INFO] Booting worker with pid: 846
gunicorn[846]: [2026-10-26 14:08:16 +0700] [846] [INFO] Camera producer started (session: 16959b6606c94a84803103d29ed6e03a)
gunicorn[846]: [2026-10-26 14:08:16 +0700] [846] [INFO] Camera opened on source: 0 (640x480 @ 15.0fps)
gunicorn[846]: [2026-10-26 14:18:00 +0700] [846] [INFO] 10.133.148.242 - - "GET / HTTP/1.1" 200 169
gunicorn[846]: [2026-10-26 14:18:09 +0700] [846] [INFO] 10.133.148.242 - - "GET /health HTTP/1.1" 200 199
gunicorn[846]: [2026-10-26 14:18:21 +0700] [846] [INFO] 10.133.148.242 - - "GET /capture HTTP/1.1" 200 68337
gunicorn[846]: [2026-10-26 14:18:25 +0700] [846] [INFO] 10.133.148.242 - - "GET /stream.mjpg HTTP/1.1" 200 -
```

---

## 7. คำแนะนำในการบันทึกวิดีโอผลการทดสอบ (Test Video Checklist)

สำหรับการแนบไฟล์วิดีโอประกอบการปิด Issue #22 โดยไม่ให้มีข้อมูล Credential หลุด:
1. **การบันทึกภาพหน้าจอ Pico 4**:
   * กดปุ่มบันทึกวิดีโอหน้าจอในแว่น Pico 4 (กดปุ่มสกรีนช็อต/วิดีโอบนคอนโทรลเลอร์ขวาค้างไว้ หรือเลือกจาก Control Center)
   * ถ่ายช่วงที่หน้าจอ HUD แสดงภาพสตรีมสดชัดเจน (`Camera: remote live`)
   * ถ่ายการเคลื่อนไหวผ่านหน้ากล้อง (เช่น โบกมือ หรือแสดงนาฬิกาจับเวลาเพื่อยืนยัน Latency)
   * ถ่ายช่วงที่มีการถอดสาย USB กล้อง (หน้าจอขึ้น `unavailable`) และเสียบสายกลับ (หน้าจอกลับมาสตรีมเอง)
2. **ข้อควรระวังเรื่อง Credentials**:
   * **ห้าม** ถ่ายติดรหัสผ่าน Wi-Fi หรือไฟล์ `.env` ที่มี secret token
   * หากมีหน้าต่าง Terminal ให้ตรวจสอบว่าไม่มี API keys หรือ SSH private keys ปรากฏอยู่บนหน้าจอ
