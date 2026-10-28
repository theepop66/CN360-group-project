# Control-unit history cleanup (#4)

The current checkout no longer tracks the old build tree or private credential
header. `360ControlUnit/.gitignore` also excludes host build outputs and Python
caches. This prevents new accidental additions; it does not remove old commits.

The historical removal targets are exactly:

```text
360ControlUnit/.pio/
360ControlUnit/.vscode/
360ControlUnit/test/host/build/
360ControlUnit/src/secrets.h
```

## Prepared rewrite

Use a **separate bare mirror outside the shared workspace**. Retain an unfiltered
backup mirror and a verified `git bundle --all` outside cloud-synced folders.
Those backups contain old private data and must not be published or attached.
Never filter the user's shared checkout, discard its local changes, or delete
local build outputs as a substitute for fixing published history.

Run `git-filter-repo` with `--sensitive-data-removal --invert-paths` and one
`--path` argument for each target above, against a fresh independent clone of
the backup. Record the commit/ref mapping. Check every branch's retained tree
entries (path, file mode, blob ID) against its original tip, excluding only the
four targets. Verify no targeted path remains reachable in the cleaned graph.
Report actual packed/uncompressed sizes; the intended large report and panorama
assets are not cleanup targets.

Before publishing, record the exact current branch/tag IDs. A published rewrite
changes commit IDs for collaborators and can affect open PR reviews. Show the
verified backup and branch mapping for review first. Push only reviewed branch
and tag refs, **atomically with explicit per-ref force-with-lease checks**. Do not
use a blind `push --mirror` that could delete new refs or try to write GitHub's
read-only PR refs. If a lease fails or a new branch appears, refresh the snapshot
and prepare/verify again before proceeding.

After publication, verify remote ref IDs and a fresh normal clone's reachable
history. Retain the private recovery bundle and record results on #4. Colleagues
must use the cleaned history when updating their clones; merging old history
back can reintroduce the removed data. Their uncommitted changes need their own
backup before any local reset/reclone.

## GitHub retention and credentials

Rewriting branches is not proof that all old data vanished from GitHub. Read-only
PR refs, cached views, other clones and forks may retain old objects. If historical
credentials were actually used, rotate/revoke them; a history rewrite does not
make an exposed password secret again. GitHub Support/fork owners may be needed
for removal outside writable refs. No account, fork, PR, or unrelated branch work
is deleted by this cleanup.

See [GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
and [git-filter-repo's manual](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt).
