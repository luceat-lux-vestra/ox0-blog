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

Persist only authoritative state needed for recovery. Prefer deterministic derivation when a state can be reconstructed from canonical source, checkpoints, GitHub, Ghost observations, or RTA authority.

---

## 1. Article content readiness

States:

```text
DRAFT
REVIEW_REQUIRED
READY
```

`READY` means the canonical Article source is internally ready for merge/publish preparation under the current workflow contract. It does **not** mean merged or published.

A new Article starts in `DRAFT`.

### Diagram

```text
DRAFT
  | content reaches reviewable shape
  v
REVIEW_REQUIRED
  | all required review/validation PASS
  v
READY
  | semantic/factual/translation-relevant source or evidence change
  +-----------------------------------------------> REVIEW_REQUIRED
```

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| DRAFT | content reaches reviewable shape | required Article source exists | run source/locale validation inputs; preserve unresolved items | perform content/factual/translation review as applicable | REVIEW_REQUIRED | no |
| REVIEW_REQUIRED | readiness review PASS | required locales exist; translation state `SYNCED`; compiler/source/assets validation PASS; no unresolved material question | record/refresh durable reviewed evidence required by implementation | confirm material claims, intent, privacy, provenance, and other semantic obligations | READY | normally no |
| REVIEW_REQUIRED | material ambiguity remains | agent cannot safely infer the intended meaning/public treatment | preserve unresolved item; do not claim readiness | ask only for the unresolved material decision | REVIEW_REQUIRED | yes, only for that decision |
| READY | translation-relevant or factual source changes | Article source/evidence dependency materially changed | invalidate prior Article readiness evidence | rerun affected semantic/factual/translation review | REVIEW_REQUIRED | no |
| READY | relied-on provenance/evidence materially weakens or reverses | source may still be byte-identical | emit/record Article-review-needed work signal; do not mutate Ghost | audit the affected claim against current evidence | REVIEW_REQUIRED | no |
| READY | non-semantic Git/projection metadata changes | Article content/evidence and translation fingerprints unchanged | no Article effect | none | READY | no |

A provenance-driven `REVIEW_REQUIRED` transition does **not** by itself make an existing Ghost projection outdated. If the audit concludes that canonical source need not change, the Article may return to `READY` while the projection remains current. Projection state changes only when its own invariant changes.

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

For the current two-locale policy, `STALE({ko-KR}, {en})` may be displayed as `EN_STALE`, and `STALE({en}, {ko-KR})` as `KO_STALE`. The durable model remains set-based.

### Deterministic evaluation

Let `R` be required locales and `C` the locales whose current translation fingerprint differs from the accepted checkpoint.

Evaluate in this order:

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
    REVIEW_REQUIRED   # every required locale differs from the checkpoint
```

This preserves #3's invariant that **no accepted checkpoint means `UNREVIEWED`**, even when all locale files already exist. `REVIEW_REQUIRED` is not a generic synonym for “a review operation should run”. An equivalence review may be required while the derived state is `UNREVIEWED` or `STALE`.

### Diagram

```text
missing required locale ------------------------------> INCOMPLETE

no checkpoint + all locales --------------------------> UNREVIEWED
       | equivalence PASS + checkpoint advance
       v
     SYNCED
       | one/some-but-not-all fingerprints change
       v
      STALE
       | remaining locale(s) updated
       v
REVIEW_REQUIRED
       | equivalence PASS + checkpoint advance
       v
     SYNCED
