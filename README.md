# ox0-blog

Canonical blog source and controlled publishing automation for <https://blog.ox0.uk/>.

## Contract

- Markdown under `posts/` is the source of truth.
- A normal push never changes Ghost.
- Ghost synchronization only runs through the manual **Publish to Ghost** workflow.
- The manual workflow defaults to `dry-run`; `draft` and `publish` are separate explicit mutating actions.
- `draft` refuses to unpublish an already-published post.
- Rendered Markdown is stored directly as one Ghost Lexical HTML card. The publisher does not use Ghost's lossy `?source=html` conversion path. After content mutation, a fresh GET must preserve the exact HTML-card content before sync metadata can be stamped; after stamping, the persisted managed state and source ownership are read and verified again before success is returned.
- Post identity is derived from the repository-relative Markdown path and stored as a hidden `#ox0-source-<sha256>` tag. The exact tag **name** is canonical: the publisher resolves Ghost's current tag slug from that name, so internal tag-slug drift does not break identity lookup. Renaming or removing the source tag name destroys that identity and requires operator reconciliation. Changing the public Ghost slug keeps identity; moving the Markdown file intentionally changes identity and is a migration boundary. An existing Ghost post with the same public slug is never adopted implicitly.
- Managed Ghost posts carry a hidden `#ox0-sync:<sha256>` tag. Managed-field drift in Ghost fails closed before overwrite, in addition to Ghost's `updated_at` optimistic-concurrency check.
- Ghost mutation responses explicitly request `formats=lexical`, and Ghost Admin fetch/body reads use a bounded timeout.
- `publish`, future scheduling, and deletion are explicit operations. v1 intentionally implements only dry-run, draft synchronization, and publishing; deletion and scheduling are out of scope.
- The Admin API key exists only as a GitHub Actions environment secret. Never commit it or paste it into post sources. The publish job also refuses non-`main` refs; configure the `ox0-blog` environment to allow deployments from `main` only when your GitHub plan supports private-repository environment branch policies.

## Post format

```markdown
---
title: "Example post"
slug: example-post
status: draft
excerpt: "Short canonical summary"
tags:
  - Rust
  - Benchmark
feature_image: "../assets/example-post/cover.png"
feature_image_alt: "Chart describing the benchmark"
featured: false
visibility: public
canonical_url: null
---

:::lang ko

## 문제 / 동기

한국어 본문.

:::

:::lang en

## Problem / Motivation

English body.

:::
```

Bilingual sections are optional for legacy/monolingual sources. If `:::lang` is used, exactly one `ko` and one `en` section are required and body content outside them is rejected. See `docs/authoring.md` and `templates/technical-post.md`.

The bilingual wrapper is rendered into the same direct Lexical HTML card as monolingual content. Preservation of its `lang` and `data-ox0-*` attributes through a live Ghost create/update/fetch round trip remains **UNVERIFIED** until the integration gate is executed. Ghost title/excerpt remain one canonical metadata value in v1.

The frontmatter parser is deliberately constrained rather than a general YAML parser. Unknown fields, malformed quoted scalars, unsupported visibility, malformed/oversized slugs and metadata, duplicate author tags, duplicate repository slugs/titles, invalid bilingual structure, and local images escaping `assets/` fail validation. Post sources and local feature images must be regular files; symlinks in any path component are rejected. Markdown source extensions are exactly lowercase `.md`.

`feature_image` may be an HTTPS URL or a relative file under `assets/`. A local image is uploaded through Ghost's Admin Image API when a mutating workflow runs. Ghost does not expose the resulting upload mapping in the post source, so repeated manual synchronizations of the same local feature image can create duplicate media objects; v1 accepts this bounded side effect rather than storing mutable publisher state in Git.

## Local validation

Node.js 24 is the canonical runtime.

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

Validating one selected file still evaluates repository-wide invariants:

```bash
node scripts/validate-post.mjs posts/example.md
```

## Ghost setup

Create a Ghost **Custom Integration** and configure the GitHub `ox0-blog` environment:

- Environment variable `GHOST_ADMIN_URL` — e.g. `https://blog.ox0.uk` (a secret with the same name is also accepted as a fallback)
- Environment secret `GHOST_ADMIN_API_KEY` — the integration Admin API key (`id:hexsecret`)

