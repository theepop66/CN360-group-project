# Implementation plan: iPhone ผ่าน USB สำหรับ Windows และ Raspberry Pi

สถานะ: ร่างสถาปัตยกรรมรวม; ทดสอบการเชื่อมต่อ iPhone 11 ผ่าน Lightning กับ Windows สำเร็จแล้ว ส่วน Raspberry Pi, รุ่นอื่น และงานปรับคุณภาพยังรอดำเนินการ

วันที่: 23 พฤศจิกายน 2026

## 1. เป้าหมายและขอบเขตที่ตกลง

- ใช้ iPhone เป็นกล้อง โดยต่อสายข้อมูลเข้า Windows หรือ Raspberry Pi ได้ เลือก host ครั้งละหนึ่งเครื่อง
- เริ่มจากหน้าเว็บส่งกล้องเดิม ผู้ใช้ยอมติดตั้งแอป iPhone เพิ่มเมื่อจำเป็น
- รักษา HUD และวิธีควบคุมจอยเดิม รวมการซูมกล้องที่ต้นทาง
- ออกแบบให้รองรับทั้ง iPhone ที่ใช้ Lightning และ USB-C ตามสายข้อมูลที่ตรงกับโทรศัพท์และพอร์ต host
- กำหนดการรองรับตาม iOS, browser/app และความสามารถจริงของอุปกรณ์ พร้อมเผยแพร่รายการที่ทดสอบผ่าน การรองรับทุก iPhone ตั้งแต่รุ่นแรกและคุณภาพเท่ากันทุกรุ่นยังรับประกันไม่ได้
- รุ่น Raspberry Pi และ OS ยังไม่ทราบ จึงต้องตรวจในขั้นแรกก่อนกำหนดประสิทธิภาพขั้นต่ำ
- เปลี่ยนช่วง iPhone → host เป็นสาย ส่วน host → PICO และเส้นทางควบคุม ESP32 ใช้ LAN เดิม การเดินสายทั้งระบบเป็นอีกขอบเขตหนึ่ง

## 2. สิ่งที่พบในโค้ดปัจจุบัน

| ส่วน | พฤติกรรมที่ตรวจพบ | ผลต่อแผน |
| --- | --- | --- |
| `pico-webapp/js/phone-camera-sender.js` | ขอภาพ 960×720, ย่อภาพลงภายใน 960×720, JPEG quality 0.75, รอ 125 ms หลัง upload/งานควบคุมแต่ละรอบ | สาย USB อย่างเดียวจะไม่ยกข้อจำกัดนี้ รอบส่งปัจจุบันต่ำกว่า 8 FPS เมื่อรวมงานอื่น |
| `pico-webapp/phone-webrtc.html` | ขอภาพ 1280×720 ผ่าน `getUserMedia` | ต้องตรวจขนาดจริงจาก track; ค่า ideal ไม่ใช่การรับประกัน |
| `pico-webapp/js/app.js` | VR composite canvas คงขนาด 1280×720 | ต้องทดสอบคุณภาพการแสดงผลด้วย และคงขนาด texture ภายใน XR session |
| `pico-webapp/tools/phone-camera.mjs` | จำกัด JPEG 512 KiB และพื้นที่ภาพ 1920×1080 pixels | ปรับเพดาน bytes อย่างมีขอบเขตหากภาพคุณภาพสูงเกินเพดานเดิม |
| paired JPEG path | มี session, frame identity, `/capture`, health และการยืนยันคำสั่งซูม | ใช้เป็นฐานสัญญาร่วมของกล้องทั้งสอง host |
| WebRTC path | ยังไม่ได้รวม capture ingestion และ remote zoom แบบ paired JPEG | การเปลี่ยนไปเส้นทางนี้ต้องเพิ่มส่วนที่ขาดก่อนถือว่าควบคุมได้ครบ |
| `raspberry-pi-streaming/` | เป็นบริการ OpenCV สำหรับกล้องที่ host เปิดอ่านได้อยู่แล้ว | การเสียบ iPhone ไม่ได้พิสูจน์ว่าเปิดผ่าน `VideoCapture(0)` ได้ ต้องมีวิธีรับภาพ iPhone ก่อน |

ตัวเลขเหล่านี้เป็นการตรวจ static code ไม่ใช่ผลวัดคุณภาพหรือความหน่วงบนอุปกรณ์จริง

## 3. สถาปัตยกรรมที่เสนอ

