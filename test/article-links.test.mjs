import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectMarkdownLinks,
  managedArticleRoute,
  relatedArticlesSection,
  validateArticleLinks
} from '../src/article-links.mjs';

function article({
  repositoryPath,
  articleId,
  locale = 'en',
  variantId,
  slug,
  body
}) {
  return {
    repositoryPath,
    bundle: {
      article: {
        articleId,
        requiredLocales: [locale],
        variants: [{
          variantId,
          locale,
          slug,
          body,
          title: slug,
          excerpt: null,
          sourcePath: null
        }]
      }
    }
  };
}

test('collectMarkdownLinks finds normal links but not images', () => {
  assert.deepEqual(
    collectMarkdownLinks('[A](/alpha/)\n![image](https://example.com/a.png)\n[B](https://example.com)'),
    [
      { href: '/alpha/', text: 'A' },
      { href: 'https://example.com', text: 'B' }
    ]
  );
});

test('managedArticleRoute reserves only root single-slug paths', () => {
  assert.deepEqual(managedArticleRoute('/alpha/'), {
    slug: 'alpha',
    canonical: true,
    href: '/alpha/'
  });
  assert.equal(managedArticleRoute('/tag/engineering/'), null);
  assert.equal(managedArticleRoute('/'), null);
  assert.equal(managedArticleRoute('https://example.com/alpha/'), null);
});

test('Related Articles section is optional and uniquely identified', () => {
  assert.equal(relatedArticlesSection('# A\n\nText\n'), null);
  assert.match(
    relatedArticlesSection('# A\n\n## Related Articles\n\n- [B](/beta/)\n\n## Sources\n'),
    /\/beta\//
  );
  assert.throws(
    () => relatedArticlesSection('## Related Articles\n\n## Related Articles\n'),
    /duplicate/
  );
});

test('managed Article links resolve by slug and preserve locale', () => {
  const articles = [
    article({
      repositoryPath: 'posts/a/article.json',
      articleId: 'a',
      variantId: 'a-en',
      slug: 'alpha',
      body: '# A\n\nSee [B](/beta/).\n\n## Related Articles\n\n- [B](/beta/)\n'
    }),
    article({
      repositoryPath: 'posts/b/article.json',
      articleId: 'b',
      variantId: 'b-en',
      slug: 'beta',
      body: '# B\n'
    })
  ];
  assert.equal(validateArticleLinks(articles), articles);
});

test('broken and non-canonical managed Article routes fail closed', () => {
  const target = article({
    repositoryPath: 'posts/b/article.json',
    articleId: 'b',
    variantId: 'b-en',
    slug: 'beta',
    body: '# B\n'
  });

  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        variantId: 'a-en',
        slug: 'alpha',
        body: '# A\n\n[Missing](/missing/)\n'
      }),
      target
    ]),
    /broken managed Article link/
  );

  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        variantId: 'a-en',
        slug: 'alpha',
        body: '# A\n\n[B](/beta)\n'
      }),
      target
    ]),
    /canonical trailing-slash route/
  );
});

test('managed Article links cannot silently cross locale variants', () => {
  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        locale: 'ko-KR',
        variantId: 'a-ko',
        slug: 'alpha',
        body: '# A\n\n[English B](/beta-en/)\n'
      }),
      article({
        repositoryPath: 'posts/b/article.json',
        articleId: 'b',
        locale: 'en',
        variantId: 'b-en',
        slug: 'beta-en',
        body: '# B\n'
      })
    ]),
    /locale mismatch/
  );
});

test('Related Articles is a managed navigation list, not arbitrary prose', () => {
  const target = article({
    repositoryPath: 'posts/b/article.json',
    articleId: 'b',
    variantId: 'b-en',
    slug: 'beta',
    body: '# B\n'
  });
  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        variantId: 'a-en',
        slug: 'alpha',
        body: '# A\n\n## Related Articles\n\nBeta\n'
      }),
      target
    ]),
    /must contain only Markdown bullet links/
  );
  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        variantId: 'a-en',
        slug: 'alpha',
        body: '# A\n\n## Related Articles\n\n- [External](https://example.com)\n'
      }),
      target
    ]),
    /must use managed Article routes/
  );
  assert.throws(
    () => validateArticleLinks([
      article({
        repositoryPath: 'posts/a/article.json',
        articleId: 'a',
        variantId: 'a-en',
        slug: 'alpha',
        body: '# A\n\n## Related Articles\n\n- [Self](/alpha/)\n'
      }),
      target
    ]),
    /must not link to the current variant/
  );
});

test('non-Article routes and external links remain outside the managed Article namespace', () => {
  const articles = [
    article({
      repositoryPath: 'posts/a/article.json',
      articleId: 'a',
      variantId: 'a-en',
      slug: 'alpha',
      body: [
        '# A',
        '',
        '[Home](/)',
        '[Tag](/tag/engineering/)',
        '[External](https://example.com/path)',
        '[Fragment](#details)'
      ].join('\n')
    })
  ];
  assert.equal(validateArticleLinks(articles), articles);
});
