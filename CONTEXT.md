# CN360 Domain Context

Shared vocabulary for the quality-control system. The point of this file is to
stop "prompt", "target" and "instruction" being used interchangeably.

## The core terms

**Inspection Target** — the short phrase an operator types into the HUD, e.g.
`"mold"`, `"bruised spot on fruit"`, `"scratch"`. It is *what* to look for, in
the operator's own words. It is not sent to the model.

**Model Instruction** — the full sentence handed to the model, built from the
Inspection Target by the canonical template (`Locate all the instances that
matches the following description: {target}.`). The exact grammar is part of the
contract with the model; it must not be paraphrased per-caller.

**Defect Coverage** — the fraction of the frame covered by the boxes the model
returned: summed box area over frame area, clamped to `[0, 1]`. This is the
pass/reject signal. See "Why not confidence" below.

**Coverage Threshold** — the Defect Coverage at or above which an item is
rejected. Defaults to `0.005` (0.5% of the frame). Tunable per deployment.

**Verdict** — `pass` or `reject`. Decided from Defect Coverage, or forced to
`reject` by any failure.

**Verdict Window** — the 3000 ms the ESP32 waits for a verdict before its own
auto-pass fallback fires. The model timeout (2000 ms) sits inside it so the
verdict POST always has headroom.

**Inspection** — one pass through the loop: one frame, one model call, one
verdict.

**Inspection Result** — the recorded outcome of an Inspection, including the
Defect Coverage figure, the Coverage Threshold, and the Verdict.

**Control Action** — a physical action requested of the ESP32, with whether the
ESP32 accepted it and the HTTP status it returned.

**Prompt History** — the audit trail of Inspection Target changes. The model
server's own global prompt is the *runtime* source of truth; Prompt History is a
record, never a cache that is read to decide what to send.

**Frame Context** — the identity and geometry of a captured frame, read from the
Pi's capture response headers: `X-Camera-Session`, `X-Frame-Sequence`,
`X-Captured-At`, `X-Frame-Width`, `X-Frame-Height`. It is threaded through the
model call, the database write, the Control Action and the HUD broadcast.

**Detection** — one box the model returned: a label and a pixel-space
`[x1, y1, x2, y2]` against the uploaded capture.

## The decisions that are easy to undo by accident

**Confidence is not a signal.** The model hardcodes `confidence: 0.0` for every
detection. Nothing may threshold on it, store it, or send it to the HUD. The
original design called for confidence filtering; implementing that would pass
every item while looking like it was filtering. Defect Coverage replaced it.

**The threshold never hides a box.** Every Detection the model returns is drawn
on the HUD whatever the Verdict. The Coverage Threshold decides the physical
path, not what the operator is allowed to see.

**The system fails closed.** Model timeout, unreachable model, error status,
unrenderable box geometry, failed frame capture, or an unreadable Coverage
Threshold all produce `reject`. Never a silent `pass`.

**The model server's global prompt is the runtime source of truth.** The
instruction is still sent explicitly on every `/predict` call, and the model's
echoed `prompt_used` is compared against what was sent, so a mid-flight prompt
change is recorded rather than silently applied.

**Frame identity is load-bearing.** The Pi's README is explicit: copy the
capture headers into the HUD payload "so ordering still works after the Pi
process restarts and its sequence resets". Dropping session or sequence
reintroduces stale-frame flicker.

**`0.0.0.0` is a bind address, not a host.** Pointing a workflow at it produces
a connection failure that looks like a dead server.

**Stock n8n cannot broadcast to a WebSocket.** The HUD's `ws://n8n-gateway.local:8081/detections`
needs a relay. The workflow POSTs to a relay HTTP ingest; the relay does not
exist yet.

## Where things live

- `n8n/` — the orchestration layer. Decision logic as plain functions, inlined
  into the Code nodes by `n8n/build.mjs`, tested with `node --test`.
- `raspberry-pi-streaming/` — the capture service that owns Frame Context.
- `360ControlUnit/` — the ESP32 firmware, owner of the Verdict Window.
- `pico-webapp/` / `PICOmyAPP/` — the HUD, owner of the detection payload
  contract (`parseDetectionPayload`).
- The vision model is not in this repository. See `n8n/README.md` for its
  endpoints and its current latency limitation.

## Naming in the database

Table and column names are an **assumption** until the real Supabase schema is
confirmed. `n8n/README.md` lists the assumed mapping. If you change a column
name, change it in the workflow HTTP node and in
`n8n/lib/inspection-records.mjs` together, then run `npm run build` in `n8n/`.
