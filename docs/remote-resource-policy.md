# Production remote-resource policy

Target Article source may reference external HTTPS images, but a URL is not evidence of immutable bytes.

For that reason the target workflow distinguishes:

```text
draft planning/mutation
  external HTTPS image URL may remain an external dependency

production publish
  external HTTPS image requires explicit host trust policy approval
```

## Default production rule

Production publication fails closed when a required LocaleVariant contains either:

- a remote HTTPS body image; or
- a remote HTTPS feature image;

and no host `remoteResourcePolicy` is configured.

The check runs after Article `SYNCED + READY` recovery but before the first Ghost read.

This rule does not apply to ordinary hyperlinks. It applies to externally rendered image resources whose bytes can change independently of the canonical Blog repository.

## Host policy contract

A repository-confined `host/*.mjs` runtime module may export:

```js
export async function remoteResourcePolicy(resource) {
  return {
    decision: 'ALLOW',
    evidence: 'trusted-static-cdn-v1'
  };
}
```

The input contains only normalized source identity/context:

```text
kind      = body-image | feature-image
href      = normalized HTTPS URL
articleId
locale
variantId
```

The policy must return either:

```text
{ decision: "ALLOW", evidence: "<stable bounded evidence>" }
```

or:

```text
{ decision: "DENY", reason: "<bounded reason>" }
```

Missing policy, malformed decisions, missing ALLOW evidence, or explicit DENY all fail closed for production publish.

## What ALLOW means

`ALLOW` is a **host trust assertion**, not a remote-byte attestation performed by ox0-blog.

The core workflow deliberately does not fetch arbitrary external image URLs in order to hash them. Doing so would introduce additional network trust, SSRF, redirect, timeout, authentication, content-type, and mutable-cache semantics into the compiler/publication boundary.

A host policy may approve URLs because, for example:

- the hostname/path is controlled by the same operator;
- the URL is content-addressed or versioned under an externally enforced immutable policy;
- another reviewed deployment contract guarantees immutability.

The evidence string identifies the policy basis used for the current plan. It must not contain credentials or secret material.

## Plan and mutation binding

Approved remote resources are recorded per LocaleVariant in the read-only publication plan:

```text
remoteResourceApprovals[] = {
  kind,
  href,
  evidence
}
```

Article mutation performs the complete publication preparation a second time before the first Ghost mutation.

The refreshed remote approvals must exactly match the initial plan. If URL, resource kind, or policy evidence changes, publication stops with `SOURCE_REVALIDATION` before Ghost mutation.

This makes a changing host trust decision visible rather than silently carrying an earlier approval forward.

## Source and projection fingerprints

The authored remote URL remains part of Markdown/projection source. Remote bytes are not inserted into translation or projection fingerprints because ox0-blog did not observe those bytes.

Therefore:

- changing the authored URL changes canonical source/projection evidence;
- changing bytes behind an unchanged approved external URL is outside repository-observed evidence;
- the host policy is responsible for the trust/immutability assertion that makes such a URL acceptable for production.

If exact byte ownership is required, store the asset under repository `assets/` and publish it through the target `AssetPublisher` instead.

## Non-goals

- This policy does not authorize production publication.
- It does not replace Article `SYNCED + READY`.
- It does not replace exact task-scoped publication authorization.
- It does not fetch, cache, mirror, or delete third-party resources.
- It does not turn an external resource into repository-owned content.
