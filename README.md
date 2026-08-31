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

### Team Responsibility

| Member | Primary Responsibility | Supporting Responsibility |
| :---: | :--- | :--- |
| **Member 1** | Project management, system architecture, and integration | Requirements, risk tracking, system testing, documentation, and presentation coordination |
| **Member 2** | AI service and n8n workflow | LocateAnything API, routing logic, prompt management, and workflow error handling |
| **Member 3** | Raspberry Pi vision and streaming | Camera setup, MJPEG streaming, image capture, preprocessing, and edge-to-server communication |
| **Member 4** | ESP32 and mechanical hardware | Sensor input, actuator control, reject mechanism, conveyor assembly, and hardware safety |
| **Member 5** | Pico 4 Web HUD and data visualization | Web UI, WebSocket communication, bounding-box overlay, controls, and usability testing |

> Each member owns their primary module, including its source code, setup guide, unit tests, and demonstration. Integration and end-to-end testing are shared responsibilities.

### Phase 1 — System Foundation & AI (Weeks 1-4)

| Owner | Detailed Tasks | Deliverables / Acceptance Criteria |
| :---: | :--- | :--- |
| **Member 1** | Finalize functional and non-functional requirements; define the end-to-end data flow, API contracts, coordinate formats, naming conventions, Git workflow, issue board, weekly review process, risk register, and integration checklist. | Approved architecture diagram; requirements list; API/interface specification; project board with owners and deadlines; initial risk and test plan. |
| **Member 2** | Deploy n8n locally or in the cloud; create the image-ingestion webhook; connect LocateAnything; send an image with a dynamic prompt; normalize bounding-box and confidence responses; build defect/no-defect/error branches; add retries, timeouts, and sample test payloads. | Exported n8n workflow; successful inference with sample images; documented request/response format; error path tested without stopping the workflow. |
| **Member 3** | Prepare Raspberry Pi OS and camera dependencies; verify camera resolution and frame rate; build a basic OpenCV capture script; evaluate lighting, camera distance, and image orientation; provide representative images for AI testing. | Reproducible Pi setup guide; working capture script; labeled sample-image set; documented recommended camera and lighting settings. |
| **Member 4** | Confirm ESP32, sensor, actuator, power supply, conveyor, and mechanical-part requirements; draw the wiring and mechanical layout; test the IR/photoelectric sensor and servo/solenoid independently; define the command interface expected from n8n. | Bill of materials; wiring diagram; bench-test videos/results; agreed actuator command and acknowledgement format; identified electrical/mechanical risks. |
| **Member 5** | Create Pico 4 HUD wireframes; define the UI states (ready, inspecting, defect, no defect, disconnected, and error); prototype a responsive live-video page, prompt input, threshold control, status panel, and canvas overlay with mock data. | Approved wireframe; browser-based HUD prototype; mock bounding boxes aligned with a sample image; documented UI event/data requirements. |
| **All Members** | Review the architecture and interfaces together; test the same sample input through each available mock module; resolve mismatched field names, units, coordinate systems, and network assumptions. | **Week 4 checkpoint:** AI workflow demo using a sample image and prompt, with all module contracts frozen for Phase 2. |

### Phase 2 — Hardware & Edge Development (Weeks 5-8)

