# Workflow state machines

Contract version: **1**

Persistent state machines are intentionally separate. Do not infer publication from source readiness, or source readiness from Git/PR status.

---

## 1. Article content readiness

States:

```text
DRAFT
  -> REVIEW_REQUIRED
  -> READY
```

`READY` means the canonical Article source is internally ready for merge/publish preparation. It does **not** mean merged or published.

### Transitions

| From | Event | Preconditions | Agent action | To | User input? |
|---|---|---|---|---|---|
| DRAFT | content work reaches reviewable shape | required source exists | validate content and locale state | REVIEW_REQUIRED | no |
| REVIEW_REQUIRED | content/translation/research review PASS | all material questions resolved | record reviewed state/checkpoints | READY | normally no |
| REVIEW_REQUIRED | material ambiguity remains | cannot safely infer intent | preserve unresolved item | REVIEW_REQUIRED | yes, only for unresolved decision |
| READY | translation-relevant or factual source changes | source changed | invalidate readiness and rerun review | REVIEW_REQUIRED | no |
| READY | provenance/evidence materially weakens a relied-on claim | source may be unchanged | audit affected claim against current evidence | REVIEW_REQUIRED | no |
| READY | non-semantic projection/Git metadata changes | Article content/evidence unaffected | no Article transition | READY | no |

A new Article starts in `DRAFT`.

A provenance-driven transition to `REVIEW_REQUIRED` does **not** by itself make the Ghost projection outdated. If audit concludes no Article change is required, the Article can return to `READY` while the existing projection remains current. If source changes, projection state is then recomputed separately.

---

## 2. Translation synchronization

This state is derived from current translation-relevant fingerprints and the last reviewed-equivalence checkpoint.

States:

```text
UNREVIEWED
INCOMPLETE
SYNCED
STALE(changed_locales, stale_locales)
REVIEW_REQUIRED
```

For the current two-locale policy, `STALE` may be presented as `EN_STALE` or `KO_STALE`; the durable model should remain set-based so more locales can be supported later.

### Diagram

```text
             first complete variants
UNREVIEWED ------------------------------> REVIEW_REQUIRED
                                               |
                                               | equivalence PASS
                                               | checkpoint
                                               v
                                            SYNCED
                                              |
                         edit one locale       |
                                              v
                                             STALE
                                              |
                         update sibling locale |
                                              v
                                      REVIEW_REQUIRED
                                              |
                              equivalence PASS |
                                              v
                                            SYNCED

missing required locale -> INCOMPLETE
```

### Transitions

| From | Event | Preconditions | Deterministic effect | Agent semantic action | To | User input? |
|---|---|---|---|---|---|---|
| UNREVIEWED | all required locales exist | fingerprints computable | no checkpoint yet | equivalence review | REVIEW_REQUIRED | normally no |
| any | required locale missing | configured required locale absent | mark missing set | none | INCOMPLETE | no |
| INCOMPLETE | missing locale created | all required locales now exist | compute fingerprints | equivalence review | REVIEW_REQUIRED | no |
| SYNCED | exactly one locale changes | one fingerprint differs from checkpoint | compute changed/stale sets | update sibling locale | STALE | no |
| SYNCED | multiple locales/shared semantic asset change | multiple translation fingerprints differ | keep old checkpoint | equivalence review | REVIEW_REQUIRED | no |
| STALE | stale sibling updated | multiple current fingerprints now differ from checkpoint | keep old checkpoint | equivalence review | REVIEW_REQUIRED | no |
| REVIEW_REQUIRED | review PASS | compiler/validation PASS; no material ambiguity | atomically advance checkpoint | none | SYNCED | no |
| REVIEW_REQUIRED | review FAIL/UNCERTAIN | material mismatch/ambiguity exists | checkpoint unchanged | resolve content or escalate decision | REVIEW_REQUIRED | only if necessary |
| SYNCED | deployment-only metadata changes | translation fingerprint unchanged | no effect | none | SYNCED | no |

The same agent may translate and review, but those are distinct passes. Editing both locale files never implies `SYNCED` by itself.

Production publication requires `SYNCED` for all required locales under v1 policy.

---

## 3. Git / PR work state

Git work state is **per logical work unit**, not a permanent global Article state.

States:

```text
IDLE
ACTIVE
CANDIDATE
CONFLICTED
MERGED
```

### Diagram

```text
IDLE -> ACTIVE -> CANDIDATE -> MERGED
           ^          |
           |          v
           +------ CONFLICTED
```

### Meaning

- `IDLE`: no active branch/PR currently owns the requested Article change.
- `ACTIVE`: branch/PR exists and development may move HEAD normally.
- `CANDIDATE`: development slice is stable enough to begin strict exact-HEAD merge judgment.
- `CONFLICTED`: base/current ownership changed and semantic reconciliation is required.
- `MERGED`: this work unit's canonical source change is on `main`.

A later Article change starts a new work unit from `IDLE`; it does not mutate the historical `MERGED` work unit back to `ACTIVE`.

### Transitions

| From | Event | Preconditions | Agent action | To | User input? |
|---|---|---|---|---|---|
| IDLE | requested durable Article change | no suitable active owner | branch from fresh expected base | ACTIVE | no |
| ACTIVE | meaningful implementation/review checkpoint | current work coherent | validate diff; optionally compact/rebase once | CANDIDATE | no |
| CANDIDATE | HEAD changes | fix required | invalidate exact-HEAD evidence | ACTIVE | no |
| ACTIVE/CANDIDATE | same Article/shared asset changed elsewhere | stale/conflicting ownership | reconcile semantics, fingerprints, and base | CONFLICTED | normally no |
| CONFLICTED | reconciliation complete | no unresolved ownership conflict | continue work | ACTIVE | no |
| CANDIDATE | strict merge gate PASS + authorized merge | exact final HEAD proven | squash merge with reviewed HEAD lock when supported | MERGED | normally no |

