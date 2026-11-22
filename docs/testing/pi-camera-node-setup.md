# คู่มือตั้ง Raspberry Pi เป็น camera node: เขียน SD card → boot → ติดตั้ง → ตรวจรับ

> **สถานะ: ร่าง (2026-11-21) — ยังไม่ได้ลองทำตามขั้นตอนบน Pi จริง**
>
> สิ่งที่ตรวจแล้ว: (1) เวอร์ชัน OS / Imager / แพ็กเกจ เทียบกับหน้าเว็บทางการและ PyPI ณ วันที่เขียน (2) คำสั่งฝั่ง Linux ผ่าน `bash -n` และฝั่ง PowerShell ผ่านตัว parser (3) คำสั่ง `git archive` ลองกับ repo นี้จริงแล้ว (4) `pip` resolve `requirements-dev.txt` สำหรับ aarch64 + Python 3.13 แบบ wheel-only ได้ (`--dry-run` บน PC) (5) ตัวอย่าง PowerShell หัวข้อ 8.1–8.3 ลองกับเซิร์ฟเวอร์กล้องจำลองบน PC แล้ว (ไม่ใช่ Pi จริง)
>
> สิ่งที่ยังไม่ได้ตรวจ: พฤติกรรมบน Pi จริง, ป้ายเมนูของ Imager 2.x ตามที่แสดงจริง, และเวลาโดยประมาณทุกค่า (เป็นประมาณการของผู้เขียน) เมื่อทำจริงให้แก้เอกสารนี้ตามผลที่ได้

เอกสารนี้ใช้คู่กับ [แผนทดสอบทั้งระบบ](full-system-test-plan.md) ซึ่งตัดสิน D3 แล้วว่าใช้ **Pi** เป็น camera node เป้าหมายคือได้ Pi ที่ `GET /health` ตอบ 200 และพร้อมเข้าชุด CAM-01…CAM-12

ชื่อและค่าที่ใช้ในคู่มือ (`camadmin`, `cn360-cam`, `172.20.10.6`) เป็นค่าที่เสนอ เปลี่ยนได้ แต่ต้องใช้ให้ตรงกันทุกที่

---

## 0. สรุปสั้น

| คำถาม | คำตอบ |
| --- | --- |
| ใช้ OS อะไร | **Raspberry Pi OS Lite (64-bit)** — Debian 13 "trixie" (ภาพลงวันที่ 6 ต.ค. 2026, kernel 6.18) |
| เขียนการ์ดด้วยอะไร | **Raspberry Pi Imager 2.0.12 ขึ้นไป** บน Windows |
| ต้องมีอะไร | Pi 3B / 3B+ / 4B / 5 / Zero 2 W, microSD (แนะนำ 32 GB), แหล่งจ่ายไฟตามรุ่น, กล้อง USB UVC, ข้อมูลเครือข่าย (หัวข้อ 2) |
| ใช้เวลาเท่าไร | ครั้งแรกราว 1–1.5 ชั่วโมง (ประมาณการ ยังไม่ได้วัด); ทำเครื่องที่สองจาก image สำรองราว 10–15 นาที (หัวข้อ 9) |
| ถือว่าเสร็จเมื่อไร | ผ่านเกณฑ์ในหัวข้อ 8.5 |

| ลำดับ | ทำอะไร | เวลาโดยประมาณ (ยังไม่ได้วัด) |
| --- | --- | --- |
| 3 | เขียน SD card ด้วย Imager | 5–10 นาที |
| 4 | boot ครั้งแรก เข้า SSH อัปเดตระบบ | 10–20 นาที |
| 5–6 | ตั้งเครือข่าย ต่อและตรวจกล้อง | ราว 10 นาที |
| 7 | ติดตั้งโปรแกรมกล้อง (`pip` บน Pi รุ่นเก่าใช้เวลามากที่สุด) | 10–25 นาที |
| 8–9 | ตรวจรับ และทำ image สำรอง | 15–20 นาที |

---

## 1. ต้องใช้เวอร์ชันอะไร

ตรวจจากหน้าทางการและ PyPI เมื่อ 2026-11-21 (แหล่งข้อมูลอยู่ท้ายเอกสาร) ควรเปิดหน้าดาวน์โหลดดูซ้ำอีกครั้งตอนทำจริง เพราะ Raspberry Pi OS ออกรุ่นใหม่เป็นระยะ

| รายการ | ใช้ตัวนี้ | ที่มา / เหตุผล |
| --- | --- | --- |
| ระบบปฏิบัติการ | **Raspberry Pi OS Lite (64-bit)** Debian 13 "trixie" | หน้าดาวน์โหลดทางการ: ภาพลงวันที่ 6 ต.ค. 2026, kernel 6.18, ดาวน์โหลด 525 MB เลือก *Lite* เพราะไม่มีเดสก์ท็อป ใช้ RAM และเวลา boot น้อยกว่า และโปรเจกต์นี้ใช้ผ่าน SSH อย่างเดียว เลือก *64-bit* เพราะ PyPI มี wheel ของ `opencv-python-headless` สำหรับ aarch64 (รุ่น 5.1.0.95 ที่ตรวจ มี wheel สำหรับ ARM เฉพาะ aarch64 ไม่มี armv7l) บน 32-bit ต้องพึ่ง piwheels หรือ build เอง ซึ่งคู่มือนี้ไม่ได้ตรวจ จึงตัดความเสี่ยงด้วยการใช้ 64-bit |
| OS สำรอง | Raspberry Pi OS (Legacy, 64-bit) **Lite** — Debian 12 "bookworm" kernel 6.12 | ใช้เมื่อ trixie มีปัญหาที่หาสาเหตุไม่ได้ ให้บันทึกอาการก่อนสลับ |
| เครื่องมือเขียนการ์ด | Raspberry Pi Imager **2.0.12 ขึ้นไป** | รุ่นล่าสุดบน GitHub releases ณ วันที่เขียน (ลง 8 ต.ค. 2026) บันทึกรุ่น 2.0.12 ระบุว่าแก้การเก็บรหัส Wi-Fi ที่ทำให้ต่อ WPA3/SAE ไม่ได้ในรุ่นก่อนหน้า |
| รุ่น Pi | 3B, 3B+, 4B, 5, Zero 2 W | ภาพ 64-bit ของ trixie ระบุรุ่นที่รองรับ **ไม่รวม** Pi Zero, Zero W, Pi 1, Pi 2 — รุ่นเหล่านั้นใช้กับคู่มือนี้ไม่ได้ |
| Python | ที่มากับ OS (trixie คาดว่า 3.13) | โปรเจกต์ต้อง ≥ 3.10 (`pyproject.toml`) ตรวจด้วย `python3 --version` |
| แพ็กเกจ Python | `raspberry-pi-streaming/requirements.txt` | ดูหมายเหตุ 1 |
| กล้อง | USB UVC เสียบตรงพอร์ต USB ของ Pi | เป็นทางที่ผ่านใน #22 กล้อง CSI (Pi Camera Module) ใช้กับโค้ดปัจจุบันไม่ได้: โค้ดเปิดกล้องผ่าน `cv2.VideoCapture` อย่างเดียว และ README ของโมดูลระบุว่า Picamera2 เป็นงานในอนาคต (ถ้าจะใช้ USB + CSI ทั้งคู่ ดูหัวข้อ 12) |

