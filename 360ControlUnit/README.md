# Controller item/deadline contract

The controller owns one active physical item and its local 3000 ms Verdict
Window. Admission issues opaque string `controller_session` and `item_id` values.
Frame Context belongs to the captured image and cannot replace that item pair.

`POST /verdict` requires `{action, controller_session, item_id}` with action
`pass` or `reject`. Identity strings contain 1–64 ASCII letters, digits, `_` or
`-`. Invalid JSON/types/identity/action return HTTP 400 and `accepted: false`.
Well-formed expired, wrong-session, wrong-item or resolved commands return HTTP
200, `accepted: false`, `status: ignored`, and a machine-readable `reason`.
Every receipt echoes the submitted identity. Nonempty fallback actions do not
mean the submitted remote command was accepted.

At or after expiry, the active item resolves once through reject/alert behavior,
without incrementing pass count. Auto mode emits the reject actuator sequence;
Manual mode alerts without servo movement. Manual alerts do not establish
automatic physical rejection. `/reject` refuses unbound legacy commands;
deliberate manual angle/sweep remain available through `/servo` in Manual/idle.

`/status` exposes the current session/item, state, counters, resolution reason,
admission readiness, configured admission enablement and notification failures.
A new boot uses a fresh random session. A clear sensor observation is required
before first admission, and another clear observation after a completed cycle
prevents reopening an item still in the beam. Item counters never wrap into reuse.

## Physical admission gate

Automatic item admission is **disabled by default**. The bench-only build flag
`CN360_BENCH_ADMISSION_ENABLED=1` enables admission after the clear-station check.
Use it only after demonstrating a single-item arrangement that can still reject
at expiry, or external hold/stop equipment that retains the item. The existing
relay output is a reject actuator option, not proof of conveyor feed control.
Without that evidence, physical automatic operation remains blocked even when
software tests pass. This change has not flashed or operated a device.

## Local progress and compatibility

A dedicated FreeRTOS task steps the controller and actuator sequencing independently
of HTTP/DNS/notification stalls. The core and short hardware operations share a
mutex; JSON parsing and network sends happen outside it. Notifications use a
nonblocking queue carrying the original item's identity. Watchdog registration
and feeding belong to the control task, so a stalled network loop cannot reboot
an item admitted later during that stall before its Verdict Window expires.
A watchdog reboot is
not a replacement for a validated physical admission/retention arrangement.

Deploy controller, workflow and clients as one contract change. Old action-only
clients are refused, and new clients treat unverified old acknowledgements as
unknown delivery. The installed n8n workflows remain inactive/unmodified until
separately configured for deployment.

## PC verification

From the repository root:

```powershell
./360ControlUnit/test/host/run-host-tests.ps1
./360ControlUnit/test/host/build-adapter.ps1
node n8n/scripts/item-deadline-inspection.mjs --python <python-with-Pillow>
```

The adapter links the same controller core as the ESP32 firmware. It exposes
test-only virtual admission/time through a line protocol; the n8n HTTP receiver
only translates requests and receipts. Integrated tests use real n8n and test
pictures, and assert item outcome, counters and emitted movement/feedback.
Virtual time cannot certify task scheduling, sensor-to-command latency or
physical servo motion; these require the actual bench.
