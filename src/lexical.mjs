const ALL_MEMBERS_SEGMENT = 'status:free,status:-free';

export function createHtmlCardLexical(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('rendered HTML must be a non-empty string');
  }

  return JSON.stringify({
    root: {
      children: [{
        type: 'html',
        version: 1,
        html,
        visibility: {
          web: {
            nonMember: true,
            memberSegment: ALL_MEMBERS_SEGMENT
          },
          email: {
            memberSegment: ALL_MEMBERS_SEGMENT
          }
        }
      }],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1
    }
  });
}

export function htmlFromSingleCardLexical(lexical) {
  if (typeof lexical !== 'string' || lexical.length === 0) {
    throw new Error('Ghost lexical content must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(lexical);
  } catch {
    throw new Error('Ghost lexical content is not valid JSON');
  }

  const root = parsed?.root;
  if (!root || root.type !== 'root' || root.version !== 1 || !Array.isArray(root.children) || root.children.length !== 1) {
    throw new Error('Ghost lexical content must contain exactly one root HTML card');
  }

  const card = root.children[0];
  if (!card || card.type !== 'html' || card.version !== 1 || typeof card.html !== 'string') {
    throw new Error('Ghost lexical content must contain exactly one valid HTML card');
  }

  return card.html;
}

export function assertHtmlCardContent(lexical, expectedHtml) {
  const actualHtml = htmlFromSingleCardLexical(lexical);
  if (actualHtml !== expectedHtml) {
    throw new Error('Ghost lexical HTML card content differs from rendered source; refusing sync stamp');
  }
}
