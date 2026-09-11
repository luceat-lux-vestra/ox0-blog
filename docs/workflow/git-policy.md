# Git policy for Article work

## Work unit

Use one branch and one PR per logical Article work unit, not one per locale.

Examples:

```text
article/new-proof-obligation-review
article/update-proof-obligation-conclusion
article/refresh-arkst-analysis
```

If an active branch/PR already clearly owns the requested Article change, continue it instead of creating branch spam. Otherwise start from the expected fresh base.

Korean and English are separate locale variants but normally belong to the same Article-level change transaction.

## Development phase

Normal branch/HEAD movement is allowed.

Preferred flow:

```text
implement/edit
  -> meaningful commit
  -> validation/review feedback
  -> fix commits as needed
  -> logical candidate checkpoint
```

Rules:

- do not restart the complete merge proof after every development commit;
- do not force one commit at the cost of complicated Git object manipulation;
- do not restack stacked PRs after every upstream edit;
- rebase/restack at meaningful candidate points, conflict resolution, or before merge judgment;
- keep commits few and meaningful, but squash merge is the final history boundary.

## Candidate / merge judgment

When work enters `CANDIDATE`, exact final HEAD becomes the evidence unit.

Before merge, verify against the exact final HEAD at minimum:

- fresh expected base/main and merge-base;
- exact diff, changed files, and ownership;
- Article/variant identity and translation checkpoint validity;
- compiler/source validation;
- required CI and raw job evidence;
- failure/recovery/regression/compatibility/edge/adversarial cases relevant to the change;
- review status and unresolved threads;
- live rules/required contexts and mergeability;
- publication-specific live evidence when the change affects Ghost contracts.

UNKNOWN, UNVERIFIED, or INSUFFICIENT EVIDENCE is FAIL at merge judgment.

If HEAD moves after strict merge judgment begins, invalidate exact-HEAD evidence and return the Git work state to `ACTIVE`.

## Merge

Use squash merge according to repository policy. When the API supports it, lock merge to the exact reviewed final HEAD (`expected_head_sha`).

Post-merge verify the expected canonical result rather than assuming the merge response is sufficient.

## Article changes and translation

A normal production-oriented Article change should include required locale synchronization in the same logical work unit. It does not require one commit per locale.

The checkpoint must describe the reviewed current variants, not an intermediate branch state.

If another branch/main changes the same Article or a shared semantic asset:

1. stop silent overwrite;
2. recover both changes;
3. reconcile meaning/ownership;
4. recompute translation fingerprints;
5. rerun equivalence review;
6. continue on a reconciled branch.

## User interface

Do not ask the user to create branches, stage files, rebase, resolve ordinary Git conflicts, or run checkpoint commands. Report Git details only when they affect correctness, authorization, or a material decision.

Production publication is not a Git merge side effect. A merged Article may remain unprojected/outdated until explicit publication authorization and Ghost guards pass.
