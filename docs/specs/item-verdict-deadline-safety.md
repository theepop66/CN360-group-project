# Spec: Item-bound Verdicts and deadline-safe inspection

Published 2026-10-26 (Asia/Bangkok). Related work: GitHub #24, #17, #23 and #25.
The user confirmed the integrated test boundary on 2026-10-26. Baseline problem observations below describe the system before this implementation.
Local tracker: [07 — Item-bound Verdicts and deadline-safe inspection](../../.scratch/locate-anything-n8n/issues/07-item-verdict-deadline-safety.md). Software implementation/evidence and remaining acceptance are tracked there.

## Problem Statement

An operator cannot currently rely on an uninspected or unresponsive item being
kept out of the passing stream. The workflow attempts to reject on failure,
but the controller automatically passes an item when its 3000 ms Verdict Window
expires. Losing n8n, the model, the capture service or their network connection
can therefore produce a pass without a successful Inspection.

A delayed result can also control the wrong physical item. Notifications do not
identify the item, and a Control Action currently carries only pass or reject.
Checking that the controller is waiting is insufficient: it may now be waiting
for the next item. Frame Context identifies a captured image, not a physical item.

The recent picture tests reproduced timeout auto-pass and stale pass/reject
acceptance during a subsequent item. Three fresh GPU workers also missed the
production inference-request deadline. A resized diagnostic profile produced
101 evaluated results and 49 errors across 150 sequential case attempts. Fixture
success, a fast webhook response or a returned Inspection Result cannot by
themselves establish that the intended item was safely sorted.

## Solution

Make the controller the authority for the active physical item, its deadline
and the accepted Control Action. An item may pass only following an explicit,
valid, timely pass Verdict for that exact item and controller session. Missing,
expired, duplicate, invalid or mismatched results must never cause an unintended
pass or affect another item.

Use reject as the prototype's software timeout fallback. Automatic sorting is
permitted only after bench evidence shows that the item can still be rejected
at expiry, or an external hold/stop arrangement keeps it at the inspection
position. A timer-driven reject motion after an item has already passed the
gate is not successful fallback. If the existing mechanics cannot meet this
condition, record automatic operation as blocked pending the hold/stop integration.

Carry the controller-issued item identity through n8n, acknowledgements and
audit data. Keep snapshot storage out of the pre-verdict path and make model
readiness include a bounded warm-up before admitting inspections. Validate
correctness through the existing public inspection boundary coupled to the
actual controller logic, then establish physical behavior on the bench.

## User Stories

