# 360 Live Demo

Demo ระบบสตรีมกล้อง 360 แบบ live → API ดึงมุมมอง (viewport) → แสดงผลบนแว่น VR (Pico 4)

โครงสร้าง:
```
360-live-demo/
├── server/          # Node.js/Express server จำลอง 360 live stream + API
│   ├── server.js
│   ├── panorama.js  # engine สร้างภาพจำลอง + คณิตศาสตร์ reprojection
│   └── decode.js
├── public/
│   └── index.html   # เว็บ viewer (Three.js) + WebXR สำหรับ Pico 4
└── scripts/
    └── push-real-camera.sh   # ตัวอย่างการต่อกล้อง 360 จริงเข้าระบบ
```

## แนวคิดของระบบ

1. **Server จำลอง 360 live stream** — สร้างภาพ equirectangular (2:1) ขึ้นมาใหม่ทุก ~200ms
   มีตาราง grid ทุก 30°, สีแบ่งโซน N/E/S/W ที่แนวขอบฟ้า, ดวงอาทิตย์ที่เคลื่อนที่ และดาว
   เพื่อให้เห็นชัดว่าภาพ "เปลี่ยนแปลงแบบ live" จริง ๆ
2. **REST API** ให้ client ขอภาพเฉพาะมุมที่ต้องการ (ไม่ต้องโหลดทั้ง 360 ทุกครั้ง) — เหมือนกับที่
   ระบบสตรีม 360 จริงทำ (viewport-adaptive streaming)
3. **เว็บ viewer** ใช้ Three.js render ภาพลงบนทรงกลม และรองรับ WebXR เพื่อเข้าโหมด VR บน Pico 4
4. **จุดต่อกล้องจริง** — endpoint เดียว (`POST /api/camera/push`) ที่ใช้แทนที่ภาพจำลองด้วยเฟรมจาก
   กล้อง 360 จริง โดยไม่ต้องแก้โค้ดส่วนอื่นเลย

## API Reference

| Endpoint | คำอธิบาย | Query params |
|---|---|---|
| `GET /api/status` | สถานะ server, กำลังใช้กล้องจริงหรือจำลอง | - |
| `GET /api/frame/full.png` | ภาพ equirectangular เต็ม 360° | `width`, `height` |
| `GET /api/frame/hemisphere.png` | ภาพ 180° (หรือ span อื่น) รอบทิศ `yaw` ที่กำหนด | `yaw`, `fov` (≤180), `width`, `height` |
| `GET /api/frame/viewport.png` | ภาพมุมมองปกติ (rectilinear) เหมือนกล้องธรรมดา มองไปยัง `yaw`,`pitch` | `yaw`, `pitch`, `fov` (≤150), `width`, `height` |
| `POST /api/camera/push` | ส่งเฟรมจากกล้องจริง (multipart, field name `frame`) | - |

ตัวอย่าง:
```
GET /api/frame/viewport.png?yaw=90&pitch=-10&fov=100&width=1280&height=720
```
→ คืนภาพ PNG มุมมองที่หันไปทางทิศ 90° (yaw) เงยลงเล็กน้อย (pitch -10°) FOV 100°

## เริ่มใช้งาน (ทดสอบบนคอมก่อน)

```bash
cd server
npm install
npm start
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000` — จะเห็น viewer 360 พร้อมแผงควบคุมด้านล่างซ้าย
สำหรับทดสอบยิง API ดึงภาพมุมต่าง ๆ (ปรับ yaw/pitch/fov แล้วกด "GET .../viewport.png")

## เชื่อมต่อกับ Pico 4

**ข้อกำหนดสำคัญ:** WebXR (การเข้าโหมด VR ผ่านเบราว์เซอร์) ต้องรันบน HTTPS หรือ `localhost` เท่านั้น
เพราะฉะนั้นเมื่อเปิดจาก Pico 4 ผ่าน IP ในวง LAN (`http://...`) ปุ่ม "Enter VR" อาจไม่ขึ้น
มี 2 ทางเลือก:

