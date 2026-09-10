# ox0-blog

Canonical blog source and controlled publishing automation for <https://blog.ox0.uk/>.

## Contract

- Markdown under `posts/` is the source of truth.
- A normal push never changes Ghost.
- Ghost synchronization only runs through the manual **Publish to Ghost** workflow.
- `draft` and `publish` are distinct actions; `draft` refuses to unpublish an already-published post.
- Rendered Markdown is stored directly as one Ghost Lexical HTML card. The publisher does not use Ghost's lossy `?source=html` conversion path. After mutation, the fresh Lexical document must still contain exactly one HTML card whose HTML matches the rendered source before sync metadata can be stamped.
- Post identity is derived from the repository-relative Markdown path and stored as a hidden `#ox0-source-<sha256>` tag. The exact tag **name** is canonical: the publisher resolves Ghost's current tag slug from that name, so internal tag-slug drift does not break identity lookup. Renaming or removing the source tag name destroys that identity and requires operator reconciliation. The public Ghost slug may change without changing identity; moving the Markdown file intentionally changes identity and is treated as a migration. An existing Ghost post with the same public slug is never adopted implicitly.
- Managed Ghost posts also carry a hidden `#ox0-sync:<sha256>` tag. Before each update, the publisher hashes the managed Ghost fields and fails closed if they no longer match that tag. This prevents an out-of-band Ghost Admin edit from being silently overwritten.
- Ghost's required `updated_at` optimistic-concurrency field is also sent on every update.
- `publish`, future scheduling, and deletion are explicit operations. v1 intentionally implements only draft synchronization and publishing; deletion and scheduling are out of scope.
- The Admin API key exists only as a GitHub Actions environment secret. Never commit it or paste it into post sources. The publish job also checks that `github.ref` is `main`; configure the `ox0-blog` environment to allow deployments from `main` only when your GitHub plan supports private-repository environment branch policies.

## Post format

```markdown
---
title: "Example post"
slug: example-post
status: draft
excerpt: "Short description"
tags:
  - Rust
  - Benchmark
feature_image: "../assets/example-post/cover.png"
feature_image_alt: "Chart describing the benchmark"
featured: false
visibility: public
canonical_url: null
---

# Example post

Markdown body.
```

The frontmatter parser is deliberately constrained rather than a general YAML parser. Unknown fields, malformed quoted scalars, unsupported visibility, malformed/oversized slugs and metadata, duplicate author tags, and local images escaping `assets/` fail validation. Post sources and local feature images must be regular files; symlinks in any path component are rejected. Markdown source extensions are exactly lowercase `.md`.

`feature_image` may be an HTTPS URL or a relative file under `assets/`. A local image is uploaded through Ghost's Admin Image API when the workflow runs. Ghost does not expose the resulting upload mapping in the post source, so repeated manual synchronizations of the same local feature image can create duplicate media objects; v1 accepts this bounded side effect rather than storing mutable publisher state in Git.

## Local validation

Node.js 24 is the canonical runtime.

```bash
npm ci --ignore-scripts
npm test
npm run validate
```

Validate one file:

```bash
node scripts/validate-post.mjs posts/example.md
```

## Ghost setup

Create a Ghost **Custom Integration** and configure the GitHub `ox0-blog` environment:

- Environment variable `GHOST_ADMIN_URL` — e.g. `https://blog.ox0.uk` (a secret with the same name is also accepted as a fallback)
- Environment secret `GHOST_ADMIN_API_KEY` — the integration Admin API key (`id:hexsecret`)

The publisher calls the Ghost Admin REST API directly and generates the short-lived HS256 JWT with Node's built-in crypto. The only runtime package dependency is `marked`, pinned by `package-lock.json`, for Markdown rendering. The Lexical HTML-card envelope is generated locally with no additional runtime package.

## Pre-merge live Ghost verification

GitHub only dispatches a `workflow_dispatch` workflow after that workflow file exists on the repository's default branch. Before the publishing workflow has merged, use the checked-out candidate itself for controlled live verification instead of weakening the merge gate.

Prefer a dedicated staging Ghost instance. The verifier is intentionally mutating: it creates uniquely named temporary **draft** content, exercises the publisher, and then deletes the temporary post/page/tags. It refuses to start unless the explicit opt-in variable is set, and cleanup failure makes the command fail rather than reporting a false PASS. Cleanup-only DELETE calls in this verification harness do not constitute delete support in the publishing product.

Run it from the exact candidate commit with Node 24:

```bash
npm ci --ignore-scripts
OX0_GHOST_LIVE_VERIFY=1 \
GHOST_ADMIN_URL=https://your-ghost.example \
GHOST_ADMIN_API_KEY='<id:hexsecret>' \
npm run verify:ghost-live
```

The harness verifies live Ghost behavior for:

- direct Lexical draft creation and fresh-read equality;
- author-tag order plus canonical source/sync publisher tail state;
- source identity lookup after the Ghost tag slug is changed;
- managed public-slug rename without duplicate creation;
- page-slug collision rejection before post creation;
- manual managed-field drift rejection before overwrite;
- cleanup of the temporary verification artifacts.

Do not paste the Admin API key into shell history, logs, issues, pull requests, or repository files. Use an ephemeral environment injection mechanism where available.

## Publishing

Use **Actions → Publish to Ghost → Run workflow**, select `main`, and provide:

- `post_path`: e.g. `posts/oxide-batch-vs-spring-batch.md`
- `action`: `draft` or `publish`

The requested action must match the post's frontmatter `status`. Publishing therefore requires an explicit source change from `status: draft` to `status: published` as well as the explicit workflow action.