```

### Transitions / operations

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| any | required locale removed/missing | configured required locale absent | derive missing set | none | INCOMPLETE | no |
| INCOMPLETE | missing locale created | all required locales now exist | recompute fingerprints/state by the evaluation rule | schedule/perform equivalence review when production readiness is desired | UNREVIEWED, STALE, or REVIEW_REQUIRED as derived | no |
| UNREVIEWED | translation-relevant content/assets change | all required locales exist; still no checkpoint | recompute fingerprints; checkpoint remains absent | review may be performed but no automatic acceptance | UNREVIEWED | no |
| SYNCED | translation-relevant content/assets change | accepted checkpoint exists | recompute `changed_locales` / `stale_locales` | synchronize/inspect sibling locales as required | STALE or REVIEW_REQUIRED as derived | no |
| STALE | additional locale content/assets change | accepted checkpoint exists | recompute changed/stale sets | continue synchronization/review | STALE or REVIEW_REQUIRED as derived | no |
| REVIEW_REQUIRED | locale content/assets change | accepted checkpoint exists | recompute changed/stale sets | continue synchronization/review | STALE or REVIEW_REQUIRED as derived | no |
| UNREVIEWED / STALE / REVIEW_REQUIRED | equivalence review PASS | all required locales exist; compiler/source validation PASS; review covers the exact current fingerprints; no material ambiguity | atomically advance checkpoint to current fingerprints/provenance | separate equivalence-review pass confirms semantic equivalence; body mutation is not required if unchanged siblings are already equivalent | SYNCED | no |
| UNREVIEWED / STALE / REVIEW_REQUIRED | equivalence review FAIL/UNCERTAIN | material mismatch or ambiguity exists | checkpoint unchanged; recompute current derived state | resolve content if agentically possible; otherwise surface the specific unresolved decision | unchanged/recomputed derived state | only if necessary |
| SYNCED | deployment-only metadata changes | translation fingerprint unchanged | no checkpoint/state effect | none | SYNCED | no |

The same agent may author/translate and review, but those are distinct logical passes. Editing all locale files never implies `SYNCED` by itself. Conversely, a stale sibling does not have to be textually modified if a separate equivalence review proves the current variants are still semantically equivalent; checkpoint advancement is the acceptance operation.

Malformed checkpoints, unsupported checkpoint/review-contract versions, or non-computable fingerprints are validation errors and **fail closed**. They must never be silently coerced to `SYNCED`.

Production publication requires `SYNCED` for all required locales under contract v1.

---

## 3. Git / PR work state

Git work state is **per logical Article work unit**, not a permanent Article lifecycle. Historical merged work remains historical; a later Article update starts a new work unit.

States:

```text
IDLE
ACTIVE
CANDIDATE
MERGE_REVIEW
MERGE_BLOCKED
CONFLICTED
MERGED
```

### Diagram

```text
IDLE -> ACTIVE -> CANDIDATE
                  |   |
      explicit    |   | new change / HEAD movement
      merge intent|   v
                  v ACTIVE
             MERGE_REVIEW
              |       |
         FAIL |       | PASS + authorized merge
              v       v
        MERGE_BLOCKED MERGED
              |
        fix/evidence
              +------> MERGE_REVIEW or ACTIVE

ACTIVE/CANDIDATE/MERGE_REVIEW/MERGE_BLOCKED
              -> CONFLICTED -> ACTIVE
