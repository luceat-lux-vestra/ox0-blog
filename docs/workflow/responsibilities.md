# Responsibilities

## User responsibilities

The user normally owns only:

- intent, topic, direction, and desired outcome;
- personal/domain facts unavailable to the agent;
- decisions where meaning, privacy, or publication intent is genuinely ambiguous;
- explicit merge / merge-judgment authorization when a work unit is to leave development and enter the strict exact-HEAD merge gate;
- explicit production publication authorization, unless a separately approved automation policy exists; the reviewed Article PR merge lifecycle is such an approved policy.

The user is not expected to manage repository mechanics.

`merge 준비해`, validation, review, or ordinary PR preparation do not authorize merge. An explicit `merge해` may authorize both entering merge judgment and the final merge if every exact-HEAD proof obligation passes.

Production publication is a separate boundary by default. `발행해` does not implicitly authorize a pending Git merge. For an Article PR governed by the approved publication lifecycle, however, an explicit `merge해` followed by exact-HEAD PASS and successful squash merge authorizes publication of that exact affected merged source.

## Agent responsibilities

The agent normally owns:

- recovering relevant Conversation, Article, RTA, and PR context;
- current public-source verification where facts may have changed;
- drafting and editing Article content;
- Korean/English locale synchronization;
- a logically separate translation-equivalence review pass;
- translation fingerprint/checkpoint maintenance;
- asset/provenance handling;
- RTA duplicate search and routing when justified and authorized;
- branch, commit, rebase/restack, PR, and conflict mechanics;
- validation, CI/review evidence, dry-run, candidate preparation, and merge-gate execution after authorization;
- authorized Ghost draft/publish mechanics and persisted-state verification.

## Escalation rule

Do not ask the user to perform mechanical work merely because it is tedious or stateful. Ask only when a material decision cannot be safely inferred, for example:

- which durable Article/RTA target is intended when several remain materially plausible after repository recovery;
- whether company/private information may be published;
- which of two materially different claims the user intends;
- whether a knowingly divergent locale variant is acceptable;
- whether strict merge judgment/merge is authorized when the active task has not authorized it;
- whether production publication is authorized, unless the exact operation is covered by the approved reviewed-merge publication automation.

If a required external capability is unavailable, report the exact missing capability rather than handing Git/document mechanics back to the user.

## Translation responsibility

A production-oriented semantic edit to one required locale normally implies sibling-locale synchronization by the agent. The user does not need to separately request translation maintenance.

Generation and acceptance remain separate logical passes:

```text
edit / translate
    -> deterministic stale state
    -> equivalence review
    -> checkpoint advance only on PASS
```

Material ambiguity leaves the Article in review-required state.

## Conversation responsibility

Conversation is an instruction and reasoning surface. Raw chat transcripts are not copied into Git/RTA by default. When durable mutation is requested, the agent extracts the thesis, evidence, decisions, and public-safe material needed by the target system.
