# Workflow state machines

Contract version: **1**

The workflow is a product of independent state dimensions. Do not infer publication from source readiness, source readiness from Git state, or RTA lifecycle from Blog state.

For persistent transitions, use this contract shape:

```text
from
  -> event
  -> guard / preconditions
  -> deterministic side effects
  -> semantic / agent review
  -> to
  -> user authorization required? yes/no
```

Persist only authoritative state/evidence needed for recovery. Prefer deterministic derivation when a state can be reconstructed from canonical source, reviewed checkpoints, GitHub, fresh Ghost observations, or RTA authority.

Task-scoped authorization is not the same thing as persisted workflow state. A recovered state never grants merge or production-publication permission by itself.

---

## 1. Article content readiness

States:

```text
DRAFT
REVIEW_REQUIRED
READY
```

`READY` means the **Article source version under evaluation** has passed the current readiness contract. A branch/PR candidate may therefore be `READY`; this does not mean the source is merged or published. Production publication separately requires `READY` to be established for the canonical production source version.

A new Article starts in `DRAFT`.

### Diagram

```text
DRAFT
  | content reaches reviewable shape
  v
REVIEW_REQUIRED
  | readiness review PASS + reviewed evidence recorded
  v
READY
  | semantic/factual/relevant source or relied-on evidence changes
  +----------------------------------------------------------> REVIEW_REQUIRED
```

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| DRAFT | content reaches reviewable shape | required Article source exists | run validation inputs; preserve unresolved items | perform content/factual/privacy/provenance review as applicable | REVIEW_REQUIRED | no |
| REVIEW_REQUIRED | readiness review PASS | required locales exist; translation `SYNCED`; compiler/source/assets validation PASS; no unresolved material question | atomically record/refresh versioned readiness evidence for the exact reviewed source | confirm material claims, intent, privacy, provenance and public treatment | READY | normally no |
| REVIEW_REQUIRED | material ambiguity remains | agent cannot safely infer intended meaning/public treatment | preserve unresolved item; do not claim readiness | ask only for unresolved material decision | REVIEW_REQUIRED | yes, only for that decision |
| READY | readiness-relevant source changes | current readiness fingerprint differs from reviewed evidence | invalidate prior readiness evidence | rerun affected semantic/factual review | REVIEW_REQUIRED | no |
| READY | relied-on provenance/evidence materially weakens or reverses | source may still be byte-identical | durably invalidate readiness when this Blog edge is authorized; do not mutate Ghost | audit affected claim against current evidence | REVIEW_REQUIRED | no for authorized audit/update work; otherwise emit a signal only |
| READY | non-semantic Git/projection metadata changes | readiness fingerprint/evidence unchanged | no Article effect | none | READY | no |
| READY | readiness evidence missing/malformed/unsupported | current READY claim cannot be reconstructed under supported contract | fail closed; preserve source; mark review needed | rerun review under supported contract | REVIEW_REQUIRED | no |

### Recovery invariant

A naked persisted `READY` enum is not sufficient evidence. Recovery must establish that:

```text
current readiness-relevant fingerprint == reviewed readiness fingerprint
AND readiness review-contract version is supported
AND no unresolved durable review-needed invalidation exists
```

The exact manifest syntax remains unfrozen, but the evidence must be durable and versioned. Do not persist hidden reasoning, model/session IDs, or volatile confidence scores as review provenance.

A provenance-driven `REVIEW_REQUIRED` transition does **not** by itself make an existing Ghost projection outdated. If source does not change, the currently published projection can remain `PUBLISHED_CURRENT` while the Article is under review.

---

## 2. Translation synchronization

Translation synchronization is **derived** from required-locale presence, current translation-relevant fingerprints, and the last reviewed-equivalence checkpoint. Persist the checkpoint, not a redundant mutable synchronization enum.

States:

```text
UNREVIEWED
INCOMPLETE(missing_locales)
SYNCED
STALE(changed_locales, stale_locales)
REVIEW_REQUIRED
```

For the current two-locale policy:

