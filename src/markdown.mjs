import { marked } from 'marked';
import { parseBilingualMarkdown } from './bilingual.mjs';
import { createMarkdownAssetWalker } from './markdown-assets.mjs';

marked.use({
  gfm: true,
  breaks: false
});

function isPromiseLike(value) {
  return value != null && typeof value.then === 'function';
}

function renderOne(markdown, walkAssetToken) {
  const tokens = marked.lexer(markdown);
  const pending = marked.walkTokens(tokens, walkAssetToken).filter(isPromiseLike);
  if (pending.length === 0) return marked.parser(tokens);
  return Promise.all(pending).then(() => marked.parser(tokens));
}

function wrapBilingual(renderedSections, bilingual) {
  const sections = renderedSections.map((html, index) => {
    const { lang } = bilingual[index];
    return `<section class="ox0-lang" lang="${lang}" data-ox0-lang="${lang}">\n${html}</section>`;
  });
  return `<div class="ox0-bilingual" data-ox0-bilingual="true">\n${sections.join('\n')}\n</div>\n`;
}

export function renderMarkdown(markdown, { postPath, repoRoot } = {}) {
  const walkAssetToken = createMarkdownAssetWalker({ postPath, repoRoot });
  const bilingual = parseBilingualMarkdown(markdown);
  if (!bilingual) return renderOne(markdown, walkAssetToken);

  const renderedSections = bilingual.map(({ markdown: sectionMarkdown }) => renderOne(sectionMarkdown, walkAssetToken));
  if (renderedSections.some(isPromiseLike)) {
    return Promise.all(renderedSections).then((resolved) => wrapBilingual(resolved, bilingual));
  }
  return wrapBilingual(renderedSections, bilingual);
}
