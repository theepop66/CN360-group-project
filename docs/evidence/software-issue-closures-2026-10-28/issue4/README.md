# Issue #4 published-branch history cleanup

The owner explicitly approved publication after reviewing the backup, exact
removal targets, effects on the 18 branches/open PR, and GitHub retention limits.
The rewrite is published and verified. [Machine-readable evidence and ref map](history-cleanup.json).

- All 18 reviewed writable branch refs match their cleaned commit IDs.
- Every branch tip retained identical path/mode/blob entries outside the four
  approved removal targets. Application code was preserved.
- A fresh normal clone of the published repository has no history for
  `360ControlUnit/.pio/`, `.vscode/`, `test/host/build/`, or `src/secrets.h`.
  Full Git object/connectivity verification passed.
- An independent filtered mirror and a private all-ref recovery bundle were
  verified before publication, including the bundle SHA-256. Publication used
  atomic updates, explicit per-ref leases and pinned reviewed commit IDs.
- The packed mirror shrank from 143,879,318 to 132,763,056 bytes. The intended
  large report PDF and panorama remain; they are not build artifacts.
- PR #32 remains open with its rewritten branch head. No unrelated issue/PR
  was closed by the history operation.

The current ignore rules cover the build/cache/private-header paths, while the
example credential header remains tracked. The shared working checkouts and
their uncommitted files/build outputs were not filtered or deleted. The active
clean task checkout was moved to the new main history after publication.

This is closure for **published writable branch history cleanup**, under the
scope the owner approved. GitHub's 17 read-only PR refs, caches, forks and other
local clones can retain old copies. This is not proof that all old objects have
vanished from GitHub or that previously disclosed credentials are safe. Rotate
credentials if they were used, and arrange any further cache/fork removal with
the appropriate owners or GitHub Support.

Team members should back up uncommitted work and refresh their clones against
the new history before pushing. Merging an old-history branch can reintroduce
removed data. The private recovery bundle contains historical private data and
must not be uploaded. See the [cleanup/recovery procedure](../../../../docs/history-cleanup.md)
and [GitHub's retention guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
