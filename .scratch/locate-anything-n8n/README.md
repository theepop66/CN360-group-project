# Local LocateAnything + n8n tickets

Ticket จาก [สเปก](../../docs/specs/local-model-n8n-defect-output.md) ลงวันที่ 2026-10-20 เก็บเป็น local files ตามคำขอผู้ใช้ ไม่มีการสร้าง แก้ไข หรือปิด issue บน GitHub

แนวทางผลลัพธ์ที่ผู้ใช้เห็นด้วยและให้ปรับ ticket: คง LocateAnything และ Detection geometry สำหรับ Pico ให้แสดงผลสุดท้ายเป็น `pass` / `reject` / `error` และเพิ่มความเร็วด้วย resident inference ก่อนประเมิน CUDA/quantization หากผลวัดยังไม่ทัน deadline จึงเสนอ small classifier เป็นงานแยก โดยระบุข้อมูลฝึกและข้อจำกัดเรื่อง text prompt

ผู้ใช้ให้ลงมือ implement แล้ว สถานะแต่ละใบและ checkbox ระบุงานที่ทำได้พร้อมหลักฐาน โดยแยก `implemented` ออกจาก `partial` และการตรวจรับอุปกรณ์จริงที่ยังค้าง ไม่ถือว่าการผ่าน fixtures เป็นการตรวจรับสายคัดแยกอัตโนมัติ

เลข 01–06 เป็นหมายเลข local เท่านั้น ไม่ใช่เลข GitHub issue สรุปผลและข้อจำกัดอยู่ใน [implementation evidence](../../docs/evidence/locate-anything-local-2026-10-20.md)

| Ticket | สถานะ implementation |
| --- | --- |
| 01 | Model API/native bridge และ real-model smoke ทำงานแล้ว |
| 02 | โค้ดและ fixture/runtime contract ผ่าน; real Pi/ESP32 deployment ยังค้าง |
| 03 | Prompt contract และ real-model readback ผ่าน; physical Pico/DB แยกตรวจรับ |
| 04 | Resident inference และ timeout isolation ทำงานแล้ว |
| 05 | CPU benchmark ผ่าน; CUDA Toolkit ไม่มี จึงยังไม่ผ่าน GPU evaluation |
| 06 | มี fixture/direct-model evidence; real devices และ automatic sorting ยังไม่ผ่าน |

| Ticket | สิ่งที่ส่งมอบ | Blocked by |
| --- | --- | --- |
| [01 — Model API ที่แยก error จากผลว่าง](issues/01-reliable-model-api.md) | อัปโหลดภาพตรวจได้จากบริการที่ตั้งค่าซ้ำได้ พร้อม explicit engine outcome | ไม่มี |
| [02 — ผล pass/reject/error ผ่าน n8n](issues/02-compact-inspection-result.md) | เส้น manual Inspection → capture → model → compact response/Control Action โดยแยก error จาก successful reject | 01 |
| [03 — Inspection Target ผ่าน webhook](issues/03-inspection-target-flow.md) | เปลี่ยนเป้าหมายแล้วโมเดลใช้ Model Instruction และ echo ตรงกัน | 01 |
| [04 — Resident inference](issues/04-resident-inference.md) | ตรวจภาพต่อเนื่องโดย reuse โมเดล พร้อม readiness และ bounded concurrency | 01 |
| [05 — CUDA และ model evaluation](issues/05-gpu-and-model-evaluation.md) | เลือก configuration จากความเร็ว หน่วยความจำ และคุณภาพที่วัดจริง | 04 |
| [06 — Runtime evidence และ handoff](issues/06-runtime-evidence-and-handoff.md) | ตรวจบริการจริง เก็บเวลาและหลักฐาน พร้อมสถานะ deadline/ความพร้อม | 02, 03, 05 |

## วิธีเดินงาน

เริ่ม 01 ก่อน จากนั้น 02, 03 และ 04 ไม่มี blocking edge ระหว่างกัน เมื่อ 04 เสร็จจึงทำ 05 และเริ่ม 06 ได้เมื่อ 02, 03, 05 เสร็จทั้งหมด การไม่มี blocking edge ไม่ได้หมายความว่าต้องแก้ checkout เดียวกันพร้อมกันโดยไม่ประสานงาน

01 รวมงานเตรียม engine outcome เท่าที่จำเป็นให้เส้นอัปโหลดภาพใช้งานได้จริง ไม่แยก refactor กว้างที่ตรวจรับด้วยตัวเองไม่ได้ 02 ตรวจ happy path แบบ deterministic ด้วย HTTP fixtures ได้ก่อนที่ความเร็วโมเดลจริงจะพร้อม โดย real deadline acceptance อยู่ในการสรุปผลของ 06

## ความหมายของผลสุดท้าย

- `pass`: ประเมินสำเร็จและ Defect Coverage ต่ำกว่า Coverage Threshold จึงยังพบกรอบขนาดเล็กได้
- `reject`: ประเมินสำเร็จและ Defect Coverage เท่ากับหรือสูงกว่า Coverage Threshold
- `error`: ประเมินไม่ได้หรือ configuration/budget ไม่ถูกต้อง ผู้เรียกเห็น error พร้อมสาเหตุ ขณะที่ workflow ยังคงส่ง forced reject ให้ ESP32 ตาม policy เดิม ไม่เพิ่ม actuator action ชื่อ error

การเปลี่ยนชื่อผลลัพธ์ไม่ได้ลดงาน inference โดยตัวมันเอง กรอบและ diagnostics ยังอยู่ในระบบเพื่อ overlay และตรวจสอบปัญหา ส่วน label สุดท้ายแสดงเพียงสามค่านี้

## ความสัมพันธ์กับงานเดิม

- [GitHub #23](https://github.com/theepop66/CN360-group-project/issues/23): งานชุดนี้สนับสนุน model/prompt/runtime integration แต่ไม่แทนข้อกำหนด credentials, CORS, persistence และ runtime อื่นทั้งหมด
- [GitHub #24](https://github.com/theepop66/CN360-group-project/issues/24): เป็น dependency ก่อนอนุมัติ automatic sorting ไม่ใช่ blocker ของการเขียนรายงานใน 06 หากรอ #24 ก่อนวัด latency จะทำให้ handoff ติดวงรอโดยไม่จำเป็น
- [GitHub #25](https://github.com/theepop66/CN360-group-project/issues/25): ยังต้องตรวจรับทั้งระบบและฮาร์ดแวร์จริง การผ่าน fixture หรือ model API ไม่ปิดงานนี้

## ขอบเขตการทดสอบ

จุดทดสอบหลักใช้ public n8n webhook → Model HTTP contract → compact response/Control Action และมี supporting checks ที่ public Model HTTP boundary สำหรับ engine lifecycle/error/concurrency แยกหลักฐานจากบริการจำลอง โมเดลจริง และอุปกรณ์จริงเสมอ
