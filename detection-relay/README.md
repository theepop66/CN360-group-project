# Detection relay

Stock n8n cannot serve a WebSocket. This small Node service sits beside n8n and
turns n8n's HTTP POST into a WebSocket broadcast for the PICO HUD:

```
n8n broadcast-hud ──POST /detections──▶ relay ──ws://…:8081/detections──▶ HUD(s)
```

It runs **on the same machine as n8n** (a PC during development, the Pi in the
finished product). It keeps no state beyond the open sockets: a HUD that
connects late gets `{"type":"connected"}` and waits for the next live frame,
never an old one.

## Run it

Node 20 or newer.

```sh
cd detection-relay
npm install
npm start
```

The startup log prints the URL n8n should POST to and the URL the HUD should
open.

## Configuration

All environment variables are optional. See `deploy/relay.env.example`.

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `RELAY_BIND` | `0.0.0.0` | Listen address. `0.0.0.0` is a bind address only; HUDs use this machine's LAN name or IP. |
| `RELAY_PORT` | `8081` | Port for both the ingest and the WebSocket. |
| `RELAY_PATH` | `/detections` | Path for both `POST` (n8n) and the WebSocket (HUD). |
| `RELAY_INGEST_TOKEN` | empty | Empty turns the token check off. See below. |
| `RELAY_HEARTBEAT_MS` | `15000` | Ping interval; a HUD that misses a ping is dropped. |

Invalid values stop the relay at startup.

## Wiring

**n8n.** In `n8n/runtime.local.json` set `relayBaseUrl`:

- n8n installed directly on the machine: `http://localhost:8081`
- n8n in Docker: `http://host.docker.internal:8081`

then run `node configure.mjs`.

**HUD.** The default is `ws://n8n.local:8081/detections`. If the n8n machine
has another name or IP, change it in the HUD's Connection settings.

The relay uses plain `ws://` and HTTP. It is meant for the closed line LAN.

## Ingest token (off by default)

With `RELAY_INGEST_TOKEN` empty, any POST to `/detections` is accepted. To stop
other machines on the LAN from drawing boxes on the HUD:

1. Generate a token: `openssl rand -hex 32`.
2. Set it as `RELAY_INGEST_TOKEN` for the relay.
3. Set the same value as `relayIngestToken` in `n8n/runtime.local.json` and
   rerun `node configure.mjs`.

n8n then sends it in the `X-CN360-Relay-Token` header. A missing or wrong token
gets `401` and nothing is broadcast. Tokens may only use `A-Z a-z 0-9 . _ ~ -`.
Keep the real value out of git.

## HTTP API

| Request | Response |
| :--- | :--- |
| `POST /detections` with a HUD payload | `202 {"delivered": <HUD count>}` |
| `GET /health` | `{"ok": true, "clients": <n>, "lastIngestAt": <ISO time or null>}` |
| Bad JSON / not a `{"type":"detections","detections":[…]}` object | `400` |
| Body over 64 KB | `413` |
| Token on and header missing or wrong | `401` |

An empty `detections` array is forwarded on purpose: it is how the HUD clears
its overlay after a failed inspection. Any `confidence` field is removed before
broadcast, because the HUD must not show confidence.

WebSocket messages besides detections are `{"type":"connected"}` on connect and
`{"type":"heartbeat","timestamp":…}` with each ping. The HUD parser ignores both.

## Check it by hand

```sh
curl http://localhost:8081/health

curl -X POST http://localhost:8081/detections \
  -H "Content-Type: application/json" \
  -d '{"type":"detections","frame":{"id":"s:1","sessionId":"s","sequence":1,"width":1920,"height":1080},"detections":[{"label":"mold","box":[100,200,300,400],"status":"reject"}]}'
```

Open the HUD (or any WebSocket client on `ws://localhost:8081/detections`)
before the POST to see the frame arrive.

## Run as a service (Linux / Pi)

```sh
sudo cp -r detection-relay /opt/cn360/
cd /opt/cn360/detection-relay && sudo -u cn360 npm ci --omit=dev
sudo cp deploy/relay.env.example /etc/cn360-relay.env   # optional
sudo cp deploy/cn360-relay.service /etc/systemd/system/
sudo systemctl enable --now cn360-relay
```

## Tests

```sh
npm test
```

No network beyond `127.0.0.1`. `test/contract.test.mjs` builds a payload with
n8n's own `lib/` code, sends it through a live relay and parses it with the
HUD's `parseDetectionPayload`, so the three parts cannot drift apart silently.
