# ox0-blog

Canonical Git-backed Article source and controlled Ghost projection workflow for <https://blog.ox0.uk/>.

## Source contract

One logical Article owns stable identity and required localized variants:

```text
posts/<article>/
  article.json
  ko-KR.md
  en.md

assets/
  ...
```

`article.json` stores stable Article/LocaleVariant identity, locale-source mapping, source-owned projection metadata, reviewed translation checkpoint, and Article-readiness evidence. Repository paths and public slugs are not identity. Ghost is a projection target, not an editing source.

Every Markdown file under `posts/` must be owned by an Article manifest. The former one-file/frontmatter/`:::lang` publisher is no longer a supported runtime path.

## Core invariants

- Git source is canonical; Ghost is a recoverable projection.
- Translation synchronization, Article semantic readiness, Git state, Ghost projection state, and RTA state are independent.
- Translation generation alone never produces `SYNCED`; an exact-current review checkpoint is required.
- Article `READY` never implies merge or production-publication authorization.
- Production publication authorization is supplied by a trusted control surface and bound to the exact Article plus every required locale projection fingerprint. A reviewed merge to `main` authorizes publication of the exact affected Article source; manual dispatch remains an explicit recovery/operations path.
- The normal PR validation workflow never mutates Ghost. A separate trusted `pull_request_target` publication workflow may stage **new same-repository `READY + SYNCED` Articles** as managed Ghost drafts; PR executable code is never run with Ghost secrets.
- Planning is read-only with respect to Ghost and publication resource storage.
- Draft preparation is a real mutation and may prepare body assets or upload a local feature image.
- Published Articles are updated in place; they are never temporarily unpublished merely to stage a revision.
- Partial locale failure is never aggregate success; fresh recovery reports each locale independently.
- Unmanaged Ghost content is never adopted merely because a slug matches.

## Validation

Node.js 24 is canonical.

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

`npm run validate` validates the complete Article repository. It rejects malformed manifests, invalid compiler/resource inputs, duplicate Article/variant IDs and public slugs, nested Article bundles, symlinks, unclaimed Markdown, and invalid local asset evidence.

Article-specific readiness checks are also available:

```bash
npm run validate:articles
npm run validate:articles -- --ready
npm run validate:articles -- posts/example/article.json
npm run validate:articles -- --ready posts/example/article.json
```

Normal validation permits work-in-progress states such as `DRAFT`, `UNREVIEWED`, and `INCOMPLETE`. `--ready` additionally requires `translation=SYNCED` and `readiness=READY`; it still does not authorize merge or publication.

## Planning and synchronization

Read-only Article planning:

```bash
npm run dry-run -- posts/example/article.json draft
npm run dry-run -- posts/example/article.json publish
```

Low-level synchronization primitive:

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

Planning may read Ghost ownership/collision/projection state but never writes Ghost or publication storage. Low-level production publish requires an externally supplied exact-source authorization envelope; repository mechanics never manufacture publication intent.

## Pull-request Article preview

Non-draft pull requests produce an exact-HEAD browser-review artifact through the `PR Article Preview` job in `.github/workflows/validate.yml` after normal validation succeeds.

The workflow compiles the affected Article set through the repository compiler boundary and uploads one unarchived `article-preview.html` file. The Actions job summary links to that artifact; the file can be opened from the artifact UI for full-document review without mutating Ghost.

Local/manual generation uses the same operation:

```bash
npm run preview:articles -- \
  --output /tmp/article-preview.html \
  --resource-base-url https://raw.githubusercontent.com/OWNER/REPO/SHA/ \
  --source-revision SHA \
  posts/example/article.json
```

The preview operation is source/compiler-neutral above the `DocumentCompiler` boundary. Manifest v1 remains Markdown-only; future Quarkdown/Typst source support requires an explicit versioned authoring contract but should not require redesigning the PR-preview workflow.

See `docs/article-preview.md`.

## Automatic Article publication lifecycle

`.github/workflows/article-publication-lifecycle.yml` owns the normal Article projection lifecycle.

For same-repository non-draft pull requests, it executes only trusted base-branch tooling, treats the exact PR head as Article/source data, and stages **newly added** `READY + SYNCED` Articles as managed Ghost drafts. Existing published Article revisions continue to use the PR HTML preview instead of being unpublished or rewritten as drafts.

