const OPEN_RE = /^:::lang\s+(ko|en)\s*$/;
const CLOSE_RE = /^:::\s*$/;
const OPEN_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;

function toggledFence(line, activeFence) {
  if (!activeFence) {
    const match = OPEN_FENCE_RE.exec(line);
    if (!match) return null;
    const marker = match[2][0];
    if (marker === '`' && match[3].includes('`')) return null;
    return { marker, length: match[2].length };
  }

  const match = CLOSE_FENCE_RE.exec(line);
  if (!match) return activeFence;
  const marker = match[2][0];
  const length = match[2].length;
  if (activeFence.marker === marker && length >= activeFence.length) return null;
  return activeFence;
}

export function parseBilingualMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const sections = [];
  const outside = [];
  let current = null;
  let fence = null;
  let outsideFence = null;

  for (const line of lines) {
    if (current) {
      const nextFence = toggledFence(line, fence);
      if (!fence && CLOSE_RE.test(line)) {
        const content = current.lines.join('\n').trim();
        if (!content) throw new Error(`bilingual ${current.lang} section must not be empty`);
        sections.push({ lang: current.lang, markdown: `${content}\n` });
        current = null;
        fence = null;
        continue;
      }
      current.lines.push(line);
      fence = nextFence;
      continue;
    }

    const nextOutsideFence = toggledFence(line, outsideFence);
    const open = outsideFence ? null : OPEN_RE.exec(line);
    if (open) {
      if (sections.some((section) => section.lang === open[1])) {
        throw new Error(`duplicate bilingual language section: ${open[1]}`);
      }
      current = { lang: open[1], lines: [] };
      fence = null;
      continue;
    }
    outside.push(line);
    outsideFence = nextOutsideFence;
  }

  if (current) throw new Error(`unclosed bilingual ${current.lang} section`);
  if (sections.length === 0) return null;
  if (outside.some((line) => line.trim() !== '')) {
    throw new Error('bilingual post body may not contain content outside :::lang sections');
  }

  const langs = new Set(sections.map((section) => section.lang));
  if (!langs.has('ko') || !langs.has('en') || sections.length !== 2) {
    throw new Error('bilingual post must contain exactly one ko section and one en section');
  }
  return sections;
}
