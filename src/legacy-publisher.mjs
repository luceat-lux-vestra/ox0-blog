import { sourceTagForPath } from './post.mjs';
import { planProjectionSynchronization, synchronizeProjection } from './publisher.mjs';

function desiredStatusForAction(action) {
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');
  return action === 'publish' ? 'published' : 'draft';
}

async function legacyProjectionArgs({ source, action, client, repoRoot, renderMarkdown }) {
  const desiredStatus = desiredStatusForAction(action);
  if (typeof renderMarkdown !== 'function') throw new Error('renderMarkdown function is required');
  if (source.metadata.status !== desiredStatus) {
    throw new Error(`frontmatter status=${source.metadata.status} does not match requested action=${action}`);
  }

  const html = await renderMarkdown(source.markdown, { postPath: source.postPath, repoRoot });
  const sourceTag = sourceTagForPath(source.postPath, repoRoot);
  return {
    projection: {
      identityTags: [sourceTag],
      title: source.metadata.title,
      slug: source.metadata.slug,
      excerpt: source.metadata.excerpt,
      tags: [...source.metadata.tags],
      featureImage: source.metadata.featureImage,
      featureImageAlt: source.metadata.featureImageAlt,
      featured: source.metadata.featured,
      visibility: source.metadata.visibility,
      canonicalUrl: source.metadata.canonicalUrl
    },
    compiledDocument: {
      htmlFragment: html,
      locale: 'legacy',
      referencedAssets: [],
      diagnostics: []
    },
    action,
    client,
    repoRoot
  };
}

export async function planPostSynchronization(args) {
  return planProjectionSynchronization(await legacyProjectionArgs(args));
}

export async function synchronizePost(args) {
  return synchronizeProjection(await legacyProjectionArgs(args));
}
