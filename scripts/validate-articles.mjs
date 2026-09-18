#!/usr/bin/env node
import { validateArticleRepository } from '../src/article-validation.mjs';

function parseArgs(args) {
  let requireReady = false;
  const requested = [];
  for (const arg of args) {
    if (arg === '--ready') {
      if (requireReady) throw new Error('--ready may be specified only once');
      requireReady = true;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    requested.push(arg);
  }
  return { requireReady, requested };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const articles = await validateArticleRepository(process.cwd(), options);
  const summary = articles.map((article) => ({
    manifest: article.repositoryPath,
    articleId: article.bundle.article.articleId,
    translation: article.evaluation.translation.state,
    readiness: article.evaluation.readiness.state
  }));
  process.stdout.write(`${JSON.stringify({ count: summary.length, articles: summary }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
