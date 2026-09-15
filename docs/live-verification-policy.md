# Live verification policy

ox0-blog is a personal blog workflow. A separate Ghost staging deployment is **not** a required architectural dependency.

Live verification should minimize user/infrastructure burden and avoid publishing temporary public content merely to prove mechanics.

## Default live proof

Use the configured real Ghost instance with temporary **draft-only** Article projections:

```bash
npm run verify:article-live-draft
```

The verifier may create/delete temporary managed drafts but must never intentionally transition them to `published`.

This live proof is sufficient for:

- target Article review/checkpoint reconstruction;
- managed multi-locale draft creation;
- per-locale `DRAFT_CURRENT` recovery;
- ownership-bound cleanup and residue checks.

It is not proof of production publication.

Cleanup is conservative. The verifier may delete a publisher tag only when it has evidence that the exact tag name was absent before the verifier mutation that could create it, the current tag identity still matches, and the tag is unreferenced. Seeing a publisher tag on a temporary post is not by itself deletion authority.

## Production publication proof

Production publication remains tied to an actual explicit user publication request. Do not publish temporary public posts merely for evidence collection.

The repository's static/adversarial tests and read-only plans must prove the production guard shape before that path is used:

- exact-current managed drafts only;
- `status-update` only;
- no new content/feature-image/body-asset writes in the final promotion step;
- exact source/task authorization;
- source/Ghost/resource-policy revalidation before mutation.

When the user eventually authorizes a real article publication, the actual operation and subsequent fresh projection recovery become the live production-path evidence for that exact source.

## Separate infrastructure

A dedicated staging Ghost may be used voluntarily if one already exists, but the workflow must never require the user to provision and maintain one solely for ox0-blog verification.
