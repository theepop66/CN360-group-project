# Control unit tools

## Line latency (`line_latency.py`)

Measures how long each item waits for its verdict on the real line, as issue
#24 asks: p50 / p95 / max with sample counts against an agreed deadline.

The firmware keeps its newest 32 finished items and serves them on
`GET /cycles`:

```json
{
  "verdict_window_ms": 3000,
  "recorded": 57,
  "cycles": [
    { "item_id": 56, "latency_ms": 1180, "outcome": "reject" },
    { "item_id": 57, "latency_ms": 3000, "outcome": "timeout" }
  ]
}
```

`latency_ms` runs from the debounced IR detection to the moment the ESP32
accepts a verdict. It covers the notify to n8n, frame capture, model, decision
and verdict POST. Servo travel comes after and is fixed. A `timeout` row is an
item that reached the Verdict Window with no verdict (now rejected, see #24).
Stale and ignored verdicts are not recorded.

Run it on a laptop on the same network while items go down the line:

```powershell
python tools/line_latency.py --esp32 http://192.168.1.50 --items 50 --output latency.json
python tools/line_latency.py --esp32 http://192.168.1.50 --duration 300 --deadline-ms 2000
```

It reads only `/cycles`, never sends a command, and needs only the Python
standard library. Items already on the board when it starts are not counted.
Percentiles are over real verdicts; timeouts are reported separately and count
as misses of the deadline. If more than 32 items finish between two polls the
extras are reported as `missed_between_polls`; lower `--interval` if that
happens. The deadline defaults to the board's Verdict Window.

Tests: `python -m unittest tools/test_line_latency.py`.