1. As an operator, I want an item to pass only after an explicit valid pass Verdict, so that a missing Inspection cannot silently approve it.
2. As an operator, I want the controller to reject on timeout under the validated bench arrangement, so that n8n failure does not select pass.
3. As an operator, I want automatic operation blocked when the mechanics cannot reject or retain the item in time, so that a software fallback is not mistaken for physical protection.
4. As an operator, I want network loss to leave local fallback operational, so that a disconnected controller still resolves the current item safely.
5. As an operator, I want capture-service failures to produce a named inspection error and bounded item resolution, so that a missing image cannot become a successful pass.
6. As an operator, I want model timeouts and errors distinguished from successful rejection, so that I can identify an unavailable inspection system.
7. As an operator, I want to see whether the controller accepted a Control Action separately from the Inspection Result, so that an evaluated pass is not presented as confirmed sorting.
8. As an operator, I want expired items to resolve once, so that a late result cannot move the mechanism again.
9. As an operator, I want every admitted physical item identified, so that I can trace its image, result and accepted action.
10. As an operator, I want a new controller session after reboot, so that requests from before restart cannot control new items.
11. As an operator, I want item identity kept separate from Frame Context, so that two items sharing the same frame are not confused.
12. As an operator, I want duplicate notifications and repeated Verdict delivery handled without repeated movement, so that retries do not disturb sorting.
13. As an operator, I want item A's late pass ignored while item B waits, so that B cannot inherit A's approval.
14. As an operator, I want item A's late reject ignored while item B waits, so that B cannot inherit A's rejection.
15. As an operator, I want malformed or unidentified commands refused, so that an old client cannot bypass item binding.
16. As an operator, I want manual picture checks without an active item to remain observational, so that a diagnostic request cannot move the servo.
17. As an operator, I want a manual inspection associated with a real active item to retain that item's original deadline, so that manual triggering cannot extend its admission window.
18. As an operator, I want scheduled inspections to avoid issuing unbound physical commands, so that background polling does not interfere with the line.
19. As an operator, I want the station's busy and unavailable states visible, so that feeding can respect the single-item operating arrangement.
20. As an operator, I want restart to require a safe station/admission state, so that clearing software state does not implicitly clear a physical item.
21. As an operator, I want the model warmed before the station becomes ready, so that its first prediction is not paid for inside an item's deadline.
22. As an operator, I want failed warm-up to leave inspection unavailable, so that an HTTP process starting is not mistaken for a usable model.
23. As an operator, I want a failed or restarted inference worker warmed again before readiness returns, so that later items do not encounter an unprepared worker.
24. As an operator, I want unavailable or busy inference to produce explicit errors, so that bounded concurrency cannot become an invisible queue.
25. As a quality engineer, I want the existing Defect Coverage and Coverage Threshold policy retained, so that deadline fixes do not silently change product acceptance criteria.
26. As a quality engineer, I want all valid Detections retained regardless of Verdict, so that small or disputed defects remain reviewable.
27. As a quality engineer, I want Detection quality assessed separately from delivery and deadline correctness, so that a fast wrong prediction is not accepted as a reliable inspection.
28. As a quality engineer, I want the current Verdict Window preserved until physical measurements justify a change, so that increasing a timeout does not hide a throughput problem.
29. As a quality engineer, I want sensor-to-acceptance and sensor-to-motion timing measured, so that a fast model call is not substituted for complete-system timing.
30. As a quality engineer, I want startup, warm requests, failures and deadline misses reported separately, so that averages do not hide first-item failures.
31. As a quality engineer, I want missing acknowledgements counted explicitly, so that a lack of observed late receipts is not interpreted as universal on-time delivery.
32. As a quality engineer, I want sample counts and per-case p50, p95 and maximum durations, so that performance claims can be assessed against their actual evidence.
33. As a maintainer, I want expiry checked when a Verdict is received as well as on timer progress, so that callback ordering cannot admit an expired pass.
34. As a maintainer, I want local expiry to progress despite blocking network operations, so that the fallback does not depend on a successful HTTP cycle.
35. As a maintainer, I want command acceptance distinguished from actions emitted by local fallback, so that an expired remote command is not acknowledged as accepted merely because fallback moved the mechanism.
36. As a maintainer, I want retries to retain the original identity and deadline, so that delivery attempts cannot create additional time or a new physical item.
37. As a maintainer, I want frame duplicate handling and physical-item idempotency separated, so that image reuse does not suppress a different item or reopen a resolved item.
38. As a maintainer, I want snapshot uploading after the verdict attempt, so that storage availability cannot prevent the model call or consume the pre-verdict budget.
39. As a maintainer, I want the exact captured bytes and Frame Context preserved through inference and later storage, so that moving the upload does not substitute or lose the inspected image.
40. As a maintainer, I want explicit bounded failures for prompt, capture, model and verdict delivery, so that their combined elapsed time can be measured and controlled.
41. As a maintainer, I want controller acknowledgements to identify the submitted item and ignored reason, so that wrong-session, expired and already-resolved requests can be distinguished.
42. As a maintainer, I want the same item identity in Inspection and Control Action records, so that a result can be audited through delivery and fallback.
43. As a maintainer, I want legacy action-only routes unable to control automatic inspections, so that one old endpoint cannot defeat the revised contract.
44. As a maintainer, I want firmware and workflow changes delivered as a coordinated contract update, so that mixed versions fail safely rather than accidentally accepting unbound Verdicts.
45. As a maintainer, I want deterministic virtual-time tests of deadline boundaries and clock rollover, so that correctness does not depend on flaky wall-clock sleeps.
46. As a maintainer, I want real n8n webhook executions to exercise the actual controller state machine through a thin host adapter, so that the test receiver cannot hide the firmware defect it should detect.
47. As a maintainer, I want test events and late callbacks bound to their originating case, so that one failed execution cannot contaminate the next case's evidence.
48. As a maintainer, I want real-model concurrency and recovery tested separately from scripted inference, so that fixtures do not establish unmeasured worker behavior.
49. As a maintainer, I want diagnostics that intentionally use relaxed model deadlines labelled separately, so that they cannot approve production readiness.
50. As a project reviewer, I want software correctness, model performance and physical acceptance reported independently, so that partial implementation is not reported as completion of #24 or #25.