| Owner | Detailed Tasks | Deliverables / Acceptance Criteria |
| :---: | :--- | :--- |
| **Member 1** | Track sprint progress and blockers; maintain interface-change records; prepare the integration environment and test matrix; coordinate network configuration among the Pi, n8n, ESP32, and HUD; verify database logging requirements. | Updated schedule and risk register; integration checklist; network/deployment diagram; test cases covering normal, failure, and recovery scenarios. |
| **Member 2** | Complete the n8n main route; read and update the current prompt; apply confidence-threshold logic; trigger the ESP32 only for valid detections; save `inspection_results`, `control_actions`, `prompt_history`, and `system_logs` to Supabase; broadcast normalized results to the HUD. | Versioned workflow export; database schema/migrations; successful records for every branch; duplicate-trigger prevention; clear logs for API and device failures. |
| **Member 3** | Implement the stable MJPEG stream and high-resolution `/capture` endpoint; send frames to n8n by trigger or interval; add timestamps and image IDs; handle camera/network reconnection; benchmark latency, frame rate, resolution, and CPU usage. | Pi service starts automatically; HUD can view the stream; n8n receives traceable captures; recovery after a temporary disconnect; benchmark report. |
| **Member 4** | Assemble the conveyor and reject mechanism; integrate sensor timing with item movement; implement ESP32 Wi-Fi and webhook/MQTT command handling; drive the actuator safely; add cooldown, manual-test, acknowledgement, and fail-safe behavior; calibrate reject timing. | Operational hardware prototype; documented firmware and wiring; repeatable sensor detection and rejection; no repeated actuation from one item; emergency/fail-safe procedure. |
| **Member 5** | Connect the HUD to the real MJPEG stream; implement WebSocket reconnect/heartbeat behavior; send prompt and confidence updates; display connection and inspection status; transform model coordinates to canvas coordinates for different screen sizes. | HUD controls update the backend; live results appear without page reload; overlays remain aligned after resizing; disconnect and stale-data states are visible. |
| **All Members** | Integrate Pi → n8n → LocateAnything → ESP32/HUD using real devices; measure each stage; record defects, latency, and integration issues; correct interface or timing errors before UI polishing. | **Week 8 checkpoint:** One item can be captured, inspected, displayed, logged, and physically accepted/rejected through the complete pipeline. |

### Phase 3 — Full Integration, Validation & Delivery (Weeks 9-12)

| Owner | Detailed Tasks | Deliverables / Acceptance Criteria |
| :---: | :--- | :--- |
| **Member 1** | Lead end-to-end validation; define target metrics and run the formal test plan; manage issue triage and release scope; compile the final report, architecture explanation, installation steps, user manual, presentation flow, and demonstration script. | Completed test report and issue log; release checklist; final report/manual; presentation deck outline; timed backup demo plan. |
| **Member 2** | Tune prompts and confidence thresholds using the test set; improve response parsing and workflow observability; validate database accuracy; handle rate limits, invalid responses, and unavailable AI service; export a clean production workflow and configuration template. | Prompt/threshold evaluation results; robust failure handling; verified database records; sanitized environment template; final n8n workflow and recovery guide. |
| **Member 3** | Optimize capture-to-inference latency and stream stability; add service health checks and startup scripts; validate long-running operation; document Pi installation, camera calibration, troubleshooting, and log collection. | Stable endurance-test result; measured latency contribution; automatic startup/recovery; final Pi deployment and troubleshooting guide. |
| **Member 4** | Refine mechanical alignment and actuator timing; run repeated accept/reject cycles; measure missed detections, false triggers, and mechanical failures; secure wiring and power; prepare spare/manual fallback procedures for the demonstration. | Reliability test results; calibrated timing values; safe and tidy hardware assembly; replacement/fallback checklist; final firmware release. |
| **Member 5** | Polish the Pico 4 HUD for readability and VR browser use; add result history/statistics and clear warnings; improve overlay accuracy and interaction feedback; run usability and compatibility tests; prepare HUD screenshots or screen recording. | Final responsive HUD; accurate overlays; usable controls in Pico 4; results/history view; usability findings addressed; media ready for the presentation. |
| **All Members** | Run scenario-based tests (defect, no defect, low confidence, changed prompt, device disconnect, API failure, and rapid consecutive items); fix critical issues; perform rehearsal, peer review, repository cleanup, and final submission verification. | **Week 10:** Feature freeze and complete test run. **Week 11:** Bug fixes, documentation, and rehearsal. **Week 12:** Final demonstration, presentation, and submission. |

### Trackable Subtasks by Member and Week

Use the checkbox in the **Done** column to update progress. Each task belongs to one member and one week only. Reference its Task ID in commits, pull requests, issues, and meeting notes. Check a task only after the expected output has been tested and stored in the repository or shared project documents.

#### Member 1 — Project Management, Architecture & Integration

