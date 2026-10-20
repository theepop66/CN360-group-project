# 02: ตรวจภาพผ่าน n8n และรับผล pass/reject/error

**What to build:** ผู้ใช้เรียก manual Inspection ผ่าน webhook เดิมของ n8n แล้วระบบดึงภาพจาก Pi ส่งไปยัง LocateAnything และแสดงผลสุดท้ายเป็น `pass`, `reject` หรือ `error` โดยสองค่าแรกเป็นผลตรวจที่สำเร็จตาม Coverage Threshold ส่วน `error` หมายถึงประเมินไม่ได้ เก็บ Detection ไว้สำหรับ Pico และข้อมูลภายใน พร้อมส่ง Verdict ตามสัญญาเดิมไปยังขอบเขต ESP32

**Blocked by:** 01 — ตรวจภาพผ่าน Model API และแยกข้อผิดพลาดจากผลว่าง.

**Status:** implemented — real Pi/ESP32 deployment acceptance pending

- [x] ตรวจวิธีรัน n8n จริงว่าอยู่บน Windows โดยตรงหรือ Docker แล้วกำหนด model base URL ที่เข้าถึงได้จาก runtime นั้น ไม่อนุมานจากการเปิดหน้า editor บน localhost
- [x] Model URLs รวม prediction, prompt และ health ใช้ scheme และ host ที่ตรงกับบริการจริง; แบบ local ปัจจุบันใช้ HTTP และไม่ใช้ bind address เป็นปลายทาง
- [x] ใช้ ingestion หลักแบบ n8n pull capture จาก Pi เพียงทางเดียวในงานนี้ และส่ง multipart ชื่อ `file` ให้ API ได้ โดยไม่สับสนกับ binary property ภายใน n8n ที่ชื่อ `image`
- [x] ทดสอบจาก webhook ถึงขอบเขตโมเดลได้ว่า bytes ของภาพ, Model Instruction และ Frame Context เป็นของ Inspection เดียวกัน โดยรักษา session, sequence, captured time และ geometry
- [x] manual Inspection ที่ประเมินสำเร็จตอบ status `success` และ result: coverage ต่ำกว่า threshold เป็น `pass`; เท่ากับหรือสูงกว่า threshold เป็น `reject`; ESP32 ยังคงรับ Verdict `pass`/`reject` ตามสัญญาเดิม
- [x] ใช้ Defect Coverage และ threshold เดิม ค่าเริ่มต้น 0.005 ไม่เปลี่ยนเป็น reject เมื่อพบกรอบใดก็ได้ และไม่ใช้ confidence เป็น signal
- [x] timeout, unreachable model, HTTP error, malformed output/boxes, capture failure, invalid dimensions, invalid threshold และ invalid budget ตอบ status `error` และ result `error` พร้อม machine-readable reason โดยยังส่ง forced reject ตาม workflow policy; ไม่เพิ่ม ESP32 action ชื่อ `error`
- [x] forced reject จาก error ไม่แสดงเป็น successful `reject` หรือ `pass`; valid Detection ที่ต่ำกว่า threshold ยังให้ `pass` ได้และไม่ถูกซ่อนจากข้อมูลภายใน คำว่า `pass` จึงหมายถึงผ่านเกณฑ์ ไม่ใช่ไม่มี Detection
- [x] ผู้ใช้เห็น final result label เพียง `pass` / `reject` / `error` ส่วน caller/logs ยังเข้าถึง diagnostic status/reason ได้; response ไม่สร้างภาพ annotated และไม่เพิ่ม classification API แยก คง Detection, Frame Context และข้อมูลที่ Inspection Result/HUD contract ใช้อยู่ โดยไม่ออกแบบหน้าจอ Pico ใหม่
- [x] ขยาย harness ของ generated workflows และ Inspection outcome เดิมให้ตรวจ empty/below/equal/above threshold และ failure ผ่านขอบเขต webhook → response/Control Action; ยืนยัน successful `pass`/`reject` แยกจาก external `error` ที่ส่ง internal reject และ artifacts ที่ส่งมอบตรงกับ workflow definitions
- [x] มี happy-path execution ด้วย controlled HTTP fixtures และทดสอบการเชื่อมโมเดลจริงจาก n8n runtime แยกกันชัดเจน หากโมเดลจริงยังช้ากว่า budget ให้เก็บ error evidence แทนการเพิ่ม timeout ข้าม guard; ความเร็วจริงตรวจรับรวมใน 06
- [x] dependencies ภายนอก เช่น database/relay ใช้ fixture ใน regression ได้โดยติดป้ายชัดเจน ไม่อ้างว่าการผ่าน fixture พิสูจน์ persistence หรือ HUD delivery จริง และเก็บ runtime configuration/credentials ออกจาก shared exports


**Implementation evidence:** ผ่าน automated contract tests และ HTTP fixtures ใน n8n จริง; การเชื่อมโมเดลจาก n8n container จริงผ่าน แต่ CPU ไม่ทัน budget ยังไม่ได้ใช้ Pi/ESP32 จริง
