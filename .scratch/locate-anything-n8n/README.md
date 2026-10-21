# Local LocateAnything + n8n tickets

Ticket จาก [สเปก](../../docs/specs/local-model-n8n-defect-output.md) ลงวันที่ 2026-10-20 เก็บเป็น local files ตามคำขอผู้ใช้ ไม่มีการสร้าง แก้ไข หรือปิด issue บน GitHub

แนวทางผลลัพธ์ที่ผู้ใช้เห็นด้วยและให้ปรับ ticket: คง LocateAnything และ Detection geometry สำหรับ Pico ให้แสดงผลสุดท้ายเป็น `pass` / `reject` / `error` และเพิ่มความเร็วด้วย resident inference ก่อนประเมิน CUDA/quantization หากผลวัดยังไม่ทัน deadline จึงเสนอ small classifier เป็นงานแยก โดยระบุข้อมูลฝึกและข้อจำกัดเรื่อง text prompt

ผู้ใช้ให้ลงมือ implement แล้ว สถานะแต่ละใบและ checkbox ระบุงานที่ทำได้พร้อมหลักฐาน โดยแยก `implemented` ออกจาก `partial` และการตรวจรับอุปกรณ์จริงที่ยังค้าง ไม่ถือว่าการผ่าน fixtures เป็นการตรวจรับสายคัดแยกอัตโนมัติ

เลข 01–06 เป็นหมายเลข local เท่านั้น ไม่ใช่เลข GitHub issue สรุปผลและข้อจำกัดอยู่ใน [implementation evidence](../../docs/evidence/locate-anything-local-2026-10-20.md)

อัปเดตสถานะล่าสุด: **2026-10-20 (Asia/Bangkok)** จากหลักฐานที่เก็บแล้ว ไม่ได้รันทดสอบใหม่ในการอัปเดตเอกสารครั้งนี้

| Ticket | สถานะ | งานที่ผ่านแล้ว | งานค้าง / ขอบเขตการตรวจรับ |
| --- | --- | --- | --- |
| [01](issues/01-reliable-model-api.md) | implemented | Model API/native bridge; โมเดลจริงบน CPU/CUDA แยกผลปกติ ผลว่าง และ error ได้ | เสร็จตามขอบเขต Model API; การตรวจรับทั้งระบบอยู่ 06 |
| [02](issues/02-compact-inspection-result.md) | implemented | n8n webhook/fixtures คืน pass/reject/error ถูกต้อง; ติดต่อ model จริงจาก n8n container ได้ | ยังไม่ได้ตรวจ capture/คำสั่งกับ Pi และ ESP32 จริง; real-model deadline ยังไม่ผ่าน |
| [03](issues/03-inspection-target-flow.md) | implemented | prompt webhook, blank/error และ model update/readback ผ่าน | physical Pico, relay และ Supabase persistence ยังไม่ได้ตรวจรับ |
| [04](issues/04-resident-inference.md) | implemented | reuse โมเดล, readiness, bounded concurrency และหยุด worker หลัง timeout; native CPU/CUDA regression ผ่าน | เสร็จตามขอบเขต resident service; ไม่รับรอง production deadline |
| [05](issues/05-gpu-and-model-evaluation.md) | implemented | q8 บน CUDA0; resident p50 1.114 s, p95 1.268 s, max 1.285 s; sampled VRAM สูงสุด 5033 MiB | ประเมิน GPU เสร็จ; ยังไม่ผ่าน deadline และยังไม่มี accuracy acceptance ของภาพ defect จริง; ไม่เปลี่ยน quantization |
| [06](issues/06-runtime-evidence-and-handoff.md) | partial | คู่มือ, CPU/CUDA benchmark, fixture workflows และ direct-model probe จาก n8n จริง | ค้าง real Pi/ESP32/Pico/DB/relay, execution ทั้งเส้นทางและ latency จนรับ Verdict; automatic sorting ยังไม่ผ่าน |

สรุป: **implemented 5 ใบ (01–05), partial 1 ใบ (06)** โดย `implemented` หมายถึงเสร็จตามขอบเขตงานในใบนั้น การตรวจรับอุปกรณ์จริงที่ระบุค้างยังไม่ผ่าน และไม่ถือว่าปิด GitHub #23/#24/#25

หลักฐานล่าสุด: [CUDA evaluation](../../docs/evidence/locate-anything-cuda-2026-10-20.md), [n8n → CUDA probe](../../docs/evidence/n8n-cuda-probe-2026-10-20.json), [native CUDA regression](../../docs/evidence/native-cuda-boundary-2026-10-20.json) การทดสอบ Python ล่าสุดผ่าน 8 รายการพร้อม strict mypy; n8n suite ที่บันทึกไว้ผ่าน 191 รายการ

งานถัดไปใน 06 คือเติม configuration ของบริการจริง ตรวจ manual Inspection/item event/prompt update พร้อม Frame Context และวัดเวลาจน ESP32 รับ Verdict ส่วน #24 ยังต้องแก้ auto-pass หลัง 3000 ms และ late-verdict/item correlation ก่อนรับรอง automatic sorting

| Ticket | สิ่งที่ส่งมอบ | Blocked by |
| --- | --- | --- |
| [01 — Model API ที่แยก error จากผลว่าง](issues/01-reliable-model-api.md) | อัปโหลดภาพตรวจได้จากบริการที่ตั้งค่าซ้ำได้ พร้อม explicit engine outcome | ไม่มี |
| [02 — ผล pass/reject/error ผ่าน n8n](issues/02-compact-inspection-result.md) | เส้น manual Inspection → capture → model → compact response/Control Action โดยแยก error จาก successful reject | 01 |
| [03 — Inspection Target ผ่าน webhook](issues/03-inspection-target-flow.md) | เปลี่ยนเป้าหมายแล้วโมเดลใช้ Model Instruction และ echo ตรงกัน | 01 |
| [04 — Resident inference](issues/04-resident-inference.md) | ตรวจภาพต่อเนื่องโดย reuse โมเดล พร้อม readiness และ bounded concurrency | 01 |
| [05 — CUDA และ model evaluation](issues/05-gpu-and-model-evaluation.md) | เลือก configuration จากความเร็ว หน่วยความจำ และคุณภาพที่วัดจริง | 04 |
| [06 — Runtime evidence และ handoff](issues/06-runtime-evidence-and-handoff.md) | ตรวจบริการจริง เก็บเวลาและหลักฐาน พร้อมสถานะ deadline/ความพร้อม | 02, 03, 05 |

## วิธีเดินงาน

ลำดับพัฒนาเดิมเริ่ม 01 แล้วจึง 02, 03, 04 และ 05 ปัจจุบัน prerequisites ฝั่ง implementation ของ 06 เสร็จแล้ว และเริ่มเก็บหลักฐานใน 06 แล้ว งานที่ค้างคือ runtime configuration, การตรวจรับอุปกรณ์จริง และ end-to-end timing ไม่ต้องรอปิด #24 ก่อนบันทึกผลวัด แต่ต้องรอแก้ #24 และผ่าน deadline ก่อนอนุมัติ automatic sorting

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