| Week | Task ID | Done | Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-M1-01` | [ ] | Collect and prioritize requirements; publish the reviewed requirements checklist. |
| **1** | `W01-M1-02` | [x] | Create the architecture and end-to-end data-flow diagram. |
| **2** | `W02-M1-01` | [ ] | Define API fields, coordinate format, error codes, and module ownership in an interface specification. |
| **2** | `W02-M1-02` | [ ] | Set up the project board, Git workflow, task labels, and Definition of Done. |
| **3** | `W03-M1-01` | [ ] | Create the initial risk register and module-level test outline. |
| **3** | `W03-M1-02` | [ ] | Review mock payloads from all modules and record interface mismatches. |
| **4** | `W04-M1-01` | [ ] | Lead the Phase 1 review and freeze approved interface contracts. |
| **4** | `W04-M1-02` | [ ] | Update the schedule, risks, decisions, and Phase 2 integration checklist. |
| **5** | `W05-M1-01` | [ ] | Finalize shared IP addresses, ports, service URLs, and deployment configuration. |
| **5** | `W05-M1-02` | [ ] | Verify Supabase logging requirements and traceability fields with Member 2. |
| **6** | `W06-M1-01` | [ ] | Write module, interface, failure, and recovery test cases in a traceable test matrix. |
| **6** | `W06-M1-02` | [ ] | Review unit-test evidence from Members 2–5 and record missing coverage. |
| **7** | `W07-M1-01` | [ ] | Coordinate the first real-device integration run and assign every defect. |
| **7** | `W07-M1-02` | [ ] | Prioritize integration issues by severity, owner, deadline, and retest status. |
| **8** | `W08-M1-01` | [ ] | Run the Phase 2 acceptance checklist for the complete closed-loop prototype. |
| **8** | `W08-M1-02` | [ ] | Publish the integration result, unresolved risks, and Phase 3 test schedule. |
| **9** | `W09-M1-01` | [ ] | Define measurable success targets and lead formal end-to-end scenario tests. |
| **9** | `W09-M1-02` | [ ] | Maintain the test result and regression dashboard. |
| **10** | `W10-M1-01` | [ ] | Triage remaining defects and enforce the feature freeze. |
| **10** | `W10-M1-02` | [ ] | Draft the final report structure, installation guide, and user manual. |
| **11** | `W11-M1-01` | [ ] | Complete and coordinate peer review of the report and documentation. |
| **11** | `W11-M1-02` | [ ] | Prepare and time the presentation, live-demo script, and backup-demo plan. |
| **12** | `W12-M1-01` | [ ] | Verify the final repository, release tag, documents, slides, and submission files. |
| **12** | `W12-M1-02` | [ ] | Coordinate the final demonstration and record final acceptance results. |

#### Member 2 — AI, n8n Workflow & Database

| Week | Task ID | Done | Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-M2-01` | [ ] | Deploy n8n and publish start, stop, access, and configuration instructions. |
| **1** | `W01-M2-02` | [ ] | Prepare API credentials through environment variables without committing secrets. |
| **2** | `W02-M2-01` | [ ] | Create and test the image-ingestion webhook with valid and invalid payloads. |
| **2** | `W02-M2-02` | [ ] | Connect LocateAnything and save a successful image-and-prompt response. |
| **3** | `W03-M2-01` | [ ] | Normalize bounding boxes, labels, confidence, image ID, and timestamps. |
| **3** | `W03-M2-02` | [ ] | Implement defect, no-defect, timeout, and invalid-response branches. |
| **4** | `W04-M2-01` | [ ] | Add retry limits and structured workflow error messages. |
| **4** | `W04-M2-02` | [ ] | Export the Phase 1 workflow and demonstrate it using the shared sample set. |
| **5** | `W05-M2-01` | [ ] | Create Supabase tables, migrations, constraints, and sample records. |
| **5** | `W05-M2-02` | [ ] | Implement storage and retrieval for the active prompt and confidence threshold. |
| **6** | `W06-M2-01` | [ ] | Broadcast normalized detection events to the HUD and verify payloads. |
| **6** | `W06-M2-02` | [ ] | Log inspection results and system events with a traceable image ID. |
| **7** | `W07-M2-01` | [ ] | Trigger the ESP32 for valid detections and prevent duplicate commands. |
| **7** | `W07-M2-02` | [ ] | Record ESP32 acknowledgements and failed control actions in Supabase. |
| **8** | `W08-M2-01` | [ ] | Add timeout, rate-limit, retry, and unavailable-service recovery paths. |
| **8** | `W08-M2-02` | [ ] | Export and version the Phase 2 workflow after integration fixes. |
| **9** | `W09-M2-01` | [ ] | Evaluate prompts and confidence thresholds against the labeled test set. |
| **9** | `W09-M2-02` | [ ] | Publish the accuracy comparison and recommended prompt/threshold settings. |
| **10** | `W10-M2-01` | [ ] | Audit database records against captured, detected, and actuated events. |
| **10** | `W10-M2-02` | [ ] | Test invalid API responses, rate limits, timeouts, and AI service outages. |
| **11** | `W11-M2-01` | [ ] | Export the production n8n workflow and sanitized `.env.example`. |
| **11** | `W11-M2-02` | [ ] | Finalize AI, workflow, database, and recovery documentation. |
| **12** | `W12-M2-01` | [ ] | Run the final workflow smoke test using the release configuration. |
| **12** | `W12-M2-02` | [ ] | Support the demonstration and collect final workflow logs as evidence. |