| อุปกรณ์ที่เสียบ iPhone | ทางเข้า | บริการที่รันบน host | ปลายทาง |
| --- | --- | --- | --- |
| Windows | USB transport ที่ผ่านการทดสอบ | Camera gateway และ HTTPS/proxy | PICO HUD และ n8n `/capture` |
| Raspberry Pi | USB transport ที่ผ่านการทดสอบ | Camera gateway เดียวกัน และ HTTPS/proxy | PICO HUD และ n8n `/capture` |

ใช้ Node camera gateway จากฐาน `pico-webapp/tools/phone-camera.mjs` ร่วมกันทั้งสองแพลตฟอร์ม แยกส่วนตรวจอุปกรณ์และเปิด USB ตาม OS รักษา Python camera service เดิมสำหรับแหล่งกล้องประเภทเดิม และกำหนด endpoint ของแหล่งที่เลือกอย่างชัดเจนก่อนเปิด inference

### ทางเลือก A: เว็บเดิมผ่านเครือข่าย USB — ทดลองก่อน

1. ใช้ USB tethering เพื่อสร้างเส้นทาง IP ระหว่าง iPhone และ host
2. เปิดหน้าเว็บส่งกล้องบน iPhone ให้ติดต่อ HTTPS ของ host ผ่านที่อยู่ฝั่ง USB
3. ส่งภาพและรับคำสั่งซูมด้วยสัญญาเดิม
4. Windows ตรวจ Apple Devices/driver/service; Raspberry Pi ตรวจ driver/interface, pairing และการรับ IP บน OS ที่ติดตั้งจริง
5. ตรวจ HTTPS certificate ให้ครอบคลุมที่อยู่ที่ใช้ และให้ PICO เข้าถึงผ่าน LAN ได้พร้อมกัน

USB tethering เป็นการสร้างเครือข่าย ไม่ได้เปิดกล้องให้เอง การมี interface ขึ้นยังไม่ถือว่าผ่าน ต้องพิสูจน์ Safari → host, การรับคำสั่งกลับ และปริมาณข้อมูลบน USB จริง Personal Hotspot อาจขึ้นกับผู้ให้บริการและแพ็กเกจ จึงไม่เป็นฐานรับประกันสำหรับทุกเครื่อง

เกณฑ์ผ่าน: ทั้ง Windows และ Pi รับภาพจากเว็บผ่าน USB ได้, จอยสั่งซูมแล้วกล้องยืนยันได้บนเครื่องที่รองรับ, ถอดสายแล้วเส้นทางนี้หยุด และไม่มีการสลับไปส่งผ่าน Wi-Fi โดยไม่แจ้ง

### ทางเลือก B: แอป iPhone และ USB bridge — เมื่อ A ไม่ครบความต้องการ

ประเมินแอปที่มีอยู่ก่อน โดยต้องมีการเชื่อมต่อทั้ง Windows/Linux ARM และช่องทางสั่งซูมจากระบบ หากหาไม่ได้ ให้ประเมินพัฒนาแอป iOS สำหรับกล้องโดยเฉพาะ

แบบที่เสนอสำหรับแอปของโครงการ:

- แอปใช้ AVFoundation จับภาพ ตรวจโหมดภาพและขอบเขตซูมที่รองรับ และรายงานค่าที่ใช้จริง
- host ใช้ usbmuxd/libusbmuxd และ port forwarding เพื่อเชื่อมต่อ service ที่แอปเปิดบน iPhone จากนั้นใช้ connection นี้ส่งภาพและคำสั่งสองทาง
- `iproxy` ปกติ forward จากพอร์ตบน host ไปหา service บน iPhone ไม่ทำให้ Safari เดิมเรียกเว็บบน host ผ่าน USB ได้เอง จึงต้องมีแอปที่ให้บริการฝั่ง iPhone สำหรับทางเลือกนี้
- เริ่มประเมิน JPEG frame พร้อม metadata เพื่อใช้ pipeline เดิม ลดการแปลงซ้ำบน Pi แล้วเลือก codec อื่นเมื่อผลวัดรองรับเหตุผล
- Windows ต้องตรวจ driver และวิธีแจกจ่าย bridge; Pi ต้องตรวจแพ็กเกจและ ARM architecture จริง
- ก่อน commit งานแอป ต้องยืนยันวิธี build/sign/install และ iOS ขั้นต่ำ หากสร้างเองต้องมีสภาพแวดล้อม Xcode/macOS หรือบริการ build ที่เหมาะสม
- แอปจับกล้องใน foreground; ประเมิน screen lock, interruption และการคืน session ให้ชัดเจน

