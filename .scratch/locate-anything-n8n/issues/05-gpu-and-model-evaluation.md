# 05: ทดลอง CUDA และเลือกการตั้งค่าที่เหมาะกับ VRAM 6 GB

**What to build:** หลังมี resident inference แล้ว ผู้ดูแลเลือกการตั้งค่า LocateAnything สำหรับ RTX 3060 Laptop GPU จากผลตรวจภาพจริง ทั้งความเร็ว หน่วยความจำ และคุณภาพ แทนการถือว่าการเปิด CUDA หรือใช้ quantization ที่เล็กลงจะให้ผลดีโดยอัตโนมัติ หาก GPU ไม่รองรับ working set ต้องมีข้อสรุปและทางเลือก CPU ที่ระบุชัด โดยรักษา text prompt และกรอบสำหรับ Pico

**Blocked by:** 04 — ตรวจหลายภาพด้วยโมเดลที่โหลดค้างไว้และรอคิวแบบมีขอบเขต.

**Status:** implemented — q8 CUDA0 evaluated on RTX 3060; production deadline not accepted

- [x] มีวิธี build/ตั้งค่า CUDA ที่ทำซ้ำได้ และทดสอบผ่าน resident Model HTTP API ได้ ไม่อาศัยเพียง flag ตอน build เป็นหลักฐานว่าใช้งาน GPU แล้ว
- [x] รายงาน backend ที่เลือกจริง พร้อม hardware, available/peak memory ตามที่วัดได้, model variant, decode mode, image dimensions, instructions และ warmup
- [x] ประเมิน q8 โดยรวม memory ขณะ inference ไม่ใช่เทียบแค่ขนาด weight file กับ VRAM 6 GiB; OOM หรือ CPU fallback ไม่ถูกซ่อนหรือรายงานเป็น GPU success
- [x] หากต้องทดสอบ quantization ที่เล็กลง ให้ใช้ชุดภาพและ instruction เดียวกับ baseline ครอบคลุมภาพปกติและ defect ที่เกี่ยวข้อง พร้อมเกณฑ์เทียบ Detection/coverage/Verdict ที่บันทึกก่อนสรุปเลือก variant
- [x] ไม่เปลี่ยน default model หรือ generation mode เพียงเพราะเร็วกว่าโดยไม่รายงานผลต่อคุณภาพ; หากไม่มี candidate ผ่านให้ระบุข้อจำกัดและรักษา configuration ที่ตรวจสอบได้
- [x] เก็บผล repeated requests ผ่าน API เป็น p50, p95, maximum, sample count, failures และ memory behavior เทียบ CPU/resident baseline ด้วยนิยามเวลาเดียวกัน
- [x] ส่งมอบ configuration ที่แนะนำจากหลักฐาน หรือข้อสรุปว่าข้อจำกัด GPU ยังแก้ไม่ได้พร้อม CPU fallback ที่ชัดเจน งานนี้ไม่รับรองว่าโมเดลตอบภายใน 1200 ms โดยไม่มีผลวัด
- [x] public API, ผลสุดท้าย `pass` / `reject` / `error` และ failure semantics เดิมยังคงอยู่ ไม่เปลี่ยนเกณฑ์ Coverage Threshold หรือเพิ่ม confidence filtering เพื่อให้ benchmark ดูดีขึ้น


**Implementation evidence:** ติดตั้ง CUDA 12.6.3 และ MSVC 19.38 แบบ local บน D แล้ว build CUDA/CLI สำเร็จ รุ่น q8 เดิมผ่าน CUDA0 ทั้ง 3 CLI และ 3 resident requests; resident p50 1114.317 ms, p95 1268.038 ms, max 1285.119 ms เทียบ CPU p50 22971 ms (ประมาณ 20.6 เท่า) พบ sampled peak GPU-wide VRAM 5033 MiB โดยไม่พบ OOM หรือ CPU fallback ในรอบนี้ กรอบทั้ง 4 ตรงกับ CPU และ coverage/verdict เดิม; ไม่เปลี่ยน quantization จึงไม่มี candidate ใหม่ที่ต้องตรวจรับคุณภาพ และไม่อ้างว่าตรวจ accuracy บนภาพ defect จริงแล้ว Native GPU regression ผ่าน และ n8n container ติดต่อ CUDA service ได้ แต่คำขอแรกยัง timeout ภายใต้ deadline 1.1 s จึงไม่อนุมัติ automatic sorting และไม่เปลี่ยน budget เดิม ดู docs/evidence/locate-anything-cuda-2026-10-20.md และ JSON ที่อ้างถึง
