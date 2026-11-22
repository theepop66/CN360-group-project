# 📦 CN360-group-project: Agile AI Quality Control HUD

An adaptive, vision-based quality inspection system that lets operators redefine what counts as a "defect" on the fly — no model retraining required. The project combines **Vision AI** (NVIDIA LocateAnything), **workflow automation** (n8n), **embedded hardware** (ESP32 + Raspberry Pi), and an **immersive interface** (Pico 4 Web HUD) into a single closed-loop inspection pipeline.

## Setup

Use **Node.js 20+**, **Git**, and **PowerShell 7.2+** on the Windows PC.
Connect the PC, ESP32, PICO and optional phone to the same Wi-Fi network.

### 1. Clone the project

```powershell
git clone https://github.com/theepop66/CN360-group-project.git
cd CN360-group-project
```

Run the following commands from this repository root. The HUD server needs no
`npm install`. If the ESP32 has not been configured yet, follow the
[ESP32 firmware and wiring steps](./docs/PICO_SETUP.md#3-prepare-the-esp32-and-wiring)
before continuing.

### 2. Find the PC address and prepare HTTPS

```powershell
ipconfig
.\pico-webapp\tools\setup-vr-https.ps1 -IpAddress 172.20.10.3
```

Replace `172.20.10.3` with the PC's Wi-Fi IPv4 address. Generate the certificate
once; reuse a matching, unexpired certificate. The script refuses to overwrite
an existing pair. Review certificate trust on each device.

### 3. Start the PICO HUD and ESP32 connection

```powershell
.\START-PICO-VR.cmd
```

The default ESP32 address is `172.20.10.5`. For another board address:

```powershell
.\START-PICO-VR.cmd http://192.168.1.50
```

Keep the terminal open. Wait for the HTTPS and ESP32 status checks to report
`[OK]`. If the terminal is already inside `pico-webapp`, use
`..\START-PICO-VR.cmd` instead. Press Ctrl+C to stop the server.

### 4. Open the correct page on each device

| Device / purpose | URL to open |
| --- | --- |
| PICO Browser: VR and controller controls | `https://172.20.10.3:8443/?xrdebug=1` |
| Optional phone browser: WebRTC camera sender | `https://172.20.10.3:8443/phone-webrtc.html` |
| PICO Browser: receive the phone's WebRTC video | `https://172.20.10.3:8443/?camera=webrtc&xrdebug=1` |

Replace the PC IP in every URL. On PICO, review the local certificate, open the
HUD and select **VR cinema**. Press **X** and wait for Manual confirmation.
Use the **left stick up/down** for conveyor forward/reverse; release to stop.
Press either **side Grip** for a servo Sweep. On the optional phone sender,
tap **Start**, allow camera access and keep the page visible.

For the full installation, phone pairing and remote zoom, optional AI services,
all controller buttons and troubleshooting, see the
[complete English setup guide](./docs/PICO_SETUP.md).

## 📖 Overview
Traditional AI-based QC systems require retraining whenever the target defect changes. This project solves that by using an **open-vocabulary detection model** (LocateAnything) driven by a live text prompt. An operator can type a new inspection target — e.g., `"bruised spot on fruit"`, `"scratch"`, `"hole"`, `"mold"` — directly from the HUD, and the system immediately starts detecting that target on the production line.

---

## 🏗️ System Architecture

> **Data Flow Diagram**
> ```text
> [ Raspberry Pi + Camera ] --(1. image/video)--> [ n8n Server ] --(2. API request)--> [ NVIDIA LocateAnything ]
>                                                         |                                      |
>                                               (4. trigger / send data)               (3. bounding box data)
>                                                         v                                      v
>                                                [ ESP32 Actuator ]                    [ Pico 4 Web HUD (2D) ]
>                                             (reject item / alert)                (live feed + AI box + controls)
> ```

**Execution Flow:**
1. **Raspberry Pi** streams live video to the Pico 4 Web HUD and captures a still frame, sending it to n8n on trigger (signal or timed interval).
2. **n8n** acts as the orchestration layer — it receives the image, pulls the current text prompt (set from the HUD), and forwards both to LocateAnything.
3. **NVIDIA LocateAnything** returns the bounding box coordinates `(x1, y1, x2, y2)` of the detected defect.
4. **n8n routing**:
   * **Defect Found:** Sends a webhook to the **ESP32** to trigger a reject mechanism.
   * **UI Update:** Pushes the bounding box coordinates to the **Pico 4 Web HUD** to draw a live overlay.
5. **ESP32** drives the physical response (servo motor, solenoid, warning LED) and reads sensor input (e.g., IR sensor) to detect when an item passes the inspection point.

---

## 🛠️ Tech Stack & Components

### 1. Software & Cloud Services
* **AI & Automation:** NVIDIA LocateAnything API (Vision AI), n8n (Locally hosted via Docker or Cloud)
* **Database:** Supabase (PostgreSQL for `inspection_results`, `control_actions`, `prompt_history`, `system_logs`)
* **Languages & Frameworks:** Python (FastAPI/Flask, OpenCV), C++ (Arduino IDE), HTML5/CSS3/JavaScript (WebSockets)

### 2. Hardware Components
* **Vision & Processing:** Raspberry Pi (Model 4 or 5 recommended), Raspberry Pi Camera Module (or compatible USB Webcam)
* **Control & Actuation:** ESP32 Microcontroller, Servo Motor / Solenoid, IR Sensor / Photoelectric Sensor, Mini Conveyor Belt, Lighting Box components
* **User Interface:** Pico 4 VR Headset

---

## 🧩 Core Modules

### ThingsBoard monitoring

The local supervisor dashboard displays inspection verdicts, defect coverage,
processing time, counts, service health and operational alarms. A durable local
journal replays monitoring records after ThingsBoard outages. See
[`thingsboard/README.md`](./thingsboard/README.md) for startup, the saved-image
offline demonstration, integration settings and verification evidence.

### n8n Workflow Orchestration

The orchestration layer is implemented in [`n8n/`](./n8n) as three importable workflows:

| Workflow | Job |
| :--- | :--- |
| **Inspection Loop** | Trigger (ESP32 item event / manual / scheduled) → pull a frame from the Pi → call the vision model → decide → verdict to the ESP32 → record → broadcast to the HUD |
| **Prompt Capture** | Turn the operator's Inspection Target into a Model Instruction, commit it to the model server, and record the change |
| **Health Watchdog** | Report model-server and capture-service outages once per state change |

Two things differ from the original design, deliberately:

- **The model reports `confidence: 0.0` for every detection**, so confidence is not a signal. The pass/reject decision is **Defect Coverage** — the summed area of the returned boxes over the frame area, thresholded. Every box is still shown on the HUD whatever the verdict.
- **The system fails closed.** A model timeout, unreachable model or unreadable threshold rejects the item rather than passing it.

See [`n8n/README.md`](./n8n/README.md) for import instructions, placeholders and the assumed Supabase schema, and [`CONTEXT.md`](./CONTEXT.md) for the shared vocabulary.

### Edge & Physical Devices
* **Raspberry Pi (Video Stream):** Python + OpenCV server streaming MJPEG video. Exposes a `/capture` endpoint for high-res snapshots.
* **ESP32 (Physical Controller):** Connects via Wi-Fi. Takes input from IR sensors to detect items and outputs to a servo motor for the reject mechanism.
* **Pico 4 (Web 2D HUD):** Uses a `<canvas>` overlay on top of the live video. Features include red/green bounding boxes driven by WebSocket data and a prompt input box for real-time target updates.

---

## 🗓️ Project Planning & Timeline (12-Week Sprint)

### Team Responsibility

| Member | Primary Responsibility | Supporting Responsibility |
| :---: | :--- | :--- |
| **Member 1** | Project management, system architecture, and integration | Requirements, risk tracking, system testing, documentation, and presentation coordination |
| **Member 2** | AI service and n8n workflow | LocateAnything API, routing logic, prompt management, and workflow error handling |
| **Member 3** | Raspberry Pi vision and streaming | Camera setup, MJPEG streaming, image capture, preprocessing, and edge-to-server communication |
| **Member 4** | ESP32 and mechanical hardware | Sensor input, actuator control, reject mechanism, conveyor assembly, and hardware safety |
| **Member 5** | Pico 4 Web HUD and data visualization | Web UI, WebSocket communication, bounding-box overlay, controls, and usability testing |





### 📌 Project Milestones & Documents

| Iteration | Topic | Documents & Slides | Presented |
| :---: | :--- | :--- | :---: |
| **1** | Concept Paper | [📄 Concept Paper](https://drive.google.com/file/d/1IjBoO7uXjnm1u_8YWbMDVTaaAnag4DLB/view?usp=sharing) · [📊 Slides](https://drive.google.com/file/d/1H9cFgqOz8-Zfk-Ge3Tp7ApVg4Z3ssXk0/view?usp=sharing) | 10/8/2026 |
| **2** | Progress report | [📊 Slides](https://drive.google.com/file/d/1-ZjyCF88wG0FfLqqc9nYgaaWYSksHTM0/view?usp=sharing)  | 23/8/2026 |
| **3** | Progress report 2 | - | - |
| **4** | Progress report 3 | [📊 Slides](https://canva.link/20q62wippspnf5c) | - |
| **5** | Progress report 4 | [📊 Slides](https://canva.link/lnwc67bio9i9n3j) | 26/10/69 |
| **6** | Progress report 5 | [📊 Slides](https://canva.link/77dzm3v1boi370s) | - |

---

## 🚧 Status
In development — see the **Project Planning & Timeline** section above for current milestones.