```text
STALE({ko-KR}, {en}) -> display may say EN_STALE
STALE({en}, {ko-KR}) -> display may say KO_STALE
```

The durable model remains set-based.

### Deterministic evaluation

Let `R` be required locales and `C` the locales whose current translation fingerprint differs from the accepted checkpoint.

```text
if any required locale is missing:
    INCOMPLETE(missing_locales)
else if no accepted checkpoint exists:
    UNREVIEWED
else if C is empty:
    SYNCED
else if C is a proper non-empty subset of R:
    STALE(changed_locales=C, stale_locales=R-C)
else:
    REVIEW_REQUIRED
```

`UNREVIEWED` means exactly that no accepted checkpoint exists. Complete locale files do not turn it into `SYNCED` or `REVIEW_REQUIRED` by themselves.

### Diagram

```text
missing required locale ------------------------------> INCOMPLETE

no checkpoint + all locales --------------------------> UNREVIEWED
       | equivalence PASS + checkpoint advance
       v
     SYNCED
       | some-but-not-all fingerprints change
       v
      STALE
       | remaining locale(s) change
       v
REVIEW_REQUIRED
       | equivalence PASS + checkpoint advance
       v
     SYNCED
```

### Transitions / operations

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| any | required locale missing/removed | configured required locale absent | derive missing set | none | INCOMPLETE | no |
| INCOMPLETE | missing locale created | recomputation possible | recompute fingerprints/checkpoint relation | review when production readiness is desired | derived state | no |
| UNREVIEWED | translation-relevant content/assets change | all required locales exist; still no checkpoint | recompute fingerprints; keep checkpoint absent | review may run but no automatic acceptance | UNREVIEWED | no |
| SYNCED | translation-relevant content/assets change | accepted checkpoint exists | recompute changed/stale sets | synchronize/inspect sibling locales as needed | STALE or REVIEW_REQUIRED | no |
| STALE | additional locale content/assets change | accepted checkpoint exists | recompute changed/stale sets | continue synchronization/review | STALE or REVIEW_REQUIRED | no |
| REVIEW_REQUIRED | locale content/assets change | accepted checkpoint exists | recompute changed/stale sets | continue synchronization/review | STALE or REVIEW_REQUIRED | no |
| UNREVIEWED / STALE / REVIEW_REQUIRED | equivalence review PASS | all required locales exist; compiler/source validation PASS; review covers exact current fingerprints; no material ambiguity | atomically advance checkpoint to reviewed current fingerprints/provenance | separate equivalence review confirms semantic equivalence | SYNCED | no |
| UNREVIEWED / STALE / REVIEW_REQUIRED | review FAIL/UNCERTAIN | material mismatch/ambiguity exists | checkpoint unchanged; recompute derived state | fix agentically or surface only material decision | unchanged/recomputed | only if necessary |
| SYNCED | deployment-only metadata change | translation fingerprint unchanged | no checkpoint/state effect | none | SYNCED | no |

The same agent may author/translate and review, but they are separate logical passes. Editing every locale never implies `SYNCED`. Conversely, a stale sibling need not be textually changed when a separate equivalence review proves the current variants already remain equivalent; checkpoint advancement is the acceptance operation.

Malformed checkpoints, unsupported checkpoint/review-contract versions, or non-computable fingerprints are validation errors and fail closed. They must never be coerced to `SYNCED`.

Production publication requires `SYNCED` for all required locales under v1.

---

## 3. Git / PR work-unit state

Git state is **per logical Article work unit**, not a permanent Article state. A later update creates/reuses a new current work unit rather than changing a historical merged unit back to active.

States:

```text
IDLE
ACTIVE
CANDIDATE
MERGE_REVIEW
MERGE_BLOCKED
CONFLICTED
MERGED
ABANDONED
```

### Diagram

```text
IDLE -> ACTIVE -> CANDIDATE
                  |   |
       explicit   |   | edit/rebase/fix
       merge auth |   v
                  v ACTIVE
             MERGE_REVIEW
              |       |
         FAIL |       | PASS + authorized merge
              v       v
        MERGE_BLOCKED MERGED
              |
       evidence/fix
              +------> MERGE_REVIEW or ACTIVE

ACTIVE/CANDIDATE/MERGE_REVIEW/MERGE_BLOCKED
              -> CONFLICTED -> ACTIVE

intentional discard/supersession -> ABANDONED
```

