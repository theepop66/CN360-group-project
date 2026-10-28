# Ticket 07 code review

Comparison baseline: `69c53da3c33637ec4b4a1b9fd6f4e1eed6fe0d4c`, immediately
before ticket 07 implementation. Two independent agents reviewed the staged
implementation with the code-review skill. Pre-existing unstaged user edits
were excluded from the review/commit scope.

## Standards

Four correctness findings were resolved:

1. **P1, watchdog ownership:** registration/feed moved from the network task
   into the independent control task; initialization precedes task creation.
2. **P2, benchmark startup:** background loading/warming HTTP 503 states are
   transient within separate initialization bounds. The report explicitly
   separates warm-up from admitted request samples. A real CLI/resident run
   completed successfully with zero errors.
3. **P2, concurrent test ordering:** ordering uses each execution's events;
   missing delivered commands remain compatible with truthful unknown delivery.
   The actual core still must resolve the item once.

4. **P2, snapshot object name:** restoration now carries the captured object
   name alongside the binary. The HTTP fixture checks the actual storage object
   path against that execution's captured Frame Context; checking bytes alone
   was insufficient. A failing restoration test preceded the correction.

Focused re-review: zero remaining Standards findings; no additional material
Fowler-smell findings. Inlined workflows and the thin host transport follow the
documented project conventions.

## Spec

One initial P2 finding was resolved: delivery diagnostics now retain requested
and acknowledged identity separately, including mismatched echoed item IDs.
The fields propagate to the webhook response, Control Action row and structured
logs, with unit and integrated mismatch checks.

Focused re-review: zero remaining Spec findings and no scope creep. The reviewer
confirmed that production timing and physical acceptance remain partial, rather
than additional unacknowledged implementation claims.

Review totals: Standards 0 remaining; Spec 0 remaining. Physical validation and
the failed production inference deadline remain explicit acceptance limitations.
