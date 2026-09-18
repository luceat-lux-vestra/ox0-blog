# Target Article publication orchestration

This document describes the target Article-level mutation library, low-level execution CLI, and guarded manual GitHub Actions control surface on the authoring branch.

The durable workflow policy in `docs/workflow/` remains authoritative for deciding whether a task is authorized to mutate Ghost. Low-level repository mechanics consume authorization; they do not create evidence of user intent by themselves.

## High-level invariant

Production publication is an Article work-unit operation across all required locales, not a loop that independently calls “publish this Markdown file”.

The generic Article mutation library performs:

```text
external task/control authorization
      |
      v
source/evidence/Article preflight
      |
      +--> production remote-resource host approvals
      |
      v
read-only body-asset plans
      |
      v
read-only Ghost plans for all required locales
      |
      v
exact source-fingerprint authorization check
      |
      v
optional control-surface PublicationPlan guard
      |
      v
asset publish/reuse side effects
      |
      v
full Article source/policy + Ghost re-plan
      |
      +--> exact source authorization recheck
      +--> optional control-surface plan guard recheck
      |
      +-- changed/disallowed -> abort before Ghost mutation
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

The optional `publicationPlanGuard` is a read-only policy callback supplied by a higher-level control surface. It is evaluated on the library's first internal plan and again on the refreshed plan immediately before Ghost mutation. This lets a control surface enforce a narrower allowed transition without teaching the generic publication library to infer user intent or workflow state.

## Draft versus production publish

`draft` and `publish` remain explicit low-level operation parameters.

A draft mutation does not require production-publication authorization, but all source/compiler/identity/asset safety invariants still apply. Draft is not read-only: it may stage repository-owned body assets and upload a local feature image before creating/updating managed Ghost drafts. Draft refuses to unpublish an existing managed published projection.

A generic production `publish` mutation requires all of:

- translation state `SYNCED`;
- Article readiness `READY`;
- explicit host approval for every remote HTTPS body/feature image;
- a task-scoped explicit authorization assertion supplied by the external control surface;
- authorization `articleId` equal to the prepared Article;
- authorization source fingerprint for every required locale equal to the exact prepared projection source fingerprint.

The publication library does not create that authorization assertion itself. Doing so would let repository mechanics manufacture evidence of user intent. The conversation/control layer owns the statement “the user explicitly requested production publication”.

The authorization object is ephemeral. It is not persisted in `article.json`, Ghost, Git, or RTA.

The target manual GitHub Actions production surface intentionally adds a stronger mode-pinned policy; see **Manual production control surface** below.

## ProjectContext preservation

Article publication must use the same compiler host context semantics as validation/review.

The workflow resolves ProjectContext once per LocaleVariant evaluation snapshot and retains that resolved context as runtime evidence.

When a local body asset requires recompilation with an AssetPublisher delivery URL, the workflow reuses the exact resolved ProjectContext and overrides only `resolveResource`.

This is important for future compiler backends such as Arkst/VirtualProject: resource delivery must not silently discard unrelated compiler/project context merely because Marked currently does not use it.

The same ProjectContext is threaded through the post-asset source revalidation pass. A backend/context change that affects the compiled projection therefore changes the projection source fingerprint and fails the stability check rather than being ignored.

Target scripts may load deployment-specific ProjectContext/AssetPublisher/remote-resource policy dependencies through an operator-controlled `OX0_HOST_RUNTIME_MODULE=host/...mjs`. Article source cannot select this runtime module, and path/symlink escapes are rejected.

## Remote external image policy

An authored HTTPS image URL does not prove immutable remote bytes.

For production `publish`, every remote body image and remote feature image must therefore be approved by the host `remoteResourcePolicy` before the first Ghost read.

The policy returns explicit bounded evidence:

```text
{ decision: "ALLOW", evidence: "trusted-static-cdn-v1" }
```

or denies the resource.

The approval is a host trust assertion. ox0-blog does not fetch arbitrary external URLs to hash their bytes; that would introduce a separate network/SSRF/redirect/content trust boundary.

Each locale plan records:

```text
remoteResourceApprovals[] = {
  kind,
  href,
  evidence
}
```

The complete preparation pass is repeated before Ghost mutation. URL/kind/policy-evidence drift is treated as source-policy drift and causes `SOURCE_REVALIDATION`.

Draft planning/mutation may retain remote HTTPS image dependencies without production trust approval because it is not a public publication authorization boundary.

See `docs/remote-resource-policy.md`.

## Public URL safety boundary

URLs that become public projection or publication targets must not embed URL credentials.

The target path applies this rule independently at the relevant boundaries rather than assuming one upstream validator protects every caller:

- Markdown `http`/`https` links and HTTPS images reject `user:password@host` user-info;
- remote feature-image and canonical URLs reject URL credentials;
- AssetPublisher planned/result HTTPS URLs reject URL credentials, including low-level material-resource helpers;
- remote-resource policy descriptors reject credentialed HTTPS URLs;
- Ghost Image API response URLs used as feature-image projection URLs must be absolute, HTTPS, and credential-free.

The Ghost Admin transport base URL is also constrained separately: it must use HTTPS, must not contain URL credentials, and must not contain a query or fragment.

These checks prevent configuration/source mistakes from turning credentials into persisted public content or request URLs. They are transport/projection safety rules, not substitutes for Article readiness, remote-resource trust approval, or production publication authorization.

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

The repository includes a vendor-neutral content-addressed AssetPublisher adapter over abstract object-store `headObject`/`putObject` callbacks. It requires exact stored size/SHA-256 metadata for reuse and verifies storage metadata again after publish. Cloud/vendor binding remains host configuration.

## Source revalidation after asset side effects

Asset upload may take time or interact with external infrastructure. Repository state, host trust evidence, and higher-level transition policy are therefore not assumed stable across that phase.

Before the first Ghost mutation, the orchestration runs a second complete Article preparation pass. It compares at least:

- Article identity and required locale set;
- current translation fingerprints;
- derived translation/readiness state;
- per-locale projection source fingerprints;
- local asset refs/digests/sizes/filenames;
- planned public asset target URLs;
- approved remote-resource kinds/URLs/policy evidence.

Asset provider `publish -> reuse` action change after a successful upload is allowed by the generic library when the exact source digest, target URL, size, filename and ref remain identical. This is the expected convergence for a content-addressed backend. `reuse -> publish`, target URL drift, or other asset target/evidence drift is rejected before Ghost mutation.

Any source/evidence/remote-policy/target difference ends the operation with `SOURCE_REVALIDATION` before Ghost mutation.

For production publish, the explicit authorization is checked again against the refreshed exact source fingerprints. If the caller supplied a `publicationPlanGuard`, it is also rerun against the refreshed plan. A guard failure at this second boundary is reported as `SOURCE_REVALIDATION` and Ghost mutation does not begin.

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

## Automatic first-draft control surface

`.github/workflows/article-auto-draft.yml` is a separate non-production control surface. It runs only for `main` pushes that add a new canonical Article manifest, validates every selected exact pushed source as `SYNCED + READY`, confirms that pushed SHA is still current `main`, read-only plans every selected Ghost draft before any write, and only then invokes the normal guarded Article synchronization library with `action=draft` under the shared Ghost mutation lock.

This automation deliberately stops at managed draft projection. It does not construct a production authorization envelope, does not call the `publish` action, and does not change the first-publication `draft-promotion` requirement. Consequently, the later explicit production publish still observes exact-current managed drafts and promotes them by status change only.

Existing Article revisions are excluded from this automatic first-draft path. Already-published Articles therefore remain on the published-revision workflow and are never pushed back to draft by a routine merge.

## Manual production control surface

`.github/workflows/article-ghost.yml` is the target manual GitHub Actions control surface. It is `workflow_dispatch` only and operates only on the exact current `main` SHA supplied as `source_sha`.

The workflow may use four operations:

```text
plan-draft
 draft
