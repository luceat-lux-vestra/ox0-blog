# Target Article operations

This document describes the target Article-oriented read/validation operations currently available on `feat/authoring-foundation`.

It does not replace the durable authorization/state-machine policy in `docs/workflow/`. In particular, a successful validation or dry-run never grants merge or production publication authorization.

## Validate Article source

```bash
npm run validate:articles
```

This scans repository `posts/` for exact-lowercase `article.json` manifests, loads each manifest and locale source, compiles each present LocaleVariant, derives material local-asset and semantic publication evidence, computes current translation fingerprints, and recovers translation/readiness state.

Normal source validation allows valid work-in-progress states such as:

- Article `DRAFT`;
- translation `UNREVIEWED`;
- translation `INCOMPLETE` while an Article is still being authored.

The command is therefore a structural/source-integrity gate, not a publication-readiness assertion.

Repository-wide checks include at least:

- strict manifest/source/path validation;
- compiler/raw-HTML/resource validation;
- local material-asset confinement and hashing;
- semantic local feature-image confinement and hashing;
- unique stable `articleId` values;
- unique stable `variantId` values;
- unique public Ghost slugs;
- deterministic checkpoint/readiness recovery.

Titles are presentation content, not repository identity. Target Article validation deliberately does not inherit the legacy validator's repository-wide title-uniqueness rule.

The legacy compatibility command remains separate:

```bash
npm run validate
```

CI currently runs both commands while the migration is active.

## Require reviewed readiness

```bash
npm run validate:articles -- --ready
```

`--ready` additionally requires every discovered Article to recover as:

```text
translation = SYNCED
readiness   = READY
```

This is a stronger evidence check. It still does **not** mean:

- merge is authorized;
- a PR is a merge candidate;
- production publication is authorized;
- Ghost should be mutated.

Those decisions remain separate workflow transitions.

## Validate selected manifests

Repository-wide invariants are always checked first. The command may then return a selected subset:

```bash
npm run validate:articles -- posts/example/article.json
npm run validate:articles -- --ready posts/example/article.json
```

Selecting one manifest does not bypass collisions or invalid source elsewhere in the Article corpus.

## Read-only Article publication planning

```bash
npm run dry-run:article -- posts/example/article.json draft
npm run dry-run:article -- posts/example/article.json publish
```

The action is mandatory and explicit. It is never inferred from source metadata or Ghost state.

The command requires:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
```

because planning reads Ghost ownership/slug/current-state information. Planning must remain GET-only with respect to Ghost: no post mutation, metadata stamping, or image upload occurs.

The CLI plans the logical Article as one work unit. It first loads/evaluates every present required LocaleVariant and preflights every required locale projection. Only after all source-side preconditions pass does it begin Ghost reads. The returned plan contains one projection plan per required locale.

This means a sibling locale that cannot currently be represented by the target host policy—for example because it has a local body asset while no target `AssetPublisher` exists—causes the entire Article planning operation to fail before the first Ghost request. `PREPARE_PUBLISH` must not silently produce a half-plan.

A `publish` plan additionally requires the Article to recover as `SYNCED + READY` before any Ghost access. This verifies that the exact source is eligible to be considered for production publication under the current content contract; it is not publication authorization itself.

A `draft` plan may operate on valid work-in-progress Article state because a draft projection is not production publication. Source/compiler/resource validation still applies.

The lower-level `planArticleProjection(...)` API remains available for a single LocaleVariant, but it is a projection primitive rather than the normal Article-level `PREPARE_PUBLISH` workflow.

## Current local body-asset boundary

Target Article planning currently fails closed when any required LocaleVariant references local body assets.

That is intentional. The legacy compatibility renderer embeds local body images as data URIs, but target Article architecture must not silently inherit that delivery mechanism.

Until a host-owned target `AssetPublisher` / stable resource delivery contract is implemented, aggregate Article planning reports that local body assets require an AssetPublisher and stops **before Ghost access**.

This does not prevent:

- text-only Articles;
- Articles using validated remote HTTPS body images;
- local `featureImage`, which is a separate projection concern handled through the existing Ghost Image API planning/snapshot path.

## Fresh-session semantic evaluation

The target evaluator reconstructs current semantic evidence rather than trusting stored state:

```text
ArticleBundle
  + locale Markdown
  + compiler observations
  + current local body-asset bytes
  + locale semantic publication evidence
        |
        v
current translation fingerprints
        |
        +--> translation state
        +--> Article semantic-source fingerprint
                     |
                     +--> readiness state
```

Locale semantic publication evidence currently includes the source-owned feature-image reference, local feature-image content digest when applicable, and localized feature-image alt text. It deliberately excludes Ghost IDs/status, deployment state, merge/publication authorization, and other non-semantic workflow state.

Therefore any of the following can invalidate the affected locale's reviewed translation fingerprint even if Markdown body text is unchanged:

- a material local body asset byte change;
- a local feature-image byte change;
- a feature-image source reference change;
- localized feature-image alt text change.

If an Article had previously been READY, a resulting Article semantic-source mismatch also produces `REVIEW_REQUIRED(SOURCE_CHANGED)`.

Remote HTTPS body resources and remote feature images are normalized as URLs, but their remote bytes are not fetched or persisted as local material evidence. The authored/canonical URL remains part of the relevant source evidence.

## Planning snapshot safety

A local feature image is hashed during Article semantic evaluation. The same digest is handed to the projection fingerprint. The publisher preflight snapshots the file again before Ghost access and requires the current bytes to match that digest. This binds publish planning to the feature-image bytes that passed translation/readiness evaluation instead of accepting a validate-then-re-read race.

## Mutation boundary

There is intentionally no target Article mutation CLI documented here yet.

The existing legacy publication commands remain compatibility code. A target mutating publication path must preserve the explicit production authorization boundary, re-run current source/projection guards, handle partial multi-locale failure/reconciliation explicitly, and must not be introduced by repurposing a read-only planning command.