### ทางเลือก A — ngrok (ง่ายสุด สำหรับ demo)
```bash
# ติดตั้ง ngrok แล้วรัน (ในขณะที่ server ทำงานอยู่ที่ port 3000)
ngrok http 3000
```
จะได้ URL แบบ `https://xxxx.ngrok-free.app` — เปิด URL นี้ในเบราว์เซอร์ของ Pico 4 ได้เลย ปุ่ม VR จะใช้งานได้ทันที

### ทางเลือก B — เปิด insecure origin flag ใน Pico Browser
1. บน Pico 4 เปิดเบราว์เซอร์ ไปที่ `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. ใส่ `http://<ip เครื่องคอมของคุณ>:3000` ในช่อง แล้วเปิด flag เป็น Enabled
3. รีสตาร์ทเบราว์เซอร์ แล้วเข้า URL เดิม

### ขั้นตอนดูผล 360 บน Pico 4
1. ให้ Pico 4 กับคอมพิวเตอร์ต่อ Wi-Fi วงเดียวกัน
2. หา IP เครื่องคอม: `ipconfig` (Windows) หรือ `ifconfig` / `ip a` (Mac/Linux)
3. บน Pico 4 เปิดเบราว์เซอร์ ไปที่ `http://<ip เครื่องคอม>:3000` (หรือ URL จาก ngrok)
4. จะเห็นภาพ 360 บนจอแบน (flat) ก่อน — กดปุ่ม **ENTER VR** มุมขวาล่าง
5. สวมแว่น หันหัวมองรอบตัว — กล้องใน Three.js จะผูกกับการหมุนหัวจริงผ่าน WebXR
6. สลับโหมด 360°/180° ได้จากแผงควบคุม (จะซ่อนอัตโนมัติเมื่อเข้า VR)

## ต่อกล้อง 360 จริงเข้าระบบ

ระบบไม่ผูกกับกล้องจำลองแบบตายตัว — แค่ POST ภาพ equirectangular ไปที่ `/api/camera/push`
server จะสลับไปใช้เฟรมจริงทันที (และถ้าหยุดส่งเกิน 15 วินาทีจะกลับไปใช้ภาพจำลองอัตโนมัติ)

ตัวอย่างใช้ ffmpeg ดึงเฟรมจากกล้องแล้วส่งเข้าระบบทุก 1 วินาที:
```bash
./scripts/push-real-camera.sh rtsp://<ip กล้อง>:554/live http://localhost:3000
```

**หมายเหตุ:** กล้อง 360 ส่วนใหญ่ (Insta360, Ricoh Theta, Kandao ฯลฯ) ต้อง stitch ภาพจากหลายเลนส์
เป็น equirectangular ก่อน — ใช้ SDK/ซอฟต์แวร์ของกล้องนั้น ๆ หรือโหมด live stream แบบ
"equirectangular"/"360" ที่กล้องส่วนใหญ่มีให้ ผ่าน RTMP/RTSP แล้วให้ ffmpeg ดึงมาต่อได้เลย

## ใช้ฉาก 360 ที่มีอยู่แล้ว (แทนภาพจำลอง)

### หาไฟล์ภาพ 360 จากไหนได้บ้าง
ต้องเป็นภาพ **equirectangular อัตราส่วน 2:1** (เช่น 4096x2048, 8000x4000) เท่านั้น ไม่ใช่ภาพพาโนรามาแบบยาวธรรมดา
แหล่งที่หาได้ฟรีและถูกลิขสิทธิ์:

