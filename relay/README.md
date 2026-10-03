# Detection relay

Stock n8n cannot hold a WebSocket open, so the inspection loop cannot push
results to the Pico 4 HUD by itself. This service closes that gap (issue #7):

```text
n8n ──POST /detections──▶ relay ──WebSocket /detections──▶ every connected HUD
```

One port, one path: an HTTP `POST` sends a message, a WebSocket `GET` on the same
path receives them.

Every message is checked with the **HUD's own parsers**
(`pico-webapp/js/overlay.js` and `pico-webapp/js/camera-message.js`, imported, not
copied) before it is broadcast. Anything the HUD would drop or misread is refused
with `400`, so a broken payload shows up in the n8n execution log instead of as
an empty overlay on the headset.

## Run it

Node.js 18.17 or newer.

```bash
cd relay
npm install
npm start
```

Then:

- n8n: replace the `REPLACE_RELAY_HOST:8081` placeholder (see `n8n/README.md`)
  with this machine's LAN address.
- HUD: by default it connects to `ws://<host that served the HUD>:8081/detections`,
  so nothing needs changing when the relay runs on the machine serving
  `pico-webapp`. Otherwise set **Detection WebSocket gateway URL** in Connection
  settings.
- Health: `GET http://<relay>:8081/health`.

The relay imports from `../pico-webapp`, so run it from a full repository
checkout, not from a copy of this folder.

## Contract

### `POST /detections`

`Content-Type: application/json`. Accepted bodies:

| Body | Kind |
| :--- | :--- |
| `type: "detections"`, or a `detections`/`boxes` array, or a single `bbox`/`box` | `detections` |
| `type: "camera.source"` with a `camera` object | `camera.source` |
| `type: "camera.frame"` (or a frame image URL with no detection fields) | `camera.frame` |

The n8n inspection loop's payload (`n8n/lib/inspection-records.mjs`
`buildHudPayload`) is a `detections` message.

| Status | Meaning |
| :--- | :--- |
| `202` | Broadcast. Body: `{"accepted":true,"kind":"…","delivered":<HUD count>}`. `delivered: 0` is still a success — no HUD was connected. |
| `400` | Not JSON, not an object, unrecognized, reserved `type` (`heartbeat`/`ping`/`connected`), or rejected by the HUD parser (for example an inverted box, or pixel boxes without frame size). |
| `401` | `RELAY_INGEST_TOKEN` is set and the `Authorization: Bearer …` header is missing or wrong. |
| `413` | Body larger than `RELAY_MAX_BODY_BYTES`. |
| `415` | `Content-Type` is not `application/json`. |

A plain object with no detection fields is refused on purpose: the HUD parser
would read it as "zero detections" and wipe a live overlay.

### `WebSocket /detections`

Text frames, one JSON message each:

- on connect: `{"type":"connected","heartbeatIntervalMs":10000}`. Nothing else is
  replayed. A replayed `camera.source` would be read by the HUD as a camera switch
  on every reconnect (wiping the verdict, resetting frame ordering, and overriding
  the camera the operator saved), and old detections describe a frame that has
  already moved on.
- every `RELAY_HEARTBEAT_MS`: a WebSocket ping **and** `{"type":"heartbeat"}`. A HUD
  that misses a ping is dropped. The HUD watches the heartbeat message and
  reconnects after three silent intervals, which catches a half-open connection
  the browser would otherwise never notice.
- every accepted `POST` body, re-serialized.

The HUD parser ignores `connected` and `heartbeat`.

## Configuration

| Variable | Default | Meaning |
| :--- | ---: | :--- |
| `RELAY_HOST` | *(empty)* | Listen address. Empty listens on every interface, IPv4 and IPv6, so a HUD opened at an IPv6 address can still connect. |
| `RELAY_PORT` | `8081` | Port for both ingest and WebSocket. |
| `RELAY_PATH` | `/detections` | Path for both ingest and WebSocket. |
| `RELAY_MAX_BODY_BYTES` | `9437184` (9 MiB) | Room for one 8 MiB image data URL, the HUD's own cap. |
| `RELAY_HEARTBEAT_MS` | `10000` | Ping/heartbeat interval. |
| `RELAY_MAX_CLIENT_BUFFER_BYTES` | `4194304` | A HUD with more unsent data than this is dropped rather than buffered without limit. |
| `RELAY_INGEST_TOKEN` | *(empty)* | When set, `POST` needs `Authorization: Bearer <token>`. Add it as an n8n header (credential store) on the `broadcast-hud` node. |
| `RELAY_ALLOWED_ORIGINS` | *(empty)* | Comma-separated browser origins allowed to open the WebSocket, e.g. `http://192.168.1.10:8080`. Entries are normalized like browser `Origin` headers (case, trailing slash, default port), and an unparseable entry stops startup. Empty allows any. |

## Tests

```bash
npm test
```

Includes an end-to-end check: a payload built by the real n8n code is POSTed,
received over a real WebSocket, and parsed by the real HUD parser back to the
same pixel box.

## Deploy (Linux, systemd)

1. Check out the whole repository at `/opt/cn360/CN360-group-project` and run
   `npm ci` in `relay/`.
2. Put settings in `/etc/cn360-relay.env` (see `.env.example`).
3. Copy `deploy/cn360-relay.service` to `/etc/systemd/system/`, then
   `sudo systemctl enable --now cn360-relay`.

## Limits

Plain `ws://`/`http://` on a trusted prototype LAN. Without
`RELAY_INGEST_TOKEN`, anyone on the network can draw boxes on every headset.
Put TLS and authentication in front of it before any production use.