### Meanings

- `IDLE`: no current work unit owns the requested Article change.
- `ACTIVE`: normal development; branch/PR may exist and HEAD movement/fix commits are expected.
- `CANDIDATE`: coherent HEAD is ready for merge judgment, but strict exact-HEAD judgment has not begun.
- `MERGE_REVIEW`: explicit active-task merge/merge-judgment instruction exists and strict exact-HEAD proof is being evaluated.
- `MERGE_BLOCKED`: current exact-HEAD candidate failed or lacks required proof; merge prohibited.
- `CONFLICTED`: base/ownership/semantic concurrency requires reconciliation.
- `MERGED`: this work unit was squash-merged and canonical result verified.
- `ABANDONED`: this historical work unit was intentionally discarded/superseded without merge.

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| IDLE | durable Article mutation requested | no suitable active owner | create/reuse branch from expected fresh base | recover Article ownership/scope | ACTIVE | no |
| ACTIVE | coherent candidate established | work unit coherent; normal validation/review sufficiently addressed | record candidate HEAD/base boundary | assess unresolved semantic questions | CANDIDATE | no |
| CANDIDATE | edit/rebase/fix changes HEAD | development resumes | invalidate candidate-specific evidence as applicable | normal review | ACTIVE | no |
| CANDIDATE | explicit merge / merge-judgment instruction | candidate HEAD/base identified | snapshot exact HEAD/base; begin strict gate | begin proof-obligation review | MERGE_REVIEW | **yes** |
| MERGE_REVIEW | exact HEAD changes | commit/rebase/restack changes reviewed HEAD | invalidate all exact-HEAD merge evidence | return to development | ACTIVE | no additional authorization merely to continue development |
| MERGE_REVIEW | gate FAIL / UNKNOWN / UNVERIFIED / INSUFFICIENT EVIDENCE | exact HEAD unchanged | preserve failure evidence; prohibit merge | determine evidence-vs-fix path | MERGE_BLOCKED | no |
| MERGE_BLOCKED | missing evidence becomes available, same HEAD | active task still authorizes merge judgment | resume exact-HEAD obligations | review new evidence | MERGE_REVIEW | no additional authorization in same active task |
| MERGE_BLOCKED | fix/rebase/source change required | HEAD will change | invalidate prior exact-HEAD proof | develop/fix | ACTIVE | no |
| ACTIVE / CANDIDATE / MERGE_REVIEW / MERGE_BLOCKED | same Article/shared semantic asset changed elsewhere | ownership/base/current semantics cannot be safely reconciled | stop merge/mutation path; preserve both sides | reconcile meaning/ownership/fingerprints/base | CONFLICTED | normally no |
| CONFLICTED | reconciliation complete | no unresolved ownership conflict | refresh branch/base; invalidate stale evidence | rerun affected reviews | ACTIVE | no |
| MERGE_REVIEW | strict gate PASS | exact reviewed HEAD unchanged; all obligations PASS; no unresolved threads; mergeability/rules PASS; active-task merge authorization exists | squash merge with `expected_head_sha` when supported; verify resulting main | final checks already PASS | MERGED | **yes unless current instruction already authorized merge** |
| ACTIVE / CANDIDATE / MERGE_BLOCKED / CONFLICTED | intentional discard/supersession | user/task intent to abandon is established | close/mark work so it no longer owns current change | preserve useful provenance | ABANDONED | yes when intent is not otherwise explicit |

A request such as `merge해` may authorize both entering `MERGE_REVIEW` and the final merge on PASS. `merge 준비해`, review, validation, or PR preparation does not.

### Recovery and authorization

