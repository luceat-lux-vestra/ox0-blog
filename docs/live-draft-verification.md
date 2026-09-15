# Exact-candidate Article live draft verification

This document defines the live-evidence path for the target Article draft synchronization semantics without requiring a separate Ghost staging environment.

The verifier is intentionally **draft-only**. It may use the real personal-blog Ghost instance because it never requests `published` status.

```bash
npm run verify:article-live-draft
```

## Required inputs

```text
OX0_ARTICLE_DRAFT_VERIFY=1
OX0_ARTICLE_SOURCE_SHA=<exact current git HEAD>
OX0_ARTICLE_EXPECTED_URL=<exact Ghost Admin base URL>
GHOST_ADMIN_URL=<same exact Ghost Admin base URL>
GHOST_ADMIN_API_KEY=<authorized Ghost Admin key>
```

The verifier additionally requires:

- the current Git HEAD to exactly equal `OX0_ARTICLE_SOURCE_SHA`;
- a completely clean tracked/untracked worktree;
- exact normalized equality between `GHOST_ADMIN_URL` and `OX0_ARTICLE_EXPECTED_URL`;
- credential-free HTTPS Ghost URLs without query/fragment;
- no `OX0_HOST_RUNTIME_MODULE` for the base verifier.

`OX0_ARTICLE_EXPECTED_URL` is an operator double-entry guard against accidentally targeting a different Ghost instance. It is not remote-service attestation.

Do not print or persist the Admin key in logs, issues, PR bodies, or evidence summaries.

## What it verifies

The verifier creates a unique temporary bilingual Article under `posts/`, uses the normal target review operations to reach:

```text
translation = SYNCED
readiness   = READY
```

It then performs only:

```text
Article draft synchronization
    -> fresh per-locale DRAFT_CURRENT recovery
    -> ownership/state verification
    -> cleanup
```

There is deliberately **no production publication authorization, publish plan, or `published` mutation** in this verifier.

The temporary fixture is text-only, so the base verifier does not exercise deployment-specific AssetPublisher, remote-resource-policy, or feature-image behavior.

## Cleanup

The verifier uses random Article/variant IDs and slugs and first proves its namespace is unused.

On success or failure after namespace ownership is established, cleanup:

1. uses known post IDs when available;
2. otherwise recovers by stable per-variant projection identity;
3. requires exact title/slug/identity ownership before deletion;
4. may remove an accidentally published verifier-owned post only as failure cleanup, never as a successful verification state;
5. deletes posts by ID and verifies persisted absence;
6. never deletes shared `#ox0-locale-*` tags;
7. deletes other observed verifier/publisher tags only when exact tag ID/name still match and the tag is unreferenced;
8. fresh-reads temporary slugs/source identities/non-shared identity tags and requires the verifier namespace to be absent;
9. removes the temporary Article directory;
10. requires the checkout to be clean again.

Ambiguous or changed ownership fails cleanup closed instead of deleting by slug or guessing ownership.

## Evidence scope

A PASS supports only these claims for the exact verified candidate SHA and the specified Ghost instance:

- target Article review/checkpoint reconstruction reaches `SYNCED + READY`;
- two managed locale drafts can be created;
- both recover as `DRAFT_CURRENT`;
- stable ownership permits bounded cleanup without touching unrelated content;
- cleanup leaves no verifier-owned post/identity residue detectable by the verifier.

A PASS does **not** prove:

- production `draft -> published` promotion;
- GitHub `workflow_dispatch` platform wiring;
- GitHub-hosted runner execution;
- AssetPublisher/backend integration;
- remote-resource-policy behavior;
- local feature-image deployment;
- merge safety by itself.

Production publication remains a separate explicit user-authorized operation. The target manual workflow restricts that final step to exact-current managed drafts and status-only promotion; the live draft verifier does not execute it merely for evidence collection.