#### Member 3 — Raspberry Pi, Camera & Streaming

| Week | Task ID | Done | Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-M3-01` | [ ] | Install Raspberry Pi OS, camera drivers, Python, and OpenCV dependencies. |
| **1** | `W01-M3-02` | [ ] | Verify the camera and document the reproducible setup procedure. |
| **2** | `W02-M3-01` | [ ] | Implement still-image capture with filename, timestamp, and image ID. |
| **2** | `W02-M3-02` | [ ] | Verify image orientation, color, focus, and supported resolutions. |
| **3** | `W03-M3-01` | [ ] | Compare frame rate, resolution, camera distance, and lighting conditions. |
| **3** | `W03-M3-02` | [ ] | Select and document baseline camera and lighting settings. |
| **4** | `W04-M3-01` | [ ] | Produce labeled defect and non-defect images for shared AI testing. |
| **4** | `W04-M3-02` | [ ] | Package the capture script and sample data with usage instructions. |
| **5** | `W05-M3-01` | [ ] | Implement the MJPEG streaming service and test access from another device. |
| **5** | `W05-M3-02` | [ ] | Record baseline stream FPS, resolution, latency, and CPU usage. |
| **6** | `W06-M3-01` | [ ] | Implement and test the high-resolution `/capture` endpoint. |
| **6** | `W06-M3-02` | [ ] | Send captures with image ID and timestamp to n8n. |
| **7** | `W07-M3-01` | [ ] | Add camera and network disconnect detection and automatic reconnection. |
| **7** | `W07-M3-02` | [ ] | Verify that each integrated capture can be traced through n8n. |
| **8** | `W08-M3-01` | [ ] | Benchmark the final stream and capture path under integrated load. |
| **8** | `W08-M3-02` | [ ] | Select production settings and publish the benchmark results. |
| **9** | `W09-M3-01` | [ ] | Optimize capture-to-inference latency without reducing usable image quality. |
| **9** | `W09-M3-02` | [ ] | Add health-check information for the camera and streaming service. |
| **10** | `W10-M3-01` | [ ] | Configure automatic startup and test service recovery after restart. |
| **10** | `W10-M3-02` | [ ] | Run and document a long-duration camera/stream endurance test. |
| **11** | `W11-M3-01` | [ ] | Finalize Pi installation, calibration, troubleshooting, and log guides. |
| **11** | `W11-M3-02` | [ ] | Freeze and tag the Raspberry Pi service release. |
| **12** | `W12-M3-01` | [ ] | Run the release-image camera and streaming smoke test. |
| **12** | `W12-M3-02` | [ ] | Monitor stream health and keep a local capture fallback during the demo. |

#### Member 4 — ESP32, Sensors & Mechanical System

| Week | Task ID | Done | Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-M4-01` | [ ] | Confirm ESP32, sensor, actuator, conveyor, power, and mechanical requirements. |
| **1** | `W01-M4-02` | [ ] | Publish the bill of materials with quantity, status, and alternatives. |
| **2** | `W02-M4-01` | [ ] | Draw the sensor, actuator, ESP32, and power wiring diagram. |
| **2** | `W02-M4-02` | [ ] | Review voltage, current, grounding, and external-power safety requirements. |
| **3** | `W03-M4-01` | [ ] | Test the item sensor independently and record reliable trigger distance. |
| **3** | `W03-M4-02` | [ ] | Test the servo/solenoid independently with a minimal firmware sketch. |
| **4** | `W04-M4-01` | [ ] | Define actuator commands, acknowledgements, cooldown, and fail-safe behavior. |
| **4** | `W04-M4-02` | [ ] | Publish bench-test evidence and the hardware interface specification. |
| **5** | `W05-M4-01` | [ ] | Assemble and manually test the conveyor and reject mechanism. |
| **5** | `W05-M4-02` | [ ] | Implement ESP32 Wi-Fi connection and a basic network command endpoint. |
| **6** | `W06-M4-01` | [ ] | Integrate sensor detection, item state, actuator movement, and reset logic. |
| **6** | `W06-M4-02` | [ ] | Verify one complete local sensor-to-actuator cycle without n8n. |
| **7** | `W07-M4-01` | [ ] | Add acknowledgement, cooldown, manual-test, and fail-safe modes. |
| **7** | `W07-M4-02` | [ ] | Receive real n8n commands and report success/failure acknowledgements. |
| **8** | `W08-M4-01` | [ ] | Calibrate sensor-to-reject delay at the selected conveyor speed. |
| **8** | `W08-M4-02` | [ ] | Confirm that one passing item produces at most one actuator cycle. |
| **9** | `W09-M4-01` | [ ] | Refine mechanical alignment and record final timing parameters. |
| **9** | `W09-M4-02` | [ ] | Run repeated accept/reject cycles and calculate the failure rate. |
| **10** | `W10-M4-01` | [ ] | Secure wiring, power, moving parts, and emergency-stop behavior. |
| **10** | `W10-M4-02` | [ ] | Fix reliability defects and repeat failed mechanical test cases. |
| **11** | `W11-M4-01` | [ ] | Prepare spare parts, manual override, and demo fallback procedures. |
| **11** | `W11-M4-02` | [ ] | Freeze firmware and finalize wiring, calibration, and safety documentation. |
| **12** | `W12-M4-01` | [ ] | Perform the pre-demo hardware inspection and release smoke test. |
| **12** | `W12-M4-02` | [ ] | Operate and monitor the conveyor/reject mechanism during the demo. |

