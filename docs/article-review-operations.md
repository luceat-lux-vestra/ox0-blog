# Article review persistence operations

This document describes the target Blog operations that persist reviewed translation/readiness evidence into `article.json`.

These are agent-oriented persistence primitives. They do not replace semantic review, do not authorize Git merge, and do not authorize Ghost publication.

## Core rule

Generation, review, checkpoint persistence, merge, and publication are distinct operations.

In particular:

```text
translation generated
    != translation reviewed
    != translation checkpoint accepted
    != Article READY
    != merge authorized
    != production publish authorized
```

The same agent may perform multiple logical passes, but one pass must not silently stand in for another proof obligation.

## `acceptArticleTranslationReview(...)`

Purpose: persist a translation-equivalence checkpoint after a separate review PASS.

The operation:

1. loads the current `article.json` and locale Markdown source;
2. compiles every present LocaleVariant;
3. recomputes current body/material-asset/semantic-publication evidence;
4. computes exact current translation fingerprints;
5. requires review result `PASS` under the supported review-contract version;
6. requires `review.reviewedFingerprints` to equal those exact current fingerprints;
7. creates the versioned translation checkpoint;
8. serializes a new manifest text without mutating locale body source.

It does **not** automatically mark Article readiness `READY`.

After a successful first translation checkpoint a new Article may therefore recover as:

```text
translation = SYNCED
readiness   = DRAFT
```

## `requestArticleSemanticReview(...)`

Purpose: move a new reviewable Article from `DRAFT` into durable `REVIEW_REQUIRED` state without persisting a mutable readiness enum.

The operation records a `SEMANTIC_REVIEW_REQUESTED` readiness invalidation event and advances the Blog-local readiness epoch.

It is valid only from the Article `DRAFT` path defined by the readiness state machine. Routine source edits of an already reviewed Article do not need this event; source-fingerprint mismatch already derives `REVIEW_REQUIRED(SOURCE_CHANGED)`.

## `recordArticleReadinessInvalidation(...)`

Purpose: persist a durable signal that an already reviewed Article requires semantic re-review even when Blog source text did not change.

Typical uses include:

- RTA evidence materially weakens/reverses a published claim;
- provenance quality is downgraded;
- an explicit user/audit request requires renewed semantic review.

The operation appends a versioned invalidation with:

```text
stable event id
monotonic readiness epoch
reason
origin
optional stable reference
```

It intentionally does **not** compile or rewrite Article body source. A cross-system signal is not implementation authorization.

Example:

```text
translation = SYNCED
readiness   = READY
        |
        | RTA emits material ARTICLE_REVIEW_NEEDED signal
        v
translation = SYNCED
readiness   = REVIEW_REQUIRED(DURABLE_INVALIDATION)
```

The RTA issue lifecycle itself remains owned by `research-to-action` and is not copied into the Blog manifest.

## `acceptArticleSemanticReview(...)`

Purpose: persist a readiness checkpoint after semantic review PASS.

Acceptance requires:

- current translation state is `SYNCED`;
- current Article state is `REVIEW_REQUIRED`;
- review covers the exact current Article semantic-source fingerprint;
- if active readiness invalidations exist, review explicitly covers the exact active event-ID set;
- invalidation evidence covers every unreviewed readiness epoch contiguously.

The resulting readiness checkpoint records:

```text
priorReviewedEpoch
reviewedEpoch
resolvedInvalidationIds[]
exact reviewed Article semantic-source fingerprint
review kind
review-contract version
```

Deleting invalidation records cannot manufacture READY because the monotonic epoch remains ahead of the last reviewed epoch.

## Persistence boundary

The library operations return deterministic updated `manifestText`; they do not silently commit Git or mutate Ghost.

The agent/Git layer owns writing that text using normal repository concurrency protection. For GitHub writes this means updating the exact currently read manifest/blob rather than overwriting an unknown newer version.

If source or manifest state changes after the review evidence was computed but before persistence, the operation must be recomputed against fresh source. A later validator also re-derives current fingerprints, so a stale checkpoint cannot falsely recover as `SYNCED`/`READY` merely because it was serialized successfully.

## Authorization boundary

- Recording an RTA -> Blog invalidation requires the active task/edge to authorize that Blog mutation; the existence of RTA evidence alone is not mutation permission.
- Translation/readiness acceptance never authorizes production publication.
- Production publication authorization is task-scoped and is not written into `article.json`.
- Merge authorization is separate from publication authorization.

## Durable privacy/provenance boundary

Review checkpoints persist only bounded provenance kind/version needed for the contract. They do not persist:

- raw chat transcripts;
- model names/IDs;
- chat/session IDs;
- hidden reasoning;
- volatile confidence values.

Readiness invalidation references reject `chat:`, `session:`, and `model:` identifiers.
