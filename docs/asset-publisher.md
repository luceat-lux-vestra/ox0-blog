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

The returned ref/fingerprint must match the exact requested asset and the target URL must be credential-free HTTPS. URL user-info such as `https://user:password@host/...` is rejected at the generic AssetPublisher boundary rather than copied into public compiled HTML.

`planAsset` is a read-only operation. It may inspect provider state to decide `reuse` versus `publish`, but must not upload or mutate storage.

A content-addressed provider is strongly preferred because the same source digest should normally resolve to a stable immutable URL.

## Compiler relationship

Article evaluation first compiles source without committing to storage delivery. The host then:

1. resolves each local compiled resource back to its confined repository `assets/...` ref;
2. verifies its current bytes match translation/material evidence;
3. asks `AssetPublisher` for a read-only target plan;
4. recompiles the same LocaleVariant with a host `resolveResource` callback that substitutes the planned HTTPS URL.

The LocaleVariant's already-resolved `ProjectContext` is preserved during step 4. Asset delivery overrides only `resolveResource`; it must not discard unrelated compiler/VirtualProject context.

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

The provider result URL must equal the read-only planned URL and remain credential-free HTTPS. A provider cannot silently upload the content under another URL after the Article projection fingerprint was computed.

For `action=reuse`, the host still revalidates the local source snapshot but performs no storage mutation. The low-level reuse helper validates the planned public URL even when invoked independently of the normal planning path.

## Content-addressed object-store adapter

The branch includes `createContentAddressedAssetPublisher(...)` as a vendor-neutral concrete delivery policy over an abstract public object store.

It requires:

```text
publicBaseUrl: credential-free HTTPS base URL
headObject({ key }) -> null | { size, sha256 }
putObject({ key, bytes, contentType, sha256, size, sourceRef })
```

The object key is deterministic from the source digest and normalized image extension:

```text
sha256/<first-two-hex>/<full-sha256><extension>
```

For example:

```text
https://cdn.example/blog-assets/
  sha256/ab/abcdef...1234.png
```

The adapter deliberately does **not** treat path existence as proof of reusable content.

A `reuse` plan requires the existing object's metadata to prove both:

```text
stored size   == source size
stored sha256 == source sha256
```

A metadata mismatch fails closed as a storage-integrity/collision problem.

For `publish`, the adapter additionally:

1. hashes the exact bytes it receives and requires the planned SHA-256;
2. writes to the deterministic content key;
3. performs `headObject` again after the write;
4. requires the stored size/SHA-256 metadata to match exactly;
5. only then returns the already-planned public URL.

The adapter currently supports the image formats already accepted by canonical Markdown asset validation (`webp`, `jpg/jpeg`, `gif`, `png`, `svg`).

### Backend obligations

This adapter still does not choose a cloud vendor. An R2/S3/OCI/etc. backend must provide `headObject` and `putObject` while preserving the SHA-256 metadata contract.

The backend must not reinterpret `headObject != null` as sufficient reuse evidence. The exact metadata is part of the proof obligation.

Because keys are content-addressed, an idempotent overwrite of identical content may be acceptable for a backend implementation, but silent replacement with content whose metadata does not match the key is not.

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

No concrete cloud/CDN vendor is chosen by this contract. The provided content-addressed adapter defines the storage semantics while keeping the transport/backend pluggable.

A deployment may bind it to object storage plus CDN, a dedicated media service exposing equivalent HEAD/PUT semantics, or another immutable HTTPS asset host as long as the exact planning/mutation invariants hold.

Ghost feature images remain a separate Ghost Image API concern. They are not routed through this body-asset contract in v1.

## Non-goals

- AssetPublisher is not a compiler plugin API.
- It is not Article identity.
- It is not a translation checkpoint store.
- It is not publication authorization.
- It does not authorize Ghost mutation.
- It does not make remote third-party HTTP images repository-owned assets.
