/**
 * Determine status for a monthly node.
 * @param {string} period - "YYYY-MM"
 * @param {number} sessionCount
 * @param {Date} now
 * @param {string|null} currentStatus - existing status if node already exists
 * @returns {'tentative'|'fixed'|'needs-summarization'|'summarized'}
 */
export function determineStatus(period, sessionCount, now = new Date(), currentStatus = null) {
  // If already fixed or summarized and no new sessions, keep status
  if (currentStatus === 'fixed') return 'fixed';

  const [year, month] = period.split('-').map(Number);
  const periodEnd = new Date(year, month, 0); // last day of the month
  const daysSinceEnd = (now - periodEnd) / (1000 * 60 * 60 * 24);

  // Current or recent month → tentative
  if (daysSinceEnd < 7) {
    return 'tentative';
  }

  // Past month, ended 7+ days ago
  if (sessionCount > 30) {
    // Already summarized by LLM → don't re-mark as needs-summarization
    if (currentStatus === 'summarized') return 'fixed';
    return 'needs-summarization';
  }

  return 'fixed';
}

/**
 * Generate a monthly compaction node markdown string.
 * @param {Object} opts
 * @param {string} opts.period - "YYYY-MM"
 * @param {{date: string, title: string, source: string}[]} opts.sessions
 * @param {[string, number][]} opts.keywords
 * @param {string} opts.status
 * @returns {string}
 */
export function generateMonthlyNode({ period, sessions, keywords, status }) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push('type: monthly');
  lines.push(`status: ${status}`);
  lines.push(`period: ${period}`);
  lines.push(`last-updated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`session-count: ${sessions.length}`);
  lines.push(`sources: [${period}/*.md]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${period} Summary`);
  lines.push('');

  // Key Topics (top 10 keywords grouped)
  lines.push('## Key Topics');
  const topKeywords = keywords.slice(0, 10);
  for (const [keyword, count] of topKeywords) {
    lines.push(`- ${keyword} (${count})`);
  }
  lines.push('');

  // Session Titles (all, sorted by date desc)
  lines.push('## Session Titles');
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  for (const s of sorted) {
    const dayPart = s.date.slice(5); // "MM-DD"
    lines.push(`- ${dayPart}: ${s.title}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Parse existing monthly node to extract status.
 * @param {string} content - markdown content
 * @returns {{status: string, sessionCount: number} | null}
 */
export function parseMonthlyNode(content) {
  const statusMatch = content.match(/^status:\s*(.+)$/m);
  const countMatch = content.match(/^session-count:\s*(\d+)$/m);
  if (!statusMatch) return null;
  return {
    status: statusMatch[1].trim(),
    sessionCount: countMatch ? parseInt(countMatch[1], 10) : 0,
  };
}
