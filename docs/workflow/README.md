# Content workflow contract

Contract version: **1**

This directory is the durable operating contract for agent-operated `ox0-blog` work. Account memory and prior chat context are conveniences only; they are not policy authority.

Before Article, translation, RTA-integration, Git/PR, or publication work, read:

1. `AGENTS.md`
2. `docs/workflow/responsibilities.md`
3. `docs/workflow/state-machines.md`
4. `docs/workflow/integrations.md`
5. `docs/workflow/git-policy.md`

Then recover the current repository/Article/RTA/PR state before mutating anything.

## Canonical ownership

- `ox0-blog` owns public Article source, locale variants, translation synchronization, Article Git history, compiler validation, and Ghost projection.
- `research-to-action` owns research/evidence/decision provenance and project-promotion rationale.
- Conversation is the normal interactive control surface. It is not a durable source of truth by default.
- Production publication requires explicit authorization unless a separately approved automation policy exists.

## Core workflow principle

The normal user interface is intent-level language such as:

```text
"이 대화 블로그 글로 만들어"
"RTA에 남겨"
"지난 글 업데이트해"
"이 RTA들로 글 써"
"발행 준비해"
"발행해"
```

The agent owns routine document editing, translation synchronization, reviewed checkpoints, branch/commit/PR mechanics, validation, dry-run, and authorized Ghost mutation.

## Current implementation vs target architecture

Current authoring work may still contain transitional one-file `:::lang` and body-image behavior. Issues #3, #4, #5, #6, and #8 define the target Article/LocaleVariant, compiler, integration, and bootstrap architecture. Do not extend transitional mechanisms into new long-term contracts without reconciling those issues first.

## Fail-closed bootstrap

If required workflow documents are missing, contradictory, or declare an unsupported contract version, do not guess. Preserve current durable state and report the policy conflict before mutation.
