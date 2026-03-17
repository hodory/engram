import { describe, expect, test } from 'bun:test';
import { extractTitle, extractTitleFromJsonl, extractSessionDate, extractKeywords } from '../lib/extract.mjs';

// ---------------------------------------------------------------------------
// extractTitle
// ---------------------------------------------------------------------------
describe('extractTitle', () => {
  test('extracts title from "- **Title**: ..." header', () => {
    const md = [
      '# Session abc123',
      '',
      '- **Title**: fix-deprecated v2 설계',
      '',
      '---',
    ].join('\n');

    expect(extractTitle(md)).toBe('fix-deprecated v2 설계');
  });

  test('falls back to first meaningful user message', () => {
    const md = [
      '# Session abc123',
      '',
      '---',
      '',
      '## User',
      '',
      'ghost 성능 분석해줘',
    ].join('\n');

    expect(extractTitle(md)).toBe('ghost 성능 분석해줘');
  });

  test('skips [command:] lines and uses next meaningful line', () => {
    const md = [
      '# Session abc123',
      '',
      '---',
      '',
      '## User',
      '',
      '[command: effort]',
      '[command: model]',
      'MakeGhostProduct 쿼리 분석',
    ].join('\n');

    expect(extractTitle(md)).toBe('MakeGhostProduct 쿼리 분석');
  });

  test('skips JSON object lines', () => {
    const md = [
      '# Session abc123',
      '',
      '---',
      '',
      '## User',
      '',
      '{"type": "config"}',
      'Redis 캐시 설정 변경',
    ].join('\n');

    expect(extractTitle(md)).toBe('Redis 캐시 설정 변경');
  });

  test('skips file path lines', () => {
    const md = [
      '# Session abc123',
      '',
      '---',
      '',
      '## User',
      '',
      '/Users/user/workspace/my-project/app/Product/manifest.xml',
      '상품 매니페스트 수정',
    ].join('\n');

    expect(extractTitle(md)).toBe('상품 매니페스트 수정');
  });

  test('truncates title to 50 characters', () => {
    const longMessage =
      'A'.repeat(60) + ' 이 메시지는 50자를 초과하므로 잘려야 합니다';
    const md = [
      '# Session abc123',
      '',
      '---',
      '',
      '## User',
      '',
      longMessage,
    ].join('\n');

    const result = extractTitle(md);
    expect(result.length).toBe(50);
    expect(result).toBe(longMessage.slice(0, 50));
  });

  test('falls back to session ID when no title and no user message', () => {
    const md = [
      '# Session abc12345',
      '',
      '---',
      '',
      '## User',
      '',
      '[command: effort]',
    ].join('\n');

    expect(extractTitle(md)).toBe('Session abc12345');
  });

  test('falls back to session ID when there is no ## User section', () => {
    const md = ['# Session def99999', '', '---'].join('\n');

    expect(extractTitle(md)).toBe('Session def99999');
  });

  test('returns "Untitled" when nothing is found', () => {
    const md = ['Some random content', '', 'no headings at all'].join('\n');

    expect(extractTitle(md)).toBe('Untitled');
  });

  test('skips blank lines and --- between ## User and first message', () => {
    const md = [
      '# Session x',
      '',
      '---',
      '',
      '## User',
      '',
      '',
      '---',
      '',
      '실제 메시지',
    ].join('\n');

    expect(extractTitle(md)).toBe('실제 메시지');
  });
});

// ---------------------------------------------------------------------------
// extractTitleFromJsonl
// ---------------------------------------------------------------------------
describe('extractTitleFromJsonl', () => {
  function jsonl(...entries) {
    return entries.map(e => JSON.stringify(e)).join('\n');
  }

  test('extracts title from first real user message', () => {
    const content = jsonl(
      { type: 'progress', timestamp: '2026-03-17T10:00:00Z', data: { type: 'hook_progress' } },
      { type: 'user', message: { role: 'user', content: 'engram 성능 분석해줘' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] } },
    );

    expect(extractTitleFromJsonl(content)).toBe('engram 성능 분석해줘');
  });

  test('extracts text from content array', () => {
    const content = jsonl(
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'API 설계 검토' }] } },
    );

    expect(extractTitleFromJsonl(content)).toBe('API 설계 검토');
  });

  test('skips tool result messages', () => {
    const content = jsonl(
      { type: 'user', message: { role: 'user', content: [{ tool_use_id: 'x', type: 'tool_result', content: 'OK' }] }, toolUseResult: { mode: 'content' }, sourceToolAssistantUUID: 'abc' },
      { type: 'user', message: { role: 'user', content: 'Redis 캐시 설정' } },
    );

    expect(extractTitleFromJsonl(content)).toBe('Redis 캐시 설정');
  });

  test('skips isMeta messages', () => {
    const content = jsonl(
      { type: 'user', isMeta: true, message: { role: 'user', content: 'system init' } },
      { type: 'user', message: { role: 'user', content: '실제 메시지' } },
    );

    expect(extractTitleFromJsonl(content)).toBe('실제 메시지');
  });

  test('skips noise patterns (commands, JSON, file paths)', () => {
    const content = jsonl(
      { type: 'user', message: { role: 'user', content: '[command: effort]' } },
      { type: 'user', message: { role: 'user', content: '{"type": "config"}' } },
      { type: 'user', message: { role: 'user', content: '/Users/foo/bar.txt' } },
      { type: 'user', message: { role: 'user', content: 'ghost 배치 최적화' } },
    );

    expect(extractTitleFromJsonl(content)).toBe('ghost 배치 최적화');
  });

  test('truncates long titles to 50 characters', () => {
    const longMsg = 'A'.repeat(60);
    const content = jsonl(
      { type: 'user', message: { role: 'user', content: longMsg } },
    );

    expect(extractTitleFromJsonl(content)).toBe(longMsg.slice(0, 50));
  });

  test('uses first line of multiline message', () => {
    const content = jsonl(
      { type: 'user', message: { role: 'user', content: '첫 번째 줄\n두 번째 줄\n세 번째 줄' } },
    );

    expect(extractTitleFromJsonl(content)).toBe('첫 번째 줄');
  });

  test('returns Untitled when no user messages', () => {
    const content = jsonl(
      { type: 'progress', data: { type: 'hook_progress' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    );

    expect(extractTitleFromJsonl(content)).toBe('Untitled');
  });

  test('handles empty content gracefully', () => {
    expect(extractTitleFromJsonl('')).toBe('Untitled');
  });

  test('handles malformed JSON lines gracefully', () => {
    const content = 'not json\n{"type":"user","message":{"role":"user","content":"OK 메시지"}}\n{broken';

    expect(extractTitleFromJsonl(content)).toBe('OK 메시지');
  });
});

