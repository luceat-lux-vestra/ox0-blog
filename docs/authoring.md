# Authoring contract

> **Transitional implementation note**
>
> This document describes legacy-compatible authoring mechanics that still exist on the authoring branch. It is not the long-term content-model authority. The target source-storage contract is now `docs/article-manifest-v1.md`, backed by the Article/LocaleVariant/TranslationCheckpoint/readiness model in issues #3/#7 and the compiler boundary in #4. Before extending bilingual, asset, Git, RTA, or publication behavior, read `AGENTS.md`, `docs/workflow/`, and the manifest v1 contract.

## Source of truth

Ghost is a publishing target, not an editing source.

The target v1 source shape is now one Article directory with `article.json` plus separate locale Markdown files. Stable `articleId` / `variantId` values, not repository paths or Ghost slugs, define logical identity. See `docs/article-manifest-v1.md`.

The older single-file `posts/**/*.md` path/frontmatter flow remains only as compatibility implementation while CLI/validation entrypoints are migrated to the Article bundle. Do not treat its path-derived identity, source `status`, bilingual wrapper, or body-image delivery behavior as permanent policy.

## Current bilingual body implementation

The current compatibility implementation allows a monolingual post, or a bilingual post containing exactly one Korean and one English section and no non-whitespace body content outside them:

```markdown
:::lang ko
한국어 본문
:::

:::lang en
English body
:::
```

This `:::lang` grammar is transitional. New long-term design and source creation must use the Article + separate LocaleVariant model in #3 / `docs/article-manifest-v1.md` rather than further entrenching one-file bilingual storage.

The source order is the no-JavaScript fallback order. The renderer wraps each language in an element carrying both `lang` and `data-ox0-lang`, so a Ghost theme can later reorder the two blocks without removing either language from the document.

The browser preference contract is: explicit visitor choice stored locally, then `navigator.languages`, then source order. GeoIP is deliberately not part of the contract.

### Current boundary

The bilingual **body grammar and generated wrapper are locally verified** for the compatibility path. The publisher writes rendered content directly as a Lexical HTML card rather than using Ghost's HTML-to-Lexical conversion path. Preservation of the wrapper and its `lang`/`data-ox0-*` attributes across a live Ghost create/update/fetch round trip is **UNVERIFIED** until that integration test passes. Theme-side automatic ordering must not be enabled before that proof exists.

Ghost `title` and `custom_excerpt` are a single metadata set only in this compatibility path. Target Article v1 has separate locale-specific metadata and separate per-locale Ghost projections.

## Current body-image implementation

Local body images in the legacy compatibility renderer are currently Git-owned assets embedded into the rendered HTML card as `data:` URIs.

This is transitional. `docs/article-manifest-v1.md`, `docs/workflow/`, and #4 deliberately keep body-resource publication outside the compiler/source-storage contract so a future content-addressed HTTPS asset strategy or Arkst resource contract can replace data-URI embedding without changing Article identity or manifest semantics.

Use Markdown image syntax and a path that resolves from the post file into `assets/`:

```markdown
![Architecture](../assets/example/architecture.png)
```

Current compatibility rules:

- local body images must resolve inside repository `assets/`;
- absolute paths, path escape, symlinks, and unsupported image extensions fail validation;
- PNG, JPEG, GIF, WebP, and SVG are supported;
- an individual local body image is limited to 5 MiB;
- total embedded source image bytes per render are limited to 15 MiB across the complete post, including both language sections;
- external body images are allowed only as valid HTTPS URLs and remain external;
- authored `http:`, `data:`, `file:`, and protocol-relative image URLs are rejected;
- authored raw HTML is rejected entirely so alternate asset-loading/embed paths cannot bypass validation.

The legacy `npm run validate` path runs the same asset-aware renderer used by legacy dry-run/publish, so missing or invalid body assets fail before Ghost access.

This policy applies to **body images only**. `featureImage` remains a source-owned publication field handled separately by the Article manifest adapter and Ghost Image API path. A local v1 feature image is stored as a repository-relative `assets/...` reference, then confined/resolved/snapshotted by host code.

## Repository validation

The current compatibility `npm run validate` checks every legacy post, including:

- frontmatter and path confinement;
- local feature-image existence and symlink rejection;
- body-image path confinement, symlink rejection, supported type, size limits, and HTTPS-only remote policy;
- raw-HTML rejection;
- bilingual grammar when language sections are used;
- repository-wide duplicate slug rejection;
- repository-wide case-insensitive duplicate title rejection after Unicode NFC normalization;
- non-empty excerpt for `published` legacy posts.

Validating one selected legacy path still validates repository-wide invariants before returning the selected post.

Target Article validation is being rebuilt around Article bundle loading, required LocaleVariants, translation fingerprints/checkpoint, Article readiness evidence, compiler diagnostics/resources, and per-locale projection metadata. The existence of the legacy validator must not be interpreted as completion of that migration.

## Dry-run

The current compatibility command `npm run dry-run -- posts/example.md` authenticates to Ghost and performs read-only inspection. It may issue GET requests, but must not upload images or create/update/stamp posts. The plan reports create/update intent, status transition, tags, rendered HTML size, source identity, and feature-image action.

Target Article planning uses the compiler-neutral per-locale projection entrypoint. `PREPARE_PUBLISH` remains read-only with respect to Ghost under the workflow contract.

## Live Ghost verification

`npm run verify:ghost-live` is mutating and requires `OX0_GHOST_LIVE_VERIFY=1` plus authorized Ghost Admin credentials. In the current PR it runs controlled verifier scenarios for publisher/bilingual behavior and body-image Lexical preservation/cleanup.

The existence of these scripts is not evidence by itself. A PASS is exact-commit-scoped and must be rerun whenever the candidate HEAD changes.

## Publication boundary

The legacy path still has frontmatter/source-status checks for compatibility. They are not target authorization policy.

For Article v1, `draft|publish` is an explicit operation. Production publication authorization is task-scoped under `docs/workflow/`; it is not stored in `article.json`, inferred from LocaleVariant metadata, recovered from Ghost status, or implied by merge state.

The durable agent/user responsibility and publication state-machine contract is in `docs/workflow/`; this compatibility implementation document must not override it.
