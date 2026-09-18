# Authoring contract

## Source of truth

Ghost is a publishing target, not an editing source.

Each logical Article is stored as one directory:

```text
posts/<article>/
  article.json
  claim-proof.json   # required for READY, may be absent while still DRAFT
  ko-KR.md
  en.md
```

`articleId` and `variantId` are stable logical identities. Repository paths and Ghost slugs are presentation/routing details and may change without changing identity.

Every Markdown file under `posts/` must be claimed by an Article manifest. One-file/frontmatter posts, source publication `status`, `:::lang`, and path-derived source identity are not supported authoring contracts.

## Locale content

Each LocaleVariant owns its own Markdown body and localized metadata such as title/excerpt/slug. Required locales are declared by the Article manifest.

Translation synchronization is evidence-driven. Generating two locale files does not make them equivalent. Current locale fingerprints must be accepted by the translation-review checkpoint before translation state becomes `SYNCED`.

## Semantic readiness

Article readiness is independent from translation state. A reviewed Article requires both exact source evidence and durable claim proof.

`claim-proof.json` classifies material claims, records source roles/counter-evidence, applies stronger recommendation proof, and records cross-claim/adversarial review PASS. Its covered translation fingerprints must match the exact current source.

Readiness checkpoint v2 binds both the Article semantic-source fingerprint and claim-proof fingerprint. Source or proof changes recover as `REVIEW_REQUIRED` until reviewed again. A new Article may remain `DRAFT` before claim proof exists; claim proof becomes mandatory for READY.

`SYNCED + READY` means the current Article is eligible for production planning. It does not authorize merge or publication.

See `docs/article-claim-proof.md`.

## Markdown and compiler boundary

Locale Markdown is compiled through:

```text
DocumentCompiler.compile(LocaleVariant, ProjectContext)
  -> CompiledDocument
```

The current backend is `MarkedCompiler`. Raw HTML and unsafe/ambiguous active URLs are rejected. Compiler output is derived state and is not stored as canonical Article source.

## PR review preview

A pull-request preview is a derived review projection, not canonical source and not Ghost state.

```text
Article source
→ source loader/compiler boundary
→ ArticlePreviewBundle
→ standalone HTML review artifact
```

The current source is Markdown and the current compiler is `MarkedCompiler`, but the preview workflow itself does not parse Markdown. This keeps the review operation reusable if a later versioned source contract adds Arkst/Quarkdown/Typst adapters.

Repository-local body images in CI preview are bound to immutable raw URLs for the exact PR head repository and SHA after the normal repository asset-confinement checks.

See `docs/article-preview.md`.

## Body assets

Repository-owned body images are referenced from locale Markdown and must resolve inside repository `assets/`. Source evaluation fingerprints their exact bytes.

Delivery is not owned by the compiler. A host `AssetPublisher` maps exact repository asset evidence to stable credential-free HTTPS delivery. Draft or published-revision operations may prepare an asset when required; production planning revalidates exact ref/digest/size/target evidence before Ghost mutation.

External HTTPS images remain authored URLs. Production use requires current explicit host `remoteResourcePolicy` approval.

## Feature images

Feature image metadata is stored per LocaleVariant publication metadata. A local feature image must resolve inside repository `assets/` and is fingerprinted by exact bytes. Publication uses Ghost's Image API and treats upload as a non-transactional side effect; a later post mutation failure may leave orphan media, which is reported as bounded evidence rather than silently rolled back.

## Authoring flow

A typical new Article flow is:

```text
create Article manifest + locale Markdown
→ validate
→ translation review/checkpoint
→ semantic readiness review
→ plan-draft
→ draft
→ plan-publish
→ explicit publish
```

An already-published Article revision remains public:

```text
edit source
→ revalidate/review as needed
→ plan-publish
→ explicit published-revision update
```

It is not temporarily unpublished merely to stage an edit.

## Validation

```bash
npm run validate
npm run validate:articles
npm run validate:articles -- --ready
```

Repository validation checks the complete Article corpus and rejects unclaimed Markdown, nested bundles, duplicate IDs/slugs, symlinks, invalid source/resource references, and compiler/evidence errors.

## Publication authorization

`draft|publish` is an explicit operation. Production publication authorization is task-scoped under `docs/workflow/`; it is not stored in `article.json`, inferred from Article readiness, recovered from Ghost status, or implied by merge state.

See `docs/article-manifest-v1.md`, `docs/article-review-operations.md`, `docs/article-operations.md`, and `docs/article-publication.md` for the detailed contracts.