```

### Meanings

- `IDLE`: no active branch/PR owns the requested Article change.
- `ACTIVE`: normal development; branch/PR may exist and HEAD movement/fix commits are expected.
- `CANDIDATE`: a coherent PR HEAD is ready for merge judgment, but the strict exact-HEAD gate has **not** begun.
- `MERGE_REVIEW`: the user/task has explicitly entered merge judgment; exact final HEAD is the evidence unit.
- `MERGE_BLOCKED`: the current exact-HEAD candidate failed or lacks required proof; merge is prohibited.
- `CONFLICTED`: base/ownership/semantic concurrency requires reconciliation before candidate review can continue.
- `MERGED`: this work unit was squash-merged and the canonical result was verified.

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| IDLE | durable Article mutation requested | no suitable active owner | create/reuse work branch from expected fresh base | recover Article ownership and intended scope | ACTIVE | no |
| ACTIVE | coherent candidate established | PR/work unit coherent; normal validation/review feedback addressed enough for candidate | record exact candidate HEAD and candidate evidence boundary | assess whether unresolved semantic questions remain | CANDIDATE | no |
| CANDIDATE | new edit/rebase/fix changes HEAD | development resumes | invalidate candidate-specific evidence as applicable | none beyond normal review | ACTIVE | no |
| CANDIDATE | explicit merge / merge-judgment instruction | candidate HEAD identified; Article/translation/source preconditions satisfied | snapshot exact final HEAD/base and begin strict gate | begin proof-obligation review | MERGE_REVIEW | **yes** |
| MERGE_REVIEW | exact HEAD changes | any commit/rebase/restack changes reviewed HEAD | invalidate **all** exact-HEAD merge evidence from the prior HEAD | rerun review only after a new candidate is established | ACTIVE | no additional authorization solely because evidence reset |
| MERGE_REVIEW | any required gate FAIL / UNKNOWN / UNVERIFIED / INSUFFICIENT EVIDENCE | exact HEAD unchanged | preserve failure evidence; prohibit merge | determine whether evidence can be obtained without mutation or a fix is required | MERGE_BLOCKED | no |
| MERGE_BLOCKED | missing evidence becomes available, same HEAD | no source/HEAD change | restart/check remaining exact-HEAD obligations | review newly available evidence | MERGE_REVIEW | no, prior merge-judgment authorization still applies |
| MERGE_BLOCKED | fix/rebase/source change required | HEAD will change | invalidate old exact-HEAD evidence | perform normal development/fix | ACTIVE | no |
| ACTIVE / CANDIDATE / MERGE_REVIEW / MERGE_BLOCKED | same Article/shared semantic asset changes elsewhere | ownership/base/current semantics cannot be safely reconciled automatically | stop merge/mutation path; preserve both sides | reconcile meaning, ownership, fingerprints, and base | CONFLICTED | normally no |
| CONFLICTED | reconciliation complete | no unresolved ownership conflict | refresh branch/base and invalidate stale evidence | rerun affected semantic/translation review | ACTIVE | no |
| MERGE_REVIEW | strict gate PASS and merge authorized | exact reviewed HEAD unchanged; all proof obligations PASS; no unresolved threads; mergeability/rules satisfied | squash merge with `expected_head_sha` when supported; verify canonical main SHA/tree/parent/signature/evidence | final semantic/review checks already PASS | MERGED | **yes unless the active instruction already explicitly authorized merge** |

A request such as “merge해” may authorize both entering `MERGE_REVIEW` and performing the merge if all exact-HEAD gates pass. A request that only asks to prepare or review the PR does not authorize merge.

---

## 4. Ghost projection / publication

Ghost projection state is tracked **per `LocaleVariant` projection**, because one logical Article maps to separate locale posts and a multi-locale operation can partially succeed.

For each required locale/variant:

```text
NOT_PROJECTED
DRAFT_CURRENT
PUBLISHED_CURRENT
OUTDATED
RECONCILIATION_REQUIRED(reason)
```

Suggested `reason` values are diagnostic, not new lifecycle states, for example `DRIFT`, `IDENTITY_AMBIGUITY`, `COLLISION`, or `UNMANAGED_MUTATION`.

### Meaning

- `NOT_PROJECTED`: no uniquely owned managed Ghost projection exists for this variant.
- `DRAFT_CURRENT`: managed Ghost draft matches the last verified projected source fingerprint.
- `PUBLISHED_CURRENT`: managed public Ghost post matches the last verified canonical production source fingerprint.
- `OUTDATED`: a uniquely owned managed projection exists but the relevant source fingerprint is newer/different.
- `RECONCILIATION_REQUIRED`: safe automatic ownership/current-state reconciliation is not proven; mutation must stop.

Article-level publication status is a **derived map/aggregate** over variant states, not another persisted mega-state. For example, “fully current public Article” means every required locale projection is `PUBLISHED_CURRENT`.

### Dry-run / plan

`dry-run` is an operation, **not** a Ghost lifecycle state.

A `PublicationPlan` is ephemeral and bound to:

- exact target Article/variant identities;
- target source fingerprints;
- observed Ghost IDs/managed tags/status/version fields needed for optimistic guards;
- intended operations.

If relevant source or Ghost state changes, the plan is stale and must be recomputed.

### Transitions

| From | Event | Guard / preconditions | Deterministic side effects | Semantic / agent review | To | User authorization required? |
|---|---|---|---|---|---|---|
| any non-reconciliation state | dry-run | source/translation validation PASS | fresh-read Ghost; build bounded plan; no write | inspect collisions/ownership/publication intent | unchanged | no |
| NOT_PROJECTED / OUTDATED | authorized draft projection | current plan/identity guards PASS | write draft; fresh-read and verify exact managed projection | verify public/private content policy as applicable | DRAFT_CURRENT | only if the active task authorizes Ghost draft mutation |
| NOT_PROJECTED / DRAFT_CURRENT / OUTDATED | production publish | Article `READY`; translation `SYNCED`; production source is canonical/authorized; plan/identity/drift guards PASS | publish targeted variant; fresh-read verify persisted managed state | publication content/identity checks PASS | PUBLISHED_CURRENT | **yes: explicit production publication authorization** |
| DRAFT_CURRENT / PUBLISHED_CURRENT | relevant canonical/projected source fingerprint changes | uniquely owned managed projection still exists | no Ghost mutation; mark relation stale by comparison | none | OUTDATED | no |
| any managed state | drift/collision/identity ambiguity detected | safe automatic reconciliation not proven | stop write path; preserve observations/evidence | determine whether ownership/current intent can be proven | RECONCILIATION_REQUIRED | only if a material ownership/intent decision is needed |
| RECONCILIATION_REQUIRED | reconciliation proves unique ownership/current intent | ambiguity resolved from authoritative evidence | rerun fresh read and recompute projection relation | review any semantic/manual Ghost changes before overwrite | recomputed `NOT_PROJECTED`, `DRAFT_CURRENT`, `PUBLISHED_CURRENT`, or `OUTDATED` | only when needed for semantic/ownership choice |

### Multi-locale publication failure

A production publish may target multiple locale posts, but Ghost mutations are not assumed to be atomic across them.

If one locale succeeds and another fails:

1. do not claim Article-level publication success;
2. fresh-read every targeted variant projection;
3. retain the actual per-variant states (for example `ko-KR=PUBLISHED_CURRENT`, `en=OUTDATED`);
4. preserve the original explicit publication authorization only for the same intended operation, while re-running stale plan/identity guards before retry;
5. never adopt or overwrite an ambiguous unmanaged post to “complete” the operation.

A Git merge never automatically transitions any projection to `PUBLISHED_CURRENT`.

---

## 5. Research-to-Action lifecycle

`research-to-action` is the canonical authority for RTA lifecycle and promotion semantics. Blog docs must not create a competing copy.

Current RTA policy defines the main flow conceptually as:

```text
CAPTURED -> RESEARCHING -> APPLICABLE -> NEEDS_EVIDENCE -> READY -> PROMOTED
```

with repository-defined side/terminal states such as `PARKED`, `REJECTED`, `SUPERSEDED`, `VALIDATED`, and `COMPLETED`.

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
  -> PREPARE_MERGE        # may reach CANDIDATE, does not authorize merge

"merge해"
  -> MERGE                # explicitly authorizes merge judgment/merge on PASS

"발행 준비해"
  -> PREPARE_PUBLISH      # dry-run only unless another mutation was explicitly requested

"발행해"
  -> PUBLISH              # explicit production authorization
```