#### Member 5 — Pico 4 Web HUD & Visualization

| Week | Task ID | Done | Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-M5-01` | [ ] | Create desktop and Pico 4 HUD wireframes. |
| **1** | `W01-M5-02` | [x] | Define ready, inspecting, defect, no-defect, disconnected, and error states. |
| **2** | `W02-M5-01` | [x] | Build the responsive page layout and mock live-video area. |
| **2** | `W02-M5-02` | [ ] | Verify basic layout and controls in desktop and Pico 4 browsers. |
| **3** | `W03-M5-01` | [ ] | Add prompt, confidence, connection-status, and manual-test controls. |
| **3** | `W03-M5-02` | [ ] | Connect the controls to mock state and validate user feedback. |
| **4** | `W04-M5-01` | [x] | Draw mock bounding boxes, labels, and confidence on the canvas overlay. |
| **4** | `W04-M5-02` | [x] | Test overlay scaling with different sample image dimensions. |
| **5** | `W05-M5-01` | [ ] | Display the real Raspberry Pi MJPEG stream in the HUD. |
| **5** | `W05-M5-02` | [ ] | Verify stream layout and controls on desktop and Pico 4. |
| **6** | `W06-M5-01` | [x] | Connect WebSocket events with heartbeat and automatic reconnection. |
| **6** | `W06-M5-02` | [ ] | Send prompt and confidence changes to the backend and verify updates. |
| **7** | `W07-M5-01` | [x] | Map model coordinates to displayed-video coordinates. |
| **7** | `W07-M5-02` | [x] | Test overlay alignment across window sizes and video resolutions. |
| **8** | `W08-M5-01` | [x] | Add loading, disconnected, stale-data, no-defect, and error displays. |
| **8** | `W08-M5-02` | [ ] | Complete the HUD integration checklist using real events. |
| **9** | `W09-M5-01` | [ ] | Improve Pico 4 readability, control sizing, contrast, and feedback. |
| **9** | `W09-M5-02` | [ ] | Add inspection history, summary statistics, and warning indicators. |
| **10** | `W10-M5-01` | [ ] | Run UI regression tests for every normal and error state. |
| **10** | `W10-M5-02` | [ ] | Recheck overlay accuracy and fix remaining usability defects. |
| **11** | `W11-M5-01` | [ ] | Capture presentation screenshots and a backup screen recording. |
| **11** | `W11-M5-02` | [ ] | Freeze the HUD release and finalize usage/troubleshooting documentation. |
| **12** | `W12-M5-01` | [ ] | Run the final Pico 4 HUD smoke test using the release configuration. |
| **12** | `W12-M5-02` | [ ] | Operate the HUD during the demo and preserve final screenshots/logs. |

#### Shared Integration Tasks

These tasks require participation from all members but remain separate from the individual workload tables.

| Week | Task ID | Done | Shared Task and Expected Output |
| :---: | :--- | :---: | :--- |
| **1** | `W01-ALL-01` | [ ] | Agree on scope, responsibilities, communication channel, and weekly meeting time. |
| **4** | `W04-ALL-01` | [ ] | Run the Phase 1 interface review and sample-image AI demonstration. |
| **6** | `W06-ALL-01` | [ ] | Present unit/interface test evidence for every module. |
| **7** | `W07-ALL-01` | [ ] | Run the first real-device integration test and assign all discovered issues. |
| **8** | `W08-ALL-01` | [ ] | Demonstrate the complete capture, inspect, display, log, and reject loop. |
| **9** | `W09-ALL-01` | [ ] | Test defect, no-defect, low-confidence, prompt-change, disconnect, API-failure, and rapid-item scenarios. |
| **10** | `W10-ALL-01` | [ ] | Close all critical bugs and approve the release candidate. |
| **11** | `W11-ALL-01` | [ ] | Peer-review the repository/documents and perform a timed full rehearsal. |
| **12** | `W12-ALL-01` | [ ] | Complete final submission verification and deliver the demonstration. |

### Weekly Checkpoints

| Week | Team Checkpoint |
| :---: | :--- |
| **1** | Requirements, roles, architecture, repository workflow, and bill of materials agreed. |
| **2** | First AI API call, camera capture, hardware bench tests, and HUD wireframe completed. |
| **3** | n8n prototype and mock end-to-end data flow demonstrated. |
| **4** | Phase 1 review; interface contracts and test samples frozen. |
| **5** | Real MJPEG stream, database schema, ESP32 network command, and HUD connection established. |
| **6** | Each module independently passes its unit and interface tests. |
| **7** | First physical integration run completed; major latency and timing issues recorded. |
| **8** | Complete closed-loop prototype demonstrated and logged. |
| **9** | Full scenario and performance testing begins; feature gaps closed. |
| **10** | Feature freeze; only bug fixes, calibration, and documentation changes allowed. |
| **11** | Final reliability test, report, user guide, slides, and full rehearsal completed. |
| **12** | Final demonstration, presentation, repository tag/release, and submission completed. |

### 📌 Project Milestones & Documents

| Iteration | Topic | Documents & Slides | Presented |
| :---: | :--- | :--- | :---: |
| **1** | Concept Paper | [📄 Concept Paper](https://drive.google.com/file/d/1IjBoO7uXjnm1u_8YWbMDVTaaAnag4DLB/view?usp=sharing) · [📊 Slides](https://drive.google.com/file/d/1H9cFgqOz8-Zfk-Ge3Tp7ApVg4Z3ssXk0/view?usp=sharing) | 10/8/2026 |
| **2** | Progress report | [📊 Slides](https://drive.google.com/file/d/1-ZjyCF88wG0FfLqqc9nYgaaWYSksHTM0/view?usp=sharing)  | 23/8/2026 |

---

## 🚧 Status
In development — see the **Project Planning & Timeline** section above for current milestones.