## Implementation Decisions

- **Domain vocabulary.** Continue using Inspection Target, Model Instruction,
  Detection, Defect Coverage, Coverage Threshold, Verdict, Verdict Window,
  Inspection Result, Control Action and Frame Context with their existing
  meanings. Add Physical Item Identity as the controller-session/item pair;
  Frame Context must not serve as its substitute. Distinguish the item timeout
  fallback from a successful evaluated Verdict and record its reason.
- **Controller authority and admission.** The controller issues item identity
  and starts the Verdict Window at the debounced admission event, before
  notifying n8n. Support one active item at a time. Expose busy/fault/readiness
  information needed by the bench arrangement. Software ignoring a second
  sensor event is not physical feed control. Automatic deployment requires a
  demonstrated single-item admission/retention arrangement; unavailable
  mechanics or an unverified feed interlock blocks physical acceptance.
- **Timeout fallback.** At expiry, resolve the active item through the existing
  reject/alert behavior once, with a timeout reason and no pass increment.
  Preserve the configured operating mode and its documented mechanical
  limitations. An alert-only manual-mode response is not physical automatic
  rejection. A hold/stop alternative is a deployment dependency when reject
  cannot physically work at expiry; do not invent conveyor control from an
  unrelated relay output or silently claim a hold mechanism exists.
- **Local progress.** Expiry and actuator sequencing must not be starved by
  outbound notification, connection establishment, request parsing, recovery
  or other network work. Bound or isolate those operations so controller-local
  progress meets its deadline under an unreachable peer as well as a healthy
  one. A watchdog reboot is not a substitute for item resolution or an admission
  interlock. On boot/recovery, use a new session and require the validated safe
  station/admission condition before automatic operation resumes.
- **Identity lifecycle.** Generate a fresh boot/session token and a monotonically
  advancing item identifier for every admitted item. Send both as opaque strings
  under `controller_session` and `item_id`; preserve them without JavaScript
  numeric conversion. Prevent identity reuse within a session, including at
  counter rollover. Notification retries carry the original immutable pair.
  Do not create new identities or restart the window in n8n.
- **Notification contract.** Keep the item-detected notification boundary and
  add Physical Item Identity plus the configured Verdict Window. Snapshot the
  original admission context when issuing the notification. Report notification
  failure as failure; it must not prevent local timeout fallback. Capture and
  model interactions continue to preserve their distinct Frame Context.
- **Verdict contract.** A physical Verdict carries the unchanged `action` enum
  of pass/reject and the exact `controller_session` and `item_id` supplied by the
  controller. Validate JSON, required field types, nonblank identity and action
  before attempting acceptance. Invalid requests return an explicit client
  error and accepted false. Valid but expired, wrong-session, wrong-item,
  duplicate or no-active-item requests are ignored without applying the remote
  Verdict; return accepted false with a machine-readable reason. Keep an HTTP
  success acknowledgement for a well-formed ignored command, distinguish it
  from transport success, and echo the submitted identity.
