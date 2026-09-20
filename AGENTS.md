# ox0-blog agent bootstrap

This repository uses **Content Workflow Contract v1**.

Before Article, localization, Conversation/RTA integration, Git/PR, or Ghost publication work, read:

1. `docs/workflow/README.md`
2. `docs/workflow/responsibilities.md`
3. `docs/workflow/state-machines.md`
4. `docs/workflow/integrations.md`
5. `docs/workflow/git-policy.md`

Then recover current repository, Article, RTA, PR, and Ghost-related state relevant to the task before mutation.

## Authority

- Git repository policy is canonical. Account memory and prior chat context are bootstrap aids only.
- Article bundles under `posts/<article>/` are canonical public-content source; Ghost is a projection target, not an editing source.
- `research-to-action` owns research/evidence/promotion governance. RTA state does not authorize Blog publication or project mutation.
- The user normally supplies intent and material decisions. The agent owns routine editing, translation synchronization/review/checkpoints, Git/PR mechanics, validation, and authorized Ghost mechanics.
- Production publication requires an explicit publication instruction unless a separately approved automation policy exists. The approved Article lifecycle treats a successfully reviewed/squash-merged Article PR as production authorization for the exact affected merged source.
- Merge/merge-judgment authorization remains task-scoped. Outside the approved merge-publication automation, production-publication authorization is separate and must not be inferred from recovered PR/Ghost state after task/session loss.
- Production publication authorization does not substitute for current public-resource safety or required host trust for external publication resources. Recompute plan-bound resource targets/approvals from current source/current host policy after task/session loss.

## Development and merge policy

During development, normal branch/HEAD movement and fix commits are allowed. Do not rerun the complete strict merge gate after every edit or restack stacked PRs after every upstream commit.

A coherent PR may reach `CANDIDATE` without beginning strict merge judgment. Do **not** enter exact-HEAD `MERGE_REVIEW`, and do not merge, unless the active user/task instruction explicitly asks to merge or explicitly asks to begin merge judgment.

At merge judgment, correctness/safety not proven is FAIL. `UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are FAIL. Exact final HEAD is the evidence unit; if it moves, exact-HEAD merge evidence is invalidated. Use squash merge and exact reviewed-head locking (`expected_head_sha`) where supported.

## Failure classification before remediation

A failing Article/tooling test, claim-proof check, PUBLIC_SANITIZATION gate,
publication workflow, Ghost operation, hardening audit, or other red signal is
an **observation**, not a remediation instruction. Before a non-trivial
remediation, classify the observed failure as exactly one of:

- `implementation defect` — Article tooling, workflow/state-machine logic,
  translation/publication mechanics, or other repository-owned implementation
  violates the accepted contract;
- `test defect` — a test, fixture, harness, oracle, assertion, or negative
  control is wrong for the intended contract;
- `evidence defect` — claim proof, public-example research, sanitization
  evidence, publication/Ghost state evidence, attribution, freshness, parsing,
  or proof construction is wrong or insufficient;
- `workflow-policy drift` — checked-in authority, Content Workflow Contract,
  publication policy, repository hardening, live settings, or their assumed
  relationship have diverged;
- `environment failure` — Ghost service/state availability, host trust,
  credentials/resource availability, runner, network, or another external
  execution environment caused the failure;
- `UNKNOWN` — available evidence does not justify any of the five classes.

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` remain fail-closed.
Classification is itself a proof obligation. Preserve at least:

```text
Observed:
Classification:
Basis:
Root cause:
Remediation:
Proof:
```

The `Basis` must justify the selected responsibility layer and identify
plausible alternatives that were rejected or remain unresolved. A failed
claim-proof or PUBLIC_SANITIZATION check is not evidence that the Article text
should be weakened until it passes; determine whether the claim/content is
wrong, the test/evidence is wrong or stale, authority drifted, or an external
publication environment failed.

Never weaken or bypass a valid claim-proof obligation,
`PUBLIC_SANITIZATION`, `PUBLIC_EXAMPLE_RESEARCH`, publication authorization,
workflow state machine, negative control, or repository hardening gate merely
to obtain green. A deterministic/reproducible failure does not become an
`environment failure` merely because a rerun later passes.

If remediation changes Article/tooling implementation, claim or evidence
premises, sanitization/public-example evidence, publication workflow/policy,
Ghost/resource assumptions, or another premise of an exact-HEAD proof,
invalidate the affected evidence. Re-run the relevant content/workflow proof
and required repository validation on the new exact final PR HEAD before merge.
For production publication, merge evidence still does not substitute for the
publication/resource authorization rules above.

## Publication boundary

`발행 준비해` / `PREPARE_PUBLISH` is read-only with respect to Ghost and publication resource storage under contract v1: validate, resolve bounded read-only resource targets/current host approvals where applicable, fresh-read Ghost, and create a fresh publication plan. For same-repository PRs, the approved lifecycle may stage a newly added `READY + SYNCED` Article as a managed Ghost draft using trusted base tooling. When that exact Article PR is later squash-merged after the merge gate passes, the reviewed merge authorizes production publication of the exact affected merged source. `발행해` remains the explicit manual/recovery publication command and does not implicitly authorize a pending Git merge.

A prior PublicationPlan or prior host external-resource approval is not durable mutation authority. If source, resource target, host-policy evidence, or Ghost state changed—or the task/session was lost—re-plan before any new write.

## Authoring safety

- Technical claims must be traceable to evidence. Distinguish measurement, observation, inference, and opinion.
- Material factual/classification/recommendation/example-interpretation claims must pass the durable claim-proof contract in `docs/article-claim-proof.md` before Article READY is accepted.
- Recommendation language has a stronger proof obligation than descriptive facts. A tutorial, OSS issue, or public example cannot by itself establish best-practice/default wording.
- Final technical review must include cross-claim consistency and an independent adversarial pass. The user is not the default domain fact checker.
- Any Blog mutation derived from private/non-public Conversation or RTA material must pass the `PUBLIC_SANITIZATION` gate in `docs/workflow/integrations.md` before the first durable public write and again after material content changes.
- Any concrete example used in such work must also pass `PUBLIC_EXAMPLE_RESEARCH`: perform fresh public-web research, independently construct the example from public evidence where available, and never reuse a private scenario through superficial renaming or structural paraphrase.
- Do not publish credentials, personal secrets, private/customer/company details, raw chat transcripts, private provenance, or organization-specific implementation identifiers merely because they appeared in source Conversation/RTA context.
- Preserve publisher-owned `#ox0-*` state tags; authors must not add them manually.
- Never put Ghost Admin credentials in source, logs, examples, issues, or pull requests.
- Use dry-run/read-only planning before first mutation when the publication workflow supports it.
- Ghost projection state is per locale variant. Never claim whole-Article publication success after a partial multi-locale mutation; fresh-read and recover the actual state of every targeted projection.
- If a Ghost post write may have succeeded but final publisher revision/sync evidence is missing or invalid, recover it as reconciliation-required rather than silently treating it as not projected.
- A currently published managed projection is not a routine draft-staging surface; preserve published visibility unless an explicitly designed/authorized production-impacting operation says otherwise.

## Article implementation boundary

The active architecture is the Article + LocaleVariant model tracked by issues #3–#8. The earlier one-file frontmatter/`:::lang`/path-derived-identity/data-URI publication path has been retired from the active implementation. Do not reintroduce those mechanisms as compatibility behavior without a new explicit design decision and reconciliation with the workflow contract.

## Fail closed

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess or silently use remembered policy. Preserve durable state and surface the policy conflict before mutation.
