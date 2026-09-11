function tagNames(tags) {
  return (tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
}

export async function assertDesiredSlugAvailable(client, desiredSlug, existing) {
  const occupyingPost = await client.getPostBySlug(desiredSlug);
  if (existing?.slug === desiredSlug) {
    if (!occupyingPost || occupyingPost.id !== existing.id) {
      throw new Error(`Ghost slug ${desiredSlug} no longer resolves to the expected managed post; refusing mutation`);
    }
  } else if (occupyingPost) {
    throw new Error(`Ghost slug ${desiredSlug} is already occupied by a post; refusing mutation`);
  }

  const occupyingPage = await client.getPageBySlug(desiredSlug);
  if (occupyingPage) {
    throw new Error(`Ghost slug ${desiredSlug} is already occupied by a page; refusing mutation`);
  }
}

export function assertMutationApplied(post, payload) {
  if (!post || typeof post !== 'object') {
    throw new Error('Ghost mutation did not return a post for verification');
  }

  const checks = [
    ['title', post.title, payload.title],
    ['slug', post.slug, payload.slug],
    ['custom_excerpt', post.custom_excerpt ?? null, payload.custom_excerpt ?? null],
    ['feature_image', post.feature_image ?? null, payload.feature_image ?? null],
    ['feature_image_alt', post.feature_image_alt ?? null, payload.feature_image_alt ?? null],
    ['featured', post.featured, payload.featured],
    ['visibility', post.visibility, payload.visibility],
    ['status', post.status, payload.status],
    ['canonical_url', post.canonical_url ?? null, payload.canonical_url ?? null]
  ];

  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`Ghost mutation did not apply managed field ${field} exactly; refusing sync stamp`);
    }
  }

  const actualTags = tagNames(post.tags);
  const expectedTags = tagNames(payload.tags);
  if (actualTags.length !== expectedTags.length || actualTags.some((tag, index) => tag !== expectedTags[index])) {
    throw new Error('Ghost mutation did not preserve managed tag order exactly; refusing sync stamp');
  }

  if (post.lexical !== payload.lexical) {
    throw new Error('Ghost Lexical document differs; expected the requested direct Lexical representation exactly; refusing sync stamp');
  }
}
