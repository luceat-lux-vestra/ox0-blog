# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for security issues that could expose credentials, mutate Ghost unexpectedly, bypass Article publication authorization, execute untrusted pull-request code with repository authority, or otherwise cross a documented trust boundary.

Do not include secrets, Ghost Admin API keys, repository dispatch tokens, or private material in a public Issue or pull request.

## Security boundaries

The repository treats these as privileged operations:

- Ghost draft or production mutation;
- production publication authorization;
- repository/profile dispatch using stored credentials;
- workflows that execute with repository or environment authority.

The Article publication lifecycle intentionally processes same-repository pull-request Article content through trusted default/base-branch tooling. Pull-request content is data, not executable workflow/tooling authority.

A finding is security-relevant when it can invalidate that separation, bypass exact-source authorization, expand credential exposure, or turn repository-controlled publication into attacker-controlled execution.

## Supported state

Security claims apply to the current `main` branch and currently configured GitHub/Ghost control surfaces. Historical branches, abandoned PRs, copied workflows, and old publication contracts are not maintained security surfaces.
