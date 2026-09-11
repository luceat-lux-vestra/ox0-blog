import { parseBilingualMarkdown } from './bilingual.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { createLegacyInlineImageResolver } from './markdown-assets.mjs';

const compiler = new MarkedCompiler();

function legacyLocale(lang) {
  if (lang === 'ko') return 'ko-KR';
  if (lang === 'en') return 'en';
  return 'und';
}

async function compileOne(markdown, { locale, postPath, repoRoot, resolveResource }) {
  const compiled = await compiler.compile(
    {
      locale,
      body: markdown,
      sourcePath: postPath ?? null
    },
    {
      repoRoot,
      resolveResource
    }
  );
  return compiled.htmlFragment;
}

function wrapBilingual(renderedSections, bilingual) {
  const sections = renderedSections.map((html, index) => {
    const { lang } = bilingual[index];
    return `<section class="ox0-lang" lang="${lang}" data-ox0-lang="${lang}">\n${html}</section>`;
  });
  return `<div class="ox0-bilingual" data-ox0-bilingual="true">\n${sections.join('\n')}\n</div>\n`;
}

// Transitional compatibility adapter for the pre-Article content model.
// New compiler consumers should use DocumentCompiler directly on one LocaleVariant.
export async function renderMarkdown(markdown, { postPath, repoRoot } = {}) {
  const resolveResource = createLegacyInlineImageResolver({ sourcePath: postPath, repoRoot });
  const bilingual = parseBilingualMarkdown(markdown);
  if (!bilingual) {
    return compileOne(markdown, { locale: 'und', postPath, repoRoot, resolveResource });
  }

  const renderedSections = await Promise.all(
    bilingual.map(({ lang, markdown: sectionMarkdown }) => compileOne(sectionMarkdown, {
      locale: legacyLocale(lang),
      postPath,
      repoRoot,
      resolveResource
    }))
  );
  return wrapBilingual(renderedSections, bilingual);
}