- **Wikimedia Commons** — [Category: 360° panoramas with equirectangular projection](https://commons.wikimedia.org/wiki/Category:360%C2%B0_panoramas_with_equirectangular_projection)
  ภาพจริงหลากหลายสถานที่ ระบุสัญญาอนุญาต (license) ชัดเจนในหน้าไฟล์แต่ละภาพ ให้เช็คก่อนใช้ทุกครั้ง
- **Poly Haven** (polyhaven.com/hdris) — HDRI/ภาพ 360 คุณภาพสูง สัญญาอนุญาตแบบ CC0 (ใช้ได้ฟรีไม่มีเงื่อนไข) เหมาะกับงานทดสอบ/โปรดักชัน
- **Pexels / Freepik** — มีหมวดภาพ "360 equirectangular panorama" ให้ค้นหา แต่ต้องเช็ค license ของแต่ละภาพว่าอนุญาตให้ใช้แบบไหน (บางภาพห้ามใช้เชิงพาณิชย์)
- ถ่ายเอง — กล้อง 360 ทั่วไป (Insta360, Ricoh Theta ฯลฯ) export ภาพ equirectangular ออกมาให้โดยตรงอยู่แล้วหลัง stitch

**ตรวจสอบก่อนโหลด:** เปิดไฟล์ภาพขึ้นมาดู ต้องเห็นเป็นภาพยาวแบน ๆ อัตราส่วนกว้าง:สูง = 2:1 พอดี (ถ้าเป็นสี่เหลี่ยมจัตุรัสหรืออัตราส่วนอื่น มักไม่ใช่ equirectangular)

### วิธีเอาเข้าโค้ด (ไม่ต้องแก้โค้ดเลย)
1. เปลี่ยนชื่อไฟล์ที่โหลดมาเป็น `panorama.jpg` (หรือ `panorama.png`)
2. วางไว้ที่ `server/assets/panorama.jpg`
3. รัน (หรือรีสตาร์ท) server ใหม่: `npm start`

จะเห็น log ยืนยันตอนสตาร์ท:
```
Loaded static scene: server/assets/panorama.jpg (4096x2048 -> 2048x1024)
```
จากจุดนี้ทุก endpoint (`full.png`, `hemisphere.png`, `viewport.png`) จะดึงจากภาพนี้แทนภาพจำลองทันที
และหน้าเว็บ viewer จะขึ้นสถานะ **"STATIC SCENE"** แทน "SIMULATED"

> หมายเหตุ: ถ้ามีการ push กล้องจริงเข้ามาทาง `/api/camera/push` ภาพจากกล้องจริงจะสำคัญกว่าเสมอ
> (ทับภาพ static ไว้ชั่วคราว แล้วกลับมาใช้ static ถ้ากล้องหยุดส่งเกิน 15 วินาที)

### วิธีเอาเข้าโค้ด (แบบไม่รีสตาร์ท server)
ถ้า server รันอยู่แล้วและไม่อยากรีสตาร์ท ใช้ endpoint ที่มีอยู่แล้วยิงภาพเข้าไปตรง ๆ ได้เลย:
```bash
curl -F "frame=@panorama.jpg;type=image/jpeg" http://localhost:3000/api/camera/push
```
วิธีนี้จะถูกนับเป็น "real camera push" เหมือนกัน (แสดงสถานะ REAL CAMERA) แต่จะหายไปถ้าไม่ push ซ้ำภายใน 15 วินาที ต่างจากวิธีวางไฟล์ใน `server/assets/` ที่จะอยู่ถาวรทุกครั้งที่ server เริ่มทำงานใหม่

## ขยายต่อ (แนวทางถัดไป)

- เปลี่ยนจาก polling (`setInterval` ดึงรูปใหม่) เป็น WebSocket/MSE เพื่อความ smooth แบบ video จริง
- เพิ่ม adaptive quality: ส่ง FOV แคบ = ความละเอียดสูงเฉพาะจุดที่มอง (เหมือน tiled streaming)
- เก็บ frame เป็น H.264 stream แทน PNG ต่อเฟรม เพื่อลด bandwidth
