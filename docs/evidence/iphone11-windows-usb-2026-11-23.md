# iPhone 11 → Lightning → Windows HUD: หลักฐานการทดสอบ

วันที่: 23 พฤศจิกายน 2026

ขอบเขต: กล้องเว็บบน iPhone 11 และ HUD บนคอม Windows; ยังไม่รวม PICO, Raspberry Pi, การปรับความละเอียด หรือการทดสอบ actuator

| รายการ | ผล | หลักฐาน/ข้อจำกัด |
| --- | --- | --- |
| Windows รู้จักโทรศัพท์ | ผ่าน | พบอุปกรณ์ Apple iPhone ผ่าน Windows PnP; ผู้ใช้ยืนยันว่า Apple Devices เห็น iPhone 11 |
| เครือข่ายผ่านสาย | ผ่านเฉพาะการตรวจ adapter | พบ `Ethernet 3: Apple Mobile Device Ethernet`, PC IPv4 `172.20.10.3` หลังติดตั้ง Apple Devices |
| ป้องกันการเลือก Wi-Fi/VPN | ผ่านการทดสอบอัตโนมัติ | ตัวเลือกเครือข่ายปฏิเสธ adapter อื่นและ Apple adapter ที่ยังไม่มี IPv4; publisher request ที่เข้า IP อื่นถูกปฏิเสธ |
| HTTPS สำหรับกล้อง | ผ่านฝั่ง server | สร้าง CA สำหรับทดสอบและตรวจ HTTPS ด้วย CA จริง โดยไม่ปิดการตรวจใบรับรอง |
| iPhone เข้าถึง HTTP ของคอม | ผ่าน | ผู้ใช้ยืนยันว่าดาวน์โหลด CA ได้หลังเปิด server จาก terminal ปกติบน Windows |
| หน้าทดสอบและ HUD บน Windows | ผ่าน | เปิด `http://localhost:8082/usb-bench`; ผู้ใช้ยืนยันว่าภาพ HUD เปลี่ยนตามการขยับหน้ากล้อง |
| รับ JPEG/capture/metadata | ผ่านด้วย fixture | ทดสอบ HTTP ด้วย JPEG จริง; capture bytes ไม่เปลี่ยน; นับเฉพาะ accepted frame; session/ความสดทำงานตามเกณฑ์ |
| JavaScript ของหน้าทดสอบ | ผ่าน | ทดสอบ script ที่ได้จาก HTML จริง รวมกรณี health อ่านได้เฟรมใหม่กว่าใน session เดียวกัน |
| ชุดทดสอบ HUD | ผ่าน | `npm test` ใน pico-webapp หลังแก้การหา PowerShell: 127 tests, 127 pass, 0 fail |
| เปิดจาก terminal ที่ไม่มี pwsh ใน PATH | ผ่านการทดสอบอัตโนมัติ | เรียก preflight ผ่าน process ที่ตัด PATH เหลือ Windows PowerShell 5.1 แล้วใช้พาธ PowerShell 7 ที่บันทึกไว้ได้ โดยไม่เปลี่ยน execution policy |
| ภาพสดจาก iPhone จริง | ผ่าน | Camera health HTTP 200; accepted JPEG ผ่าน destination `172.20.10.3`, source `172.20.10.1`; frame sequence เพิ่มจาก 258 ถึง 375 ใน camera session เดียวกัน |
| capture จากกล้องจริง | ผ่าน | `/capture` HTTP 200, JPEG 71,789 bytes ที่เฟรม 375, ขนาด 540×720 แนวตั้ง พร้อมห้า frame-identity headers; เปิดอ่านภาพจริงได้ เป็นภาพบริเวณแป้นพิมพ์/ตัวเครื่องคอม |
| ขยับวัตถุแล้วภาพ HUD เปลี่ยน | ผ่านจากการสังเกตของผู้ใช้ | ผู้ใช้ตอบว่าภาพเปลี่ยนตามในการทดสอบขยับมือหน้ากล้อง |
| ถอดสายแล้วภาพหยุด | ผ่าน | ผู้ใช้ยืนยันว่าถอด Lightning แล้วหยุด; monitor พบ camera health HTTP 503 เมื่อ 14:20:27 น. Asia/Bangkok |
| เสียบกลับแล้วเริ่ม session ใหม่ | ผ่าน | ผู้ใช้ยืนยันว่าเสียบกลับแล้วส่งภาพได้; monitor พบ health กลับมา HTTP 200 เมื่อ 14:21:00 น. พร้อม session ใหม่ เฟรมเริ่มที่ 3 และเพิ่มต่อถึง 110 |

