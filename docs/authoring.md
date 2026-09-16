# Authoring contract

## Source of truth

Ghost is a publishing target, not an editing source.

Each logical Article is stored as one directory:

```text
posts/<article>/
  article.json
  ko-KR.md
  en.md
```

`articleId` and `variantId` are stable logical identities. Repository paths and Ghost slugs are presentation/routing details and may change without changing identity.

Every Markdown file under `posts/` must be claimed by an Article manifest. One-file/frontmatter posts, source publication `status`, `:::lang`, and path-derived source identity are not supported authoring contracts.

## Locale content

Each LocaleVariant owns its own Markdown body and localized metadata such as title/excerpt/slug. Required locales are declared by the Article manifest.

Translation synchronization is evidence-driven. Generating two locale files does not make them equivalent. Current locale fingerprints must be accepted by the translation-review checkpoint before translation state becomes `SYNCED`.

## Semantic readiness

Article readiness is independent from translation state. Semantic review records an exact Article semantic-source fingerprint plus reviewed invalidations. A source/evidence change may recover as `REVIEW_REQUIRED` until reviewed again.

`SYNCED + READY` means the current Article is eligible for production planning. It does not authorize merge or publication.

## Markdown and compiler boundary

Locale Markdown is compiled through:

```text
DocumentCompiler.compile(LocaleVariant, ProjectContext)
  -> CompiledDocument
```

The current backend is `MarkedCompiler`. Raw HTML and unsafe/ambiguous active URLs are rejected. Compiler output is derived state and is not stored as canonical Article source.

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
