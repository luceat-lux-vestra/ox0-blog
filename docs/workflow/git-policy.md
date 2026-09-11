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

## Candidate vs merge judgment

A coherent PR may become `CANDIDATE` without entering strict merge judgment.

`CANDIDATE` means:

- the work unit is stable enough that merge review could begin;
- exact candidate HEAD/base can be identified;
- normal validation/review feedback has reached a coherent checkpoint;
- but exact-HEAD merge evidence is **not yet treated as final proof**.

Do **not** enter `MERGE_REVIEW`, and do not merge, unless the active user/task instruction explicitly asks to merge or explicitly asks to begin merge judgment.

Examples:

```text
"merge 준비해"         -> prepare/refresh CANDIDATE only
"merge 판단 들어가"    -> enter MERGE_REVIEW
"merge해"              -> enter MERGE_REVIEW and merge only if every gate PASS
```

A request to review, validate, update, or prepare a PR is not merge authorization.

## Strict merge judgment

When explicit merge judgment begins, exact final HEAD becomes the evidence unit.

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

`UNKNOWN`, `UNVERIFIED`, or `INSUFFICIENT EVIDENCE` is FAIL at merge judgment.

If HEAD moves after strict merge judgment begins:

1. invalidate all exact-HEAD evidence from the prior HEAD;
2. return the work unit to normal development (`ACTIVE`);
3. establish a new coherent `CANDIDATE` before re-entering exact-HEAD review.

If the exact HEAD does not move but a required proof is missing/failing, remain blocked from merge. Evidence may be gathered for the same HEAD; source-changing fixes return the work unit to development.

## Merge

Use squash merge according to repository policy. When the API supports it, lock merge to the exact reviewed final HEAD with `expected_head_sha=<exact reviewed final HEAD>`.

A merge may be performed only when:

- the active task authorizes merge;
- the work unit is in exact-HEAD merge review;
- every required proof obligation is PASS;
- no unresolved review/semantic question remains;
- mergeability and live repository rules/contexts PASS.

Post-merge, verify the expected canonical result rather than assuming the merge response is sufficient. Verify the resulting main SHA/tree/parent/signature/evidence applicable to the repository.

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

The user-facing distinction should remain simple:

- ordinary authoring/update request -> agent develops and prepares the PR;
- merge preparation -> agent makes a coherent candidate but does not merge;
- explicit merge/merge-judgment request -> agent may run the strict exact-HEAD gate and merge only on PASS;
- production publication -> separate explicit authorization boundary.

Production publication is not a Git merge side effect. A merged Article may remain unprojected/outdated until explicit publication authorization and Ghost guards pass.