**หมายเหตุ 1 — ชุดแพ็กเกจที่ติดตั้งใหม่ยังไม่เคยผ่านกับกล้องจริง.** ณ วันที่เขียน `pip install -r requirements.txt` จะได้ Flask 3.1.3, gunicorn 26.2.0 และ `opencv-python-headless` 5.1.0.95 (รุ่นสูงสุดที่ pin `>=4.13,<6` ยอมรับ) การจำลองด้วย `pip install --dry-run` สำหรับ aarch64 + Python 3.13 ได้ wheel ครบทุกตัว (รวม numpy 2.5.5) แปลว่า *ติดตั้งได้* แต่ไม่ได้พิสูจน์ว่าทำงานกับกล้องได้ ส่วนหลักฐาน #22 บันทึก gunicorn 23.0.0 ซึ่งไม่ตรงกับ pin ใน repo (`>=26,<27`; ไฟล์ `requirements.txt` ไม่เคยถูกแก้ตั้งแต่ commit แรก `b7b9176`) และไม่ได้บันทึกเวอร์ชัน OpenCV ดังนั้นผล PASS ของ #22 ไม่ครอบคลุมชุดนี้ **ต้องรัน CAM-xx ใหม่ทั้งชุดบน Pi เครื่องใหม่** ถ้า OpenCV 5.x มีปัญหา ให้ลดเป็น `opencv-python-headless==4.13.0.92` (มี wheel aarch64 บน PyPI) แล้วบันทึกเหตุผล

**หมายเหตุ 2 — รุ่น Pi ของ #22 ไม่ได้บันทึกไว้.** หลักฐานระบุเคอร์เนลที่ใช้ไดรเวอร์ `dwc_otg` ซึ่งมักพบในบอร์ดตระกูล Pi 3 / Zero 2 W แต่ไม่ยืนยันรุ่น ให้ดูชื่อรุ่นจากตัวบอร์ดและบันทึกใน manifest (หัวข้อ 8.4)

---

## 2. เตรียมของและตัดสินข้อมูลก่อนเริ่ม

### 2.1 ของที่ต้องมี

| ของ | ข้อกำหนด | หมายเหตุ |
| --- | --- | --- |
| Raspberry Pi | 3B / 3B+ / 4B / 5 / Zero 2 W | ดูรุ่นจากตัวบอร์ด |
| แหล่งจ่ายไฟ | Pi 3/3B+ และ Zero 2 W: 5 V 2.5 A (micro-USB); Pi 4: 5 V 3 A (USB-C); Pi 5: 5 V 5 A / 27 W (USB-C) | ตามคู่มือทางการ ไฟไม่พอทำให้กล้อง USB หลุดและการ์ดเสียหายได้ |
| microSD | ≥ 8 GB ตามคู่มือทางการสำหรับ Lite; แนะนำ 32 GB ยี่ห้อที่มีชื่อ | **ข้อมูลในการ์ดถูกลบทั้งหมด** ถ้ามีการ์ดระบบเก่าของ #22 ที่ยังใช้ได้ ให้เก็บไว้เป็นตัวสำรองและใช้การ์ดใบใหม่ |
| ตัวอ่านการ์ด | USB | |
| กล้อง | USB UVC (เช่นตัวเดิมใน #22: Generalplus `1b3f:2247`) | เสียบตรงกับพอร์ต USB ของ Pi ไม่ผ่าน hub ที่ไม่มีไฟเลี้ยง; Zero 2 W ต้องใช้ตัวแปลง micro-USB OTG |
| ทางสำรองเข้าเครื่อง | สาย Ethernet (Pi 3/4/5) **หรือ** จอ HDMI + คีย์บอร์ด | ใช้เมื่อ Wi-Fi ไม่ติดหรือตั้ง IP พลาด (Zero 2 W ไม่มีพอร์ต Ethernet ให้ใช้จอ + คีย์บอร์ด) |
| PC | Windows 11 | มี `ssh`, `scp`, `curl.exe` อยู่แล้ว (ตรวจบนเครื่องนี้: OpenSSH_for_Windows_9.5p2) |

### 2.2 ข้อมูลที่ต้องตัดสินก่อนเขียนการ์ด

| รายการ | ค่าที่ใช้ในคู่มือ | หมายเหตุ |
| --- | --- | --- |
| เครือข่าย | วงเดียวกับ ESP32 | ESP32 ฝัง `172.20.10.5/28` ซึ่งเป็นวง iPhone Personal Hotspot (ปัญหา P1 ในแผนทดสอบ) ถ้าใช้ router อื่นต้องแก้ firmware ของ ESP32 และใช้ IP ของวงนั้นแทนในคู่มือนี้ |
| IP ของ Pi | `172.20.10.6` | ตรงกับแผน IP ในภาคผนวก B ของแผนทดสอบ |
| hostname | `cn360-cam` | |
| ผู้ใช้ผู้ดูแลระบบ | `camadmin` | **ห้ามใช้ชื่อ `cn360`** เพราะเป็นชื่อบัญชีที่รันบริการ (หัวข้อ 7) |
| รหัสผ่านผู้ใช้ | ยาว ≥ 12 ตัวอักษร เก็บใน password manager | ไม่ใส่ในไฟล์ใน repo |

ถ้าใช้ iPhone Personal Hotspot:

- เปิด **Maximize Compatibility** (บังคับคลื่น 2.4 GHz) เพราะ ESP32 ต่อได้เฉพาะ 2.4 GHz และ Pi 3B / Zero 2 W ก็ต่อได้เฉพาะ 2.4 GHz
- เปิดหน้า Settings → Personal Hotspot ค้างไว้ตอนอุปกรณ์เชื่อมต่อครั้งแรก เพราะ hotspot ปิดเองเมื่อไม่มีอุปกรณ์ต่ออยู่ระยะหนึ่ง
- iPhone ไม่แสดง IP ของอุปกรณ์ที่ต่ออยู่ จึงหา Pi ด้วยชื่อ `cn360-cam.local` (หัวข้อ 4)

---

## 3. เขียน SD card ด้วย Raspberry Pi Imager (บน PC)

ชื่อเมนูด้านล่างอ้างจากเอกสารทางการของ Imager 2.x อาจต่างเล็กน้อยตามรุ่น ให้ยึดตามค่าที่ต้องกรอกเป็นหลัก

1. ดาวน์โหลดจาก <https://www.raspberrypi.com/software/> (ปุ่ม *Download for Windows*) ติดตั้งและเปิดโปรแกรม ใช้รุ่นล่าสุดจากหน้านี้ (ณ วันที่เขียนคือ 2.0.12)
2. ใส่ microSD ในตัวอ่านการ์ดที่ต่อกับ PC
3. **Device:** เลือกรุ่น Pi ของคุณ
4. **OS:** เลือก *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)** อย่าเลือกรุ่น Full หรือรุ่นที่มีเดสก์ท็อป
5. **Storage:** เลือกการ์ดให้ถูกใบ ตรวจขนาดให้ตรงกับการ์ดที่ใส่ — ขั้นตอนเขียนจะลบข้อมูลทั้งหมดในใบที่เลือก
6. **Customisation:** กรอกตามตาราง

   | หน้า | ค่าที่กรอก |
   | --- | --- |
   | Hostname | `cn360-cam` |
   | Localisation | เลือกเมืองหลวงเป็น Bangkok — ตั้ง time zone, keyboard และ Wi-Fi regulatory domain (TH) ให้ตั้งแต่ Imager 2.0 |
   | User | username `camadmin` และรหัสผ่าน (จำเป็นต้องมี ไม่มีผู้ใช้ค่าเริ่มต้นแล้ว) |
   | Wi-Fi | SSID และรหัสผ่านของวงที่เลือกในหัวข้อ 2.2 (ติ๊ก Hidden SSID เฉพาะเมื่อ hotspot/AP ซ่อนชื่อ) |
   | Remote access | เปิด SSH แล้วเลือก public key (แนะนำ) หรือรหัสผ่าน |
   | Raspberry Pi Connect | ปิดหรือข้าม ไม่จำเป็นกับโปรเจกต์นี้ |

   ถ้าเลือก public key ให้สร้างและคัดลอกกุญแจบน PC ก่อน (ถ้ามีกุญแจ `id_ed25519` อยู่แล้วจะไม่สร้างทับ):

   ```powershell
   if (-not (Test-Path "$env:USERPROFILE\.ssh\id_ed25519.pub")) { ssh-keygen -t ed25519 }
   Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | Set-Clipboard
   ```

   แล้ววางข้อความที่คัดลอกในช่องกุญแจของ Imager ต้องเป็นไฟล์ `.pub` เท่านั้น ห้ามวาง private key
