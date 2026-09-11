const ALLOWED_KEYS = new Set([
  'title',
  'slug',
  'status',
  'excerpt',
  'tags',
  'feature_image',
  'feature_image_alt',
  'featured',
  'visibility',
  'canonical_url'
]);

function parseSingleQuoted(value, lineNumber) {
  if (value.length < 2 || !value.endsWith("'")) {
    throw new Error(`invalid single-quoted string at frontmatter line ${lineNumber}`);
  }
  const inner = value.slice(1, -1);
  let result = '';
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] !== "'") {
      result += inner[index];
      continue;
    }
    if (inner[index + 1] !== "'") {
      throw new Error(`invalid single-quoted string at frontmatter line ${lineNumber}`);
    }
    result += "'";
    index += 1;
  }
  return result;
}

function parseScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`invalid quoted string at frontmatter line ${lineNumber}`);
    }
  }

  if (value.startsWith("'")) return parseSingleQuoted(value, lineNumber);

  if (/(?:^|\s)#/.test(value)) {
    throw new Error(`inline YAML comments are not supported at frontmatter line ${lineNumber}; quote the value or use a standalone comment line`);
  }

  return value;
}

function parseBlock(lines, startIndex, style, baseIndent) {
  const parts = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      parts.push('');
      index += 1;
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    parts.push(line.slice(Math.min(indent, baseIndent + 2)));
    index += 1;
  }

  if (style.startsWith('|')) {
    return { value: parts.join('\n') + (style === '|' ? '\n' : ''), nextIndex: index };
  }

  const folded = parts
    .map((part) => part.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { value: folded + (style === '>' ? '\n' : ''), nextIndex: index };
}

export function parseFrontmatterDocument(text) {
  const normalized = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    throw new Error('post must start with YAML frontmatter delimiter ---');
  }

  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('frontmatter closing delimiter --- is missing');

  const fmLines = lines.slice(1, end);
  const data = {};
  let index = 0;

  while (index < fmLines.length) {
    const line = fmLines[index];
    index += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      throw new Error(`unexpected indentation at frontmatter line ${index + 1}`);
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/.exec(line);
    if (!match) throw new Error(`invalid frontmatter syntax at line ${index + 1}`);
    const [, key, rawValue = ''] = match;
    if (!ALLOWED_KEYS.has(key)) throw new Error(`unknown frontmatter key: ${key}`);
    if (Object.hasOwn(data, key)) throw new Error(`duplicate frontmatter key: ${key}`);

    if (rawValue === '|' || rawValue === '|-' || rawValue === '>' || rawValue === '>-') {
      const block = parseBlock(fmLines, index, rawValue, 0);
      data[key] = block.value;
      index = block.nextIndex;
      continue;
    }

    if (rawValue === '') {
      const items = [];
      while (index < fmLines.length) {
        const child = fmLines[index];
        const listMatch = /^\s{2}-\s+(.*)$/.exec(child);
        if (!listMatch) break;
        items.push(parseScalar(listMatch[1], index + 2));
        index += 1;
      }
      data[key] = items.length > 0 ? items : '';
      continue;
    }

    data[key] = parseScalar(rawValue, index + 1);
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  return { data, body };
}
