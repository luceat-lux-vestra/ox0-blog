# Article manifest v1

This document defines the first durable on-disk representation for the target `Article + LocaleVariant` model.

It is a source-storage contract. It does **not** define Git/PR state, Ghost state, publication authorization, compiler asset-delivery policy, or RTA lifecycle state.

## Layout

One logical Article owns one directory under `posts/`:

```text
posts/<article>/
  article.json
  ko-KR.md
  en.md

assets/
  ...
```

The locale source filenames are not identities. `articleId` and each `variantId` are the stable identities; a source file may be renamed when the manifest mapping is updated coherently.

`article.json` is UTF-8 JSON using manifest contract version `1`. Locale Markdown files are also UTF-8.

## Minimal example

```json
{
  "version": 1,
  "articleId": "article-1",
  "requiredLocales": [
    "ko-KR",
    "en"
  ],
  "variants": [
    {
      "variantId": "variant-ko-1",
      "locale": "ko-KR",
      "source": "ko-KR.md",
      "title": "제목",
      "excerpt": "요약",
      "slug": "article-ko",
      "publication": {
        "tags": [],
        "featureImage": null,
        "featureImageAlt": null,
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
      "slug": "article-en",
      "publication": {
        "tags": [],
        "featureImage": null,
        "featureImageAlt": null,
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

All fields shown for a v1 object are explicit. Unknown fields fail closed rather than being silently ignored.

## Root fields

### `version`

Must be integer `1`. Unsupported future versions fail closed.

### `articleId`

Stable logical Article identity. It is independent of directory name, locale source path, public slug, Git branch, and Ghost ID.

### `requiredLocales`

Ordered, non-empty list of unique required locale identifiers. Order is canonical for manifest serialization and routine agent work, but translation/readiness fingerprints define their own versioned canonicalization and must not rely accidentally on JSON object ordering.

### `variants`

Contains the currently present LocaleVariants. A required locale may temporarily be absent; that is represented by the derived translation state `INCOMPLETE`, not by a fake empty variant.

### `translationCheckpoint`

`null` until a separate translation-equivalence review is accepted. When present, it stores the reviewed fingerprint checkpoint defined by #3.

### `readiness`

Durable evidence required to recover Article readiness under #7. It stores a monotonic epoch, optional reviewed checkpoint, and unresolved invalidation events. It does not store a `DRAFT`, `REVIEW_REQUIRED`, or `READY` enum.

## Variant fields

Each variant contains exactly:

```text
variantId
locale
source
title
excerpt
slug
publication
```

### `variantId`

Stable LocaleVariant identity independent of source path and Ghost slug.

### `locale`

Locale owned by the variant. It must appear in `requiredLocales`, and only one present variant may own a locale.

### `source`

Portable path relative to the Article directory.

Rules:

- lowercase `.md` extension only;
- `/` separators only;
- no absolute paths;
- no `..` traversal;
- no `./` aliases;
- no backslashes, drive/scheme colon, or NUL;
- two variants cannot claim the same source path;
- the resolved file must remain inside the Article directory;
- symlinks are rejected by the loader;
- file content must be valid UTF-8.

Markdown-significant body whitespace is preserved. Translation fingerprint v1 separately normalizes line endings under its versioned contract.

### `title`, `excerpt`, `slug`

Locale-specific source metadata. `slug` is public projection metadata, not identity.

### No `status`

`LocaleVariant.status` is not part of v1. In particular, `status: published` must never become publication authorization or a copy of Ghost state.

## Source-owned publication metadata

`publication` contains exactly:

```text
tags
featureImage
featureImageAlt
featured
visibility
canonicalUrl
```

These fields describe the desired public projection. They do **not** authorize a Ghost mutation.

`draft` vs `publish` remains an explicit operation at execution time, and production publish authorization remains task-scoped under the workflow contract.

### Local feature image

A source-owned local feature image is written as a repository-relative `assets/...` reference, for example:

```json
"featureImage": "assets/articles/example/cover.png"
```

The loader validates that the file resolves to a real regular file under repository `assets/` with no symlink/path escape, then converts it to an absolute runtime path for the projection layer.

The serializer performs the inverse conversion back to `assets/...`.

This is a source reference, not a Ghost media URL. The publisher still snapshots/hashes the exact file bytes and uploads through the Ghost Image API when a full projection synchronization requires it.

### Remote feature image and canonical URL

Remote URLs must be valid HTTPS URLs. They are normalized through WHATWG URL semantics at the runtime boundary; for example an authored uppercase `HTTPS://` scheme is canonicalized to `https://`.

## Translation checkpoint

When non-null, v1 has this shape:

```json
{
  "version": 1,
  "fingerprintVersion": 1,
  "accepted": {
    "ko-KR": "sha256:...",
    "en": "sha256:..."
  },
  "review": {
    "kind": "agent",
    "contractVersion": 1
  }
}
```

