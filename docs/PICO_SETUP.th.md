# คู่มือติดตั้งและใช้งาน PICO VR, กล้อง และสายพาน

> **ฉบับแปลภาษาไทย** ของ [PICO_SETUP.md](PICO_SETUP.md) แปลจากเวอร์ชันบนสาขา `feat/hud-capture-button` เมื่อ 2026-11-23
> ถ้าสองฉบับไม่ตรงกัน ให้ยึด **ฉบับภาษาอังกฤษ** เป็นหลัก คำสั่ง ชื่อไฟล์ URL และชื่อปุ่มบนหน้าจอคงเป็นภาษาอังกฤษตามต้นฉบับ

คู่มือนี้ครอบคลุม PC ที่ใช้ Windows, ชุดควบคุม ESP32, PICO Browser, servo, สายพาน และกล้องโทรศัพท์ (ทางเลือก) ที่โปรเจกต์นี้ใช้ ให้รันคำสั่งใน PowerShell 7.2 ขึ้นไป และเปิดเทอร์มินัลของเซิร์ฟเวอร์แต่ละตัวค้างไว้ระหว่างทดสอบ

## 1. ติดตั้งเครื่องมือที่จำเป็น

- ติดตั้ง Git และ Node.js 20 ขึ้นไป ตรวจด้วย `git --version`, `node --version` และ `npm --version`
- ติดตั้ง PowerShell 7.2 ขึ้นไป สำหรับสคริปต์สร้างใบรับรองและสคริปต์กล้องโทรศัพท์ ให้เปิด **PowerShell 7** ไม่ใช่ Windows PowerShell 5.1 รุ่นเก่า
- ถ้าต้อง build หรือ flash ESP32 ให้ติดตั้ง Visual Studio Code พร้อมส่วนขยาย PlatformIO IDE และใช้เทอร์มินัลของ PlatformIO สำหรับคำสั่ง `pio` ด้านล่าง
- ต่อ PC, PICO, ESP32 และโทรศัพท์ (ถ้าใช้) เข้า LAN เดียวกัน อุปกรณ์ต้องเข้าถึงกันได้ เครือข่ายสำหรับแขก (guest network) อาจแยกอุปกรณ์ออกจากกัน

```powershell
git clone https://github.com/theepop66/CN360-group-project.git
cd CN360-group-project
```

HUD และเซิร์ฟเวอร์ HTTPS/WebRTC ของมันใช้เฉพาะของที่มากับ Node: **ไม่ต้องรัน `npm install` ใน `pico-webapp`** ส่วน relay ตรวจจับด้วย AI ที่แยกออกมาต่างหากมี dependency ที่ต้องติดตั้ง

## 2. ตรวจที่อยู่เครือข่าย

บน PC ให้รัน:

```powershell
ipconfig
```

หา IPv4 address ของอะแดปเตอร์ Wi-Fi ที่ต่อกับ PICO ห้ามใช้อะแดปเตอร์ VPN, `127.0.0.1` หรือที่อยู่ของ ESP32 เป็นที่อยู่ของ PC

| อุปกรณ์ | ที่อยู่ที่ทดสอบแล้ว | ใช้ที่ไหน |
| --- | --- | --- |
| Windows PC | `172.20.10.3` | URL ที่เปิดบน PICO และเบราว์เซอร์โทรศัพท์; ใบรับรอง HTTPS |
| ESP32 | `172.20.10.5` | ปลายทางของ proxy ใน HUD และการตรวจสถานะตัวควบคุมโดยตรง |
| Gateway | `172.20.10.1` | การตั้งค่าเครือข่ายของ ESP32 |

ที่อยู่เหล่านี้เป็นตัวอย่างจากชุดทดลองที่ใช้งานได้ ให้เปลี่ยนถ้าเครือข่ายของคุณต่างออกไป IP คงที่ (static IP), gateway, subnet และ DNS ของ ESP32 ตั้งไว้ใกล้ส่วนบนของ `360ControlUnit/src/main.cpp` ค่า subnet เริ่มต้นคือ `255.255.255.240`

## 3. เตรียม ESP32 และการต่อสาย

ข้ามการ flash ได้ถ้าบอร์ดรัน firmware ที่ใช้งานได้อยู่แล้ว

