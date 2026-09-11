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
- `posts/` / future Article-bundle source is canonical public-content source; Ghost is a projection target, not an editing source.
- `research-to-action` owns research/evidence/promotion governance. RTA state does not authorize Blog publication or project mutation.
- The user normally supplies intent and material decisions. The agent owns routine editing, translation synchronization/review/checkpoints, Git/PR mechanics, validation, and authorized Ghost mechanics.
- Production publication requires an explicit publication instruction unless a separately approved automation policy exists.

## Development and merge policy

During development, normal branch/HEAD movement and fix commits are allowed. Do not rerun the complete strict merge gate after every edit or restack stacked PRs after every upstream commit.

At merge judgment, correctness/safety not proven is FAIL. `UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are FAIL. Exact final HEAD is the evidence unit; if it moves, exact-HEAD merge evidence is invalidated. Use squash merge and exact reviewed-head locking where supported.

## Authoring safety

- Technical claims must be traceable to evidence. Distinguish measurement, observation, inference, and opinion.
- Do not publish credentials, personal secrets, private/customer/company details, or raw chat transcripts merely because they appeared in source conversation/RTA context.
- Preserve publisher-owned `#ox0-*` state tags; authors must not add them manually.
- Never put Ghost Admin credentials in source, logs, examples, issues, or pull requests.
- Use dry-run/read-only planning before first mutation when the publication workflow supports it.

## Transitional implementation warning

The current authoring work may contain one-file `:::lang ko/en` and self-contained data-URI body-image mechanisms. They are **transitional implementation**, not the long-term content-model contract.

Target architecture is tracked by:

- #3 — Article + LocaleVariant + reviewed translation checkpoints
- #4 — compiler boundary and staged Marked -> Arkst migration
- #5 — agent-operated authoring/Git/publication workflow
- #6 — independent Conversation <-> Blog <-> RTA edge contracts
- #8 — durable bootstrap/state-machine governance

Do not extend transitional bilingual/image mechanisms as new long-term invariants without reconciling those target issues and workflow docs first.

## Fail closed

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess or silently use remembered policy. Preserve durable state and surface the policy conflict before mutation.
