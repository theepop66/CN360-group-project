# PICO VR, Camera and Conveyor Setup

This guide covers the Windows PC, ESP32 control unit, PICO browser, servo,
conveyor and optional phone camera used by this project. Run the commands in
PowerShell 7.2 or later. Keep each server terminal open while testing.

## 1. Install the required tools

- Install Git and Node.js 20 or newer. Confirm with `git --version`,
  `node --version` and `npm --version`.
- Install PowerShell 7.2 or newer for certificate and phone-camera scripts.
  Open **PowerShell 7**, rather than the older Windows PowerShell 5.1.
- To build or flash the ESP32, install Visual Studio Code and its PlatformIO IDE
  extension. Use the PlatformIO terminal for the `pio` commands below.
- Connect the PC, PICO, ESP32 and optional phone to the same LAN. Devices must
  be able to reach each other; a guest network may isolate them.

```powershell
git clone https://github.com/theepop66/CN360-group-project.git
cd CN360-group-project
```

The HUD and its HTTPS/WebRTC server use Node built-ins: **no `npm install` is
needed inside `pico-webapp`**. The separate AI detection relay has dependencies.

## 2. Check the network addresses

On the PC, run:

```powershell
ipconfig
```

Find the IPv4 address of the Wi-Fi adapter connected to the PICO. Do not use a
VPN adapter, `127.0.0.1`, or the ESP32 address as the PC address.

| Device | Tested address | Where it is used |
| --- | --- | --- |
| Windows PC | `172.20.10.3` | PICO and phone browser URLs; HTTPS certificate |
| ESP32 | `172.20.10.5` | HUD proxy target and direct controller status checks |
| Gateway | `172.20.10.1` | ESP32 network configuration |

These addresses are examples from the working bench. Replace them if your
network differs. The ESP32 static IP, gateway, subnet and DNS are configured
near the top of `360ControlUnit/src/main.cpp`; the default subnet is
`255.255.255.240`.

## 3. Prepare the ESP32 and wiring

Skip flashing if the board already runs the working firmware.

Open `360ControlUnit` as a PlatformIO project in VS Code. Create the local
credentials file without overwriting an existing one:

```powershell
if (!(Test-Path .\360ControlUnit\src\secrets.h)) {
    Copy-Item .\360ControlUnit\src\secrets.example.h .\360ControlUnit\src\secrets.h
}
```

Edit `360ControlUnit/src/secrets.h`: set `WIFI_SSID`, `WIFI_PASSWORD` and the
n8n notification URL for your setup. This file is ignored by Git. Check the
network addresses in `src/main.cpp` before building.

Run these from the repository root in a PlatformIO terminal:

```powershell
pio run --project-dir .\360ControlUnit -e esp32dev
pio device list
pio run --project-dir .\360ControlUnit -e esp32dev --target upload --upload-port COM5
pio device monitor --port COM5 --baud 115200
```

Replace `COM5` with the ESP32 port reported by `pio device list`. Close the
serial monitor with Ctrl+C before another upload.

| Connection | ESP32 / power connection |
| --- | --- |
| Servo signal | GPIO18 |
| Servo supply | Suitable regulated 5 V supply |
| Servo ground | Supply ground and ESP32 GND joined together |
| ULN2003 IN1 / IN2 / IN3 / IN4 | GPIO32 / GPIO33 / GPIO25 / GPIO26 |
| ULN2003 power and ground | Suitable 5 V supply; common ground with ESP32 |
| IR sensor output | GPIO4; active low |
| Buzzer / red LED / green LED | GPIO21 / GPIO22 / GPIO23 |

Follow the detailed [schematic guide](../controlunit_schematic/schematicbuildguide.md)
for the supporting circuits. For a servo, leave `ACTUATOR_RELAY` disabled in
`platformio.ini`: that alternate build drives a relay instead of the servo.

Read the controller status from the PC:

```powershell
Invoke-RestMethod http://172.20.10.5/status | Format-List
```

The firmware should expose `controller_session`, `conveyor_sequence`, `mode`
and `state`. A missing field or endpoint may indicate older firmware.

