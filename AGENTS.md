# ox0-blog agent bootstrap

This repository uses **Content Workflow Contract v1**.

Before Article, localization, Conversation/RTA integration, Git/PR, or Ghost publication work, read:

1. `docs/workflow/README.md`
2. `docs/workflow/responsibilities.md`
3. `docs/workflow/state-machines.md`
4. `docs/workflow/integrations.md`
5. `docs/workflow/git-policy.md`

Then recover the current repository, Article, RTA, PR, and Ghost-related state relevant to the task before mutation.

## Authority

- Git repository policy is canonical. Account memory and prior chat context are bootstrap aids only.
- Public-content source is the Article bundle under `posts/<article>/`: strict `article.json` plus locale Markdown files.
- Every Markdown file under `posts/` must belong to an Article manifest.
- Ghost is a projection target, not an editing source.
- `research-to-action` owns research/evidence/promotion governance. RTA state does not authorize Blog publication or repository mutation.
- The user normally supplies intent and material decisions. The agent owns routine editing, translation synchronization/review/checkpoints, Git/PR mechanics, validation, and authorized Ghost mechanics.
- Production publication requires an explicit publication instruction unless a separately approved automation policy exists.
- Production authorization is transient/task-scoped and must not be reconstructed merely from Article `READY`, Git state, RTA state, Ghost state, or a prior plan.

## Development and merge policy

Normal branch/HEAD movement and fix commits are allowed during development. Preparing a candidate is not the same as starting merge judgment.

Do **not** enter strict merge judgment or merge unless the user/task explicitly requests merge or merge judgment.

Once merge judgment has explicitly started, correctness/safety not proven is FAIL. `UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are FAIL. Exact final HEAD is the evidence unit; if it moves, exact-HEAD evidence is invalidated. Squash merge is the default and exact reviewed-head locking should be used where supported.

## Article authoring safety

- Technical claims must be traceable to evidence. Distinguish measurement, observation, inference, and opinion.
- Do not publish credentials, personal secrets, private/customer/company details, or raw chat transcripts merely because they appeared in source conversation/RTA context.
- Preserve publisher-owned `#ox0-*` state tags; authors must not add them manually.
- Never put Ghost Admin credentials in source, logs, examples, issues, or pull requests.
- Translation checkpoint, Article semantic readiness, projection revision, remote-resource trust, and production authorization are separate proofs. None substitutes for another.
- `PREPARE_PUBLISH`/planning is read-only with respect to Ghost and publication resource storage.
- A `draft` operation is a real mutation and may prepare repository-owned body assets or upload a local feature image before creating/updating managed drafts.
- Remote HTTPS images are not immutable-byte evidence. Production use requires explicit current host `remoteResourcePolicy` approval.
- First publication uses `draft-promotion`: exact-current managed drafts become published by status update; partial-retry published siblings may only noop. Local body assets must already be reuse-only and feature images must be preserved.
- Later published revisions stay public. Fresh production planning may update stale managed published projections in place and noop exact-current siblings. Do not unpublish them merely to stage a revision.
- The selected production mode (`draft-promotion` or `published-revision`) is pinned across the publication library's initial and refreshed pre-mutation plans. A mode change fails closed.
- The manual workflow fresh-reads current `main` before checkout and immediately before operation. These are observational distributed-race guards, not an atomic Git/Ghost transaction.
- Live evidence for this personal blog uses temporary **draft-only** Article projections on the configured Ghost instance. Evidence-only verification must never publish a temporary post.

## Article contract

Use the source and operation contracts documented by:

- `docs/article-manifest-v1.md`
- `docs/translation-fingerprint-v1.md`
- `docs/article-readiness-v1.md`
- `docs/article-review-operations.md`
- `docs/article-operations.md`
- `docs/asset-publisher.md`
- `docs/remote-resource-policy.md`
- `docs/article-publication.md`
- `docs/live-draft-verification.md`

`npm run validate` validates the Article repository. `npm run dry-run` is the Article planner. `.github/workflows/article-ghost.yml` is the manual Article control surface.

The workflow is `workflow_dispatch` only, operates only on an exact current `main` SHA supplied by the control surface, validates before operation, and requires exact publication confirmation `publish:<manifest_path>@<source_sha>` for production mutation. This confirmation binds the requested target/source; it does not infer publication authorization from repository state.

GitHub only dispatches a new `workflow_dispatch` workflow after that workflow exists on the default branch. Before then, exact-candidate live evidence may use `npm run verify:article-live-draft` on the configured Ghost instance because the verifier is hard-coded to create temporary drafts only and clean them up. Do not misrepresent a draft-verifier PASS as proof of production publication or GitHub workflow platform wiring.

## Fail closed

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess or silently use remembered policy. Preserve durable state and surface the policy conflict before mutation.
