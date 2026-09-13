# Exact-candidate Article staging live verification

This document defines the pre-merge live-evidence path for the target staged Article publication semantics.

## Why this exists

The target manual production workflow is `.github/workflows/article-ghost.yml` and uses `workflow_dispatch` only.

GitHub only receives `workflow_dispatch` events for a workflow file after that workflow exists on the repository default branch. Therefore a workflow introduced by the current authoring PR cannot itself be manually dispatched as exact pre-merge candidate evidence.

Do **not** solve that circular dependency by merging the publishing workflow before its core mutation semantics are proven.

Instead, pre-merge live evidence uses the same Article planning/publication library and the same exact-current-draft production guard directly from the exact candidate checkout:

```bash
npm run verify:article-staging-live
```

This verifies mutation semantics. It does **not** claim that GitHub's eventual `workflow_dispatch` wiring has already executed.

## Safety boundary

The verifier is deliberately staging-only and mutating.

It requires all of:

```text
OX0_ARTICLE_STAGING_VERIFY=1
OX0_ARTICLE_STAGING_PROMOTE=1
OX0_ARTICLE_STAGING_SOURCE_SHA=<exact current git HEAD>
OX0_ARTICLE_STAGING_EXPECTED_URL=<exact staging Ghost admin base URL>
GHOST_ADMIN_URL=<same exact staging Ghost admin base URL>
GHOST_ADMIN_API_KEY=<authorized staging Ghost Admin key>
```

Additional guards:

- current Git HEAD and `OX0_ARTICLE_STAGING_SOURCE_SHA` must be the same lowercase 40-hex SHA;
- the tracked/untracked worktree must be clean before verification;
- the expected staging URL and actual Ghost Admin URL must match exactly after safe normalization;
- both URLs must be credential-free HTTPS without query/fragment;
- the verifier canonicalizes DNS hostname case/trailing-dot form and hard-refuses the production host `blog.ox0.uk`;
- `OX0_HOST_RUNTIME_MODULE` must be absent for this base verifier.

The explicit expected staging URL is an operator assertion and accidental-target guard; it is not cryptographic attestation that the remote service is non-production. The canonical production-host block is defense in depth, not a substitute for selecting and verifying the correct staging endpoint/credentials.

The host-runtime rule is intentional. The base verifier proves the staged Ghost state transition without allowing an unproven deployment-specific AssetPublisher/remote-resource adapter to enter the evidence run. Concrete resource adapters have their own live proof obligation after a deployment backend is selected.

Do not print or persist the staging Admin key in logs, issues, PR bodies, or evidence summaries.

## What the verifier does

The verifier creates a unique temporary bilingual Article under `posts/` in the local checkout and uses normal target review operations to advance it to exact current:

```text
translation = SYNCED
readiness   = READY
```

The readiness invalidation/review uses the normal durable review contract: a lowercase UUID v4 invalidation ID with `blog-audit` origin. The verifier does not expand the production readiness schema with staging-only origin values.

It then performs against the explicitly bound staging Ghost:

```text
Article draft synchronization
    -> fresh per-locale DRAFT_CURRENT recovery
    -> fresh publish planning
    -> exact-current managed-draft gate
    -> explicit exact-source publication authorization envelope
    -> core publication with publicationPlanGuard
    -> fresh per-locale PUBLISHED_CURRENT recovery
```

The temporary fixture is text-only. Therefore the production gate also proves there are no unstaged local body assets in this base run.

The exact-current production gate requires, for every locale:

- an existing managed post;
- status `draft`;
- exact current projection source fingerprint;
- bound managed post/revision/sync observation;
- planned Ghost operation `status-update` to `published`;
- every local body-asset plan `reuse` (vacuously true for the base text-only fixture).

The same predicate is run by the core publication library on its first internal preflight and again on the refreshed plan immediately before Ghost mutation.

## Cleanup

The verifier uses random Article/variant IDs and slugs and first proves that its temporary namespace is unused.

On success or failure after namespace ownership is established, cleanup:

1. uses known post IDs when available;
2. if a mutation failed before returning IDs, recovers by the stable per-variant projection identity;
3. requires exactly one matching owned post and rechecks title/slug/identity before deletion;
4. deletes posts by ID and verifies persisted absence;
5. never deletes shared `#ox0-locale-*` tags;
6. deletes other observed verifier/publisher tags only when the exact tag ID/name still matches and the tag is unreferenced;
7. fresh-reads the temporary slugs, stable projection identities, and non-shared identity tags and requires the verifier namespace to be absent;
8. removes the temporary Article directory;
9. verifies the checkout is clean again.

If ownership is ambiguous or changed, cleanup fails closed and reports reconciliation instead of deleting by slug or guessing ownership. If a mutation left unproven Ghost residue that cannot be safely claimed/deleted, the verifier fails rather than silently calling cleanup successful.

## Evidence scope

A PASS from this verifier supports only these claims for the **exact verified candidate SHA** and the **specified staging Ghost**:

- target Article review/checkpoint reconstruction reaches `SYNCED + READY`;
- two locale drafts can be created and recovered as current;
- production planning recognizes those exact-current managed drafts;
- the staged production policy restricts promotion to draft-to-published status updates;
- the core plan guard survives the independent internal re-plan/revalidation boundary;
- both locale projections can recover as `PUBLISHED_CURRENT`;
- temporary posts can be safely recovered/cleaned by stable ownership and the temporary namespace is absent afterward.

It does **not** prove:

- GitHub-hosted runner execution;
- actual `workflow_dispatch` platform wiring;
- the concrete production/staging AssetPublisher backend;
- remote-resource-policy integration with real external resources;
- local feature-image upload behavior in the target deployment;
- production Ghost behavior;
- the remote endpoint's staging identity beyond the explicitly supplied URL/credentials;
- merge safety by itself.

Those remain separate proof obligations.

## Workflow evidence after the workflow reaches default branch

Once `.github/workflows/article-ghost.yml` exists on default `main`, collect separate operational evidence using the real manual workflow against an authorized non-production target before relying on it for production operations.

The workflow itself additionally fresh-reads `refs/heads/main` through the GitHub API:

1. before checkout, to reject a dispatch that became stale in the queue;
2. again immediately before the selected Article operation, to reject a main advancement during tests/validation.

These are observational client-side concurrency guards. They reduce stale-canonical-source races but cannot make a Git ref update and external Ghost mutation one atomic distributed transaction. If main changes after the final observation while a Ghost operation is already executing, later projection recovery/audit must treat the new main as the new canonical source and derive current/outdated state accordingly.