ทางเลือกนี้ยังเป็นข้อเสนอทางวิศวกรรม ต้องมี prototype บน iPhone จริงทั้งสอง host ก่อนยืนยัน การติดตั้ง bridge บน host เพียงอย่างเดียวไม่ทำให้ได้ภาพกล้อง

## 4. การควบคุมและสัญญาข้อมูลที่ต้องรักษา

| Input/ส่วนเชื่อมต่อ | ข้อกำหนด |
| --- | --- |
| จอยขวา | ปรับเซอร์โวตาม mapping และเงื่อนไขเดิม |
| Grip | Sweep ตามเงื่อนไขเดิม |
| จอยซ้ายขึ้น/ลง/ปล่อย | เดินหน้า/ถอยหลัง/หยุดสายพานตามโหมดเดิม |
| X/Y | Manual/Auto ตามเงื่อนไขเดิม |
| A/B | Reject/Pass เฉพาะ item ที่มีสิทธิ์ตามเดิม |
| จอยซ้ายซ้าย/ขวา/กด | ปรับซูมกล้องต้นทาง/กลับค่ามุมมอง 1× โดย mapping ค่าจริงตามกล้อง |
| `/capture` | JPEG เฟรมใหม่จากแหล่งกล้องที่เลือก พร้อมห้า frame-identity headers เดิม |
| health/status | รายงานความสด, session และโหมดการเชื่อมต่อที่พิสูจน์ได้ แยกสถานะ USB attached ออกจาก receiving frames |
| คำสั่งซูม | ผูก command ID กับ camera session; รอ ack และเฟรมหลังเปลี่ยนซูมก่อนใช้ภาพ |

คง `X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height` และใช้ clock handshake สำหรับ timestamp จากโทรศัพท์ ไม่ตั้งเวลา arrival ให้เป็นเวลา capture

เมื่อเปลี่ยน host/กล้อง/การเชื่อมต่อ ให้เริ่ม camera session ใหม่ ล้างเฟรมและ detection เก่า รักษาการตรวจคำสั่ง actuator และ item identity เดิม แยก lifecycle กล้องจากคำสั่งมอเตอร์ โดยต้องไม่ทำให้คำสั่งหยุดสายพานเมื่อปล่อยจอยถูกหน่วงด้วยงานภาพ

การซูมจากกล้องต้นทางอาจมีการ crop/upscale และสูญเสียรายละเอียดตามระดับซูม ไม่รับประกันว่าเป็น optical zoom ทุกรุ่น หาก browser ไม่รองรับ ให้รายงานว่าไม่รองรับและประเมินแอป ไม่เปลี่ยนเป็นการขยายภาพบน HUD แบบเงียบ ๆ

## 5. คุณภาพและประสิทธิภาพ

- ทดลอง high profile ที่ 1920×1080, 10 FPS, JPEG quality 0.90 สำหรับ paired JPEG เป็นค่าตั้งต้นเพื่อวัด ไม่ใช่เกณฑ์รับประกัน
- ทดลอง balanced profile ที่ 1280×720 เมื่ออุปกรณ์จำกัด พร้อมแสดงค่าที่ทำได้จริง
- ถ้า 10 FPS ไม่พอกับการควบคุมที่ผู้ใช้ต้องการ ให้ประเมิน WebRTC/codec pipeline ที่มี zoom และ capture ครบ และทดสอบต้นทุน CPU/ความหน่วงบน Pi ก่อนเลือก
- ตรวจ source track, ขนาด JPEG, ภาพรับบน host และขนาด VR canvas แยกกัน
- กำหนดขนาด VR canvas ก่อนเข้า XR; เปลี่ยน profile ระหว่างเซสชันด้วยการออกแล้วเข้าใหม่หรือสร้าง resource ใหม่อย่างถูกต้อง
- ใช้เฟรมล่าสุดและจำกัดงานค้าง/จำนวน bytes เพื่อไม่สะสมภาพย้อนหลัง ให้คำสั่งควบคุมไม่ต้องรอคิวภาพ
- ส่ง JPEG ที่รับได้ต่อโดยหลีกเลี่ยง decode/encode ซ้ำเมื่อไม่จำเป็น ตรวจเพดานหน่วยความจำทั้ง uploader, gateway และ viewers
- รักษาสัดส่วนภาพ/crop ให้ตรงกับ inference และกรอบตรวจจับ ทดสอบหลังซูมและเปลี่ยน profile

## 6. ลำดับ implementation และจุดตัดสินใจ

