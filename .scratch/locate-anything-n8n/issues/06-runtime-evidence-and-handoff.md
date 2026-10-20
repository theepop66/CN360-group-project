# 06: ตรวจบริการจริงครบเส้นทางและสรุปเวลาเพื่อส่งต่องาน deadline

**What to build:** ผู้ดูแลทำตามคู่มือเพื่อใช้ n8n, Pi และ resident LocateAnything จริงกับภาพเดียวกัน ตรวจผล `pass` / `reject` / `error` และคำสั่ง Verdict พร้อมเห็นผลวัดเวลาทั้งเส้นทางและข้อจำกัดที่เหลือได้อย่างชัดเจน ส่งหลักฐานให้ #23 และ #24 ประเมินต่อ หากความเร็วไม่พอให้มีข้อมูลตัดสินใจเรื่องโมเดลทางเลือกในงานถัดไป โดยไม่สรุปว่าการเชื่อมโมเดลเท่ากับผ่านการคัดแยกอัตโนมัติทั้งระบบ

**Blocked by:** 02 — ตรวจภาพผ่าน n8n และรับผล pass/reject/error; 03 — เปลี่ยน Inspection Target ผ่าน webhook แล้วโมเดลใช้คำสั่งตรงกัน; 05 — ทดลอง CUDA และเลือกการตั้งค่าที่เหมาะกับ VRAM 6 GB.

**Status:** partial — fixture and direct-model evidence collected; real devices pending

- [ ] มีคู่มือเริ่มบริการและตั้ง n8n สำหรับ deployment ที่พบจริง แยก loopback/Docker host/LAN และ test/production webhook URLs พร้อม configuration ที่จำเป็นโดยไม่เผย secrets
- [ ] จาก n8n runtime จริงเข้าถึง capture, prediction, prompt และ health ได้ และ workflow ที่ใช้ทดสอบไม่มี active placeholders ที่ยังชี้ไปบริการสมมติ
- [ ] เก็บ execution evidence สำหรับ manual Inspection, item event และ prompt update/readback โดยยืนยัน captured bytes, Frame Context, Model Instruction และ prompt echo ที่สอดคล้องกัน
- [x] ตรวจ successful `pass`, successful `reject` และ `error` จาก model/capture failure โดยกรณี error ยังส่ง internal forced reject; หาก budget จริงยังไม่รองรับ successful real-model Inspection ให้บันทึก deadline failure อย่างตรงไปตรงมา ระบุ success path ที่ใช้ fixtures แยกต่างหาก และไม่ลงนามผ่านการใช้งานอัตโนมัติ
- [x] ในการทดสอบที่ใช้ ESP32 จริง เก็บ HTTP acceptance/ignored/error response และใช้ controlled bench conditions; หากใช้ actuator stub ให้ระบุชัดและไม่อ้างผล physical sorting
- [ ] วัด startup แยกจาก warm Inspection และรายงาน queue, capture, image handling, inference, network/processing และเวลาจน ESP32 รับ Verdict เท่าที่ runtime ให้ข้อมูล พร้อม p50/p95/max, sample count และ failures
- [x] เทียบ configuration ที่เลือกกับ baseline ด้วยชุดภาพ/instruction และวิธีวัดที่บันทึกไว้ แยก optional annotation cost หากมีการเปรียบเทียบ CLI แบบสร้างภาพ ไม่อ้างว่า compact JSON เพียงอย่างเดียวทำให้ inference เร็วขึ้น
- [x] ตรวจ model budget เดิม 1200 ms และ Verdict Window เดิม 3000 ms เทียบเวลาจริงรวม overhead; ไม่เพิ่ม timeout ข้าม budget guard และไม่อาศัยเพียงผลรวม timeout เพื่อรับรอง deadline
- [x] สรุปเป็นอย่างน้อยว่า connectivity ผ่านหรือไม่, ผล compact output ผ่านหรือไม่, deadline ผ่านหรือไม่ และ deployment configuration ที่ใช้ เพื่อให้ข้อจำกัดด้าน performance ไม่ถูกซ่อนในผล smoke test
- [x] หากหลังใช้ resident inference และประเมิน CUDA/quantization แล้วยังไม่ทัน deadline ให้บันทึกข้อเสนอแยกสำหรับทดลอง small image classifier พร้อมความต้องการภาพติดป้ายกำกับ เกณฑ์คุณภาพ และผลต่อความสามารถเปลี่ยน Inspection Target ด้วย prompt; งานชุดนี้ไม่ฝึกหรือเปลี่ยนโมเดลเอง
- [x] การอนุมัติ automatic sorting ยังถูกกั้นจน #24 แก้ firmware fallback/late Verdict และมีหลักฐาน deadline ตามที่ deploy จริง การตรวจรับ ticket นี้เป็นรายงานผลและ handoff จึงไม่ต้องรอ #24 ให้เสร็จก่อนเริ่ม
- [x] ระบุความพร้อมของ database, relay, HUD และ physical sorting แยกจาก model connectivity; ไม่เพิ่ม schema/relay หรือปิด #23/#24/#25 จากหลักฐานที่ครอบคลุมเพียงบางส่วน
- [x] มี automated regression ที่ primary webhook boundary ครบสัญญาที่แก้ไข และแยกผล automated fixture, real-service execution และ hardware evidence ไว้ให้ตรวจย้อนหลังได้


**Implementation evidence:** เก็บ CPU baseline/resident, fixture workflow executions และ real-model HTTP จาก n8n container แล้ว; real Pi/ESP32/DB/relay และ automatic sorting ยังไม่ผ่านการตรวจรับ งาน #24/#25 ยังคงเป็น dependency
