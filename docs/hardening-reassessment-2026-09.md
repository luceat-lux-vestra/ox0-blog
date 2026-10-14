# Hardening Reassessment — 2026-09-20

- **Status:** Completed point-in-time reassessment
- **Owning issue:** #22 — completed 2026-09-22
- **Current policy authority:** `.github/repository-policy.json` plus the live
  `Protect main` ruleset and active workflow contracts

This document records the September hardening reassessment and its closure. It
is historical evidence, not a live backlog or a versioned internal baseline.
Later workflow changes are called out only where they change how the current
policy is executed without changing the underlying hardening invariant.

## External reference points

- GitHub Actions security hardening and least-privilege guidance
- GitHub rulesets, dependency review, code scanning, secret scanning, and push-protection guidance
- OpenSSF Scorecard threat categories as an audit checklist rather than a score target
- current mature OSS practice for immutable action references and workflow-specific static analysis

Another luceat-lux-vestra repository is not the normative authority.

## Findings and dispositions

### PASS — live repository merge settings and protection

Fresh repository readback on 2026-09-21 confirms the repository-level merge settings match the checked-in intent:

- squash merge: enabled;
- merge commits: disabled;
- rebase merge: disabled;
- branch-update support: enabled.

Fresh ruleset readback also confirms active repository ruleset `Protect main` (id `23748922`) targets the default branch with:

- deletion and non-fast-forward protection;
- required linear history;
- pull-request-only changes with squash as the only allowed merge method;
- required review-thread resolution;
- no bypass actors;
- strict required status checks with the exact contexts then in force:
  - `Validate source`;
  - `Workflow Security`;
  - `Dependency Review`;
  - the now-retired failure-triage context.

That four-context state was the September 2026 point-in-time hardening baseline. The failure-triage automation was retired on 2026-10-15 by #57; current policy uses the remaining three required validation contexts.

### INTEGRATED / LIVE-PROVEN — generic workflow validation

PR #19 demonstrated that repository-specific tests did not catch malformed
workflow YAML before merge.

The completed remediation added:

- checksum-pinned actionlint over every active workflow;
- an intentionally malformed negative fixture that must fail;
- repository-owned workflow-policy checks;
- pinned zizmor analysis for GitHub Actions trust-boundary findings.

`Workflow Security` is now one of the four live required PR contexts. PR #43
later removed its redundant `main` push execution while preserving the exact
required context on pull requests.

### RETIRED — automated failure triage / classification

PR #37 introduced centralized failure-declaration validation plus a separate
trusted `workflow_run` classification reporter, and PR #38 completed its
bootstrap proof. Those pull requests remain historical evidence for an
experiment that was later removed.

On 2026-10-15, #57 retired the entire auxiliary failure-triage/classification
surface. The repository no longer requires a dedicated failure declaration
context, PR-template remediation block, sticky classifier comment, or
`workflow_run` reporter. The live merge authority is reduced to the checks
that directly validate the change: `Validate source`, `Workflow Security`,
and `Dependency Review`.

### INTEGRATED / LIVE-PROVEN — dependency admission and update coverage

The repository has an npm lockfile and GitHub Actions dependencies but previously had neither Dependabot configuration nor a dependency-review PR gate.

Both npm and GitHub Actions are covered by the candidate. Fresh exact-candidate evidence on 2026-09-21 shows Dependency Review succeeds after the live dependency/security support was enabled. The check remains fail-closed and is part of the intended required-context set.

### ADVISORY / LIVE-PROVEN — security analysis

CodeQL covers `javascript-typescript` and `actions` as an advisory security
analysis surface; it is intentionally not a required status context in the
live ruleset.

Current execution is pull-request plus scheduled analysis. PR #43 deliberately
removed the redundant `main` push analysis together with the other Final
producers. Any future promotion to a blocking context still requires a
deliberate policy/ruleset change rather than being inferred from successful
advisory runs.

### PASS WITH EXPLICIT EXCEPTION — Ghost authority remains shared

The reassessment does **not** require separate draft and production GitHub environments.

The accepted invariant is narrower and security-relevant:

> PR-controlled executable code must never run with Ghost authority.

