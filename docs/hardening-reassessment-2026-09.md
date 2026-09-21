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

### PARTIAL / GAP — live repository merge settings and protection

Fresh repository readback on 2026-09-21 confirms the repository-level merge settings now match the checked-in intent:

- squash merge: enabled;
- merge commits: disabled;
- rebase merge: disabled;
- branch-update support: enabled.

The remaining live-policy gap is branch protection itself. Fresh authoritative ruleset collection readback is exactly `[]`.

The reassessment does not pass until active `main` protection exists and is fresh-read with the checked-in required contexts exactly:

- `Validate source`;
- `Workflow Security`;
- `Dependency Review`;
- `failure-triage`.

Do not treat the repository-level merge-setting correction as proof that branch protection exists.

### GAP — generic workflow validation

PR #19 demonstrated that repository-specific tests did not catch malformed workflow YAML before merge.

The remediation adds:

- checksum-pinned actionlint over every active workflow;
- an intentionally malformed negative fixture that must fail;
- repository-owned workflow-policy checks;
- pinned zizmor analysis for GitHub Actions trust-boundary findings.

### INTEGRATED — executable failure triage

The trusted-base `failure-triage` workflow and PR input surface are already on current `main`. Real PR evidence under #27 proved invalid metadata fails and a body-only correction succeeds on the unchanged code HEAD.

The hardening authority therefore recognizes `.github/workflows/failure-triage.yml` as the second intentionally audited metadata-only `pull_request_target` workflow and includes the exact `failure-triage` context in required-context intent. It must not become live-required until the repository protection/ruleset is applied and fresh-read.

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

`pull_request_target` remains privileged. The only allowed target-trigger workflows are the audited Article lifecycle and the metadata-only failure-triage validator; neither may execute PR-controlled code.

### EXCEPTION — no issue-label bot

The repository does not currently declare a canonical managed issue-label taxonomy. Adding a generic classifier solely for consistency would invent semantics rather than harden an existing contract.

Issue metadata automation remains out of scope until the repository defines a useful deterministic taxonomy.

### GAP — public security reporting / live security features

`SECURITY.md` is added. Dependency Review success on the exact candidate establishes that the dependency graph path needed by that gate is currently operational. Private vulnerability reporting, secret scanning, push protection, and repository protection remain live GitHub settings whose final status requires authoritative readback and, where necessary, administrative enablement.

### OWNER DECISION — licensing

The public repository has no explicit root license. Tooling code and published Article content do not necessarily need the same licensing policy, so automation must not select a license on the owner's behalf. A separate owner-decision issue tracks this.

### N/A — artifact attestation

The repository does not currently distribute a downloadable executable/build artifact as its product. Ghost publication is a controlled projection, so generic build-artifact attestation is not added merely for uniformity.

## Exit criteria

The reassessment passes only when:

1. exact final PR HEAD passes source validation, Workflow Security, Dependency Review, failure-triage, and applicable CodeQL analysis;
2. malformed-workflow negative control demonstrably fails actionlint;
3. the two audited privileged workflows either pass zizmor or carry only narrowly justified reviewed exceptions;
4. live merge/ruleset settings match the checked-in policy, including the exact `failure-triage` required context;
5. live security-feature and Dependency Graph readback is recorded;
6. merged `main` emits and passes required validation on the exact merge SHA;
7. profile-dispatch observability from #22 is closed without exposing token values.

`UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` remain FAIL for claimed controls.
