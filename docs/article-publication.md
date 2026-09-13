# Target Article publication orchestration

This document describes the target Article-level mutation library and low-level execution CLI on the authoring branch.

The durable workflow policy in `docs/workflow/` remains authoritative for deciding whether a task is authorized to mutate Ghost. The CLI consumes authorization; it does not create evidence of user intent.

## High-level invariant

Production publication is an Article work-unit operation across all required locales, not a loop that independently calls “publish this Markdown file”.

The orchestration sequence is:

```text
explicit task intent
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
exact production authorization binding (publish only)
      |
      v
asset publish/reuse side effects
      |
      v
full Article source/policy + Ghost re-plan
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
- explicit host approval for every remote HTTPS body/feature image;
- a task-scoped explicit authorization assertion supplied by the control surface;
- authorization `articleId` equal to the prepared Article;
- authorization source fingerprint for every required locale equal to the exact prepared projection source fingerprint.

The publication library does not create that authorization assertion itself. Doing so would let repository mechanics manufacture evidence of user intent. The conversation/control layer owns the statement “the user explicitly requested production publication”.

The authorization object is ephemeral. It is not persisted in `article.json`, Ghost, Git, or RTA.

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

Asset upload may take time or interact with external infrastructure. Repository state and host trust evidence are therefore not assumed stable across that phase.

Before the first Ghost mutation, the orchestration runs a second complete Article preparation pass. It compares at least:

- Article identity and required locale set;
- current translation fingerprints;
- derived translation/readiness state;
- per-locale projection source fingerprints;
- local asset refs/digests/sizes/filenames;
- planned public asset target URLs;
- approved remote-resource kinds/URLs/policy evidence.

Asset provider `publish -> reuse` action change after a successful upload is allowed if the source digest and target URL remain identical. A changed target URL is not allowed because it changes the compiled projection.

Any source/evidence/remote-policy/target difference ends the operation with `SOURCE_REVALIDATION` before Ghost mutation.

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

## Feature-image side-effect observability

Local feature images are still uploaded through Ghost's Image API inside the low-level projection synchronization path.

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

A future deterministic prepublication/cleanup contract may reduce this side effect, but current correctness depends on reporting it rather than hiding it.

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

- `PREFLIGHT` — source/compiler/readiness/remote-policy/planning failed before side effects;
- `AUTHORIZATION` — production authorization does not match exact prepared source;
- `ASSET_PLANNING` — required locale asset plans conflict;
- `ASSET_PUBLICATION` — body-asset provider mutation failed before Ghost mutation;
- `SOURCE_REVALIDATION` — source/evidence/remote-policy/asset target changed after preflight;
- `GHOST_MUTATION` — one locale mutation failed; fresh all-locale recovery attached;
- `POST_VERIFY` — mutations returned but fresh aggregate recovery is not the requested current state.

Errors may contain successfully published body-asset records, bounded feature-image upload side-effect evidence, and fresh projection recovery state to support safe continuation/reconciliation.

## Low-level CLI boundary

The target mutation library is exposed through:

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

No target production GitHub Actions workflow is enabled yet. `.github/workflows/ghost-publish.yml` remains explicitly named **Legacy Publish to Ghost (compatibility)** and must not be treated as the target Article publication surface.