plan-publish
 publish
```

Each operation recreates current evidence. A prior dry-run is never replayed as authorization or as a stale mutation plan.

### Exact source / target binding

The workflow fails closed unless:

- event is `workflow_dispatch`;
- ref is `refs/heads/main`;
- user/control-surface `source_sha` equals the event's exact `github.sha`;
- fresh current `main` still equals that source before checkout and again immediately before the operation;
- the exact SHA is checked out and verified;
- `manifest_path` is an unaliased repository-relative `posts/.../article.json` path.

The production `publish` operation additionally requires:

```text
publish:<manifest_path>@<source_sha>
```

as `publish_confirmation`. This is an exact-target/source confirmation. It does not substitute for Article readiness, remote-resource trust, managed Ghost ownership, or source fingerprints.

### Production mode classification

A fresh `plan-publish` / `publish` plan must classify into exactly one of two control-surface modes.

#### `draft-promotion`

This is the first-publication path. If any required locale is still a managed `draft`, every locale must be either:

```text
exact-current managed draft
  currentStatus == draft
  projectedSourceFingerprint == exact current sourceFingerprint
  operation == status-update
  desiredStatus == published
```

or, when recovering a partial multi-locale promotion:

```text
exact-current managed published sibling
  currentStatus == published
  projectedSourceFingerprint == exact current sourceFingerprint
  operation == noop
