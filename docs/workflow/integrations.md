# Conversation ↔ Blog ↔ RTA integration

Model Conversation, `ox0-blog`, and `research-to-action` as three distinct nodes with independent pairwise contracts.

```text
             Conversation
             /          \
            /            \
           v              v
       ox0-blog <------> RTA
```

No edge requires routing through the third node unless the task/evidence genuinely needs it.

## Edge invocation and mutation authority

An observed relationship or useful signal does not itself authorize mutation of the other node.

- A request to author/update Blog content authorizes the requested Blog work unit, not unrelated RTA mutation.
- A request to capture/update RTA authorizes the requested RTA mutation, not Blog authoring/publication.
- Reading Blog or RTA as conversational context is read-only unless the active task requests a durable change.
- A compound request may authorize multiple edges explicitly in one task.
- Production publication and Git merge remain their own explicit authorization boundaries under the Blog workflow contract.

When a read-only task discovers a useful cross-system consequence, the agent may surface or retain it as an in-task signal. Durable mutation of the other repository requires that edge to be authorized by the task/policy. Do not turn “this would be useful to record” into an implicit cross-repository write.

## Conversation → Blog

Direct authoring/update path. RTA is optional.

The agent extracts a public-safe thesis from the conversation, verifies changing facts when needed, creates/updates the Article, synchronizes locales, handles Git/PR, and stops before production publication unless explicitly authorized.

If reusable research is discovered but RTA mutation was not authorized, it may be surfaced as a candidate routing signal rather than silently creating/updating an RTA issue.

## Blog → Conversation

Use current canonical Article source as conversational context for audit, explanation, ideation, or update. Reading/discussing does not itself mutate Blog or RTA.

Prefer repository source over rendered Ghost output when canonical source is available.

If the user asks to update the Article, that request invokes the normal Blog mutation workflow; merely asking for analysis does not.

## Conversation → RTA

Direct research capture path. Blog is optional.

Classify durable material rather than copy transcripts. Search existing RTA ownership before creating an issue. Preserve evidence strength and uncertainty. Capture does not imply promotion.

Before mutation, load and follow `research-to-action/AGENTS.md`. RTA remains authoritative for duplicate handling, lifecycle, evidence discipline, and promotion rules.

## RTA → Conversation

Use the smallest relevant current RTA evidence/decision set as context for design or explanation. Preserve lifecycle state and uncertainty. No Blog/project mutation is implied.

If new evidence is discovered during the conversation, updating RTA is a separate authorized edge rather than an automatic consequence of reading it.

## RTA → Blog

Synthesize one or more RTA items into a public Article. A Blog mutation sourced from private/non-public RTA or Conversation material must pass `PUBLIC_SANITIZATION` **before the first durable mutation in this public repository**.

`PUBLIC_SANITIZATION` requires:

1. treat every issue body, PR body/diff, branch commit, Article source, and Ghost-publication input in this repository as public material;
2. synthesize the engineering conclusion instead of copying private source text or private provenance;
3. remove or generalize organization/customer names, private repository references, internal issue numbers, internal topology, implementation-specific service/module/class/field names, incident-specific facts, and conversation identifiers unless explicitly intended for public disclosure;
4. use public-source or deliberately synthetic/general examples; verify changing factual claims from public sources when material;
5. keep private RTA provenance/backlinks on the private RTA side rather than embedding private RTA references in public Blog artifacts merely for traceability;
6. review the final public diff/body for unique private markers before committing, opening/updating an issue/PR, merging, or publishing;
7. re-run the gate after material content changes; and
8. fail closed when public safety is `UNKNOWN`, `UNVERIFIED`, or supported by `INSUFFICIENT EVIDENCE`.

A blog article is a public synthesis, not the authoritative research record. Private details may remain in RTA under its own policy while the Blog retains only the generalized publishable result.

Creating the Article does not change the source RTA item's lifecycle. Adding a downstream-publication link back to RTA is a separate RTA mutation and must follow the active task's authorization and RTA governance.

## Blog → RTA

Extract reusable engineering claims, counter-evidence, or candidates discovered during Article work. Search existing RTA ownership first. Do not create one RTA issue per blog post by default.

Publication does not validate the research claim.

If the active task authorizes RTA capture/update, append or create the smallest appropriate durable research unit under RTA policy. Otherwise emit/surface an `RTA_REVIEW_NEEDED` / candidate-capture signal without silently mutating RTA.

## Provenance

Use stable references, not copied mutable state.

A private Article manifest/PR may record relevant RTA references such as:

```text
research_refs:
  - research-to-action#8
  - research-to-action#22
```

An RTA issue may receive a chronological comment linking the downstream Article/PR when useful and authorized.

Do not persist ChatGPT conversation/session IDs as required long-lived foreign keys. At durable mutation time, summarize the useful content into the target system.

## No automatic lifecycle propagation

Links convey provenance and review dependencies only.

- RTA `VALIDATED` does not automatically publish/update a blog post.
- Blog publication does not make an RTA item `PROMOTED` or `VALIDATED`.
- RTA `READY` does not authorize project mutation.
- Blog edits do not automatically rewrite RTA evidence/history.

Semantic changes may create work signals:

- new RTA evidence that materially weakens an Article claim → `ARTICLE_REVIEW_NEEDED` signal;
- an Article correction exposing a flawed research claim → `RTA_REVIEW_NEEDED` / counter-evidence signal;
- cosmetic Article changes → no RTA effect;
- RTA label/state-only changes → no Article rewrite.

A signal is not shared state and is not itself mutation authorization. When an authorized workflow durably records a review-needed condition, that record must be recoverable in the owning system and must not silently rewrite the other system's lifecycle.

## Compound requests

A single conversation may intentionally invoke several independent edges.

```text
"방금 얘기한 걸 RTA에 정리하고 블로그 글도 써"
```

may be executed as:

```text
Conversation -> RTA
Conversation -> Blog
```

or, when RTA evidence should explicitly feed the synthesis:

```text
Conversation -> RTA -> Blog
```

Choose the shortest route that preserves correct ownership/provenance; do not force a central workflow engine.

The compound request authorizes only the edges it actually requests. It still does not implicitly authorize RTA promotion, Git merge, or production Blog publication.
