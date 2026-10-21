# Local LocateAnything integration, resident inference, and pass/reject/error results

## Problem Statement

The operator has a local LocateAnything C++ installation and can open the local n8n editor at http://localhost:5678/home/workflows, but does not know how to connect the model to the inspection project. They want a simple final inspection result and are concerned that producing an annotated image takes too long. After comparing alternatives, the operator agreed to retain LocateAnything and its Pico Detection geometry, display `pass`, `reject`, or `error`, and prioritize resident inference before considering a different model.

The inspected model HTTP adapter already returns JSON without requesting an annotated output image. It nevertheless starts a new CLI process for each Inspection, reloading an approximately 6.26 GB q8 model each time. The configured executable was built with CUDA disabled. Changing the final response to a short classification alone does not remove model loading or inference work.

There are also concrete integration mismatches: the workflows use HTTPS for a model service currently serving HTTP, and send the uploaded image under multipart field `image` while the model expects `file`. Prompt Capture reads a top-level prompt although an actual Webhook request may put it inside the body.

The current model budget is 1200 ms and the ESP32 Verdict Window is 3000 ms. These are existing constraints, not measured performance guarantees. The firmware currently auto-passes when that window expires; a workflow rejection policy alone does not establish that the whole system fails closed.

## Solution

Provide a documented and reproducible connection from the existing n8n workflows to the local model, preserving the project's Inspection Target, Model Instruction, Frame Context, Defect Coverage, and Verdict contracts.

Present a compact final result of `pass`, `reject`, or `error` to the caller of a manual Inspection. A successful Inspection passes or rejects according to the Coverage Threshold; an unsuccessful Inspection reports `error`. Keep Detection geometry inside the inspection pipeline so existing coverage decisions, records, and Pico overlays remain possible. A `pass` means that coverage is below the configured threshold, not that no Detection exists. An operational failure may force an internal rejection while remaining visibly an `error` to the operator.

Replace per-request model loading with a resident model service first, then evaluate CUDA against the actual laptop's available memory and measure the resulting latency. Document the measured limits locally and keep automatic inspection gated on the separate deadline and firmware work in #24. If measured performance remains insufficient, record a possible small-classifier follow-up with its data and fixed-target tradeoffs; do not replace LocateAnything in this work.

This is a model integration and performance work item supporting #23. It does not replace all runtime, persistence, or system acceptance requirements in #23, #24, or #25.

## User Stories

