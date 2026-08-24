# 📦 CN360-group-project: Agile AI Quality Control HUD

An adaptive, vision-based quality inspection system that lets operators redefine what counts as a "defect" on the fly — no model retraining required. The project combines **Vision AI** (NVIDIA LocateAnything), **workflow automation** (n8n), **embedded hardware** (ESP32 + Raspberry Pi), and an **immersive interface** (Pico 4 Web HUD) into a single closed-loop inspection pipeline.

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

### n8n Workflow Orchestration
The core orchestration logic is built across 4 main nodes:
| Node | Purpose |
| :--- | :--- |
| **Webhook / Trigger** | Receives raw images (Base64 or multipart form data) from the Raspberry Pi. |
| **HTTP Request** | Sends the image + dynamic text prompt to the LocateAnything API. |
| **IF / Switch** | Checks whether a bounding box was returned and if the confidence score exceeds thresholds. |
| **Action Branching** | Triggers ESP32, logs stats (Supabase), and broadcasts WebSockets to the HUD. |

### Edge & Physical Devices
* **Raspberry Pi (Video Stream):** Python + OpenCV server streaming MJPEG video. Exposes a `/capture` endpoint for high-res snapshots.
* **ESP32 (Physical Controller):** Connects via Wi-Fi. Takes input from IR sensors to detect items and outputs to a servo motor for the reject mechanism.
* **Pico 4 (Web 2D HUD):** Uses a `<canvas>` overlay on top of the live video. Features include red/green bounding boxes driven by WebSocket data and a prompt input box for real-time target updates.

---

## 🗓️ Project Planning & Timeline (12-Week Sprint)

| Phase | Weeks | Focus Area | Key Deliverables |
| :--- | :---: | :--- | :--- |
| **1** | 1-4 | System Foundation & AI | n8n setup, Supabase database schemas initialization, LocateAnything API integration, Main Route construction. |
| **2** | 5-8 | Hardware & Edge Devices | RPi MJPEG stream setup, ESP32 firmware routing, Sensors & Actuators assembly, Conveyor belt build. |
| **3** | 9-12 | Frontend HUD & Integration | Pico 4 HTML/JS UI design, WebSocket canvas overlay, End-to-end testing, Final presentation prep. |

### 📌 Project Milestones & Documents

| Iteration | Topic | Documents & Slides | Presented |
| :---: | :--- | :--- | :---: |
| **1** | Concept Paper | [📄 Concept Paper](https://drive.google.com/file/d/1IjBoO7uXjnm1u_8YWbMDVTaaAnag4DLB/view?usp=sharing) · [📊 Slides](https://drive.google.com/file/d/1H9cFgqOz8-Zfk-Ge3Tp7ApVg4Z3ssXk0/view?usp=sharing) | 10/8/2026 |
| **2** | Progress report | [📊 Slides](https://drive.google.com/file/d/1-ZjyCF88wG0FfLqqc9nYgaaWYSksHTM0/view?usp=sharing)  | 23/8/2026 |

---

## 🚧 Status
In development — see the **Project Planning & Timeline** section above for current milestones.
