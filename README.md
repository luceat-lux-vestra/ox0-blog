# ox0-blog

Canonical Article source and controlled Ghost projection workflow for <https://blog.ox0.uk/>.

The repository is migrating from an earlier one-file Markdown publisher to an agent-operated `Article + LocaleVariant` model. The target Article contract is authoritative for new architecture work; the legacy one-file publisher remains a compatibility path only.

## Target contract

One logical Article owns stable identity and required localized variants:

```text
posts/<article>/
  article.json
  ko-KR.md
  en.md

assets/
  ...
```

`article.json` stores stable Article/variant identity, locale-source mapping, source-owned projection metadata, reviewed translation checkpoint, and Article-readiness evidence.

It does **not** store Ghost IDs/state as canonical source truth, Git/RTA lifecycle state, merge/publication authorization, raw chat/session/model identifiers, compiler IR, or rendered HTML.

See:

- `docs/article-manifest-v1.md` — durable source representation;
- `docs/translation-fingerprint-v1.md` — translation-equivalence evidence;
- `docs/article-readiness-v1.md` — semantic readiness ownership;
- `docs/article-operations.md` — validation/planning/control entrypoints;
- `docs/asset-publisher.md` — repository-owned body-resource publication contract;
- `docs/remote-resource-policy.md` — production trust policy for external HTTPS images;
- `docs/article-publication.md` — guarded Article-level mutation orchestration;
- `docs/live-draft-verification.md` — exact-candidate live draft verification without a second Ghost deployment;
- `docs/live-verification-policy.md` — personal-blog live evidence policy;
- `docs/workflow/` — durable state/authorization/Git/RTA policy.

## Core invariants

- Git source is canonical; Ghost is a projection target.
- `articleId` and `variantId` are stable identities. Paths and public slugs are not identity.
- Translation synchronization, Article semantic readiness, Git state, Ghost projection state, and RTA state are independent machines.
- Translation generation alone never produces `SYNCED`; an exact-current equivalence review checkpoint is required.
- Article `READY` is a reviewed semantic claim, not merge or production-publication authorization.
- Production publication authorization is task-scoped and explicit. It is never inferred from source metadata, Git state, RTA state, Ghost state, or a prior dry-run.
- A normal Git push/PR does not mutate Ghost.
- `PREPARE_PUBLISH` / planning is read-only with respect to Ghost and publication resource storage.
- A `draft` operation is a real draft-preparation mutation and may prepare repository-owned body assets or upload a local Ghost feature image.
- Production use of external HTTPS body/feature images requires explicit current host trust approval.
- Public projection/publication URLs must be credential-free HTTPS where HTTPS is required.
- Per-locale Ghost state is independently recoverable; partial multi-locale failure is never whole-Article success.
- A post created/updated but missing valid final revision/sync evidence is reconciliation-required, never silently forgotten.
- No unmanaged Ghost post is implicitly adopted because a slug happens to match.

## Local validation

Node.js 24 is canonical.

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

`npm run validate` runs both migration-era validators:

```text
validate:legacy
validate:articles
```

Target Article checks:

```bash
npm run validate:articles
npm run validate:articles -- --ready
npm run validate:articles -- posts/example/article.json
npm run validate:articles -- --ready posts/example/article.json
```

Ordinary validation permits valid work-in-progress states such as `DRAFT`, `UNREVIEWED`, and `INCOMPLETE`. `--ready` requires `SYNCED + READY`; it still does not authorize merge or publication.

## Host runtime

Target scripts may receive deployment/compiler host dependencies from an operator-controlled repository module:

```text
OX0_HOST_RUNTIME_MODULE=host/runtime.mjs
```

The path must be an exact unaliased repository-relative `.mjs` path under `host/`; absolute paths, traversal/aliases, and symlink escapes fail closed. Article source cannot choose the module.

The module may export:

```js
export const assetPublisher = ...;
export const projectContext = ...;
export async function remoteResourcePolicy(resource) { ... }
```

