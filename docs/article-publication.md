# Target Article publication orchestration

This document describes the target Article-level mutation library currently implemented on the authoring branch.

It is not yet exposed as a production CLI. The durable workflow policy in `docs/workflow/` remains authoritative for deciding whether a task is authorized to mutate Ghost.

## High-level invariant

Production publication is an Article work-unit operation across all required locales, not a loop that independently calls “publish this Markdown file”.

The orchestration sequence is:

```text
explicit task intent
      |
      v
source/evidence/Article preflight
      |
      v
read-only body-asset plans
      |
      v
read-only Ghost plans for all required locales
      |
      v
exact production authorization binding (publish only)
      |
      v
asset publish/reuse side effects
      |
      v
full Article source + Ghost re-plan
      |
      +-- changed -> abort before Ghost mutation
      |
      v
sequential locale Ghost mutations
      |
      v
fresh all-locale projection recovery
      |
      +-- mixed/not-current -> fail, never aggregate-success
      |
      v
SUCCESS
```

## Draft versus production publish

`draft` and `publish` remain explicit operation parameters.

A draft mutation does not require production-publication authorization, but all source/compiler/identity/asset safety invariants still apply.

A production `publish` mutation requires all of:

- translation state `SYNCED`;
- Article readiness `READY`;
- a task-scoped explicit authorization assertion supplied by the control surface;
- authorization `articleId` equal to the prepared Article;
- authorization source fingerprint for every required locale equal to the exact prepared projection source fingerprint.

The library does not create that authorization assertion itself. Doing so would let repository code manufacture evidence of user intent. The conversation/control layer owns the statement “the user explicitly requested production publication”.

The authorization object is ephemeral. It is not persisted in `article.json`, Ghost, Git, or RTA.

## Plan binding

The normal read-only PREPARE_PUBLISH operation binds each locale plan to observed Ghost state including:

- publisher source identity;
- existing Ghost post ID, if any;
- `updated_at`;
- status;
- slug;
- publisher/author tag names;
- projected source revision;
- publisher sync hash.

Before a locale mutation, the exact identity read used by `synchronizeProjection` is intercepted and compared with that observation.

If ownership, version, status, slug, revision, sync evidence, or tags changed after planning, the mutation is refused as stale instead of silently adopting the new state.

For a planned create, the identity must still be unowned at mutation time.

## Asset-first ordering

All unique planned body assets are handled before any Ghost mutation.

- `reuse`: source snapshot is revalidated; provider mutation is skipped.
- `publish`: exact planned source bytes are re-snapshotted and sent to AssetPublisher; returned URL must equal planned URL.

If body-asset publication fails, Ghost remains untouched. The error reports which earlier assets were successfully published so cleanup/reuse can be reasoned about explicitly.

## Source revalidation after asset side effects

Asset upload may take time or interact with external infrastructure. Repository state is therefore not assumed stable across that phase.

Before the first Ghost mutation, the orchestration runs a second complete Article preparation pass. It compares at least:

- Article identity and required locale set;
- current translation fingerprints;
- derived translation/readiness state;
- per-locale projection source fingerprints;
- local asset refs/digests/sizes/filenames;
- planned public asset target URLs.

Asset provider `publish -> reuse` action change after a successful upload is allowed if the source digest and target URL remain identical. A changed target URL is not allowed because it changes the compiled projection.

Any source/evidence/target difference ends the operation with `SOURCE_REVALIDATION` before Ghost mutation.

For production publish, the explicit authorization is checked again against the refreshed exact source fingerprints.

## Sequential Ghost mutation

Required locales are mutated sequentially using the stable projection publisher.

Each locale still gets low-level safeguards such as:

- stable ownership identity;
- no implicit adoption;
- slug/post/page collision checks;
- current source-fingerprint recomputation;
- local feature-image exact-snapshot verification;
- Ghost `updated_at` optimistic concurrency;
- managed-field drift hash;
- pre/post identity checks;
- exact mutation verification;
- final sync/revision stamping.

Sequential mutation does not imply transactionality across Ghost posts. The orchestration therefore treats partial failure as a first-class state rather than pretending distributed rollback exists.

## Partial failure recovery

If locale N fails after earlier locale mutations succeeded:

1. aggregate success is not returned;
2. the error stage is `GHOST_MUTATION`;
3. every target locale is fresh-read by stable projection identity;
4. current per-locale projection state is derived using the exact prepared source fingerprint;
5. the recovery payload may therefore report mixed states such as:

```text
ko-KR -> PUBLISHED_CURRENT
en    -> OUTDATED(PUBLISHED)
```

or:

```text
ko-KR -> DRAFT_CURRENT
en    -> NOT_PROJECTED
```

Ambiguous ownership, missing previously managed target, unmanaged drift, unsupported status, or recovery-read failure are represented as reconciliation-required outcomes. The system never implicitly adopts a conflicting unmanaged post.

The explicit production authorization may remain conceptually valid only for the same intended active operation/source, but the next attempt must re-run source, asset, identity and plan guards. A stale PublicationPlan is never replayed blindly.

## Error stages

The target library distinguishes at least:

- `PREFLIGHT` — source/compiler/readiness/planning failed before side effects;
- `AUTHORIZATION` — production authorization does not match exact prepared source;
- `ASSET_PLANNING` — required locale asset plans conflict;
- `ASSET_PUBLICATION` — body-asset provider mutation failed before Ghost mutation;
- `SOURCE_REVALIDATION` — source/evidence/asset target changed after preflight;
- `GHOST_MUTATION` — one locale mutation failed; fresh all-locale recovery attached;
- `POST_VERIFY` — mutations returned but fresh aggregate recovery is not the requested current state.

Errors may contain successfully published body-asset records and fresh projection recovery state to support safe continuation/reconciliation.

## CLI boundary

No target mutating Article CLI is currently exposed.

That is intentional. Library mechanics are being validated before wiring them to a user-facing command because the CLI/control layer must preserve the explicit publication-authorization contract rather than accepting a convenient `--force` or source metadata flag.

The existing target `dry-run:article` remains read-only. Legacy publication commands remain compatibility paths and are not the target Article mutation interface.