The Article lifecycle uses trusted base-branch workflow/tooling, rejects fork PRs from the privileged draft job, treats the exact same-repository candidate checkout as data, installs dependencies only from trusted tooling, and re-verifies the candidate head before Ghost access.

`pull_request_target` remains privileged. The only allowed target-trigger workflow is the audited Article lifecycle; it may not execute PR-controlled code.

### EXCEPTION — no issue-label bot

The repository does not currently declare a canonical managed issue-label taxonomy. Adding a generic classifier solely for consistency would invent semantics rather than harden an existing contract.

Issue metadata automation remains out of scope until the repository defines a useful deterministic taxonomy.

### PASS — public security reporting / live security features

`SECURITY.md` is present. Dependency Review proved the Dependency Graph path
used by the required gate. The #22 closeout then recorded administration-backed
evidence that private vulnerability reporting, secret scanning, and secret
scanning push protection were enabled, and fresh ruleset readback confirmed no
routine bypass actors.

The recurring low-privilege drift audit intentionally does not pretend it can
authoritatively read every admin-only field. Those controls remain explicit
manual/admin readbacks in the checked-in policy when GitHub withholds them from
the scheduled token.

### ADDED — recurring low-privilege live drift detection

The checked-in policy previously had authoritative exit readback but no recurring live drift owner. Because repository/ruleset changes can invalidate the publication trust boundary without changing Git, a scheduled read-only audit now re-checks the live controls GitHub exposes to a low-privilege repository token:

- repository visibility/default branch/archive state;
- the active `Protect main` ruleset target, required rule types, squash-only pull-request policy, review-thread resolution, strict status-check policy, and exact required contexts;
- an operational Dependency Graph through the SBOM endpoint;
- private vulnerability reporting.

GitHub deliberately withholds `bypass_actors` unless the caller has ruleset write access. Secret-scanning and push-protection administration also remains an administrator assertion. The scheduled audit therefore prints these as `MANUAL_READBACK_REQUIRED` instead of interpreting an omitted field as PASS. No long-lived administration credential is added merely to make the scheduled check look complete.

### OWNER DECISION — licensing

The public repository has no explicit root license. Tooling code and published Article content do not necessarily need the same licensing policy, so automation must not select a license on the owner's behalf. Owner decision #23 remains open and separate from the completed technical
hardening reassessment.

### N/A — artifact attestation

The repository does not currently distribute a downloadable executable/build artifact as its product. Ghost publication is a controlled projection, so generic build-artifact attestation is not added merely for uniformity.

## Closure evidence and current execution model

The September reassessment closed after:

1. the exact final hardening candidate passed the then-current required checks
   and applicable CodeQL analysis;
2. the malformed-workflow negative control proved actionlint rejection;
3. the audited privileged Article lifecycle satisfied the reviewed zizmor /
   trust-boundary contract;
4. live merge settings and ruleset matched the checked-in point-in-time policy
   and no routine bypass;
5. Dependency Graph, private vulnerability reporting, secret scanning, and push
   protection closeout evidence was recorded;
6. the then-current post-merge validation and recurring drift evidence passed;
7. profile-dispatch configuration was resolved explicitly: absence of
   `PROFILE_REPO_DISPATCH_TOKEN` is a documented hourly-fallback state, not an
   unknown publication failure.

Failure-triage/classifier rollout proof was completed by #38 and remains
historical evidence. The entire auxiliary mechanism was later retired by #57.

### Current CI topology after #43

The current merge proof remains exact-final-HEAD and pull-request scoped.
`Validate source`, `Workflow Security`, and `Dependency Review` are the
live required contexts. CodeQL remains advisory.

PR #43 intentionally stopped repeating Final/exhaustive validation on the
resulting `main` push. Therefore current post-merge verification must not wait
for `Validate source`, `Workflow Security`, or CodeQL push runs that are no
longer produced. Instead, fresh-read the resulting `main` SHA/tree/signature
and verify the workflows that are actually applicable to that merge, such as
`Repository Drift` and the Article Publication Lifecycle for Article-changing
pushes.

This later CI optimization changes execution cadence, not the underlying
hardening obligations or exact-HEAD merge standard.

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` remain FAIL for claimed controls.