- `assetPublisher` binds repository-owned body assets to stable credential-free HTTPS delivery.
- `projectContext` supplies compiler/VirtualProject host context.
- `remoteResourcePolicy` explicitly approves or denies external HTTPS body/feature images for production publication.

The core architecture does not select R2/S3/OCI/etc.; a host module may bind the vendor-neutral content-addressed AssetPublisher adapter to a concrete object store.

## Read-only Article planning

Ghost credentials are needed because planning reads ownership/collision/projection state:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
```

Plan every required locale:

```bash
npm run dry-run -- posts/example/article.json draft
npm run dry-run -- posts/example/article.json publish
```

Planning never creates/updates Ghost posts, uploads feature images, or publishes body assets.

`publish` planning additionally requires `SYNCED + READY`, current remote-resource policy approval where needed, and current Ghost observations. A plan is ephemeral evidence; source/Ghost/resource-policy changes require recomputation.

## Low-level Article synchronization

The guarded low-level CLI is:

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

It is an execution primitive, **not an authorization generator**.

### Draft preparation

Draft rejects a production authorization envelope. It may prepare body assets, upload a local feature image, and create/update managed Ghost drafts.

### Publish

Low-level production publish requires externally supplied strict JSON:

```text
OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON
```

The authorization binds explicit task intent to the exact Article and every required locale projection fingerprint. Missing, malformed, incomplete, wrong-Article, or stale authorization fails closed.

The library then re-plans/revalidates source, assets, remote-resource policy, and Ghost observations before mutation.

## Target manual GitHub Actions control surface

`.github/workflows/article-ghost.yml` is the target manual Article control surface. It is `workflow_dispatch` only; ordinary push/PR events do not invoke it.

The workflow accepts:

```text
manifest_path
source_sha
operation = plan-draft | draft | plan-publish | publish
publish_confirmation
```

It fails closed unless it runs from `refs/heads/main`, `source_sha` is the exact current dispatch `github.sha`, that SHA is checked out and reverified, and the manifest is an unaliased repository-relative `posts/.../article.json` path.

Before the selected operation it runs Node 24 locked install, `npm test`, combined repository validation, and selected-Article validation. All target Article Ghost operations are globally serialized under one concurrency group.

### Draft-first path

The intended manual production path is:

```text
plan-draft      # read-only
    |
    v
draft           # explicit Ghost draft-preparation mutation
    |
    v
plan-publish    # read-only exact-current draft gate
    |
    v
publish         # explicit exact-target production promotion
```

Here `draft` is preparation on the configured Ghost instance. It does **not** imply or require a second Ghost deployment.

A stale earlier plan is never replayed; each operation creates fresh current evidence.

`publish` additionally requires exact confirmation:

```text
publish:<manifest_path>@<source_sha>
```

This confirmation binds the control-surface intent to one Article source version. It does not bypass readiness, trust, ownership, drift, or authorization checks.

### Production publish is promotion-only

For every required locale, `plan-publish` and `publish` require:

- an existing uniquely managed Ghost post;
- current status `draft`;
- projected source fingerprint equal to the exact current source fingerprint;
- valid bound managed revision/sync evidence;
- planned Ghost operation exactly `status-update` to `published`;
- every local body-asset plan exactly `reuse`.

Therefore target production `publish` rejects first-create, content update, already-published noop, stale/unmanaged/ambiguous draft state, and a body asset that still needs publication.

The dispatch adapter checks this on a fresh publish plan. The core publication library reruns the same guard on its own initial plan and on the refreshed plan immediately before Ghost mutation.

Under the target manual path, final production publication cannot create/rewrite Article content, upload a new feature image, or newly publish repository-owned body assets.

## Live draft verification

A personal blog does not require a second Ghost deployment merely to prove draft synchronization. Exact-candidate live evidence can use the configured real Ghost instance with a temporary **draft-only** Article:

```bash
npm run verify:article-live-draft
```

Required operator inputs are documented in `docs/live-draft-verification.md`.

The verifier creates a unique bilingual Article, reaches `SYNCED + READY`, creates only managed Ghost drafts, verifies both locales as `DRAFT_CURRENT`, and then performs bounded cleanup.

Cleanup deletes posts only after exact ID/title/slug/stable-identity ownership proof. Publisher tags are deletion-eligible only when the verifier proved that exact tag name was absent before the verifier mutation that could create it, the current tag ID/name still match, and the tag is unreferenced. The verifier then fresh-checks namespace absence.

It never constructs production publication authorization and never requests `published` status. A PASS proves draft mutation/recovery/cleanup semantics only; it is not production-publication evidence.

## Compiler/resource boundary

Canonical compilation is asynchronous:

```text
DocumentCompiler.compile(LocaleVariant, ProjectContext)
  -> CompiledDocument
