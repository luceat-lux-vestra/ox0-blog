# Target Article operations

This document describes the target Article-oriented validation, planning, synchronization, and manual production-control entrypoints on `feat/authoring-foundation`.

It does not replace the durable authorization/state-machine policy in `docs/workflow/`. A successful validation or dry-run never grants merge or production publication authorization.

## Validate Article source

```bash
npm run validate:articles
```

This scans repository `posts/` for exact-lowercase `article.json` manifests, loads each manifest and locale source, compiles each present LocaleVariant, derives current material/local semantic evidence, computes translation fingerprints, and recovers translation/readiness state.

Normal source validation allows valid work-in-progress states such as:

- Article `DRAFT`;
- translation `UNREVIEWED`;
- translation `INCOMPLETE` while an Article is still being authored.

Repository-wide target checks include at least:

- strict manifest/source/path validation;
- compiler/raw-HTML/resource validation;
- local material-asset confinement and hashing;
- semantic local feature-image confinement and hashing;
- unique stable `articleId` values;
- unique stable `variantId` values;
- unique public Ghost slugs;
- deterministic checkpoint/readiness recovery.

Titles are presentation content, not repository identity. Target validation deliberately does not inherit the legacy repository-wide title-uniqueness rule.

During migration the default combined command runs both source models:

```bash
npm run validate
```

Equivalent explicit commands are:

```bash
npm run validate:legacy
npm run validate:articles
```

CI uses the combined command.

## Require reviewed readiness

```bash
npm run validate:articles -- --ready
```

`--ready` additionally requires every discovered Article to recover as:

```text
translation = SYNCED
readiness   = READY
```

This is a stronger evidence check. It still does **not** mean merge or production publication is authorized.

## Validate selected manifests

Repository-wide invariants are always checked first. The command may then return a selected subset:

```bash
npm run validate:articles -- posts/example/article.json
npm run validate:articles -- --ready posts/example/article.json
```

Selecting one manifest does not bypass collisions or invalid source elsewhere in the Article corpus.

## Read-only Article publication planning

The target default dry-run is Article-wide:

```bash
npm run dry-run -- posts/example/article.json draft
npm run dry-run -- posts/example/article.json publish
```

`dry-run:article` is an explicit alias of the same target command.

The action is mandatory and is never inferred from source metadata or Ghost state.

The command requires:

```text
GHOST_ADMIN_URL
GHOST_ADMIN_API_KEY
```

because planning reads Ghost ownership/collision/current-state information. Planning remains read-only with respect to Ghost and body-asset storage.

The planner:

1. loads/evaluates the logical Article;
2. preflights every required locale;
3. plans all local body-resource delivery where a host AssetPublisher is available;
4. for production `publish`, requires explicit host approval for every remote HTTPS body/feature image;
5. refuses a partial Article plan if one sibling cannot be represented or trusted;
6. only then reads Ghost;
7. binds each locale plan to a fresh observed Ghost snapshot.

A `publish` plan additionally requires `SYNCED + READY` before Ghost access. That is eligibility for consideration, not publication authorization.

A `draft` plan may operate on valid work-in-progress Article state, subject to the same structural/compiler/resource safety invariants. Draft planning may retain external HTTPS image dependencies without production trust approval.

The lower-level `planArticleProjection(...)` remains a per-locale primitive; normal workflow uses the Article-wide plan.

## Host runtime injection

Target scripts may receive host-specific compiler/resource dependencies through:

```text
OX0_HOST_RUNTIME_MODULE=host/runtime.mjs
```

The module path is supplied only by the operator/control environment. It is not read from Article source.

It must be a real `.mjs` file under repository `host/`; absolute paths, traversal, aliases, and symlink escapes fail closed.

The module may export any combination of:

```js
export const assetPublisher = ...;
export const projectContext = ...;
export async function remoteResourcePolicy(resource) { ... }
```

- `assetPublisher` must satisfy the host AssetPublisher contract.
- `projectContext` may be an object or per-LocaleVariant factory.
- `remoteResourcePolicy` owns the explicit production trust decision for external HTTPS body/feature images.

With no host runtime module:

- text-only Articles and repository-owned local feature images can still plan;
- a local body asset requiring delivery fails before Ghost access because no AssetPublisher is available;
- draft planning may retain remote HTTPS image URLs;
- production publish planning with remote body/feature images fails before Ghost access because no remote-resource policy approved them.

The repository also includes a vendor-neutral content-addressed AssetPublisher adapter; a deployment host module can bind it to its chosen object-store backend.

See `docs/asset-publisher.md` and `docs/remote-resource-policy.md`.

## Fresh-session semantic evaluation

The target evaluator reconstructs current semantic evidence instead of trusting a stored readiness enum:

```text
ArticleBundle
  + locale Markdown
  + compiler/ProjectContext observations
  + current local body-asset bytes
  + locale semantic publication evidence
        |
        v
current translation fingerprints
        |
        +--> translation state
        +--> Article semantic-source fingerprint
                     |
                     +--> readiness state
```

Locale semantic publication evidence includes the feature-image source, local feature-image content digest when applicable, and localized feature-image alt text.

Changes to semantic source/assets can invalidate translation/readiness even when Markdown text itself did not change.

Projection-only metadata such as slug/tags/featured/canonical URL is deliberately handled by the separate projection fingerprint and production authorization contract; see `docs/article-readiness-v1.md`.