Development-phase CI/review is feedback. Strict proof obligations begin at `CANDIDATE` merge judgment; a later HEAD change returns the current work unit to `ACTIVE`.

---

## 4. Ghost projection state

This state tracks the relationship between canonical Git source and managed Ghost content. It is independent from Git merge and Article readiness.

States:

```text
NOT_PROJECTED
DRAFT_CURRENT
PUBLISHED_CURRENT
OUTDATED
DRIFTED
```

`dry-run`/planning is an **operation/result**, not a projection state. Running a dry-run must not erase whether Ghost is currently published, draft, absent, outdated, or drifted.

### Diagram

```text
NOT_PROJECTED ---- draft write ----> DRAFT_CURRENT
      |                                  |
      | publish                          | publish
      v                                  v
PUBLISHED_CURRENT <-----------------------+
      |
      | canonical managed source changes
      v
   OUTDATED

managed Ghost drift / ownership ambiguity -> DRIFTED
```

### Meaning

- `NOT_PROJECTED`: no managed Ghost projection exists.
- `DRAFT_CURRENT`: managed Ghost draft matches the recorded/current canonical projection fingerprint.
- `PUBLISHED_CURRENT`: managed public Ghost post matches the recorded/current canonical projection fingerprint.
- `OUTDATED`: a managed projection exists but canonical managed source is newer/different.
- `DRIFTED`: Ghost managed state/identity/collision differs from what the publisher can safely reconcile automatically.

### Dry-run plan

A dry-run produces an ephemeral `PublicationPlan` bound to the observed source fingerprint/identity and observed Ghost state. It does **not** transition projection state. The plan is stale and must be recomputed if relevant source or Ghost state changes before mutation.

### Transitions

| From | Event | Preconditions | Agent action | To | User input? |
|---|---|---|---|---|---|
| any non-drifted state | dry-run | source/translation validation PASS | read Ghost; emit bounded plan; no write | unchanged | no |
| NOT_PROJECTED/OUTDATED | explicit draft projection | current plan/mutation guards PASS | write managed Ghost draft and fresh-read verify | DRAFT_CURRENT | explicit mutation instruction may be required by task |
| NOT_PROJECTED/DRAFT_CURRENT/OUTDATED | explicit `발행해` | Article READY; translation SYNCED; publication/identity gates PASS | publish and verify persisted managed state | PUBLISHED_CURRENT | **yes: publication authorization** |
| DRAFT_CURRENT/PUBLISHED_CURRENT | canonical managed source changes | managed source fingerprint differs from last verified projection | no Ghost write yet | OUTDATED | no |
| any managed state | Ghost drift/ownership ambiguity detected | safe automatic reconciliation not proven | stop mutation; preserve evidence | DRIFTED | possibly, for reconciliation decision |
| DRIFTED | reconciliation proves ownership/current intent | ambiguity resolved | rerun read-only plan/guards | recomputed from observed source/Ghost state | only when semantic/ownership decision is needed |

A Git merge never automatically transitions to `PUBLISHED_CURRENT`.

---

## 5. RTA lifecycle

`research-to-action` is the canonical authority for RTA states. Do not duplicate that state machine here.

Current canonical lifecycle is conceptually:

```text
CAPTURED -> RESEARCHING -> APPLICABLE -> NEEDS_EVIDENCE -> READY -> PROMOTED
```

with its repository-defined side/terminal states.

Blog events do not automatically change RTA state. RTA state changes do not automatically change Article/Ghost state.

---

## 6. Conversation event model

Conversation is normally transient control context, not a persistent state machine.

Recognized intent-level events include:

```text
CREATE_ARTICLE
UPDATE_ARTICLE
AUDIT_ARTICLE
CAPTURE_RTA
UPDATE_RTA
SYNTHESIZE_RTA_TO_ARTICLE
EXTRACT_ARTICLE_TO_RTA
PREPARE_PUBLISH
PUBLISH
```

The agent maps natural-language requests onto one or more events and then applies the durable state machines above.

Examples:

```text
"이 대화 블로그 글로 만들어"
  -> CREATE_ARTICLE

"RTA #8, #22로 글 써"
  -> SYNTHESIZE_RTA_TO_ARTICLE

"지난 글 최신 근거 반영해"
  -> AUDIT_ARTICLE + UPDATE_ARTICLE

"발행해"
  -> PUBLISH
```

Conversation events do not bypass repository authorization, validation, translation, merge, or publication guards.

---

## 7. Typical combined states

The machines form a product state. These examples show why they stay separate.

| Situation | Article | Translation | Git work | Ghost projection |
|---|---|---|---|---|
| new bilingual draft in progress | DRAFT/REVIEW_REQUIRED | UNREVIEWED/REVIEW_REQUIRED | ACTIVE | NOT_PROJECTED |
| source ready in PR, not merged | READY | SYNCED | CANDIDATE | prior projection state unchanged |
| merged but not yet published | READY | SYNCED | MERGED | NOT_PROJECTED or OUTDATED |
| fully current public Article | READY | SYNCED | MERGED for latest work unit | PUBLISHED_CURRENT |
| RTA evidence weakens a published claim, audit not finished | REVIEW_REQUIRED | SYNCED | IDLE or ACTIVE | PUBLISHED_CURRENT |
| Korean update being translated | REVIEW_REQUIRED | STALE | ACTIVE | previous projection may remain PUBLISHED_CURRENT until canonical source changes/merges |
| Ghost edited outside managed workflow | Article state unchanged | translation state unchanged | Git state unchanged | DRIFTED |

No single state value is allowed to collapse these independent facts.
