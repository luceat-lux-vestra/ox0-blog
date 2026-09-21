# Profile Publications refresh operations

The Blog publication workflows may notify the profile repository after successful Ghost publication by sending a `blog-publication` repository dispatch.

This downstream notification never authorizes, repairs, rolls back, or changes Ghost publication.

## Observable outcomes

The publication workflow records one of three outcomes without printing the token value:

- **dispatch accepted** — the GitHub API accepted the repository dispatch;
- **hourly fallback** — `PROFILE_REPO_DISPATCH_TOKEN` is not configured, so the profile repository's scheduled refresh remains the recovery path;
- **dispatch failed** — the API call failed and the workflow fails after publication. Ghost publication is not rolled back; the scheduled profile refresh remains the recovery path.

The outcome is emitted as an Actions notice/warning/error and in `GITHUB_STEP_SUMMARY`.

## Verify configuration without reading a secret value

Check repository-level secret names:

```bash
gh secret list --repo luceat-lux-vestra/ox0-blog
```

Check environment-level secret names:

```bash
gh secret list --repo luceat-lux-vestra/ox0-blog --env ox0-blog
```

A configured `PROFILE_REPO_DISPATCH_TOKEN` may exist at either applicable scope. These commands list secret metadata/names; they do not reveal secret values.

For the publication environment itself:

```bash
gh api repos/luceat-lux-vestra/ox0-blog/environments/ox0-blog
```

## Closeout evidence

For a publication-affecting merge, retain or inspect:

1. the exact reviewed PR head and its required checks;
2. the actual merged `main` SHA;
3. the `main` workflow run for that exact SHA;
4. the profile refresh outcome from the publication job summary when publication occurred.

Do not infer a successful immediate profile refresh merely from successful Ghost publication.
