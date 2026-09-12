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

It does **not** store:

- Ghost post IDs/status as canonical source state;
- Git/PR lifecycle state;
- RTA lifecycle state;
- merge authorization;
- production publication authorization;
- raw chat/session/model identifiers;
- compiler IR or rendered HTML.

See:

- `docs/article-manifest-v1.md` — durable source representation;
- `docs/translation-fingerprint-v1.md` — translation-equivalence evidence;
- `docs/article-readiness-v1.md` — semantic readiness ownership;
- `docs/article-operations.md` — validation/planning/control entrypoints;
- `docs/asset-publisher.md` — body-resource publication contract;
- `docs/article-publication.md` — guarded Article-level mutation orchestration;
- `docs/workflow/` — durable state/authorization/Git/RTA policy.

## Core invariants

- Git source is canonical; Ghost is a projection target.
- `articleId` and `variantId` are stable identities. Paths and public slugs are not identity.
- Translation synchronization, Article semantic readiness, Git state, Ghost projection state, and RTA state are independent machines.
- Translation generation alone never produces `SYNCED`; an exact-current equivalence review checkpoint is required.
- Article `READY` is a reviewed semantic claim, not production publication authorization.
- Projection metadata changes are covered by projection fingerprints and current publication planning even when semantic `READY` remains valid.
- Production publication authorization is task-scoped and explicit. It is never inferred from source metadata, Git state, RTA state, or Ghost state.
- A normal Git push does not mutate Ghost.
- Target `PREPARE_PUBLISH` is Article-wide and read-only with respect to Ghost.
- Per-locale Ghost projection state remains independently recoverable; partial multi-locale failure is never collapsed into aggregate success.
- No unmanaged Ghost post is implicitly adopted because a public slug happens to match.

## Article manifest example

```json
{
  "version": 1,
  "articleId": "article-1",
  "requiredLocales": ["ko-KR", "en"],
  "variants": [
    {
      "variantId": "variant-ko-1",
      "locale": "ko-KR",
      "source": "ko-KR.md",
      "title": "제목",
      "excerpt": "요약",
      "slug": "example-ko",
      "publication": {
        "tags": ["Architecture"],
        "featureImage": "assets/example/cover.png",
        "featureImageAlt": "표지 설명",
        "featured": false,
        "visibility": "public",
        "canonicalUrl": null
      }
    },
    {
      "variantId": "variant-en-1",
      "locale": "en",
      "source": "en.md",
      "title": "Title",
      "excerpt": "Summary",
      "slug": "example-en",
      "publication": {
        "tags": ["Architecture"],
        "featureImage": "assets/example/cover.png",
        "featureImageAlt": "Cover description",
        "featured": false,
        "visibility": "public",
        "canonicalUrl": null
      }
    }
  ],
  "translationCheckpoint": null,
  "readiness": {
    "epoch": 0,
    "checkpoint": null,
    "invalidations": []
  }
}
```

Markdown bodies live in the locale files. Markdown-significant body whitespace is preserved.

## Local validation

Node.js 24 is the canonical runtime.

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

`npm run validate` currently runs both migration-era validators:

```text
validate:legacy
validate:articles
```

Run the target Article validator directly:

```bash
npm run validate:articles
npm run validate:articles -- --ready
npm run validate:articles -- posts/example/article.json
```

Ordinary source validation allows valid work-in-progress states such as `DRAFT`, `UNREVIEWED`, and `INCOMPLETE`. `--ready` additionally requires Article `SYNCED + READY`; it still does not authorize merge or publication.

## Host runtime dependencies

Target scripts may receive deployment/compiler host dependencies from an operator-controlled repository module:

```text
OX0_HOST_RUNTIME_MODULE=host/runtime.mjs
```

The path must remain under repository `host/`; absolute/traversal/symlink escapes are rejected. Article source cannot choose this module.

The module may export:

```js
export const assetPublisher = ...;
export const projectContext = ...;
```

A host module may bind the repository's vendor-neutral content-addressed AssetPublisher policy to R2/S3/OCI/etc. without putting cloud-specific storage logic into the compiler or Article manifest.

## Read-only Article publication planning

