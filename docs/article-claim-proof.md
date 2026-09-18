# Article claim proof v1

Article claim proof is durable, reviewable evidence for material technical claims in one Article.

It is stored beside canonical source:

```text
posts/<article>/
  article.json
  claim-proof.json
  ko-KR.md
  en.md
```

The sidecar is not Article prose, hidden reasoning, or a confidence score. It records the bounded evidence needed to decide whether the current source may recover as `READY`.

## Why this exists

Article-level semantic review alone can miss local errors such as:

- a factual source being stretched into a recommendation;
- an OSS issue being treated as best-practice guidance;
- a later example contradicting an earlier decision rule;
- a framework example being mistaken for a recommended architecture;
- a responsibility classification that changes silently across sections.

The user is not the default technical fact checker. These are workflow proof obligations.

## Claim classes

Each material claim is classified as one of:

- `fact`
- `classification`
- `recommendation`
- `example_interpretation`

A material claim is one whose falsity could materially change an engineering decision, responsibility boundary, recommendation, or public explanation.

## Source roles

Evidence declares what kind of source it is:

- `specification`
- `official_reference`
- `architecture_guidance`
- `repository_evidence`
- `experiment`
- `incident`
- `public_example`
- `practitioner_commentary`

Source role limits claim strength. Every evidence item also records a concise `relevance` statement describing what that source establishes for this claim. Duplicate evidence URLs within one claim are rejected, so one source cannot be counted twice merely under different roles.

A public example can prove that a design exists in practice; it does not by itself prove that the design is preferred.

## Recommendation proof

A recommendation can PASS only as:

- `direct_guidance`: at least one `architecture_guidance` or `specification` source directly supports the recommendation; or
- `bounded_judgment`: at least two non-commentary evidence items are present and the proof explicitly records conditions and alternatives.

A tutorial, public issue, or code example alone cannot establish default/best-practice language. Even bounded judgment requires at least one substantive non-example source role in addition to multiple relevant evidence items.

## Claim coverage

Before individual claims can be trusted, the extraction pass itself must record PASS for:

- material claims extracted from the final source;
- recommendation/default/preference language scanned;
- responsibility/classification statements scanned;
- examples and tutorials scanned for implied general conclusions.

This does not make semantic extraction mathematically complete, but it makes omission a named proof obligation rather than an invisible assumption.

## Counter-evidence

Every claim records either:

- `PRESENT` with explicit counter-evidence; or
- `REVIEWED_NONE_FOUND` after a bounded search.

The required `counterEvidenceReview` field summarizes the bounded search/review performed. Absence of counter-evidence is not inferred merely because none was initially supplied.

## Cross-claim consistency

The proof must PASS all required checks and persist a concise review summary:

- examples follow the Article's own rules;
- descriptive evidence is not silently converted into normative guidance;
- responsibility classifications remain consistent;
- dedicated abstractions identified earlier are not bypassed later;
- exceptions are not generalized into defaults.

## Independent adversarial review

A fresh review pass must also persist a concise summary and PASS checks that challenge:

- the strongest material claim;
- recommendation/source-role fit;
- source overreach;
- omitted alternatives;
- the claim most likely to be challenged by a domain expert.

The proof records only stable bounded results, not chain-of-thought or model/session identity.

## Source binding

`coveredTranslationFingerprints` must exactly match the current required locale fingerprints.

The proof itself receives a versioned SHA-256 fingerprint. Readiness checkpoint v2 binds:

```text
exact Article semantic-source fingerprint
+
exact claim-proof fingerprint
+
reviewed invalidation epoch/id set
```

Therefore:

- Article source changes -> proof becomes stale;
- claim proof changes -> prior READY becomes REVIEW_REQUIRED;
- missing proof -> a reviewed/legacy READY cannot recover as READY;
- a new unrevised Article may remain DRAFT before semantic review begins.

## Fail-closed rule

`FAIL`, `UNVERIFIED`, `INSUFFICIENT_EVIDENCE`, missing proof, stale proof, unsupported proof versions, or malformed proof prevent READY.

Claim proof complements translation review, `PUBLIC_SANITIZATION`, and `PUBLIC_EXAMPLE_RESEARCH`; it does not replace them.
