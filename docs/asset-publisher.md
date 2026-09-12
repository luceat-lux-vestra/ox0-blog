# Host AssetPublisher contract

`AssetPublisher` is a Blog-host boundary for delivering repository-owned body assets to stable HTTPS URLs.

It is deliberately outside `DocumentCompiler`. Marked/Arkst may observe and rewrite a resource URL supplied by the host, but they do not choose storage, upload bytes, own CDN policy, or define source identity.

## Why this exists

The legacy authoring path embeds local body images as `data:` URIs. That remains compatibility behavior only.

The target Article model needs to preserve three separate facts:

```text
source meaning       = authored ref + exact local bytes
projection rendering = compiled HTML containing stable public URL
storage mutation     = provider-specific upload/reuse operation
```

Conflating these would make translation checkpoints depend on a CDN implementation or make compiler replacement change publication semantics.

## Read-only plan

The host calls conceptually:

```text
AssetPublisher.planAsset({
  ref,
  fingerprint,
  filename,
  size
})
```

where:

- `ref` is a normalized repository `assets/...` reference;
- `fingerprint` is `sha256:<exact current bytes>`;
- `filename` is the source filename;
- `size` is the exact current byte length.

The provider returns:

```text
{
  action: "publish" | "reuse",
  url: "https://...",
  ref,
  fingerprint
}
```

The returned ref/fingerprint must match the exact requested asset and the target URL must be HTTPS.

`planAsset` is a read-only operation. It may inspect provider state to decide `reuse` versus `publish`, but must not upload or mutate storage.

A content-addressed provider is strongly preferred because the same source digest should normally resolve to a stable immutable URL.

## Compiler relationship

Article evaluation first compiles source without committing to storage delivery. The host then:

1. resolves each local compiled resource back to its confined repository `assets/...` ref;
2. verifies its current bytes match translation/material evidence;
3. asks `AssetPublisher` for a read-only target plan;
4. recompiles the same LocaleVariant with a host `resolveResource` callback that substitutes the planned HTTPS URL.

Thus:

```text
translation fingerprint
  hashes authored source + local asset bytes

projection fingerprint
  hashes compiled observable HTML + planned delivery URL + local asset digest evidence
```

The compiler sees only `resolveResource(...) -> { href }`. It never receives the AssetPublisher object.

## Mutation

For `action=publish`, the host re-snapshots the repository asset immediately before provider mutation and requires:

```text
current fingerprint == planned fingerprint
current size        == planned size
```

Only those exact bytes are passed to:

```text
AssetPublisher.publishAsset(asset, bytes, plan)
```

The provider result URL must equal the read-only planned URL. A provider cannot silently upload the content under another URL after the Article projection fingerprint was computed.

For `action=reuse`, the host still revalidates the local source snapshot but performs no storage mutation.

## Article-level ordering

Target Article publication applies asset side effects before the first Ghost mutation.

This avoids the failure mode:

```text
ko Ghost updated
asset upload fails
English Ghost not updated
```

Asset publication itself may still be partially side-effecting if multiple independent assets are planned and a later provider write fails. Such a failure is reported separately with the successfully published asset list; Ghost remains untouched.

After asset side effects, the entire Article is loaded/evaluated/planned again. If Markdown, manifest metadata, translation evidence, asset digest, or planned target URL changed, Ghost mutation is refused.

## Provider neutrality

No concrete CDN/object-storage provider is chosen by this contract. A future provider may target, for example, object storage plus CDN, a dedicated media service, or another immutable HTTPS asset host as long as it satisfies the exact planning/mutation invariants.

Ghost feature images remain a separate Ghost Image API concern. They are not routed through this body-asset contract in v1.

## Non-goals

- AssetPublisher is not a compiler plugin API.
- It is not Article identity.
- It is not a translation checkpoint store.
- It is not publication authorization.
- It does not authorize Ghost mutation.
- It does not make remote third-party HTTP images repository-owned assets.