- **Acceptance rule.** Check identity, unresolved state and elapsed time inside
  the state-machine operation that receives the Verdict. At elapsed time equal
  to the window or later, the remote Verdict is expired. Use controller-local,
  rollover-safe monotonic elapsed arithmetic. Do not rely on the next main-loop
  tick or compare controller milliseconds with an unsynchronized server clock.
  Concurrent timer/HTTP processing must converge on a single finalization;
  only one accepted result or local fallback may resolve an item.
- **Acknowledgement truth.** The state-machine receipt must distinguish whether
  the submitted command was accepted from whether any actuator/feedback actions
  were emitted. Expiry processing may emit local reject actions while the late
  remote command is ignored. A nonempty action list must not automatically
  acknowledge that expired command as accepted. Record local fallback and
  remote-command outcome separately, with identity and reason.
- **Replay and compatibility.** A repeat must never increment counters, move the
  servo again, extend the deadline or reopen an item. Commands for A cannot
  alter B, including after A timed out, completed, or belonged to a previous
  boot. Remove automatic-operation bypasses through action-only Verdicts and
  legacy reject routes. Preserve deliberate manual control behind its existing
  mode/idle constraints; it must not act as an unidentified automatic Verdict.
- **Manual and scheduled Inspection.** A request without controller-issued
  active item context is observational and cannot issue a physical Control
  Action. A manual request explicitly associated with an already active item
  can use the paired contract, without restarting its deadline. Malformed
  automatic item events are refused before inference/dispatch; the controller's
  independent fallback remains responsible for the pending physical item.
- **n8n propagation and idempotency.** Capture Physical Item Identity at the
  webhook envelope and retain it through decision, verdict delivery, response
  diagnostics and audit construction. Do not accept replacement identity from
  model output. Physical idempotency is keyed by item identity and enforced by
  the controller; Frame Context deduplication remains a separate image/HUD
  concern. Same-frame different-item events must not be conflated. Permit
  bounded retries only with the same identity; never retry expired work as a
  new item or send a second late success after a timeout decision.
- **Result and delivery semantics.** Preserve pass/reject/error as Inspection
  Result semantics and retain all valid Detections. Add or expose identity and
  the separately named Control Action outcome: requested/accepted/ignored/
  delivery-unknown, including reason and acknowledgement identity. A successful
  evaluated pass does not prove physical passing. An error may request reject
  for the matching active item without becoming a successful evaluated reject.
  Consumers and audit records must not present transport or evaluation success
  as a positively acknowledged physical action.
- **Critical path.** Keep prompt resolution, capture, model evaluation and the
  bounded verdict attempt before nonessential storage/persistence/relay work.
  Move snapshot upload after the verdict attempt while preserving the captured
  bytes and identity explicitly across HTTP nodes and failure branches. Avoid
  merges that wait on branches that produce no items. Storage failure must not
  stop inference or delay the hardware decision. Database/relay failure after
  the response does not retroactively change the Inspection Result.
- **Budgets.** Preserve the 3000 ms Verdict Window, 1200 ms n8n model HTTP timeout,
  and 1100 ms production model request deadline as the initial baseline.
  Recalculate the entire pre-verdict budget after moving storage, retaining
  headroom for network and execution overhead rather than assigning every saved
  millisecond to inference. Use measured elapsed time as well as configuration
  validation. Workflow-side expiry is best effort because event transit precedes
  webhook receipt; controller-local expiry remains authoritative. Deadline
  changes require documented physical evidence and coordinated settings.
- **Model readiness and recovery.** Extend the existing resident worker's startup
  lifecycle with a bounded, configured representative warm-up before health
  reports ready. Warm-up is initialization work with its own budget, not an
  Inspection admitted under the longer limit. Report loading/warming/failure
  unavailable, retaining the existing successful health status contract when
  ready. A dead, timed-out or replaced worker must recover and warm again before
  readiness returns. Do not restore per-request weight loading or permit
  overlapping use of the native context. Busy requests remain explicitly bounded.
- **Production and diagnostic profiles.** Readiness warm-up does not certify all
  future inference timings. Validate subsequent requests and cold-worker recovery
  under actual production deadlines. A validated fixed image profile may be
  selected only with dimensions, box mapping and Detection quality recorded.
  Do not adopt the diagnostic 448-pixel profile automatically or use its relaxed
  request limit/late-response-draining proxy as production acceptance evidence.