## 4. Create the local HTTPS certificate once

From the repository root in PowerShell 7:

```powershell
.\pico-webapp\tools\setup-vr-https.ps1 -IpAddress 172.20.10.3
```

Use the **PC Wi-Fi IPv4 address**. The script creates `dev-cert.pem` and
`dev-key.pem` in `pico-webapp/tools`, valid for 14 days. Both are ignored by Git;
each PC must generate its own files. It does not install certificate trust.

If the files already exist and match the PC IP and validity period, reuse them.
For a new IP or expired certificate, preserve the old pair under new names
before rerunning the script, then review the replacement certificate on each
device. The script intentionally refuses to overwrite existing files.

## 5. Start the tested VR/controller setup

From the repository root:

```powershell
.\START-PICO-VR.cmd
```

If your terminal is already inside `pico-webapp`, use:

```powershell
..\START-PICO-VR.cmd
```

For a different ESP32 IP, pass its origin:

```powershell
.\START-PICO-VR.cmd http://192.168.1.50
```

The launcher verifies the certificate, checks an actual HTTPS HUD response,
and reads `/esp/status` through the proxy. Expected output includes:

```text
[OK] HTTPS page returned HTTP 200 with certificate validation: https://172.20.10.3:8443/
[OK] ESP32 status has the conveyor session/sequence fields.
Controller mode: manual; state: idle
```

The displayed mode may differ until you select Manual. This launcher starts
HTTPS on port 8443 and does not take over an HTTP server on 8080. If it reuses
an existing HTTPS server, that server retains its existing ESP32 target. Stop
that owned server first if you need to change its target. Use Ctrl+C to stop
the foreground server started by this launcher.

## 6. Open the HUD on PICO

In the headset's **PICO Browser**, open:

```text
https://172.20.10.3:8443/?xrdebug=1
```

Do not open `localhost` on the PICO: that points to the headset itself. An HTTP
URL on port 8080 can show the 2D HUD but does not provide headset WebXR.

The local certificate is self-signed. If the PICO shows a certificate warning,
review the PC address and certificate details against the launcher output and
handle the trust decision on the device. Browser/OS versions can have different
trust screens. `ERR_CERT_AUTHORITY_INVALID` means trust has not been established;
it does not mean that the ESP32 is offline. Do not disable certificate validation
globally. A trusted certificate for your hostname is another deployment option.

Once the HUD loads:

1. Click **VR cinema** in the viewer toolbar. A-Frame is downloaded on first
   use, so the headset needs internet access for that dependency.
2. Allow the expected VR session permission if the browser requests it.
3. Press **X** and wait for **Mode set to manual**.
4. Center the left stick, then push up for forward conveyor movement; release
   it to stop. In Manual, pushing down requests reverse movement.
5. Press either side **Grip** once to Sweep the servo. With the current
   firmware, it moves to the configured reject angle (90 degrees) and returns
   to the rest angle (0 degrees).

The user confirmed that conveyor and servo controls worked on the physical
bench on November 19, 2026. That observation covers this bench configuration;
verify your own wiring, power, direction and stopping behavior after setup.

### Controller reference

| Input | Command | Requirement |
| --- | --- | --- |
| X, left | Manual mode | Controller idle |
| Y, left | Capture & inspect: take a photo and let the AI inspect it (advice only, no machine command) | n8n workflow active; the HUD server can reach n8n (`--n8n-origin`) |
| Side Grip, either hand | Servo Sweep | Manual and idle; one command per press |
| A, right | Reject | Current item awaiting Verdict |
| B, right | Pass | Current item awaiting Verdict |
| Right stick up/right | Servo angle +5 degrees | Manual and idle |
| Right stick down/left | Servo angle -5 degrees | Manual and idle |
| Left stick up | Conveyor forward while held | Manual, or eligible Auto operation |
| Left stick down | Conveyor reverse while held | Manual |
| Left stick left/right | Phone camera zoom out/in | Paired phone sender with zoom support |
| Left stick click | Reset phone camera zoom | Same phone requirements |
| Front trigger / right stick click | No actuator shortcut | Reserved for normal interaction or unused |
| Menu / Home | Headset/browser controls | Not exposed as actuator buttons |