เปิด `360ControlUnit` เป็นโปรเจกต์ PlatformIO ใน VS Code สร้างไฟล์ credential ในเครื่องโดยไม่เขียนทับไฟล์เดิมที่มีอยู่:

```powershell
if (!(Test-Path .\360ControlUnit\src\secrets.h)) {
    Copy-Item .\360ControlUnit\src\secrets.example.h .\360ControlUnit\src\secrets.h
}
```

แก้ `360ControlUnit/src/secrets.h`: ตั้ง `WIFI_SSID`, `WIFI_PASSWORD` และ URL แจ้งเตือนของ n8n ให้ตรงกับระบบของคุณ ไฟล์นี้ Git ไม่ติดตาม (ignored) ตรวจที่อยู่เครือข่ายใน `src/main.cpp` ก่อน build

รันคำสั่งเหล่านี้จากรากของ repository ในเทอร์มินัลของ PlatformIO:

```powershell
pio run --project-dir .\360ControlUnit -e esp32dev
pio device list
pio run --project-dir .\360ControlUnit -e esp32dev --target upload --upload-port COM5
pio device monitor --port COM5 --baud 115200
```

แทนที่ `COM5` ด้วยพอร์ตของ ESP32 ที่ `pio device list` แสดง ปิด serial monitor ด้วย Ctrl+C ก่อนอัปโหลดครั้งถัดไป

| การเชื่อมต่อ | ต่อกับ ESP32 / แหล่งจ่ายไฟ |
| --- | --- |
| สัญญาณของ servo | GPIO18 |
| ไฟเลี้ยง servo | แหล่งจ่าย 5 V ที่เสถียรและเหมาะสม |
| กราวด์ของ servo | กราวด์ของแหล่งจ่ายและ GND ของ ESP32 ต่อถึงกัน |
| ULN2003 IN1 / IN2 / IN3 / IN4 | GPIO32 / GPIO33 / GPIO25 / GPIO26 |
| ไฟเลี้ยงและกราวด์ของ ULN2003 | แหล่งจ่าย 5 V ที่เหมาะสม; กราวด์ร่วมกับ ESP32 |
| เอาต์พุตของเซนเซอร์ IR | GPIO4; active low |
| Buzzer / LED แดง / LED เขียว | GPIO21 / GPIO22 / GPIO23 |

ดูรายละเอียดวงจรสนับสนุนได้ใน [คู่มือวงจร (schematic guide)](../controlunit_schematic/schematicbuildguide.md) ถ้าใช้ servo ให้ปล่อย `ACTUATOR_RELAY` ไว้ในสถานะปิด (disabled) ใน `platformio.ini` เพราะ build ทางเลือกนั้นจะสั่ง relay แทน servo

อ่านสถานะของตัวควบคุมจาก PC:

```powershell
Invoke-RestMethod http://172.20.10.5/status | Format-List
```

firmware ควรให้ค่า `controller_session`, `conveyor_sequence`, `mode` และ `state` ถ้าไม่มีฟิลด์หรือ endpoint ใดอาจหมายถึง firmware รุ่นเก่า

## 4. สร้างใบรับรอง HTTPS ในเครื่อง (ทำครั้งเดียว)

จากรากของ repository ใน PowerShell 7:

```powershell
.\pico-webapp\tools\setup-vr-https.ps1 -IpAddress 172.20.10.3
```

ใช้ **IPv4 address ของ Wi-Fi บน PC** สคริปต์จะสร้าง `dev-cert.pem` และ `dev-key.pem` ใน `pico-webapp/tools` อายุ 14 วัน ทั้งสองไฟล์ Git ไม่ติดตาม (ignored) แต่ละเครื่องต้องสร้างไฟล์ของตัวเอง สคริปต์นี้ไม่ได้ติดตั้งความเชื่อถือ (trust) ของใบรับรอง

ถ้ามีไฟล์อยู่แล้วและตรงกับ IP ของ PC และยังไม่หมดอายุ ให้ใช้ซ้ำได้ ถ้า IP ใหม่หรือใบรับรองหมดอายุ ให้เก็บคู่ไฟล์เดิมไว้โดยเปลี่ยนชื่อก่อนรันสคริปต์ใหม่ แล้วตรวจใบรับรองใหม่บนแต่ละอุปกรณ์ สคริปต์ตั้งใจไม่เขียนทับไฟล์ที่มีอยู่

