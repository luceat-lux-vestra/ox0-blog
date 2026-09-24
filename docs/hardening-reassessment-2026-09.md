# Hardening Reassessment — 2026-09-20

Owning issue: #22

This reassessment re-evaluates the repository against current external repository-security guidance and the repository's actual role as a public source repository plus controlled Ghost publication system.

It is not a versioned internal baseline.

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
- strict required status checks with the exact contexts:
  - `Validate source`;
  - `Workflow Security`;
  - `Dependency Review`;
  - `failure-triage`.

The live required-context promotion therefore matches `.github/repository-policy.json` and is no longer a blocker for PR #24.

### GAP — generic workflow validation

PR #19 demonstrated that repository-specific tests did not catch malformed workflow YAML before merge.

The remediation adds:

- checksum-pinned actionlint over every active workflow;
- an intentionally malformed negative fixture that must fail;
- repository-owned workflow-policy checks;
- pinned zizmor analysis for GitHub Actions trust-boundary findings.

### INTEGRATED — centralized failure declaration and classification

The required `failure-triage` context now comes from the unprivileged
`.github/workflows/failure-declaration.yml` `pull_request` adapter, pinned by
full commit SHA to the organization-wide declaration validator. The legacy
trusted-base `.github/workflows/failure-triage.yml` implementation has been
removed.

Automatic CI failure classification is a separate trusted
`workflow_run` reporter loaded from the default branch. It reconstructs the
exact PR HEAD from GitHub Actions metadata and bounded log inspection and
upserts one sticky `CI Failure Classification` comment. It never checks out
or executes PR code or downloaded artifacts; write authority is limited to the
reporter's job-local PR-comment scope.

Because GitHub loads `workflow_run` workflows from the default branch, the PR
that first introduced the reporter (#37) could not prove that reporter against
its own pull-request runs. Full rollout therefore requires a later PR, with the
reporter already on `main`, whose exact final HEAD passes the ordinary required
checks and receives exactly one sticky report for the same HEAD. With no active
failed or pending tracked workflow, the report must reach `CLEAR`.

`CANDIDATE` and `UNKNOWN` remain fail-closed and never authorize
remediation.

### INTEGRATED / LIVE-PROVEN — dependency admission and update coverage

The repository has an npm lockfile and GitHub Actions dependencies but previously had neither Dependabot configuration nor a dependency-review PR gate.

Both npm and GitHub Actions are covered by the candidate. Fresh exact-candidate evidence on 2026-09-21 shows Dependency Review succeeds after the live dependency/security support was enabled. The check remains fail-closed and is part of the intended required-context set.

### GAP — security analysis

CodeQL is added for `javascript-typescript` and `actions`. It is initially an analysis surface rather than a required status context; promotion to a blocking rule requires observed reliable PR/main evidence and a deliberate ruleset change.

### PASS WITH EXPLICIT EXCEPTION — Ghost authority remains shared

The reassessment does **not** require separate draft and production GitHub environments.

The accepted invariant is narrower and security-relevant:

> PR-controlled executable code must never run with Ghost authority.

The Article lifecycle uses trusted base-branch workflow/tooling, rejects fork PRs from the privileged draft job, treats the exact same-repository candidate checkout as data, installs dependencies only from trusted tooling, and re-verifies the candidate head before Ghost access.

`pull_request_target` remains privileged. The only allowed target-trigger workflow is the audited Article lifecycle; it may not execute PR-controlled code.

### EXCEPTION — no issue-label bot

The repository does not currently declare a canonical managed issue-label taxonomy. Adding a generic classifier solely for consistency would invent semantics rather than harden an existing contract.

Issue metadata automation remains out of scope until the repository defines a useful deterministic taxonomy.

### GAP — public security reporting / live security features

`SECURITY.md` is added. Dependency Review success on the exact candidate establishes that the dependency graph path needed by that gate is currently operational. Repository protection is live-proven by the active `Protect main` ruleset. Private vulnerability reporting, secret scanning, and push protection remain separate live GitHub settings whose final status still requires authoritative readback and, where necessary, administrative enablement.

### ADDED — recurring low-privilege live drift detection

The checked-in policy previously had authoritative exit readback but no recurring live drift owner. Because repository/ruleset changes can invalidate the publication trust boundary without changing Git, a scheduled read-only audit now re-checks the live controls GitHub exposes to a low-privilege repository token:

- repository visibility/default branch/archive state;
- the active `Protect main` ruleset target, required rule types, squash-only pull-request policy, review-thread resolution, strict status-check policy, and exact required contexts;
- an operational Dependency Graph through the SBOM endpoint;
- private vulnerability reporting.

GitHub deliberately withholds `bypass_actors` unless the caller has ruleset write access. Secret-scanning and push-protection administration also remains an administrator assertion. The scheduled audit therefore prints these as `MANUAL_READBACK_REQUIRED` instead of interpreting an omitted field as PASS. No long-lived administration credential is added merely to make the scheduled check look complete.

### OWNER DECISION — licensing

The public repository has no explicit root license. Tooling code and published Article content do not necessarily need the same licensing policy, so automation must not select a license on the owner's behalf. A separate owner-decision issue tracks this.

### N/A — artifact attestation

The repository does not currently distribute a downloadable executable/build artifact as its product. Ghost publication is a controlled projection, so generic build-artifact attestation is not added merely for uniformity.

## Exit criteria

The reassessment passes only when:

1. exact final PR HEAD passes source validation, Workflow Security, Dependency Review, failure-triage, and applicable CodeQL analysis;
2. malformed-workflow negative control demonstrably fails actionlint;
3. the audited privileged Article lifecycle workflow either passes zizmor or carries only narrowly justified reviewed exceptions;
4. live merge/ruleset settings match the checked-in policy, including the exact `failure-triage` required context;
5. live security-feature and Dependency Graph readback is recorded;
6. merged `main` emits and passes required validation on the exact merge SHA;
7. profile-dispatch observability from #22 is closed without exposing token values.

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` remain FAIL for claimed controls.
