# Authoring contract

## Source of truth

`posts/**/*.md` is canonical. Ghost is a publishing target, not an editing source. New posts start as `draft`.

## Bilingual body

A post may be monolingual, but a bilingual post must contain exactly one Korean and one English section and no non-whitespace body content outside them:

```markdown
:::lang ko
한국어 본문
:::

:::lang en
English body
:::
```

The source order is the no-JavaScript fallback order. The renderer wraps each language in an element carrying both `lang` and `data-ox0-lang`, so a Ghost theme can later reorder the two blocks without removing either language from the document.

The browser preference contract is: explicit visitor choice stored locally, then `navigator.languages`, then source order. GeoIP is deliberately not part of the contract.

### Current boundary

The bilingual **body grammar and generated wrapper are locally verified**. The publisher writes rendered content directly as a Lexical HTML card rather than using Ghost's HTML-to-Lexical conversion path. Preservation of the wrapper and its `lang`/`data-ox0-*` attributes across a live Ghost create/update/fetch round trip is **UNVERIFIED** until that integration test passes. Theme-side automatic ordering must not be enabled before that proof exists.

Ghost `title` and `custom_excerpt` remain single canonical metadata fields in v1. Bilingual title/card metadata is intentionally deferred rather than encoded into tags or other hidden state.

## Body images

Local body images are Git-owned assets and are embedded into the rendered HTML card as `data:` URIs. This keeps the body self-contained and avoids mutable Ghost media mappings for ordinary article images.

Use Markdown image syntax and a path that resolves from the post file into `assets/`:

```markdown
![Architecture](../assets/example/architecture.png)
```

Rules:

- local body images must resolve inside repository `assets/`;
- absolute paths, path escape, symlinks, and unsupported image extensions fail validation;
- PNG, JPEG, GIF, WebP, and SVG are supported;
- an individual local body image is limited to 5 MiB;
- total embedded source image bytes per render are limited to 15 MiB across the complete post, including both language sections;
- external body images are allowed only as valid HTTPS URLs and remain external;
- authored `http:`, `data:`, `file:`, and protocol-relative image URLs are rejected;
- authored raw HTML is rejected entirely. This avoids alternate asset-loading paths such as style URLs, SVG/image elements, video posters, or arbitrary embeds bypassing the Markdown asset validator.

`npm run validate` runs the same asset-aware renderer used by dry-run/publish, so missing or invalid body assets fail before Ghost access.

This policy applies to **body images only**. Frontmatter `feature_image` remains a Ghost Image API concern because Ghost uses it for cards, social metadata, and other publication-level presentation. Local feature images are therefore still uploaded to Ghost during a mutating synchronization.

## Repository validation

`npm run validate` checks every post, including:

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

`npm run verify:ghost-live` is mutating and requires `OX0_GHOST_LIVE_VERIFY=1` plus authorized Ghost Admin credentials. In PR2 it runs two controlled verifiers in sequence:

1. the inherited publisher/bilingual verifier;
2. a body-image verifier that renders a repository-owned SVG to a `data:image/...` URL, writes it as a direct Lexical HTML card to a temporary draft page, rereads the page by ID, requires exact Lexical preservation, and performs ID-bound cleanup with persisted-absence verification.

The existence of these scripts is not evidence by itself. A PASS is exact-commit-scoped and must be rerun whenever the candidate HEAD changes.

## Publication boundary

The manual workflow defaults to `dry-run`. `draft` and `publish` are explicit mutating actions, and `publish` still requires the source frontmatter to say `status: published`.