## 5. เริ่มชุด VR/คอนโทรลเลอร์ที่ผ่านการทดสอบแล้ว

จากรากของ repository:

```powershell
.\START-PICO-VR.cmd
```

ถ้าเทอร์มินัลของคุณอยู่ใน `pico-webapp` อยู่แล้ว ให้ใช้:

```powershell
..\START-PICO-VR.cmd
```

ถ้า ESP32 ใช้ IP อื่น ให้ส่ง origin ของมันเข้าไป:

```powershell
.\START-PICO-VR.cmd http://192.168.1.50
```

launcher จะตรวจใบรับรอง ตรวจว่า HUD ตอบกลับผ่าน HTTPS ได้จริง และอ่าน `/esp/status` ผ่าน proxy ผลลัพธ์ที่คาดหวังมีดังนี้:

```text
[OK] HTTPS page returned HTTP 200 with certificate validation: https://172.20.10.3:8443/
[OK] ESP32 status has the conveyor session/sequence fields.
Controller mode: manual; state: idle
```

โหมดที่แสดงอาจต่างออกไปจนกว่าคุณจะเลือก Manual launcher นี้เริ่ม HTTPS ที่พอร์ต 8443 และไม่เข้าไปแทนที่เซิร์ฟเวอร์ HTTP บนพอร์ต 8080 ถ้ามันใช้เซิร์ฟเวอร์ HTTPS ที่มีอยู่แล้วซ้ำ เซิร์ฟเวอร์นั้นจะยังใช้ปลายทาง ESP32 เดิม ให้หยุดเซิร์ฟเวอร์ที่คุณเป็นเจ้าของนั้นก่อนถ้าต้องการเปลี่ยนปลายทาง ใช้ Ctrl+C เพื่อหยุดเซิร์ฟเวอร์ที่รันอยู่เบื้องหน้า (foreground) ซึ่ง launcher นี้เริ่มไว้

## 6. เปิด HUD บน PICO

ใน **PICO Browser** ของแว่น ให้เปิด:

```text
https://172.20.10.3:8443/?xrdebug=1
```

ห้ามเปิด `localhost` บน PICO เพราะจะชี้ไปที่ตัวแว่นเอง URL แบบ HTTP ที่พอร์ต 8080 แสดง 2D HUD ได้ แต่ไม่ให้ WebXR บนแว่น

ใบรับรองในเครื่องเป็นแบบ self-signed ถ้า PICO แสดงคำเตือนเรื่องใบรับรอง ให้เทียบที่อยู่ของ PC และรายละเอียดใบรับรองกับผลลัพธ์ของ launcher แล้วตัดสินใจเรื่องความเชื่อถือบนอุปกรณ์ หน้าจอ trust ต่างกันได้ตามเวอร์ชันของเบราว์เซอร์/ระบบปฏิบัติการ `ERR_CERT_AUTHORITY_INVALID` หมายถึงยังไม่ได้ตั้งความเชื่อถือ ไม่ได้หมายความว่า ESP32 ออฟไลน์ ห้ามปิดการตรวจสอบใบรับรองแบบทั่วทั้งระบบ อีกทางเลือกหนึ่งในการใช้งานจริงคือใช้ใบรับรองที่เชื่อถือได้สำหรับชื่อโฮสต์ของคุณ

เมื่อ HUD โหลดแล้ว:

1. กด **VR cinema** ในแถบเครื่องมือของตัวแสดงภาพ ระบบจะดาวน์โหลด A-Frame ตอนใช้ครั้งแรก แว่นจึงต้องเข้าอินเทอร์เน็ตได้เพื่อโหลดส่วนนี้
2. อนุญาตสิทธิ์ของ session VR ที่คาดไว้ ถ้าเบราว์เซอร์ขอ
3. กด **X** แล้วรอจนขึ้น **Mode set to manual**
4. ปล่อย stick ซ้ายให้อยู่กึ่งกลาง แล้วดันขึ้นเพื่อให้สายพานเดินหน้า ปล่อยเพื่อหยุด ในโหมด Manual การดันลงจะขอให้สายพานถอยหลัง
5. กด **Grip** ข้างใดข้างหนึ่งหนึ่งครั้งเพื่อสั่ง Sweep servo ใน firmware ปัจจุบัน servo จะหมุนไปที่มุม reject ที่ตั้งไว้ (90 องศา) แล้วกลับมาที่มุมพัก (0 องศา)

