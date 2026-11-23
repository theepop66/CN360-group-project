# ทดสอบ iPhone 11 + Lightning + Windows → HUD

ขอบเขต: ทดสอบภาพจาก iPhone เข้าสู่ HUD ใน browser บน Windows ก่อน ยังไม่ต้องมี PICO, Raspberry Pi, ESP32 หรือ AI

## 1. เตรียมการเชื่อมต่อ

1. ติดตั้ง/เปิด [Apple Devices จาก Microsoft Store](https://apps.microsoft.com/detail/9np83lwlpz9k) และตรวจว่าแอปเห็น iPhone 11
2. ใช้สาย Lightning ที่ส่งข้อมูลได้ ต่อเข้าคอมโดยตรง ปลดล็อก iPhone และกด **Trust This Computer**
3. เปิด **Settings → Personal Hotspot → Allow Others to Join** บน iPhone หากไม่มีเมนูนี้ ให้ตรวจ Cellular และเงื่อนไขผู้ให้บริการ
4. ถอดและเสียบสายใหม่ หาก Windows ยังไม่แสดง Apple USB Ethernet

การเสียบสายและเห็นว่าชาร์จได้ยังไม่แปลว่าเปิดเครือข่าย USB สำเร็จ ตัวเปิดทดสอบจะไม่เลือก Wi-Fi หรือ VPN มาแทน

## 2. เปิดตัวทดสอบ

จากโฟลเดอร์โปรเจกต์ เปิด PowerShell/Terminal ปกติบน Windows แล้วรัน:

```powershell
.\START-IPHONE-USB.cmd
```

หรือหากต้องการตรวจเฉพาะเครือข่ายก่อน โดยยังไม่เปิด server:

```powershell
node .\pico-webapp\tools\usb-camera-bench.mjs --check
```

ใช้ Node.js 20 ขึ้นไปและ PowerShell 7.2 ขึ้นไป เมื่อเปิดเตรียมระบบจากแอปแล้ว ตัวเปิดจะจำพาธ PowerShell ที่ใช้สำเร็จไว้สำหรับ terminal ปกติที่ไม่มี `pwsh` ใน PATH หากยังไม่มีพาธที่บันทึกไว้ ให้ติดตั้ง PowerShell 7 หรือกำหนด `CN360_PWSH` เป็นพาธเต็มของ `pwsh.exe` ก่อนเปิดทดสอบ

ตัวเปิดทดสอบใช้พอร์ต HTTP **8082** และ HTTPS **8445** และไม่หยุด server เดิม หากพอร์ตถูกใช้งาน ให้เปลี่ยนเป็นสองพอร์ตว่าง:

```powershell
node .\pico-webapp\tools\usb-camera-bench.mjs --http-port 8083 --https-port 8446
```

หากมีหลาย Apple USB IPv4 ให้เลือก **IP ฝั่งคอม** ที่ตัวตรวจพบด้วย `--ip <PC-USB-IP>` ค่า IP ของ Wi-Fi จะไม่ผ่านการตรวจ

ให้เปิดจาก terminal ปกติบน Windows หากเซิร์ฟเวอร์ตอบเฉพาะ localhost แต่ iPhone เปิดแม้แต่ลิงก์ HTTP ไม่ได้ อย่าเริ่มแก้ trust ของ HTTPS ก่อน ให้ตรวจการเข้าถึง IP USB, firewall และสภาพแวดล้อมที่เปิด server

## 3. ให้ Safari เชื่อถือ HTTPS สำหรับกล้อง

เมื่อเปิดสำเร็จ หน้าต่างทดสอบจะแสดง `[PHONE]`, `[CA]`, `[PAIRING]` และ `[READY]` ให้ใช้ค่าจากรอบที่เปิดจริง ไม่คัดลอก IP เก่าหรือใช้ IP gateway ของ iPhone แทน IP ฝั่งคอม

1. เปิด URL `[CA] Download on iPhone` ใน Safari เพื่อดาวน์โหลด certificate สาธารณะ
2. ตรวจ fingerprint SHA256 ให้ตรงกับหน้าต่างทดสอบ แล้วติดตั้ง profile ที่ **Settings → General → VPN & Device Management**
3. เปิด full trust ของ **CN360 USB Camera Test CA** ที่ **Settings → General → About → Certificate Trust Settings**
4. เปิด URL `[PHONE]` ใน Safari ซึ่งลงท้าย `/usb-phone.html`
5. กรอก pairing code จากหน้าต่างคอม กด **Start streaming** และอนุญาต Camera ให้หน้า Safari นี้แสดงอยู่ตลอด

ตัวเปิดทดสอบสร้าง CA สำหรับทดสอบอายุ 30 วัน โดยไม่ติดตั้ง trust บน Windows หรือเปลี่ยน firewall ให้อัตโนมัติ ลบ profile นี้จาก iPhone เมื่อเลิกทดสอบ เก็บ key และไฟล์ runtime ใน `.scratch/iphone-usb-camera/runtime/` ซึ่งไม่เผยแพร่ผ่าน web server

หาก iPhone เปิด URL ไม่ได้ ให้ตรวจว่า server ยังเปิดอยู่และ Apple USB adapter ยังมี IPv4 ตรวจ Windows Firewall สำหรับ Node เฉพาะเครือข่ายที่ใช้ทดสอบเมื่อจำเป็น ไม่ต้องปิด firewall ทั้งระบบ หากติดตั้ง certificate แล้วกล้องยังไม่ขึ้น ให้ตรวจ full trust, camera permission และ iOS ที่รองรับ `requestVideoFrameCallback`

## 4. ดูภาพใน HUD และยืนยันเส้นทาง

บน Windows เปิด:

```text
http://localhost:8082/usb-bench
```

หน้านี้มี HUD จริงของโปรเจกต์ พร้อมสถานะเฟรมล่าสุดที่ camera service ยอมรับ, ขนาด JPEG, ขนาดภาพ และ source/destination IP ที่อ่านจาก socket ของการ upload

1. ขยับมือหน้ากล้อง: ภาพใน HUD ต้องเปลี่ยนตาม และหมายเลขเฟรมเพิ่มต่อเนื่อง
2. กด **Latest capture**: ต้องเป็น JPEG ของภาพกล้องปัจจุบัน ระบบเก็บ JPEG bytes เดิมและ frame-identity headers ไว้สำหรับการเชื่อมต่อขั้นถัดไป
3. ตรวจว่า destination IP ในสถานะตรงกับ `[USB] PC ...` และขึ้น **Receiving at the Apple USB address**
4. ถอดสาย Lightning: เฟรมต้องหยุด สถานะรอภาพใหม่ และ HUD ต้องไม่แสดงภาพเก่าเป็น live ภายในช่วงตรวจความสด/health polling (ประมาณ 2–4 วินาที)
5. เสียบกลับ เปิด Hotspot ตามจำเป็น โหลดหน้า sender ใหม่ กด Start อีกครั้ง: ภาพต้องกลับมา พร้อม camera session ใหม่

สถานะรับภาพที่ USB IP เป็นหลักฐานของ endpoint ที่ใช้ แต่ต้องทดสอบถอดสายร่วมด้วยก่อนยืนยันว่าเส้นทางนี้พึ่งสายจริง หากยังไม่มีภาพจริง ห้ามสรุปว่า iPhone ผ่านการทดสอบแล้ว

รอบแรกคงภาพ JPEG ไม่เกิน 960×720 และการบีบอัดเดิม เพื่อแยกปัญหาการเชื่อมต่อออกจากงานปรับคุณภาพ ซูมขึ้นกับความสามารถของ iOS/browser และไม่ใช่เกณฑ์ผ่านของการทดลองภาพรอบนี้ ปุ่มควบคุมของ HUD ยังอยู่ แต่ camera-only bench นี้ชี้ actuator/AI ไปยัง loopback port ที่ไม่เปิดบริการ

## 5. หยุดและบันทึกผล

กด **Stop** บน iPhone แล้วกด **Ctrl+C** ในหน้าต่างตัวทดสอบ ไม่ต้องหยุด Node process อื่น

บันทึก iOS, รุ่น Windows, สาย/พอร์ต, PC USB IP, ความละเอียดจริง, การขยับภาพ, capture, ถอดสาย และต่อใหม่ เป็น `ผ่าน / ไม่ผ่าน / ยังไม่ได้ทดสอบ` แยกกัน การทดสอบอัตโนมัติด้วย JPEG fixture ไม่ใช่ผลทดสอบกล้อง iPhone จริง

อ้างอิง: [Apple: USB Personal Hotspot บน Windows](https://support.apple.com/en-ca/111785), [Apple: คอมไม่รู้จัก iPhone](https://support.apple.com/en-gb/108643)