1. As an operator, I want to start the local model service with documented steps, so that I can use the model already installed on my PC.
2. As an operator, I want to test the model with one uploaded image, so that I can distinguish a model problem from an n8n problem.
3. As an operator, I want to use my existing local n8n instance, so that I do not need a hosted inference service.
4. As a maintainer, I want to identify whether n8n runs directly on Windows or inside Docker, so that the model address is reachable from the workflow process.
5. As a maintainer, I want model URLs to use the service's actual HTTP scheme, so that HTTPS mismatches do not prevent inspection.
6. As a maintainer, I want the multipart upload field to match the model API, so that valid images are accepted.
7. As an operator, I want n8n to pull a capture from the Pi for the initial integration, so that there is one unambiguous image ingestion path.
8. As a maintainer, I want the captured bytes and Frame Context to stay associated, so that every decision refers to the correct frame.
9. As an operator, I want to change the Inspection Target from Pico, so that the model looks for the defect relevant to the current inspection.
10. As an operator, I want blank Inspection Targets rejected, so that an invalid prompt does not silently change inspection behavior.
11. As a maintainer, I want the canonical Model Instruction sent on each prediction, so that prompt formatting remains consistent.
12. As a maintainer, I want prompt echoes checked, so that a changed or mismatched instruction is visible.
13. As an operator, I want the final result to say `pass`, `reject`, or `error`, so that I can distinguish sorting decisions from an unsuccessful inspection immediately.
14. As an operator, I want inspection errors shown separately, so that an unavailable model is never mistaken for a clean item.
15. As a quality engineer, I want the compact result to use the same Coverage Threshold as the Verdict, so that the displayed decision and physical sorting decision agree on successful Inspections.
16. As a quality engineer, I want the default Coverage Threshold preserved, so that simplifying the output does not silently change sorting sensitivity.
17. As a quality engineer, I want to retain all Detection boxes internally, so that I can inspect the basis of a decision and retain Pico overlays.
18. As a quality engineer, I want confidence excluded from decisions, so that a hardcoded zero cannot make every item pass.
19. As an operator, I want the prediction path to avoid creating an annotated result image, so that optional visualization does not add work to inspection.
20. As an operator, I want the model loaded once and reused, so that every image does not pay the model startup cost.
21. As a maintainer, I want readiness to reflect whether the model can accept work, so that a running HTTP process is not mistaken for a usable inference service.
22. As a maintainer, I want simultaneous requests handled within a bounded deadline, so that queued work does not produce stale sorting commands.
23. As a maintainer, I want inference failures distinguished from valid empty detections, so that an internal engine failure cannot become a successful `pass`.
24. As an operator, I want the service to release model resources cleanly on shutdown, so that restarting it does not require restarting the PC.
25. As a maintainer, I want to evaluate CUDA on the actual RTX 3060 laptop, so that GPU acceleration is based on working measurements.
26. As a maintainer, I want memory failures and the actual compute backend reported, so that a CPU fallback is not presented as GPU performance.
27. As a quality engineer, I want smaller model variants evaluated against the baseline before adoption, so that speed improvements do not hide a loss of defect detection.
28. As a maintainer, I want startup, warm inference, queueing, and overall inspection time measured separately, so that I can identify the actual bottleneck.
29. As an operator, I want deadline misses to prevent automatic acceptance, so that slow or failed analysis does not silently approve an item.
30. As a maintainer, I want reproducible success and failure execution evidence, so that ticket #23 can be assessed against real services.
31. As a maintainer, I want local configuration and credentials kept out of shared workflow exports, so that another developer can reproduce setup without exposing secrets.
32. As a maintainer, I want a clear record of remaining firmware, database, and relay dependencies, so that model connectivity is not confused with complete system acceptance.
33. As a maintainer, I want a separate classifier follow-up considered only if measured performance is insufficient, so that I can assess its training-data and fixed-target tradeoffs before changing the model architecture.

## Implementation Decisions