- **Persistence and observability.** Extend Inspection/Control Action mappings,
  relevant structured log details and delivery diagnostics with nullable
  controller session/item fields for observational requests and mandatory
  identity for physical attempts. Record fallback reason, accepted/ignored
  outcome, timing definition and missing acknowledgement explicitly. Coordinate
  actual database column types and migrations with the persistence work;
  fixture row validation does not establish that the real schema is deployed.
  Keep keys and credentials out of exported workflows and evidence.
- **Coordinated delivery.** Update controller core, firmware HTTP/notification
  adapters, n8n workflow definitions and generated exports, resident-service
  readiness, affected consumers and contract documentation together. Mixed
  versions must fail closed: an old action-only client is refused, and a new
  client must not treat an old acknowledgement without verified identity as
  confirmed acceptance. Do not silently enable existing inactive workflows or
  flash hardware as part of writing this specification.

## Testing Decisions

- **Confirmed primary seam.** Reuse the public item-event/inspection webhooks
  through observable Inspection Results and Control Actions, replacing the
  always-accepting actuator recorder with a thin host HTTP adapter around the
  actual controller state machine. Drive admission, virtual time and command
  delivery through this adapter, then assert observable receipts, states,
  counters and emitted movement/feedback. This is one integrated event-to-item-
  outcome seam rather than separate new unit seams for every workflow node.
- **What makes a good test.** Assert the intended item's accepted/ignored/fallback
  outcome, lack of repeated physical effects, correct identity, bounded result
  and truthful audit/delivery data. Do not assert node positions, private
  helpers, task layout, internal call counts or a particular locking strategy.
  Keep deterministic virtual-time correctness distinct from measured wall-clock
  performance and physical acceptance.
- **Prior art.** Extend the existing public-webhook execution harness and licensed
  static-picture fixtures. Reuse the controller host tests and desired-behavior
  timeout/stale-verdict probe, revising baseline tests that currently require
  auto-pass. Keep existing coverage and HUD parser regressions. The host adapter
  must execute the same controller core linked into firmware, not a reimplemented
  JavaScript simulation with extra identity capabilities.
- **Controller matrix.** Require no-pass fallback without a Verdict, timely pass,
  timely reject, just-before/equal/after expiry, expiry received before the next
  timer tick, duplicate event and command delivery, invalid JSON/types/actions,
  missing identity, wrong item, wrong session, previous-boot delivery, counter
  lifecycle and monotonic-clock rollover. Test both stale A pass and stale A
  reject while B awaits the opposite result. Check counters and movement/feedback
  once, including the distinction between fallback actions and remote acceptance.
- **Firmware adapter checks.** Exercise outbound notification failures, malformed
  inbound requests, unreachable peers, stalled connection/request handling,
  reconnect and reboot without starving controller-local progress. Verify
  legacy automatic bypasses are refused and manual mode does not accidentally
  supply a production fallback guarantee. Confirm admission remains gated under
  the validated single-item bench arrangement.
- **n8n matrix.** Use actual webhook body envelopes and paired identity through
  success, model timeout/error, invalid geometry, capture failure, ignored/expired
  controller reply, verdict transport loss and bounded retries. Include same
  Frame Context across two different item identities, duplicate notifications,
  reordered completions, identity-free manual/scheduled observation and valid
  paired manual inspection. Ensure a late success cannot overwrite a timed-out
  physical decision or create a command for the next item.
- **Storage and reporting.** Make storage slow/offline and prove inference/verdict
  continue without waiting for upload. Confirm saved bytes/hash and Frame Context
  match the inspected capture, control records retain item identity and ignored
  reasons, and all valid boxes remain available. Keep evaluation success separate
  from delivery success. Use service fixtures for these deterministic contracts
  and mark real persistence/relay acceptance pending where services are unavailable.