Conversation events never bypass repository guards.

---

## 7. Derived operation guards

Operations are predicates over independent machines, not composite lifecycle states.

### `may_advance_translation_checkpoint`

```text
all required locales exist
AND compiler/source validation PASS for all required locales
AND equivalence-review PASS under the current review contract
AND reviewed fingerprints == exact current fingerprints
```

### `may_mark_article_ready`

```text
translation state == SYNCED
AND compiler/source/assets validation PASS
AND material factual/provenance review PASS
AND no unresolved semantic/privacy/publication-content questions
```

### `may_prepare_merge_candidate`

```text
Git work state == ACTIVE
AND coherent PR/work unit exists
AND Article state == READY
AND translation state == SYNCED
AND normal development validation/review reached a stable candidate
```

### `may_enter_merge_review`

```text
Git work state == CANDIDATE
AND explicit merge / merge-judgment instruction exists in the active task
AND exact candidate HEAD/base can be identified
```

This begins strict exact-HEAD proof obligations. It is not merge PASS.

### `may_merge`

```text
Git work state == MERGE_REVIEW
AND exact final HEAD unchanged
AND fresh main / merge-base / diff / ownership verified
AND required CI + raw job evidence PASS
AND failure/recovery/regression/compatibility/edge/adversarial obligations PASS
AND review state + unresolved threads PASS
AND live rules/required contexts + mergeability PASS
AND merge authorization exists
```

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are false.

