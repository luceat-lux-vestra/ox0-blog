# Target Article operations

This document describes the target Article-oriented read/validation operations currently available on `feat/authoring-foundation`.

It does not replace the durable authorization/state-machine policy in `docs/workflow/`. In particular, a successful validation or dry-run never grants merge or production publication authorization.

## Validate Article source

```bash
npm run validate:articles
```

This scans repository `posts/` for exact-lowercase `article.json` manifests, loads each manifest and locale source, compiles each present LocaleVariant, derives material local-asset evidence, computes current translation fingerprints, and recovers translation/readiness state.

Normal source validation allows valid work-in-progress states such as:

- Article `DRAFT`;
- translation `UNREVIEWED`;
- translation `INCOMPLETE` while an Article is still being authored.

The command is therefore a structural/source-integrity gate, not a publication-readiness assertion.

Repository-wide checks include at least:

- strict manifest/source/path validation;
- compiler/raw-HTML/resource validation;
- local material-asset confinement and hashing;
- unique stable `articleId` values;
- unique stable `variantId` values;
- unique public slugs;
- case-insensitive NFC-normalized title uniqueness;
- deterministic checkpoint/readiness recovery.

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

## Read-only Ghost planning

```bash
npm run dry-run:article -- posts/example/article.json ko-KR draft
npm run dry-run:article -- posts/example/article.json ko-KR publish
```

The action is mandatory and explicit. It is never inferred from source metadata or Ghost state.

The command requires:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
```

because planning reads Ghost ownership/slug/current-state information. Planning must remain GET-only with respect to Ghost: no post mutation, metadata stamping, or image upload occurs.

A `publish` plan additionally requires the Article to recover as `SYNCED + READY` before any Ghost access. This verifies that the source is eligible to be considered for production publication under the current content contract; it is not publication authorization itself.

A `draft` plan may operate on valid work-in-progress Article state because a draft projection is not production publication. Source/compiler/resource validation still applies.

## Current local body-asset boundary

Target Article planning currently fails closed when the selected LocaleVariant references local body assets.

That is intentional. The legacy compatibility renderer embeds local body images as data URIs, but target Article architecture must not silently inherit that delivery mechanism.

Until a host-owned target `AssetPublisher` / stable resource delivery contract is implemented, the target planner reports that local body assets require an AssetPublisher and stops **before Ghost access**.

This does not prevent:

- text-only Articles;
- Articles using validated remote HTTPS body images;
- local `featureImage`, which is a separate projection concern handled through the existing Ghost Image API planning/snapshot path.

## Fresh-session evaluation

The target evaluator reconstructs current semantic evidence rather than trusting stored state:

```text
ArticleBundle
  + locale Markdown
  + compiler observations
  + current local asset bytes
        |
        v
current translation fingerprints
        |
        +--> translation state
        +--> Article semantic-source fingerprint
                     |
                     +--> readiness state
```

A local material asset byte change therefore invalidates the affected translation fingerprint even when the Markdown text itself did not change. If an Article had previously been READY, the resulting Article semantic-source mismatch also produces `REVIEW_REQUIRED(SOURCE_CHANGED)`.

Remote HTTPS body resources are validated and normalized as URLs but their remote bytes are not fetched or persisted as local material evidence. The authored URL remains part of Markdown source and therefore remains covered by the source fingerprint.

## Mutation boundary

There is intentionally no target Article mutation CLI documented here yet.

The existing legacy publication commands remain compatibility code. A target mutating publication path must preserve the explicit production authorization boundary, re-run current source/projection guards, and must not be introduced by repurposing a read-only planning command.
