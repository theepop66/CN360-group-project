# Control iPhone capture zoom from the HUD joystick

The user clarified that zoom means controlling the mobile camera before images
are sent. Replace the prior HUD-only digital crop. A joystick request must reach
the paired iPhone, change its video track zoom, and be acknowledged using actual
camera settings. Live preview, HUD and n8n then receive those source pixels.

- Request zoom-capable camera access and read the live track's capabilities and
  settings. Use its min/max and discrete step when exposed, not a hardcoded
  1–4× range. WebKit's min/max-only DoubleRange uses 0.1× requests, still
  requiring actual settings confirmation. Web API zoom does
  not guarantee optical lens zoom; hardware/browser determine implementation.
- Send left-stick up/down/reset and toolbar commands through the PC receiver to
  the current phone session. Right-stick servo and other controls stay separate.
- Require the pairing code for viewer control; never persist it or put it in a
  URL. Publisher camera reports require its session token. Bound request sizes.
- Only one zoom command may be pending. Readback confirms applied zoom, not a
  queued request or a resolved `applyConstraints` promise alone. Session-bound
  command IDs reject old or mismatched acknowledgements.
- Hide old captures during pending camera changes; discard in-flight frames
  from before confirmation and capture a newly presented frame after applying.
- If zoom is unsupported or settings cannot confirm it, show an explicit state.
  Do not silently enlarge, crop or transform the received HUD image instead.
- Disable control when the phone is absent/stale, the source is not the active
  same-origin phone feed, or the control code is missing. Report failures without
  pretending the requested zoom was applied. Reset means nearest supported 1×.
- Refresh state on reconnect and XR mode changes. Stop pending callbacks,
  requests and polling on page exit. No commands may cross phone sessions.

Validate camera API calls/readback, unsupported and ignored constraints, HTTP
control authentication/session/acknowledgement, delayed and in-flight frames,
joystick isolation, and absence of viewer image scaling. Physical iPhone zoom,
Safari capability availability and Pico joystick operation remain pending until
observed. Do not claim #23/#24/#25 acceptance from software tests.

References: [W3C Image Capture](https://www.w3.org/TR/image-capture/),
[WebKit capture source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm).