The accepted map must contain exactly the required locales under the checkpoint validator. `SYNCED` is derived from current fingerprints vs this checkpoint; it is never persisted as an independent mutable field.

Translation generation and translation acceptance remain separate operations even when the same agent performs both.

## Article readiness evidence

A readiness invalidation v1 is:

```json
{
  "version": 1,
  "id": "11111111-1111-4111-8111-111111111111",
  "epoch": 1,
  "reason": "EXTERNAL_EVIDENCE_CHANGED",
  "origin": "rta",
  "reference": "rta:owner/repository#22"
}
```

Supported reasons are currently:

- `EXTERNAL_EVIDENCE_CHANGED`
- `PROVENANCE_WEAKENED`
- `SEMANTIC_REVIEW_REQUESTED`

Supported origins are currently:

- `rta`
- `blog-audit`
- `user`
- `external`

Chat/session/model identifiers are not durable references.

A readiness checkpoint v1 records:

```json
{
  "version": 1,
  "sourceFingerprintVersion": 1,
  "sourceFingerprint": "sha256:...",
  "priorReviewedEpoch": 0,
  "reviewedEpoch": 2,
  "resolvedInvalidationIds": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ],
  "review": {
    "kind": "agent",
    "contractVersion": 1
  }
}
```

The checkpoint is fail-closed evidence, not a label:

```text
resolvedInvalidationIds.length
== reviewedEpoch - priorReviewedEpoch
```

Active invalidations must cover every unreviewed epoch contiguously before a review can resolve them. A review must explicitly cover the exact event-ID set it resolves.

Consequently, deleting an invalidation record cannot manufacture `READY`; the unmatched epoch remains unreviewed.

## What is deliberately not persisted

The manifest must not become a cache of other state machines. v1 does not persist:

- translation derived state (`UNREVIEWED`, `SYNCED`, `STALE`, ...);
- Article readiness enum (`DRAFT`, `REVIEW_REQUIRED`, `READY`);
- Ghost post ID/status/`updated_at` or recovered projection state;
- Git branch/PR state;
- merge authorization;
- production publication authorization;
- RTA lifecycle state;
- raw chat transcripts;
- chat/session/model identifiers;
- hidden reasoning or volatile confidence scores.

Those values are either derived from their authoritative evidence/system or are task-scoped authorization.

## Compiler/resource boundary

The manifest does not encode body-image delivery strategy.

A compiler receives one hydrated `LocaleVariant` plus host `ProjectContext`. Resource discovery/resolution remains behind the compiler/host boundary from #4. The manifest therefore does not commit the long-term architecture to data URIs, Ghost uploads, a CDN, or Arkst-specific resource serialization.

Material local assets that affect translation/projection meaning are represented in the relevant versioned fingerprint evidence at validation/compilation time rather than by storing compiler IR in the manifest.

## Parser rules

`article.json` is read by the repository strict JSON parser rather than plain last-write-wins `JSON.parse` semantics.

The parser rejects at least:

- duplicate object keys, including escaped aliases such as `"a"` and `"\u0061"`;
- trailing commas;
- trailing non-whitespace content;
- malformed numbers such as leading-zero aliases;
- numeric values that become non-finite.

Object construction treats `__proto__` as ordinary data and does not mutate object prototypes.

After parsing, v1 schema objects reject unsupported fields.

## Loader / serializer contract

`loadArticleManifest(...)` performs disk-to-runtime hydration:

```text
article.json + locale Markdown files
    -> normalized ArticleBundle
    -> source-owned publication metadata by locale
```

`serializeArticleManifest(...)` performs the inverse metadata/evidence projection:

```text
normalized ArticleBundle + publication metadata
    -> deterministic article.json text
```

The body remains in the locale Markdown files; it is not duplicated into JSON.

The serializer:

- orders present variants by `requiredLocales`;
- requires exactly one publication metadata entry per present variant;
- converts absolute runtime source paths back to Article-relative `.md` references;
- converts local runtime feature-image paths back to `assets/...` references;
- refuses Article directories outside repository `posts/`;
- never serializes derived state or authorization.

The manifest and body files should be updated as one logical Git work unit so checkpoints never intentionally point at a partially written source set.

## Relationship to Ghost

Ghost remains a projection. The manifest does not store Ghost ownership IDs.

Stable ownership/currentness is recovered from Article/variant-derived publisher tags and the separately versioned projection revision/sync evidence. A manifest edit alone never authorizes Ghost mutation.

## Relationship to Arkst

This representation is compiler-neutral. Arkst may later replace `MarkedCompiler`, but it receives the same hydrated LocaleVariant/host project context. The manifest does not expose Marked tokens or Arkst IR and does not assign translation-pair semantics to the compiler.
