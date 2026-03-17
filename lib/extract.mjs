/**
 * Session title and keyword extraction module.
 *
 * extractTitle(mdContent)   - Extract a human-readable title from session markdown.
 * extractKeywords(titles)   - Compute 1-gram keyword frequency from an array of titles.
 */

const TITLE_MAX_LENGTH = 50;

const SKIP_PATTERNS = [
  /^\[command:/,       // CLI command annotations
  /^\{/,               // JSON objects
  /^\/[\w/.-]+/,       // Absolute file paths
];

/**
 * Extract a title from a session markdown string using a 3-level fallback chain:
 *   1. Explicit "- **Title**: ..." header
 *   2. First meaningful line after a "## User" heading
 *   3. Session ID from the "# Session {id}" heading
 *
 * @param {string} mdContent - Full markdown content of a session file.
 * @returns {string} Extracted title.
 */
export function extractTitle(mdContent) {
  const lines = mdContent.split('\n');

  // --- Fallback 1: explicit Title header ---
  const titleLine = lines.find((l) => /^-\s+\*\*Title\*\*:\s*/.test(l));
  if (titleLine) {
    const value = titleLine.replace(/^-\s+\*\*Title\*\*:\s*/, '').trim();
    if (value.length > 0) {
      return value;
    }
  }

  // --- Fallback 2: first meaningful user message ---
  const userHeadingIndex = lines.findIndex((l) => /^##\s+User\s*$/.test(l));
  if (userHeadingIndex !== -1) {
    for (let i = userHeadingIndex + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();

      // Skip blanks and horizontal rules
      if (line === '' || /^---+$/.test(line)) {
        continue;
      }

      // Stop at the next heading (another section)
      if (/^##\s+/.test(line)) {
        break;
      }

      // Skip lines matching noise patterns
      const isSkippable = SKIP_PATTERNS.some((re) => re.test(line));
      if (isSkippable) {
        continue;
      }

      // Found a meaningful line - truncate if needed
      return line.length > TITLE_MAX_LENGTH
        ? line.slice(0, TITLE_MAX_LENGTH)
        : line;
    }
  }

  // --- Fallback 3: session ID from the top-level heading ---
  const sessionHeading = lines.find((l) => /^#\s+Session\s+/.test(l));
  if (sessionHeading) {
    const id = sessionHeading.replace(/^#\s+Session\s+/, '').trim();
    return `Session ${id}`;
  }

  return 'Untitled';
}

const STOPWORDS = new Set([
  // English
  'session', 'user', 'assistant',
  'the', 'a', 'an', 'is', 'to', 'for', 'and', 'of', 'in',
  // Korean common verbs / fillers
  '\uC644\uB8CC',   // 완료
  '\uD655\uC778',   // 확인
  '\uC218\uC815',   // 수정
  '\uCC98\uB9AC',   // 처리
  '\uCD94\uAC00',   // 추가
  '\uBCC0\uACBD',   // 변경
  '\uC124\uC815',   // 설정
]);

/**
 * Extract top-N 1-gram keywords from an array of title strings.
 *
 * @param {string[]} titles - Array of extracted session titles.
 * @param {number}   topN   - Maximum number of keywords to return (default 20).
 * @returns {[string, number][]} Sorted keyword-count pairs, descending by count.
 */
export function extractKeywords(titles, topN = 20) {
  /** @type {Map<string, number>} */
  const freq = new Map();

  for (const title of titles) {
    const tokens = title.split(/\s+/).filter((t) => t.length > 0);

    for (const raw of tokens) {
      const lower = raw.toLowerCase();
      if (STOPWORDS.has(lower)) {
        continue;
      }
      freq.set(raw, (freq.get(raw) ?? 0) + 1);
    }
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  return sorted.slice(0, topN);
}