GitHub is authoritative for branch/PR/head/merge facts, but **merge authorization is task-scoped**. Recovering a PR that was previously in `MERGE_REVIEW` or `MERGE_BLOCKED` does not grant a fresh session permission to merge. Without an active explicit merge instruction (or a separately designed durable authorization mechanism), a fresh session may inspect/prepare the candidate but must not perform merge.

A closed-unmerged PR is `ABANDONED` only when abandonment/supersession is established. Unexpected closure or competing ownership is reconciliation work, not permission to silently choose another branch.

---

## 4. Ghost projection / publication state

Ghost projection state is tracked **per `LocaleVariant`**, because one Article maps to separate locale posts and multi-locale mutation is not assumed atomic.

States:

```text
NOT_PROJECTED
DRAFT_CURRENT
PUBLISHED_CURRENT
OUTDATED(visibility=DRAFT|PUBLISHED)
RECONCILIATION_REQUIRED(reason)
```

Suggested reconciliation reasons are diagnostic, not separate lifecycle enums:

```text
DRIFT
IDENTITY_AMBIGUITY
COLLISION
UNMANAGED_MUTATION
MISSING_MANAGED_TARGET
```

### Meaning

- `NOT_PROJECTED`: no prior managed mapping requires recovery and no uniquely owned managed Ghost post exists.
- `DRAFT_CURRENT`: managed Ghost draft matches the explicitly targeted source/projection fingerprint.
- `PUBLISHED_CURRENT`: managed public Ghost post matches the canonical production projection fingerprint.
- `OUTDATED(DRAFT)`: managed Ghost draft exists but its targeted source/projection fingerprint is older/different.
- `OUTDATED(PUBLISHED)`: managed public post remains published, but canonical production source is newer/different.
- `RECONCILIATION_REQUIRED`: safe ownership/current-state interpretation is not proven; automatic mutation stops.

Visibility is preserved for outdated projections because agent behavior differs materially. `OUTDATED(PUBLISHED)` must not be treated as a harmless draft target.

If publisher metadata says a managed target existed but the Ghost post is missing, use `RECONCILIATION_REQUIRED(MISSING_MANAGED_TARGET)`, not `NOT_PROJECTED`; do not silently recreate/adopt content without reconciliation.

### Canonical-vs-candidate source rule

An unmerged Article branch does **not** make a currently published projection `OUTDATED(PUBLISHED)`. Published-currentness is evaluated against canonical production source, normally merged `main`.

A draft projection may explicitly target a candidate source for preview/staging if the active task authorizes that mutation. Publisher metadata must retain enough source identity/fingerprint evidence to recover which source the draft represents.

### Dry-run / PublicationPlan

`PREPARE_PUBLISH` / dry-run is an operation, not a Ghost state.

A `PublicationPlan` is ephemeral and bound to:

- exact Article/variant identities;
- exact target **projection fingerprints** and source identity;
- observed Ghost IDs/managed tags/status/version fields used for optimistic guards;
- intended operations.

Any relevant source or Ghost change makes the plan stale. Recompute before mutation.

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| any non-reconciliation state | prepare/dry-run | source/translation validation PASS | fresh-read Ghost; emit bounded plan; no write | inspect collision/ownership/publication intent | unchanged | no |
| NOT_PROJECTED | authorized draft projection | active task authorizes Ghost draft mutation; plan/identity guards PASS | create managed draft; fresh-read verify | verify privacy/public-content policy | DRAFT_CURRENT | **yes for Ghost draft mutation** |
| OUTDATED(DRAFT) | authorized draft refresh | active task authorizes Ghost draft mutation; plan/identity guards PASS | update existing managed draft without publishing; fresh-read verify | review intended draft source | DRAFT_CURRENT | **yes for Ghost draft mutation** |
| NOT_PROJECTED / DRAFT_CURRENT / OUTDATED(DRAFT) / OUTDATED(PUBLISHED) | production publish | Article READY for canonical production source; translation SYNCED; source canonical; fresh plan/identity/drift guards PASS | create/publish or update managed public post; fresh-read verify | publication content/identity checks PASS | PUBLISHED_CURRENT | **yes: explicit production publication authorization** |
| DRAFT_CURRENT | targeted draft source/projection fingerprint changes | uniquely owned draft exists | no Ghost write; recompute relation | none | OUTDATED(DRAFT) | no |
| PUBLISHED_CURRENT | canonical production projection fingerprint changes | uniquely owned published projection exists | no Ghost write; keep current public post live | none | OUTDATED(PUBLISHED) | no |
| OUTDATED(DRAFT) / OUTDATED(PUBLISHED) | source reverts/matches observed managed fingerprint | exact relation can be proven without write | recompute relation | none | DRAFT_CURRENT or PUBLISHED_CURRENT as observed | no |
| any managed state | drift/collision/identity ambiguity/missing managed target detected | safe automatic interpretation not proven | stop write path; preserve observations | determine ownership/current intent | RECONCILIATION_REQUIRED | only for material ownership/intent decision |
| RECONCILIATION_REQUIRED | reconciliation proves unique ownership/current intent | authoritative evidence resolves ambiguity | fresh-read and recompute relation | review semantic/manual Ghost changes before overwrite | recomputed state | only when needed |

