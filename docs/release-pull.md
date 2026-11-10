# The release-conformance pull (conformance.siros.org)

How the site's release collection (`releases/<core>/<tag>/`) fills: the
**zero-secrets pull model** — each core repo's conformance workflow ships its
release's verdict (the certification ZIPs + the run summaries) as **release
assets**, and this repo pulls them.

```
core repo (wallet-core / verifier-core / issuer-core / …)
  tag push ──> its conformance workflow ──> gh release upload (github.token)
                                                  │  public release assets
                                                  ▼
this repo: publish-releases.yml  (daily 06:23 UTC + workflow_dispatch)
  gh api repos/<repo>/releases ──> which <core>/<tag> sets does the site lack?
  download ──> publish-pages.mjs --collection releases ──> gh-pages push
                                                  │
                                                  ▼
conformance.siros.org/releases/<core>/<tag>/   (permanent, never pruned)
```

Nothing dispatches and no cross-repo credential exists anywhere: the earlier
`repository_dispatch` design needed a fine-grained PAT whose 90-day expiry
would silently break the publish every quarter, and it is gone. The pull is
self-healing by construction — a failed or missed publish is simply found by
the next daily check.

## The repos the pull watches

`publish-releases.yml`'s `CORES` variable is the list — one `<slug>:<owner>/<repo>`
entry per line:

```bash
CORES="wallet-core:sirosfoundation/siros-wallet-core
verifier-core:sirosfoundation/siros-verifier-core
issuer-core:sirosfoundation/siros-issuer-core"
```

The slug is the site directory (`releases/<slug>/<tag>/`) and the
`workflow_dispatch` `core` input value; the repo is read through the **public
API** (so the repo must be public — that is the design's assumption).

## Adding a repo to the pull

1. **Add one line to `CORES`** in `.github/workflows/publish-releases.yml`:

   ```
   <slug>:<owner>/<repo>
   ```

   That is all this repo needs — the loop handles the rest per entry:
   - lists the releases (any with assets),
   - skips tags already published (`FETCH_HEAD:releases/<slug>/<tag>/index.html`),
   - downloads the assets into `release-sets/<slug>/<tag>/`,
   - publishes each via `publish-pages.mjs --run-id <slug>/<tag> --collection releases`.

   The daily cron picks a new release up within a day of its cut; for
   publish-now, `workflow_dispatch` with `core=<slug> tag=<tag>`.

   The runner is capped at five sets per run (the oldest leftovers
   self-heal on the next day's check).

2. **(Optional) a display label** in `scripts/publish-pages.mjs`'s
   `PROFILE_LABELS`: the summary's `profile` string → the site's heading.
   An unmapped profile falls back to the raw string — correct, just plain.

3. **Nothing else.** The site index scans `releases/<core>/<tag>/`
   generically and the "Core releases" table lists whatever it finds — a new
   repo appears on its first published release.

## What the repo must ship (the pull's contract)

The pull reads only **release assets**, so the repo's own conformance
workflow is the whole contract. The shape that works (each rule learned from
a real failure):

- **Its specs write run summaries** — one per variant plan, keyed by
  `planId`, paired to the exported `conformance-report-<planId>.zip`.
- **The tag push uploads them to the release** with `github.token`
  (no expiry, nothing to rotate): the ZIPs **and** the `*summary*.json`.
- **Static `permissions` only.** Workflow-level `contents: read`; the
  upload lives in a **tag-only job** carrying `contents: write`. NEVER an
  expression in `permissions` — GitHub's workflow validator rejects
  expressions there ("Unexpected value ''") and the whole file dies with
  zero jobs, silently, on every event (found on siros-wallet-core: the
  conformance workflow had never parsed, since its creation).
- **`GH_REPO`** for any job that calls `gh` without a checkout — gh resolves
  its repo from a `.git` directory it then does not have; every call fails
  "not a git repository" and a wait loop spins empty.
- **A `tag` re-trigger input** (workflow_dispatch): a tag whose push-run
  died has no other recovery — a dispatch against the tag ref runs THAT
  TAG'S workflow copy. The re-trigger runs main's (maintained), checks out
  the named tag's source, and uploads to that tag's release.
- **`runs-on: ubuntu-24.04`** for any job driving Playwright — `ubuntu-latest`
  resolved to 26.04 and the pinned Playwright does not support it.
- **`start_period` on compose healthchecks** — a cold CI boot (image pull +
  first boot) races a retries-only window otherwise.

See the three cores' `.github/workflows/conformance.yml` for the working
reference of every rule above.

## The published set

`releases/<core>/<tag>/` is **permanent** — never pruned. A release set is a
verdict about a tag, and the tag outlives the ephemeral `runs/` collection's
pruning window (`--max-runs 20`). A PR's results never reach the site: a PR
is a conversation, not a release — they ride the PR run's artifacts.

### Re-publishing a fixed verdict

The pending-check treats `releases/<slug>/<tag>/index.html` as *published*, so
a corrected summary is **not** re-pulled automatically. The repair path:

1. Fix the summary in the gh-pages worktree (in place).
2. `node scripts/publish-pages.mjs --reindex <core>/<tag>` — regenerates that
   run's `index.html` from the summaries in its directory, plus the top-level
   index.