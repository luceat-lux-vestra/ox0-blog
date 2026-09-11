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

## Conversation → Blog

Direct authoring/update path. RTA is optional.

The agent extracts a public-safe thesis from the conversation, verifies changing facts when needed, creates/updates the Article, synchronizes locales, handles Git/PR, and stops before production publication unless explicitly authorized.

## Blog → Conversation

Use current canonical Article source as conversational context for audit, explanation, ideation, or update. Reading/discussing does not itself mutate Blog or RTA.

Prefer repository source over rendered Ghost output when canonical source is available.

## Conversation → RTA

Direct research capture path. Blog is optional.

Classify durable material rather than copy transcripts. Search existing RTA ownership before creating an issue. Preserve evidence strength and uncertainty. Capture does not imply promotion.

## RTA → Conversation

Use the smallest relevant current RTA evidence/decision set as context for design or explanation. Preserve lifecycle state and uncertainty. No Blog/project mutation is implied.

## RTA → Blog

Synthesize one or more RTA items into a public Article. Recheck time-sensitive public facts, remove private/internal detail, and use normal Article/locale/Git/publication workflow.

A blog article is a public synthesis, not the authoritative research record.

## Blog → RTA

Extract reusable engineering claims, counter-evidence, or candidates discovered during Article work. Search existing RTA ownership first. Do not create one RTA issue per blog post by default.

Publication does not validate the research claim.

## Provenance

Use stable references, not copied mutable state.

A private Article manifest/PR may record relevant RTA references such as:

```text
research_refs:
  - research-to-action#8
  - research-to-action#22
```

An RTA issue may receive a chronological comment linking the downstream Article/PR when useful.

Do not persist ChatGPT conversation/session IDs as required long-lived foreign keys. At durable mutation time, summarize the useful content into the target system.

## No automatic lifecycle propagation

Links convey provenance and review dependencies only.

- RTA `VALIDATED` does not automatically publish/update a blog post.
- Blog publication does not make an RTA item `PROMOTED` or `VALIDATED`.
- RTA `READY` does not authorize project mutation.
- Blog edits do not automatically rewrite RTA evidence/history.

Semantic changes may create work signals:

- new RTA evidence that materially weakens an Article claim → Article review/update needed;
- an Article correction exposing a flawed research claim → append counter-evidence to RTA;
- cosmetic Article changes → no RTA effect;
- RTA label/state-only changes → no Article rewrite.

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