ผู้ใช้ยืนยันว่าการควบคุมสายพานและ servo ทำงานได้บนชุดทดลองจริงเมื่อวันที่ 19 พฤศจิกายน 2026 ข้อสังเกตนี้ครอบคลุมเฉพาะการตั้งค่าของชุดทดลองนั้น หลังติดตั้งให้ตรวจการต่อสาย แหล่งจ่ายไฟ ทิศทาง และการหยุดของชุดของคุณเอง

### ตารางปุ่มคอนโทรลเลอร์ (Controller reference)

| ปุ่ม | คำสั่ง | เงื่อนไข |
| --- | --- | --- |
| X ซ้าย | โหมด Manual | ตัวควบคุม (ESP32) อยู่ในสถานะ idle |
| Y ซ้าย | Capture & inspect: ถ่ายรูปแล้วให้ AI ตรวจ (เป็นคำแนะนำเท่านั้น ไม่ส่งคำสั่งไปที่เครื่อง) | n8n workflow ต้อง active; HUD server ต้องเข้าถึง n8n ได้ (`--n8n-origin`) |
| Grip ด้านข้าง (ข้างใดก็ได้) | Servo Sweep | อยู่ใน Manual และ idle; หนึ่งคำสั่งต่อการกดหนึ่งครั้ง |
| A ขวา | Reject | มี item (ชิ้นงาน) ปัจจุบันที่กำลังรอ Verdict |
| B ขวา | Pass | มี item ปัจจุบันที่กำลังรอ Verdict |
| Stick ขวา ขึ้น/ขวา | มุม servo +5 องศา | Manual และ idle |
| Stick ขวา ลง/ซ้าย | มุม servo -5 องศา | Manual และ idle |
| Stick ซ้าย ขึ้น | สายพานเดินหน้าขณะที่ค้างไว้ | Manual หรือการทำงานแบบ Auto ที่เข้าเงื่อนไข |
| Stick ซ้าย ลง | สายพานถอยหลังขณะที่ค้างไว้ | Manual |
| Stick ซ้าย ซ้าย/ขวา | ซูมกล้องโทรศัพท์ออก/เข้า | ต้องมีโทรศัพท์ผู้ส่งที่จับคู่แล้วและรองรับการซูม |
| กด stick ซ้าย | รีเซ็ตการซูมกล้องโทรศัพท์ | เงื่อนไขเดียวกับโทรศัพท์ |
| Trigger หน้า / กด stick ขวา | ไม่มีทางลัดสั่ง actuator | สงวนไว้ใช้งานปกติหรือไม่ได้ใช้ |
| Menu / Home | ปุ่มควบคุมของแว่น/เบราว์เซอร์ | ไม่ส่งมาเป็นปุ่มสั่ง actuator |

อาร์เรย์ปุ่มของ PICO มีช่องว่าง (placeholder) ที่ index 2: Grip คือ 1, การกด stick คือ 3, A/X คือ 4 และ B/Y คือ 5 เมื่อเปิดด้วย `?xrdebug=1` บรรทัด **Input** ที่แยกต่างหากจะแสดงปุ่มและ index ส่วนบรรทัดสถานะการควบคุมแสดงใบตอบรับ (receipt) จาก ESP32

**Auto ไม่ใช่การทดสอบมอเตอร์แบบเดินอิสระ** การรับชิ้นงานอัตโนมัติ (automatic item admission) ถูกปิดใน firmware ค่าเริ่มต้น แฟล็กสำหรับชุดทดลองและข้อกำหนดเรื่อง item/timeout อยู่ใน [360ControlUnit/README.md](../360ControlUnit/README.md) ปุ่ม A/B จะไม่สร้างตัวตนของ item ขึ้นเองเมื่อไม่มี item ที่รอ Verdict ในโหมด Manual การ reject Verdict จะส่งการแจ้งเตือนโดยไม่ขยับ servo ถ้าต้องการ Sweep ด้วยมืออย่างตั้งใจ ให้ใช้ Grip ตอนนี้ Auto ไม่มีปุ่มบนคอนโทรลเลอร์แล้ว ให้ใช้สวิตช์ **Auto** ในแผง 2D HUD

## 7. ทางเลือก: กล้องโทรศัพท์ผ่าน WebRTC