PICO's button array includes a placeholder at index 2: Grip is 1, stick click
is 3, A/X is 4 and B/Y is 5. In `?xrdebug=1`, the separate **Input** line shows
the button and index; the control status line shows the ESP32 receipt.

**Auto is not a free-running motor test.** Automatic item admission is disabled
in the default firmware. The bench flag and item/timeout requirements are
documented in [360ControlUnit/README.md](../360ControlUnit/README.md). A/B do
not manufacture an item identity when no item is awaiting a Verdict. In Manual,
a reject Verdict alerts without moving the servo; use Grip for a deliberate
manual Sweep. Auto no longer has a controller button; use the **Auto** toggle in the 2D HUD panel.

## 7. Optional: phone camera over WebRTC

The VR launcher already includes `/rtc` signaling; no extra package or service
is needed. On the same LAN:

| Device | Open this URL |
| --- | --- |
| Phone browser (Safari on iPhone) | `https://172.20.10.3:8443/phone-webrtc.html` |
| PICO Browser | `https://172.20.10.3:8443/?camera=webrtc&xrdebug=1` |

Review HTTPS trust on the phone too. On the sender page tap **Start**, allow
camera access and keep the page visible. Open the receiver HUD, then enter
VR cinema. Tap **Stop** to end the sender. This route provides live video;
it does not provide the paired JPEG sender's `/capture` ingestion or its remote
camera zoom controls. Use the next section if those functions are needed.

## 8. Optional: paired JPEG camera, capture and remote zoom

`start-phone-camera.ps1` is a separate **camera-only** launcher: it deliberately
does not connect to the real ESP32. Stop owned servers on 8080/8443 before using
it; do not run two launchers on the same port.

```powershell
.\pico-webapp\tools\start-phone-camera.ps1 -IpAddress 172.20.10.3
```

It prints a path to `connection.txt` under
`%LOCALAPPDATA%/CN360/phone-camera/172.20.10.3/`. That file contains the current
pairing code, certificate fingerprint and URLs. On iPhone:

1. Download `http://172.20.10.3:8080/phone-camera-ca.cer`.
2. Review its fingerprint, then install the profile in **Settings > General >
   VPN & Device Management**. Enable it in **General > About > Certificate
   Trust Settings**. This is a local development CA; remove it when testing ends.
3. Open `https://172.20.10.3:8443/phone-camera.html` in Safari. Enter the pairing
   code, tap **Start streaming**, allow camera access and keep the page visible.
4. Open `http://localhost:8080/?camera=phone` on the PC, or
   `https://172.20.10.3:8443/?camera=phone&xrdebug=1` on PICO after trust review.
5. Enter the same code in the HUD's **Connection settings > Phone camera
   control code**. Zoom is available only when the phone reports support.

To use this JPEG receiver **with the real controller**, first stop the owned
camera-only server:

```powershell
.\pico-webapp\tools\stop-phone-camera.ps1 -IpAddress 172.20.10.3
```

Then start a combined server from the repository root using the generated pair:

```powershell
$cameraCertDir = Join-Path $env:LOCALAPPDATA 'CN360\phone-camera\172.20.10.3'
node .\pico-webapp\tools\hud-server.mjs --http-port 8080 --https-port 8443 --cert "$cameraCertDir\server.pem" --key "$cameraCertDir\server-key.pem" --phone-ca "$cameraCertDir\phone-camera-ca.cer" --phone-camera --control-unit http://172.20.10.5
```

This foreground server prints a **new pairing code**. Pair the sender and HUD
again with that code. Stop this combined server with Ctrl+C. The CA is reused,
but camera sessions and codes are not. Alternatively, the generic server can
use the VR certificate from section 4 with `--phone-camera`; the phone must
trust whichever certificate that server actually presents.

## 9. Optional: AI detection relay and other services

Conveyor/servo controls do not require the model, n8n, Supabase or the detection
relay. A disconnected AI status while running only the HUD is expected.

