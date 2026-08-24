# CN360-group-project

---

### Project Milestones

| Iteration | Topic | Documents & Slides | Presented |
| :---: | :--- | :--- | :---: |
| **1** | Concept Paper |[📄 Concept Paper](https://drive.google.com/file/d/1IjBoO7uXjnm1u_8YWbMDVTaaAnag4DLB/view?usp=sharing) · [📊 Slides](https://drive.google.com/file/d/1H9cFgqOz8-Zfk-Ge3Tp7ApVg4Z3ssXk0/view?usp=sharing) | 10/8/2026 |
| **2** | Progress report | [📊 Slides](https://drive.google.com/file/d/1-ZjyCF88wG0FfLqqc9nYgaaWYSksHTM0/view?usp=sharing)  | 23/8/2026 |

# Project Planning: Agile AI Quality Control HUD

## 📦 Component Lists

### 1. Hardware Components
* **Vision & Processing:**
  * Raspberry Pi (Model 4 or 5 recommended)
  * Raspberry Pi Camera Module (or compatible USB Webcam)
* **Control & Actuation:**
  * ESP32 Microcontroller
  * Servo Motor / Solenoid (for the rejection mechanism)
  * IR Sensor / Photoelectric Sensor (for detecting object arrival)
  * Mini Conveyor Belt (or DIY equivalent with a DC motor)
  * Lighting Box components (LED strip, diffuser acrylic/cardboard to control lighting)
  * Breadboard, Jumper wires, and Power Supplies (5V/12V as needed)
* **User Interface:**
  * Pico 4 VR Headset

### 2. Software & Cloud Services
* **AI & Automation:**
  * NVIDIA LocateAnything API (Vision AI)
  * n8n (Locally hosted via Docker or Cloud)
* **Database:**
  * Supabase (PostgreSQL for `inspection_results`, `control_actions`, `prompt_history`, `system_logs`)
* **Development Languages & Frameworks:**
  * Python (FastAPI/Flask & OpenCV for Raspberry Pi video streaming)
  * C++ / Arduino IDE (for ESP32 firmware)
  * HTML5, CSS3, JavaScript (for Pico 4 Web HUD dashboard and WebSockets)

---

## 🗓️ Timeline Planning (3-Month / 12-Week Sprint)

### Phase 1: System Foundation & AI Integration (Weeks 1-4)
* **Week 1: Architecture & Setup**
  * Set up n8n via Docker.
  * Initialize Supabase project and create the 4 database tables.
* **Week 2: API & Cloud Integration**
  * Connect n8n to Supabase using the Service Role Key.
  * Connect n8n to NVIDIA LocateAnything API.
* **Week 3: n8n Workflow Construction**
  * Build the Main Route (Image POST -> AI -> Database).
  * Build the Pico 4 Command Processing Workflow (Webhook -> Switch -> Actions/Logs).
* **Week 4: AI Testing**
  * Feed static images to the n8n webhook manually.
  * Verify bounding boxes are returned and data is correctly mapped into Supabase.

### Phase 2: Hardware & Edge Devices (Weeks 5-8)
* **Week 5: Raspberry Pi Setup**
  * Install OpenCV and set up a Python web server to stream MJPEG video.
  * Write script to capture high-res snapshots and POST them to the n8n webhook.
* **Week 6: ESP32 Firmware**
  * Connect ESP32 to Wi-Fi.
  * Write code to listen for GET/POST requests from n8n (Route 2 / Main Route).
* **Week 7: Actuation & Sensors**
  * Integrate the IR sensor to trigger the RPi camera.
  * Integrate the servo motor to actuate when a "reject" command is received.
* **Week 8: Physical Assembly**
  * Build the mini conveyor belt and attach the lighting box.
  * Mount the RPi Camera directly above the inspection zone.

### Phase 3: Frontend HUD & System Integration (Weeks 9-12)
* **Week 9: Pico 4 Web HUD Development (UI/UX)**
  * Design a clean 2D HTML/JS dashboard.
  * Embed the RPi video stream onto the webpage.
  * Create input fields for Prompt updates and emergency buttons.
* **Week 10: Canvas Overlay & WebSockets**
  * Write JavaScript to fetch bounding box coordinates from n8n/Supabase.
  * Draw the red/green bounding boxes on a `<canvas>` layered directly over the video stream.
* **Week 11: End-to-End Integration & Tuning**
  * Run the full loop: Object moves -> Camera captures -> AI detects -> HUD updates & Servo rejects.
  * Adjust conveyor speed to sync with API latency.
  * Calibrate the lighting box to maximize AI detection accuracy.
* **Week 12: Final Testing & Presentation Prep**
  * Conduct stress tests and measure system latency.
  * Document the architecture, workflows, and database schemas.
  * Prepare the live demonstration setup for the final presentation.

---
# Agile AI Quality Control HUD

An adaptive, vision-based quality inspection system that lets operators redefine what counts as a "defect" on the fly — no model retraining required. The project combines **Vision AI** (NVIDIA LocateAnything), **workflow automation** (n8n), **embedded hardware** (ESP32 + Raspberry Pi), and an **immersive interface** (Pico 4 Web HUD) into a single closed-loop inspection pipeline.

## Overview

Traditional AI-based QC systems require retraining whenever the target defect changes. This project solves that by using an **open-vocabulary detection model** (LocateAnything) driven by a live text prompt. An operator can type a new inspection target — e.g. `"bruised spot on fruit"`, `"scratch"`, `"hole"`, `"mold"` — directly from the HUD, and the system immediately starts detecting that target on the production line.

## System Architecture

```
[ Raspberry Pi + Camera ] --(1. image/video)--> [ n8n Server ] --(2. API request)--> [ NVIDIA LocateAnything ]
                                                        |                                      |
                                              (4. trigger actuator / send data)      (3. bounding box data)
                                                        v                                      v
                                               [ ESP32 Actuator ]                    [ Pico 4 Web HUD (2D) ]
                                            (reject item / alert)                (live feed + AI box + controls)
```

**Flow:**

1. **Raspberry Pi** streams live video to the Pico 4 Web HUD and captures a still frame, sending it to n8n on trigger (signal or timed interval).
2. **n8n** acts as the orchestration layer — it receives the image, pulls the current text prompt (set from the HUD), and forwards both to LocateAnything.
3. **NVIDIA LocateAnything** returns the bounding box coordinates `(x1, y1, x2, y2)` of the detected defect.
4. **n8n routing**:
   - If a defect is found → send a webhook to the **ESP32** to trigger a reject mechanism.
   - Push the bounding box coordinates to the **Pico 4 Web HUD** to draw a live overlay.
5. **ESP32** drives the physical response (servo motor, solenoid, warning LED) and reads sensor input (e.g. IR sensor) to detect when an item passes the inspection point.

## Components

### 1. n8n Workflow

The core orchestration logic, built as 4 main nodes:

| Node | Purpose |
|---|---|
| **Webhook / Interval Trigger** | Receives raw images (Base64 or multipart form data) from the Raspberry Pi |
| **HTTP Request (LocateAnything API)** | Sends the image + dynamic text prompt (settable from the HUD) for inference |
| **IF / Switch** | Checks whether a bounding box was returned and whether the confidence score exceeds the configured threshold |
| **Action Branching** | On defect detected: (a) HTTP request to the ESP32 reject endpoint, (b) log stats to Google Sheets / MySQL (timestamp, defect type, confidence). Also broadcasts the latest bounding box coordinates over WebSocket for the HUD to render. |

### 2. Raspberry Pi — Video Stream & Image Capture

- Python + OpenCV, served via a lightweight web server (Flask or FastAPI)
- Streams MJPEG video for display on the Pico 4 browser
- Exposes a `/capture` endpoint so n8n (or the ESP32) can request a high-resolution snapshot for AI inference

### 3. ESP32 — Physical Controller

- Arduino (C++), connected over Wi-Fi, running a WebServer / WebSocket client
- **Input:** IR / photoelectric sensor to detect when an item reaches the inspection point
- **Output:** servo motor (reject mechanism), relay (air valve / sprinkler), buzzer / LED

### 4. Pico 4 — Web 2D HUD

- Built with HTML5 + CSS3 + JavaScript, using a `<canvas>` overlay on top of the live video (no 3D — runs in the standard Pico browser or WebXR flat-display mode)
- **Features:**
  - Live video feed from the Raspberry Pi
  - Canvas-drawn bounding boxes (red/green) rendered over the video, driven by WebSocket data from n8n
  - Prompt input box (e.g. `"scratch"`, `"hole"`, `"mold"`) with an **Update** button to push a new detection target back to n8n in real time|

## Tech Stack

- **AI / Vision:** NVIDIA LocateAnything (open-vocabulary object detection)
- **Automation:** n8n (Docker)
- **Edge compute:** Raspberry Pi (Python, OpenCV, Flask/FastAPI)
- **Actuation:** ESP32 (Arduino/C++)
- **Interface:** Pico 4 (HTML5, CSS3, JavaScript, Canvas, WebSocket)
- **Data logging:** Google Sheets / MySQL

## Status

🚧 In development — see the [Project Roadmap](#project-roadmap-3-months) above for current milestones.