- **Ownership and scope.** Modify the model HTTP adapter and its engine integration, n8n workflow generation and result mapping, relevant workflow contracts, and setup documentation. Keep reproducible adapter source and dependency/build instructions under project version control rather than leaving the only integration code in an external checkout. Reference the external model installation through local configuration; do not vendor model weights or build outputs.
- **Known local environment.** The n8n editor is reachable on port 5678 of the operator's PC. This does not determine whether n8n is containerized. Determine that during implementation from the running environment rather than inferring it from the browser URL. The existing model service uses port 8000.
- **Addressing.** For n8n running directly on the PC, use a loopback model address. For Docker Desktop on the same PC, use the Docker host address. For a separate device, use the PC's reachable LAN address. Never use the bind address `0.0.0.0` as a request destination. Configure scheme and host together so all model calls use the actual HTTP service consistently. Apply the same configuration to health and prompt operations.
- **Ingestion.** Start with the existing n8n pull of the Pi's capture endpoint. Preserve capture headers containing camera session, frame sequence, capture time, width, and height. Do not enable a competing Pi push receiver as part of this work.
- **Model HTTP contract.** Retain prediction via POST `/predict` with multipart image field named `file` and text field named `prompt`. The n8n binary property may remain named `image`; its internal name is distinct from the multipart field name. Preserve the successful JSON envelope containing status, prompt echo, and pixel-space Detection boxes relative to the uploaded frame. No annotated result image is generated or returned on this path.
- **Prompt contract.** Retain the existing prompt get/set operations. Read the Inspection Target from the actual Webhook body envelope and cover that envelope in regression tests. Reuse the canonical Model Instruction template. Reject blank input. Keep the model's global prompt as the runtime source of truth and send the resolved instruction explicitly on each prediction. Record echo mismatches according to the existing project policy rather than silently applying a new target.
- **Compact external result.** The manual Inspection response exposes a status and a result. For a valid, successfully evaluated Inspection, status is `success` and result is `reject` when Defect Coverage is at or above the Coverage Threshold or `pass` when below it. On failure, both status and result are `error`, with a machine-readable reason. The final user-facing label is the result; diagnostic fields stay available to the caller and logs. Internal Verdict remains `reject` or `pass` for ESP32 compatibility and never introduces an ESP32 action named `error`. Use the existing manual Inspection entry point instead of introducing a parallel classification API. Do not remove existing internal Inspection Result or HUD payload fields or redesign Pico screens.
- **Failure semantics.** Transport failures, timeouts, invalid captures, invalid model output, invalid coverage configuration, budget failures, and engine failures produce an `error` result and a machine-readable reason. They retain the existing workflow rejection behavior. A reject forced by an error must not be presented as a successful inspection result of `reject`, and a failure must never become `pass`. Only a successful engine run with a valid empty Detection list can support the usual zero-coverage decision.
- **Coverage semantics.** Reuse the existing Defect Coverage calculation: sum Detection box areas over frame area and clamp to the interval from zero to one. Keep the default Coverage Threshold of 0.005, including the existing behavior at exact equality. A successful `pass` means coverage is below the configured threshold; it is not proof that no Detection exists. Do not use confidence for sorting, recording, or HUD filtering. All valid boxes remain available regardless of the Verdict.
- **Resident inference.** Load one engine context during service startup and reuse it across requests through the existing library interface or an equivalent persistent worker. Do not spawn a new inference CLI or reload weights for each Inspection. Release resources on shutdown and keep model state private to this service. Remain unavailable for inference until initialization succeeds.
- **Engine error boundary.** Verify that the engine interface actually distinguishes failure from valid empty output. The inspected engine has branches that return an empty list on internal failure; an HTTP wrapper must not treat those as successful clean Inspections. Propagate an explicit success/failure outcome from the engine where necessary.
- **Concurrency and deadlines.** The inspected compute backend is not reentrant. Serialize access to a shared engine context and bound waiting or reject excess work explicitly. Include queue time in the request deadline. A timed-out caller must not cause overlapping use of a still-running context or an eventual stale Control Action. Retain existing frame/session identity and do not claim that it supplies the missing physical item correlation addressed by #24.
- **Readiness.** Make health/readiness report model initialization failure and operational unavailability with an appropriate non-success outcome. A successful HTTP process start alone is insufficient. Keep the n8n health probe compatible with the revised behavior.
- **Acceleration.** Evaluate a separate CUDA-enabled build and verify the backend actually selected at runtime. The inspected machine has an RTX 3060 Laptop GPU with 6 GiB VRAM; the q8 weight file is about 6.26 GB before runtime allocations. Do not assume the full working set fits. Record memory exhaustion and any CPU fallback. Evaluate a smaller supported quantization only with an explicit quality comparison; a particular replacement is not preselected.
- **Model choice.** Retain LocateAnything to preserve Inspection Target changes through text and Detection boxes for Pico. Prioritize model reuse before GPU and quantization evaluation. If the measured pipeline still misses the deployed deadline, record a separate option to evaluate a small image classifier, including required labelled images, quality validation, and loss of the current arbitrary-prompt behavior. Classifier or anomaly-model implementation is outside this spec.
- **Latency.** Measure the existing CLI adapter baseline and the resident service with the same images, instructions, model variant, decode mode, and measurement definitions where possible. Distinguish startup, image handling, queueing, inference, and full Inspection latency. Report p50, p95, maximum, and sample count for repeated runs; document hardware, backend, image dimensions, prompt, warmup, and failures. Report optional annotation time separately if comparing annotated and JSON-only CLI use. Do not claim an improvement factor before measuring it.
- **Timing integration.** Preserve the existing model timeout and Verdict Window checks until measurements and coordinated deadline decisions justify changes. Increasing the model timeout alone must not bypass the budget guard. Service connectivity can be accepted independently, but automatic sorting is not approved unless real end-to-end timing meets the deployed deadline and the firmware fallback work in #24 is complete.
- **Deployment evidence.** Validate configured URLs from the process or container running n8n, not just from the host browser. Keep workflows inactive until their runtime requirements are configured. Document test versus production webhook URLs. Do not commit credentials or claim database or relay connectivity from stubbed executions.

## Testing Decisions