7. **Write:** ยืนยัน รอจนเขียนและตรวจสอบ (verify) เสร็จ แล้วถอดการ์ดออกจาก PC ตามขั้นตอนของโปรแกรม

Imager 2.x ฝังค่าที่กรอกเป็นไฟล์ cloud-init บน boot partition ของการ์ด (`user-data`, `network-config`, `meta-data`) ถ้า boot แล้วเข้าเครื่องไม่ได้ ให้ดูหัวข้อ 10

---

## 4. boot ครั้งแรกและเข้าเครื่อง

1. ใส่การ์ดใน Pi ต่อกล้อง USB ต่อสาย Ethernet (ถ้ามี) แล้วจ่ายไฟ
2. รอ 2–5 นาทีโดยไม่ดึงไฟ ไฟ ACT สีเขียวกะพริบคือกำลังอ่านการ์ด ครั้งแรกระบบจะขยายพาร์ทิชันและใช้ค่าที่กรอกใน Imager และอาจรีบูตเองหนึ่งครั้ง
3. หาเครื่องและเข้า SSH จาก PC (PowerShell):

   ```powershell
   ping -4 cn360-cam.local
   ssh camadmin@cn360-cam.local
   ```

   ครั้งแรกจะถามยืนยัน fingerprint ให้พิมพ์ `yes` แล้วใส่รหัสผ่าน (ถ้าใช้ public key จะเข้าเลย) ถ้า `cn360-cam.local` ไม่ตอบ ให้ดูหัวข้อ 10
4. ตรวจว่าได้ภาพที่ถูกต้อง (บน Pi):

   ```bash
   grep -E 'PRETTY_NAME|VERSION_CODENAME' /etc/os-release
   uname -m
   python3 --version
   tr -d '\0' < /proc/device-tree/model; echo
   ```

   ผลที่ควรเห็น: `Debian GNU/Linux 13 (trixie)`, `VERSION_CODENAME=trixie`, `aarch64`, Python 3.10 ขึ้นไป และชื่อรุ่น Pi (จดไว้) ถ้า `uname -m` ไม่ใช่ `aarch64` แปลว่าเขียนภาพ 32-bit ให้กลับไปหัวข้อ 3
5. อัปเดตระบบ (5–15 นาที) แล้วต่อ SSH ใหม่หลังรีบูต:

   ```bash
   sudo apt update && sudo apt full-upgrade -y
   sudo reboot
   ```

---

## 5. ตั้งเครือข่ายให้ตรงแผน

Imager สร้างโปรไฟล์ Wi-Fi ให้แล้ว (ชื่อขึ้นต้นด้วย `netplan-`) แต่เป็น DHCP จึงอาจได้ IP ไม่ตรงแผน และไม่ได้ปิดโหมดประหยัดพลังงานของ Wi-Fi ซึ่งทำให้สตรีมหน่วงเป็นช่วง ๆ ได้ คู่มือนี้จึงสร้างโปรไฟล์ **ใหม่** ชื่อ `cn360-wifi` ที่ตั้ง IP ตายตัว ปิด power-save และมีลำดับความสำคัญสูงกว่า เหตุผลที่ไม่แก้โปรไฟล์เดิม: เอกสารทางการระบุว่า NetworkManager เขียนโปรไฟล์ที่ขึ้นต้นด้วย `netplan-` กลับเข้า `/etc/netplan/` ส่วนโปรไฟล์ที่สร้างเองใน `/etc/NetworkManager/system-connections/` ไม่ถูกแตะ จึงไม่เสี่ยงถูกเขียนทับตอน boot

### 5.1 วงเดียวกับ ESP32 (iPhone Personal Hotspot)

ทำขั้นตอนนี้เมื่อมีทางสำรอง (สาย Ethernet หรือจอ + คีย์บอร์ด) เพราะ SSH จะหลุดเมื่อ IP เปลี่ยน

```bash
# ดูโปรไฟล์ที่มีอยู่ (จดชื่อโปรไฟล์ Wi-Fi เดิมไว้ ใช้เป็นทางถอยในหัวข้อ 10)
nmcli -f NAME,TYPE,DEVICE connection show

# สร้างโปรไฟล์ใหม่ที่ตั้ง IP ตายตัว (ไม่เก็บรหัสผ่านไว้ใน shell history)
read -rp "SSID: " WIFI_SSID
read -rsp "รหัสผ่าน Wi-Fi: " WIFI_PASS; echo
sudo nmcli connection add type wifi con-name cn360-wifi ifname wlan0 ssid "$WIFI_SSID" \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$WIFI_PASS" \
  ipv4.method manual ipv4.addresses 172.20.10.6/28 ipv4.gateway 172.20.10.1 ipv4.dns 172.20.10.1 \
  802-11-wireless.powersave 2 \
  connection.autoconnect yes connection.autoconnect-priority 100
unset WIFI_PASS

# สลับไปใช้โปรไฟล์ใหม่ — SSH จะค้าง/หลุด ให้ต่อใหม่ที่ camadmin@172.20.10.6
sudo nmcli connection up cn360-wifi
```

`172.20.10.6/28` และ gateway `172.20.10.1` มาจากแผน IP ของแผนทดสอบ (วง `172.20.10.0/28` ของ iPhone) ถ้า hotspot ของคุณใช้วงอื่นให้ใช้ค่าของวงนั้น และต้องตรงกับวงที่ ESP32 ถูกตั้งไว้

### 5.2 ใช้ router หรือวงอื่น

จองที่อยู่ให้ Pi ที่ router โดยใช้ MAC ของ Pi (ดูด้วย `cat /sys/class/net/wlan0/address`, ใช้ `eth0` แทนถ้าต่อสาย) แล้วใช้คำสั่งในหัวข้อ 5.1 โดยตัดพารามิเตอร์ `ipv4.method manual ipv4.addresses ... ipv4.gateway ... ipv4.dns ...` ออก เพื่อให้ยังได้ IP ผ่าน DHCP และคงการปิด power-save กับ priority ไว้ ถ้าไม่ได้ใช้วงของ hotspot ต้องแก้ firmware ของ ESP32 ให้ตรงกับวงนั้นด้วย (นอกขอบเขตของคู่มือนี้ ดู P1 ในแผนทดสอบ)

### 5.3 ตรวจผล (หลังต่อ SSH ใหม่ที่ IP ใหม่)

```bash
nmcli -g GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY device show wlan0
nmcli -g 802-11-wireless.powersave connection show cn360-wifi
ping -c 3 172.20.10.1
timedatectl
```

ผลที่ควรเห็น: `cn360-wifi`, `172.20.10.6/28`, `172.20.10.1`, ค่า powersave เป็น `2` (ปิด) และ ping gateway ได้ ส่วน `timedatectl` ควรขึ้น `System clock synchronized: yes` ถ้า hotspot ไม่มีอินเทอร์เน็ต Pi จะไม่มีเวลาที่ถูกต้อง (ไม่มี RTC) ซึ่งไม่กระทบการทำงาน แต่ค่า `X-Captured-At` จะผิดและต้องไม่นำไปเทียบกับเครื่องอื่น (กฎเรื่องนาฬิกาข้ามเครื่องของแผนทดสอบ)

