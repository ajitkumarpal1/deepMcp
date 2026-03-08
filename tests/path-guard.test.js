const path = require('path');
const { guardPath } = require('../src/tools/path-guard');

const PROJECT = 'C:\\Users\\Ajit\\my-project';

describe('guardPath — blocks traversal attacks', () => {
  test('rejects ../ traversal', () => {
    expect(() => guardPath('../../.ssh/id_rsa', PROJECT)).toThrow('Path traversal blocked');
  });

  test('rejects absolute path outside project', () => {
    expect(() => guardPath('C:\\Windows\\System32\\drivers\\etc\\hosts', PROJECT)).toThrow();
  });

  test('rejects path that escapes via encoded dots', () => {
    expect(() => guardPath('../etc/passwd', PROJECT)).toThrow('Path traversal blocked');
  });
});

describe('guardPath — allows valid paths', () => {
  test('accepts simple relative path', () => {
    const result = guardPath('src/app.js', PROJECT);
    expect(result).toBe(path.resolve(PROJECT, 'src/app.js'));
  });

  test('accepts nested path', () => {
    const result = guardPath('src/components/Button.tsx', PROJECT);
    expect(result).toBe(path.resolve(PROJECT, 'src/components/Button.tsx'));
  });

  test('accepts file in root', () => {
    const result = guardPath('package.json', PROJECT);
    expect(result).toBe(path.resolve(PROJECT, 'package.json'));
  });
});
