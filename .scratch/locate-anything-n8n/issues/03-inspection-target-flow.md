# 03: เปลี่ยน Inspection Target ผ่าน webhook แล้วโมเดลใช้คำสั่งตรงกัน

**What to build:** ผู้ใช้ส่ง Inspection Target แบบเดียวกับที่ Pico ส่งผ่าน n8n แล้ว global prompt ของโมเดลเปลี่ยนเป็น Model Instruction มาตรฐาน การตรวจภาพครั้งถัดไปใช้คำสั่งนั้นและตรวจ echo ได้ ข้อความว่างหรือการเปลี่ยน prompt ที่ไม่สำเร็จไม่ถูกแจ้งว่าอัปเดตสำเร็จ

**Blocked by:** 01 — ตรวจภาพผ่าน Model API และแยกข้อผิดพลาดจากผลว่าง.

**Status:** implemented — physical Pico/database acceptance separate

- [x] ตรวจ runtime envelope ของ Webhook request จริง และอ่าน Inspection Target จาก body ที่ถูกต้อง ไม่อาศัยเฉพาะ fixture ที่วาง prompt ไว้ระดับบนสุด
- [x] ใช้ canonical Model Instruction template เดิมและปฏิเสธ blank/whitespace input โดยไม่เปลี่ยน global prompt ที่ใช้งานอยู่
- [x] เรียก prompt update และ readback กับ Model API ได้จาก n8n runtime ที่ใช้งานจริง; การอัปเดตล้มเหลวหรือบริการเข้าไม่ถึงไม่ตอบ success ให้ผู้เรียก
- [x] หลัง update สำเร็จ การส่งภาพตรวจผ่าน public API ด้วย instruction ที่ resolve จาก global prompt ให้ `prompt_used` ตรงกัน โดย global prompt ยังเป็น runtime source of truth
- [x] ตรวจคำสั่งที่เปลี่ยนระหว่าง Inspection และ prompt echo mismatch ตาม policy เดิม พร้อมบันทึกความต่าง ไม่แอบนำ Inspection Target ใหม่ไปใช้กับภาพที่เริ่มด้วย instruction เก่า
- [x] มี regression ผ่าน public prompt webhook → model boundary สำหรับ valid target, blank target, body envelope, model error และ echo behavior โดยใช้ harness เดิมเป็นหลัก
- [x] มีหลักฐาน prompt update/readback กับบริการจริง โดยแยกผลที่ใช้ payload แบบ HUD ออกจากการทดสอบบนอุปกรณ์ Pico จริง ไม่บังคับให้มี hardware หรือ relay ก่อนตรวจรับ contract นี้
- [x] รักษาสัญญา Prompt History เดิมและระบุชัดเมื่อใช้ database fixture; งานนี้ไม่เพิ่ม schema หรือรับรอง persistence ที่ยังไม่ได้เชื่อมจริง


**Implementation evidence:** ผ่าน body.prompt, update/blank/error ทั้ง regression และ n8n runtime; update/readback กับ model server จริงจาก n8n container ผ่าน หลักฐานนี้ไม่ใช่ physical Pico หรือ Supabase จริง
