# Translation fingerprint v1

This document defines the source evidence hashed by `translationFingerprintV1(...)` for the target Article/LocaleVariant model.

The fingerprint answers one narrow question: **has translation-relevant observable source for this LocaleVariant changed since the last accepted equivalence review?**

It is not a Ghost projection revision, Git revision, merge authorization, publication authorization, compiler cache key, or generic file hash.

## Version

The contract version is `1` and is persisted in `translationCheckpoint.fingerprintVersion`.

Unsupported versions fail closed. A checkpoint created under another fingerprint contract must never be interpreted as current merely because its SHA-256 string is syntactically valid.

PR #2 is still an unmerged architecture-development branch and there is no canonical Article corpus using this checkpoint yet; the v1 field set below is the contract that must be used before real v1 checkpoints are introduced.

## Included semantic source

For one LocaleVariant, v1 hashes deterministic length-delimited fields for:

- locale-specific `title`;
- locale-specific `excerpt`;
- Markdown body source;
- semantic feature-image source reference when present;
- current local feature-image content SHA-256 when the feature image is repository-owned;
- localized `featureImageAlt` text;
- each material local body-asset reference and its current content SHA-256.

Material body assets are ordered deterministically by repository reference before hashing. Feature-image evidence is a separate named field rather than being mixed into the body-asset list.

## Markdown normalization

Only line endings are normalized:

```text
CRLF -> LF
CR   -> LF
```

Markdown-significant whitespace is otherwise preserved. In particular, trailing spaces that encode Markdown hard breaks must not be trimmed away before fingerprinting.

## Feature-image evidence

Feature images are source-owned publication metadata but can carry translation-relevant visible meaning.

For a local feature image, the evaluator records conceptually:

```text
featureImageRef         = assets/<...>
featureImageFingerprint = sha256:<current bytes>
featureImageAlt         = localized alt text
```

The local path is confined to repository `assets/`, symlinks/path escape are rejected, and the current bytes are snapshotted before their digest is accepted.

For a remote HTTPS feature image:

```text
featureImageRef         = canonical https URL
featureImageFingerprint = null
featureImageAlt         = localized alt text
```

Remote bytes are deliberately not downloaded and frozen into the translation checkpoint. Changing the authored remote URL still changes the fingerprint because the source reference changes.

When no feature image exists, the feature-image ref/content fields are empty. `featureImageAlt` is still encoded deterministically from source metadata.

## Local body-asset evidence

The compiler reports resource observations, but the compiler does not own storage/delivery policy.

The Blog host resolves each authored local image reference relative to the LocaleVariant source path, confines it to repository `assets/`, rejects symlinks/path escape/unsupported image extensions, reads the current bytes, and records:

```text
ref    = repository-relative assets/...
sha256 = lowercase 64-hex content digest
```

Duplicate refs and malformed digest evidence fail closed.

Legacy data-URI size limits are delivery-policy constraints and are not part of the target translation fingerprint contract.

## Remote body resources

Remote body images must be valid HTTPS URLs under the source/resource validation contract.

Their remote bytes are not fetched into translation evidence. The authored URL remains in Markdown body source and is therefore already covered by the body fingerprint.

## Deliberately excluded

Translation fingerprint v1 excludes values that are not translation-equivalence evidence, including:

- `articleId` and `variantId`;
- Article directory/source path;
- public Ghost slug as an identity mechanism;
- Ghost post ID/status/`updated_at`;
- publisher ownership/revision/sync tags;
- Git branch, commit, PR, CI state;
- RTA lifecycle state;
- merge authorization;
- production publication authorization;
- chat/session/model IDs;
- compiled HTML serialization;
- Marked tokens or Arkst IR;
- `featured`, `visibility`, `canonicalUrl`, and public taxonomy tags unless a future fingerprint contract explicitly promotes one of them into translation semantics.

`slug` is already excluded from the fingerprint even though it is locale-specific projection metadata. Changing a slug therefore does not by itself claim that translated article meaning changed.

## Relationship to Article readiness

The current Article semantic-source fingerprint is derived from the exact current translation fingerprints for all required locales.

Consequently, if a previously reviewed local feature-image byte or localized alt changes:

```text
LocaleVariant translation fingerprint changes
        -> translation becomes STALE/REVIEW_REQUIRED
        -> Article semantic-source fingerprint changes
        -> prior READY checkpoint recovers as REVIEW_REQUIRED(SOURCE_CHANGED)
```

Translation review and Article readiness review remain separate logical operations. Updating source or regenerating a translation never advances either checkpoint automatically.

## Relationship to projection revision

Projection revision is a different versioned contract. It hashes the compiled observable projection plus projection metadata/evidence needed to decide whether Ghost is current.

A translation fingerprint and a projection fingerprint may depend on some of the same source, but one must never be substituted as proof for the other invariant.
