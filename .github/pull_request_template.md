## Scope

Describe the one coherent change and its owning issue.

## Evidence

- [ ] exact candidate HEAD identified
- [ ] relevant tests pass
- [ ] `npm run validate` passes when Article/source behavior is affected
- [ ] failure/recovery and regression impact reviewed
- [ ] workflow/security trust boundary reviewed when `.github/`, publication, or credentials are affected

## Public-content safety

- [ ] no private/company/chat material was copied into public source without the required sanitization/research gates
- [ ] technical claims and recommendations meet the repository claim-proof contract when applicable

## Publication impact

State whether the change affects Ghost draft staging, production publication, Article identity/readiness, profile dispatch, or no publication control surface.

## Failure remediation

<!-- failure-triage:v1:start -->
- [ ] Not remediation for an observed failure
- [ ] Remediation for an observed failure

Observed:
<!-- Required for remediation: exact failing signal/revision/run. -->

Classification:
<!-- Required for remediation: implementation defect | test defect | evidence defect | workflow-policy drift | environment failure -->

Basis:
<!-- Required for remediation: why this responsibility layer is proven and alternatives rejected/unresolved. -->

Root cause:
<!-- Required for remediation. UNKNOWN / UNVERIFIED / INSUFFICIENT EVIDENCE / TBD remain fail-closed. -->

Remediation:
<!-- Required for remediation: owning layer to change. -->

Proof:
<!-- Required for remediation: evidence that resolves root cause without weakening the obligation. -->
<!-- failure-triage:v1:end -->

## Known gaps

List any remaining UNKNOWN / UNVERIFIED / INSUFFICIENT EVIDENCE. These are merge blockers during strict merge judgment.