### Published projection is not a draft staging surface

Under v1, `PUBLISHED_CURRENT` and `OUTDATED(PUBLISHED)` do **not** have a transition to `DRAFT_CURRENT` merely because the user asked to “prepare publish” or create a draft. Doing so could unpublish or overwrite a currently public managed post.

A future design may introduce a separate staging post/revision mechanism. Until then, changing a published managed post's visibility to draft/unpublished requires a separately explicit production-impacting operation and is not part of routine `PREPARE_PUBLISH`.

### Multi-locale publication failure

Ghost mutations across locale posts are not assumed atomic.

If one locale succeeds and another fails:

1. do not claim whole-Article publication success;
2. fresh-read every targeted variant;
3. preserve actual per-variant states, e.g. first-publish failure may yield `ko-KR=PUBLISHED_CURRENT`, `en=NOT_PROJECTED`; update failure may yield `en=OUTDATED(PUBLISHED)`;
4. do not automatically roll back a successfully published sibling;
5. within the same active authorized publish operation, re-plan/recheck guards before retry;
6. after task/session loss, do **not** infer production authorization from the partial state—require a fresh explicit publication instruction unless a durable automation policy exists;
7. never adopt/overwrite an ambiguous unmanaged post to complete the set.

A Git merge never automatically transitions a Ghost projection to `PUBLISHED_CURRENT`.

---

## 5. Research-to-Action lifecycle

`research-to-action` is the canonical authority for RTA lifecycle and promotion semantics. Blog docs reference it; they do not redefine it.

Its current main flow is conceptually:

```text
CAPTURED -> RESEARCHING -> APPLICABLE -> NEEDS_EVIDENCE -> READY -> PROMOTED
```

with repository-defined side/terminal states. Always load current `research-to-action/AGENTS.md`/README when RTA mutation or lifecycle interpretation is involved rather than treating this conceptual list as authority.

Blog events do not automatically change RTA state. RTA state changes do not automatically change Article, Git, translation, or Ghost state.

---

## 6. Conversation event model

Conversation is transient control context, not a persistent lifecycle object.

Recognized intent-level events include:

```text
CREATE_ARTICLE
UPDATE_ARTICLE
AUDIT_ARTICLE
CAPTURE_RTA
UPDATE_RTA
SYNTHESIZE_RTA_TO_ARTICLE
EXTRACT_ARTICLE_TO_RTA
PREPARE_MERGE
MERGE
PREPARE_PUBLISH
PROJECT_GHOST_DRAFT
PUBLISH
```

Examples:

```text
"이 대화 블로그 글로 만들어"
  -> CREATE_ARTICLE

"RTA #8, #22로 글 써"
  -> SYNTHESIZE_RTA_TO_ARTICLE

"지난 글 최신 근거 반영해"
  -> AUDIT_ARTICLE + UPDATE_ARTICLE

"merge 준비해"
  -> PREPARE_MERGE        # may reach CANDIDATE; no merge authorization

"merge해"
  -> MERGE                # merge judgment + merge on PASS

"발행 준비해"
  -> PREPARE_PUBLISH      # read-only Ghost plan

"Ghost draft로 올려"
  -> PROJECT_GHOST_DRAFT  # explicit non-public Ghost mutation

"발행해"
  -> PUBLISH              # explicit production authorization
```