| ระยะ | งาน | หลักฐานก่อนผ่าน |
| --- | --- | --- |
| 0. ตรวจอุปกรณ์/เก็บ baseline | ระบุ iPhone/iOS/หน้าส่งกล้อง, Windows, Pi/OS/architecture, สายและพอร์ต; เปรียบเทียบวัตถุ/แสง/ระยะเดียวกัน | ภาพต้นทาง/host/HUD และตัวเลข resolution, FPS, latency |
| 1. USB feasibility | ทดลอง A บน Windows และ Pi; ตรวจ USB data และคำสั่งซูม | ข้อสรุปต่อ host ว่าทำได้หรือมีข้อจำกัดอะไร |
| 2. เลือก transport | ใช้ A เมื่อผ่าน; ทดลอง B เฉพาะช่องว่างที่จำเป็น | รับภาพและยืนยัน zoom command บน host ทั้งสองก่อนขยายระบบ |
| 3. รวม gateway | แยก adapter จาก frame/zoom session; รักษา capture และ health; เลือกแหล่งกล้อง | contract tests และ reconnect/session tests ผ่าน |
| 4. ปรับภาพ/HUD | เพิ่ม profile, bytes limit, status และ VR canvas; ทดสอบจอยร่วมกับภาพ | ภาพเทียบชัดขึ้นและกรอบตรง ไม่มี regression การควบคุม |
| 5. จัด setup | Windows launcher, Pi shell/service, certificate/interface checks และคู่มือ | เปิดระบบใหม่ได้จากขั้นตอนที่บันทึก |
| 6. รับรองบนอุปกรณ์ | test matrix, ถอดสาย/เสียบใหม่, ภาพหยุด/โทรศัพท์พัก, ทดสอบต่อเนื่อง | รายงานรุ่นที่ผ่านและข้อจำกัดอย่างชัดเจน |

ตรวจ Pi ในระยะ 0 ด้วยคำสั่งอ่านข้อมูล:

```bash
cat /proc/device-tree/model
cat /etc/os-release
uname -m
node --version
```

ยังไม่เลือกแพ็กเกจ driver, Node version หรือ service settings แบบตายตัวจนทราบผลตรวจ Pi

## 7. แผนไฟล์ที่จะกระทบ

| ไฟล์/พื้นที่ | งานที่คาดไว้หลัง feasibility |
| --- | --- |
| `pico-webapp/js/phone-camera-sender.js` | quality profile, capability checks, FPS/ขนาดจริง และงานส่งภาพที่ไม่สะสมคิว |
| `pico-webapp/js/camera-zoom.js` | ตรวจ/ยืนยันความสามารถจริงและค่าซูม |
| `pico-webapp/tools/phone-camera.mjs` และ adapter ใหม่ตามจำเป็น | frame/zoom contract ร่วม, configurable bounded limits และสถานะ transport |
| `pico-webapp/tools/hud-server.mjs` | รวม gateway, source selection และ proxy ผ่าน HTTPS |
| `pico-webapp/js/app.js`, `camera-config.js`, `phone-camera-controls.js` | เลือกกล้อง managed source บนทั้ง host, status, VR quality และการซูม |
| `pico-webapp/tools/start-pico-vr.mjs` และสคริปต์ใหม่สำหรับ Pi | preflight, USB interface/bridge และ startup |
| `pico-webapp/tests/` | frame freshness/identity, oversize handling, zoom ack, reconnect และ control regression |
| `docs/PICO_SETUP.md`, `pico-webapp/README.md`, `raspberry-pi-streaming/README.md`, root README | คู่มือ Windows/Pi, แหล่ง capture ที่เลือก และ compatibility matrix |
| แอป iOS/USB bridge ถ้าจำเป็น | เปิดพื้นที่ใหม่หลังเลือก B และยืนยัน build/distribution plan |

ไม่จำเป็นต้องแก้ firmware ESP32 เพื่อเปลี่ยนเส้นทางภาพ ตรวจ regression ด้วยโค้ดและเงื่อนไข actuator ปัจจุบัน

## 8. Acceptance criteria