Ghost credentials are required because planning reads current ownership/collision/projection state:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
```

Plan every required locale of an Article:

```bash
npm run dry-run -- posts/example/article.json draft
npm run dry-run -- posts/example/article.json publish
```

`publish` planning requires current `SYNCED + READY` Article state. The result remains read-only: it does not create/update Ghost posts, stamp metadata, upload feature images, or publish body assets.

If local body assets exist, the optional host runtime must provide an AssetPublisher. Without one, planning fails before Ghost access rather than falling back to legacy data URIs.

## Target Article synchronization control surface

The guarded target mutation library is exposed through a low-level CLI:

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

This command is an execution surface, **not** an authorization generator.

### Draft

Draft synchronization does not require production-publication authorization and rejects a production authorization envelope if one is supplied.

### Production publish

Production publish requires the external conversation/control layer to inject:

```text
OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON
```

The authorization must be the task-scoped exact-source assertion for the requested Article and every required locale projection fingerprint. The CLI parses it with the strict JSON parser and does not derive it from Article `READY` state, Ghost state, or a dry-run plan by itself.

Missing, malformed, incomplete, wrong-Article, or stale-fingerprint authorization fails closed.

The intended agent workflow is therefore:

```text
explicit user publication instruction
        -> control layer prepares exact current Article plan
        -> control layer binds that intent to exact source fingerprints
        -> sync:article consumes the bound authorization
        -> publication library revalidates source/assets/Ghost before mutation
```

Do not invoke the production `publish` action merely because an Article is `READY`.

The target CLI and dry-run use the same optional `OX0_HOST_RUNTIME_MODULE`, so compiler ProjectContext and AssetPublisher policy do not silently differ between planning and execution.

No target production GitHub Actions workflow is enabled yet. The remaining workflow in `.github/workflows/ghost-publish.yml` is explicitly legacy compatibility only.

## Guarded mutation behavior

Target Article mutation preserves these boundaries:

- exact Article + required-locale source-fingerprint authorization for production publish;
- Article-wide preflight;
- body-asset publication/reuse before Ghost mutation;
- full source/plan revalidation after asset side effects;
- stale Ghost observation rejection;
- sequential per-locale mutation with fresh mixed-state recovery on failure;
- final all-locale currentness verification.

The library does not manufacture production authorization from `READY` state or from a publication plan.

## Compiler/resource boundary

Canonical document compilation is asynchronous:

```text
DocumentCompiler.compile(LocaleVariant, ProjectContext)
  -> CompiledDocument
```

`MarkedCompiler` is the current implementation. Arkst is the intended long-term backend after its HTML/backend parity gates are ready.

Compiler code does not own storage/CDN policy. Local body assets are source evidence; the host AssetPublisher plans stable HTTPS delivery and the compiler sees only a host `resolveResource` callback.

Resolved ProjectContext is preserved through validation, review, planning, AssetPublisher recompilation, and publication so a future Arkst/VirtualProject backend does not lose host context.

## Ghost projection identity

Stable target locale projections use publisher-owned hidden metadata conceptually as:

```text
#ox0-article-...
#ox0-locale-...
#ox0-source-...
#ox0-revision-...
#ox0-sync:...
```

`revision` identifies the exact projection source; `sync` protects managed Ghost state from unmanaged drift.

Fresh recovery derives per-locale states such as:

```text
NOT_PROJECTED
DRAFT_CURRENT
PUBLISHED_CURRENT
OUTDATED(visibility=DRAFT|PUBLISHED)
RECONCILIATION_REQUIRED(reason)
```

## Feature images

Local feature images are separate from body AssetPublisher delivery and currently use Ghost's Image API.

The publisher verifies the local feature-image digest and uploads the exact validated snapshot bytes. Because Ghost media upload and post mutation are not transactional, an upload can succeed before a later post mutation fails.

Target Article errors preserve successful feature-image upload evidence (`method`, repository ref, returned URL) so orphan-media side effects are visible. This is observability, not an automatic rollback claim.

## Ghost setup

For target planning/synchronization and legacy compatibility, configure:

- `GHOST_ADMIN_URL` — e.g. `https://blog.ox0.uk`
- `GHOST_ADMIN_API_KEY` — Ghost Custom Integration Admin API key (`id:hexsecret`)

Never commit or paste the Admin API key into source, logs, issues, or pull requests.

## Legacy compatibility path

The following model is **not** the target Article architecture:

- one Markdown file = one Ghost post;
- repository path-derived `#ox0-source-*` identity;
- frontmatter `status: draft|published`;
- `:::lang ko/en` wrappers inside one Markdown body;
- local body images embedded as `data:` URIs.

It remains only to preserve/verify the earlier publishing stack while the Article migration is active.

Explicit legacy commands are:

```bash
npm run validate:legacy
npm run dry-run:legacy -- posts/example.md
npm run verify:ghost-live:legacy
```

The GitHub Actions workflow is deliberately named **Legacy Publish to Ghost (compatibility)**. It must not be treated as the target Article production control surface.

Legacy implementation details remain documented in `docs/authoring.md`.

## Verification status

The presence of tests or live-verification harnesses is not evidence by itself. Merge review, when explicitly started, is exact-HEAD proof work.

The current authoring branch has repeatedly seen GitHub Actions jobs terminate before runner assignment (`steps=[]`, `runner_id=0`), so canonical Node 24 CI remains unverified until an exact candidate actually executes the configured steps.

Controlled live Ghost evidence must likewise be collected on the exact eventual candidate; stale results from an earlier HEAD do not carry forward.
