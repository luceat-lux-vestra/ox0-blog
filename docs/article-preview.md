# PR Article Preview

PR Article Preview is a read-only review projection of canonical Article source.

It exists to answer a different question from a pull-request diff:

> What does the exact candidate Article read like when compiled as a complete document?

It is not Ghost state, publication state, or a replacement for source review.

## Boundary

The durable direction is:

```text
Article Source
    |
    v
source loader / adapter
    |
    v
DocumentCompiler
    |
    v
ArticlePreviewBundle
    |
    v
HTML review artifact
```

The GitHub Actions workflow knows only how to select affected Article manifests, invoke the preview CLI, and expose the resulting HTML artifact. It does not parse Markdown and does not know about Marked tokens.

Manifest v1 still owns Markdown source and the current compiler is `MarkedCompiler`. That is an implementation detail below the preview operation. Arkst may later replace the compiler/backend once its parity gates are satisfied.

Supporting Quarkdown or Typst as canonical authoring source requires an explicit future source-storage/loader contract because manifest v1 intentionally accepts only `.md`. That future change must not require redesigning the PR-preview workflow: a new source adapter/compiler should still produce previewable Article output through the same operation boundary.

## Preview bundle v1

`buildArticlePreviewBundle(...)` produces derived in-memory review data containing:

- source revision, when supplied;
- Article identity and source manifest;
- each locale's localized metadata;
- compiled HTML fragment;
- compiler diagnostics;
- exact local material-asset fingerprints observed during preview compilation.

The bundle is not canonical source and is never committed as Article state.

`renderArticlePreviewHtml(...)` serializes that bundle into one standalone review HTML file. The single-file shape is deliberate: GitHub Actions can upload one unarchived artifact that is browsable from the Actions UI without introducing a preview hosting service.

The generated document uses a restrictive Content Security Policy. Raw HTML is still rejected by the current canonical Markdown compiler; preview generation does not weaken compiler safety rules.

## Material resources

The preview operation does not invent an asset-storage policy.

For GitHub PR previews, repository-local body images are resolved to immutable HTTPS URLs bound to:

```text
head repository + exact PR HEAD SHA + repository asset path
```

The builder snapshots each local asset through the existing repository-confinement rules before emitting its URL. External HTTPS images remain authored external resources, but the review artifact CSP does not fetch arbitrary external image origins. Only the exact preview resource origin is allowed.

This keeps the HTML artifact single-file while binding repository-owned images to the exact reviewed source revision and avoids turning PR review into an arbitrary outbound-image request surface.

## GitHub Actions behavior

The `PR Article Preview` job in `.github/workflows/validate.yml` runs after exact-HEAD validation succeeds on non-draft pull requests.

It:

1. checks out the exact PR HEAD SHA;
2. verifies the checkout;
3. installs locked Node.js dependencies without lifecycle scripts;
4. relies on the preceding exact-HEAD validation job as its source-validation gate;
5. selects changed Articles, or all Articles when shared compiler/assets/preview infrastructure changed;
6. builds one exact-HEAD HTML preview;
7. uploads the HTML as an unarchived GitHub Actions artifact;
8. writes the artifact link and selected manifests to the job summary.

It has read-only repository permissions and never receives Ghost credentials.

GitHub artifact retention is intentionally short because preview HTML is derived state.

## Review semantics

Preview success means only that the selected exact source compiled into the review representation.

It does not prove:

- translation equivalence;
- Article semantic readiness;
- Ghost currentness;
- production rendering identity;
- merge safety;
- publication authorization.

Normal repository validation and the strict merge gate remain separate proof obligations.

## Future hosting and Arkst

The HTML serializer is intentionally downstream of Article compilation.

A future implementation may expose the same `ArticlePreviewBundle` through GitHub Pages, another ephemeral preview host, or an Arkst-native HTML backend without changing Article review semantics.

Likewise, a future source contract may support:

```text
Markdown  -> compiler adapter -+
Quarkdown -> Arkst adapter     +-> ArticlePreviewBundle -> preview
Typst     -> Typst/Arkst path -+
```

Those source formats must be added through an explicit versioned authoring contract. PR Preview itself must not become the place where source-format semantics are guessed.
