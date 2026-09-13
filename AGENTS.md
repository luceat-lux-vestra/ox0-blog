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
- Target public-content source is the Article bundle under `posts/<article>/`: strict `article.json` plus locale Markdown files. Ghost is a projection target, not an editing source.
- `research-to-action` owns research/evidence/promotion governance. RTA state does not authorize Blog publication or project mutation.
- The user normally supplies intent and material decisions. The agent owns routine editing, translation synchronization/review/checkpoints, Git/PR mechanics, validation, and authorized Ghost mechanics.
- Production publication requires an explicit publication instruction unless a separately approved automation policy exists.
- Production publication authorization is task-scoped/transient and must not be reconstructed merely from Article `READY`, Git state, RTA state, or Ghost state after session loss.

## Development and merge policy

During development, normal branch/HEAD movement and fix commits are allowed. Do not rerun the complete strict merge gate after every edit or restack stacked PRs after every upstream commit.

Preparing a coherent candidate is not the same as starting merge judgment. Do **not** enter strict merge judgment or merge unless the user/task explicitly requests merge or explicitly requests merge judgment.

Once merge judgment has explicitly started, correctness/safety not proven is FAIL. `UNKNOWN`, `UNVERIFIED`, and `INSUFFICIENT EVIDENCE` are FAIL. Exact final HEAD is the evidence unit; if it moves, exact-HEAD merge evidence is invalidated. Use squash merge and exact reviewed-head locking where supported.

## Authoring safety

- Technical claims must be traceable to evidence. Distinguish measurement, observation, inference, and opinion.
- Do not publish credentials, personal secrets, private/customer/company details, or raw chat transcripts merely because they appeared in source conversation/RTA context.
- Preserve publisher-owned `#ox0-*` state tags; authors must not add them manually.
- Never put Ghost Admin credentials in source, logs, examples, issues, or pull requests.
- Use Article-wide dry-run/read-only planning before first target mutation when the publication workflow supports it.
- Treat translation checkpoint, Article semantic readiness, projection revision, remote-resource trust, and production authorization as separate proofs. None substitutes for another.
- A remote HTTPS image URL is not immutable-byte evidence. Production use of remote body/feature images requires explicit host `remoteResourcePolicy` approval; otherwise fail closed before Ghost access.
- `PREPARE_PUBLISH`/planning is read-only with respect to Ghost and publication resource storage. A `draft` operation is not read-only: it may stage repository-owned body assets and upload a local feature image before creating/updating the managed Ghost draft.
- The target manual production path is staged: exact `main` source -> optional/read-only plan -> explicit managed draft -> fresh publish plan -> explicit production publish. Production publish requires every required locale to already be an exact-current managed draft, every local body-asset plan to be `reuse`, and the Ghost operation to be draft-to-published `status-update` only.
- The target workflow fresh-reads current `main` before checkout and immediately before operation. These are observational distributed-race guards, not an atomic transaction between Git and Ghost.

## Target Article contract

For new architecture work, prefer the Article path documented by:

- `docs/article-manifest-v1.md`
- `docs/translation-fingerprint-v1.md`
- `docs/article-readiness-v1.md`
- `docs/article-operations.md`
- `docs/asset-publisher.md`
- `docs/remote-resource-policy.md`
- `docs/article-publication.md`
- `docs/staging-live-verification.md`

`npm run dry-run` is the target Article planner. `npm run validate` currently checks both migration-era models. `.github/workflows/article-ghost.yml` is the target manual Article control surface; `.github/workflows/ghost-publish.yml` remains legacy compatibility only.

The Article workflow is `workflow_dispatch` only, operates only on an exact `main` SHA supplied by the control surface, revalidates that SHA against fresh current `main` before execution, and globally serializes Article Ghost operations. `publish` additionally requires exact target confirmation `publish:<manifest_path>@<source_sha>`; this is an exact-target binding, not permission to infer publication from source state.

GitHub only dispatches a new `workflow_dispatch` workflow after that workflow exists on default branch. Therefore pre-merge exact-candidate mutation semantics are proven separately with the staging-only opt-in `npm run verify:article-staging-live`; do not misrepresent that result as proof that the GitHub workflow platform wiring has executed.

## Transitional implementation warning

The authoring branch still contains one-file `:::lang ko/en`, path-derived source identity, source publication `status`, and data-URI body-image mechanisms. They are **transitional compatibility implementation**, not the target content-model contract.

Target architecture/state owners are:

- #3 — Article + LocaleVariant + reviewed translation checkpoints / manifest semantics
- #4 — compiler/ProjectContext/resource boundary and staged Marked -> Arkst migration
- #5 — agent-operated authoring/Git/publication workflow
- #6 — independent Conversation <-> Blog <-> RTA edge contracts
- #7 — orthogonal workflow state machines and operation guards
- #8 — durable bootstrap/governance

Do not extend the transitional bilingual/image/path-identity mechanism as a new target invariant without reconciling those owners and workflow docs first.

## Fail closed

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess or silently use remembered policy. Preserve durable state and surface the policy conflict before mutation.