The publisher calls the Ghost Admin REST API directly and generates the short-lived HS256 JWT with Node's built-in crypto. The only runtime package dependency is `marked`, pinned by `package-lock.json`, for Markdown rendering. The Lexical HTML-card envelope is generated locally with no additional runtime package.

## Dry-run

With Ghost credentials in the environment:

```bash
npm run dry-run -- posts/example.md
```

Dry-run performs Ghost read inspection only. It does not upload images, create posts, update posts, or stamp sync metadata. It reports the intended create/update operation, status, source identity, tags, rendered HTML size, and feature-image action.

## Pre-merge live Ghost verification

GitHub only dispatches a `workflow_dispatch` workflow after that workflow file exists on the repository's default branch. Before the publishing workflow has merged, use the checked-out candidate itself for controlled live verification instead of weakening the merge gate.

Prefer a dedicated staging Ghost instance. The verifier is intentionally mutating: it creates uniquely named temporary **draft** content, exercises the publisher, and then deletes the temporary post/page/tags. It refuses to start unless the explicit opt-in variable is set. It also checks that its temporary slugs/tags are unused before mutation, and cleanup failure makes the command fail rather than reporting a false PASS. Cleanup-only DELETE calls in this verification harness do not constitute delete support in the publishing product.

Run it from the **exact PR candidate commit** with Node 24:

```bash
npm ci --ignore-scripts
OX0_GHOST_LIVE_VERIFY=1 \
GHOST_ADMIN_URL=https://your-ghost.example \
GHOST_ADMIN_API_KEY='<id:hexsecret>' \
npm run verify:ghost-live
```

Record the exact Git commit SHA together with the PASS output. If the PR HEAD moves afterward, that live result is no longer merge-gate evidence for the new HEAD and must be rerun.

On the authoring stack, the verifier uses a bilingual `ko`/`en` source and therefore also proves that the rendered `data-ox0-bilingual`, `lang`, and `data-ox0-lang` wrapper attributes survive the direct Lexical Ghost round trip.

The harness verifies live Ghost behavior for:

- pinned Markdown rendering followed by direct Lexical draft creation and fresh-read equality;
- bilingual wrapper persistence on the authoring stack;
- author-tag order plus canonical source/sync publisher tail state;
- source identity lookup after the Ghost tag slug is changed;
- managed public-slug rename without duplicate creation;
- page-slug collision rejection before post creation;
- manual managed-field drift rejection before overwrite;
- cleanup of the temporary verification artifacts.

The presence of this harness is **not** live-integration evidence by itself. The merge gate still requires a PASS from the exact candidate against an authorized Ghost instance.

Do not paste the Admin API key into shell history, logs, issues, pull requests, or repository files. Use an ephemeral environment injection mechanism where available.

## Publishing

Use **Actions → Publish to Ghost → Run workflow**, select `main`, and provide:

- `post_path`: e.g. `posts/oxide-batch-vs-spring-batch.md`
- `action`: `dry-run`, `draft`, or `publish`

`dry-run` is the default. `draft` and `publish` mutate Ghost. A mutating action must agree with frontmatter status, so publishing requires both a source change to `status: published` and an explicit `publish` workflow action.

## Deliberate v1 boundaries

- Schedule/delete are not implemented publishing features.
- Moving/renaming a Markdown file changes source identity and requires explicit migration.
- Renaming/removing the hidden `#ox0-source-<sha256>` tag name destroys the publisher identity and requires operator reconciliation; changing only that tag's Ghost slug is tolerated.
- Workflow-level concurrency serializes this publisher's own mutations, but external Ghost edits/integrations can still race. The publisher fails closed on races it observes through optimistic concurrency, post-mutation verification, and post-stamp re-reads; these client-side checks are not a server-side uniqueness guarantee.
- Re-syncing an unchanged local feature image can create a duplicate/orphan Ghost media object; v1 documents this bounded side effect rather than committing mutable upload state.
- Bilingual automatic browser-side ordering is specified but not enabled until live Ghost round-trip preservation is proven.
- Bilingual title/card metadata is deferred; the Ghost title and excerpt remain canonical single fields.
