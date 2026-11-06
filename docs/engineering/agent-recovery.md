# Crash-Recoverable Agent Work

This document defines repository-operation recovery after an agent session, connection, harness, or process interruption in `luceat-lux-vestra/ox0-blog`.

Existing repository-specific content, publication, review, CI, merge, release, and privacy policy remains authoritative.

## Authority

Use this order for execution recovery:

1. current GitHub execution state;
2. current repository policy;
3. the active Issue checkpoint;
4. session/conversation memory.

GitHub is authoritative for Issues, refs, commit SHAs, pull requests, checks/workflows, reviews/threads, merge state, and the default branch. The checkpoint is a resume hint and never overrides current GitHub state.

## Durable checkpoint

For recoverable work, maintain one mutable owning-Issue comment marked:

```text
<!-- agent-resume-checkpoint:v1 -->
```

Use:

```yaml
schema: agent-resume/v1
repository: luceat-lux-vestra/ox0-blog
work_item: <issue-number>
work_unit: <stable-logical-id>
phase: selected | implementation-durable | pr-open | validating | merge-ready | merged | housekeeping | done
branch: <branch-or-null>
pr: <pr-number-or-null>
expected:
  branch_head: <sha-or-null>
  pr_head: <sha-or-null>
  base: main
last_verified:
  at: <timestamp>
  authority: github
next_safe_action: <short-semantic-action>
last_mutation:
  kind: <operation-or-none>
  outcome: verified | unknown | none
stop_condition: <repository-policy stop condition>
```

Do not store the mutable checkpoint in a production branch and do not mirror volatile CI/publication state in it.

Normal durable boundaries are: work selected, candidate ref verified, PR verified, final candidate HEAD established, merge verified, post-merge/publishing housekeeping verified, done.

Do not intentionally leave checkpoints stale during normal work. Staleness is a recovery condition caused by interruption, lost response, concurrent movement, or failed checkpoint write.

## Resume protocol

Before mutating interrupted work:

```text
read policy
-> discover open production PRs
-> identify owning Issue/checkpoint
-> fresh-read branch/PR/HEAD/base
-> read checks/reviews/publication state when decision-relevant
-> compare checkpoint with GitHub
-> classify
-> derive exactly one safe next action
```

Classify as `MATCH`, `CHECKPOINT_STALE_BUT_RECONCILABLE`, `EXTERNAL_STATE_MISSING_RETRYABLE`, `CONFLICT`, or `UNKNOWN`.

`UNKNOWN / UNVERIFIED / INSUFFICIENT EVIDENCE = FAIL` when material to the next mutation, publication, or merge decision.

## Mutation protocol

Every material external mutation follows:

```text
fresh precondition read
-> bounded mutation
-> authoritative read-back
-> classify postcondition
-> checkpoint after verified postcondition
```

If a response/session is lost, never replay a mutation only because the checkpoint is behind. Re-read authority first.

For create operations, search/read before retrying. For ref movement, re-read and record the verified SHA. For merge, pin the reviewed HEAD when supported and re-read PR/main before retrying an unknown outcome.

This recovery protocol does not weaken this repository's source/publication/privacy gates or authorize publishing merely because a checkpoint says it is next.

## Exact-HEAD evidence

Current PR HEAD is authoritative. Any HEAD movement invalidates prior HEAD-specific CI/review/publication-precondition evidence unless repository policy explicitly permits same-SHA reuse. Branch-history cleanup or another rewrite therefore requires fresh evidence for the new exact final HEAD.

## Base advancement with unchanged HEAD

This section clarifies evidence provenance when the PR HEAD is unchanged but `main` advances. It does not weaken ox0-blog's exact-HEAD rule, live merge gate, task-scoped merge authorization, content/publication/privacy gates, or publication authority boundaries.

Classify movement before deciding what prior evidence still proves:

1. **PR HEAD moved** — prior HEAD-specific CI/review/publication-precondition evidence is invalid. Validate the new exact final HEAD.
2. **PR HEAD unchanged; base unchanged** — apply the ordinary exact-HEAD merge gate when the current active task authorizes merge judgment.
3. **PR HEAD unchanged; base advanced** — prior evidence may still support claims that depend only on the unchanged HEAD, but it does not by itself prove the newly composed base+HEAD result or authorize merge.
4. **Material authority, semantic/publication interaction, or current resource state is unavailable or `UNKNOWN`** — fail closed and refresh/revalidate or re-plan as required.

Before relying on same-HEAD evidence after base advancement, fresh-read the current PR HEAD, `main`, merge-base, live ruleset, required checks, review threads, mergeability, and any publication-specific state material to the change. Determine whether the evidence was produced for the unchanged HEAD itself or for an old synthetic merge/base+HEAD composition.

For ox0-blog specifically, the live `Protect main` ruleset requires the GitHub Actions `Merge Gate` with strict required-status-check enforcement. `AGENTS.md` and `docs/workflow/git-policy.md` also make merge/merge-judgment authorization task-scoped and keep publication authorization separate except for the approved reviewed-Article merge-publication lifecycle. Those stricter requirements remain authoritative. Same-HEAD evidence reuse therefore never authorizes an out-of-date or otherwise invalid current composition and never revives expired merge or publication authority.

Evidence reuse is claim-scoped, not blanket merge or publication authorization:

- exact-HEAD evidence may remain useful when its producer and claim are independent of the base movement;
- evidence tied to an old synthetic merge result or old base+HEAD tree is not proof for the newly composed tree;
- different filenames alone do not establish semantic independence;
- Article/locale identity, translation/readiness fingerprints, claim-proof and public-sanitization evidence, shared semantic assets, workflow/publication policy, dependency/tooling changes, generated publication metadata, and merge-publication lifecycle behavior require revalidation when material;
- a prior PublicationPlan, host/resource approval, or Ghost projection snapshot is not durable mutation authority merely because PR HEAD is unchanged; if source, resource target, host-policy evidence, Ghost state, or task/session authority changed, re-plan/fresh-read before any new publication write;
- recovered Git/PR/checkpoint state does not reconstruct task-scoped merge authorization after task/session loss;
- conflicts, changed required checks, policy/ruleset drift, or unresolved material semantic/publication interaction require fresh validation rather than reuse.

If bringing the branch up to date, rebasing, conflict resolution, history cleanup, content regeneration, or any other action changes the PR HEAD, the resulting SHA becomes a new exact-HEAD proof unit and all prior HEAD-specific PASS evidence is invalid.

Do not change CI workflows, `.github/repository-policy.json`, Article/publication lifecycle policy, claim-proof/public-sanitization requirements, Ghost state, publication plans/resource targets, or live rulesets merely to make prior evidence reusable.

## Failure handling

- Read-only interruption: fresh-read and continue.
- Local-only/unpushed edits: not recoverable from GitHub.
- Lost response after remote mutation: infer outcome from authority.
- Stale checkpoint/HEAD movement: current GitHub state wins after ownership is proven.
- Concurrent actor: no last-write-wins assumption.
- Partial multi-step work: recover existing objects and complete only missing steps.
- Async CI/review/publication changes: read current evidence for current HEAD/state.
- Authority unavailable or ownership ambiguous: fail closed.
- Missing/corrupt checkpoint: reconstruct only when one work unit is unambiguous.

## Post-merge and privacy

Merged is not done. Complete required main/post-main verification and repository publication/status housekeeping, checkpoint `done`, then stop under repository policy.

Checkpoint content must follow repository visibility/privacy rules. Never store credentials, tokens, hidden reasoning, raw private prompts/transcripts, personal secrets, confidential data, or unrelated private provenance.
