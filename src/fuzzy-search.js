// src/fuzzy-search.js
// Fuzzy SEARCH/REPLACE — 5 strategies, in order of strictness
const logger = require('./logger');
const config = require('./config');

function fuzzyApplyHunk(content, search, replace) {

  // Strategy 1: Exact string match (fastest)
  if (content.includes(search)) {
    return { result: content.replace(search, replace), strategy: 'exact' };
  }

  const cLines = content.split('\n');
  const sLines = search.split('\n').map(l => l.trimEnd());
  const rLines = replace.split('\n');

  // Strategy 2: Trailing whitespace normalized
  for (let i = 0; i <= cLines.length - sLines.length; i++) {
    if (sLines.every((s, j) => cLines[i + j].trimEnd() === s)) {
      const out = [...cLines];
      out.splice(i, sLines.length, ...rLines);
      return { result: out.join('\n'), strategy: 'trim-end' };
    }
  }

  // Strategy 3: Full trim (handles indent drift)
  const sTrimmed = sLines.map(l => l.trim());
  for (let i = 0; i <= cLines.length - sTrimmed.length; i++) {
    if (sTrimmed.every((s, j) => cLines[i + j].trim() === s)) {
      const out = [...cLines];
      out.splice(i, sTrimmed.length, ...rLines);
      return { result: out.join('\n'), strategy: 'full-trim' };
    }
  }

  // Strategy 4: Token similarity score (Jaccard-based)
  const tokenize = s => s.toLowerCase().split(/[\s,;(){}[\]]+/).filter(Boolean);
  const jaccard = (a, b) => {
    const sa = new Set(a), sb = new Set(b);
    const inter = [...sa].filter(x => sb.has(x)).length;
    return inter / (sa.size + sb.size - inter);
  };

  let bestScore = 0, bestIdx = -1;
  for (let i = 0; i <= cLines.length - sLines.length; i++) {
    const windowTokens = tokenize(cLines.slice(i, i + sLines.length).join(' '));
    const searchTokens = tokenize(sLines.join(' '));
    const score = jaccard(windowTokens, searchTokens);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // Only use fuzzy match if confidence meets threshold
  if (bestScore > config.FUZZY_MIN_CONFIDENCE && bestIdx !== -1) {
    logger.warn(`Fuzzy match applied at ${Math.round(bestScore * 100)}% confidence`);
    const out = [...cLines];
    out.splice(bestIdx, sLines.length, ...rLines);
    return { result: out.join('\n'), strategy: `fuzzy-${Math.round(bestScore * 100)}%` };
  }

  // Strategy 5: Large hunk fallback (search constitutes >LARGE_HUNK_RATIO of file → use replace as full file)
  if (sLines.length >= cLines.length * config.LARGE_HUNK_RATIO) {
    logger.warn('Large hunk detected: using REPLACE content as full file');
    return { result: replace, strategy: 'full-replace' };
  }

  return null; // All strategies failed
}

module.exports = { fuzzyApplyHunk };
