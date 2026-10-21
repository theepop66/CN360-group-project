# 01: ตรวจภาพผ่าน Model API และแยกข้อผิดพลาดจากผลว่าง

**What to build:** ผู้ดูแลเปิด Model API จากซอร์สและวิธีตั้งค่าที่เก็บร่วมกับโปรเจกต์ แล้วอัปโหลดภาพเพื่อตรวจด้วย LocateAnything ในเครื่องได้ โดยแยก “ประมวลผลสำเร็จแต่ไม่พบ Detection” ออกจาก “engine ทำงานไม่สำเร็จ” ได้ชัดเจน นี่เป็นงานเตรียมจุดเชื่อม engine ก่อนนำผลไปตัดสิน Verdict หรือเปลี่ยนเป็น resident service

**Blocked by:** None (can start immediately).

**Status:** implemented

**Updated:** 2026-10-20 (Asia/Bangkok)

**Acceptance scope:** Model API/native bridge ผ่านทั้ง CPU และ CUDA กับโมเดลจริง รวมผลมีกรอบ ผลว่างสำเร็จ และ native decode error; ไม่สร้าง annotated result image

**Remaining:** ไม่มีงานค้างในขอบเขต adapter ใบนี้; real-device integration และ production deadline ตรวจรับใน 06

**Evidence:** [implementation summary](../../../docs/evidence/locate-anything-local-2026-10-20.md), [real native CPU](../../../docs/evidence/native-model-boundary-2026-10-20.json), [real native CUDA](../../../docs/evidence/native-cuda-boundary-2026-10-20.json)

- [x] มีซอร์ส adapter และวิธีติดตั้ง/ตั้งค่า/เปิดบริการที่ทำซ้ำได้จากโปรเจกต์ โดยอ้างอิงโมเดลและ executable/library ที่ติดตั้งแยกผ่าน configuration ไม่รวม weights หรือ build outputs ไว้ใน repository
- [x] ผู้ดูแลทดสอบ POST `/predict` ด้วย multipart ช่อง `file` และ `prompt` ผ่าน HTTP ได้จริง ผลสำเร็จคง `status`, `prompt_used` และ Detection geometry แบบพิกัด pixel ของภาพที่อัปโหลด
- [x] คง endpoint สำหรับอ่านและเปลี่ยน global prompt เพื่อให้ workflow เดิมเรียกต่อได้
- [x] รูปหาย รูปเสีย โหลดโมเดลไม่ได้ และ inference ล้มเหลวให้ผล error ที่ระบุสาเหตุ ไม่กลายเป็นผลสำเร็จที่มี Detection ว่าง และไม่ถูกนำไปสรุปเป็น successful `pass`; ขอบเขตโมเดลส่ง failure ให้ n8n สรุปเป็น `error` และ forced reject ได้
- [x] แก้ช่องทางรายงานผลจาก engine ที่จำเป็นให้แยก failure จาก valid empty output ได้จริง การตรวจเพียง process exit code หรือข้อความ error ที่อาจไม่ถูกตั้งยังไม่ถือว่าผ่าน
- [x] เส้นทาง prediction ไม่สร้างหรือคืน annotated result image แต่ยังคืน Detection ที่ pipeline ต้องใช้
- [x] เก็บ baseline ก่อนเปลี่ยนเป็น resident ด้วยชุดภาพ/Model Instruction ที่ระบุได้ แยกเวลา startup, image handling และ inference เท่าที่วัดได้ พร้อม hardware, backend, model variant, decode mode และ failures
- [x] มีการตรวจพฤติกรรมผ่าน public Model HTTP boundary สำหรับผลปกติ ผลว่าง และ engine error พร้อม smoke test โมเดลจริง ไม่อาศัย mock success เพียงอย่างเดียว
- [x] การเรียกซ้ำและการปิดบริการไม่ทิ้งไฟล์ชั่วคราวจากคำขอที่สำเร็จหรือผิดพลาด ไม่มี credentials หรือข้อมูลเฉพาะเครื่องถูกฝังในซอร์สที่แชร์


**Implementation evidence:** Model API และ checked native bridge ทำงานกับโมเดลจริงได้ ผล cat/remote ตรง CLI เดิมภายในความละเอียดการปัดทศนิยม ไม่มี annotated output หรือ weights ใน commit
