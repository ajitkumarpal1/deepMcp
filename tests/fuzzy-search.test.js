const { fuzzyApplyHunk } = require('../src/fuzzy-search');

describe('fuzzyApplyHunk — Strategy 1: Exact match', () => {
  test('replaces exact substring', () => {
    const content = 'hello world\nfoo bar\nbaz';
    const result  = fuzzyApplyHunk(content, 'foo bar', 'foo baz');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('exact');
    expect(result.result).toBe('hello world\nfoo baz\nbaz');
  });

  test('replaces first occurrence only', () => {
    const content = 'x = 1\nx = 1\nx = 2';
    const result  = fuzzyApplyHunk(content, 'x = 1', 'x = 99');
    expect(result.strategy).toBe('exact');
    // String.replace replaces first occurrence
    expect(result.result).toBe('x = 99\nx = 1\nx = 2');
  });
});

describe('fuzzyApplyHunk — Strategy 2: Trailing whitespace', () => {
  test('matches lines that have trailing spaces in file', () => {
    const content = 'line one  \nline two\nline three';
    const result  = fuzzyApplyHunk(content, 'line one\nline two', 'replaced one\nreplaced two');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('trim-end');
    expect(result.result).toBe('replaced one\nreplaced two\nline three');
  });
});

describe('fuzzyApplyHunk — Strategy 3: Full trim (indent drift)', () => {
  test('matches indented code block with non-indented search', () => {
    const content = '  function foo() {\n    return 1;\n  }';
    const result  = fuzzyApplyHunk(
      content,
      'function foo() {\nreturn 1;\n}',
      'function foo() {\nreturn 2;\n}'
    );
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('full-trim');
  });

  test('matches deeply indented code', () => {
    const content = '        const x = 1;\n        const y = 2;';
    const result  = fuzzyApplyHunk(content, 'const x = 1;\nconst y = 2;', 'const x = 10;\nconst y = 20;');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('full-trim');
  });
});

describe('fuzzyApplyHunk — Strategy 5: Large hunk fallback', () => {
  test('uses full replace when search is >= 50% of file and does not match exactly', () => {
    // Search has ONE different line so strategies 1-3 fail (no exact/trim match).
    // Token similarity is below 0.70 (one unique token differs).
    // search = 4 lines, file = 4 lines → 100% >= 50% → triggers full-replace.
    const content = 'line1\nmodified-line2\nline3\nline4';
    const search  = 'line1\noriginal-line2\nline3\nline4';
    const result  = fuzzyApplyHunk(content, search, 'totally new content');
    expect(result).not.toBeNull();
    expect(result.strategy).toBe('full-replace');
    expect(result.result).toBe('totally new content');
  });
});

describe('fuzzyApplyHunk — No match', () => {
  test('returns null when nothing matches', () => {
    const content = 'completely\ndifferent\ncontent here';
    const result  = fuzzyApplyHunk(content, 'nothing to find XXXX', 'replacement');
    expect(result).toBeNull();
  });

  test('returns null when search is short and tokens share nothing with file', () => {
    // 10-line file, 2-line search → 20% (below S5 threshold).
    // Tokens are completely disjoint → fails all strategies.
    const content = 'apple\nbanana\ncherry\ndate\neggplant\nfig\ngrape\nhoneydew\nkiwi\nlemon';
    const result  = fuzzyApplyHunk(content, 'XYZZY\nFROBNITZ', 'replacement');
    expect(result).toBeNull();
  });
});

describe('fuzzyApplyHunk — CRLF handling', () => {
  test('caller is expected to normalize CRLF before calling', () => {
    const content = 'foo\nbar\nbaz';
    const result  = fuzzyApplyHunk(content, 'foo\nbar', 'qux\nquux');
    expect(result).not.toBeNull();
    expect(result.result).toBe('qux\nquux\nbaz');
  });
});