launcher ของ VR รวมการ signaling `/rtc` ไว้แล้ว ไม่ต้องติดตั้งแพ็กเกจหรือบริการเพิ่ม บน LAN เดียวกัน:

| อุปกรณ์ | เปิด URL นี้ |
| --- | --- |
| เบราว์เซอร์บนโทรศัพท์ (Safari บน iPhone) | `https://172.20.10.3:8443/phone-webrtc.html` |
| PICO Browser | `https://172.20.10.3:8443/?camera=webrtc&xrdebug=1` |

ตรวจความเชื่อถือ HTTPS บนโทรศัพท์ด้วย ที่หน้าผู้ส่ง (sender) แตะ **Start** อนุญาตการเข้าถึงกล้อง และเปิดหน้านั้นไว้ให้เห็นอยู่ตลอด เปิด HUD ฝั่งผู้รับ แล้วเข้า VR cinema แตะ **Stop** เพื่อจบฝั่งผู้ส่ง เส้นทางนี้ให้วิดีโอสด แต่ไม่มีการรับภาพ `/capture` ของผู้ส่ง JPEG แบบจับคู่ และไม่มีตัวควบคุมการซูมกล้องระยะไกล ถ้าต้องใช้ฟังก์ชันเหล่านั้นให้ใช้หัวข้อถัดไป

## 8. ทางเลือก: กล้อง JPEG แบบจับคู่, capture และการซูมระยะไกล

`start-phone-camera.ps1` เป็น launcher แยกสำหรับ **กล้องอย่างเดียว (camera-only)**: ตั้งใจไม่เชื่อมต่อกับ ESP32 จริง ให้หยุดเซิร์ฟเวอร์ที่คุณเป็นเจ้าของบนพอร์ต 8080/8443 ก่อนใช้ ห้ามรัน launcher สองตัวบนพอร์ตเดียวกัน

```powershell
.\pico-webapp\tools\start-phone-camera.ps1 -IpAddress 172.20.10.3
```

สคริปต์จะพิมพ์พาธของ `connection.txt` ใต้ `%LOCALAPPDATA%/CN360/phone-camera/172.20.10.3/` ไฟล์นั้นมีรหัสจับคู่ปัจจุบัน ลายนิ้วมือ (fingerprint) ของใบรับรอง และ URL บน iPhone ให้ทำดังนี้:

1. ดาวน์โหลด `http://172.20.10.3:8080/phone-camera-ca.cer`
2. ตรวจ fingerprint ของมัน แล้วติดตั้งโปรไฟล์ใน **Settings > General > VPN & Device Management** จากนั้นเปิดใช้ใน **General > About > Certificate Trust Settings** นี่คือ CA สำหรับการพัฒนาในเครื่อง ให้ลบออกเมื่อทดสอบเสร็จ
3. เปิด `https://172.20.10.3:8443/phone-camera.html` ใน Safari ใส่รหัสจับคู่ แตะ **Start streaming** อนุญาตการเข้าถึงกล้อง และเปิดหน้านั้นไว้ให้เห็นอยู่ตลอด
4. เปิด `http://localhost:8080/?camera=phone` บน PC หรือ `https://172.20.10.3:8443/?camera=phone&xrdebug=1` บน PICO หลังตรวจความเชื่อถือแล้ว
5. ใส่รหัสเดียวกันใน **Connection settings > Phone camera control code** ของ HUD การซูมใช้ได้เฉพาะเมื่อโทรศัพท์รายงานว่ารองรับ

ถ้าจะใช้ตัวรับ JPEG นี้ **ร่วมกับตัวควบคุมจริง** ให้หยุดเซิร์ฟเวอร์ camera-only ที่คุณเป็นเจ้าของก่อน:

```powershell
.\pico-webapp\tools\stop-phone-camera.ps1 -IpAddress 172.20.10.3
```

จากนั้นเริ่มเซิร์ฟเวอร์แบบรวมจากรากของ repository โดยใช้คู่ไฟล์ใบรับรองที่สร้างไว้:

```powershell
$cameraCertDir = Join-Path $env:LOCALAPPDATA 'CN360\phone-camera\172.20.10.3'
node .\pico-webapp\tools\hud-server.mjs --http-port 8080 --https-port 8443 --cert "$cameraCertDir\server.pem" --key "$cameraCertDir\server-key.pem" --phone-ca "$cameraCertDir\phone-camera-ca.cer" --phone-camera --control-unit http://172.20.10.5
```

