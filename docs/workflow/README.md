# Content workflow contract

Contract version: **1**

This directory is the durable operating contract for agent-operated `ox0-blog` work. Account memory and prior chat context are conveniences only; they are not policy authority.

Before Article, translation, RTA-integration, Git/PR, or publication work, read:

1. `AGENTS.md`
2. `docs/workflow/responsibilities.md`
3. `docs/workflow/state-machines.md`
4. `docs/workflow/integrations.md`
5. `docs/workflow/git-policy.md`

Then recover the current repository/Article/RTA/PR state before mutating anything.

## Canonical ownership

- `ox0-blog` owns public Article source, locale variants, translation synchronization, Article Git history, compiler validation, and Ghost projection.
- `research-to-action` owns research/evidence/decision provenance and project-promotion rationale.
- Conversation is the normal interactive control surface. It is not a durable source of truth by default.
- Production publication requires explicit authorization unless a separately approved automation policy exists.

## State-model ownership

The durable docs implement the orthogonal state-machine design owned by issue #7 and the fresh-session bootstrap/governance requirements owned by issue #8.

Keep the machines separate:

- Article content readiness;
- translation synchronization;
- Git/PR work-unit state;
- per-locale Ghost projection state;
- RTA lifecycle under RTA's own authority.

Conversation remains an intent/event control surface rather than a persistent lifecycle object.

## Core workflow principle

The normal user interface is intent-level language such as:

```text
"이 대화 블로그 글로 만들어"
"RTA에 남겨"
"지난 글 업데이트해"
"이 RTA들로 글 써"
"merge 준비해"
"merge해"
"발행 준비해"
"발행해"
```

The agent owns routine document editing, translation synchronization, reviewed checkpoints, branch/commit/PR mechanics, validation, dry-run, and authorized Ghost mutation.

`merge 준비해` and similar preparation/review requests do not authorize merge. Strict exact-HEAD merge judgment begins only when the active task explicitly asks to merge or explicitly asks to begin merge judgment.

## Fresh-session recovery protocol

A fresh session must recover state from durable authorities before mutation instead of reconstructing policy from memory.

For a Blog/RTA task:

1. classify the requested edge/event (`Conversation -> Blog`, `Conversation -> RTA`, `RTA -> Blog`, etc.);
2. resolve the target Article/RTA item/work unit from explicit stable references first;
3. read canonical `main` source for the target Article when it exists;
4. inspect any active Article PR/work branch that may own the requested change;
5. derive translation state from required locales + current fingerprints + the checkpoint on the source being evaluated;
6. recover RTA state only from the RTA repository authority when RTA is involved;
7. fresh-read Ghost only when projection/publication state is relevant;
8. apply the operation guards from `state-machines.md` and the Git policy before mutation.

Do not use a rendered Ghost post as the canonical editing source when repository source exists. Do not use an RTA lifecycle label as Blog authorization. Do not use a remembered prior-session state when a durable source can be re-read.

### Target resolution

Prefer, in order:

1. explicit immutable Article/variant ID or explicit RTA issue reference;
2. explicit repository path/slug/title when it resolves uniquely;
3. an active PR/work unit that unambiguously owns that same Article/change;
4. other durable provenance links that resolve to exactly one owner.

Do **not** guess from recency alone when multiple Articles/issues/work units are plausible. If durable evidence still leaves more than one materially plausible target, ask only for the target identity/semantic choice; do not ask the user to perform Git or repository discovery.

A request such as `지난 글 업데이트해` is executable without a question only when the durable/current context identifies one intended Article. In a truly context-free ambiguous session, one minimal target-identification question is the correct fail-closed behavior.

### Authority precedence while work is in progress

Different machines intentionally observe different authorities:

- canonical production/source relationship is evaluated against the canonical source version designated by repository policy, normally merged `main`;
- an active branch/PR is the authority for that **work unit's candidate source**, translation review, and candidate checkpoint;
- GitHub is authoritative for branch/PR/merge state;
- Ghost must be fresh-read for projection state before any write;
- RTA repository state is authoritative for RTA lifecycle.

An unmerged branch edit must **not** by itself mark the currently published Ghost projection `OUTDATED`; it means a new Blog work unit exists. Projection becomes outdated only when the canonical production source relation changes under the projection-state contract.

## Intent-to-operation boundaries

Natural-language commands map to operations, but no command bypasses guards.

### `PREPARE_MERGE`

Examples: `merge 준비해`, `merge 가능한지 봐`.

The agent may validate, reconcile, and establish/refresh a coherent `CANDIDATE`. It does not enter strict exact-HEAD merge judgment and does not merge.

### `MERGE`

Examples: `merge 판단 들어가`, `merge해`.

This explicitly permits entering `MERGE_REVIEW`; `merge해` also authorizes the squash merge only if every exact-HEAD proof obligation passes. A failed/unknown gate remains blocked.

### `PREPARE_PUBLISH`

Example: `발행 준비해`.

This is **read-only with respect to Ghost by default**. The agent validates canonical source/translation/assets, fresh-reads Ghost, checks identity/collision/drift, and produces a fresh `PublicationPlan`. It must not create/update a Ghost draft or publish merely as a side effect of preparation.

A Ghost draft mutation requires a task that actually authorizes draft projection (for example, an explicit request to create/update a Ghost draft). It is still not production publication.

### `PUBLISH`

Example: `발행해`.

This is explicit production-publication authorization for the intended Article operation, subject to all source, translation, identity, drift, and publication guards. For multiple locale projections, success is established per variant and then aggregated; partial success is recovered from fresh Ghost reads and is never reported as whole-Article publication success.

Authorization is not a substitute for validation. A stale plan, changed canonical source, changed Ghost state, or unresolved reconciliation condition requires re-planning/re-validation before the write.

## Current implementation vs target architecture

Current authoring work may still contain transitional one-file `:::lang` and body-image behavior. Issues #3, #4, #5, #6, #7, and #8 define the target Article/LocaleVariant, compiler, integration, state-machine, and bootstrap architecture. Do not extend transitional mechanisms into new long-term contracts without reconciling those issues first.

## Fail-closed bootstrap

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess. Preserve current durable state and report the policy conflict before mutation.
