# Issue #7 relay acceptance

The relay implementation and actual n8n-to-relay/browser integration were merged
in PR #33. This completes the remaining configuration and token path in PR #29.

| Check | Result |
| --- | --- |
| n8n contracts/configuration | 217/217 |
| HUD tests | 60/60 |
| Relay tests, including real HUD tunnel | 26/26 |
| Standards review | No remaining findings |
| Spec review | No remaining findings |

The active HUD default now uses `/detections` on its own page host/port, with
`ws://` on HTTP and `wss://` on HTTPS. The built-in HUD server tunnels that fixed
channel to the configured relay origin, without forwarding browser cookies or
credentials. This removes the unresolved default hostname and avoids mixed
content on secure HUD pages. Other static servers need an explicit channel URL.

The real relay/proxy checks verify pixel-box/frame delivery, heartbeat, reconnect
without replay, rejection of unrelated upgrade routes, and continued HTTP service
after an upstream outage or a browser reset during a stalled handshake. Review
found the reset crash before release; immediate socket error ownership fixes it
and the regression passes. Optional relay ingest tokens reach n8n's HTTP header
without replacing the stored Supabase credential or altering controller identity,
inspection RPC, deadline, or health-state persistence logic.

Prior actual cloud/controller/n8n delivery is retained in
[the #17 acceptance](../../issue17-software-closure-2026-10-28/README.md), including
10/10 deployed software/cloud cases. This release adds the real relay tunnel
checks; it does not claim Pico hardware, physical actuation, or AI quality
acceptance. Those remain in #24/#25. The legacy PICOmyAPP prototype is unchanged.
