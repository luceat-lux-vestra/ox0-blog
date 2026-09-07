import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: false
});

export function renderMarkdown(markdown) {
  return marked.parse(markdown, { async: false });
}