For `main` pushes that touch Article bundles, the workflow selects only Articles affected by that exact push, re-runs tests and readiness validation, proves that the selected Article directories have not changed on a later `main` commit, fresh-plans every production transition, and then publishes with mode pinning plus normal `PUBLISHED_CURRENT` post-verification.

The merge is the normal production authorization boundary. The manual workflow remains available for recovery and operator-controlled retries.

After every successful automatic publication batch, the workflow emits a `blog-publication` repository dispatch to the GitHub profile updater when `PROFILE_REPO_DISPATCH_TOKEN` is configured. The profile repository's own schedule remains the fallback.
## Manual GitHub Actions control surface

`.github/workflows/article-ghost.yml` is `workflow_dispatch` only. Inputs are:

```text
manifest_path
source_sha
operation = plan-draft | draft | plan-publish | publish
publish_confirmation
```

The workflow is bound to the exact current `main` SHA, checks out that SHA, validates before the selected operation, fresh-checks `main` again immediately before mutation, and serializes Ghost operations with the repository concurrency lock.

Production `publish` additionally requires exact confirmation:

```text
publish:<manifest_path>@<source_sha>
```

The control surface supports two production modes:

- `draft-promotion`: first publication promotes exact-current managed drafts to `published`; local body assets must already be `reuse` and feature images are preserved.
- `published-revision`: an already-published READY/SYNCED revision updates stale managed public projections in place while exact-current siblings noop. New resource publication is allowed only when required by that exact authorized revision.

The selected mode is pinned across the publication library's initial and refreshed plans. A mode change fails closed.

## Live draft verification

A second Ghost deployment is not required. Exact-candidate draft evidence can use the configured real Ghost instance:

```bash
npm run verify:article-live-draft
```

The verifier is explicitly opt-in, binds to an exact clean Git HEAD and expected Ghost URL, creates only temporary managed drafts, verifies both locales as `DRAFT_CURRENT`, and performs ownership-bound cleanup. It never constructs production authorization or requests `published` status.

## Compiler and resource boundary

Canonical compilation is asynchronous:

```text
DocumentCompiler.compile(LocaleVariant, ProjectContext)
  -> CompiledDocument
```

`MarkedCompiler` is the current backend. Arkst remains a later backend after semantic/resource parity gates are available.

Local body assets are source evidence. A host-owned `AssetPublisher` supplies stable HTTPS delivery. External HTTPS images require explicit current host trust approval for production publication. Local feature images are handled separately through Ghost's Image API with exact-byte snapshot checks and bounded side-effect evidence.

Optional deployment-specific dependencies are loaded from an operator-controlled repository module:

```text
OX0_HOST_RUNTIME_MODULE=host/runtime.mjs
```

The path must be an exact unaliased repository-relative `.mjs` file under `host/`; Article source cannot select it.

## Ghost projection and recovery

Stable locale projections use publisher-owned hidden Article/locale/variant identity plus revision/sync evidence. Fresh recovery derives states such as:

```text
NOT_PROJECTED
DRAFT_CURRENT
PUBLISHED_CURRENT
OUTDATED(...)
RECONCILIATION_REQUIRED(...)
```

If a Ghost mutation succeeds but final managed stamping fails, the projection remains visible as reconciliation-required rather than being silently forgotten.

## Documentation

- `docs/article-manifest-v1.md` — canonical source representation
- `docs/article-claim-proof.md` — material-claim/source-role/recommendation proof contract
- `docs/translation-fingerprint-v1.md` — translation-equivalence evidence
- `docs/article-readiness-v1.md` — semantic readiness
- `docs/article-review-operations.md` — review/checkpoint operations
- `docs/article-operations.md` — validation/planning/control entrypoints
- `docs/article-publication.md` — Article-level publication orchestration
- `docs/asset-publisher.md` — body-resource publication contract
- `docs/remote-resource-policy.md` — external resource trust policy
- `docs/live-draft-verification.md` — draft-only live evidence
- `docs/live-verification-policy.md` — personal-blog evidence policy
- `docs/workflow/` — durable state, authorization, Git, and RTA policy

## Verification status

Tests and workflows existing in the tree are not proof by themselves. Merge review, when explicitly started, is exact-HEAD proof work. The repository is public and GitHub-hosted Actions can allocate runners; normal validation executes for non-draft pull requests and pushes to `main`. CI results are development evidence, while strict merge judgment still requires exact-head proof under the merge gate.