Conversation events never bypass repository guards. `PUBLISH` does not implicitly authorize `MERGE`, and `MERGE` does not imply `PUBLISH`.

---

## 7. Derived operation guards

Operations are predicates over independent machines, not composite lifecycle states.

### `may_advance_translation_checkpoint`

```text
all required locales exist
AND compiler/source validation PASS for all required locales
AND equivalence-review PASS under current review contract
AND reviewed translation fingerprints == exact current translation fingerprints
```

### `may_mark_article_ready`

```text
translation state == SYNCED
AND compiler/source/assets validation PASS
AND material factual/provenance/privacy review PASS
AND no unresolved semantic/publication-content question
AND readiness evidence can be atomically recorded for exact reviewed source
```

### `may_prepare_merge_candidate`

```text
Git work state == ACTIVE
AND coherent PR/work unit exists
AND Article state == READY
AND translation state == SYNCED
AND normal development validation/review reached stable candidate
```

### `may_enter_merge_review`

```text
Git work state == CANDIDATE
AND explicit merge / merge-judgment instruction exists in active task
AND exact candidate HEAD/base can be identified
```

This begins strict exact-HEAD proof obligations; it is not merge PASS.

### `may_merge`

```text
Git work state == MERGE_REVIEW
AND active task explicitly authorizes merge
AND exact final HEAD unchanged
AND fresh main / merge-base / diff / ownership verified
AND required CI + raw job evidence PASS
AND failure/recovery/regression/compatibility/edge/adversarial obligations PASS
AND review state + unresolved threads PASS
AND live rules/required contexts + mergeability PASS
```

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are false.

### `may_prepare_publish`

```text
canonical/target source identity known
AND source/translation/assets validation sufficient for planning
AND Ghost can be fresh-read
```

Effect is read-only: produce `PublicationPlan`; no Ghost mutation.

### `may_project_ghost_draft`

```text
active task explicitly authorizes Ghost draft mutation
AND target projection is NOT_PROJECTED or OUTDATED(DRAFT)
AND source/translation validation PASS
AND fresh PublicationPlan guards PASS
AND ownership/collision/drift checks PASS
```

A currently published managed projection is not a v1 draft-staging target.

### `may_publish_production`

```text
active task explicitly authorizes production publication
AND production source version is canonical/authorized by repository policy
AND Article state == READY for that exact production source
AND translation state == SYNCED for that exact production source
AND compiler/source/assets validation PASS
AND fresh PublicationPlan guards PASS for every targeted LocaleVariant
AND Ghost ownership/collision/drift checks PASS
```

Production authorization never substitutes for validation and never implicitly authorizes a pending Git merge.

### `may_capture_to_rta`

```text
active task/policy authorizes durable Conversation->RTA or Blog->RTA mutation
AND reusable research/insight/candidate exists
AND duplicate/owner search completed
AND current RTA governance allows durable capture
AND sensitive/private routing policy allows it
```

This does not imply RTA promotion.

---

## 8. Typical product states