Remote HTTPS image URLs remain authored source references. ox0-blog does not fetch arbitrary remote bytes for semantic fingerprints; production use therefore requires the separate host trust assertion described in `docs/remote-resource-policy.md`.

## Planning snapshot safety

Local feature-image and body-asset evidence is tied to exact bytes.

For local body assets, target AssetPublisher planning resolves a deterministic HTTPS target from exact ref/digest/size evidence. Mutation re-snapshots the file and requires the exact planned digest/size before any provider write.

Approved remote resources are bound into a production plan as `{ kind, href, evidence }`. Mutation repeats the full publication preparation before Ghost mutation and requires the refreshed approval evidence to match the initial plan.

After body-asset side effects, the complete Article is loaded/evaluated/planned again before the first Ghost mutation. Source/evidence/remote-policy/target drift fails closed.

## Low-level target synchronization CLI

The repository exposes:

```bash
npm run sync:article -- posts/example/article.json draft
npm run sync:article -- posts/example/article.json publish
```

This is a low-level control-surface entrypoint over the guarded Article mutation library. It is **not** allowed to infer production authorization.

### Draft

Draft synchronization must not be given a production authorization envelope. Draft is a mutation and may stage repository-owned body assets and upload a local Ghost feature image before creating/updating the managed Ghost draft.

### Publish

Production publish requires the external control surface to inject:

```text
OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON
```

The JSON must be the task-scoped exact-source authorization expected by the Article publication library. The CLI parses it with the strict JSON parser and does not generate it from Article `READY` state or from a dry-run plan.

Missing, malformed, wrong-Article, incomplete-locale, or stale-fingerprint authorization fails closed.

The same optional `OX0_HOST_RUNTIME_MODULE` is used by planning and synchronization, so AssetPublisher, ProjectContext, and remote-resource trust semantics do not silently differ between the two entrypoints.

Article publication errors are emitted as structured JSON including stage and, where applicable:

- body assets successfully published before failure;
- Ghost feature-image upload side effects;
- fresh per-locale projection recovery state.

## Target manual GitHub Actions control surface

`.github/workflows/article-ghost.yml` is the target manual Article control surface. It is `workflow_dispatch` only; ordinary push/PR events never invoke it.

Inputs are:

```text
manifest_path
source_sha
operation = plan-draft | draft | plan-publish | publish
publish_confirmation
```

The workflow fails closed unless:

- it is running from `refs/heads/main`;
- `source_sha` is exactly the current workflow-dispatch `github.sha` and is lowercase 40-hex;
- exact `source_sha` is checked out and reverified;
- the manifest path is an unaliased repository-relative `posts/.../article.json` path;
- the full Node 24 test suite and repository validation run before the selected operation.

Article Ghost workflow executions are globally serialized (`article-ghost-control`) and use the `ox0-blog` environment.

### `plan-draft`

Read-only with respect to Ghost and body-asset storage. This is the normal first visibility check for the exact canonical source.

### `draft`

Explicit non-production mutation. This may:

- publish/reuse repository-owned body assets required by the draft;
- upload a local feature image to Ghost;
- create/update managed Ghost locale drafts.

It must never unpublish an already-published managed projection.

### `plan-publish`

Read-only production readiness check. In addition to normal `SYNCED + READY`, remote-resource policy, identity, drift, and URL guards, every required locale must already be an **exact-current managed Ghost draft**.

For every required locale:

- a managed Ghost post must exist;
- current Ghost status must be `draft`;
- observed projected source fingerprint must equal the exact current source fingerprint;
- managed sync evidence must be present and fresh;
- the publish operation must be exactly `status-update` to `published`;
- every local body-asset plan must be `reuse`, so production planning proves those assets were already staged.

A first-publish `create`, content `update`, already-published `noop`, unstaged body-asset `publish`, stale draft, or ambiguous/unmanaged projection fails closed.

### `publish`

Explicit production mutation. It additionally requires exact confirmation:

```text
publish:<manifest_path>@<source_sha>
```

This is an exact-target/source binding supplied by the external control surface; it is not inferred from Article/Git/Ghost/RTA state.

The dispatch adapter creates the existing Article publication authorization envelope only from a fresh exact publish plan after the draft gate passes. The core publication library then independently recreates the plan and reruns the same draft-only plan guard:

1. during its first internal preflight, before body-asset side effects;
2. again after asset/source/policy revalidation, immediately before Ghost mutation.

This closes the race where a draft could disappear/change between control-surface planning and core execution.

Under this manual production path, local body assets must remain `reuse` and every Ghost locale operation must remain draft-to-published `status-update`. Therefore the final production step is not allowed to create a post, rewrite Article content, upload a feature image, or newly publish repository-owned body assets.

A stale plan, changed Ghost draft, changed source, changed asset target/action, changed remote-resource approval, or lost managed evidence aborts instead of widening the operation.

## Legacy compatibility entrypoints

The earlier one-file publisher is explicitly namespaced:

```bash
npm run validate:legacy
npm run dry-run:legacy -- posts/example.md
npm run verify:ghost-live:legacy
```

`.github/workflows/ghost-publish.yml` is named **Legacy Publish to Ghost (compatibility)**.

These commands/workflow are migration compatibility mechanisms, not the target Article production workflow.