```

`MarkedCompiler` is the current implementation. Arkst is the intended long-term backend after its HTML/resource and semantic-parity gates are ready.

Compiler code does not own storage/CDN policy. Local body assets are source evidence; the host AssetPublisher plans delivery and the compiler sees only a host `resolveResource` callback. Resolved ProjectContext is preserved through evaluation, review, planning, resource-delivery recompilation, and publication.

Canonical Markdown rejects raw HTML and unsafe/ambiguous active URLs. `javascript:`, `data:`, `file:`, protocol-relative, control/entity-obfuscated, backslash-ambiguous, and credential-bearing HTTP(S) URLs fail closed at the relevant compiler/projection boundaries.

## Ghost projection identity and recovery

Stable target locale projections use publisher-owned hidden metadata conceptually as:

```text
#ox0-article-...
#ox0-locale-...
#ox0-source-...
#ox0-revision-...
#ox0-sync:...
```

Fresh recovery derives per-locale states such as `NOT_PROJECTED`, `DRAFT_CURRENT`, `PUBLISHED_CURRENT`, `OUTDATED(...)`, and `RECONCILIATION_REQUIRED(...)`.

`revision` identifies the exact projection source; `sync` protects managed Ghost state from unmanaged drift. Ghost ownership reads explicitly request related tag data rather than relying on API default inclusion.

If create/update succeeds but final publisher stamping fails, fresh recovery keeps that post visible as reconciliation-required rather than collapsing it to `NOT_PROJECTED`.

## Feature images

Local feature images use Ghost's Image API, separately from body AssetPublisher delivery.

Exact repository bytes are verified before upload. Because image upload and post mutation are not transactional, a successful or possibly-successful upload can remain as an orphan side effect if a later step fails.

Returned image URLs must be bounded absolute credential-free HTTPS URLs before they are used in a post. Error evidence is sanitized. Target Article errors preserve bounded feature-image side-effect evidence plus fresh projection recovery. This is observability, not rollback.

## Ghost setup

Configure:

- `GHOST_ADMIN_URL` — e.g. `https://blog.ox0.uk`; HTTPS only, no URL credentials/query/fragment;
- `GHOST_ADMIN_API_KEY` — Ghost Custom Integration Admin API key (`id:hexsecret`);
- optional `OX0_HOST_RUNTIME_MODULE` — target host resource/compiler policy module.

Never commit or paste the Admin API key into source, logs, issues, or pull requests.

## Legacy compatibility

The following are **not** the target Article architecture: one Markdown file = one Ghost post, path-derived identity, frontmatter publication `status`, one-file `:::lang`, and body-image data URIs.

Legacy commands remain explicit:

```bash
npm run validate:legacy
npm run dry-run:legacy -- posts/example.md
npm run verify:ghost-live:legacy
```

`.github/workflows/ghost-publish.yml` remains legacy compatibility only.

## Verification status

Tests and workflows existing in the tree are not proof by themselves. Merge review, when explicitly started, is exact-HEAD proof work.

This branch has repeatedly seen `Validate blog source` jobs terminate before runner allocation (`steps=[]`, `runner_id=0`), so canonical Node 24 hosted-CI execution remains unverified until an exact candidate actually executes checkout/test/validation steps.

Exact-candidate live Ghost evidence may use the draft-only verifier on the real blog. Production publication remains a separate explicit operation and proof obligation.