- **Primary seam used for implementation:** the existing n8n public Webhook boundary through the model HTTP contract to observable Inspection responses and outbound Control Actions. Prefer this over new unit-test seams in individual workflow nodes. Test behaviors an operator or connected device can observe, not a particular function arrangement, process layout, or call count.
- Extend the existing generated-workflow execution harness and Inspection outcome cases as prior art. Existing coverage and HUD parser tests remain regression protection; add cases there only when behavior changes. Keep generated workflow artifacts synchronized with their definitions.
- At this primary seam, supply a frame with known Frame Context and an actual Webhook body envelope. Assert the uploaded bytes and explicit instruction arrive at the model boundary, geometry remains associated with the same frame, and the response and outbound Verdict agree. Use controlled HTTP fixtures for deterministic error and threshold scenarios; identify those executions as fixture-backed.
- Cover successful empty detections, coverage below the threshold, exact equality, coverage above it, valid detections below the threshold remaining available internally, and confidence values having no influence. Assert the compact response does not contain an annotated image or discard the internal boxes needed by downstream consumers.
- Cover blank targets, prompt changes and echoes, HTTP failures, unreachable model, delayed responses, corrupt or missing images, malformed boxes, invalid dimensions, invalid thresholds, and invalid timeout budgets. Assert that failures produce an external `error` result, never a successful `pass` or `reject`, while the outbound Control Action remains the existing forced reject. Successful below-threshold cases, including valid small Detections, return `pass`; exact-threshold and above-threshold cases return `reject`.
- Exercise model startup failure, genuine inference failure versus genuine empty output, reuse across successive requests, bounded concurrent requests, and restart through the public model HTTP boundary as focused supporting checks. Use the same client-facing model contract instead of inventing a second application API. Do not rely solely on mocked engine success to establish these properties.
- Run a real-service smoke test from the actual n8n runtime against the resident model and Pi capture service. Retain execution evidence for manual inspection, an item event, and the prompt update flow. Verify Frame Context and prompt echo. Keep actuator outputs under controlled bench conditions for this task.
- Collect a repeatable real-hardware latency and memory report for baseline and selected resident configuration, including cold start, warm requests, waiting time, and failure counts. State the fixture set and quality comparison criteria when changing quantization. Performance gates depend on the deployed Verdict Window; do not invent a new deadline or an unmeasured speed target.
- Separate modeled or fixture-backed success from real device acceptance. Database persistence, relay delivery, physical sorting, and full fault fallback remain subject to their owning issues and cannot be certified by this seam alone.

## Out of Scope

- Training or replacing LocateAnything with a different detector, classifier, or anomaly model. Documenting a conditional classifier follow-up after insufficient measured performance is allowed; implementing it requires a separate work item.
- Changing the Coverage Threshold policy to reject on any Detection, or introducing a confidence-based policy.
- Removing Detection geometry from internal records or removing the Pico overlay contract.
- Generating annotated result images, redesigning Pico screens, or building a new dashboard.
- Adding a Pi push ingestion path alongside the selected pull flow.
- Building the missing WebSocket relay, defining new Supabase tables, or implementing unrelated credentials and CORS work already owned by #23 and related issues.
- Completing the firmware fallback, physical item correlation, or late-verdict changes in #24. This work provides latency evidence and respects that dependency.
- Certifying the complete production line or closing #25 solely because the model connection works.
- Promising that binary output alone meets the existing deadline, that q8 fits the GPU, or that CUDA provides a particular speedup.

## Further Notes

- Related issue #23: https://github.com/theepop66/CN360-group-project/issues/23
- Deadline and firmware dependency #24: https://github.com/theepop66/CN360-group-project/issues/24
- Full system acceptance #25: https://github.com/theepop66/CN360-group-project/issues/25
- Existing orchestration context #17: https://github.com/theepop66/CN360-group-project/issues/17
- Environment and code observations were inspected on 2026-10-20. The user confirmed the n8n browser address, but not its process/container deployment mode. Determine that from the runtime during implementation.
- The user subsequently agreed to the recommendation to display `pass` / `reject` / `error`, retain LocateAnything and Pico boxes, and prioritize resident inference. This supersedes the earlier compact defect-presence labels without changing the Coverage Threshold or ESP32 Verdict contract.
- No inference latency benchmark or end-to-end runtime acceptance has been performed as part of writing this spec. The current API's omission of annotation is code evidence, not a measured timing result.
- The source checkout contains unrelated uncommitted documentation and generated artifacts. Preserve those changes when implementing this issue.
- Per the user's instruction, this spec and its tickets remain local. The user subsequently invoked implementation; code, fixture/runtime coverage, and measured model evidence are recorded in the accompanying implementation report. This does not certify hardware or production acceptance. No GitHub issue publication or tracker label changes are part of this request.
