# Authoring contract

> **Transitional implementation note**
>
> This document describes the authoring mechanics currently implemented on the authoring branch. It is not the long-term content-model authority. Before extending bilingual, asset, Git, RTA, or publication behavior, read `AGENTS.md` and `docs/workflow/`. Target Article/LocaleVariant, compiler, and integration architecture is tracked by issues #3, #4, #5, #6, and #8.

## Source of truth

`posts/**/*.md` is the current canonical source shape. Ghost is a publishing target, not an editing source. New posts start as `draft`.

The target architecture may migrate this into an Article bundle with stable Article/LocaleVariant identity; path layout must not be treated as permanent identity policy.

## Current bilingual body implementation

The current implementation allows a monolingual post, or a bilingual post containing exactly one Korean and one English section and no non-whitespace body content outside them:

```markdown
:::lang ko
한국어 본문
:::

:::lang en
English body
:::
```

This `:::lang` grammar is transitional. New long-term design work must use the Article + separate LocaleVariant model in #3 rather than further entrenching one-file bilingual storage.

The source order is the no-JavaScript fallback order. The renderer wraps each language in an element carrying both `lang` and `data-ox0-lang`, so a Ghost theme can later reorder the two blocks without removing either language from the document.

The browser preference contract is: explicit visitor choice stored locally, then `navigator.languages`, then source order. GeoIP is deliberately not part of the contract.

### Current boundary

The bilingual **body grammar and generated wrapper are locally verified**. The publisher writes rendered content directly as a Lexical HTML card rather than using Ghost's HTML-to-Lexical conversion path. Preservation of the wrapper and its `lang`/`data-ox0-*` attributes across a live Ghost create/update/fetch round trip is **UNVERIFIED** until that integration test passes. Theme-side automatic ordering must not be enabled before that proof exists.

Ghost `title` and `custom_excerpt` remain single canonical metadata fields in the current implementation. Separate locale-specific metadata belongs to the target LocaleVariant design rather than hidden tags.

## Current body-image implementation

Local body images are currently Git-owned assets embedded into the rendered HTML card as `data:` URIs.

This is also transitional. `docs/workflow/` and #4 deliberately keep asset publication outside the compiler contract so a future content-addressed HTTPS asset strategy or Arkst resource contract can replace data-URI embedding without changing Article identity.

Use Markdown image syntax and a path that resolves from the post file into `assets/`:

```markdown
![Architecture](../assets/example/architecture.png)
```

Current rules:

- local body images must resolve inside repository `assets/`;
- absolute paths, path escape, symlinks, and unsupported image extensions fail validation;
- PNG, JPEG, GIF, WebP, and SVG are supported;
- an individual local body image is limited to 5 MiB;
- total embedded source image bytes per render are limited to 15 MiB across the complete post, including both language sections;
- external body images are allowed only as valid HTTPS URLs and remain external;
- authored `http:`, `data:`, `file:`, and protocol-relative image URLs are rejected;
- authored raw HTML is rejected entirely so alternate asset-loading/embed paths cannot bypass validation.

`npm run validate` runs the same asset-aware renderer used by dry-run/publish, so missing or invalid body assets fail before Ghost access.

This policy applies to **body images only**. Frontmatter `feature_image` remains a Ghost Image API concern in the current publisher because Ghost uses it for cards, social metadata, and other publication-level presentation.

## Repository validation

`npm run validate` currently checks every post, including:

- frontmatter and path confinement;
- local feature-image existence and symlink rejection;
- body-image path confinement, symlink rejection, supported type, size limits, and HTTPS-only remote policy;
- raw-HTML rejection;
- bilingual grammar when language sections are used;
- repository-wide duplicate slug rejection;
- repository-wide case-insensitive duplicate title rejection after Unicode NFC normalization;
- non-empty excerpt for `published` posts.

Validating one selected path still validates repository-wide invariants before returning the selected post.

## Dry-run

`npm run dry-run -- posts/example.md` authenticates to Ghost and performs read-only inspection. It may issue GET requests, but must not upload images or create/update/stamp posts. The plan reports create/update intent, status transition, tags, rendered HTML size, source identity, and feature-image action. Body images are rendered as inline data URIs during this planning step, but that only reads repository files and does not mutate Ghost.

## Live Ghost verification

`npm run verify:ghost-live` is mutating and requires `OX0_GHOST_LIVE_VERIFY=1` plus authorized Ghost Admin credentials. In the current PR it runs controlled verifier scenarios for publisher/bilingual behavior and body-image Lexical preservation/cleanup.

The existence of these scripts is not evidence by itself. A PASS is exact-commit-scoped and must be rerun whenever the candidate HEAD changes.

## Publication boundary

The manual workflow defaults to `dry-run`. `draft` and `publish` are explicit mutating actions, and `publish` still requires the source frontmatter to say `status: published`.

The durable agent/user responsibility and publication state-machine contract is in `docs/workflow/`; this implementation document must not override it.
