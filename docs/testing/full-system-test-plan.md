# แผนทดสอบระบบแบบครบวงจร (Full-System Test Plan)

**โปรเจกต์:** CN360 — Agile AI Quality Control HUD
**ร่างเมื่อ:** 2026-11-21 (Asia/Bangkok) ปรับปรุงล่าสุด 2026-11-23: ขอบเขตโหมดบนแว่น (D9), ENV-06, HUD-13, Safety lead ใน VR cinema และตัวเลขเทสต์อัตโนมัติ
**สถานะ:** ร่าง — **ยังไม่ได้รันการทดสอบใดๆ ตามแผนนี้** (ยกเว้นเทสต์อัตโนมัติ 3 ชุดที่รันเพื่อตรวจคำสั่ง ดูหัวข้อ 2.2)
**เกณฑ์ตัวเลขที่ระบุ "(ข้อเสนอ)"** ต้องได้รับอนุมัติจากเจ้าของโปรเจกต์ก่อนใช้ตัดสินจริง (หัวข้อ 1.3)

แผนนี้ต่อจาก [`static-image-inspection-test-plan.md`](./static-image-inspection-test-plan.md) ซึ่งทดสอบด้วยภาพนิ่งและซอฟต์แวร์ ไปเป็นการทดสอบ **ทั้งสายพานจริง**

```text
กล้อง (Pi หรือ UNO Q) ──GET /capture──▶ n8n ──POST /predict──▶ LocateAnything (PC + RTX 3060)
                                          ▲  │
IR sensor ─▶ ESP32 ──POST item-detected───┘  ├──POST /verdict──▶ ESP32 ─▶ servo reject / LED / buzzer
              ▲                               ├──POST /detections──▶ relay ──ws──▶ HUD overlay
              │                               ├──▶ Supabase (ตาราง + snapshot)
   HUD (Pico 4) ──/esp/mode /servo /conveyor  └──▶ ThingsBoard bridge
                  /verdict  (ผ่าน HUD server proxy)       ◀── HUD ส่ง prompt ไป /webhook/detection-prompt
```

---

## 0. สรุปสำหรับคนรีบ

1. **AI ของโปรเจกต์รันบน PC (RTX 3060 Laptop) ไม่ใช่บน Raspberry Pi** — Pi ทำหน้าที่กล้อง/สตรีม/capture อย่างเดียว ดังนั้นคำถามเรื่องเปลี่ยน Pi เป็น Arduino UNO Q คือคำถามเรื่อง *camera node* ไม่ใช่เรื่องที่ไหนรันโมเดล (รายละเอียดหัวข้อ 3 และภาคผนวก A)
2. **สถานะล่าสุดใน repo (2026-11-03):** เส้นทางซอฟต์แวร์บนภาพนิ่งทำงานครบ แต่ **คุณภาพโมเดลไม่ผ่าน, เวลา production ไม่ผ่าน, และฟิสิคัลยังไม่ได้ยืนยัน** ระบบจึงยังเปิด automatic admission ไม่ได้ (firmware ปิดเป็นค่าเริ่มต้น) แผนนี้จึงแยกทดสอบ "โซ่ฮาร์ดแวร์" ออกจาก "คุณภาพ AI" เพื่อไม่ให้ความล้มเหลวของ AI บังปัญหาของฮาร์ดแวร์ (Phase 4a ใช้ model stub)
3. **ต้องแก้/ตัดสินใจก่อนเริ่มรอบหลัก 3 เรื่อง** (หัวข้อ 2.3): เครือข่าย (ESP32 hard-code `172.20.10.5/28`), `N8N_NOTIFY_URL` ต้องเป็น IP, และไฟล์ private key ที่ยังไม่ถูก ignore (การแก้ `conveyorLeaseMs` ที่ค้างอยู่ ถูก commit แล้วเมื่อ 2026-11-23 เหลือยืนยันพฤติกรรมใน CTL-06/CTL-07)
4. **เวลารอ boot/setup ส่วนใหญ่อยู่ที่ PC** (โมเดลเริ่ม+warm-up ราว 26–65 วินาทีต่อรอบ ตามหลักฐาน) ไม่ใช่ที่ Pi — การเปลี่ยนเป็น UNO Q จึงไม่ลดเวลารอรวม (หัวข้อ 5)
5. ลำดับการทดสอบ: Phase 0–2 (เตรียม/regression/ทีละระบบย่อย) → Phase 3 (ยืนยันว่าสายพานหยุดชิ้นงานและ reject ทัน) → Phase 4 (ครบวงจร) → Phase 5–6 (จำลองความล้มเหลว/วัดเวลา) → Phase 7 (คุณภาพบนชิ้นงานจริง) → Phase 8–9 (soak/ความปลอดภัย)
6. ประมาณการแรงงาน (ของผู้เขียนแผน ไม่ใช่ข้อมูลจากหลักฐาน): ราว 8–9 วันทำงานสำหรับ 2–3 คน โดย Phase 7 (เก็บภาพ ติดป้าย ประเมิน) ใช้นานที่สุด
7. **ฮาร์ดแวร์ที่ไม่ใช้แล้ว (ผู้ใช้แจ้ง 2026-11-21):** buzzer, เซนเซอร์ IR และ relay (ผู้ใช้ระบุว่าไม่ต้องแก้ firmware) ข้อทดสอบที่ต้องมี IR ถูกพักไว้ (BLOCKED) และต้องตัดสิน D8 ก่อนว่าจะนิยามคำว่า "สมบูรณ์" อย่างไร (หัวข้อ 2.4) มีร่างระดับ M (คุมด้วยมือ + AI แสดงผล) ใน Phase M รอเจ้าของโปรเจกต์อนุมัติ ตัวเลขประมาณการแรงงานในข้อ 6 ยังไม่ได้ปรับตามนี้ HUD มีปุ่มถ่ายรูปแล้ว (Y ซ้ายใน VR cinema และปุ่ม Capture & inspect บนจอ 2D) และแสดง `AI unavailable` เมื่อ AI ล้มเหลวตั้งแต่ 2026-11-22 (ข้อ HUD-08…12)
8. **โหมดของ HUD บนแว่น (2026-11-23):** แผนนี้ทดสอบ **2D HUD** และ **VR cinema** เท่านั้น **AR passthrough ไม่อยู่ในขอบเขต** (D9): โค้ดบังคับ WebXR `dom-overlay` ซึ่งเบราว์เซอร์แว่นส่วนใหญ่ไม่มี (ทำซ้ำใน emulator ได้ ยังไม่ได้ลองบน Pico และไม่มีหลักฐานใน repo ว่าเคยรันบนแว่น) และกลุ่มกำลังหารือจะตัดโหมดนี้ ผลตามมา: VR cinema เป็นทางเดียวที่ใช้คอนโทรลเลอร์ ต้องมีอินเทอร์เน็ตให้แว่นโหลด A-Frame (ENV-06, HUD-13) และคนใส่แว่นมองไม่เห็นของจริง จึงต้องมี Safety lead (หัวข้อ 4.6)

---

## 1. ขอบเขตและวิธีอ่านเอกสาร

### 1.1 ขอบเขต

**อยู่ในแผนนี้:** กล้อง/camera node, ESP32 + servo + สายพาน (เซนเซอร์ IR, buzzer, relay ไม่ใช้แล้ว ดู 2.4), model service, n8n, relay, HUD บน Pico 4, Supabase, ThingsBoard, เครือข่าย, ความปลอดภัยพื้นฐานของ bench

**ไม่อยู่ในแผนนี้:** เทรน/เปลี่ยนโมเดล, ย้ายตรรกะ firmware ไปที่ MCU ของ UNO Q, hardening ด้าน security ระดับ production (แต่มีข้อสังเกตใน SAF), การออกแบบกลไก, โหมด AR passthrough ของ HUD (ดู D9; แผนนี้ใช้ VR cinema เป็นโหมดเดียวบนแว่น)หยุด/คัดแยกใหม่

### 1.2 ป้ายสถานะ

| ป้าย | ความหมาย |
| --- | --- |
| PASS | ตรงเกณฑ์ และมีหลักฐานแนบ |
| FAIL | วัดแล้วไม่ตรงเกณฑ์ (เก็บหลักฐาน ไม่แก้เกณฑ์เพื่อให้ผ่าน) |
| BLOCKED | ทำไม่ได้เพราะ prerequisite ยังไม่ผ่าน (ระบุว่าอะไร) |
| DEFERRED | เจ้าของโปรเจกต์ตัดสินเลื่อน พร้อมเหตุผลที่บันทึกไว้ |
| UNVERIFIED | หลักฐานไม่ครบ — นับเป็น *ไม่ผ่าน* เสมอ (แนวเดียวกับ ticket 11) |

### 1.3 เกณฑ์ที่เป็น "(ข้อเสนอ)"

ตามหลักเดิมของโปรเจกต์ ([ticket 11](../../.scratch/locate-anything-n8n/issues/11-approved-software-acceptance-gates.md)) ผู้ทดสอบ **ไม่คิดเกณฑ์เองเพื่อให้ผ่าน** ตัวเลขที่ขึ้นว่า "(ข้อเสนอ)" ในเอกสารนี้เป็นข้อเสนอเริ่มต้น ให้เจ้าของโปรเจกต์ยืนยันหรือแก้ **ก่อนรันรอบที่นับผล** และบันทึกการอนุมัติในรายงาน

### 1.4 กฎที่ใช้ตลอดการทดสอบ (มาจากสัญญาเดิมของระบบ)

- ห้ามเพิ่ม timeout, เปลี่ยน Coverage Threshold หรือเปลี่ยน prompt เพื่อให้ผลผ่าน ถ้าจะเปลี่ยนต้องเป็นการตัดสินใจที่บันทึกไว้ (D1, D2 หัวข้อ 7.2) แล้วรันซ้ำ
- "controller รับคำสั่ง" ไม่ใช่หลักฐานว่าชิ้นงานถูกคัดแยกจริง — ต้องเห็นการเคลื่อนไหวจริง (วิดีโอ)
- ไม่แทนตัวอย่างที่ล้มเหลวด้วยการ retry ที่ไม่รายงาน นับทุกครั้งที่ลอง รวม timeout
- ไม่ลบเวลาตัวอย่างแรกหลัง restart ออกจากสถิติ แยกรายงาน "ครั้งแรกหลัง restart" กับ "warm"
- ไม่ลบค่าเวลาข้ามนาฬิกาต่างเครื่อง (PC/ESP32/Pi ไม่ได้ซิงก์กัน) ใช้ monotonic clock ภายในเครื่องเดียว หรือวัดจากวิดีโอเดียวกัน
- ใช้คำศัพท์ตาม [`CONTEXT.md`](../../CONTEXT.md): Inspection Target, Model Instruction, Defect Coverage, Coverage Threshold, Verdict, Verdict Window, Physical Item Identity, Frame Context

---

## 2. สถานะปัจจุบันและช่องว่างที่ต้องปิด

### 2.1 Baseline จากหลักฐานใน repo

