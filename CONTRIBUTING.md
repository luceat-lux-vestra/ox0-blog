# Contributing to ox0-blog

This repository is both public Article source and a controlled Ghost publication system. Content correctness and workflow trust boundaries are reviewed together.

## Pull requests

Keep one coherent purpose per pull request. Run:

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

GitHub Actions additionally validates workflow syntax/security, dependency changes, and security analysis where applicable.

Fork pull requests never receive Ghost mutation authority. The trusted Article draft-staging path is intentionally limited to same-repository pull requests and executes base-branch tooling rather than pull-request-controlled tooling or dependencies.

## Article changes

Public content must satisfy the repository's source, translation, readiness, public-sanitization, and claim-proof contracts. Private/company/chat material must not be copied into public Article source without the repository's explicit public-sanitization process.

## Workflow and security changes

Changes under `.github/workflows/`, publication code, host-runtime boundaries, or authorization logic require explicit review of:

- effective GitHub token/environment permissions;
- source/code provenance;
- exact SHA binding;
- failure and recovery behavior;
- whether untrusted data can become executable code;
- whether secrets can reach a pull-request-controlled execution path.

Third-party GitHub Actions must use immutable full commit SHAs.

## Merge

Development commits may move normally. Merge judgment is exact-final-HEAD proof work. CI green is necessary but insufficient; `UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are FAIL. Repository history is squash-only once the live hardening policy is applied.