เซิร์ฟเวอร์ foreground นี้จะพิมพ์ **รหัสจับคู่ใหม่** ให้จับคู่ผู้ส่งและ HUD อีกครั้งด้วยรหัสนั้น หยุดเซิร์ฟเวอร์แบบรวมนี้ด้วย Ctrl+C CA ถูกใช้ซ้ำ แต่ session ของกล้องและรหัสไม่ถูกใช้ซ้ำ อีกทางหนึ่ง เซิร์ฟเวอร์ทั่วไปใช้ใบรับรอง VR จากหัวข้อ 4 ร่วมกับ `--phone-camera` ได้ โทรศัพท์ต้องเชื่อถือใบรับรองที่เซิร์ฟเวอร์นั้นแสดงจริง

## 9. ทางเลือก: relay ตรวจจับด้วย AI และบริการอื่น

การควบคุมสายพาน/servo ไม่ต้องใช้โมเดล, n8n, Supabase หรือ detection relay ถ้ารันเฉพาะ HUD แล้วสถานะ AI ขึ้นว่าไม่ได้เชื่อมต่อ ถือเป็นเรื่องปกติ

ถ้าต้องการให้แสดงกล่องตรวจจับ ให้เปิดเทอร์มินัลที่สองบน PC:

```powershell
cd detection-relay
npm ci
npm start
```

HUD server เริ่มต้นจะส่งต่อ (tunnel) `/detections` ไปที่ `http://127.0.0.1:8081` รวมถึง `wss://` บนหน้า HTTPS ถ้า relay อยู่บน PC เครื่องอื่น ให้ใช้ `--relay-origin` กับคำสั่ง `hud-server.mjs` แบบทั่วไป ดูวิธีตั้งค่าและเริ่มระบบได้จากคู่มือของแต่ละบริการที่มีอยู่แล้ว การเปิด HUD ไม่ได้ตั้งค่าหรือเปิดใช้งาน workflow ของ AI:

- [Detection relay](../detection-relay/README.md)
- [n8n workflows and runtime](../n8n/README.md)
- [Model service](../model-service/README.md)
- [Raspberry Pi streaming](../raspberry-pi-streaming/README.md)
- [ThingsBoard monitoring](../thingsboard/README.md)

