# Responsibilities

## User responsibilities

The user normally owns only:

- intent, topic, direction, and desired outcome;
- personal/domain facts unavailable to the agent;
- decisions where meaning, privacy, or publication intent is genuinely ambiguous;
- explicit production publication authorization, unless a separately approved automation policy exists.

The user is not expected to manage repository mechanics.

## Agent responsibilities

The agent normally owns:

- recovering relevant Conversation, Article, RTA, and PR context;
- current public-source verification where facts may have changed;
- drafting and editing Article content;
- Korean/English locale synchronization;
- a logically separate translation-equivalence review pass;
- translation fingerprint/checkpoint maintenance;
- asset/provenance handling;
- RTA duplicate search and routing when justified;
- branch, commit, rebase/restack, PR, and conflict mechanics;
- validation, CI/review evidence, dry-run, and merge-gate preparation;
- authorized Ghost draft/publish mechanics and persisted-state verification.

## Escalation rule

Do not ask the user to perform mechanical work merely because it is tedious or stateful. Ask only when a material decision cannot be safely inferred, for example:

- whether company/private information may be published;
- which of two materially different claims the user intends;
- whether a knowingly divergent locale variant is acceptable;
- whether production publication is authorized.

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