1. มีผลทดสอบส่งภาพผ่าน USB จริงทั้ง Windows และ Raspberry Pi อย่างน้อยแพลตฟอร์มละหนึ่งชุด โดยระบุรุ่น/OS/สายและวิธีตรวจเส้นทาง
2. มีผลทดสอบ iPhone อย่างน้อยหนึ่งรุ่น Lightning และหนึ่งรุ่น USB-C ก่อนประกาศว่ารองรับทั้งสองกลุ่ม รุ่นอื่นมีสถานะ untested จนทดสอบผ่าน
3. ภาพวัตถุเดียวกันอ่านรายละเอียดได้ดีขึ้นใน HUD เมื่อเทียบ baseline พร้อมบันทึก profile จริง FPS และ latency ที่วัดได้ และตกลงเกณฑ์เชิงตัวเลขก่อนปิดงาน
4. คำสั่งจอยทั้งหมดในตารางเดิมทำงานครบ รวมกล้องต้นทางยืนยัน zoom/reset และคำสั่งหยุดสายพานเมื่อปล่อยจอย
5. ถอดสายแล้วภาพเก่าไม่แสดงเป็น live; ต่อใหม่ได้โดย session/sequence ไม่ชน และไม่ย้อนนำ detection เก่ากลับมา
6. `/capture` และกรอบตรวจจับใช้ geometry/session ที่ถูกต้องหลัง zoom/reconnect/profile change
7. ทดสอบต่อเนื่องอย่างน้อย 30 นาทีต่อ host พร้อมติดตาม FPS, latency, memory และอุณหภูมิ/อาการ throttling ที่สังเกตได้
8. ติดตั้งและเริ่มระบบจากคู่มือได้บน host ทั้งสอง พร้อมรายการ iOS/อุปกรณ์ที่รองรับและสิ่งที่ยังไม่ทดสอบ

## 9. แหล่งอ้างอิงและสิ่งที่ต้องพิสูจน์เพิ่ม

- [Apple: USB Personal Hotspot](https://support.apple.com/en-gb/guide/iphone/iph45447ca6/27/ios) — รองรับ USB บน Windows; เงื่อนไข Personal Hotspot ไม่ได้พิสูจน์การส่งกล้องจาก Safari ในระบบนี้
- [libusbmuxd README](https://cgit.libimobiledevice.org/libusbmuxd.git/tree/README.md) — Windows/Linux และบริการที่ต้องใช้
- [iproxy manual](https://github.com/libimobiledevice/libusbmuxd/blob/master/docs/iproxy.1) — ทิศทาง host port → service บน iPhone และ USB-only mode
- [Apple AVFoundation: videoZoomFactor](https://developer.apple.com/documentation/avfoundation/avcapturedevice/videozoomfactor) — ควบคุมซูมที่ต้นทางและข้อจำกัดคุณภาพเมื่อ upscale
- [Apple Xcode](https://developer.apple.com/xcode/) — เครื่องมือสำหรับทางเลือกพัฒนาแอป

มีผล prototype สำหรับ iPhone 11 + Lightning + Windows แล้วตามหัวข้อถัดไป แต่ยังไม่มี compatibility matrix หลายรุ่นหรือการยืนยัน performance ของ Raspberry Pi จึงยังไม่ล็อก transport และค่าคุณภาพสำหรับระบบรวม

## 10. ผลการทดลองรอบแรก: iPhone 11 + Windows

- ใช้หน้าเว็บส่งกล้องเดิมผ่าน USB Personal Hotspot; Windows พบ Apple Mobile Device Ethernet และ PC USB IP `172.20.10.3`
- รับ accepted JPEG จาก iPhone IP `172.20.10.1` ที่ปลายทาง USB; `/capture` คืน JPEG พร้อม frame identity ถูกต้อง ขนาดรอบทดลอง 540×720 แนวตั้ง
- ผู้ใช้ยืนยันว่าภาพบน HUD เปลี่ยนตามกล้อง ถอด Lightning แล้วภาพหยุด และเสียบกลับส่งภาพได้
- monitor ยืนยัน health เปลี่ยนจาก HTTP 200 เป็น 503 และกลับ 200 ด้วย camera session ใหม่หลังต่อกลับ
- เพิ่มตัวเปิด `START-IPHONE-USB.cmd`, หน้าทดสอบ USB และการจำพาธ PowerShell สำหรับ terminal ปกติที่ไม่มี `pwsh` ใน PATH
- ชุดทดสอบ HUD ผ่าน 127 tests; การทดสอบนี้ยังไม่ได้ยืนยันคุณภาพที่ดีขึ้น, PICO, actuator, Raspberry Pi หรือ iPhone รุ่นอื่น

ดู [หลักฐานการทดสอบ](../evidence/iphone11-windows-usb-2026-11-23.md) และ [คู่มือเปิดทดสอบบน Windows](../testing/iphone11-windows-usb.md)