```

Every local body-asset plan must already be `reuse`, and feature-image planning must be `none` or `preserve`. The first-production step therefore cannot first-create/rewrite Article content, upload/replace a feature image, or newly publish repository-owned body assets.

A stale published sibling is not allowed to hide inside promotion recovery; it would require a content `update` and therefore fails the promotion mode.

#### `published-revision`

When every required locale is already a uniquely managed `published` projection, a later reviewed revision stays public and is updated in place. Each locale may be:

```text
stale managed published projection
  currentStatus == published
  projectedSourceFingerprint != exact current sourceFingerprint
  operation == update
```

or:

```text
exact-current managed published sibling
  currentStatus == published
  projectedSourceFingerprint == exact current sourceFingerprint
  operation == noop
```

The operation never temporarily unpublishes the Article merely to stage a revision.

Because an authorized revision may add repository-owned body assets or replace a local feature image, this mode may include resource publication/image-upload work. Those side effects remain bound to exact source/resource fingerprints, planned public URLs, current remote-resource approval, managed ownership/version evidence and refreshed post-verification.

### Bound managed observation

Both production modes require an existing managed Ghost post for every locale and an exact bound observation containing the same post ID, status and projected source revision, a non-empty `updated_at`, and canonical sync evidence. The low-level planned synchronization re-reads that identity immediately before mutation and compares ownership/version/status/slug/revision/sync/tags again.

Unmanaged, ambiguous, malformed, first-create, or otherwise unsupported states fail closed.

### Mode pinning across replans

The dispatch adapter classifies the first fresh production plan and then builds the exact-source publication authorization. The selected mode (`draft-promotion` or `published-revision`) is captured by the control surface.

The core `synchronizeArticlePublication(...)` then runs the mode-pinned `publicationPlanGuard`:

1. on the core library's first internal plan, before asset side effects;
2. on the refreshed plan after source/asset/policy revalidation, immediately before Ghost mutation.

If concurrent Ghost activity would change promotion into revision, revision into promotion, or otherwise leave the selected mode, the operation fails closed rather than widening mutation authority.

### Partial-failure retry

Multi-locale mutation is sequential, not transactional.

For a first publication, if one locale was promoted before a sibling failed, a later fresh retry may legitimately contain an exact-current published `noop` sibling plus remaining exact-current draft `status-update` locales. It remains `draft-promotion` as long as at least one draft remains and every published sibling is exact-current/noop.

For a published revision, if one stale locale was updated before another failed, a fresh retry may contain already-updated exact-current published `noop` siblings plus remaining stale published `update` locales. It remains `published-revision` because every locale remains published.

If a fresh retry observes every locale already exact-current published, the plan is a safe all-noop published state. A stale plan is never replayed; the fresh control-surface classification and explicit publication intent govern the new attempt.

## Feature-image side-effect observability

Local feature images are still uploaded through Ghost's Image API inside low-level projection synchronization when a content create/update actually requires them, including draft preparation and an explicitly authorized stale published revision.

That upload is not transactional with subsequent Ghost post creation/update. A successful image upload followed by a post mutation failure can therefore leave an orphan Ghost media object.

The Ghost client validates an image-upload response URL as a bounded absolute credential-free HTTPS URL. A response-validation error is marked as occurring after a successful upload API response so the Article wrapper can retain possible media side-effect evidence even though the transport client rejects the URL.

The target planned-projection wrapper independently treats the returned URL/evidence as a public projection boundary. Side-effect evidence is sanitized before it is attached to an Article error:

- valid non-credentialed absolute URLs may be recorded;
- credentialed URLs have user-info removed and carry `urlCredentialsRedacted: true`;
- malformed/overlong URL text is not echoed and may be recorded as `url: null`.

Therefore, if Ghost has already accepted the media bytes but returns an invalid, non-HTTPS, or credentialed URL:

1. the possible media-upload side effect is still reported without exposing URL credentials;
2. post create/update is not attempted with that URL;
3. the locale operation fails closed as `GHOST_MUTATION`;
4. fresh projection recovery still runs.

For any later projection failure, the Article-level `GHOST_MUTATION` error exposes bounded evidence such as:

```text
featureImageUploads[] = {
  method,
  ref,
  url,
  urlCredentialsRedacted?   // present only when credentials were removed
}
```

This is observability, not rollback or proof that Ghost definitely persisted an orphan media object. The system does not claim that media was deleted or that cleanup is safe automatically.

## Partial failure recovery

If locale N fails after earlier locale mutations succeeded:

1. aggregate success is not returned;
2. the error stage is `GHOST_MUTATION`;
3. every target locale is fresh-read by stable projection identity;
4. current per-locale projection state is derived using the exact prepared source fingerprint;
5. successful or possibly-successful feature-image upload side effects from the failing locale are retained as bounded evidence;
6. the recovery payload may therefore report mixed states such as:

```text
ko-KR -> PUBLISHED_CURRENT
en    -> OUTDATED(PUBLISHED)
```

or:

```text
ko-KR -> DRAFT_CURRENT
en    -> NOT_PROJECTED
```

A particularly important failure window is:

```text
Ghost post create/update succeeds
    -> final ox0 revision/sync stamp fails
