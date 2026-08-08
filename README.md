# CN360-group-project

---

### 1.Project Milestones

| Iteration | Topic | Documents & Slides | Presented |
| :---: | :--- | :--- | :---: |
| **1** | Concept Paper |[📄 Concept Paper](https://drive.google.com/file/d/1IjBoO7uXjnm1u_8YWbMDVTaaAnag4DLB/view?usp=sharing) * [📊 Slides](https://canva.link/oox7ncl6kj0m4so) | — |

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