- **Readiness supporting checks.** At the existing public Model HTTP boundary,
  verify initialization/warm-up unavailable, warm-up failure, ready after a
  completed warm-up, bounded concurrent requests, request timeout, worker death,
  restart and rewarm. Use controlled engines for deterministic failures and
  separate real native-worker evidence for actual startup/performance. Preserve
  the canonical instruction, explicit prompt and model echo policy.
- **Performance evidence.** Measure production-profile first admitted predictions
  after readiness and repeated warm inspections, plus unavailable/busy/error
  cases. Record startup and warm-up separately; retain every attempted case and
  missing/censored duration. Report per-case and overall sample counts, p50,
  p95, maximum, deadline misses, missing receipts and controller acceptance.
  Record image geometry, instruction, model/backend/configuration and source
  hashes. Do not subtract unsynchronized host/controller clocks.
- **Bench gate.** With actual firmware and existing safe bench preparation,
  measure sensor admission to controller acceptance and physical movement,
  including queue/network overhead, n8n offline, model slow/offline, capture
  failure, lost Verdicts, restart and stale A/B delivery. Begin without mechanical
  load. Show firmware state, counters and actual actuator behavior together.
  Reject-at-expiry is accepted only when item retention/rejection is physically
  demonstrated; otherwise hold/stop integration remains a blocker.
- **Acceptance separation.** Controller correctness, workflow contract completion,
  production inference performance and physical fallback each receive explicit
  pass/fail/blocked status. Passing fixtures cannot close #24 or #25. Keep the
  current picture set as a smoke evaluation and record its known false positives
  and missed defect separately from delivery correctness.

## Out of Scope

- Replacing or training LocateAnything, adding a classifier, changing arbitrary
  text-target behavior, tuning the Coverage Threshold to hide Detection errors,
  or introducing confidence filtering.
- Certifying Detection accuracy or automatic line throughput from the small
  picture set, warm-up success, diagnostic deadlines or nominal timeout sums.
- Raspberry Pi/camera deployment and real capture recovery, currently deferred.
  A capture substitute remains valid for software checks but not Pi acceptance.
- Building the general database schema, WebSocket relay, broad credentials/CORS
  work or a new HUD/dashboard. Identity mapping, acknowledgement truth and the
  minimal consumer updates required by this contract remain in scope.
- Designing an arbitrary conveyor, manufacturing a hold/stop mechanism or
  assuming an existing relay implements one. If the current mechanics cannot
  establish the required single-item fallback, automatic acceptance remains
  blocked pending that integration; the requirement is not waived.
- Multi-item pipelining, tracking several physical items concurrently or allowing
  a queue of native model requests beyond their remaining time budget.
- Activating live workflows, flashing devices, changing external credentials,
  rewriting unrelated user changes or closing GitHub issues as part of spec drafting.

## Further Notes

The repository currently uses local tickets for this integration. GitHub
[#24](https://github.com/theepop66/CN360-group-project/issues/24) is the originating
reference; #17/#23 provide orchestration context, #26 owns real persistence
coordination, and #25 remains the complete-system acceptance gate. This spec
does not certify or close those issues.

The [26 October test evidence](../evidence/static-image-inspection/2026-10-26/README.md)
is the starting point. It records 37 controlled scenarios passing, three fresh-
worker timeouts, 150 diagnostic attempts, normal-control false detections and
the failed real-controller virtual-time cases. Existing passing controller
regressions still expect timeout auto-pass and must be updated deliberately.

Existing domain/spec text includes assumptions that will change: auto-pass at
expiry, action-only Control Actions, manual/scheduled physical dispatch,
pre-verdict snapshot upload, and load-only model readiness. Update those
descriptions alongside implementation without treating the current documents'
aspirational fail-closed statement as evidence that physical fallback exists.

The confirmed primary test seam reuses the previously agreed public n8n boundary
and actual controller core. A host HTTP adapter connects the existing seams;
public Model HTTP lifecycle checks and hardware bench validation are supporting
evidence, not substitutes for the integrated item-outcome acceptance.