### `may_publish_production`

```text
explicit production publication authorization exists
AND production source version is canonical/authorized by repository policy
AND Article state == READY
AND translation state == SYNCED
AND compiler/source/assets validation PASS
AND fresh PublicationPlan guards PASS for every targeted LocaleVariant
AND Ghost ownership/collision/drift checks PASS
```

Publication authorization never substitutes for failed validation.

### `may_capture_to_rta`

```text
reusable research/insight/candidate exists
AND duplicate/owner search completed
AND RTA governance allows the durable capture
AND sensitive/private routing policy allows it
```

This does not imply RTA promotion.

---

## 8. Typical product states

| Situation | Article | Translation | Git work | Ghost projections |
|---|---|---|---|---|
| new bilingual draft, no checkpoint | DRAFT/REVIEW_REQUIRED | UNREVIEWED | ACTIVE | all `NOT_PROJECTED` |
| one locale edited after reviewed checkpoint | REVIEW_REQUIRED | `STALE(...)` | ACTIVE | existing projections unchanged relative to canonical main until canonical source changes |
| source ready in PR, merge not requested | READY | SYNCED | CANDIDATE | prior projection map unchanged |
| merge judgment explicitly started | READY | SYNCED | MERGE_REVIEW | prior projection map unchanged |
| merged, never published | READY | SYNCED | MERGED | all `NOT_PROJECTED` |
| merged update after prior publication | READY | SYNCED | MERGED | affected locale projections become `OUTDATED` |
| fully current public Article | READY | SYNCED | latest work unit MERGED | all required locales `PUBLISHED_CURRENT` |
| RTA evidence weakens a published claim before source edit | REVIEW_REQUIRED | SYNCED | IDLE or ACTIVE | may remain all `PUBLISHED_CURRENT` |
| Ghost manually edited in a managed field | Article unchanged | translation unchanged | Git unchanged | affected variant `RECONCILIATION_REQUIRED` |
| two-locale publish partially succeeds | READY | SYNCED | MERGED | mixed per-locale states; no Article-level success claim |

No single enum may collapse these facts.

---

## 9. Persistence and recovery

Persist / recover from authoritative sources:

- immutable Article and stable LocaleVariant identities;
- current source content and required locale configuration;
- reviewed translation checkpoint, fingerprint contract version, and stable review provenance kind;
- Git history/PR/base/head/review/CI state through GitHub;
- Ghost projection identity and last verified projection/source fingerprint evidence through publisher-owned metadata;
- RTA lifecycle through RTA's canonical issues/labels/comments.

Prefer deterministic derivation for:

- translation synchronization state;
- Article readiness where implementation can prove it from reviewed evidence;
- candidate/merge guards;
- per-variant projection current/outdated relation;
- aggregate “all locales published current” views.

Do not persist:

- hidden reasoning;
- model/session IDs as workflow foreign keys;
- raw chat transcripts by default;
- volatile confidence numbers;
- redundant mega-state copies that can disagree with owning systems.

If persisted state names/meaning become machine-consumed, the workflow/checkpoint contract version must be checked on recovery. Missing, malformed, contradictory, or unsupported newer contracts fail closed before mutation.
