# 04: ตรวจหลายภาพด้วยโมเดลที่โหลดค้างไว้และรอคิวแบบมีขอบเขต

**What to build:** ผู้ใช้เปิดบริการครั้งเดียวแล้วตรวจภาพต่อเนื่องได้โดยใช้ LocateAnything เดิมในหน่วยความจำ ไม่ต้องเปิด CLI และโหลด weights ใหม่ทุกภาพ พร้อมสถานะ readiness ที่เชื่อถือได้ และจัดการคำขอซ้อนโดยไม่รัน engine context พร้อมกันหรือปล่อยงานรอไม่สิ้นสุด นี่เป็นการเพิ่มความเร็วลำดับแรก โดยยังเปลี่ยน Inspection Target ด้วยข้อความและคืนกรอบสำหรับ Pico ได้

**Blocked by:** 01 — ตรวจภาพผ่าน Model API และแยกข้อผิดพลาดจากผลว่าง.

**Status:** implemented

**Updated:** 2026-10-20 (Asia/Bangkok)

**Acceptance scope:** โมเดลจริง reuse context ผ่าน HTTP ได้ทั้ง CPU/CUDA; positive → empty → empty → native error ยังแยกผลถูกต้อง และ timeout ทำให้ worker ไม่พร้อมใช้งานต่อ การทดสอบ Python ล่าสุดผ่าน 8 รายการพร้อม strict mypy

**Remaining:** ไม่มีงานค้างในขอบเขต resident lifecycle ใบนี้; CUDA resident p50 1.114 s แต่ first prediction 1.285 s และ n8n deadline probe ยัง timeout จึงส่งต่อ production timing ไป 06/#24

**Evidence:** [CPU comparison](../../../docs/evidence/locate-anything-cpu-2026-10-20.json), [CUDA comparison](../../../docs/evidence/locate-anything-cuda-q8-2026-10-20.json), [CUDA lifecycle/error regression](../../../docs/evidence/native-cuda-boundary-2026-10-20.json), [timeout/readiness probe](../../../docs/evidence/n8n-cuda-probe-2026-10-20.json)

- [x] ใช้ engine context ที่โหลดเมื่อเริ่มบริการผ่าน library interface หรือ persistent worker ที่เทียบเท่า และ reuse สำหรับภาพถัดไป ไม่มีการเปิด inference CLI หรือโหลด weights ต่อ Inspection
- [x] คง public prediction/prompt contract และ explicit engine-failure semantics จาก 01 เพื่อให้ผู้เรียกเดิมใช้งานต่อได้
- [x] ไม่เปลี่ยนโมเดลเป็น classifier หรือบังคับให้ LocateAnything ตอบคำตัดสินโดยตรง; n8n ยังคำนวณผล `pass` / `reject` / `error` จากผลตรวจและ failure ตามสัญญาเดิม
- [x] health/readiness ไม่รายงานว่าพร้อมตรวจภาพจน initialization สำเร็จ และ initialization/inference failure มีผลที่สังเกตได้จาก HTTP ไม่ใช่เพียง log ภายใน
- [x] serialize การใช้ shared engine context ที่ไม่ reentrant และกำหนดขอบเขตเวลารอหรือปฏิเสธคำขอเกินกำลังอย่างชัดเจน โดย queue time รวมอยู่ใน request deadline
- [x] client timeout ไม่ทำให้เริ่มงานใหม่ทับ context ที่ยังคำนวณอยู่ และคำขอที่หมดอายุไม่กลับมาเป็นผลสำเร็จที่นำไปสั่งงานภายหลัง
- [x] ปิดบริการและเปิดใหม่ได้โดยคืนทรัพยากรโมเดลตาม lifecycle ไม่ต้องรีสตาร์ตเครื่อง และไม่มี process หรือ temporary artifacts ค้างจากคำขอที่ยกเลิก
- [x] ตรวจภาพต่างกันและ instruction ต่างกันต่อเนื่องแล้วผลไม่ปนกัน; valid empty detection ยังแยกจาก failure ได้หลัง reuse context
- [x] มีการตรวจผ่าน public HTTP boundary สำหรับ startup failure, repeated requests, genuine inference failure, concurrent requests, deadline expiry และ restart โดยไม่ใช้ private call-count assertions เป็นหลักฐานเพียงอย่างเดียว
- [x] เก็บเวลาของ resident service เทียบ baseline เดิมบนชุดภาพ/instruction/model/mode เดียวกัน แยก cold start, warm request และ queue time พร้อม sample count และ failures; ไม่ตั้งเป้าความเร็วที่ยังไม่มีผลวัดรองรับ


**Implementation evidence:** โมเดลจริง reuse ต่อเนื่อง 3 ภาพสำเร็จ p50 ประมาณ 22.971 วินาที เทียบ CLI 38.173 วินาที; real deadline probe คืน 504 และ worker ไม่ถูกนำกลับมาใช้หลัง timeout เพิ่ม native HTTP regression จริงที่ตรวจภาพมีกรอบแล้วตามด้วยผลว่างสำเร็จสองครั้งบน context เดิม และ RLE8 BMP ที่ล้มเหลวใน native decoder ให้ error ไม่ใช่ผลว่าง แก้การรองรับ empty-box grammar ของโมเดลแล้ว
