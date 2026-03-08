const os   = require('os');
const ResponseParser = require('../src/response-parser');

// Use OS temp dir as a safe project path for tests
const parser = new ResponseParser(os.tmpdir());

// ─── parse() ─────────────────────────────────────────────────────────────────

describe('ResponseParser.parse — SEARCH/REPLACE blocks', () => {
  test('parses a single SEARCH/REPLACE block', () => {
    const response = `### src/app.js
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;
    const changes = parser.parse(response);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('patch');
    expect(changes[0].hunks).toHaveLength(1);
    expect(changes[0].hunks[0].search).toBe('const x = 1;');
    expect(changes[0].hunks[0].replace).toBe('const x = 2;');
  });

  test('parses multiple hunks for the same file', () => {
    const response = `### src/app.js
<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

### src/app.js
<<<<<<< SEARCH
const b = 2;
=======
const b = 20;
>>>>>>> REPLACE`;
    const changes = parser.parse(response);
    expect(changes).toHaveLength(1);
    expect(changes[0].hunks).toHaveLength(2);
  });

  test('parses hunks for multiple different files', () => {
    const response = `### src/a.js
<<<<<<< SEARCH
old a
=======
new a
>>>>>>> REPLACE

### src/b.js
<<<<<<< SEARCH
old b
=======
new b
>>>>>>> REPLACE`;
    const changes = parser.parse(response);
    expect(changes).toHaveLength(2);
  });
});

describe('ResponseParser.parse — Full file blocks (new files)', () => {
  test('parses ### path + code block as full file', () => {
    const response = "### src/newfile.js\n```js\nconst hello = 'world';\n```";
    const changes = parser.parse(response);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('full');
    expect(changes[0].content).toContain("const hello = 'world'");
  });

  test('SEARCH/REPLACE takes priority over full-file for same path', () => {
    const response =
      "### src/app.js\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n\n" +
      "### src/app.js\n```js\nfull content\n```";
    const changes = parser.parse(response);
    // Patch wins; no duplicate entry
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('patch');
  });
});

// ─── parseContextRequests() ──────────────────────────────────────────────────

describe('ResponseParser.parseContextRequests', () => {
  test('parses NEED_CONTEXT block with FILE and QUESTION lines', () => {
    const response = `NEED_CONTEXT:
FILE: src/app.js
FILE: src/utils.ts
QUESTION: What framework is used?`;
    const result = parser.parseContextRequests(response);
    expect(result).not.toBeNull();
    expect(result.files).toContain('src/app.js');
    expect(result.files).toContain('src/utils.ts');
    expect(result.questions).toContain('What framework is used?');
  });

  test('returns null when response contains code (not a context request)', () => {
    const response = "Here is the updated code:\n```js\nconsole.log('hi');\n```";
    expect(parser.parseContextRequests(response)).toBeNull();
  });

  test('returns null when no FILE or QUESTION lines present', () => {
    const response = 'The component looks good. No changes needed.';
    expect(parser.parseContextRequests(response)).toBeNull();
  });

  test('handles bare FILE: paths without NEED_CONTEXT block', () => {
    const response = 'FILE: src/components/Button.tsx\nFILE: src/App.tsx';
    const result = parser.parseContextRequests(response);
    expect(result).not.toBeNull();
    expect(result.files).toContain('src/components/Button.tsx');
    expect(result.files).toContain('src/App.tsx');
  });
});

// ─── hasContinuationSignal() ─────────────────────────────────────────────────

describe('ResponseParser.hasContinuationSignal', () => {
  test.each([
    ["I'll continue with more files..."],
    ['Here are the remaining files'],
    ["I'll now create the config file"],
    ['continuing with the rest'],
    ['more files to add'],
  ])('detects signal: %s', (text) => {
    expect(parser.hasContinuationSignal(text)).toBe(true);
  });

  test.each([
    ['Done! All changes applied.'],
    ['Let me know if you need anything else.'],
    ['Here is the complete implementation.'],
  ])('rejects non-signal: %s', (text) => {
    expect(parser.hasContinuationSignal(text)).toBe(false);
  });

  test('returns false for null/undefined input', () => {
    expect(parser.hasContinuationSignal(null)).toBe(false);
    expect(parser.hasContinuationSignal(undefined)).toBe(false);
    expect(parser.hasContinuationSignal('')).toBe(false);
  });
});