คำสั่งเริ่มรอบถัดไป: `START-IPHONE-USB.cmd` จากโฟลเดอร์โปรเจกต์ ต้องใช้ IP/URL/pairing code ที่ launcher พิมพ์ในรอบนั้น

ระหว่างทดลอง ผู้ใช้เปิดลิงก์ดาวน์โหลด CA แบบ HTTP จาก iPhone ไม่ได้ ขณะที่ server ที่เปิดในสภาพแวดล้อม agent ตอบ localhost ได้ แต่เรียก PC USB IP แล้ว timeout จึงขอให้เปิดจาก terminal ปกติบน Windows เพื่อแยกข้อจำกัดของสภาพแวดล้อมออกจาก firewall/เครือข่าย USB พบ `pwsh ENOENT` ใน terminal ปกติและแก้ด้วยพาธ PowerShell 7 ของ runtime ที่มีอยู่ในเครื่องแล้ว หลังจากนั้นผู้ใช้ดาวน์โหลด CA ได้และส่งภาพกล้องจริงสำเร็จ เคยพบ `invalid_pairing_code` ระหว่างจับคู่ก่อนเริ่ม session ที่ส่งภาพสำเร็จ

ผลรอบนี้ยืนยันการเชื่อมต่อ iPhone 11 → Lightning → Windows → HUD โดยประกอบหลักฐาน accepted-frame source/destination IP, JPEG capture จริง, การสังเกต HUD ของผู้ใช้ และการถอด/ต่อสายร่วมกับ health/session monitor

ก่อนถอดสาย monitor พบ camera session `18653e81-cb58-4732-b420-70f83a7790af` หลังต่อกลับพบ `6d34f538-578e-451f-b630-1f30a15f44b4` เป็นคนละ session และ sequence เริ่มใหม่ รายงาน monitor ฉบับเครื่องอยู่ใน `.scratch/iphone-usb-camera/cable-check.json` โดยไม่มี pairing token

ข้อจำกัด: ยังไม่ได้วัดความชัดที่ดีขึ้นจาก baseline, latency แบบ end-to-end, FPS ที่คงที่, soak test 30 นาที, การซูมจากจอยจริง, การควบคุม actuator, PICO หรือ Raspberry Pi; ยังไม่ระบุ iOS/Windows version และยังไม่ได้ทดสอบ iPhone รุ่นอื่น ภาพรอบนี้ยังเป็น JPEG profile เดิมและถือเป็นการพิสูจน์การเชื่อมต่อ

รีวิวโค้ดสองด้าน: แก้ script escaping และการอ่านสถานะต่างจังหวะแล้ว ไม่พบข้อผิดพลาดที่ยังขวางการทดลอง ข้อเสนอแยก helper สร้าง certificate ร่วมกับ launcher เก่าเป็นงานปรับโครงสร้างที่ยังไม่ได้ทำในรอบนี้

ข้อจำกัด Git ท้องถิ่น: สร้าง `.git/index.lock` ไม่ได้ (Permission denied) จึงใช้ช่องทาง GitHub สำหรับการเผยแพร่ ไฟล์งานในเครื่องยังอยู่ใน working tree โดยไม่มีการ stage หรือ reset งานเดิมของผู้ใช้
