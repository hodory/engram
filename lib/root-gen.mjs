const MAX_LINES = 80;

/**
 * Generate ROOT.md content from monthly nodes and recent sessions.
 * @param {Object} opts
 * @param {{date: string, title: string}[]} opts.recentSessions - sessions from last 7 days
 * @param {{period: string, keywords: [string, number][]}[]} opts.monthlyNodes - all monthly summaries
 * @param {{date: string, title: string}[]} [opts.allSessions] - fallback for when no recent sessions
 * @returns {string}
 */
export function generateRoot({ recentSessions = [], monthlyNodes = [], allSessions = [] }) {
  const lines = [];

  // Active Context
  lines.push('### Active Context');
  let contextSessions = recentSessions;
  if (contextSessions.length === 0 && allSessions.length > 0) {
    // Fallback: last 10 sessions when no sessions in 7 days
    contextSessions = [...allSessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
  }

  if (contextSessions.length === 0) {
    lines.push('(no recent sessions)');
  } else {
    // Group by date, max 10 lines
    const byDate = new Map();
    for (const s of contextSessions) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s.title);
    }

    let contextLines = 0;
    for (const [date, titles] of byDate) {
      if (contextLines >= 10) break;
      const uniqueTitles = [...new Set(titles)].slice(0, 3);
      lines.push(`- ${date}: ${uniqueTitles.join(', ')}`);
      contextLines++;
    }
  }
  lines.push('');

  // Historical Summary (1 line per month)
  lines.push('### Historical Summary');
  const sortedMonths = [...monthlyNodes].sort((a, b) =>
    b.period.localeCompare(a.period)
  );

  // Budget: remaining lines after Active Context and Topics Index header
  const budgetForHistory = Math.max(5, MAX_LINES - lines.length - 15);

  for (const node of sortedMonths.slice(0, budgetForHistory)) {
    const topKeywords = node.keywords.slice(0, 5).map(([k]) => k).join(', ');
    lines.push(`- ${node.period}: ${topKeywords}`);
  }
  lines.push('');

  // Topics Index (global keyword frequency)
  lines.push('### Topics Index');
  const globalKeywords = new Map();
  for (const node of monthlyNodes) {
    for (const [keyword, count] of node.keywords) {
      globalKeywords.set(keyword, (globalKeywords.get(keyword) || 0) + count);
    }
  }

  const sortedKeywords = [...globalKeywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k]) => k);

  if (sortedKeywords.length > 0) {
    lines.push(sortedKeywords.join(' | '));
  } else {
    lines.push('(no topics yet)');
  }

  // Enforce line limit
  const result = lines.slice(0, MAX_LINES);
  return result.join('\n') + '\n';
}