### 5.4 ตรวจจาก PC ว่า IP ไม่ชนกับเครื่องอื่น

```powershell
ping -n 4 172.20.10.6
arp -a | Select-String '172.20.10'
```

IP `172.20.10.6` ต้องตอบจาก Pi เครื่องเดียว บน hotspot ที่ไม่มี DHCP reservation ให้เปิดอุปกรณ์ทั้งหมดแล้วตรวจอีกครั้ง ถ้าอุปกรณ์อื่นได้ `.5` หรือ `.6` ไปก่อน ต้องแก้ที่อุปกรณ์นั้นหรือเปลี่ยน IP ของ Pi

---

## 6. ต่อกล้องและตรวจก่อนติดตั้งโปรแกรม

### 6.1 ติดตั้งเครื่องมือและตรวจว่าเห็นกล้อง

```bash
sudo apt install -y python3-venv v4l-utils usbutils
lsusb
ls -l /dev/video*
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video0 --list-formats-ext
sudo dmesg | grep -i -E 'uvc|usb' | tail -20
```

ผลที่ควรเห็น: `lsusb` แสดงกล้อง (ตัวเดิมของ #22 คือ `1b3f:2247`), มี `/dev/video0` และ `--list-formats-ext` แสดงรูปแบบ (MJPG / YUYV) พร้อมความละเอียดและ FPS ที่กล้องรองรับจริง **จดค่านี้ไว้** เพราะกำหนดว่า `/info` จะรายงานความละเอียดเท่าไร (CAM-03) และความละเอียดนั้นต้องเป็นค่าเดียวกับที่ใช้เก็บข้อมูลใน Phase 7

ถ้ามีอุปกรณ์วิดีโออื่นในรายการ (Pi รุ่นใหม่มีโหนดของตัวแปลงรหัส/ISP) ให้ดูว่าโหนดของกล้อง USB เป็นเลขอะไรใน `v4l2-ctl --list-devices` แล้วตั้ง `CAMERA_SOURCE` ให้ตรงในหัวข้อ 7.5

### 6.2 ถ้ากล้องเห็นแต่ไม่มีภาพ หรือภาพแตก

#22 บันทึกว่ากล้อง Generalplus ตัวเดิมต้องใช้ `uvcvideo` พร้อม `quirks=0x80` (วิธีลดการจองแบนด์วิดท์ USB) ถ้าใช้กล้องตัวเดียวกัน หรือ `dmesg` แสดงข้อผิดพลาดของ `uvcvideo` ให้ลอง:

```bash
echo 'options uvcvideo quirks=0x80' | sudo tee /etc/modprobe.d/uvcvideo.conf
sudo reboot
# หลังรีบูตตรวจว่าค่าเข้า: ต้องได้ 128
cat /sys/module/uvcvideo/parameters/quirks
```

---

## 7. ติดตั้งโปรแกรมกล้อง (`raspberry-pi-streaming`)

### 7.1 ส่งโค้ดจาก PC ไป Pi

ใช้ `git archive` เพื่อส่งเฉพาะไฟล์ที่ commit แล้ว ไม่พา `.venv`, cache หรือไฟล์ลับไปด้วย และอ้างอิงถึง commit ที่แน่นอนได้ (ลองกับ repo นี้แล้ว: ได้ 20 ไฟล์)

```powershell
# รันที่โฟลเดอร์ root ของ repo บน PC
git status --short raspberry-pi-streaming          # ต้องว่าง ไม่งั้นส่วนที่แก้ค้างจะไม่ถูกส่งไป
git rev-parse --short HEAD                         # จด commit นี้ไว้ในบันทึกหลักฐาน
git archive --format=tar.gz "--output=$env:TEMP\cn360-camera.tgz" HEAD raspberry-pi-streaming
scp "$env:TEMP\cn360-camera.tgz" camadmin@172.20.10.6:/tmp/
```

### 7.2 สร้างบัญชีบริการ, ติดตั้ง venv และแพ็กเกจ (บน Pi)

บัญชี `cn360` เป็นบัญชีระบบที่รันบริการ (ไม่ใช่บัญชีที่ล็อกอิน) ตามที่ README ของโมดูลกำหนด `--only-binary=:all:` ทำให้ `pip` ล้มทันทีถ้าไม่มี wheel แทนที่จะพยายาม build จากซอร์สนานหลายชั่วโมง

```bash
sudo mkdir -p /opt/cn360
sudo tar -xzf /tmp/cn360-camera.tgz -C /opt/cn360
sudo useradd --system --home-dir /opt/cn360 --shell /usr/sbin/nologin --groups video cn360
sudo chown -R cn360:cn360 /opt/cn360

cd /opt/cn360/raspberry-pi-streaming
sudo -u cn360 -H python3 -m venv .venv
sudo -u cn360 -H .venv/bin/python -m pip install --upgrade pip
sudo -u cn360 -H .venv/bin/python -m pip install --only-binary=:all: -r requirements-dev.txt
```

ผลที่ควรเห็น: `pip` ดาวน์โหลด wheel ของ OpenCV (ราว 36–40 MB) และจบด้วย `Successfully installed ...` ถ้าขึ้นข้อความว่าไม่พบ wheel ที่ตรงกัน ให้ตรวจ `uname -m` (ต้องเป็น `aarch64`) ก่อนอย่างอื่น

### 7.3 รัน unit test (ไม่ต้องใช้กล้อง)

```bash
sudo -u cn360 -H .venv/bin/python -m pytest
```

ต้องผ่านทั้งหมด (ชุดทดสอบใช้ OpenCV/กล้องจำลอง) ถ้าล้มให้เก็บผลไว้และหยุดตรงนี้ เพราะแปลว่าแพ็กเกจที่ได้ไม่เข้ากับโค้ด (ดูหมายเหตุ 1)

### 7.4 ลองรันด้วยมือก่อนตั้งเป็น service

```bash
cd /opt/cn360/raspberry-pi-streaming
sudo -u cn360 -H env HOST=0.0.0.0 PORT=8000 CAMERA_SOURCE=0 .venv/bin/python app.py
```

เปิดอีกหน้าต่างบน PC แล้วทดสอบตามหัวข้อ 8.1 ถ้า `/health` ขึ้น 200 ให้กด Ctrl+C หยุดโปรแกรมแล้วไปขั้นถัดไป กล้องเปิดได้ทีละโปรเซส จึงต้องหยุดตัวนี้ก่อนเปิด service (และถ้าติดตั้ง service ไว้แล้วต้อง `sudo systemctl stop cn360-camera` ก่อนรันขั้นตอนนี้)

### 7.5 ตั้งเป็น systemd service

```bash
sudo cp /opt/cn360/raspberry-pi-streaming/.env.example /etc/cn360-camera.env
sudo nano /etc/cn360-camera.env
sudo cp /opt/cn360/raspberry-pi-streaming/deploy/cn360-camera.service /etc/systemd/system/cn360-camera.service
sudo systemd-analyze verify /etc/systemd/system/cn360-camera.service
sudo systemctl daemon-reload
sudo systemctl enable --now cn360-camera
systemctl status cn360-camera --no-pager
journalctl -u cn360-camera -n 50 --no-pager
```

ค่าใน `/etc/cn360-camera.env` ที่ต้องตรวจ (ความหมายเต็มอยู่ใน [README ของโมดูล](../../raspberry-pi-streaming/README.md)):

| ตัวแปร | ค่าตอน bring-up | หมายเหตุ |
| --- | --- | --- |
| `CAMERA_SOURCE` | `0` | เปลี่ยนเป็นเลขอื่นหรือ `/dev/videoN` ถ้าโหนดกล้อง USB ไม่ใช่ `/dev/video0` |
| `CAMERA_WIDTH` / `CAMERA_HEIGHT` | `1920` / `1080` | เป็นค่าที่ *ขอ* กล้องอาจให้โหมดอื่น (ใน #22 ได้ 640×480) ให้ดู `actualWidth/actualHeight` ใน `/info` แล้วบันทึกตาม CAM-03 |
| `CAMERA_FPS` | `15` | |
| `CORS_ALLOWED_ORIGIN` | `*` | คงไว้ช่วง bring-up (LAN ทดลอง) แล้วจำกัดเป็น origin ของ HUD หลังผ่านการทดสอบ |
| `N8N_WEBHOOK_URL` | ว่าง | ใช้โหมด pull (`GET /capture`) ก่อน เปิดโหมด push เมื่อถึง CAM-09 |
| `PUSH_INTERVAL_SECONDS` | `0` | |

ผลที่ควรเห็น: `Active: active (running)`, log มี `Listening at: http://0.0.0.0:8000` และไม่มีบรรทัด `Camera unavailable` หลังแก้ไฟล์ env ใช้ `sudo systemctl restart cn360-camera`

### 7.6 อัปเดตโค้ดภายหลัง

ส่งไฟล์ใหม่ตามหัวข้อ 7.1 แล้วบน Pi:

```bash
sudo tar -xzf /tmp/cn360-camera.tgz -C /opt/cn360
sudo chown -R cn360:cn360 /opt/cn360
sudo systemctl restart cn360-camera
```

ถ้า `requirements.txt` เปลี่ยนให้รันคำสั่ง `pip install` ในหัวข้อ 7.2 ซ้ำก่อนรีสตาร์ต และบันทึก commit ที่ใช้ทุกครั้ง

---

## 8. ตรวจรับ

### 8.1 ตรวจจาก PC

```powershell
$cam = '172.20.10.6'
curl.exe -s -i "http://${cam}:8000/health"
curl.exe -s "http://${cam}:8000/info"
curl.exe -s -D - -o "$env:TEMP\cap.jpg" "http://${cam}:8000/capture"
Start-Process "http://${cam}:8000/stream.mjpg"
```

| จุดตรวจ | ผลที่ควรเห็น |
| --- | --- |
| `/health` | `HTTP/1.1 200`, `"status":"ok"`, `camera.healthy: true`, `state: "running"`, `fresh: true`, `frameAgeMs` ต่ำกว่า 3000 (CAM-01) |
| `/info` | `camera.actualWidth/actualHeight` เป็นความละเอียดจริง (CAM-03), `endpoints` ครบ 5 รายการ, `push.enabled: false` |
| `/capture` | `200`, `Content-Type: image/jpeg` และ header ครบ 5 ตัว: `X-Camera-Session`, `X-Frame-Sequence`, `X-Captured-At`, `X-Frame-Width`, `X-Frame-Height` (CAM-02); ไฟล์ `cap.jpg` เปิดดูได้ |
| `/stream.mjpg` | เบราว์เซอร์แสดงภาพเคลื่อนไหวจากกล้อง |

### 8.2 วัด FPS จริง

```powershell
$cam = '172.20.10.6'
$sw = [Diagnostics.Stopwatch]::StartNew()
$a = (curl.exe -s "http://${cam}:8000/health" | ConvertFrom-Json).camera.frameSequence
Start-Sleep -Seconds 10
$b = (curl.exe -s "http://${cam}:8000/health" | ConvertFrom-Json).camera.frameSequence
'FPS ประมาณ {0:N1} (ค่าที่ตั้ง CAMERA_FPS=15)' -f (($b - $a) / $sw.Elapsed.TotalSeconds)
```

บันทึกผลเป็นข้อมูลของ CAM-05 (ต้องวัดความหน่วง glass-to-glass บน HUD ด้วย ตามแผนทดสอบ)

### 8.3 ทดสอบ reboot (ทำเต็มเป็น CAM-07 ×3 ภายหลัง)

บน Pi `sudo reboot` หรือถอดแล้วเสียบสายไฟ แล้วรันบน PC ทันทีที่จ่ายไฟ:

```powershell
$cam = '172.20.10.6'
$sw = [Diagnostics.Stopwatch]::StartNew()
do {
  Start-Sleep -Milliseconds 500
  $code = curl.exe -s -m 2 -o NUL -w "%{http_code}" "http://${cam}:8000/health"
} until ($code -eq '200' -or $sw.Elapsed.TotalMinutes -gt 5)
'/health = {0} หลัง {1:N1} วินาที' -f $code, $sw.Elapsed.TotalSeconds
```

ผลที่ควรเห็น: service ขึ้นเองโดยไม่ต้องล็อกอิน, `/health` เป็น 200, และ `sessionId` ใน `/health` ต่างจากก่อนรีบูต (`frameSequence` เริ่มนับใหม่)

### 8.4 บันทึก manifest ของเครื่อง (เป็นหลักฐาน)

บน Pi:

```bash
{
  echo "== $(date -u +%FT%TZ)"
  cat /etc/os-release
  uname -a
  tr -d '\0' < /proc/device-tree/model; echo
  /opt/cn360/raspberry-pi-streaming/.venv/bin/python --version
  /opt/cn360/raspberry-pi-streaming/.venv/bin/python -m pip freeze
  /opt/cn360/raspberry-pi-streaming/.venv/bin/python -c "import cv2; print('cv2', cv2.__version__)"
  lsusb
  v4l2-ctl --list-devices
  vcgencmd get_throttled
  systemctl status cn360-camera --no-pager
} > /tmp/camera-node-manifest.txt 2>&1
```

ดึงมาที่ PC แล้วเก็บในโฟลเดอร์หลักฐานของรอบทดสอบ (`docs/evidence/full-system-<yyyy-mm-dd>/logs/` ตามหัวข้อ 8 ของแผนทดสอบ) พร้อม commit ที่จดไว้ในหัวข้อ 7.1:

```powershell
scp camadmin@172.20.10.6:/tmp/camera-node-manifest.txt .
```

ก่อนเก็บเข้า repo ให้เปิดไฟล์ตรวจว่าไม่มีรหัสผ่าน, SSID ที่ไม่ต้องการเปิดเผย หรือกุญแจใด ๆ (คำสั่งข้างต้นไม่ได้พิมพ์ค่าเหล่านี้ แต่ควรตรวจก่อนเสมอ) `vcgencmd get_throttled` ควรได้ `throttled=0x0` ถ้าไม่ใช่แปลว่าไฟไม่พอหรือร้อนเกิน

### 8.5 เกณฑ์ผ่านของ Pi (ก่อนเริ่มชุด CAM)

- [ ] `/health` = 200 ต่อเนื่องอย่างน้อย 5 นาที
- [ ] วัด FPS แล้ว และบันทึกความละเอียดจริงจาก `/info`
- [ ] `/capture` ได้ภาพ JPEG และ header ครบ 5 ตัว
- [ ] reboot แล้ว service ขึ้นเอง และ `sessionId` เปลี่ยน
- [ ] ถอดสาย USB กล้อง → `/health` เป็น 503; เสียบกลับ → กลับเป็น 200 เอง (ทดสอบย่อของ CAM-06)
- [ ] manifest บันทึกแล้ว (รวมรุ่น Pi, เวอร์ชัน OS, เวอร์ชัน `cv2`, commit ที่ส่งไป)
- [ ] (แนะนำ) ทำ image สำรองแล้ว (หัวข้อ 9)

---

## 9. สำรอง image (ทางเลือก แต่ช่วยลดเวลารอ setup ตอนเครื่องมีปัญหา)

ทำหลังผ่านหัวข้อ 8.5 ทั้งหมด

1. ปิดเครื่องอย่างถูกต้อง: `sudo shutdown -h now` รอให้ไฟ ACT หยุดกะพริบก่อนถอดไฟ
2. ถอดการ์ดมาใส่ PC แล้วอ่านทั้งการ์ดเป็นไฟล์ `.img` ด้วยเครื่องมืออ่านดิสก์แบบ raw เช่น Win32 Disk Imager (โหมด Read) — คู่มือนี้ไม่ได้ลองกับเครื่องมือนี้ ให้ตรวจผลตามจริง ไฟล์ที่ได้ใหญ่เท่าขนาดการ์ด (เช่น 32 GB) บีบอัดเก็บได้
3. สร้างเครื่องที่สอง: ใน Imager เลือก OS แบบ *Use custom* ชี้ไปที่ไฟล์ `.img` แล้วเขียนลงการ์ดใบใหม่
4. **ห้ามเปิดสองเครื่องพร้อมกันบนวงเดียวกัน** เพราะ hostname และ IP ตายตัว (`172.20.10.6`) จะชนกัน เปลี่ยนค่าในเครื่องที่สองก่อนถ้าต้องใช้คู่กัน
5. ใช้ได้เฉพาะกับ Pi รุ่นเดียวกัน ถ้าเปลี่ยนรุ่น ให้เขียนใหม่ด้วย Imager ตามหัวข้อ 3

---

## 10. ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อย | ตรวจ / แก้ |
| --- | --- | --- |
| ไฟ ACT ไม่กะพริบเลย Pi ไม่ boot | การ์ดเขียนไม่สำเร็จ, ไฟไม่พอ, การ์ดเสีย | เขียนการ์ดใหม่ (ให้ verify ครบ), ลองแหล่งจ่ายไฟ/สายอื่น, ลองการ์ดอีกใบ |
| `ping cn360-cam.local` ไม่ตอบ | Wi-Fi ไม่ติด (SSID/รหัสผ่านผิด, hotspot ปิดเอง, ยังไม่ได้เปิด Maximize Compatibility), mDNS ไม่ผ่านเครือข่าย | เปิดหน้า Personal Hotspot ค้างไว้; ต่อสาย Ethernet แล้วหา IP จาก router หรือ `arp -a`; หรือต่อจอ + คีย์บอร์ดแล้วรัน `hostname -I` และ `nmcli device wifi list` |
| เสียบการ์ดคืน PC แล้วไดรฟ์ boot ไม่มี `user-data` / `network-config` | Imager ไม่ได้เขียนค่า customisation (รุ่นเก่าหรือข้ามหน้า customisation) | เขียนใหม่ด้วย Imager 2.0.12 ขึ้นไปและกรอกให้ครบ ถ้าแก้ไฟล์เอง ไฟล์ `user-data` ต้องขึ้นต้นด้วย `#cloud-config` |
| `ssh: Permission denied` | username หรือรหัสผ่านผิด, วางกุญแจผิดไฟล์ | ใช้ `camadmin` ตามที่กรอกใน Imager; ถ้าใช้กุญแจต้องเป็นไฟล์ `.pub` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` หลังเขียนการ์ดใหม่ | host key เปลี่ยน | `ssh-keygen -R cn360-cam.local` และ `ssh-keygen -R 172.20.10.6` |
| `pip` ขึ้น `externally-managed-environment` | ใช้ `pip` นอก venv | ใช้ `.venv/bin/python -m pip` ตามคู่มือ อย่าใช้ `sudo pip` |
| `pip` ไม่พบ wheel / พยายาม build OpenCV | OS เป็น 32-bit หรือรุ่นที่ไม่มี wheel | `uname -m` ต้องเป็น `aarch64`; ถ้าไม่ใช่ให้เขียนการ์ดใหม่ด้วยภาพ 64-bit |
| ตั้ง IP ตายตัวแล้วเข้าไม่ได้ | subnet/gateway ผิด หรือ IP ชนกับเครื่องอื่น | เข้าทางสำรอง (Ethernet หรือจอ + คีย์บอร์ด) แล้ว `sudo nmcli connection down cn360-wifi` เพื่อกลับไปใช้โปรไฟล์ DHCP เดิม (หรือ `sudo nmcli connection delete cn360-wifi` แล้วทำหัวข้อ 5 ใหม่) |
| `/health` = 503 และ `lastError` เป็น `could not open camera source` | ไม่เห็นกล้อง, index ไม่ตรง, สิทธิ์, หรือโปรเซสอื่นเปิดกล้องอยู่ | `ls -l /dev/video*` และ `v4l2-ctl --list-devices`; `id cn360` ต้องมีกลุ่ม `video`; `sudo fuser -v /dev/video0`; `journalctl -u cn360-camera -e` |
| `/health` = 503 เป็นช่วง ๆ หรือ `camera read failed` | USB หลุด, ไฟไม่พอ, แบนด์วิดท์ USB | `vcgencmd get_throttled` ต้องเป็น `0x0`; เสียบกล้องตรงไม่ผ่าน hub; ลอง quirk ในหัวข้อ 6.2 |
| `/info` แสดง 640×480 ทั้งที่ขอ 1920×1080 | กล้องไม่รองรับโหมดที่ขอ (เหมือนที่เกิดใน #22) | ไม่ใช่ความผิดของ Pi; บันทึกเป็น CAM-03 และใช้ความละเอียดเดียวกันตลอดเฟสเก็บข้อมูล ดูโหมดที่รองรับจริงด้วย `v4l2-ctl --list-formats-ext` |
| FPS ต่ำกว่าที่ตั้งที่ความละเอียดสูง | กล้องส่ง YUYV ผ่าน USB 2.0 ได้ช้า; โค้ดปัจจุบันไม่ตั้ง FOURCC เป็น MJPG | ลด `CAMERA_WIDTH/HEIGHT` ใน `/etc/cn360-camera.env` แล้ว `sudo systemctl restart cn360-camera` และบันทึกผล (การบังคับ MJPG ต้องแก้โค้ด ซึ่งยังไม่ได้ทำ) |
| สตรีมกระตุกเป็นช่วง ๆ ทาง Wi-Fi | power-save, สัญญาณอ่อน | ตรวจว่า powersave เป็น `2` (หัวข้อ 5.3); ใช้สาย Ethernet ถ้าติดตั้งได้ |
| `systemctl status cn360-camera` เป็น failed | path, สิทธิ์ หรือค่าใน env ผิด | `journalctl -u cn360-camera -e`; `sudo systemd-analyze verify /etc/systemd/system/cn360-camera.service`; `ls -ld /opt/cn360/raspberry-pi-streaming` ต้องเป็นของ `cn360` |

---

## 11. ส่งต่อไปยังระบบที่เหลือ

1. **แผนทดสอบ:** กรอก IP ของ Pi ในแผน IP (หัวข้อ 4.3 ของแผนทดสอบ) รัน ENV-02 (เมทริกซ์การเข้าถึง) แล้วรัน CAM-01…CAM-12 บน Pi นี้ — CAM-04 ต้องยิง `/capture` จาก *ภายใน container n8n* ไม่ใช่จาก PC
2. **n8n:** ใน `n8n/runtime.local.json` ตั้ง `piBaseUrl` เป็น `http://172.20.10.6:8000` แล้วรัน `node configure.mjs` ตาม [n8n/README.md](../../n8n/README.md) ห้ามใช้ชื่อ `.local`
3. **HUD บน Pico:** ค่าเริ่มต้นใน [pico-webapp/config.js](../../pico-webapp/config.js) ชี้ไปที่ `http://raspberrypi.local:8000/...` ซึ่งไม่ตรงกับ hostname `cn360-cam` และ Pico ไม่ควรพึ่ง mDNS ให้ตั้ง `raspberryPiStreamUrl` และ `raspberryPiHealthUrl` เป็น IP ของ Pi (หรือกรอกในหน้า Connection settings ของ HUD) และใช้แหล่งกล้องแบบ `remote` บนแว่น
4. **โหมด push (ไม่บังคับ):** ปล่อย `N8N_WEBHOOK_URL` ว่างจนถึง CAM-09 ถ้าเปิดต้องให้ Windows Firewall บน PC อนุญาตพอร์ต webhook ของ n8n จาก LAN
5. **ความลับ:** ห้ามนำรหัสผ่าน Wi-Fi, รหัสผ่านผู้ใช้ หรือ private key ไปไว้ในไฟล์ของ repo หรือหลักฐานที่จะ commit (ตามคำเตือนใน [หลักฐาน #22](../evidence/pi-camera-pico-streaming-2026-10-26.md))

---

## 12. อนาคต: ใช้กล้อง USB และ CSI ทั้งคู่

ผู้ใช้แจ้งเมื่อ 2026-11-21 ว่าในอนาคตอาจใช้ทั้งสองแบบ ตอนนี้ **ไม่ต้องเปลี่ยนขั้นตอนในหัวข้อ 3–8** — เริ่มด้วย USB UVC ซึ่งเป็นทางที่ผ่านใน #22 และใช้เป็นฐานเทียบ หัวข้อนี้บันทึกว่าต้องแก้อะไรเมื่อถึงเวลา และอะไรที่ไม่ควรทำตอนนี้เพื่อไม่ปิดทาง ข้อมูลฝั่ง CSI / Picamera2 ส่วนใหญ่มาจากหน้าเอกสารทางการที่อ่านได้ไม่ครบ (ระบุไว้ในแต่ละข้อ) ให้ตรวจกับเอกสารและฮาร์ดแวร์จริงก่อนลงมือ

### 12.1 "ทั้งคู่" มีสามระดับ ต้องเลือกก่อนออกแบบ

| ระดับ | ความหมาย | ต้องแก้อะไร | ขนาดงาน (ประมาณการของผู้เขียน) |
| --- | --- | --- | --- |
| ก. สลับชนิด | Pi แต่ละเครื่องใช้ CSI **หรือ** USB อย่างใดอย่างหนึ่ง เลือกด้วยค่า env | เพิ่ม backend Picamera2 ใน `CameraService` พร้อมตัวแปรเลือก backend, unit test และเอกสาร | เล็ก |
| ข. พร้อมกัน คนละพอร์ต | Pi เครื่องเดียวมีสองสตรีม เช่น USB `:8000` และ CSI `:8001` | ระดับ ก. + ไฟล์ unit และ env แยกต่อกล้อง + ตั้ง n8n/HUD ให้เลือกกล้อง | เล็กถึงกลาง ส่วนใหญ่เป็นค่าตั้ง |
| ค. สองมุมในรอบตรวจเดียว | ตัดสิน pass/reject จากภาพของทั้งสองกล้องรวมกัน | ระดับ ข. + แก้ workflow ของ n8n ให้เก็บสองภาพ + ให้ Frame Context ระบุว่ากล้อง/มุมไหน + กติการวมผลสองมุม + งบเวลา + ชุดข้อมูลต่อกล้อง | ใหญ่ เป็นการตัดสินใจระดับโดเมน ต้องปรับ [CONTEXT.md](../../CONTEXT.md) ด้วย |

### 12.2 สิ่งที่กระทบทุกระดับ

1. **ข้อมูลและคุณภาพผูกกับกล้อง.** กล้องแต่ละตัวให้ภาพต่างกัน (ความละเอียด สี มุมมอง) ชุดข้อมูลและผล QLT ของ Phase 7 ใช้ข้ามกล้องไม่ได้ ต้องเก็บและวัดใหม่ต่อกล้อง และ CAM-03 ต้องบันทึกความละเอียดจริงของแต่ละตัว
2. **งบเวลา (D1).** ถ้าต้องส่งสองภาพให้โมเดลต่อรอบตรวจ (ระดับ ค.) และเรียงลำดับกัน เวลาโมเดลจะเพิ่มตามจำนวนภาพ (ภาพละราว 1.1 วินาทีตามหลักฐานเดิม) ซึ่งชนงบของ n8n และ Verdict Window ที่ตอนนี้ก็ยังไม่ผ่านอยู่แล้ว — เป็นข้อสรุปของผู้เขียนจากตัวเลขในแผน ยังไม่ได้วัด
3. **แพ็กเกจ.** README ของ Picamera2 แนะนำติดตั้งผ่าน apt เพราะรับประกันว่า Picamera2 กับ libcamera เป็นคู่ที่เข้ากัน และระบุว่า Raspberry Pi OS Lite ไม่มีมาให้ ต้องติดตั้งเอง: `sudo apt install python3-picamera2 --no-install-recommends` venv ในหัวข้อ 7.2 มองไม่เห็นแพ็กเกจของระบบ จึงต้องสร้างใหม่ให้เห็น (ตัวเลือก `--system-site-packages`) และระวังเวอร์ชัน numpy / OpenCV ชนกัน — รายละเอียดอยู่ในคู่มือ Picamera2 (หัวข้อ *Using Python Virtual Environments* และ *OpenCV*) ซึ่งผู้เขียนเปิดอ่านเนื้อหาไม่สำเร็จ ให้ตรวจก่อนทำ มีรายงานจากชุมชน (แหล่งเก่า ยังไม่ยืนยัน) ว่า numpy 2.x ทำให้ `import picamera2` จากแพ็กเกจ apt ล้ม
4. **ฮาร์ดแวร์.** ตามหน้าเอกสารทางการ (สรุปจากหน้าที่อ่านไม่ครบ) Pi 4 มีช่อง CSI 1 ช่อง (15-pin), Pi 5 มี 2 ช่อง (22-pin), ตระกูล Zero ใช้ 22-pin ส่วนจำนวนช่องของ Pi 3 และ Zero 2 W ไม่ได้ระบุในหน้าที่อ่านได้ ให้ตรวจกับสเปกของบอร์ดที่ซื้อและเลือกสายให้ตรงขั้วต่อ การใช้ USB กับ CSI พร้อมกันไม่มีข้อความยืนยันตรง ๆ ในหน้าที่อ่านได้ แต่เป็นคนละบัสและคนละไดรเวอร์ จึงน่าจะใช้ได้ — ต้องทดสอบ รวมถึงภาระ CPU และไฟเลี้ยง

### 12.3 ตอนนี้ควรทำและไม่ควรทำ

ควรทำ:

- ใช้ภาพ OS เดิมต่อ (Raspberry Pi OS Lite 64-bit trixie) เอกสารทางการระบุว่า `rpicam-apps-lite` มากับ Lite และ README ของ Picamera2 ระบุว่ารองรับ Raspberry Pi OS Bullseye ขึ้นไป (ไม่ได้เอ่ยถึง trixie โดยตรง)
- เก็บข้อมูล ภาพตัวอย่าง และผลวัดแยกตามกล้องตั้งแต่ตอนนี้ (เช่นโฟลเดอร์ `usb-1/`) และจดชื่อกล้องใน manifest (หัวข้อ 8.4) เพื่อไม่ต้องเก็บใหม่ทั้งหมดทีหลัง
- ถ้าจะซื้อ Pi หรือสายเพิ่ม ให้เลือกให้ตรงขั้วต่อ CSI ของรุ่น (ข้อ 4 ด้านบน)

ไม่ควรทำ:

- อย่าเปลี่ยนชื่อ service พอร์ต หรือไฟล์ env ของ USB (`cn360-camera.service`, `:8000`, `/etc/cn360-camera.env`) เพราะ n8n, HUD และหลักฐาน #22 อ้างอิงอยู่
- อย่าติดตั้ง Picamera2 หรือสร้าง venv ใหม่บนเครื่องที่กำลังเก็บหลักฐานของ USB ให้ลองบนการ์ดหรือเครื่องแยก

### 12.4 จุดในโค้ดที่เกี่ยวข้อง (ตรวจจากโค้ดเมื่อ 2026-11-21)

| ไฟล์ | ที่พบ | ผลต่อการเพิ่ม CSI |
| --- | --- | --- |
| `raspberry-pi-streaming/pi_stream/config.py` | `_parse_camera_source` ปฏิเสธค่าที่ขึ้นต้นแบบ scheme แต่ไม่มี host (เช่น `csi:0`) ว่าเป็น URL ไม่ถูกต้อง | ควรเพิ่มตัวแปร backend แยก แทนการยัดชนิดกล้องไว้ใน `CAMERA_SOURCE` |
| `raspberry-pi-streaming/pi_stream/camera.py` | `_open_capture()` เป็นจุดเดียวที่เปิดกล้อง และลูป `_run()` เรียกบนตัวกล้องแค่ `isOpened()`, `set()`, `read()`, `release()` | ทำ adapter ที่มีเมธอดชุดนี้ได้โดยไม่แตะส่วน publish / health / capture / stream เฟรมต้องเป็นลำดับสี BGR ที่ `cv2.imencode` คาด (ภาพที่แดงกับน้ำเงินสลับกันคือสัญญาณว่า format ผิด) |
| `raspberry-pi-streaming/app.py` | สร้าง `CameraService` ตัวเดียวระดับโมดูล | หนึ่งโปรเซสต่อหนึ่งกล้อง ระดับ ข. จึงใช้วิธีรันหลาย instance |
| `raspberry-pi-streaming/deploy/cn360-camera.service` | `EnvironmentFile=/etc/cn360-camera.env` ตายตัว | ระดับ ข. ทำสำเนาหรือ template ที่อ่านไฟล์ env ของแต่ละกล้อง (ยังไม่เปลี่ยน เพื่อให้ตรงกับหลักฐาน #22) |
| `n8n/runtime.example.json`, `n8n/workflows/01-inspection-loop.json` | `piBaseUrl` และ URL ของโหนด `capture-frame` มีค่าเดียว | ระดับ ข./ค. ต้องกำหนดว่าจะเรียกกล้องไหน |
| `pico-webapp/config.js` | `raspberryPiStreamUrl` / `raspberryPiHealthUrl` มีค่าเดียว | HUD ต้องเลือกหรือแสดงได้ทั้งสองสตรีม |
| `CONTEXT.md` | Frame Context อ้างตัวตนของเฟรมจาก `X-Camera-Session` แต่ไม่มีแนวคิดว่า "กล้อง/มุมไหน" | ระดับ ค. ต้องเพิ่มแนวคิดนี้และตัดสินว่าผลสองมุมรวมกันอย่างไร |

### 12.5 ทางลัดที่ยังไม่แนะนำ

`config.py` ยอมรับ `CAMERA_SOURCE=tcp://...` อยู่แล้ว จึงมีทางที่ไม่ต้องแก้โค้ด: ให้ `rpicam-vid` ส่งสตรีมออกพอร์ต TCP ในเครื่องแล้วให้ OpenCV อ่าน ตัวอย่างในเอกสารทางการเป็นสตรีม H.264 ผ่าน TCP (`rpicam-vid -t 0 -n --inline --listen -o tcp://0.0.0.0:<port>` สรุปจากหน้าที่อ่านไม่ครบ) ไม่ใช่ MJPEG และไม่มีตัวอย่างอ่านด้วย OpenCV ต้องมีโปรเซสแยกคอยดูแลสตรีม และไม่รู้ความหน่วงหรือพฤติกรรมตอนหลุดต่อใหม่ จึงใช้ได้เพียงเป็นการทดลองชั่วคราว และต้องวัดตาม CAM-04/05/06 ก่อนเชื่อผล

### 12.6 ลำดับเมื่อถึงเวลา

1. เลือกระดับ ก. / ข. / ค. (ตัวเลือก D7 ในแผนทดสอบ)
2. ทำ backend ระดับ ก. บนการ์ดหรือเครื่องแยก พร้อม unit test ด้วยกล้องจำลองแบบเดียวกับชุดทดสอบเดิม (`raspberry-pi-streaming/tests/fakes.py`)
3. รัน CAM-01…CAM-12 กับ CSI แยกต่างหาก และเก็บชุดข้อมูลของกล้องนั้น
4. ค่อยทำระดับ ข.
5. ถ้าเป็นระดับ ค. ให้ออกแบบใหม่ (spec และ [CONTEXT.md](../../CONTEXT.md)) ก่อนแตะ workflow

---

## 13. แหล่งข้อมูล (เปิดอ่านเมื่อ 2026-11-21)

- [Raspberry Pi OS downloads](https://www.raspberrypi.com/software/operating-systems/) — รายการภาพ, วันที่ปล่อย, kernel, ขนาด และรุ่นที่รองรับ
- [Raspberry Pi software](https://www.raspberrypi.com/software/) — ลิงก์ดาวน์โหลด Imager (หน้านี้ไม่ระบุเลขรุ่น)
- [rpi-imager releases](https://github.com/raspberrypi/rpi-imager/releases) — รุ่นล่าสุด 2.0.12 และบันทึกรุ่น
- [Raspberry Pi Imager ใหม่](https://www.raspberrypi.com/news/a-new-raspberry-pi-imager/) — ลำดับขั้นตอนของ Imager 2.0
- [cloud-init on Raspberry Pi OS](https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/) — ไฟล์ `user-data` / `network-config` และการทำงานของ netplan กับ NetworkManager
- [Getting started](https://www.raspberrypi.com/documentation/computers/getting-started.html) และ [Remote access](https://www.raspberrypi.com/documentation/computers/remote-access.html) — ขนาดการ์ด, แหล่งจ่ายไฟ, การหา IP และ SSH
- [Picamera2 README](https://github.com/raspberrypi/picamera2) — วิธีติดตั้งบน Lite และรุ่น OS ที่รองรับ (ส่วนคู่มือ PDF เปิดอ่านเนื้อหาไม่สำเร็จ)
- [Camera software](https://www.raspberrypi.com/documentation/computers/camera_software.html) และ [Camera hardware](https://www.raspberrypi.com/documentation/accessories/camera.html) — `rpicam-apps` และขั้วต่อ CSI (สรุปจากหน้าที่อ่านไม่ครบ)
- PyPI: [opencv-python-headless](https://pypi.org/project/opencv-python-headless/), [gunicorn](https://pypi.org/project/gunicorn/), [Flask](https://pypi.org/project/Flask/) — เวอร์ชันล่าสุดและชนิดของ wheel ที่ตรวจเมื่อ 2026-11-21
- หลักฐานภายใน repo: [pi-camera-pico-streaming-2026-10-26](../evidence/pi-camera-pico-streaming-2026-10-26.md), [README ของ raspberry-pi-streaming](../../raspberry-pi-streaming/README.md)
