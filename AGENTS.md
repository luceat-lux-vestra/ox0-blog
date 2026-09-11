# ox0-blog authoring rules

- Treat Git Markdown under `posts/` as canonical; do not silently reconcile Ghost-side edits.
- Default every new post to `status: draft`.
- For new technical articles, prefer one post containing complete `ko` and `en` sections using the grammar in `docs/authoring.md`.
- Keep the Korean and English versions semantically equivalent, but do not force literal sentence-by-sentence translation.
- Technical claims must be traceable to evidence. Distinguish measurement, observation, inference, and opinion.
- Benchmark writing must state environment, provenance, semantic-parity constraints, correctness checks, recovery behavior when relevant, and limitations before making performance claims.
- Do not generalize hosted-runner observations into universal language/runtime claims.
- Put local body images under `assets/` and reference them with Markdown image syntax; the renderer validates and embeds them as data URIs. Do not bypass this with raw HTML image elements.
- Preserve `#ox0-*` tags for publisher state; authors must not add them manually.
- Never put Ghost Admin credentials in source, logs, examples, issues, or pull requests.
- Use dry-run before the first mutation of a new post. Publication remains an explicit action.
- CI green is required before merge. UNKNOWN, UNVERIFIED, or insufficient external evidence is not a pass.