| ส่วน | สถานะล่าสุด | แหล่ง |
| --- | --- | --- |
| เส้นทางซอฟต์แวร์บนภาพนิ่ง (CUDA model → n8n → controller core บน PC → Supabase/relay/HUD/ThingsBoard) | ผ่าน (cross-service consistency, failure fallback, monitoring recovery, input integrity) | [native-model-software-2026-11-03](../evidence/native-model-software-2026-11-03/README.md) |
| คุณภาพโมเดล (MVTec 15 คู่ภาพ/เป้าหมาย × 3 ครั้ง ย่อภาพสูงสุด 448 px) | **FAIL** — ชิ้นปกติ reject ผิด 21/21, พลาดชิ้นบกพร่อง 6/24 | เอกสารเดียวกัน |
| คุณภาพหลังปรับ (central crop, คำอธิบายใหม่, threshold ต่อเงื่อนไข) บน held-out | **ไม่มีเงื่อนไขใดผ่านเกณฑ์อนุมัติอัตโนมัติ** (reject ผิด 33/48, พลาด 12/48) | [fixed-model-improvements-2026-11-03](../evidence/fixed-model-improvements-2026-11-03/README.md) |
| นโยบาย runtime ปัจจุบัน | เงื่อนไขที่ไม่ qualified → `result: review` + physical `reject` (ไม่มี auto-pass) | เอกสารเดียวกัน |
| เวลา production (deadline โมเดล 1100 ms / n8n 1200 ms / Verdict Window 3000 ms) | **FAIL** — จาก 3 inspection จริง 2 ครั้ง timeout; CUDA คำขอแรก 1285 ms เกินงบ 1200 ms; p50 diagnostic ≈ 1.0–1.1 s, p95 ≈ 1.6 s | [native-model-software-2026-11-03](../evidence/native-model-software-2026-11-03/README.md), [model-service README](../../model-service/README.md) |
| Controller (ESP32 core) | ทดสอบ virtual-time ผ่าน; **ฟิสิคัลยังไม่ยืนยัน**; automatic admission ปิดเป็นค่าเริ่มต้น | [360ControlUnit README](../../360ControlUnit/README.md) |
| กล้อง Pi + USB UVC (#22) | PASS เมื่อ 2026-10-26: 640×480, ~15 FPS, glass-to-glass 150–220 ms (เกณฑ์ทีม < 300 ms), ถอด/เสียบกล้องกลับมาใน ~2 วินาที, reboot แล้ว service ขึ้นเอง | [pi-camera-pico-streaming-2026-10-26](../evidence/pi-camera-pico-streaming-2026-10-26.md) |
| iPhone เป็นกล้อง | มี receiver + unit tests; การตรวจบนอุปกรณ์จริงยัง pending | [phone-camera-source-zoom-2026-10-29](../evidence/phone-camera-source-zoom-2026-10-29.md) |
| HUD คุมสายพาน/servo ด้วย Pico | ทีมแจ้งว่าเชื่อมต่อได้แล้ว; unit tests ผ่าน (ดู 2.2); **ยังไม่มีไฟล์หลักฐานบนอุปกรณ์จริงใน `docs/evidence/`** | `pico-webapp/README.md`, commits `ec50ccb`…`c6078de` |
| สายพาน stepper (28BYJ-48 + ULN2003) | มีโค้ดและ HUD control; ยังไม่มีหลักฐานการวัด (ความเร็ว, ระยะไหล) | `360ControlUnit/src/main.cpp` |

### 2.2 ผลรันเทสต์อัตโนมัติบนเครื่องนี้ วันที่ 2026-11-21

รันเพื่อยืนยันว่าคำสั่งในแผนใช้ได้ ไม่ใช่การทดสอบตามแผน (ไม่ใช้ฮาร์ดแวร์ ไม่เปลี่ยนไฟล์ใดๆ)

| ชุด | ผล | หมายเหตุ |
| --- | --- | --- |
| `npm test --prefix pico-webapp` | 100/100 ผ่าน (2026-11-21); 144/144 ผ่าน (2026-11-23 หลัง merge `main` ครั้งแรก); **155/155 ผ่าน** (รันซ้ำ 2026-11-24 บนสาขา `feat/hud-capture-button` หลัง merge `main` ครั้งที่สอง) | ตัวเลขเพิ่มจากเทสต์ใหม่ของ PR #40 (ปุ่มถ่ายรูป, ผลล้มเหลวบน HUD, พร็อกซี `/n8n/inspect-now`, ปุ่มคอนโทรลเลอร์) และของเพื่อนที่ merge จาก `main` (รอบล่าสุดเพิ่ม 11 อัน จาก PR กล้อง iPhone USB) จะเปลี่ยนอีกถ้าตัดโหมด AR (แก้ `tests/xr-modes.test.js`) |
| `npm test --prefix n8n` | 253/254 ผ่าน | ข้อที่ล้ม: "the committed workflow files match a fresh build" สาเหตุคือไฟล์ `n8n/workflows/*.json` ใน repo เป็น CRLF (`core.autocrlf=true`) แต่ `build` สร้าง LF — **ตรวจแล้วว่าเนื้อหาเหมือนกันทุกไฟล์หลังแปลง CRLF→LF** จึงไม่ใช่ logic regression แนะนำเพิ่ม `.gitattributes` (`n8n/workflows/*.json text eol=lf`) แล้ว build/commit ใหม่ |
| `npm test --prefix detection-relay` | 23 ผ่าน, 1 ล้ม | ไฟล์ที่ล้ม: `test/hud-proxy.test.mjs` รันแล้วไม่จบ — รอบแรกค้างราว 109 วินาที รอบที่สองค้างจนถูกตัดที่ 280 วินาที (subtest ที่เสร็จแล้วผ่าน 1 ข้อ) ยังไม่ได้สืบสาเหตุ |
| ยังไม่ได้รัน | thingsboard, pytest (camera/model), firmware host tests, controller probe, static-inspection, supabase, accept.mjs | ต้องใช้ Docker/Python env/คอมไพเลอร์/credential |

### 2.3 สิ่งที่ต้องแก้หรือตัดสินใจก่อนเริ่มรอบหลัก

| # | เรื่อง | รายละเอียด | ทางแก้/ผู้ตัดสิน |
| --- | --- | --- | --- |
| P1 | **เครือข่ายไม่ตรงกัน** | ESP32 ถูก hard-code เป็น `172.20.10.5`, gateway `172.20.10.1`, subnet `255.255.255.240` (/28 = วง iPhone Personal Hotspot) ใน `src/main.cpp:36-39` ส่วนหลักฐาน Pi ถูกบันทึกบนวง `10.133.148.0/24` | เลือกวงเดียวสำหรับทุกอุปกรณ์ (ENV-02) ถ้าไม่ใช้ hotspot ต้องแก้ค่าใน firmware แล้ว flash และตั้ง `--control-unit http://<ESP32-IP>` ให้ HUD server (กับ `--n8n-origin http://<n8n-host>:5678` ถ้า n8n ไม่ได้อยู่บน PC เครื่องเดียวกับ HUD server) |
| P2 | **`N8N_NOTIFY_URL` เป็นชื่อ `.local`** | `src/secrets.example.h` ใช้ `http://n8n.local:5678/...` ซึ่ง resolve ไม่ได้ (ESP32 ตั้ง DNS เป็น `8.8.8.8` และไม่มี mDNS) — [n8n README](../../n8n/README.md) ระบุปัญหานี้แล้ว | ใช้ IP ของ PC ใน `secrets.h` (ไฟล์นี้ถูก ignore) และจอง IP ให้ PC |
| P3 | **แก้ firmware ที่เคยค้างไม่ commit** (commit แล้ว 2026-11-23 บนสาขา `feat/hud-capture-button`) | `conveyorLeaseMs` 400 → 2000 ms ใน `main.cpp` และ `platformio.ini` (เพิ่ม `default_envs`, บล็อก `hwtest` ที่ถูก comment) ค่านี้เป็นอายุของ lease token ระหว่างคำสั่ง (ไม่ต่ออายุเกินนี้ lease ถูกเพิกถอน) ส่วนการหยุดสายพานเมื่อไม่มีคำสั่งใหม่ถูกคุมแยกที่ 500 ms ใน `ControlUnitState.cpp:266` จึงไม่ขึ้นกับค่านี้ README ของ `360ControlUnit` และสคริปต์ `conveyor-bench.mjs` แก้ให้ตรงแล้ว | ยืนยันบนชุดจริงก่อน freeze baseline (ENV-01): CTL-06 (หยุดภายใน ~0.5 วินาทีหลังคำสั่งสุดท้าย) และ CTL-07 ข้อ (b) (lease ที่ไม่ต่ออายุเกิน 2 วินาทีถูกปฏิเสธ) |
| P4 | **ไฟล์ private key ยังไม่ถูก ignore** | `dev-key.pem` (root) และ `pico-webapp/dev-key.pem` ขึ้นเป็น untracked และไม่ถูก ignore (ขึ้นต้น `BEGIN PRIVATE KEY`) | เพิ่มใน `.gitignore` และห้าม `git add .` (ENV-03) |
| P5 | **Automatic admission ปิดอยู่** | ต้อง build ด้วย `-D CN360_BENCH_ADMISSION_ENABLED=1` จึงจะรับชิ้นงานอัตโนมัติ ซึ่งเอกสารกำหนดให้ใช้ได้เฉพาะ bench ที่ยืนยันแล้วว่าชิ้นงานถูกกัก/ถูก reject ทัน | ใช้เฉพาะใน Phase 3–6 แบบมีคนคุมและมีปุ่มตัดไฟ (หัวข้อ Phase 3) |
| P6 | **งบเวลาโมเดลเกินงบ** | ดู 2.1 | เป็นการตัดสินใจ D1 (หัวข้อ 7.2) ข้อมูลจาก Phase 3 และ Phase 6 ใช้ประกอบ |

### 2.4 ฮาร์ดแวร์ที่ไม่ใช้แล้ว (ผู้ใช้แจ้งเมื่อ 2026-11-21)

ผู้ใช้แจ้งว่าไม่ได้ใช้ buzzer, "ir transmitter" และ relay แล้ว และ **ไม่ต้องแก้ firmware ESP32** — firmware ยังมีโค้ดส่วนนี้ตามเดิมและแผนนี้ไม่แตะ ผู้ใช้ยืนยันแล้ว (2026-11-21) ว่า "ir transmitter" หมายถึงเซนเซอร์ IR ตรวจชิ้นงานทั้งตัว (IR photoelectric แบบ NPN ที่ GPIO4 ตาม BOM ใน `controlunit_schematic/schematicbuildguide.md`) ในที่นี้ "relay" คือรีเลย์ที่ GPIO19 ไม่ใช่บริการ `detection-relay`

| อุปกรณ์ | ผลต่อ firmware (ตรวจจากโค้ด) | ผลต่อแผน |
| --- | --- | --- |
| Buzzer (GPIO21) | firmware ยังสั่งเปิด/ปิดตามเหตุการณ์ (`BuzzerOn/BuzzerOff`) แต่ไม่มีเสียงออก | ตัดเกณฑ์ที่ต้องได้ยินเสียงออกจาก CTL-11, CTL-12 และ E2E-A2 (ยังตรวจ LED) |
| Relay (GPIO19) | ใช้เฉพาะเมื่อคอมไพล์ด้วย `ACTUATOR_RELAY` เป็นตัวเลือก reject actuator (README ของ 360ControlUnit) | ไม่มีข้อทดสอบที่ต้องใช้ ตัดออกจากรายการ pin ที่ต้องตรวจ |
| เซนเซอร์ IR (GPIO4) | GPIO4 เป็น `INPUT_PULLUP` ถ้าไม่ต่อเซนเซอร์จะอ่านเป็น "ไม่มีชิ้นงาน" ตลอด จึงไม่มีทาง admit ชิ้นงานในโหมด Auto และ `item_present` เป็น false ตลอด ส่วนโหมด Manual (คุมสายพานและ servo จาก HUD) ไม่ขึ้นกับ IR | ข้อที่ต้องมีชิ้นงานถูก admit ทำไม่ได้ (รายการด้านล่าง) และเกณฑ์ระดับ A ใช้ไม่ได้จนกว่าจะตัดสิน D8 |

**พักไว้ (BLOCKED เหตุผล "ไม่มีเซนเซอร์ IR"):** CTL-04; ส่วน `admission_ready` ของ CTL-11; Phase 3 ทั้งหมด (HOLD-01…07); Phase 4 ทั้งหมด (E2E-A1…A10, E2E-B1…B2); FLT-01…06, FLT-11, FLT-12; PERF-01 และ PERF-05; SOAK-02

**ยังทำได้ตามเดิม:** Phase 0–1, CAM, CTL-01…03 (ตรวจเฉพาะ pin ที่ยังใช้), CTL-05…10 (โหมด Manual, servo, สายพานด้วย lease, สัญญา `/verdict` ที่ต้องปฏิเสธเมื่อไม่มี item), ส่วนที่เหลือของ CTL-11 และ CTL-12 (ไม่มี buzzer), MOD, N8N, HUD, DAT, FLT-07…10 และ FLT-13…14 เท่าที่ไม่ต้องพึ่งการ admit (ให้บันทึกว่าส่วนไหนไม่ได้ตรวจ), PERF-02…04 (วัดจาก n8n execution), Phase 7 (วางชิ้นงานเองแล้วเก็บภาพผ่าน `/capture`), SOAK-01, SOAK-03, SAF

ผลที่ตามมา: โซ่อัตโนมัติ "ชิ้นงานตัด IR → n8n → โมเดล → servo" ทดสอบไม่ได้ ถ้าจะใช้งานจริงตอนนี้ ทางที่เหลือคือระบบคุมด้วยมือ (HUD สั่งสายพานและ servo โมเดลแสดงกล่องให้คนตัดสิน) ซึ่งตรงกับ D2-ก (ร่างเป็นระดับ M ใน Phase M) — ต้องให้เจ้าของโปรเจกต์ยืนยันที่ D8 ข้อควรระวัง: ปุ่ม A/B (pass/reject) บน HUD ส่ง `/verdict` และ HUD ไม่ส่งถ้าไม่มี item ในสถานะ `awaiting_verdict` (`pico-webapp/js/servo.js`) จึงใช้ไม่ได้เมื่อไม่มี IR — การคัดแยกด้วยมือต้องใช้ก้านควบคุม servo และสายพานแทน (CTL-05/06) ทริกเกอร์ที่ไม่ต้องใช้ IR มีสองแบบ: webhook `inspect-now` และ schedule trigger ผลของทั้งสองแบบเป็น "unpaired" คือ n8n ประเมินภาพโดยไม่สั่งการทางกายภาพ (`n8n/README.md` หัวข้อ Item identity and repeat frames) ตั้งแต่ 2026-11-22 HUD เรียก `inspect-now` ได้เองแล้ว: ปุ่ม **Y ซ้าย** ใน VR cinema (แทนปุ่ม Auto เดิม) และปุ่ม **Capture & inspect** บนจอ 2D ผ่าน `POST /n8n/inspect-now` ของ HUD server (`--n8n-origin`) ส่วน Auto ใช้ได้จากจอ 2D เท่านั้น (ข้อ HUD-08…12)

---

## 3. Camera node: Raspberry Pi หรือ Arduino UNO Q

สรุปสั้น (ข้อมูลและวิธีทดสอบเต็มอยู่ในภาคผนวก A):

| คำถาม | คำตอบ |
| --- | --- |
| UNO Q รัน LocateAnything แทน PC ได้ไหม | **ไม่ได้** ไฟล์โมเดล q8 ราว 6.26 GB เทียบกับ RAM ของ UNO Q 2 หรือ 4 GB (รวมกับระบบปฏิบัติการ) และบน CPU ของ PC (i5-11400H) ยังใช้ ~23 วินาทีต่อภาพ ส่วนบน GPU RTX 3060 ใช้ ~1.1 วินาที UNO Q ไม่มี CUDA |
| UNO Q รัน AI แบบอื่นได้ไหม | ได้เฉพาะโมเดลเล็กที่ฝึกคลาสตายตัว (เช่น ผ่าน App Lab/Edge Impulse) ซึ่ง **เสียความสามารถหลักของโปรเจกต์** คือเปลี่ยน Inspection Target ด้วยข้อความโดยไม่ต้องเทรน — repo บันทึกแนวทางนี้เป็นข้อเสนอแยกแล้ว ([ticket 06](../../.scratch/locate-anything-n8n/issues/06-runtime-evidence-and-handoff.md)) ไม่ควรทำก่อนเส้นทางหลักผ่าน |
| UNO Q แทน Pi ในหน้าที่กล้องได้ไหม | **น่าจะได้** — บริการกล้องเป็น Python (Flask + OpenCV) และ UNO Q รัน Debian บน Cortex-A53 สี่คอร์ 2.0 GHz รองรับกล้อง USB ผ่าน USB-C dongle ที่จ่ายไฟได้ แต่ต้องผ่านชุด UNOQ-xx ก่อนใช้จริง |
| ช่วยลดเวลา boot/setup ไหม | **ไม่ช่วย** รีวิวหนึ่งรายงาน boot ราว 34.6 วินาที (ยังตรวจต้นฉบับเองไม่ได้) และเวลารอที่นานที่สุดอยู่ที่ PC (หัวข้อ 5) |
| คำแนะนำ | ทำ full-system test กับ Pi ที่ผ่าน #22 แล้วก่อน ถ้าอยากใช้ UNO Q ให้ qualify ขนานกันด้วยเกณฑ์ CAM-xx ชุดเดียวกัน และ **ไม่เปลี่ยน camera node กลางรอบทดสอบหลัก** — **ตัดสินแล้ว (2026-11-21): ใช้ Pi** (D3) วิธีตั้งเครื่องใหม่ดู [pi-camera-node-setup.md](pi-camera-node-setup.md) |

---

## 4. การเตรียมการ (Preparation)

### 4.1 ฮาร์ดแวร์

| รายการ | สเปก / ข้อควรระวัง | ตรวจก่อนเริ่ม |
| --- | --- | --- |
| PC (โมเดล + n8n + relay + HUD server) | GPU RTX 3060 Laptop 6 GiB; โมเดล q8 ใช้ VRAM สูงสุด ~5033 MiB ที่วัดได้ ปิดโปรแกรมที่ใช้ GPU อื่น (เบราว์เซอร์ hardware acceleration ฯลฯ) เสียบ adapter ตั้ง power plan เป็น High performance | `nvidia-smi` ว่าง; บันทึกอุณหภูมิ idle |
| Camera node | Pi + กล้อง USB UVC + แหล่งจ่ายไฟที่กระแสพอ (D3 ตัดสินแล้ว; ขั้นตอนตั้งเครื่อง: [pi-camera-node-setup.md](pi-camera-node-setup.md)) | `/health` = 200 |
| ESP32 DevKit V1 | pin map ที่ยังใช้: servo=18, LED แดง=22, LED เขียว=23, สายพาน IN1–IN4=32/33/25/26 (ไม่ใช้แล้ว: IR=GPIO4, relay=19, buzzer=21 — ดู 2.4) | Serial 115200 ขึ้น `Control unit ready. IP: …` |
| สายพาน | 28BYJ-48 + ULN2003, ไฟ 5 V กระแสพอ (BOM ระบุ ≥ 2 A), GND ร่วมกับ ESP32 | ทดสอบ Manual ก่อน (CTL-06) |
| Reject arm | servo ติดแขนคัดแยก มุม rest 0° / reject 90° (ค่าใน `Config`) | ไม่ชนโครงสร้างตลอดช่วง 0–90° |
| Pico 4 + controller | เบราว์เซอร์รองรับ WebXR; ติดตั้ง/trust ใบรับรองสำหรับ HTTPS (`npm run serve:vr`); แว่นเข้าอินเทอร์เน็ตได้ เพราะ VR cinema โหลด A-Frame 1.5.0 จาก `cdn.jsdelivr.net` ตอนเข้าครั้งแรก (ENV-06); ไม่ใช้โหมด AR passthrough (D9) | เปิด HUD ได้ทั้ง 2D และเข้า VR cinema ได้ |
| iPhone (ถ้าใช้เป็นกล้อง) | Safari ต้องมี `requestVideoFrameCallback` | ผ่านขั้นตอนใน `pico-webapp/README.md` |
| เครือข่าย | AP/router ที่ **ไม่เปิด client isolation** | ping ได้ทุกคู่ที่ระบุใน ENV-02 |
| กล่องแสง/ฉาก | แสงสม่ำเสมอ ไม่กะพริบ (ไฟบ้านไทย 50 Hz) | CAM-10, CAM-12 |

### 4.2 ซอฟต์แวร์บน PC

- Docker Desktop (n8n, ThingsBoard, PostgreSQL), Node 24+ (ThingsBoard ต้อง ≥ 24; เครื่องนี้ v24.16.0), Python 3.11+ พร้อม Pillow, PlatformIO (`pio`), CMake + คอมไพเลอร์ C++17 (Visual Studio Build Tools)
- ชุดโมเดล: `locate-anything.cpp` revision `77376ab332de918220f7a7e391542eefb5407c9f`, weights `locate-anything-q8_0.gguf`, CUDA Toolkit 12.6.3, ไดรเวอร์ 566.07 (ตามที่ [model-service README](../../model-service/README.md) บันทึก)
- Supabase: โปรเจกต์ที่ apply migration แล้ว + credential ฝั่ง backend เก็บใน n8n (ไม่ใส่ใน repo)
- ThingsBoard: สร้างบัญชี/dashboard/alarm ด้วยสคริปต์ใน `thingsboard/scripts/` (`start.ps1` หรือ `start-demo.ps1` ครั้งแรกใช้เวลาหลายนาที ตาม [README](../../thingsboard/README.md))
- HUD ใช้ **`pico-webapp/`** (มี `conveyor.js`, `xr-controller.js`) — `PICOmyAPP/` เป็นรุ่นที่ไม่มีไฟล์เหล่านี้ อย่าสลับระหว่างการทดสอบ

### 4.3 แผน IP (กรอกให้ครบก่อนเริ่ม)

| อุปกรณ์ | ที่อยู่ | หมายเหตุ |
| --- | --- | --- |
| ESP32 | `172.20.10.5` (ค่าใน firmware) | ถ้าเปลี่ยนวง ต้องแก้ `staticIp/gateway/subnet`, flash ใหม่ และใช้ `--control-unit` กับ HUD server |
| PC | ______ | ต้องคงที่ เพราะ ESP32 ฝัง IP นี้ใน `N8N_NOTIFY_URL` และ HUD อ้างอิงอยู่ |
| Camera node | ______ (ข้อเสนอ `172.20.10.6` ตาม [คู่มือ Pi](pi-camera-node-setup.md)) | port 8000 (`/stream.mjpg`, `/capture`, `/health`, `/info`) |
| Pico 4 | ______ | เปิด `http://<PC-IP>:8080` หรือ `https://<PC-IP>:8443` (ห้ามใช้ `localhost` บนแว่น) |

กฎ: ใช้ IP เสมอ ไม่ใช้ `*.local`; `0.0.0.0` เป็น bind address ไม่ใช่ปลายทาง; n8n ที่รันใน Docker เรียกบริการบน PC ผ่าน `host.docker.internal` (model `:8000`, relay `:8081`, ThingsBoard bridge `:8106`) แต่เรียก camera node และ ESP32 ผ่าน IP บน LAN

### 4.4 ชิ้นงานและข้อมูล

- **Phase 4a (ห้องแล็บของโซ่ฮาร์ดแวร์):** ใช้วัตถุอะไรก็ได้ที่ตัด IR beam ได้ (ก้อนไม้/กล่อง) ไม่ต้องใช้ชิ้นงานจริง เพราะใช้ model stub
- **Phase 7 (คุณภาพ):** ต้องมีชิ้นงานจริงที่จะใช้ตอน demo ต่อ *เงื่อนไข* (ผลิตภัณฑ์ × ชนิดความบกพร่อง): ปกติ ≥ 30 ชิ้น และบกพร่อง ≥ 30 ชิ้น (ข้อเสนอ) เหตุผล: ถ้าไม่มีความผิดพลาดเลยใน 30 ชิ้น ขอบบนความเชื่อมั่น 95% ของอัตราผิดพลาดอยู่ที่ราว 10% (rule of three: 3/n) ถ้าจะอ้างได้ว่า ≤ 1% ต้องใช้ราว 300 ชิ้นต่อกลุ่ม — เจ้าของโปรเจกต์ต้องเลือกว่าจะลงทุนระดับใด
- ติดเลข ID ทุกชิ้น แยก **dev/held-out ตามชิ้นงาน** (ไม่ใช่ตามเฟรม) *ก่อน* ดูผลโมเดล และล็อกไว้ (หลักเดียวกับ [fixed-model spec](../specs/fixed-model-inspection-improvements.md))
- ชิ้นงานอ้างอิง 3–5 ชิ้น (ปกติและบกพร่องที่เห็นชัด) เก็บไว้ใช้ใน functional/timing/soak

### 4.5 เครื่องมือวัด

กล้อง slow-motion 240 fps (เช่น iPhone) + แอปนาฬิกาจับเวลาบนหน้าจอ PC ในเฟรมเดียวกัน (ความละเอียดเวลา ≈ 4.2 ms ต่อเฟรม), ไม้บรรทัด/เทปวัดระยะ, มัลติมิเตอร์หรือ USB power meter, เทอร์โมมิเตอร์อินฟราเรด, Serial monitor 115200, `nvidia-smi`, (ทางเลือก) logic analyzer

### 4.6 บทบาทและความปลอดภัย

- อย่างน้อย 2 คน: **Operator** (วางชิ้นงาน/คุม HUD) และ **Recorder** (กรอกผล ถ่ายวิดีโอ) — Phase 3 ขึ้นไปต้องมี **Safety lead** คนที่สามที่มือพร้อมตัดไฟ 5 V
- ตัดไฟ actuator ได้ในมือเดียว (สวิตช์หรือถอดปลั๊ก) ก่อนทุกครั้งที่เริ่ม Phase 3
- เริ่มทุกขั้นตอนใหม่ *ไม่มีภาระทางกล* ก่อน (หลักเดียวกับ [spec item-verdict-deadline](../specs/item-verdict-deadline-safety.md))
- มือและสายห่างจากแขน servo, ลูกกลิ้ง/สายพาน ระหว่างที่ระบบกำลังทำงาน
- ใน VR cinema คนใส่แว่นมองไม่เห็นสายพานและ servo (ไม่มีโหมดที่เห็นห้องจริง เพราะ AR passthrough ไม่อยู่ในขอบเขต ดู D9) ข้อที่คุม actuator จากแว่น (HUD-04, HUD-05) และข้ออื่นที่สวมแว่นขณะ actuator มีไฟ ต้องมี **Safety lead** มองของจริงและมือบนสวิตช์ตัดไฟ เหมือน Phase 3 ขึ้นไป ห้ามเดินสายพานหรือสั่ง servo จากแว่นโดยไม่มีคนมองของจริง

---

## 5. ลำดับ bring-up และเวลาที่ต้องรอ

ทุกขั้นต้องผ่าน gate "พร้อมเมื่อ" ก่อนไปขั้นถัดไป (ใช้สคริปต์ preflight ในภาคผนวก B.1)

| ลำดับ | บริการ | พร้อมเมื่อ | เวลาตามหลักฐาน / ให้บันทึกเอง |
| --- | --- | --- | --- |
| 1 | เครือข่าย | ping ผ่านทุกคู่ (ENV-02) | — |
| 2 | Docker Desktop | `docker ps` ตอบ | บันทึก |
| 3 | model service (`python -m cn360_model`) | `GET :8000/health` = 200 และ `backend: CUDA0` | 3 worker แรกที่วัด: startup 9.8–47.7 วินาที + warm-up 16.6–17.0 วินาที (รวม ≈ 26–65 วินาที); การรอให้ worker ที่ถูกรีสตาร์ทพร้อมก่อนคำขอถัดไปอีก 6 ครั้งอยู่ในช่วงใกล้เคียง (startup 9.6–21.4 วินาที, warm-up 15.2–17.3 วินาที) จาก [model-readiness.json](../evidence/item-verdict-deadline-2026-10-26/model-readiness.json); ขีดจำกัด startup 120 วินาที |
| 4 | relay (`npm start --prefix detection-relay`) | `GET :8081/health` | วินาที |
| 5 | n8n + workflow ที่ active | `GET :5678/healthz` และ webhook ลงทะเบียนครบ 3 ตัว | บันทึก |
| 6 | ThingsBoard + bridge | `GET :8106/health`, dashboard เปิดได้ | ครั้งแรกหลายนาที ([README](../../thingsboard/README.md)); ครั้งต่อไปบันทึกเอง |
| 7 | Camera node | `GET /health` = 200 | Pi: service เริ่ม→เปิดกล้องภายใน ~4 วินาทีตาม log; เวลา boot OS ทั้งหมดให้วัดใน CAM-07 |
| 8 | ESP32 | `GET /health`, `GET /status` | วัดจากจ่ายไฟถึง `/health` ตอบ (CTL-03) |
| 9 | HUD server + Pico | HUD แสดงภาพสด, สถานะ relay เชื่อมต่อ | — |

**เป้าหมายรวมจากเย็นสนิทถึงทุกอย่างเขียว ≤ 5 นาที (ข้อเสนอ)** วัดจริงใน ENV-05

วิธีลดเวลารอระหว่างวันทดสอบ: ปล่อย camera node และ ESP32 เปิดค้างไว้ (service ของ camera node ขึ้นเองตอน boot อยู่แล้ว), เปิดฝั่ง PC ตามลำดับข้างบนครั้งเดียวต่อวัน, และอย่าฆ่า model service ระหว่างรอบ เว้นแต่เป็นการทดสอบ MOD-06/FLT-01 โดยเฉพาะ (เพราะ warm-up 17 วินาทีทุกครั้ง) ถ้าอยากให้ bring-up เป็นคำสั่งเดียว ควรทำสคริปต์ `start-fullsystem.ps1` เป็นงานต่อยอด — ปัจจุบันมีเฉพาะสคริปต์ของ software profile (`n8n/scripts/start-software-bench.ps1`, `thingsboard/scripts/start-native.ps1`) ที่ใช้ภาพนิ่งแทนกล้อง

---

## 6. ชุดการทดสอบ

รูปแบบ: **ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน** คำสั่งที่ยาวอยู่ในภาคผนวก B

### Phase 0 — เตรียมและล็อก baseline (ENV)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| ENV-01 | บันทึก `git rev-parse HEAD`, `git status --short`, hash ของ export workflow n8n, revision/hash ของ weights, build flags ของ firmware, เวอร์ชัน Node/Python/Docker/n8n/Pico OS/เบราว์เซอร์ | บันทึกครบ และ tracked files ไม่มีการแก้ค้าง *หรือ* diff ที่ค้างถูกบันทึกเป็นส่วนของ baseline (ปัจจุบันค้าง: `main.cpp`, `platformio.ini`, `package-lock.json`) | `run-manifest.json` |
| ENV-02 | กรอกแผน IP (4.3) แล้วทดสอบการเข้าถึงเป็นเมทริกซ์: จาก PC, จาก **ภายใน container n8n** (`docker exec`), และจากเบราว์เซอร์บน Pico ไปยังทุกบริการที่เกี่ยวข้อง | ทุกคู่ที่ต้องใช้ตอบ ไม่ใช้ชื่อ `.local` ไม่ใช้ `0.0.0.0` | ตารางผล |
| ENV-03 | `git check-ignore -v` กับ `src/secrets.h`, `n8n/runtime.local.json`, `thingsboard/*.local.json`, `dev-key.pem`, `pico-webapp/dev-key.pem`; ตรวจ `git status` | ไฟล์ลับทั้งหมดถูก ignore; ไม่มี private key ปรากฏในรายการที่จะถูก `git add` | ผล `git status` |
| ENV-04 | ตรวจเครื่องมือวัด: ถ่าย slow-mo 240 fps กับนาฬิกาจับเวลา ตรวจว่านับ 4.2 ms/เฟรมได้ | อ่านเวลาในวิดีโอได้ละเอียด ≤ 10 ms | คลิปทดสอบ |
| ENV-05 | จับเวลา bring-up ตามหัวข้อ 5 จากเย็นสนิท 3 ครั้ง | ทุกบริการเขียวภายในเป้า (ข้อเสนอ ≤ 5 นาที) หรือบันทึกค่าจริงเป็น baseline | ตารางเวลา |
| ENV-06 | บนเครือข่ายที่จะใช้ทดสอบและ demo (ดู D6) เปิด `https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js` ใน PICO Browser แล้วเข้า VR cinema ครั้งแรกจากหน้า HUD HTTPS `:8443` | ไฟล์โหลดได้และเข้า VR cinema ได้ (ถ้าโหลดไม่ได้ HUD ต้องขึ้น `Could not start VR cinema: Could not load A-Frame from the CDN`) ถ้าเครือข่ายไม่มีอินเทอร์เน็ต ให้ฝัง A-Frame ไว้ใน `pico-webapp/` แล้วเปลี่ยน `AFRAME_SRC` ใน `js/vr-cinema.js` ก่อนเริ่ม HUD-04 | ภาพหน้าจอ + บันทึกเครือข่าย |

### Phase 1 — เทสต์อัตโนมัติ (REG)

รันที่ root ของ repo ก่อนเริ่มทดสอบฮาร์ดแวร์ทุกครั้งที่ baseline เปลี่ยน

| ID | คำสั่ง | เกณฑ์ผ่าน |
| --- | --- | --- |
| REG-01 | `npm test --prefix n8n` | ผ่านทั้งหมด (วันนี้ล้ม 1 ข้อเรื่อง CRLF ดู 2.2 — แก้ก่อน) |
| REG-02 | `npm test --prefix detection-relay` | ผ่านทั้งหมด (วันนี้ล้ม 1 ข้อ `hud-proxy.test.mjs` — สืบสาเหตุก่อน) |
| REG-03 | `npm test --prefix pico-webapp` | ผ่านทั้งหมด (ล่าสุด 155/155 ณ 2026-11-24; 144/144 เมื่อ 2026-11-23; 100/100 เมื่อ 2026-11-21 ก่อนมีเทสต์ใหม่; ตัวเลขเปลี่ยนถ้าแก้ `tests/xr-modes.test.js`) |
| REG-04 | `npm test --prefix thingsboard` | ผ่านทั้งหมด |
| REG-05 | `python -m pytest` ใน `raspberry-pi-streaming` (ติดตั้ง `requirements-dev.txt`) และ `model-service` (`python -m pip install -e ".[test]"`) | ผ่านทั้งหมด |
| REG-06 | `./360ControlUnit/test/host/run-host-tests.ps1`, `./360ControlUnit/test/host/build-adapter.ps1`, `./n8n/scripts/run-controller-probe.ps1` (exit 1 = เงื่อนไข timeout/stale-verdict ที่ต้องการไม่ผ่าน) | ผ่านทั้งหมด |
| REG-07 | `node n8n/scripts/item-deadline-inspection.mjs --python <python-with-Pillow>` และ `node n8n/scripts/static-inspection.mjs --mode fixtures --credential-store --python <python-with-Pillow>` (ต้องเปิด Docker Desktop) | ผ่านทั้งหมด |
| REG-08 | `python n8n/scripts/test-idempotency.py` และ `node supabase/smoke-test.mjs --url https://<project>.supabase.co --key-file <ไฟล์คีย์นอก repo>` | ผ่านทั้งหมด |
| REG-09 | `node thingsboard/scripts/accept.mjs` | ผ่านทั้งหมด |
| REG-10 | `pio run -e esp32dev` ใน `360ControlUnit` | build สำเร็จ ไม่มี warning ใหม่ |

### Phase 2 — ทดสอบทีละระบบย่อย

#### 2A. Camera node (CAM)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| CAM-01 | `GET /health` | 200, `fresh: true`, `frameAgeMs` ต่ำกว่า 3000 (ค่า `FRAME_STALE_SECONDS`) | JSON |
| CAM-02 | `GET /capture` | `image/jpeg` ถอดรหัสได้ ขนาดภาพตรงกับ `X-Frame-Width/Height` และมีหัวข้อครบ 5 ตัว (`X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`) | ไฟล์ภาพ + header |
| CAM-03 | `GET /info` เทียบ `requested*` กับ `actual*` | บันทึกความละเอียดจริง (ที่ผ่านมาร้อง 1920×1080 แต่กล้อง Generalplus ให้ 640×480) **ความละเอียดนี้ต้องเป็นค่าเดียวกับที่ใช้เก็บข้อมูลใน Phase 7** | JSON |
| CAM-04 | ยิง `GET /capture` ต่อเนื่อง 100 ครั้งจาก **ภายใน container n8n** (ขณะไม่มี viewer / มี HUD 1 viewer / มี 3 viewer) | ไม่มีครั้งใดเกิน 800 ms (timeout ของโหนด `capture-frame` ใน n8n) และ p95 ≤ 400 ms (ข้อเสนอ เพื่อเหลือ headroom) | p50/p95/max |
| CAM-05 | ดูสตรีมบน HUD 60 วินาที; วัดความหน่วงโดยถ่ายนาฬิกาจับเวลาในเฟรมเดียวกัน | ≥ 15 FPS ตามที่ตั้ง และ glass-to-glass < 300 ms (เกณฑ์ทีมที่ใช้ใน #22) | คลิป + ตัวเลข |
| CAM-06 | ถอดสาย USB กล้อง 10 วินาที แล้วเสียบกลับ | ตอนถอด `/health` = 503 ทันที และ HUD ซ่อนภาพค้าง; หลังเสียบกลับ `/health` = 200 ภายใน ~2 วินาที และ HUD ต่อภาพใหม่เองโดยไม่ refresh | คลิป + log |
| CAM-07 | ตัดไฟ camera node แล้วจ่ายไฟใหม่ ×3 | service ขึ้นเอง; `X-Camera-Session` เปลี่ยน; `X-Frame-Sequence` เริ่มนับใหม่; ไม่มีเฟรมเก่าถูกส่ง; **บันทึกเวลาจากจ่ายไฟถึง `/health` = 200** ทั้ง 3 รอบ | ตารางเวลา |
| CAM-08 | ตัด Wi-Fi ของ camera node 30 วินาที แล้วต่อกลับ | HUD ต่อกลับเองและแสดงภาพสดต่อ; `/capture` กลับมาใช้ได้ | คลิป |
| CAM-09 | (ถ้าใช้โหมด push) ตั้ง `N8N_WEBHOOK_URL`, `POST /push` | ตอบ 202; n8n ได้รับ multipart ครบ field; `/info.push.totalPushed` เพิ่ม; webhook ล่ม → retry ตาม `PUSH_MAX_ATTEMPTS` แล้ว drop และกลับมาส่งใหม่ได้ | `/info` + n8n execution |
| CAM-10 | **ภาพนิ่งนิ่งสม่ำเสมอ:** ล็อก exposure/focus/white balance (เช่น `v4l2-ctl --set-ctrl=...` บน Linux) แล้วเก็บ 30 เฟรมของชิ้นงานเดิม และอีก 30 เฟรมขณะมีชิ้นงานเคลื่อนเข้า | ค่าเฉลี่ยความสว่างต่างกันไม่เกิน ±3% (ข้อเสนอ) และไม่เห็น auto-exposure ปรับตัวเมื่อชิ้นงานเข้าเฟรม | ภาพ + ตัวเลข |
| CAM-11 | รันต่อเนื่อง 30 นาที: HUD เปิดสตรีม + `/capture` ทุก 1 วินาที | ไม่มีเฟรมหลุดนาน > 3 วินาที; CPU/อุณหภูมิไม่ถึงจุด throttle (Pi: `vcgencmd get_throttled` = `0x0` ถ้ามีเครื่องมือนี้ — ระบบใน #22 เป็น Arch Linux ARM จึงอาจไม่มี ให้ดูอุณหภูมิ/ความถี่ CPU แทน; UNO Q: บันทึกค่า) | log |
| CAM-12 | ตรวจแสง: ถ่าย 240 fps ของฉากภายใต้แสงที่ใช้จริง | ไม่เห็นแสงกะพริบ/แถบมืดวิ่ง; แสงทั่วพื้นที่ตรวจสม่ำเสมอ | คลิป |

#### 2B. ESP32 และกลไก (CTL)

อ้างอิงสัญญาจาก [360ControlUnit README](../../360ControlUnit/README.md) และ `src/main.cpp`

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| CTL-01 | ตรวจสายตาม pin map (4.1) ทั้งตอนไม่จ่ายไฟและจ่ายไฟ; วัดแรงดันราง 5 V ขณะ servo ขยับ + สายพานเดิน | ต่อถูกขา GND ร่วม; แรงดันราง 5 V ต่ำสุด ≥ 4.75 V | ตารางวัด |
| CTL-02 | (ถ้ายังไม่เคยทำ) ทดสอบอุปกรณ์แยกชิ้นด้วยโปรแกรม `hwtest` — ต้องเอา comment ของบล็อก `[env:hwtest]` ใน `platformio.ini` ออกก่อน แล้ว `pio run -e hwtest -t upload` | LED, servo, stepper ทำงานทีละตัวตามที่ตั้งใจ | คลิป |
| CTL-03 | จ่ายไฟและดู Serial แล้ว `GET /health`, `GET /status` | Serial พิมพ์ `Control unit ready. IP: …`; `/status` เป็น `state: idle`, `mode: auto`, `pass_count: 0`, `reject_count: 0`, `verdict_window_ms: 3000`, `notify_failures: 0`, `automatic_admission_enabled: false` (build ปกติ), `controller_session` เป็น hex 32 ตัว; บันทึกเวลาจากจ่ายไฟถึง `/health` ตอบ | JSON + เวลา |
| CTL-04 | ตัด IR beam ด้วยมือ/ชิ้นงาน แล้วปล่อย; สะบัดมือผ่านเร็วๆ 20 ครั้ง | `/status.item_present` เป็น `true` เมื่อบัง และ `false` เมื่อพ้น (ขั้ว LOW = มีชิ้นงาน); ไม่มี state ผิดปกติหรือ counter เปลี่ยนใน build ที่ปิด admission | คลิป + `/status` |
| CTL-05 | โหมด Manual: ส่ง `/mode {"mode":"manual"}` แล้ว `/servo` ที่มุม 0, 45, 90, 0 และ `{"sweep":true}` ส่วนโหมด Auto ลองสั่งมุม | แขนขยับตามสั่ง กลับ rest (0°) ไม่ชน ไม่สั่น/ไม่ร้อนผิดปกติ; ใน Auto คำสั่งมุม/ sweep ถูกปฏิเสธ (`accepted: false`) ตามสัญญา; บันทึกพฤติกรรมเมื่อส่งมุมนอก 0–180 | คลิป + response |
| CTL-06 | สายพานในโหมด Manual ผ่านสคริปต์ B.3: ขอ lease → ส่ง neutral → ส่ง forward ทุก 200 ms 3 วินาที → หยุดส่ง; วัดความเร็ว (ระยะ 20 ซม. ÷ เวลา), เวลาที่สายพานหยุดหลังหยุดส่ง และระยะไหลต่อ (ซม.) ทั้ง forward และ reverse ซ้ำ 10 ครั้ง | เดินเมื่อรับคำสั่ง ตามทิศที่ถูกต้อง; หยุดภายใน ~0.5 วินาทีหลังคำสั่งสุดท้าย (กลไกใน `ControlUnitState.cpp:266`); **บันทึกความเร็ว (ซม./วินาที) และระยะไหลต่อ** เพื่อใช้ใน HOLD-01 | ตารางวัด + คลิป |
| CTL-07 | กฎของสายพาน (ใช้ B.3): (a) สั่ง forward โดยไม่ส่ง neutral ก่อน (b) ใช้ lease ที่ไม่ได้ต่ออายุเกิน 2 วินาที (`conveyorLeaseMs` = 2000 ms) (c) ใช้ sequence ไม่เพิ่มขึ้น (d) ใช้ `controller_session` ผิด (e) โหมด Auto ใน build ที่ปิด admission สั่ง forward (f) สลับ Manual→Auto แล้วสั่ง forward ทันที | ทุกข้อได้ `accepted: false` สายพานไม่ขยับ (เว้นข้อ e–f ที่ต้องเข้ากฎ "ต้องมี neutral ก่อน/Auto ต้องเปิด admission") | response ต่อข้อ |
| CTL-08 | สัญญา `/verdict` (B.4): JSON เสีย; ไม่มี identity; identity ถูกรูปแบบแต่ไม่มี item active; `POST /reject` | 400 `invalid_request`; 400; 200 `accepted: false` เหตุผล `no_active_item` หรือ `wrong_session` (ห้ามเป็น `accepted: true`); 400 `item_identity_required` | response |
| CTL-09 | วัด RTT ของ ESP32 ด้วย B.2: `GET /status` 100 ครั้ง ห่างกัน 100 ms จาก PC และจากภายใน container n8n | ไม่มีครั้งที่ล้มเหลว; p95 ≤ 100 ms และ max < 250 ms (ข้อเสนอ — งบ `post-verdict` ใน n8n คือ 250 ms) ถ้าเห็น spike ให้ตรวจ Wi-Fi power-save ของ ESP32 (ต้องยืนยันว่าค่าเริ่มต้นของ core ที่ใช้เปิดอยู่หรือไม่; ถ้าจะปิด เช่น `WiFi.setSleep(false)` เป็นการแก้ firmware ที่ต้องรัน REG ซ้ำ) | p50/p95/max |
| CTL-10 | ปิด AP 30 วินาทีแล้วเปิด | ESP32 ต่อกลับเอง (retry ทุก 5 วินาที) `/health` ตอบ; `uptime` ไม่ถูก reset (ไม่ reboot/WDT) | `/health` + Serial |
| CTL-11 | ตัดไฟแล้วจ่ายใหม่ ขณะสายพาน/servo อยู่ในตำแหน่งต่างๆ | ตอนบูต servo กลับ rest, สายพานไม่เคลื่อนที่เอง, buzzer/LED ปิด; `controller_session` ใหม่; `admission_ready` เป็น false จนกว่าจะเห็น beam ว่างหนึ่งครั้ง | คลิป + `/status` |
| CTL-12 | ทดสอบแหล่งจ่าย: servo sweep + สายพาน forward + LED/buzzer พร้อมกัน 5 นาที | ไม่ reboot (`uptime` เพิ่มต่อเนื่อง), Wi-Fi ไม่หลุด, แรงดันราง 5 V ไม่ต่ำกว่า 4.75 V | log + ตัวเลข |

หมายเหตุ: การทดสอบ notify/expiry ทางกายภาพต้องใช้ admission จึงอยู่ใน Phase 3–5 (build ปกติรับชิ้นงานไม่ได้)

**หมายเหตุ (2.4):** CTL-04 พักไว้ (ไม่มีเซนเซอร์ IR); CTL-11 ตัดเกณฑ์ buzzer และ `admission_ready` ออก (ยังตรวจ servo กลับ rest, สายพานไม่เดินเอง, LED ปิด, `controller_session` ใหม่); CTL-12 ตัด buzzer ออกจากโหลดที่ใช้ทดสอบ; CTL-01 ตรวจเฉพาะ pin ที่ยังใช้

#### 2C. Model service (MOD)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| MOD-01 | เริ่ม service ใหม่ 3 ครั้ง บันทึก `startup_ms`, `warmup_ms` (จาก `/health`) แยกกัน | พร้อมภายใน 120 วินาที (ขีดจำกัด startup); เทียบกับ baseline 9.8–47.7 s + 16.6–17.0 s (3 worker แรกที่วัดไว้) | `/health` ×3 |
| MOD-02 | ตรวจ `backend` ใน `/health` | เป็น `CUDA0` ไม่ใช่ CPU (การขอ GPU อาจ fallback เป็น CPU เงียบๆ — ถ้าเป็น CPU ผลเวลาใช้ไม่ได้) | `/health` |
| MOD-03 | `POST /predict` (multipart `file` + `prompt`) ด้วยเฟรมจาก camera node; `GET /set_prompt`, `GET /get_prompt` | `status: success`; กล่องเป็นพิกเซลและอยู่ในกรอบภาพ; `prompt_used` ตรงกับที่ส่ง; prompt ว่าง → 400; ไม่มี `confidence` ที่นำมาใช้ | response |
| MOD-04 | ความหน่วงบน **เฟรมจริงจากกล้องจริง**: ยิง `/predict` ต่อเนื่อง ≥ 100 ครั้งภายใต้ deadline production 1100 ms (ห้ามใช้ service ที่ผ่อน deadline) แยกรายงาน "คำขอแรกหลัง restart" ×3 กับ warm | ข้อเสนอ: ไม่มีครั้งที่เกิน deadline ใน 100 ครั้ง warm และ p95 ≤ 1100 ms; **ทุกครั้งที่ timeout นับเป็นความล้มเหลว** baseline ปัจจุบัน: p50 ≈ 1041 ms, p95 ≈ 1609 ms (diagnostic ที่ผ่อน deadline), production 2/3 timeout | p50/p95/max + จำนวน timeout |
| MOD-05 | ยิง 2 และ 5 คำขอพร้อมกัน | คำขอที่เกินได้ `model_busy` ทันที ไม่มีการ overlap บน native context ไม่มีคิวซ่อน | response |
| MOD-06 | ทำให้ worker timeout/ถูกฆ่า (ตามวิธีใน `model-service` tests/README) | `/health` = 503 แล้ว recovery + warm-up กลับเป็น 200 ได้เอง; บันทึกเวลา recovery; คำขอแรกหลัง recovery ถูกนับเป็น "post-restart" | log + เวลา |
| MOD-07 | รันต่อเนื่อง 30 นาที (ยิง 1 คำขอ/5 วินาที) พร้อมดู `nvidia-smi` | ไม่ OOM; ไม่ throttle ที่ทำให้เวลาแย่ลงต่อเนื่อง; บันทึก VRAM สูงสุด (baseline ~5033 MiB จาก 6144 MiB) และอุณหภูมิสูงสุด | log |

#### 2D. n8n และสัญญาระหว่างระบบ (N8N)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| N8N-01 | ตั้งค่า `n8n/runtime.local.json` แล้ว `node configure.mjs`; import 3 workflow (ยัง inactive) | ไม่มี placeholder `REPLACE_*` ค้าง; ค่า budget ตรงตาม 250/800/1200/250 ms; configure ปฏิเสธค่าที่ไม่พอ | log ของ configure |
| N8N-02 | จาก **ภายใน container n8n** เรียก capture/model/relay/ESP32 | เข้าถึงได้ทุกบริการด้วย URL ที่ใส่ใน workflow | ผล `docker exec` |
| N8N-03 | เปิดใช้งาน workflow; เปลี่ยน Inspection Target จาก HUD (`POST /webhook/detection-prompt` `{"prompt":"scratch"}`) | model `get_prompt` เท่ากับ `Locate all the instances that matches the following description: scratch.`; Prompt History มีแถวใหม่; prompt ว่าง → 400; model ปฏิเสธ → 502 | response + แถว DB |
| N8N-04 | `POST /webhook/inspect-now` (ไม่ผูกชิ้นงาน) | ตอบ `status/result` ตามสัญญา; **ไม่มี** Control Action ไปยัง ESP32 | execution + `/status` ไม่เปลี่ยน |
| N8N-05 | ส่ง `item-detected` ปลอมที่ identity ไม่ตรง controller จริง (B.5) | n8n เดินครบ; ESP32 ตอบ `accepted: false` (ignored); n8n บันทึก `controlOutcome` เป็น `ignored` และ **ไม่** ถือว่าชิ้นงานถูกคัดแยก | execution + แถว `control_actions` |
| N8N-06 | Health Watchdog: หยุด model แล้วเปิด, ถอดกล้องแล้วเสียบ | บันทึกเฉพาะการเปลี่ยนสถานะ ไม่ซ้ำสถานะเดิม | `system_logs` |
| N8N-07 | ตรวจ production webhook URL (`/webhook/…`) ไม่ใช่ test URL (`/webhook-test/…`) ที่ ESP32 และ HUD ใช้ | ทั้งสองชี้ production URL ของ workflow ที่ active | config |

#### 2E. HUD บน Pico 4 และ relay (HUD)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| HUD-01 | เปิด `http://<PC-IP>:8080` บน Pico; เลือก Remote stream | เห็นภาพสดจาก camera node; ถอดกล้อง → ซ่อนภาพค้าง; เสียบ → กลับมาเอง | คลิป |
| HUD-02 | ส่ง `POST :8081/detections` ตัวอย่างกล่องที่รู้พิกัด (ตัวอย่างใน README ของ relay) แล้วเทียบกล่องกับภาพต้นฉบับที่ขนาดจอต่างกัน (หมุน/ย่อ-ขยาย) | กล่องตรงตำแหน่งพิกเซลจริง; กล่องทั้งหมดแสดง **แม้ต่ำกว่า threshold**; กล่องล้างเมื่อส่ง `detections: []` | ภาพหน้าจอ |
| HUD-03 | HUD ต่อ relay ช้ากว่า payload; เปิด HUD ทีหลัง; ส่งเฟรมสลับลำดับ (sequence เก่ามาทีหลัง) | ผู้เชื่อมต่อใหม่ไม่เห็นเฟรมเก่า; เฟรมเก่าไม่ทับเฟรมใหม่; session ใหม่ที่ sequence รีเซ็ตยังแสดงได้ | คลิป |
| HUD-04 | ควบคุมจาก Pico (VR cinema ผ่าน `npm run serve:vr`, `https://<PC-IP>:8443/?xrdebug=1`): stick ซ้ายขึ้น/ลง = สายพาน, stick ขวา = servo, A = reject, B = pass, X = Manual, Y = Capture & inspect (ถ่ายรูปแล้วให้ AI ตรวจ), grip = sweep (ปุ่ม Auto ย้ายไปอยู่บนจอ 2D); ต้องมี Safety lead มองของจริง (4.6) | ทุกปุ่มทำงานตามตารางใน `pico-webapp/README.md`; ปุ่มที่ firmware ปฏิเสธ (เช่น servo ใน Auto) แสดงเหตุผลบน HUD; บันทึกดัชนีปุ่มจริงด้วย `?xrdebug=1` | คลิป |
| HUD-05 | ถอดการเชื่อมต่อของ Pico (ปิด Wi-Fi แว่น) ขณะดัน stick ค้างให้สายพานเดิน (ต้องมี Safety lead มองของจริงและมือบนสวิตช์ตัดไฟ) | สายพานหยุดภายใน ~0.5 วินาทีหลังคำสั่งสุดท้าย | คลิป 240 fps |
| HUD-06 | ส่ง prompt จาก HUD ผ่าน n8n จริง (CORS ของ n8n) | ส่งผ่าน; หมดเวลา 8 วินาทีถ้า n8n ล่ม และ UI ไม่ค้าง | คลิป |
| HUD-07 | ตรวจ Verdict ด้วยมือจาก HUD ขณะไม่มี item active | HUD ไม่ส่งคำสั่ง (อ่าน `/status` ต้องเป็น `awaiting_verdict`) หรือ firmware ตอบ ignored และ HUD แสดงเหตุผล | คลิป |
| HUD-08 | ปุ่ม **Capture & inspect** บนจอ 2D: กด 1 ครั้งขณะ n8n workflow active และ HUD server ตั้ง `--n8n-origin` ถูก | บรรทัดผลของปุ่มขึ้น `Captured · AI says …` (หรือ review/error ตามจริง) และระบุว่าไม่มีคำสั่งไปที่เครื่อง; กล่องและข้อความสรุปขึ้นบน HUD; n8n มี execution ใหม่ 1 ครั้งที่ไม่ผูก item; `/status` ของ ESP32 ไม่เปลี่ยน | คลิป + execution + `/status` |
| HUD-09 | ปุ่ม **Y ซ้าย** ใน VR cinema (HTTPS `:8443`): กด 1 ครั้ง, กดค้าง, กดรัว | ได้ผลเหมือน HUD-08 บนหน้า HTTPS (ไม่ติด mixed content); กดค้างหรือรัวได้คำขอเดียว (ข้อความ `Capture already running`); legend ใน VR แสดง `Capture · Y`; Y ไม่สลับเป็น Auto อีก ส่วน X ยังสลับเป็น Manual | คลิป + execution |
| HUD-10 | การถ่ายล้มเหลว: (a) n8n workflow ไม่ active (b) หยุด n8n (c) model ล่มหรือหน่วง (d) ถอดกล้อง | บรรทัดผลของปุ่มเป็น `Capture failed · …` สีแดงทุกกรณี (404 บอกให้ตรวจว่า workflow active, 504 `n8n unreachable`, `model_*` / `frame_capture_failed`) ไม่มีกรณีใดแสดงเหมือนผลตรวจ | ภาพหน้าจอ |
| HUD-11 | ผลล้มเหลวที่มาทาง relay: ส่ง `POST :8081/detections` ที่ `reason` เป็น `model_timeout`, `frame_capture_failed` และอีกชุดที่ `status` เป็น `error` | ข้อความสรุปเป็น `AI unavailable · <reason>` ไม่ใช่ "AI reports no detections"; ไฟสถานะ AI สีแดง; ข้อความค้างเกิน `detectionTtlMs` จนมีผลใหม่; ผล `no_defect_detected`, `defect_detected`, `manual_review_required` ยังแสดงและหมดอายุตามเดิม | ภาพหน้าจอ + คลิป |
| HUD-12 | `/n8n/inspect-now` ของ HUD server: ส่ง GET, ส่ง POST แบบ form หรือ `text/plain`, ส่ง body ที่มี `controller_session`/`item_id`, ยิงสองคำขอพร้อมกัน | 405 / 415 / n8n ได้รับเฉพาะ `{}` ไม่มี identity / คำขอที่สองได้ 429 | `curl` + log ของ n8n |
| HUD-13 | เข้า/ออก VR cinema 5 รอบจากหน้า HUD HTTPS `:8443` บนเครือข่ายที่มีอินเทอร์เน็ต (ENV-06): กดปุ่ม **VR cinema**, รอ A-Frame โหลด, ดูการ์ดและ legend, ออกจาก session, ตรวจว่า HUD กลับเป็น 2D แล้วเข้าซ้ำ; รอบสุดท้าย (ไม่บังคับ): ล้างแคช PICO Browser, รีโหลดหน้า HUD, ตัดอินเทอร์เน็ตของแว่น แล้วกด VR cinema | เข้าได้ทุกรอบ ไม่ค้าง; การ์ดแสดงภาพกล้องพร้อมกล่อง ข้อความสรุป และ legend `Capture · Y`, `Manual · X`, `Sweep · Grip`, `Reject · A   Pass · B`; หลังออก HUD กลับเป็น 2D ปุ่ม **Capture & inspect** และช่อง prompt ยังใช้ได้ ไม่มี session ค้างหรือปุ่มโหมดค้างสถานะ; เมื่อไม่มีอินเทอร์เน็ตและ A-Frame ยังไม่ถูกโหลด ขึ้น `Could not start VR cinema: Could not load A-Frame from the CDN…` แทนการค้างเงียบ | คลิป + ภาพหน้าจอ |

#### 2F. ข้อมูลและการเฝ้าดู (DAT)

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| DAT-01 | หลังชิ้นงานทดสอบ 1 ชิ้นจาก Phase 4: ตรวจ Supabase `inspection_results`, `control_actions`, `prompt_history`, `system_logs` และ bucket snapshot | แถว inspection และ control เชื่อมกันด้วย key; `controller_session`/`item_id` ตรงกับ `/status`; snapshot ที่เก็บเป็น JPEG ที่ถูก inspect จริง (เทียบ hash) | query + hash |
| DAT-02 | ThingsBoard: ผลปกติขึ้นใน dashboard | ภายใน 5 วินาที; health ตรวจทุก 10 วินาที; banner stale ที่ 25 วินาทีเมื่อ bridge หยุด | วิดีโอหน้าจอ |
| DAT-03 | ปรับ `thingsboard/runtime.local.json` ให้ตรวจ health ของ **model/camera node/relay/n8n จริง** (ค่าเริ่มต้นเป็นของ saved-image profile) แล้วหยุดทีละบริการ | alarm "Service unavailable" ขึ้นและล้างเมื่อกลับมา | ภาพหน้าจอ |
| DAT-04 | หยุด ThingsBoard ระหว่างมีผลตรวจ แล้วเปิดใหม่ (`node thingsboard/scripts/replay.mjs` ถ้าจำเป็น) | bridge เก็บ journal ได้; หลัง replay ตัวนับไม่เพี้ยน | counters |
| DAT-05 | ตัดอินเทอร์เน็ต (Supabase ไม่ถึง) ระหว่างตรวจ | Verdict และการตอบ webhook ไม่ถูกหน่วง; ข้อผิดพลาดการเก็บถูกบันทึกใน n8n; ไม่มีผลย้อนต่อ Inspection Result | execution |

### Phase 3 — ยืนยันว่ากักชิ้นงานและ reject ทัน (HOLD) — gate ของ automatic admission

> **พักไว้ (BLOCKED):** ทั้ง Phase นี้ต้องมีเซนเซอร์ IR เพื่อให้สายพานหยุดและ admit ชิ้นงาน ซึ่งตอนนี้ไม่ใช้ (ดู 2.4) — รอการตัดสิน D8

นี่คือเงื่อนไขที่ [360ControlUnit README](../../360ControlUnit/README.md) และ [spec](../specs/item-verdict-deadline-safety.md) กำหนดไว้ก่อนเปิด admission: ต้องแสดงให้เห็นว่ามีการจัดวางชิ้นงานเดี่ยวที่ยัง reject ได้เมื่อหมดเวลา **หรือ** มีอุปกรณ์หยุด/กักภายนอก โครงสร้างปัจจุบันที่น่าจะเข้าเงื่อนไขคือ **สายพานหยุดเองเมื่อ IR เจอชิ้นงานในโหมด Auto** (ดูพฤติกรรมใน `ControlUnitState.cpp`) แต่ต้องพิสูจน์ด้วยการวัด

**เงื่อนไขก่อนเริ่ม:** Phase 2B ผ่าน; Safety lead พร้อม; build firmware ด้วยแฟล็ก bench-only (ไม่ commit เข้า config ปกติ):

```ini
; platformio.ini — เฉพาะ build สำหรับ bench ที่มีคนคุม
build_flags = -D CN360_BENCH_ADMISSION_ENABLED=1
```

ตรวจว่า `/status.automatic_admission_enabled` เป็น `true` แล้วเท่านั้น และ **กลับไป build ปกติทุกครั้งที่เลิกใช้ bench**

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| HOLD-01 | วัดผัง: ระยะ IR → กลางภาพกล้อง → ปลายแขน servo; ขนาดชิ้นงาน; ความเร็วและระยะไหลของสายพาน (จาก CTL-06) | หลังสายพานหยุด ชิ้นงานต้องอยู่ในขอบเขตภาพกล้อง **และ** อยู่ในระยะที่แขน servo เขี่ยออกได้ — คำนวณก่อนทดสอบจริง | แบบวัด + ภาพ |
| HOLD-02 | วางชิ้นงานเดี่ยว ดันสายพาน forward ใน Auto จน IR เจอ ทำ 30 ครั้ง | สายพานหยุดเองทุกครั้ง; ชิ้นงานหยุดในพื้นที่ที่คำนวณ (วัดตำแหน่งหยุดและความแปรปรวน); `state` เปลี่ยนเป็น `awaiting_verdict` | คลิป + ตารางตำแหน่ง |
| HOLD-03 | สั่ง reject จริงผ่าน `/verdict` (ใช้ session/item จาก `/status`) 30 ครั้ง | แขน servo เขี่ยชิ้นงานออกจากสายพานได้ 30/30; แขนกลับ rest | คลิป 240 fps |
| HOLD-04 | สั่ง pass 30 ครั้ง | ไฟเขียวติด (200 ms) ชิ้นงานไม่ถูกแตะ; หลังจบรอบผู้ปฏิบัติดัน forward เพื่อเคลียร์ชิ้นงานตามขั้นตอนใน HUD README ได้ | คลิป |
| HOLD-05 | **timeout fallback ทางกายภาพ:** ตัดการติดต่อ n8n (หยุด n8n) แล้วให้ชิ้นงานเข้า 30 ครั้ง | ครบ 3000 ms ชิ้นงานถูก reject จริง 30/30 *ขณะยังอยู่ในระยะแขน*; `reject_count` เพิ่ม, `pass_count` ไม่เพิ่ม; `notify_failures` เพิ่ม; `resolution_reason` ระบุ timeout | คลิป + `/status` |
| HOLD-06 | วินัยการป้อนชิ้นเดี่ยว: ขณะชิ้นแรกรอ Verdict พยายามให้ชิ้นที่สองตัด beam | ไม่เกิด admission ซ้อน (`admission_ready` เป็น false); ชิ้นที่สองไม่ได้ identity; หลังชิ้นแรกจบและ beam ว่างจึงรับชิ้นถัดไปได้ | คลิป + `/status` |
| HOLD-07 | ขั้นตอนกู้คืนหลัง timeout: ตาม README (สลับ Manual → เคลียร์ชิ้นงาน/beam → กลับ Auto) | ทำตามได้ ระบบกลับสู่ idle พร้อมรับชิ้นใหม่ | คลิป |

**ผ่าน (ข้อเสนอ):** HOLD-02 ถึง HOLD-06 ได้ 30/30 ทุกข้อ ถ้าไม่ผ่าน = **BLOCKED**: automatic operation ถูกบล็อกจนกว่าจะแก้กลไกกัก/หยุด (ไม่ออกแบบกลไกใหม่ในแผนนี้) — ผลของ Phase 4–6 ยังทำต่อได้แต่ต้องระบุว่าอยู่ภายใต้ bench ที่มีคนคุม

### Phase 4 — ครบวงจร (E2E)

> **พักไว้ (BLOCKED):** ทั้ง 4a และ 4b เริ่มรอบจากการที่ชิ้นงานตัด IR (ดู 2.4) — รอการตัดสิน D8 ส่วนสัญญาของ n8n ใช้ N8N-xx และ software bench ทดสอบแทนได้

ใช้ build bench (admission เปิด) และตั้ง `N8N_NOTIFY_URL` เป็นปลายทางจริง ลำดับต่อรอบ: วางชิ้นงาน → ดัน forward ใน Auto → สายพานหยุดที่ IR → ESP32 admit + notify n8n → n8n ดึง `/capture` → model → POST `/verdict` → servo/LED → HUD overlay → Supabase → ThingsBoard

#### 4a. โซ่ฮาร์ดแวร์ + model stub (ไม่ขึ้นกับคุณภาพ AI)

ใช้ stub ที่ implement สัญญา model service เดียวกัน (`/health`, `/predict`, `/set_prompt`, `/get_prompt`) และคืนผลตามที่สั่ง: **pass** (ไม่มีกล่อง), **reject** (กล่องคลุม > 0.5% ของเฟรม), **error** (HTTP 500), **timeout** (หน่วง > 1200 ms) — software profile มี controlled model ที่ port 8105 (`n8n/scripts/software-bench.mjs`) ให้ใช้เป็นต้นแบบ; ต้องยืนยันวิธีรัน stub แยกโดยไม่เปิด controller จำลอง แล้วตั้ง `modelBaseUrl` ใน `n8n/runtime.local.json` ให้ชี้ stub (และ `esp32` ชี้ ESP32 จริง)

| ID | สถานการณ์ | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| E2E-A1 | stub = pass ×10 | ไฟเขียว; `pass_count` +10; `control_outcome: accepted`; HUD ไม่มีกล่อง/แสดงสถานะผ่าน; แถว DB ครบ 10 | คลิป + ตาราง |
| E2E-A2 | stub = reject ×10 | แขน servo เขี่ยออก; ไฟแดง/buzzer; `reject_count` +10; HUD แสดงกล่อง | คลิป |
| E2E-A3 | stub = error ×5 | ชิ้นงานถูก reject; webhook ตอบ `status: error`, `result: error` + `reason`; **ไม่นับเป็น reject จากการตรวจสำเร็จ** (บันทึกแยกใน `system_logs`) | คลิป + execution |
| E2E-A4 | stub = timeout ×5 | n8n ตัดที่ ~1200 ms → reject; ชิ้นงานถูก reject ก่อน 3000 ms; response ของ stub ที่มาช้าถูกทิ้ง ไม่สร้างคำสั่งที่สอง | คลิป + execution |
| E2E-A5 | ถอดกล้องระหว่างชิ้นงาน ×3 | `frame_capture_failed` → reject | execution |
| E2E-A6 | ส่ง `item-detected` ซ้ำด้วย payload เดิม ×3 | ไม่มีการขยับซ้ำ; ตัวนับไม่เพิ่ม; มีบันทึกว่าถูกกดซ้ำ | `/status` + log |
| E2E-A7 | Verdict ด้วยมือจาก HUD (A = reject, B = pass) ภายในหน้าต่าง 3000 ms ×5 ต่อปุ่ม (ปิด/หน่วง n8n เพื่อไม่แย่ง) | ผลตรงปุ่ม; ตอบ `accepted: true` + echo identity | คลิป |
| E2E-A8 | เปลี่ยน Inspection Target จาก HUD ระหว่างชิ้นงาน | ชิ้นถัดไปใช้ Model Instruction ใหม่ (ดู `prompt_used` ใน response ของ stub); Prompt History บันทึก | execution + DB |
| E2E-A9 | สลับ Auto/Manual ระหว่างทำงาน และขั้นตอนกู้คืนหลัง timeout | ตรงกับพฤติกรรมในเอกสาร ไม่มีสายพานเดินเองหลังสลับ | คลิป |
| E2E-A10 | ชิ้นงานต่อเนื่อง 20 ชิ้น สลับ pass/reject | ตัวนับ ESP32 = จำนวนแถว Supabase = ตัวนับ ThingsBoard (reconcile) | ตาราง reconcile |

**ผ่าน (ข้อเสนอ):** ทุกกรณีได้ผลตามคาด 100% และ reconcile ตรงกัน

#### 4b. ชิ้นงานจริง + โมเดลจริง

| ID | สถานการณ์ | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| E2E-B1 | ชิ้นงานอ้างอิงปกติ ×30 และบกพร่อง ×30 ผ่านโซ่เต็ม ด้วย prompt เดียวที่ล็อก | **บันทึกผลตามจริง** (verdict, coverage, กล่อง, เวลา, ผลทางกายภาพ) ไม่บังคับผลให้ตรงป้ายกำกับ; ทุกชิ้นถูกกักและจบรอบภายใน 3000 ms (ด้วย verdict หรือ timeout fallback) | `results.csv` + คลิปตัวอย่าง |
| E2E-B2 | ตรวจผลลัพธ์ `review` (นโยบายปัจจุบันสำหรับเงื่อนไขที่ไม่ qualified) | ชิ้นงานถูก reject ทางกายภาพ; HUD/ThingsBoard แสดงสถานะ review แยกจากคำแนะนำของโมเดลและจาก receipt ของ controller (ต้องยืนยันว่า flow ที่ใช้กับกล้องจริงมีคิว review เหมือน software profile หรือไม่) | ภาพหน้าจอ |

ผลของ 4b ไม่ใช่ gate ผ่าน/ไม่ผ่านของคุณภาพ (gate นั้นอยู่ใน Phase 7) แต่เป็นการยืนยันว่าโซ่ครบวงจรทำงานกับโมเดลจริง

### Phase 5 — จำลองความล้มเหลว (FLT) — ต้อง "fail closed"

> **บางส่วนพักไว้ (2.4):** FLT-01…06, FLT-11 และ FLT-12 ต้องมีชิ้นงานที่ถูก admit (หรือการตัด IR) จึงพักไว้; FLT-07…10 และ FLT-13…14 ทำได้เท่าที่ไม่ต้องพึ่งการ admit ให้บันทึกในผลว่าส่วนไหนไม่ได้ตรวจ

หลักการ: ชิ้นงานที่ระบบประเมินไม่ได้ ต้องถูก reject (ไม่ใช่ pass) และต้องกู้คืนได้เอง ทุกกรณีบันทึก: อะไรถูกสั่งทางกายภาพ, ตัวนับ, log/แถว DB, เวลากู้คืน

| ID | ฉีดความล้มเหลว | ผลที่ต้องเห็น |
| --- | --- | --- |
| FLT-01 | ฆ่า model service ระหว่างชิ้นงาน | `model_unreachable`/timeout → reject ก่อน 3000 ms; `/health` ของ model เป็น 503; กลับมา READY เองหลัง warm-up |
| FLT-02 | หน่วง model เกิน 1200 ms (stub) | `model_timeout` → reject; ผลที่มาช้าไม่สร้างคำสั่งที่สองและไม่ทับผลที่ reject แล้ว |
| FLT-03 | ถอดกล้อง / ตัดไฟ camera node | `frame_capture_failed` → reject; HUD ซ่อนภาพค้าง |
| FLT-04 | หยุด n8n | `notify_failures` ของ ESP32 เพิ่ม; ครบ 3000 ms ESP32 reject เอง (ยืนยันทางกายภาพ); เปิด n8n กลับแล้วระบบทำงานต่อ |
| FLT-05 | ปิด Wi-Fi AP ขณะมีชิ้นงานรอ Verdict | fallback ท้องถิ่นของ ESP32 ทำงาน (แขนเขี่ย); ต่อกลับแล้วตัวนับสอดคล้อง |
| FLT-06 | ตัดไฟ ESP32 กลางรอบ แล้วจ่ายใหม่ | session ใหม่; Verdict ของ session เก่าที่มาช้าได้ `ignored` (`wrong_session`); ไม่มีการขยับตอนบูต |
| FLT-07 | หยุด relay | HUD ไม่เห็นกล่อง แต่ Verdict/การคัดแยกไม่ถูกกระทบ; มี log |
| FLT-08 | ตัดอินเทอร์เน็ต (Supabase) | ดู DAT-05 |
| FLT-09 | หยุด ThingsBoard | ดู DAT-04 |
| FLT-10 | Pico หลุดจากเครือข่ายขณะสายพานเดิน | สายพานหยุด ≤ ~0.5 วินาที (HUD-05) |
| FLT-11 | **A/B stale:** ให้ชิ้น A หมดเวลา แล้วชิ้น B เข้ารอ Verdict จากนั้นส่ง Verdict ของ A (ทั้ง pass และ reject) ด้วย `curl` | ชิ้น B ไม่ได้รับผลของ A (`wrong_item`/`expired`); ทดสอบทั้งคู่ทิศ |
| FLT-12 | สะบัดมือ/สั่นสะเทือนที่ IR sensor ระหว่างรอบ | debounce 30 ms ทำงาน; ไม่เกิด admission ซ้อน |
| FLT-13 | เปลี่ยน prompt บน model โดยตรงระหว่างรอบ (ไม่ผ่าน n8n) | `promptMismatch` ถูกบันทึก ไม่ถูกแอบใช้ |
| FLT-14 | ส่ง threshold ที่อ่านไม่ได้ (ตั้งใน config ทดสอบ) | `invalid_threshold` → reject ไม่ใช่ pass |

**ผ่าน (ข้อเสนอ):** ทุกกรณี **ไม่มี pass ที่ผิดพลาดเลย** และกู้คืนเองภายในเวลาที่บันทึกไว้ (ผู้ปฏิบัติตั้งเป้าก่อนรัน)

### Phase 6 — เวลาแบบ end-to-end (PERF)

> **บางส่วนพักไว้ (2.4):** PERF-01 (เริ่มจากชิ้นงานตัด IR) และ PERF-05 (เวลาต่อชิ้น) พักไว้; PERF-02…04 วัดจาก n8n execution ได้

กฎ: ใช้วิดีโอ 240 fps เดียวที่เห็นทั้งชิ้นงานตัด IR และแขน servo/LED พร้อมนาฬิกาจับเวลาบนจอ; แยกเวลาย่อยจาก n8n execution (monotonic ภายใน n8n) และ `inference_ms`/`warmup_ms` ของ model ห้ามลบเวลาข้ามนาฬิกาต่างเครื่อง

| ID | วัดอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| PERF-01 | เวลาจาก "ชิ้นงานตัด IR" ถึง "แขน servo/LED เริ่มขยับ" ด้วยโมเดลจริง ≥ 30 รอบ (ต่อเงื่อนไข) | ทุกรอบจบภายใน Verdict Window 3000 ms (ด้วย verdict หรือ fallback); **รายงาน** จำนวนรอบที่ได้ Verdict จริงเทียบกับที่ตกไป timeout, p50/p95/max | วิดีโอ + ตาราง |
| PERF-02 | แบ่งเวลาย่อย: prompt (งบ 250), capture (800), model (1200), verdict POST (250) จาก execution | รายงานรายช่วง; ช่วงใดเกินงบถูกชี้ชัด | execution export |
| PERF-03 | เวลาที่ผลขึ้น HUD และ ThingsBoard หลังตัดสิน | ≤ 5 วินาที (เกณฑ์ที่มีอยู่) | วิดีโอหน้าจอ |
| PERF-04 | คำขอแรกหลัง restart ทั้ง model ×3 และ n8n ×3 | บันทึกแยกจาก warm; ไม่ถูกตัดทิ้ง | ตาราง |
| PERF-05 | Throughput: เวลาต่อชิ้นของรอบ (ผู้ปฏิบัติขึ้นอยู่ด้วย) | **บันทึกเพื่อประกอบการตัดสิน D1** ไม่เป็น gate | ตาราง |

ผลของ PERF-01/02 และ MOD-04 คือข้อมูลของการตัดสินใจ D1 (หัวข้อ 7.2): ปรับงบเวลา/Verdict Window เพื่อให้โมเดลทัน หรือเปลี่ยนโมเดล/ฮาร์ดแวร์ — การเปลี่ยนต้องปรับค่า firmware, n8n และ model service **พร้อมกัน** แล้วรัน REG กับ Phase 3–6 ซ้ำ

### Phase 7 — คุณภาพการตรวจบนชิ้นงานจริง (QLT)

เหตุที่ต้องทำ: หลักฐานเดิมใช้ภาพ MVTec ที่ย่อเป็น 448 px ไม่ใช่ชิ้นงานและแสงของโปรเจกต์ เจ้าของโปรเจกต์เคยอนุมัติ "ไม่พลาดและไม่ reject ผิดเลย" เฉพาะชุดตัวอย่างนั้น — ชุดจริงต้องอนุมัติเกณฑ์ใหม่

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| QLT-01 | เจ้าของโปรเจกต์อนุมัติ: ผลิตภัณฑ์/ความบกพร่อง/เป้าหมายที่รวมใน demo, จำนวนตัวอย่างต่อกลุ่ม (4.4), เกณฑ์ผิดพลาดที่ยอมรับ | มีบันทึกอนุมัติลงวันที่ก่อนเก็บข้อมูล | เอกสารอนุมัติ |
| QLT-02 | เก็บภาพด้วยกล้อง ความละเอียด แสง และตำแหน่งบนสายพาน **เดียวกับการใช้งานจริง** (ผ่าน `/capture`) ทุกชิ้น พร้อมเลข ID และป้ายกำกับ (ปกติ/ชนิดบกพร่อง) จากคนอย่างน้อยสองคน ถ้าไม่ตรงกันให้หารือและบันทึก | ภาพทุกใบมี Frame Context และ hash; ป้ายกำกับสองคนตรงกันหรือมีบันทึกการตัดสิน | manifest |
| QLT-03 | แบ่ง dev/held-out ตามชิ้นงานแล้วล็อก *ก่อน* ดูผลโมเดล | ไฟล์แบ่งชุดถูก hash และเก็บ | `split.json` |
| QLT-04 | ใช้ชุด dev เลือกคำอธิบาย (Inspection Target), การครอป และ Coverage Threshold ต่อเงื่อนไข (ตามวิธีใน [fixed-model spec](../specs/fixed-model-inspection-improvements.md)); ถ้าแยกไม่ได้ให้รายงานว่าแยกไม่ได้ อย่าสร้างเกณฑ์ให้ผ่าน | บันทึกการเลือกและล็อก | `selection.json` |
| QLT-05 | รันชุด held-out ครั้งเดียว ครั้งละหลายรอบตามกำหนด แล้วคำนวณ: พลาด, reject ผิด, error, และ coverage ต่อชิ้น; แยกรายงาน (a) ตำแหน่งกล่อง (IoU กับ mask ถ้ามี) (b) การตัดสินจาก coverage (c) เวลา | ตรงเกณฑ์ที่อนุมัติใน QLT-01 (ข้อเสนอ: 0 พลาด และ 0 reject ผิด บนชุดอย่างน้อย 30+30 ต่อเงื่อนไข) และรายงานช่วงความเชื่อมั่น | รายงาน + gallery |
| QLT-06 | เปรียบเทียบกับ baseline เดิม (21/21 reject ผิด; พลาด 6/24) | ตารางเปรียบเทียบ ระบุว่าที่ดีขึ้นมาจากอะไร | ตาราง |

**ถ้า QLT-05 ไม่ผ่าน** (เป็นไปได้สูงจากหลักฐานเดิม) ห้ามปรับเกณฑ์หรือเพิ่ม timeout เพื่อให้ผ่าน ให้เจ้าของโปรเจกต์เลือก (D2): (ก) ใช้ระบบเป็น **โหมดตรวจโดยคน** — โมเดลแสดงกล่องบน HUD แล้วผู้ปฏิบัติกด pass/reject ด้วยมือจาก Pico (ปุ่ม A/B ใน HUD ทำงานแล้ว แต่ต้องมี item ที่ถูก admit — ดู 2.4) โดย automatic pass ปิดอยู่ (ข) ลงทุนข้อมูล/prompt/โมเดลเพิ่มแล้วรัน QLT ซ้ำด้วยชุด held-out ชุดใหม่ (ชุด 010/011 เดิมถูกใช้แล้ว) (ค) เปลี่ยนแนวทางโมเดล (นอกขอบเขตแผนนี้ ดูภาคผนวก A.3)

### Phase 8 — ความทนทานและการ reconcile (SOAK)

> **บางส่วนพักไว้ (2.4):** SOAK-02 ต้องมีชิ้นงานถูก admit จึงพักไว้; SOAK-01 และ SOAK-03 ทำได้

| ID | ทำอะไร | เกณฑ์ผ่าน | หลักฐาน |
| --- | --- | --- | --- |
| SOAK-01 | เปิดทุกอย่างค้างไว้ 60 นาที (HUD เปิดสตรีม, watchdog ทำงาน, ยิง `inspect-now` ทุก 30 วินาที) ติดตาม: หน่วยความจำ n8n และ model service, VRAM/อุณหภูมิ GPU, CPU/อุณหภูมิ camera node, `uptime` ของ ESP32, จำนวนครั้งที่ Wi-Fi หลุด | ไม่มี service ตาย/รีสตาร์ท; หน่วยความจำไม่โตต่อเนื่อง; ESP32 ไม่ reboot; ไม่มี admission/Control Action ที่ไม่ได้สั่ง | กราฟ/log |
| SOAK-02 | วิ่งต่อเนื่อง 100 รอบ (ชิ้นอ้างอิง สลับ pass/reject; ใช้ stub หรือโมเดลจริงตามที่เลือก) | ทุกรอบสำเร็จหรือจบด้วย fallback ที่ถูกต้อง; **reconcile:** `pass_count + reject_count` ของ ESP32 = จำนวนชิ้นที่ admit = จำนวนแถว `inspection_results` ที่ผูกชิ้นงาน = ตัวนับ ThingsBoard (ผลตรวจแบบ observational นับแยก); ส่วนต่างต้องอธิบายได้ | ตาราง reconcile |
| SOAK-03 | วงจรเปิด-ปิดทั้งระบบ 3 รอบ (cold start ตามหัวข้อ 5) | ทุกรอบกลับสู่เขียวทั้งหมดโดยไม่แก้มือ (ยกเว้นขั้นตอนที่ระบุไว้) | บันทึกเวลา |

### Phase 9 — ความปลอดภัยและความเสี่ยง (SAF)

| ID | ตรวจอะไร | เกณฑ์ผ่าน |
| --- | --- | --- |
| SAF-01 | ปุ่ม/สวิตช์ตัดไฟ actuator | ตัดแล้วแขน/สายพานหยุดทันที ESP32 ไม่ทำอะไรเองตอนจ่ายไฟกลับ (CTL-11) |
| SAF-02 | ระยะปลอดภัยของแขน servo และลูกกลิ้ง/สายพาน | ไม่มีจุดหนีบมือ; มีฝาครอบหรือเครื่องหมายเตือน |
| SAF-03 | Automatic admission อยู่ใน build bench เท่านั้น | build ที่ใช้ demo/ไม่มีคนคุมต้องเป็น admission ปิด จนกว่า Phase 3 ผ่านและเจ้าของโปรเจกต์อนุมัติ (D5) |
| SAF-04 | การเปิดเผยบนเครือข่าย | endpoint ของ ESP32/HUD/relay ไม่มีการยืนยันตัวตนและ CORS เป็น `*` (README ระบุว่าใช้บน LAN ทดลองที่เชื่อถือได้) — ใช้บนเครือข่ายแยกเท่านั้น ห้ามเปิดบน Wi-Fi สาธารณะ/มหาวิทยาลัย และบันทึกว่านี่เป็นความเสี่ยงคงเหลือที่ยอมรับ |
| SAF-05 | ความลับ | ผ่าน ENV-03; ไม่มี key/credential ใน export workflow, ภาพหน้าจอ, วิดีโอ หรือ log ที่แนบหลักฐาน (หลักเดียวกับ checklist วิดีโอใน evidence ของ #22) |

### Phase M — โหมดคุมด้วยมือ + AI แสดงผล (MAN) — ข้อเสนอ รอเจ้าของโปรเจกต์อนุมัติ (D8)

ร่างเมื่อ 2026-11-21 สำหรับกรณีที่ไม่มีเซนเซอร์ IR (หัวข้อ 2.4) และเลือก D8-ค ซึ่งตรงกับ D2-ก ข้อความ ตัวเลข และเกณฑ์ในหัวข้อนี้ทั้งหมดเป็น "(ข้อเสนอ)" ตามหัวข้อ 1.3 ห้ามใช้นับผลก่อนที่เจ้าของโปรเจกต์จะอนุมัติ ผู้เขียนแผนไม่ได้ตัดสินแทน

**ระดับ M คืออะไร.** คนเป็นผู้ตัดสินว่า pass หรือ reject และสั่ง servo/สายพานเองจาก HUD ในโหมด Manual ส่วน AI ตรวจภาพที่ถูกเรียกด้วย `inspect-now` หรือ schedule trigger แล้ว *แนะนำ* ด้วยกล่องบน HUD ผลเป็นแบบ unpaired คือไม่มีการสั่งทางกายภาพจาก AI ([n8n README](../../n8n/README.md)) และ automatic admission ปิด (build ปกติ)

**ระดับ M ไม่ยืนยันอะไร.** ไม่ยืนยันว่า AI ตัดสินชิ้นงานได้ถูกต้อง (หลักฐานเดิมไม่มีเงื่อนไขใดผ่านเกณฑ์อนุมัติอัตโนมัติ) ไม่ยืนยัน throughput และไม่ยืนยันการคัดแยกอัตโนมัติ (Phase 3–4 ยัง BLOCKED) จึงไม่ใช่ระดับ B

**เงื่อนไขก่อนเริ่ม:**

1. เจ้าของโปรเจกต์อนุมัติ D8-ค และนิยามระดับ M พร้อมบันทึกวันที่
2. ESP32 ใช้ build ปกติ (`/status.automatic_admission_enabled` เป็น `false`) และผู้ปฏิบัติสลับเป็น Manual ก่อนสั่ง servo/สายพาน
3. ส่วนที่ "ยังทำได้" ในหัวข้อ 2.4 ผ่านแล้ว
4. n8n workflow ที่ต้องใช้ถูก import และ active หลังตรวจเชื่อมต่อแล้ว (N8N-xx) ทริกเกอร์ที่ใช้คือ `POST /webhook/inspect-now` โดยไม่แนบ `controller_session`/`item_id` (คำขอที่แนบ identity ของ item คือแบบ paired ตาม n8n README) หรือ schedule trigger — HUD เรียก `inspect-now` ได้เองด้วยปุ่ม **Capture & inspect** (จอ 2D) หรือปุ่ม **Y ซ้าย** (VR cinema) ผ่าน HUD server ที่ตั้ง `--n8n-origin` ถูกต้อง (HUD-08…12)

| ID | ทำอะไร | เกณฑ์ผ่าน (ข้อเสนอ) | หลักฐาน |
| --- | --- | --- | --- |
| MAN-01 | วางชิ้นงานอ้างอิง (ปกติและบกพร่อง) หน้ากล้อง แล้วกดปุ่ม Capture & inspect (2D) หรือ Y ซ้าย (XR) ×10 | HUD แสดงผลครบ 10 ครั้ง; มีแถวผลตรวจแบบ observational ใน DB ครบ 10; `/status` ของ ESP32 (`state`, `pass_count`, `reject_count`) ไม่เปลี่ยน | คลิป + `/status` ก่อน–หลัง |
| MAN-02 | ตรวจ n8n execution ของ MAN-01 | ไม่มีการเรียก `/verdict` ไป ESP32 (ดูโหนด POST ใน execution); ถ้ามีแถว Control Action ใน DB ต้องระบุว่าไม่ได้ส่งคำสั่ง (ตรวจค่าจริงแล้วบันทึก) | execution export |
| MAN-03 | **ความล้มเหลวของ AI ต้องมองเห็นได้:** (a) ฆ่า model service (b) หน่วง model เกิน 1200 ms ด้วย stub (c) ถอดกล้อง (d) หยุด `detection-relay` อย่างละ ×3 แล้วกดปุ่ม Capture & inspect | HUD แสดงสถานะที่ทำให้ผู้ปฏิบัติรู้ว่า AI ใช้ไม่ได้ และ **ไม่แสดง "AI reports no detections"**; DB/log ระบุเป็น error ไม่ใช่ผลตรวจสำเร็จ; กรณี (d) HUD แสดงสถานะ AI data ผิดปกติ | ภาพหน้าจอ HUD + execution |
| MAN-04 | **ผลหมดอายุแล้วต้องไม่ดูเหมือน "ไม่พบอะไร":** วัดเวลาที่ผู้ปฏิบัติใช้อ่านผลและตัดสินใจ ×20 ครั้ง เทียบกับ `detectionTtlMs` (ค่าเริ่มต้น 3000 ms) | ผู้ปฏิบัติตัดสินใจทันก่อนผลหมดอายุ ≥ 19/20 ครั้ง *หรือ* มีค่า TTL/แนวทางอื่นที่เจ้าของโปรเจกต์อนุมัติและผ่าน HUD-03 (กล่องเก่าไม่ค้างทับชิ้นงานใหม่) | วิดีโอ + ตารางเวลา |
| MAN-05 | ถ้า HUD แสดง "Human review required · controller reject · …" ให้ผู้ปฏิบัติ 3 คนอธิบายว่าเกิดอะไรขึ้นทางกายภาพ | ทั้ง 3 คนตอบได้ว่าระบบไม่ได้สั่ง servo/สายพาน ถ้าตอบผิดให้ลง defect log (ถ้อยคำ "controller reject" ทำให้เข้าใจผิด ไม่แก้ในแผนนี้) | บันทึกคำตอบ + defect log |
| MAN-06 | ชิ้นงานอ้างอิง ×20 รอบ: ดันสายพานด้วยก้านซ้าย (Manual) จนชิ้นงานหยุดในภาพ → กดปุ่ม Capture & inspect → ผู้ปฏิบัติเลือก pass (ปล่อยต่อ) หรือ reject (เขี่ยออกด้วย servo จากก้านขวาหรือปุ่ม squeeze) | ทุกครั้งที่ผู้ปฏิบัติเลือก reject ชิ้นงานถูกเขี่ยออกจริง (วิดีโอ 240 fps ตัวอย่าง); ไม่มีรอบที่ต้องแก้มือ; บันทึกเวลาต่อรอบ (ไม่เป็น gate) | คลิป + ตาราง |
| MAN-07 | ไม่เคลื่อนไหวเอง: ปล่อย ESP32 ในโหมด Auto 30 นาที ขณะมีชิ้นงานบนสายพานหรือหน้า servo แล้วสลับ Manual → Auto → Manual | ไม่มีการเคลื่อนไหวของ servo/สายพานเองทั้งช่วง; `/status` ไม่เปลี่ยน (`state: idle`, counters คงเดิม) | คลิป + `/status` |
| MAN-08 | กดปุ่ม Capture & inspect 50 ครั้ง (รวมกรณีล้มเหลวจาก MAN-03) แล้วเทียบจำนวน | จำนวนที่ยิง = แถว observational ใน Supabase = จำนวนที่ ThingsBoard แสดง (observational นับแยกตาม DAT-xx) หรือส่วนต่างอธิบายได้ | ตาราง reconcile |
| MAN-09 | ผู้ปฏิบัติใหม่ 2 คนที่ไม่เคยใช้ ทำตามคู่มือหนึ่งหน้า (เริ่ม/หยุด/ปุ่มตัดไฟ/สิ่งที่ HUD แสดงเมื่อ AI ใช้ไม่ได้/ผล QLT-05 ตามจริง) | ทั้ง 2 คนทำครบโดยไม่ต้องถาม และอธิบายได้ว่า AI เป็นผู้ช่วยไม่ใช่ผู้ตัดสิน | คู่มือ + บันทึกการทดสอบ |

**ข้อสังเกตเกี่ยวกับ MAN-03 และ MAN-04 ก่อนแก้ HUD** (ตรวจเมื่อ 2026-11-21 ด้วยฟังก์ชันจริงของ repo ใน Node: decision → policy → HUD payload → `parseDetectionPayload` แล้วใช้กฎสรุปข้อความที่คัดลอกจาก `app.js`; ผลหลังแก้เมื่อ 2026-11-22 อยู่ในย่อหน้า "แก้แล้ว" ถัดลงไป):

- ค่าเริ่มต้นใน `n8n/lib/workflow-definitions.mjs` คือ `const inspectionPolicy = null` ทำให้ `applyInspectionPolicy` คืนผลเดิมโดยไม่มี `reviewRequired` ส่วน `pico-webapp/js/app.js` แสดง "AI reports no detections" เมื่อไม่มี `reviewRequired` และไม่มีกล่อง ผลล้มเหลวที่สร้างจาก `rejected()` มี `detections: []` ผลที่ตรวจ: model timeout, model unreachable และกล้อง capture ล้มเหลว ได้ `status: reject` พร้อม `reason` แต่ไม่มี `reviewRequired` จึงขึ้นข้อความเดียวกับตอนที่โมเดลประเมินสำเร็จและไม่พบข้อบกพร่อง ("AI reports no detections") MAN-03 จึงจะ **FAIL** ใน config ปริยาย
- ทางที่ต้องทดสอบ: ตั้ง `inspectionPolicy` เป็น `{"version":1,"enabled":true,"rules":[]}` ใน `n8n/runtime.local.json` แล้วรัน `node configure.mjs` (`configure.mjs` ตรวจว่าเป็น version 1, enabled และ rules เป็น array) ผลที่ตรวจ: ทุกผลเป็น `reviewRequired` และ HUD แสดง "Human review required · controller reject · model suggestion: …" โดยผลล้มเหลวแสดง `unavailable` ส่วนผลที่โมเดลประเมินสำเร็จแสดง `pass` หรือ `reject` จึงแยกความล้มเหลวออกจากผลประเมินได้ แต่ถ้อยคำ "controller reject" ยังอยู่ (MAN-05) การเปลี่ยนนี้ต้องให้เจ้าของโปรเจกต์ตัดสินและรัน REG ซ้ำ
- หลัง `detectionTtlMs` (3000 ms) HUD ล้างกล่องและตั้งข้อความเป็น "No recent detections" ซึ่งเป็นข้อความเดียวกันไม่ว่าผลจะหมดอายุ ไม่พบอะไร หรือไม่มีผลเข้ามา (เช่น n8n หยุด) แยกกันไม่ได้หลัง 3 วินาที นี่คือเหตุที่ MAN-04 เป็นข้อปลอดภัย ไม่ใช่แค่ความสะดวก

**แก้แล้ว (2026-11-22):** HUD (`pico-webapp/js/overlay.js` และ `app.js`) ถือว่า `reason` ที่ไม่ใช่ `defect_detected`, `no_defect_detected` หรือ `manual_review_required` (หรือ `status: error`) คือการตรวจล้มเหลว: ข้อความสรุปเป็น `AI unavailable · <reason> · <เวลา>` ไฟสถานะ AI เป็นสีแดง และข้อความค้างจนกว่าจะมีผลใหม่ (ไม่ถูกล้างเป็น "No recent detections" ตาม TTL) ผลปกติยังหมดอายุตาม `detectionTtlMs` เหมือนเดิม ตรวจแล้วบน 2D HUD จริงในเบราว์เซอร์ ผ่าน relay จริงและ n8n จำลอง ได้ผลตามนี้ทั้งกรณีไม่มี policy และกรณี `reviewRequired` แต่ **ยังไม่ได้ตรวจใน VR cinema บนแว่น และยังไม่ได้ตรวจกับ n8n จริง** จึงให้ MAN-03 และ HUD-11 ยืนยันซ้ำ การตั้ง `inspectionPolicy` ในข้อก่อนหน้าไม่จำเป็นอีกสำหรับเรื่องนี้ (ใช้เฉพาะเมื่อต้องการให้ทุกผลเป็น "ต้องให้คนตรวจ") และถ้อยคำ "controller reject" ในข้อความ review ยังเหมือนเดิม (MAN-05)

**เกณฑ์ผ่านของระดับ M (ข้อเสนอ):** Phase 0–1 ผ่าน; ส่วนของ Phase 2 ที่ทำได้ (2.4) ผ่านทั้งหมด; MAN-01…09 ผ่าน โดย **MAN-03 ต้องผ่านก่อนให้ผู้ปฏิบัติใช้ AI ประกอบการตัดสิน**; SOAK-01, SOAK-03 และ SAF ผ่าน (SAF-03 ผ่านโดยปริยายเพราะ admission ปิด); QLT-01…05 ทำและ **รายงานผลตามจริง** (ไม่ต้องผ่านเกณฑ์อนุมัติอัตโนมัติ เพราะไม่มี automatic pass) พร้อมระบุข้อจำกัดในคู่มือผู้ปฏิบัติ; ไม่มีข้อใดเป็น UNVERIFIED

**ต้องให้เจ้าของโปรเจกต์ตัดสินก่อนใช้ระดับ M:** (1) อนุมัติ D8-ค และนิยามข้างต้น (2) จะตั้ง `inspectionPolicy` แบบ rules ว่างหรือไม่ (3) ทางออกของปัญหา TTL ใน MAN-04 (4) ใครเป็นผู้ปฏิบัติและฝึกอย่างไร

---

## 7. เกณฑ์ผ่านรวมและการตัดสินใจ

### 7.1 นิยามคำว่า "สมบูรณ์" (ข้อเสนอ)

| ระดับ | ความหมาย | เงื่อนไข |
| --- | --- | --- |
| **A — ระบบครบวงจรใช้งาน/สาธิตได้** | โซ่ทั้งสายทำงานและปลอดภัยแบบ fail closed | Phase 1, 2, 4a, 5, 8, 9 ผ่านทั้งหมด; Phase 3 ผ่าน *หรือ* ถูกบันทึกว่า BLOCKED พร้อมจำกัดการสาธิตเป็น bench ที่มีคนคุม; Phase 7 ผ่าน *หรือ* เจ้าของโปรเจกต์เลือกโหมดตรวจโดยคน (D2-ก) พร้อมบันทึกว่าไม่มี automatic pass |
| **B — อนุมัติให้คัดแยกอัตโนมัติ** | ระบบตัดสิน pass/reject เองได้ | ระดับ A + Phase 3 ผ่านเต็ม + Phase 7 ผ่านเกณฑ์ที่อนุมัติ + Phase 6 ผ่านงบเวลาที่เจ้าของโปรเจกต์ตัดสิน (D1) + อนุมัติ D5 |
| **M — ระบบคุมด้วยมือ + AI แสดงผล** (ข้อเสนอ รอ D8) | คนตัดสินและสั่ง servo/สายพานเอง AI เป็นผู้แนะนำบน HUD ไม่มีการคัดแยกอัตโนมัติ | Phase 0–1 ผ่าน; Phase 2 เฉพาะส่วนที่ทำได้ (2.4) ผ่าน; MAN-01…09 ผ่าน; SOAK-01/03 และ SAF ผ่าน; QLT-01…05 รายงานตามจริง (ไม่ต้องผ่านเกณฑ์อัตโนมัติ) — รายละเอียดใน Phase M |

> **หมายเหตุ (2.4):** เงื่อนไขของระดับ A มี Phase 4a ซึ่งต้องใช้เซนเซอร์ IR ที่ตอนนี้ไม่ใช้ จึงทำให้ครบตามนิยามนี้ไม่ได้จนกว่าจะตัดสิน D8 ทางที่เป็นไปได้คือระดับ M ในตารางด้านบน (ร่างไว้ใน Phase M ตรงกับ D2-ก) แต่ต้องให้เจ้าของโปรเจกต์อนุมัติ ไม่ใช่ผู้เขียนแผนกำหนดเอง

### 7.2 บันทึกการตัดสินใจ (Decision log)

| รหัส | เรื่อง | ตัวเลือก | ข้อมูลที่ต้องมีก่อนตัดสิน | ผู้ตัดสิน | สถานะ |
| --- | --- | --- | --- | --- | --- |
| D1 | งบเวลา | (ก) เร่งโมเดล/ฮาร์ดแวร์ให้ทันงบเดิม (ข) ปรับ Verdict Window + งบ n8n + deadline model *พร้อมกัน* โดยอาศัยการที่สายพานกักชิ้นงานอยู่แล้ว (ค) เปลี่ยนแนวโมเดล | MOD-04, PERF-01/02, HOLD-02/05, ความต้องการ throughput | เจ้าของโปรเจกต์ | เปิด |
| D2 | แนวทางคุณภาพ | (ก) โหมดตรวจโดยคน (ข) ลงทุนข้อมูล/prompt เพิ่ม (ค) เปลี่ยนโมเดล | QLT-05/06 | เจ้าของโปรเจกต์ | เปิด |
| D3 | Camera node | Pi หรือ UNO Q | CAM-xx ของทั้งสองตัว + UNOQ-xx | ทีม | **ตัดสินแล้ว: ใช้ Pi** (ผู้ใช้แจ้งในแชต 2026-11-21 ควรยืนยันกับทีมอีกครั้ง); ไม่ต้องทำ UNOQ-xx |
| D4 | ที่รัน AI | PC GPU (ปัจจุบัน) หรืออื่น | MOD-xx; ภาคผนวก A.2 | เจ้าของโปรเจกต์ | แนะนำคง PC GPU |
| D5 | เปิด admission ใน build ที่ใช้จริง | เปิด/ปิด | HOLD-xx ครบ + FLT ผ่าน | เจ้าของโปรเจกต์ | เปิด |
| D6 | เครือข่ายของการ demo | hotspot หรือ router เฉพาะ (router ที่ไม่มีอินเทอร์เน็ตทำให้ VR cinema โหลด A-Frame ไม่ได้ เว้นแต่ฝัง A-Frame ไว้ใน repo ก่อน) | ENV-02, ENV-06 | ทีม | เปิด |
| D7 | กล้องหลายตัว/หลายชนิด (USB + CSI) | (ก) สลับชนิดต่อเครื่อง (ข) สองสตรีมคนละพอร์ตบน Pi เดียว (ค) ใช้สองมุมในรอบตรวจเดียว | ผล CAM-03/QLT ต่อกล้อง, งบเวลา (D1), การออกแบบ workflow และ Frame Context | เจ้าของโปรเจกต์ | เปิด (อนาคต — ผู้ใช้แจ้ง 2026-11-21 ว่าอาจใช้ทั้งคู่; ดู [pi-camera-node-setup.md](pi-camera-node-setup.md) หัวข้อ 12) |
| D8 | ตัวตรวจจับชิ้นงานและนิยามคำว่า "สมบูรณ์" เมื่อไม่มี IR/buzzer/relay | (ก) ต่อเซนเซอร์ IR กลับและใช้แผนเดิม (ข) ใช้ตัวตรวจจับอื่น (ต้องแก้ firmware ซึ่งผู้ใช้ไม่ต้องการแตะตอนนี้) (ค) ใช้เป็นระบบคุมด้วยมือ + AI แสดงกล่องบน HUD โดยคนตัดสินและสั่ง servo เอง (ตรงกับ D2-ก; ร่างเป็นระดับ M ใน Phase M) | ผลของ D2 (ผู้ใช้ยืนยันแล้ว 2026-11-21 ว่าไม่ใช้เซนเซอร์ IR ทั้งตัว) | เจ้าของโปรเจกต์ | เปิด (ผู้ใช้แจ้ง 2026-11-21 ว่าไม่ใช้ buzzer/IR/relay และไม่ต้องแก้ firmware) |
| D9 | โหมด AR passthrough ของ HUD | (ก) ตัดโหมดนี้ออกจาก HUD (โค้ด ปุ่ม CSS เทสต์ เอกสาร) (ข) เก็บไว้แต่ซ่อนปุ่มและไม่รับรอง (ค) แก้ให้วาด HUD ลง WebGL ใน `immersive-ar` แทน DOM Overlay | ผลสืบสวน 2026-11-22: โค้ดบังคับ `dom-overlay` ซึ่งเบราว์เซอร์แว่นส่วนใหญ่ไม่มี (ทำซ้ำใน emulator ได้) ยังไม่ได้ลองบน Pico ถ้าต้องการหลักฐาน ให้ดูข้อความแดงที่ HUD ขึ้นเมื่อกดปุ่ม AR บนแว่น | ทีม | เปิด (กลุ่มกำลังหารือจะตัด ผู้ใช้แจ้ง 2026-11-23; ณ วันนั้นโค้ดยังมี AR ใน `main` และ PR #40) แผนนี้ใช้ VR cinema เป็นโหมดเดียวบนแว่นไม่ว่าผลเป็นอย่างไร |

---

## 8. การเก็บหลักฐานและรายงาน

- โฟลเดอร์ใหม่ตามแบบของ repo: `docs/evidence/full-system-<yyyy-mm-dd>/` (ห้ามเขียนทับหลักฐานเดิม)
- ในโฟลเดอร์: `run-manifest.json` (ENV-01), `results.csv` (แบบฟอร์ม C.1), `videos/`, `logs/`, `n8n-executions/` (export ที่ลบความลับแล้ว), `screens/`, `README.md` สรุป verdict ต่อ gate (PASS/FAIL/BLOCKED/DEFERRED/UNVERIFIED)
- ทุกการทดสอบที่ล้มต้องมีรายการ defect (C.2) พร้อมขั้นตอนทำซ้ำ และไม่ถูกแทนด้วยการรันใหม่ที่ไม่รายงาน
- ผลที่ไม่มีหลักฐานแนบ = UNVERIFIED
- รายงานสุดท้ายแยกสถานะอิสระ: **ซอฟต์แวร์ / เวลาโมเดล / คุณภาพโมเดล / ฮาร์ดแวร์-ฟิสิคัล / ความปลอดภัย** เพื่อไม่ให้ผลส่วนหนึ่งถูกอ้างเป็นความสำเร็จทั้งระบบ

---

## ภาคผนวก A — Arduino UNO Q กับโปรเจกต์นี้

### A.1 ข้อมูลที่ตรวจได้

| หัวข้อ | ข้อมูล | แหล่ง / ระดับความมั่นใจ |
| --- | --- | --- |
| MPU | Qualcomm Dragonwing QRB2210 — Cortex-A53 สี่คอร์ 2.0 GHz, Adreno GPU; หน้า docs ไม่ระบุ NPU | [docs.arduino.cc/hardware/uno-q](https://docs.arduino.cc/hardware/uno-q/) — อ่านจากหน้าจริง |
| MCU | STM32U585 Cortex-M33 สูงสุด 160 MHz, flash 2 MB, SRAM 786 kB; รัน sketch บน Zephyr | หน้าเดียวกัน |
| ระบบปฏิบัติการ | Debian Linux เต็มรูปแบบบน MPU; MPU กับ MCU สื่อสารผ่าน Arduino Bridge (RPC) | หน้าเดียวกัน (ไม่ระบุเวอร์ชัน Debian) |
| RAM / eMMC | 2 GB + 16 GB (ABX00162) หรือ 4 GB + 32 GB (ABX00173) | [datasheet](https://docs.arduino.cc/resources/datasheets/ABX00162-ABX00173-datasheet.pdf), [CNX Software](https://www.cnx-software.com/2026/01/21/arduino-uno-q-4gb-board-with-4gb-ram-32gb-storage-available-59/) — ผลจากการค้นหา ยังไม่ได้เปิดอ่านตัว datasheet |
| พอร์ต | USB-C; docs ระบุว่าต่อกล้อง USB, Ethernet, คีย์บอร์ด ฯลฯ ได้ผ่าน USB-C dongle ที่มี external power delivery (จำนวนพอร์ตบนบอร์ดให้ยืนยันกับบอร์ดจริง) | หน้า docs |
| กล้อง | MIPI-CSI ใช้ผ่านขั้วต่อความเร็วสูงด้านล่างของบอร์ดกับ carrier (หน้า docs ไม่ได้ระบุช่องกล้องบนบอร์ดโดยตรง) — ทางปฏิบัติที่ docs แสดงคือกล้อง USB | หน้า docs |
| ไร้สาย | Wi-Fi 5 dual-band + Bluetooth 5.1 | หน้า docs |
| เวลา boot | รีวิวหนึ่งรายงาน 34.6 วินาทีจากจ่ายไฟ | [Tom's Hardware](https://www.tomshardware.com/raspberry-pi/arduino-uno-q-review) — เห็นจากผลค้นหา **เปิดอ่านบทความเต็มไม่สำเร็จ** ถือเป็นค่าประมาณและให้วัดเอง (UNOQ-02) |
| ยังไม่ทราบ (ต้องตรวจบนบอร์ดจริง) | เวอร์ชัน Debian, การ SSH/ADB, การติดตั้ง Python/pip/OpenCV, การรัน systemd service ถาวรโดยไม่เปิด App Lab, กระแสไฟรวมของ USB-C hub + กล้อง | — |

### A.2 รัน LocateAnything บน UNO Q ได้หรือไม่

| ประเด็น | โปรเจกต์ (วัดจริง) | UNO Q |
| --- | --- | --- |
| ขนาดโมเดล | q8 ≈ 6.26 GB ก่อนรวม graph/cache | RAM รวม 2 หรือ 4 GB ที่ต้องแบ่งกับระบบปฏิบัติการ — **โหลดไม่ได้** |
| ความเร็วที่วัดได้ | GPU RTX 3060: p50 ≈ 1.1 s, VRAM ≈ 5033 MiB; CPU i5-11400H: p50 ≈ 23 s | ไม่มี CUDA; CPU A53 2.0 GHz ช้ากว่า CPU ที่วัดไว้อีกหลายเท่า (ไม่ได้วัดเอง) |
| งบเวลา | 1.1 s ต่อคำขอ ภายใน Verdict Window 3 s | ห่างจากงบหลายระดับขนาด |

**สรุป: ไม่ได้ ไม่ว่าจะ quantize ต่ำลงหรือไม่** เพราะปัญหาคือขนาดและความเร็ว ไม่ใช่ความสะดวกในการติดตั้ง

### A.3 ถ้าอยากใช้ AI บนบอร์ดจริง (แผนสำรอง ไม่รวมในรอบหลัก)

UNO Q รันโมเดลเล็กคลาสตายตัวได้ (Arduino App Lab มี "bricks" และ Edge Impulse) — รายงานของชุมชนอยู่ที่ราว 10–17 FPS ขึ้นกับโมเดลและ pipeline (ไม่ใช่ตัวเลขทางการ; เช่น [Foundries.io](https://foundries.io/insights/blog/elf-detector-real-time-object-detection)) แต่ต้อง: (1) มีภาพติดป้ายกำกับของชิ้นงานจริง (2) เทรนใหม่ทุกครั้งที่เปลี่ยนชนิดความบกพร่อง (3) ยอมเสีย "เปลี่ยน Inspection Target ด้วยข้อความ" ซึ่งเป็นจุดขายของโปรเจกต์ — เป็นงานแยกที่ต้องมีเกณฑ์คุณภาพของตัวเอง ตามที่ [ticket 06](../../.scratch/locate-anything-n8n/issues/06-runtime-evidence-and-handoff.md) บันทึกไว้

### A.4 ชุดทดสอบ qualify UNO Q เป็น camera node (UNOQ)

> D3 ตัดสินแล้วว่าใช้ Pi (2026-11-21) — ชุดนี้เก็บไว้เผื่อเปิดเรื่อง UNO Q อีกครั้ง ไม่ต้องทำในรอบนี้

ใช้เกณฑ์เดียวกับ Pi เพื่อเทียบกันตรงๆ และ **ใช้ผลของ Pi (CAM-xx) เป็น baseline ในเครื่องเดียวกัน กล้องตัวเดียวกัน**

| ID | ทำอะไร | เกณฑ์ผ่าน (ไม่แย่กว่า Pi) |
| --- | --- | --- |
| UNOQ-01 | ตั้งค่าครั้งแรก: ต่อ Wi-Fi, SSH/ADB, ติดตั้ง Python 3.10+ และ `raspberry-pi-streaming/requirements.txt` (รวม `opencv-python-headless`), ตั้ง `systemd` service ให้ขึ้นเองโดยไม่ต้องเปิด App Lab | ทำได้ครบ จับเวลาตั้งค่าทั้งหมดและเก็บขั้นตอนทำซ้ำได้ |
| UNOQ-02 | จับเวลาจากจ่ายไฟถึง `/health` = 200 ×5 รอบ | เทียบกับ Pi (CAM-07); บันทึกค่า (ไม่มีเกณฑ์ตายตัว) |
| UNOQ-03 | ต่อกล้อง USB ผ่าน hub ที่จ่ายไฟ; ตรวจ `/dev/video0`, `CAMERA_SOURCE=0` | ได้ภาพ; ความละเอียดจริงตรงกับที่ใช้ใน CAM-03 |
| UNOQ-04 | CAM-01…CAM-06 ครบชุด | ผ่านเท่า Pi |
| UNOQ-05 | CAM-04 (`/capture` ภายใน container n8n ×100) ที่ความละเอียดที่ใช้จริงและที่ 1920×1080 ถ้ากล้องรองรับ | max < 800 ms และ p95 ≤ 400 ms เมื่อเข้ารหัส JPEG คุณภาพ 95 บน A53 |
| UNOQ-06 | CPU/RAM/อุณหภูมิ 30 นาที (เหมือน CAM-11) พร้อม 3 viewer | ไม่ throttle; RAM เหลือ; ไม่มีเฟรมหลุด > 3 วินาที |
| UNOQ-07 | ถอด/เสียบกล้อง, ตัด Wi-Fi, ตัดไฟ (CAM-06/07/08) | พฤติกรรมเทียบเท่า |
| UNOQ-08 | พลังงาน: วัดกระแสรวม (บอร์ด + กล้อง) กับ hub ที่ใช้ | อยู่ในพิกัดของ hub/อะแดปเตอร์ ไม่ brown-out ขณะ boot |
| UNOQ-09 | ความเสถียรหลังอัปเดต/รีบูต 10 รอบ และการโคลนระบบ (ทำเครื่องที่สองให้เหมือนกันได้เร็วแค่ไหน) | service ขึ้นทุกรอบ; มีวิธี backup/restore ที่ใช้ได้ |
| UNOQ-10 | เครือข่าย: docs แสดงว่า Ethernet ต่อผ่าน USB-C dongle — ทดสอบความเสถียร Wi-Fi 60 นาที ที่ตำแหน่งติดตั้งจริง (และ Ethernet ผ่าน dongle ถ้าจะใช้) | ไม่มีการหลุดที่ทำให้ `/health` เป็น 503 นานเกิน 3 วินาที |

**กฎตัดสิน D3:** เลือก UNO Q เมื่อผ่านทุกข้อและไม่แย่กว่า Pi ในข้อใด; ถ้าไม่ ให้คง Pi — ไม่มีข้อได้เปรียบด้านการ boot/ตั้งค่าที่ต้องนำมาถ่วง เพราะไม่ใช่ข้อเด่นของ UNO Q (A.1)

**ข้อสังเกตเพิ่ม:** MCU ของ UNO Q (STM32U585) *ไม่ใช่ตัวแทนของ ESP32* ในโปรเจกต์นี้ เพราะ firmware ปัจจุบันมีตรรกะ Verdict Window, identity, watchdog และ HTTP server บน ESP32 ซึ่งผ่านการทดสอบมาแล้ว การย้ายคือการเขียนและพิสูจน์สัญญาเดิมทั้งหมดใหม่ ไม่ควรทำก่อนระบบหลักผ่าน

---

## ภาคผนวก B — คำสั่งที่ใช้ซ้ำ (PowerShell 7)

ตั้งค่าตัวแปรก่อน (แก้ IP ให้ตรงแผน 4.3):

```powershell
$env:CN360_CAMERA_HOST = '172.20.10.6'   # camera node
$env:CN360_ESP32_HOST  = '172.20.10.5'   # ESP32
$env:CN360_PC_HOST     = '172.20.10.2'   # PC (ที่ ESP32/HUD/Pico มองเห็น)
```

### B.1 Preflight — ตรวจ health ทุกบริการ

```powershell
$targets = [ordered]@{
  'model-service'      = 'http://127.0.0.1:8000/health'
  'n8n'                = 'http://127.0.0.1:5678/healthz'
  'relay'              = 'http://127.0.0.1:8081/health'
  'thingsboard-bridge' = 'http://127.0.0.1:8106/health'
  'hud-server'         = 'http://127.0.0.1:8080/'
  'camera-node'        = "http://$($env:CN360_CAMERA_HOST):8000/health"
  'esp32'              = "http://$($env:CN360_ESP32_HOST)/health"
}
foreach ($name in $targets.Keys) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $targets[$name] -TimeoutSec 3 -SkipHttpErrorCheck
    $state = if ($r.StatusCode -eq 200) { 'OK  ' } else { 'FAIL' }
    '{0} {1,-20} HTTP {2} {3} ms' -f $state, $name, $r.StatusCode, $sw.ElapsedMilliseconds
  } catch {
    '{0} {1,-20} {2}' -f 'FAIL', $name, $_.Exception.Message
  }
}
```

### B.2 วัด RTT (ใช้กับ CTL-09 และ CAM-04 แบบไม่ผ่าน container)

```powershell
function Measure-Rtt {
  param([string]$Url, [int]$Count = 100, [int]$DelayMs = 100)
  $samples = foreach ($i in 1..$Count) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
      $null = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -SkipHttpErrorCheck
      $sw.Elapsed.TotalMilliseconds
    } catch {
      [double]::PositiveInfinity   # นับเป็นความล้มเหลว ไม่ตัดทิ้ง
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  $ok = @($samples | Where-Object { [double]::IsFinite($_) } | Sort-Object)
  $pick = { param($p) if ($ok.Count) { [math]::Round($ok[[int][math]::Floor(($ok.Count - 1) * $p)], 1) } }
  [pscustomobject]@{
    Url = $Url; Count = $Count; Failed = $Count - $ok.Count
    P50 = & $pick 0.50; P95 = & $pick 0.95; Max = & $pick 1.0
  }
}
Measure-Rtt -Url "http://$($env:CN360_ESP32_HOST)/status"
```

สำหรับ CAM-04 ให้รันจากใน container n8n เพื่อวัดเส้นทางจริง เช่น `docker exec <ชื่อ container n8n> wget -qO /dev/null -S http://<camera-ip>:8000/capture` ซ้ำ 100 ครั้ง (ชื่อ container ดูจาก `docker ps`)

### B.3 ควบคุม ESP32 และสายพาน

```powershell
$esp = "http://$($env:CN360_ESP32_HOST)"
function Invoke-Esp {
  param([string]$Method, [string]$Path, $Body = $null)
  $p = @{ Uri = "$esp$Path"; Method = $Method; TimeoutSec = 3; SkipHttpErrorCheck = $true; ContentType = 'application/json' }
  if ($Body -is [string]) { $p.Body = $Body }
  elseif ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Compress) }
  $r = Invoke-WebRequest @p
  $json = $null
  try { $json = $r.Content | ConvertFrom-Json } catch { }
  [pscustomobject]@{ Http = [int]$r.StatusCode; Body = $json; Raw = $r.Content }
}

# โหมดและ servo
Invoke-Esp POST '/mode'  @{ mode = 'manual' }
Invoke-Esp POST '/servo' @{ angle = 90 }
Invoke-Esp POST '/servo' @{ angle = 0 }
Invoke-Esp POST '/servo' @{ sweep = $true }
Invoke-Esp GET  '/status'

# สายพาน: ขอ lease -> ส่ง neutral ก่อน -> ส่งทิศซ้ำทุก 200 ms -> หยุดส่ง (สายพานต้องหยุด ~0.5 วินาที)
function Start-ConveyorTest {
  param([int]$Direction = 1, [double]$Seconds = 3, [int]$IntervalMs = 200)
  $lease   = (Invoke-Esp GET '/conveyor/lease').Body
  $session = $lease.controller_session
  $seq     = [uint32]$lease.conveyor_sequence
  $token   = $lease.lease
  $seq++
  $r = Invoke-Esp POST '/conveyor' @{ direction = 0; sequence = $seq; lease = $token; controller_session = $session }
  if (-not $r.Body.accepted) { Write-Warning "neutral ไม่ถูกรับ: $($r.Raw)"; return }
  $token = $r.Body.lease
  $end = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $end) {
    $seq++
    $r = Invoke-Esp POST '/conveyor' @{ direction = $Direction; sequence = $seq; lease = $token; controller_session = $session }
    if (-not $r.Body.accepted) { Write-Warning "ไม่ถูกรับ: $($r.Raw)"; break }
    $token = $r.Body.lease
    Start-Sleep -Milliseconds $IntervalMs
  }
  'หยุดส่งคำสั่งเมื่อ {0}' -f (Get-Date -Format 'HH:mm:ss.fff')
}
Start-ConveyorTest -Direction 1 -Seconds 3
```

ตัวอย่างกรณีปฏิเสธ (CTL-07): หลังขอ lease ให้รอ > 2 วินาทีแล้วส่งคำสั่ง → ต้องได้ `accepted: false`; ส่งซ้ำด้วย `sequence` เดิม → `accepted: false`; ใส่ `controller_session` ผิด → `accepted: false`

### B.4 สัญญา `/verdict` (CTL-08)

```powershell
Invoke-Esp POST '/verdict' '{bad json'                                                     # คาด 400
Invoke-Esp POST '/verdict' @{ action = 'pass' }                                            # คาด 400 (ไม่มี identity)
Invoke-Esp POST '/verdict' @{ action = 'pass'; controller_session = 'x'; item_id = '1' }   # คาด 200, accepted=false
Invoke-Esp POST '/reject'  @{ action = 'reject' }                                          # คาด 400 item_identity_required
```

Verdict จริงระหว่าง Phase 3/4a: อ่าน `/status` ตอน `state = awaiting_verdict` แล้วส่ง `@{ action='reject'; controller_session=<จาก status>; item_id=<จาก status> }` ภายใน 3000 ms

### B.5 n8n และ model

```powershell
# เปลี่ยน Inspection Target (HUD ส่งแบบเดียวกัน)
Invoke-RestMethod -Method Post -Uri "http://$($env:CN360_PC_HOST):5678/webhook/detection-prompt" `
  -ContentType 'application/json' -Body '{"prompt":"scratch"}'

# item-detected ปลอม (รูปแบบเดียวกับที่ firmware ส่ง) — identity ปลอม ต้องถูก ESP32 ปฏิเสธ (N8N-05)
Invoke-RestMethod -Method Post -Uri "http://$($env:CN360_PC_HOST):5678/webhook/item-detected" `
  -ContentType 'application/json' `
  -Body '{"event":"item_detected","controller_session":"test-session","item_id":"test-1","verdict_window_ms":3000}'
```

```powershell
# model service โดยตรง (ต้องมีไฟล์ frame.jpg)
curl.exe -s http://127.0.0.1:8000/health
curl.exe -s -F "file=@frame.jpg" -F "prompt=Locate all the instances that matches the following description: scratch." http://127.0.0.1:8000/predict
```

เครื่องมือวัดและทดสอบของ repo ที่ควรใช้ซ้ำแทนการเขียนใหม่: `model-service/scripts/benchmark.py`, `model-service/scripts/measure_item_readiness.py`, `n8n/scripts/model-inspection-run.py`, `n8n/scripts/fixed-model-experiment.mjs`, `thingsboard/scripts/validate-native.mjs`

---

## ภาคผนวก C — แบบฟอร์ม

### C.1 `results.csv` (หนึ่งแถวต่อการทดสอบหนึ่งครั้ง)

```csv
run_id,test_id,date,tester,git_sha,firmware_build,result,measured,evidence_path,notes
```

`result` ใช้เฉพาะ PASS / FAIL / BLOCKED / DEFERRED / UNVERIFIED; `measured` ใส่ตัวเลขจริง (เช่น `p95=312ms n=100`) ไม่ใส่คำว่า "ปกติ"

### C.2 บันทึก defect

| ฟิลด์ | ตัวอย่าง |
| --- | --- |
| ID | DEF-001 |
| พบใน test | HOLD-05 |
| ความรุนแรง | Blocker (pass ผิด/ทำร้ายคน/ข้ามตัวป้องกัน) / Major / Minor |
| ขั้นตอนทำซ้ำ | … |
| ผลที่ได้ / ผลที่คาด | … |
| หลักฐาน | path ของคลิป/log |
| สถานะ | เปิด / แก้แล้วรอรันซ้ำ / ปิดพร้อมหลักฐานรันซ้ำ |

Blocker ใดๆ ที่เปิดอยู่ ทำให้ gate ที่เกี่ยวข้องเป็น FAIL และห้ามเปิด admission ใน build ที่ใช้ demo