For detection boxes, open a second PC terminal:

```powershell
cd detection-relay
npm ci
npm start
```

The default HUD server tunnels `/detections` to `http://127.0.0.1:8081`, including
`wss://` on the HTTPS page. For a relay on another PC, use `--relay-origin`
with the generic `hud-server.mjs` command. See the existing service guides for
their configuration and startup; launching the HUD does not configure or
activate the AI workflow:

- [Detection relay](../detection-relay/README.md)
- [n8n workflows and runtime](../n8n/README.md)
- [Model service](../model-service/README.md)
- [Raspberry Pi streaming](../raspberry-pi-streaming/README.md)
- [ThingsBoard monitoring](../thingsboard/README.md)

The left **Y** button (and **Capture & inspect** in the 2D HUD) asks n8n for one inspection through the HUD
server's `/n8n/inspect-now` route. The default target is `http://127.0.0.1:5678` (n8n on this PC); for n8n on
another PC start `hud-server.mjs` with `--n8n-origin http://<n8n-host>:5678`. The n8n workflow must be active:
only the production webhook URL answers. The result is advice only and never moves the belt or servo. See
[Capture & inspect](../pico-webapp/README.md#capture--inspect-take-a-photo).

## 10. Troubleshooting

| Symptom | What to check |
| --- | --- |
| `START-PICO-VR.cmd` is not recognized | From the repository root use `.\START-PICO-VR.cmd`; from `pico-webapp` use `..\START-PICO-VR.cmd`. |
| `ERR_CONNECTION_REFUSED` | Start the HTTPS launcher and keep its terminal open. A working HTTP 8080 page does not prove that HTTPS 8443 is running. |
| HTTPS works on PC but PICO times out | Recheck PC IP, shared LAN/device isolation and the Windows firewall rule for Node on the intended network. |
| `ERR_CERT_AUTHORITY_INVALID` | Review trust on that device; check certificate IP and expiry. |
| `EACCES` during the launcher's network check | Run it in the PC's normal terminal; an isolated agent shell may not have LAN access. |
| Port already in use | Stop the specific server you started in its own terminal, or use the owned camera stop script. Do not kill unrelated Node processes. |
| No matching certificate IP | PC IP changed; prepare a replacement certificate for the current Wi-Fi IPv4. |
| VR cinema cannot load A-Frame | Check headset internet access to the CDN and retry after the connection is restored. |
| Controller buttons do nothing in 2D | Enter a real AR/VR session. The flat browser exposes the controller as a pointer. |
| Sweep is refused | Press X, wait for Manual confirmation, and wait until the controller is idle. |
| Sweep is accepted but servo does not move | Check GPIO18 signal, suitable 5 V supply, common ground, the installed actuator build and the servo itself. Acceptance is not position telemetry. |
| A/B reports no active item | Verdict buttons require an identity-bound item awaiting a decision; use Grip to test manual servo motion. |
| Phone zoom is unavailable | Check pairing code, selected JPEG camera source and actual camera/browser zoom support. The WebRTC sender does not implement these controls. |

## 11. Software checks

The focused controller/camera checks do not need physical hardware:

```powershell
cd pico-webapp
node --test tests/xr-controller.test.js tests/servo.test.js tests/control-feedback.test.js tests/conveyor.test.js tests/xr-modes.test.js tests/phone-camera-controls.test.js tests/camera-zoom.test.js
cd ..
node --test 360ControlUnit/test/conveyor-bench.test.mjs
```

For the full HUD suite, run `npm test` inside `pico-webapp`; its integration
tests need permission to open local network sockets. The C++ controller core
tests need Visual Studio C++ Build Tools:

```powershell
.\360ControlUnit\test\host\run-host-tests.ps1
```

For a read-only physical status check, run:

```powershell
node .\360ControlUnit\test\conveyor-bench.mjs http://172.20.10.5 status
```

The optional `forward 2` and `reverse 2` bench actions command real movement;
use them only when ready to observe the belt. They are separate from software
tests. Keep local credentials, generated certificates, keys, pairing codes,
logs, compiler output and editor history out of commits.
