# Article semantic readiness v1

Article readiness answers a narrow question:

> Has the current semantic Article content been reviewed and accepted under the current readiness contract?

It does **not** answer:

- whether Ghost should be mutated;
- whether public projection metadata is unchanged;
- whether production publication is authorized;
- whether a Git candidate may merge.

Those are owned by separate contracts and guards.

## States

Readiness remains:

```text
DRAFT -> REVIEW_REQUIRED -> READY
```

The durable manifest does not store this enum directly. Fresh sessions recover it from:

- current semantic Article source fingerprint;
- reviewed readiness checkpoint;
- monotonic readiness epoch;
- unresolved readiness invalidation events.

## Semantic source fingerprint

Article semantic source fingerprint v1 is derived from the required-locale translation fingerprints.

Translation fingerprint v1 already covers semantic/localized source including:

- locale title;
- locale excerpt;
- Markdown body;
- material local body-asset bytes;
- source-owned feature-image semantic evidence, including localized alt text and local image bytes.

Those changes therefore invalidate the Article semantic source fingerprint and a prior `READY` checkpoint.

## Projection-only metadata is deliberately separate

The following source-owned projection fields do **not** invalidate Article semantic readiness merely by changing:

- public slug;
- taxonomy tags;
- `featured` flag;
- projection visibility;
- canonical URL.

These fields are not translation-equivalence evidence and do not by themselves alter the reviewed semantic claims/content.

This separation is intentional rather than an omission.

A `READY` Article whose slug/tags/canonical URL changes remains semantically `READY`, but the public projection is **not** considered unchanged or pre-authorized.

## Projection/source fingerprint owns public representation changes

Projection-source fingerprint is a separate versioned contract. It covers the compiled representation and source-owned projection metadata used to construct the Ghost post.

Therefore a projection-only metadata change must change the per-locale projection source fingerprint even when:

```text
translation == SYNCED
readiness   == READY
```

The publication workflow binds its plan and explicit production authorization to those exact projection source fingerprints.

Consequently:

```text
READY Article
  -> slug/tags/featured/canonical URL change
  -> READY remains true
  -> projection fingerprint changes
  -> old publication plan/authorization is stale
  -> production mutation requires a newly prepared exact-source plan/authorization
```

This preserves the orthogonal-machine rule:

- translation checkpoint proves locale equivalence;
- Article readiness checkpoint proves reviewed semantic content;
- projection fingerprint proves the exact public representation source;
- publication authorization proves current task-scoped user intent.

None substitutes for another.

## Validation still applies

Excluding projection-only metadata from semantic readiness does not make it unchecked.

Before mutation, the target publication path still requires deterministic validation and projection guards, including relevant constraints such as:

- valid slug/URL/tag metadata;
- repository-wide slug uniqueness;
- Ghost post/page collision checks;
- stable ownership identity;
- current projection fingerprint integrity;
- Ghost managed-state drift checks;
- exact production authorization for `publish`.

A field can therefore leave `READY` unchanged while still making publication planning or mutation fail.

## External evidence invalidation

RTA/external evidence changes are also separate from source hashing.

A material counter-evidence/provenance signal creates a durable readiness invalidation event and advances the Blog-local readiness epoch. This can produce `REVIEW_REQUIRED` even when semantic source bytes did not change.

This keeps both directions valid:

- semantic source changed -> checkpoint/source mismatch -> `REVIEW_REQUIRED`;
- evidence meaning changed without source edit -> durable invalidation -> `REVIEW_REQUIRED`.

## Regression obligation

The executable contract must preserve at least this adversarial case:

1. create a `SYNCED + READY` Article;
2. capture its projection source fingerprint and task-scoped publish authorization;
3. change only slug/tags/featured/canonical URL;
4. confirm translation remains `SYNCED` and readiness remains `READY`;
5. confirm projection source fingerprint changes;
6. confirm the old production authorization is rejected before mutation.

This prevents semantic readiness from accidentally becoming a broad, reusable publication approval.
