# Article operations

This document describes repository validation, read-only planning, synchronization, and the manual production control surface. Durable authorization/state-machine policy in `docs/workflow/` remains authoritative. Validation or planning never grants merge or production-publication authorization.

## Validate repository source

```bash
npm run validate
```

The repository is Article-only. Validation scans `posts/` for exact-lowercase regular-file `article.json` manifests and requires every Markdown file under `posts/` to be owned by a manifest LocaleVariant.

Repository-wide checks include:

- strict manifest/source/path validation;
- compiler/raw-HTML/resource validation;
- local material-asset and feature-image confinement/hashing;
- unique stable `articleId` and `variantId` values;
- unique public Ghost slugs;
- no nested Article bundles;
- no unclaimed Markdown anywhere under `posts/`;
- no symlink source ownership;
- deterministic translation/readiness recovery.

Titles are presentation content, not repository identity.

## Validate Article state

```bash
npm run validate:articles
npm run validate:articles -- --ready
npm run validate:articles -- posts/example/article.json
npm run validate:articles -- --ready posts/example/article.json
```

Normal validation permits work-in-progress states such as Article `DRAFT`, translation `UNREVIEWED`, and translation `INCOMPLETE`.

`--ready` additionally requires every selected Article to recover as:

```text
translation = SYNCED
readiness   = READY
```

This is stronger evidence, not merge or publication authorization. Repository-wide Article invariants are always checked before a selected subset is returned.

## Read-only planning

```bash
npm run dry-run -- posts/example/article.json draft
npm run dry-run -- posts/example/article.json publish
```

The action is mandatory and is never inferred from source metadata or Ghost state.

Planning may require:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
OX0_HOST_RUNTIME_MODULE=host/runtime.mjs   # optional
```

Ghost credentials are needed because planning reads current ownership/collision/projection state. Planning is read-only with respect to Ghost and body-asset storage.

A `publish` plan additionally requires `SYNCED + READY` and current remote-resource trust approval where applicable. A plan is ephemeral evidence; source, Ghost, resource, or trust changes require recomputation.

## Host runtime

An optional operator-controlled host module may export:

```js
export const assetPublisher = ...;
export const projectContext = ...;
export async function remoteResourcePolicy(resource) { ... }
```

The module path must be an exact unaliased repository-relative `.mjs` path under `host/`. Article source cannot select it.

- `assetPublisher` binds exact repository body assets to stable HTTPS delivery.
- `projectContext` supplies compiler/VirtualProject context.
- `remoteResourcePolicy` explicitly approves or denies external HTTPS resources for production use.

## Low-level synchronization

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

This is an execution primitive, not an authorization generator.

### Draft

Draft synchronization rejects a production authorization envelope. It may prepare body assets, upload a local feature image, and create/update managed Ghost drafts. It refuses to unpublish an existing managed published projection.

### Publish

Production publish requires externally supplied strict JSON:

```text
OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON
```

The authorization must bind explicit task intent to the exact Article and every required locale projection fingerprint. Missing, malformed, wrong-Article, incomplete-locale, or stale authorization fails closed.

The publication library re-plans and revalidates source, assets, remote-resource policy, authorization, and Ghost observations before mutation. Errors preserve stage, completed body-asset side effects, feature-image upload evidence where applicable, and fresh per-locale recovery state.

## Manual GitHub Actions control surface

`.github/workflows/article-ghost.yml` is `workflow_dispatch` only. Inputs are:

```text
manifest_path
source_sha
operation = plan-draft | draft | plan-publish | publish
publish_confirmation
```

The workflow fails closed unless:

- it runs from `refs/heads/main`;
- `source_sha` equals the exact dispatch `github.sha`;
- fresh current `main` still equals that source before checkout and immediately before operation;
- exact `source_sha` is checked out and verified;
- the manifest is an unaliased `posts/.../article.json` path;
- Node 24 locked install, tests, repository validation, and selected Article validation pass before operation.

### `plan-draft`

Read-only draft planning.

### `draft`

Explicit non-production mutation. It may prepare required resources and create/update managed drafts. It must never unpublish an existing public projection.

### `plan-publish`

Read-only production eligibility and transition classification. A valid plan classifies into one production mode.

#### `draft-promotion`

First publication. Every required locale must be either:

- an exact-current managed draft planned as `status-update` to `published`; or
- during partial-retry recovery, an exact-current already-published sibling planned as `noop`.

All local body assets must already be `reuse`; feature images must be `none` or `preserve`. First publication therefore cannot create/rewrite public content or introduce new resource writes in the final promotion step.

#### `published-revision`

When every required locale is already managed and `published`, a later READY/SYNCED revision stays public. Stale locales may be planned as `update`; exact-current siblings may be `noop`.

A revision may introduce a new body asset or local feature image. Such resource writes are allowed only under the exact authorized revision and are fully revalidated before Ghost mutation.

### `publish`

Explicit production mutation. It requires exact confirmation:

```text
publish:<manifest_path>@<source_sha>
```

The dispatch adapter creates production authorization only from a fresh valid production plan and records the selected mode. The core library independently recreates the plan and re-runs the mode-pinned guard before asset side effects and again after source/resource/policy revalidation immediately before Ghost mutation.

If fresh state would change the selected mode or widen the allowed operation, publication fails closed.

Partial failures are retried only from fresh current evidence. A stale PublicationPlan is never replayed.

## Live draft verification

```bash
npm run verify:article-live-draft
```

For this personal blog, candidate-level live draft evidence may use the configured real Ghost instance; a second deployment is not required.

The verifier is explicitly opt-in, exact-clean-HEAD bound, requires expected Ghost URL double-entry, creates a unique temporary bilingual Article, drives normal translation/readiness review to `SYNCED + READY`, synchronizes **draft only**, verifies both locales as `DRAFT_CURRENT`, and performs ownership-bound cleanup.

It never creates production publication authorization and never requests `published` status. A PASS proves draft synchronization/recovery/cleanup semantics only.

## Related contracts

- `docs/article-manifest-v1.md`
- `docs/article-review-operations.md`
- `docs/article-publication.md`
- `docs/asset-publisher.md`
- `docs/remote-resource-policy.md`
- `docs/live-draft-verification.md`
- `docs/workflow/`