```

The fresh recovery must not collapse that locale to `NOT_PROJECTED`, because a target post now exists. Missing or inconsistent publisher revision/sync evidence is recovered as `RECONCILIATION_REQUIRED` so the partially mutated projection remains visible for explicit repair.

Ambiguous ownership, missing operation-known managed target, unmanaged drift, unsupported status, malformed/missing sync evidence after a partial mutation, or recovery-read failure are represented as reconciliation-required outcomes. The system never implicitly adopts a conflicting unmanaged post.

The explicit production authorization may remain conceptually valid only for the same intended active operation/source, but the next attempt must re-run source, policy, asset, identity and plan guards. A stale PublicationPlan is never replayed blindly.

## Error stages

The target library distinguishes at least:

- `PREFLIGHT` — source/compiler/readiness/remote-policy/planning or initial higher-level plan guard failed before side effects;
- `AUTHORIZATION` — production authorization does not match exact prepared source;
- `ASSET_PLANNING` — required locale asset plans conflict;
- `ASSET_PUBLICATION` — body-asset provider mutation failed before Ghost mutation;
- `SOURCE_REVALIDATION` — source/evidence/remote-policy/asset target or refreshed higher-level plan guard changed/failed after preflight;
- `GHOST_MUTATION` — one locale mutation failed; fresh all-locale recovery attached;
- `POST_VERIFY` — mutations returned but fresh aggregate recovery is not the requested current state.

Errors may contain successfully published body-asset records, bounded feature-image upload side-effect evidence, and fresh projection recovery state to support safe continuation/reconciliation.

## Low-level CLI boundary

The generic target mutation library is exposed through:

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

The CLI is deliberately thin. It loads Ghost credentials plus optional host runtime dependencies and delegates to the guarded Article publication library.

For `publish`, it requires:

```text
OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON
```

The value must come from an external control surface that already owns explicit publication intent and has bound that intent to the exact Article/current locale projection fingerprints.

The CLI:

- parses the envelope with the strict JSON parser;
- rejects missing/malformed authorization before source/Ghost work;
- never creates authorization from Article `READY` state;
- never derives authorization from a dry-run by itself;
- rejects a production authorization envelope on `draft` rather than silently ignoring it;
- loads the same host AssetPublisher/ProjectContext/remote-resource policy contract used by dry-run;
- reports Article publication failures as structured JSON with stage/side-effect/recovery evidence.

This CLI being executable does not mean the agent may invoke `publish` without a user's explicit publication instruction. The workflow authorization contract remains above the CLI.

The target manual production workflow is `.github/workflows/article-ghost.yml`. `.github/workflows/ghost-publish.yml` remains explicitly named **Legacy Publish to Ghost (compatibility)** and must not be treated as the target Article publication surface.