ปุ่ม **Y** ซ้าย (และปุ่ม **Capture & inspect** ใน 2D HUD) จะขอให้ n8n ตรวจหนึ่งครั้งผ่านเส้นทาง `/n8n/inspect-now` ของ HUD server ปลายทางเริ่มต้นคือ `http://127.0.0.1:5678` (n8n บน PC เครื่องนี้) ถ้า n8n อยู่บน PC เครื่องอื่น ให้เริ่ม `hud-server.mjs` ด้วย `--n8n-origin http://<n8n-host>:5678` n8n workflow ต้อง active: มีเพียง production webhook URL เท่านั้นที่ตอบ ผลที่ได้เป็นเพียงคำแนะนำ ไม่ขยับสายพานหรือ servo ดู [Capture & inspect](../pico-webapp/README.md#capture--inspect-take-a-photo) (ภาษาอังกฤษ)

## 10. การแก้ปัญหา (Troubleshooting)

| อาการ | สิ่งที่ต้องตรวจ |
| --- | --- |
| `START-PICO-VR.cmd` is not recognized | จากรากของ repository ให้ใช้ `.\START-PICO-VR.cmd` จากโฟลเดอร์ `pico-webapp` ให้ใช้ `..\START-PICO-VR.cmd` |
| `ERR_CONNECTION_REFUSED` | เริ่ม launcher ของ HTTPS แล้วเปิดเทอร์มินัลของมันค้างไว้ หน้า HTTP 8080 ที่ใช้งานได้ ไม่ได้พิสูจน์ว่า HTTPS 8443 กำลังทำงานอยู่ |
| HTTPS ใช้ได้บน PC แต่ PICO หมดเวลา (timeout) | ตรวจ IP ของ PC, การแยกอุปกรณ์บน LAN ที่ใช้ร่วมกัน และกฎ Windows firewall ของ Node บนเครือข่ายที่ใช้จริงอีกครั้ง |
| `ERR_CERT_AUTHORITY_INVALID` | ตรวจความเชื่อถือบนอุปกรณ์นั้น ตรวจ IP และวันหมดอายุของใบรับรอง |
| `EACCES` ระหว่างการตรวจเครือข่ายของ launcher | รันในเทอร์มินัลปกติของ PC เชลล์ของเอเจนต์ที่ถูกแยกสภาพแวดล้อม (isolated agent shell) อาจเข้าถึง LAN ไม่ได้ |
| พอร์ตถูกใช้อยู่แล้ว | หยุดเซิร์ฟเวอร์ที่คุณเริ่มเองในเทอร์มินัลของมัน หรือใช้สคริปต์หยุดกล้องที่คุณเป็นเจ้าของ ห้ามฆ่า process Node ที่ไม่เกี่ยวข้อง |
| ไม่มีใบรับรองที่ IP ตรงกัน | IP ของ PC เปลี่ยน ให้เตรียมใบรับรองใหม่สำหรับ IPv4 ของ Wi-Fi ปัจจุบัน |
| VR cinema โหลด A-Frame ไม่ได้ | ตรวจว่าแว่นเข้า CDN ผ่านอินเทอร์เน็ตได้ แล้วลองใหม่หลังการเชื่อมต่อกลับมา |
| ปุ่มคอนโทรลเลอร์ไม่ทำงานใน 2D | ให้เข้า session AR/VR จริง เบราว์เซอร์แบบ 2D ปกติให้คอนโทรลเลอร์เป็นเพียงตัวชี้ (pointer) |
| Sweep ถูกปฏิเสธ | กด X รอจนยืนยัน Manual และรอจนตัวควบคุมอยู่ในสถานะ idle |
| Sweep ถูกรับคำสั่งแต่ servo ไม่ขยับ | ตรวจสัญญาณ GPIO18, แหล่งจ่าย 5 V ที่เหมาะสม, กราวด์ร่วม, build ของ actuator ที่ติดตั้ง และตัว servo เอง การรับคำสั่งไม่ใช่ telemetry ของตำแหน่ง |
| A/B รายงานว่าไม่มี item ที่ active | ปุ่ม Verdict ต้องมี item ที่ผูกกับตัวตนและกำลังรอการตัดสิน ใช้ Grip เพื่อทดสอบการขยับ servo ด้วยมือ |
| ซูมกล้องโทรศัพท์ใช้ไม่ได้ | ตรวจรหัสจับคู่, แหล่งกล้อง JPEG ที่เลือก และความสามารถซูมจริงของกล้อง/เบราว์เซอร์ ตัวส่ง WebRTC ไม่รองรับตัวควบคุมเหล่านี้ |

## 11. การตรวจซอฟต์แวร์ (Software checks)

การตรวจเฉพาะส่วนของตัวควบคุม/กล้องไม่ต้องใช้ฮาร์ดแวร์จริง:

```powershell
cd pico-webapp
node --test tests/xr-controller.test.js tests/servo.test.js tests/control-feedback.test.js tests/conveyor.test.js tests/xr-modes.test.js tests/phone-camera-controls.test.js tests/camera-zoom.test.js
cd ..
node --test 360ControlUnit/test/conveyor-bench.test.mjs
```

สำหรับชุดทดสอบ HUD ทั้งหมด ให้รัน `npm test` ใน `pico-webapp` เทสต์แบบ integration ต้องได้รับสิทธิ์เปิด socket เครือข่ายในเครื่อง เทสต์แกนหลัก C++ ของตัวควบคุมต้องใช้ Visual Studio C++ Build Tools:

```powershell
.\360ControlUnit\test\host\run-host-tests.ps1
```

ถ้าต้องการตรวจสถานะจริงแบบอ่านอย่างเดียว ให้รัน:

```powershell
node .\360ControlUnit\test\conveyor-bench.mjs http://172.20.10.5 status
```

คำสั่งทางเลือก `forward 2` และ `reverse 2` ของ bench จะสั่งให้เกิดการเคลื่อนที่จริง ให้ใช้เฉพาะเมื่อพร้อมสังเกตสายพาน คำสั่งเหล่านี้แยกจากการทดสอบซอฟต์แวร์ อย่านำ credential ในเครื่อง ใบรับรองที่สร้างขึ้น คีย์ รหัสจับคู่ log ผลลัพธ์ของคอมไพเลอร์ และประวัติของตัวแก้ไข (editor history) เข้า commit
