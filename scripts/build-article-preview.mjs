#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildArticlePreviewBundle, renderArticlePreviewHtml } from '../src/article-preview.mjs';

function parseArgs(args) {
  let output = null;
  let resourceBaseUrl = null;
  let sourceRevision = null;
  let manifestList = null;
  const manifests = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output' || arg === '--resource-base-url' || arg === '--source-revision' || arg === '--manifest-list') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--output') output = value;
      else if (arg === '--resource-base-url') resourceBaseUrl = value;
      else if (arg === '--source-revision') sourceRevision = value;
      else manifestList = value;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    manifests.push(arg);
  }

  if (!output) throw new Error('--output is required');
  if (manifestList && manifests.length > 0) {
    throw new Error('use either --manifest-list or positional manifests, not both');
  }
  return { output, resourceBaseUrl, sourceRevision, manifestList, manifests };
}

async function manifestPaths(options) {
  if (!options.manifestList) return options.manifests;
  const text = await readFile(options.manifestList, 'utf8');
  return text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifests = await manifestPaths(options);
  if (manifests.length === 0) throw new Error('no Article manifests selected for preview');

  const bundle = await buildArticlePreviewBundle({
    repoRoot: process.cwd(),
    manifestPaths: manifests,
    resourceBaseUrl: options.resourceBaseUrl,
    sourceRevision: options.sourceRevision
  });
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderArticlePreviewHtml(bundle), 'utf8');

  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    sourceRevision: bundle.sourceRevision,
    articles: bundle.articles.map((article) => ({
      articleId: article.articleId,
      manifest: article.manifest,
      locales: article.variants.map((variant) => variant.locale)
    }))
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