// ---------------------------------------------------------------------------
// extractSessionDate
// ---------------------------------------------------------------------------
describe('extractSessionDate', () => {
  test('extracts date from first entry timestamp', () => {
    const content = JSON.stringify({ type: 'progress', timestamp: '2026-03-17T14:23:35.134Z' });

    expect(extractSessionDate(content)).toBe('2026-03-17');
  });

  test('returns null for entry without timestamp', () => {
    const content = JSON.stringify({ type: 'progress', data: {} });

    expect(extractSessionDate(content)).toBeNull();
  });

  test('returns null for empty content', () => {
    expect(extractSessionDate('')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(extractSessionDate('not json at all')).toBeNull();
  });

  test('only reads first line', () => {
    const content = [
      JSON.stringify({ type: 'progress', timestamp: '2026-01-15T10:00:00Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-01-16T10:00:00Z' }),
    ].join('\n');

    expect(extractSessionDate(content)).toBe('2026-01-15');
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------
describe('extractKeywords', () => {
  test('returns top keywords sorted by frequency', () => {
    const titles = [
      'ghost 성능 분석',
      'ghost 쿼리 최적화',
      'ghost 배치 성능',
      'Redis 캐시 분석',
    ];

    const result = extractKeywords(titles, 5);

    // "ghost" appears 3 times, should be first
    expect(result[0]).toEqual(['ghost', 3]);
    // "성능" appears 2 times
    const perf = result.find(([word]) => word === '성능');
    expect(perf).toEqual(['성능', 2]);
    // "분석" appears 2 times
    const analysis = result.find(([word]) => word === '분석');
    expect(analysis).toEqual(['분석', 2]);
  });

  test('removes stopwords', () => {
    const titles = [
      'Session abc 완료',
      'User 확인 수정',
      'the a an is to for and of in',
      '처리 추가 변경 설정',
      'Assistant 결과',
    ];

    const result = extractKeywords(titles, 20);
    const words = result.map(([w]) => w);

    // All stopwords should be filtered out
    const stopwords = [
      'Session', 'User', 'Assistant',
      '완료', '확인', '수정', '처리', '추가', '변경', '설정',
      'the', 'a', 'an', 'is', 'to', 'for', 'and', 'of', 'in',
    ];

    for (const sw of stopwords) {
      expect(words).not.toContain(sw);
    }

    // Non-stopwords should remain
    expect(words).toContain('abc');
    expect(words).toContain('결과');
  });

  test('handles Korean + English mixed titles', () => {
    const titles = [
      'Product API 수정',
      'Product 목록 조회',
      'Order API 연동',
      'Product ghost 배치',
    ];

    const result = extractKeywords(titles, 10);
    const words = result.map(([w]) => w);

    // "Product" appears 3 times (stopword "수정" removed, so Product stays)
    expect(result[0]).toEqual(['Product', 3]);
    // "API" appears 2 times
    expect(words).toContain('API');
    const api = result.find(([w]) => w === 'API');
    expect(api).toEqual(['API', 2]);
  });

  test('respects topN limit', () => {
    const titles = ['a1 b1 c1 d1 e1 f1 g1 h1 i1 j1 k1'];

    const result = extractKeywords(titles, 3);
    expect(result.length).toBe(3);
  });

  test('returns empty array for empty input', () => {
    expect(extractKeywords([])).toEqual([]);
  });

  test('stopword filtering is case-insensitive', () => {
    const titles = ['SESSION session Session user USER User'];

    const result = extractKeywords(titles, 20);
    expect(result.length).toBe(0);
  });

  test('defaults topN to 20', () => {
    // Generate 30 unique tokens
    const tokens = Array.from({ length: 30 }, (_, i) => `token${i}`);
    const titles = [tokens.join(' ')];

    const result = extractKeywords(titles);
    expect(result.length).toBe(20);
  });
});