| Situation | Article | Translation | Git work | Ghost projections |
|---|---|---|---|---|
| new bilingual draft, no checkpoint | DRAFT/REVIEW_REQUIRED | UNREVIEWED | ACTIVE | all `NOT_PROJECTED` |
| one locale edited after checkpoint | REVIEW_REQUIRED | `STALE(...)` | ACTIVE | published projections unchanged relative to canonical main |
| source ready in PR, merge not requested | READY | SYNCED | CANDIDATE | prior projection map unchanged |
| merge judgment explicitly started | READY | SYNCED | MERGE_REVIEW | prior projection map unchanged |
| merged, never published | READY | SYNCED | MERGED | all `NOT_PROJECTED` |
| merged update after prior publication | READY | SYNCED | MERGED | affected published variants `OUTDATED(PUBLISHED)` |
| explicit candidate Ghost draft | READY or REVIEW_REQUIRED as applicable | source-specific state | ACTIVE/CANDIDATE | target variant may be `DRAFT_CURRENT` |
| fully current public Article | READY | SYNCED | latest work unit MERGED | all required variants `PUBLISHED_CURRENT` |
| RTA evidence weakens published claim before source edit | REVIEW_REQUIRED | SYNCED | IDLE or ACTIVE | can remain `PUBLISHED_CURRENT` |
| managed published Ghost post manually edited | Article unchanged | translation unchanged | Git unchanged | affected variant `RECONCILIATION_REQUIRED(DRIFT)` |
| two-locale first publish partially succeeds | READY | SYNCED | MERGED | e.g. `ko-KR=PUBLISHED_CURRENT`, `en=NOT_PROJECTED` |

No single enum may collapse these facts.

---

## 9. Persistence and recovery

Persist/recover from authoritative sources:

- immutable Article and stable LocaleVariant identities;
- current source content and required-locale configuration;
- versioned Article readiness reviewed-source evidence/checkpoint and stable provenance kind;
- reviewed translation checkpoint, translation-fingerprint contract version, and stable review provenance kind;
- Git history/PR/base/head/review/CI facts through GitHub;
- Ghost projection identity, observed visibility/status, and last verified projection/source fingerprint evidence through publisher-owned metadata;
- RTA lifecycle through RTA's current canonical issues/labels/comments.

Keep fingerprint contracts distinct:

- translation fingerprint -> locale equivalence/staleness only;
- readiness fingerprint -> Article readiness-review coverage;
- projection fingerprint -> Ghost current/outdated relation.

They may share canonicalization helpers, but one fingerprint must not be used as proof for another invariant unless contracts explicitly define that equivalence.

Prefer deterministic derivation for:

- translation synchronization;
- `READY` validity from current source + reviewed readiness evidence + invalidation signals;
- candidate/merge guards;
- per-variant projection current/outdated relation;
- aggregate “all locales published current” views.

Do **not** persist by default:

- hidden reasoning;
- model/session IDs as workflow foreign keys;
- raw chat transcripts;
- volatile confidence numbers;
- redundant mega-state copies;
- task-scoped merge authorization;
- task-scoped Ghost-draft authorization;
- task-scoped production-publication authorization.

After session/task loss, mutation authorization must be re-established from a new explicit instruction unless a separately approved durable automation/authorization mechanism exists.

If persisted state names/meaning become machine-consumed, workflow/checkpoint contract versions must be checked on recovery. Missing, malformed, contradictory, or unsupported newer contracts fail closed before mutation.

---

## 10. Invalid-transition / recovery obligations

The following must fail closed or remain read-only:

- no translation checkpoint -> `SYNCED`;
- edit stale sibling -> `SYNCED` without separate equivalence PASS + checkpoint advance;
- bare `state: READY` with no recoverable reviewed-source evidence -> trusted `READY`;
- unmerged branch edit -> published Ghost projection `OUTDATED(PUBLISHED)`;
- `PREPARE_PUBLISH` -> any Ghost write;
- `OUTDATED(PUBLISHED)` -> `DRAFT_CURRENT` as routine staging;
- prior managed mapping + missing Ghost target -> silently `NOT_PROJECTED` and recreated;
- partial locale publication -> whole-Article publication success;
- recovered partial publication after session loss -> implicit reuse of old publish authorization;
- `CANDIDATE` -> merge without explicit merge judgment and exact-HEAD gate;
- `MERGE_REVIEW` remaining valid after HEAD moves;
- recovered `MERGE_REVIEW` state -> implicit merge authorization in a fresh task;
- RTA evidence signal -> automatic Blog rewrite/publication;
- Blog insight/correction signal -> unauthorized RTA mutation/lifecycle transition;
- Ghost identity ambiguity/drift -> implicit adoption/overwrite.

These cases are mandatory adversarial scenarios for implementation and fresh-session recovery tests.
