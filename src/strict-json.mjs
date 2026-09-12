function syntaxError(message, offset) {
  throw new Error(`invalid JSON at offset ${offset}: ${message}`);
}

class StrictJsonParser {
  constructor(text) {
    if (typeof text !== 'string') throw new Error('JSON source must be a string');
    this.text = text;
    this.offset = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.offset !== this.text.length) syntaxError('unexpected trailing content', this.offset);
    return value;
  }

  skipWhitespace() {
    while (this.offset < this.text.length && /[\t\n\r ]/.test(this.text[this.offset])) this.offset += 1;
  }

  parseValue() {
    this.skipWhitespace();
    const char = this.text[this.offset];
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"') return this.parseString();
    if (char === '-' || (char >= '0' && char <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.offset)) { this.offset += 4; return true; }
    if (this.text.startsWith('false', this.offset)) { this.offset += 5; return false; }
    if (this.text.startsWith('null', this.offset)) { this.offset += 4; return null; }
    syntaxError('expected JSON value', this.offset);
  }

  parseObject() {
    const object = Object.create(null);
    const keys = new Set();
    this.offset += 1;
    this.skipWhitespace();
    if (this.text[this.offset] === '}') { this.offset += 1; return object; }

    while (true) {
      this.skipWhitespace();
      if (this.text[this.offset] !== '"') syntaxError('object key must be a string', this.offset);
      const key = this.parseString();
      if (keys.has(key)) throw new Error(`duplicate JSON object key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.offset] !== ':') syntaxError('expected colon after object key', this.offset);
      this.offset += 1;
      const value = this.parseValue();
      Object.defineProperty(object, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
      });
      this.skipWhitespace();
      const separator = this.text[this.offset];
      if (separator === '}') { this.offset += 1; return object; }
      if (separator !== ',') syntaxError('expected comma or closing brace', this.offset);
      this.offset += 1;
    }
  }

  parseArray() {
    const values = [];
    this.offset += 1;
    this.skipWhitespace();
    if (this.text[this.offset] === ']') { this.offset += 1; return values; }

    while (true) {
      values.push(this.parseValue());
      this.skipWhitespace();
      const separator = this.text[this.offset];
      if (separator === ']') { this.offset += 1; return values; }
      if (separator !== ',') syntaxError('expected comma or closing bracket', this.offset);
      this.offset += 1;
    }
  }

  parseString() {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.text.length) {
      const char = this.text[this.offset];
      if (char === '"') {
        this.offset += 1;
        const source = this.text.slice(start, this.offset);
        try {
          return JSON.parse(source);
        } catch {
          syntaxError('invalid JSON string', start);
        }
      }
      if (char === '\\') {
        this.offset += 1;
        if (this.offset >= this.text.length) syntaxError('unterminated escape sequence', this.offset);
      }
      this.offset += 1;
    }
    syntaxError('unterminated JSON string', start);
  }

  parseNumber() {
    const source = this.text.slice(this.offset);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source);
    if (!match) syntaxError('invalid JSON number', this.offset);
    const token = match[0];
    this.offset += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) syntaxError('JSON number must be finite', this.offset - token.length);
    return value;
  }
}

export function parseStrictJson(text) {
  return new StrictJsonParser(text).parse();
}
