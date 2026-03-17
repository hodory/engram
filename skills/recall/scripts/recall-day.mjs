#!/usr/bin/env bun
/**
 * Recall sessions by date from native Claude Code JSONL files.
 *
 * Usage:
 *   recall-day.mjs list DATE_EXPR [--project PATH] [--all-projects] [--min-msgs N]
 *   recall-day.mjs expand SESSION_ID [--project PATH] [--all-projects] [--max-msgs N]
 *
 * DATE_EXPR examples: yesterday, today, 2026-02-25, "last tuesday", "this week",
 *                     "last week", "3 days ago", "last 3 days"
 *
 * All dates use the system's local timezone. Every Claude Code user has JSONL
 * session files in ~/.claude/projects/. No custom setup needed.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const LOCAL_OFFSET_MS = -new Date().getTimezoneOffset() * 60 * 1000;
const LOCAL_TZ_NAME = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Patterns to strip from user messages
const STRIP_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<command-name>[\s\S]*?<\/command-name>\s*<command-message>[\s\S]*?<\/command-message>\s*(?:<command-args>[\s\S]*?<\/command-args>)?/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<teammate-message[^>]*>[\s\S]*?<\/teammate-message>/g,
  /<claude-mem-context>[\s\S]*?<\/claude-mem-context>/g,
  /<available-deferred-tools>[\s\S]*?<\/available-deferred-tools>/g,
];

const DAY_NAMES = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

// ---------------------------------------------------------------------------
// Local timezone helpers
// ---------------------------------------------------------------------------

/**
 * Return the current time as a Date adjusted to local timezone (the Date object itself
 * stays in UTC, but its numeric value reflects the local timezone wall-clock moment for
 * arithmetic that only uses getTime()).
 *
 * We represent "local timezone midnight" as UTC midnight of the local timezone calendar date, i.e.
 * we shift the epoch value by +9 h so that floor-to-day gives the local timezone date.
 */

/** @returns {Date} today's midnight in local timezone, represented as a UTC Date */
function localTodayStart() {
  const nowUtcMs = Date.now();
  const nowKstMs = nowUtcMs + LOCAL_OFFSET_MS;
  const kstMidnightMs = Math.floor(nowKstMs / 86400000) * 86400000;
  // Convert back to a real UTC epoch that, when displayed as UTC, equals local timezone midnight
  return new Date(kstMidnightMs - LOCAL_OFFSET_MS);
}

/** @param {Date} d @returns {Date} */
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

/** @param {Date} d @returns {number} 0=Mon..6=Sun in local timezone */
function localWeekday(d) {
  const kstMs = d.getTime() + LOCAL_OFFSET_MS;
  // JS getUTCDay(): 0=Sun..6=Sat; shift to Mon-based
  const jsDay = new Date(kstMs).getUTCDay(); // 0=Sun
  return (jsDay + 6) % 7; // 0=Mon..6=Sun
}

/** @param {string} isoStr ISO-8601 timestamp string @returns {Date} */
function parseIso(isoStr) {
  return new Date(isoStr.replace('Z', '+00:00'));
}

/** @param {Date} d @returns {boolean} whether d falls in local timezone [start, end) */
function inLocalRange(d, start, end) {
  return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
}

/**
 * Format a UTC Date as local timezone HH:MM.
 * @param {Date} d
 * @returns {string}
 */
function fmtLocalTime(d) {
  const kst = new Date(d.getTime() + LOCAL_OFFSET_MS);
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const m = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Format a UTC Date as local timezone YYYY-MM-DD (Day).
 * @param {Date} d
 * @returns {string}
 */
function fmtLocalDate(d) {
  const kst = new Date(d.getTime() + LOCAL_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(kst.getUTCDate()).padStart(2, '0');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[kst.getUTCDay()];
  return `${y}-${mo}-${dy} (${dayName})`;
}

/**
 * Format a UTC Date as local timezone YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
function fmtLocalDateOnly(d) {
  const kst = new Date(d.getTime() + LOCAL_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
}

// ---------------------------------------------------------------------------
// Exported: parse_date_expr
// ---------------------------------------------------------------------------

/**
 * Parse a date expression into [start, end) Date range in local timezone.
 *
 * Returns start of day (inclusive) and end of day (exclusive) as UTC Dates
 * whose values correspond to local timezone midnight boundaries.
 *
 * @param {string} expr
 * @returns {[Date, Date]}
 */
export function parseDateExpr(expr) {
  expr = expr.trim().toLowerCase();
  const todayStart = localTodayStart();

  if (expr === 'today') {
    return [todayStart, addDays(todayStart, 1)];
  }

  if (expr === 'yesterday') {
    const start = addDays(todayStart, -1);
    return [start, todayStart];
  }

  // YYYY-MM-DD
  const isoMatch = expr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    // Construct local timezone midnight for this date
    const d = new Date(Date.UTC(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10),
    ) - LOCAL_OFFSET_MS);
    return [d, addDays(d, 1)];
  }

  // "N days ago"
  const daysAgoMatch = expr.match(/^(\d+)\s+days?\s+ago$/);
  if (daysAgoMatch) {
    const n = parseInt(daysAgoMatch[1], 10);
    const start = addDays(todayStart, -n);
    return [start, addDays(start, 1)];
  }

  // "last N days"
  const lastNDaysMatch = expr.match(/^last\s+(\d+)\s+days?$/);
  if (lastNDaysMatch) {
    const n = parseInt(lastNDaysMatch[1], 10);
    const start = addDays(todayStart, -n);
    return [start, addDays(todayStart, 1)];
  }

  // "this week" (Monday-based)
  if (expr === 'this week') {
    const dow = localWeekday(todayStart);
    const monday = addDays(todayStart, -dow);
    return [monday, addDays(todayStart, 1)];
  }

  // "last week"
  if (expr === 'last week') {
    const dow = localWeekday(todayStart);
    const thisMonday = addDays(todayStart, -dow);
    const lastMonday = addDays(thisMonday, -7);
    return [lastMonday, thisMonday];
  }

  // "last monday" .. "last sunday"
  const lastDayMatch = expr.match(/^last\s+(\w+)$/);
  if (lastDayMatch && DAY_NAMES[lastDayMatch[1]] !== undefined) {
    const targetDow = DAY_NAMES[lastDayMatch[1]];
    const currentDow = localWeekday(todayStart);
    let daysBack = (currentDow - targetDow + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    const start = addDays(todayStart, -daysBack);
    return [start, addDays(start, 1)];
  }

  process.stderr.write(`Error: Can't parse date expression: '${expr}'\n`);
  process.stderr.write("Supported: today, yesterday, YYYY-MM-DD, 'N days ago', 'last N days',\n");
  process.stderr.write("           'this week', 'last week', 'last monday'...'last sunday'\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exported: get_project_dirs
// ---------------------------------------------------------------------------

/**
 * Get list of project directory full paths to scan.
 *
 * @param {string|null} projectPath  --project value
 * @param {boolean} allProjects      --all-projects flag
 * @returns {string[]}
 */
export function getProjectDirs(projectPath, allProjects) {
  if (projectPath) {
    const encoded = projectPath.replace(/\//g, '-');
    const p1 = join(CLAUDE_PROJECTS, encoded);
    if (existsSync(p1)) return [p1];
    if (existsSync(projectPath)) return [projectPath];
    process.stderr.write(`Error: Project path not found: ${projectPath}\n`);
    process.exit(1);
  }

  if (allProjects) {
    return listSubdirs(CLAUDE_PROJECTS);
  }

  // Default: detect project dir from CWD
  const cwd = process.cwd();
  const encoded = cwd.replace(/\//g, '-');
  const defaultDir = join(CLAUDE_PROJECTS, encoded);
  if (existsSync(defaultDir)) return [defaultDir];

  // Fallback: all projects
  return listSubdirs(CLAUDE_PROJECTS);
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/**
 * Strip system tags, keep only human-written content.
 * @param {string} text
 * @returns {string}
 */
function cleanContent(text) {
  if (typeof text !== 'string') return '';
  for (const pat of STRIP_PATTERNS) {
    pat.lastIndex = 0;
    text = text.replace(pat, '');
  }
  return text.trim();
}

/**
 * Extract text from message content (string or list of content blocks).
 * @param {string|Array<{type:string,text?:string}>|unknown} content
 * @returns {string}
 */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (block && block.type === 'text') {
        parts.push(block.text ?? '');
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Format file size human-readable.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * List immediate subdirectory full paths inside dir.
 * @param {string} dir
 * @returns {string[]}
 */
function listSubdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Session scanning
// ---------------------------------------------------------------------------

/**
 * Fast scan: read JSONL metadata, count user messages.
 *
 * @param {string} filepath
 * @param {Date} dateStart
 * @param {Date} dateEnd
 * @returns {{ session_id: string, start_time: Date, user_msg_count: number, file_size: number, title: string, filepath: string }|null}
 */
function scanSessionMetadata(filepath, dateStart, dateEnd) {
  let sessionId = basename(filepath, '.jsonl');
  let startTime = null;
  let firstUserMsg = null;
  let userMsgCount = 0;
  let fileSize = 0;

  try {
    fileSize = statSync(filepath).size;
  } catch {
    return null;
  }

  let content;
  try {
    content = readFileSync(filepath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.sessionId) {
      sessionId = obj.sessionId;
    }

    if (obj.timestamp && !startTime) {
      try {
        startTime = parseIso(obj.timestamp);
      } catch {
        // ignore
      }
    }

    // Count user messages and capture first
    if (obj.type === 'user' && obj.message?.role === 'user') {
      userMsgCount++;
      if (firstUserMsg === null) {
        const raw = extractText(obj.message?.content ?? '');
        const cleaned = cleanContent(raw);
        // Skip Claude-Mem observer sessions
        if (cleaned && cleaned.startsWith('You are a Claude-Mem')) {
          return null;
        }
        if (cleaned && cleaned.length >= 5 && !/^\/\w+\s*$/.test(cleaned)) {
          firstUserMsg = cleaned;
        }
      }
    }

    // Early exit: if we have start_time within first 5 lines and it's outside range, skip
    if (startTime && i < 5) {
      if (!inLocalRange(startTime, addDays(dateStart, -1), dateEnd)) {
        return null;
      }
    }
  }

  if (!startTime) return null;

  // Final date check in local timezone
  if (!inLocalRange(startTime, dateStart, dateEnd)) return null;

  // Derive title from first message
  let title = 'Untitled';
  if (firstUserMsg) {
    let firstLine = firstUserMsg.split('\n')[0].trim();
    firstLine = firstLine.replace(/^#+\s*/, '');
    if (firstLine.startsWith('## Continue:')) {
      const m = firstUserMsg.match(/## Continue:\s*(.+?)(?:\n|$)/);
      if (m) firstLine = m[1].trim();
    }
    if (firstLine.length > 80) firstLine = firstLine.slice(0, 77) + '...';
    if (firstLine.length >= 3) title = firstLine;
  }

  return {
    session_id: sessionId,
    start_time: startTime,
    user_msg_count: userMsgCount,
    file_size: fileSize,
    title,
    filepath,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * List sessions for a date range.
 * @param {{ date_expr: string, project: string|null, all_projects: boolean, min_msgs: number }} args
 */
function cmdList(args) {
  const [dateStart, dateEnd] = parseDateExpr(args.date_expr);
  const projectDirs = getProjectDirs(args.project, args.all_projects);

  const sessions = [];
  let noiseCount = 0;

  for (const projDir of projectDirs) {
    let jsonlFiles;
    try {
      jsonlFiles = readdirSync(projDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(projDir, f));
    } catch {
      continue;
    }

    for (const filepath of jsonlFiles) {
      // Early mtime filter
      try {
        const mtime = new Date(statSync(filepath).mtimeMs);
        if (mtime.getTime() < addDays(dateStart, -1).getTime()) continue;
      } catch {
        continue;
      }

      const meta = scanSessionMetadata(filepath, dateStart, dateEnd);
      if (meta === null) continue;

      if (meta.user_msg_count < args.min_msgs) {
        noiseCount++;
        continue;
      }

      sessions.push(meta);
    }
  }

  sessions.sort((a, b) => a.start_time.getTime() - b.start_time.getTime());

  // Format date range for header
  const rangeMs = dateEnd.getTime() - dateStart.getTime();
  const headerDate = rangeMs <= 86400000
    ? fmtLocalDate(dateStart)
    : `${fmtLocalDateOnly(dateStart)} to ${fmtLocalDateOnly(addDays(dateEnd, -1))}`;

  console.log(`\nSessions for ${headerDate} (${LOCAL_TZ_NAME})\n`);

  if (sessions.length === 0) {
    console.log('No sessions found.');
    if (noiseCount) console.log(`(${noiseCount} filtered as noise, try --min-msgs 1)`);
    return;
  }

  // Print table
  console.log(` ${'#'.padStart(2)}  ${'Time'.padEnd(5)}  ${'Msgs'.padStart(4)}  ${'Size'.padStart(6)}  First Message`);
  console.log(` ${'--'.padStart(2)}  ${'-----'.padEnd(5)}  ${'----'.padStart(4)}  ${'------'.padStart(6)}  -------------`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const timeStr = fmtLocalTime(s.start_time);
    const sizeStr = formatSize(s.file_size);
    const title = s.title.slice(0, 60);
    console.log(` ${String(i + 1).padStart(2)}  ${timeStr}  ${String(s.user_msg_count).padStart(4)}  ${sizeStr.padStart(6)}  ${title}`);
  }

  process.stdout.write(`\n${sessions.length} sessions`);
  if (noiseCount) process.stdout.write(` (${noiseCount} filtered as noise)`);
  process.stdout.write('\n');

  // Print session IDs for expand
  console.log('\nSession IDs (for expand):');
  for (let i = 0; i < sessions.length; i++) {
    console.log(`  ${String(i + 1).padStart(2)}. ${sessions[i].session_id.slice(0, 8)}`);
  }
}

/**
 * Expand a session by ID — show conversation flow.
 * @param {{ session_id: string, project: string|null, all_projects: boolean, max_msgs: number }} args
 */
function cmdExpand(args) {
  const projectDirs = getProjectDirs(args.project, args.all_projects);
  const targetId = args.session_id.toLowerCase();

  let targetFile = null;
  outer: for (const projDir of projectDirs) {
    let files;
    try {
      files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.toLowerCase().startsWith(targetId) ||
          basename(f, '.jsonl').toLowerCase().startsWith(targetId)) {
        targetFile = join(projDir, f);
        break outer;
      }
    }
  }

  if (!targetFile) {
    process.stderr.write(`Error: No session found matching '${args.session_id}'\n`);
    process.exit(1);
  }

  const stemName = basename(targetFile, '.jsonl');
  console.log(`\nSession: ${stemName}`);
  console.log(`File: ${targetFile}`);
  console.log();

  let content;
  try {
    content = readFileSync(targetFile, 'utf8');
  } catch (err) {
    process.stderr.write(`Error reading file: ${err.message}\n`);
    process.exit(1);
  }

  const lines = content.split('\n');
  let msgCount = 0;
  const maxMsgs = args.max_msgs;

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const msgType = obj.type;
    const msg = obj.message ?? {};
    const role = msg.role;
    const tsStr = obj.timestamp ?? '';

    let tsLabel = '';
    if (tsStr) {
      try {
        const dt = parseIso(tsStr);
        tsLabel = fmtLocalTime(dt);
      } catch {
        // ignore
      }
    }

    if (msgType === 'user' && role === 'user') {
      const raw = extractText(msg.content ?? '');
      const cleaned = cleanContent(raw);
      if (!cleaned || cleaned.length < 5) continue;
      if (/^\/\w+\s*$/.test(cleaned)) continue;

      msgCount++;
      if (maxMsgs && msgCount > maxMsgs) {
        console.log(`\n... truncated at ${maxMsgs} messages (use --max-msgs to show more)`);
        break;
      }

      let display = cleaned;
      if (display.length > 200) display = display.slice(0, 197) + '...';
      display = display.replace(/\n/g, '\n    ');

      console.log(`[${tsLabel}] USER: ${display}`);

    } else if (msgType === 'assistant' && role === 'assistant') {
      const contentArr = msg.content;
      if (Array.isArray(contentArr)) {
        for (const block of contentArr) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text') {
            const firstLine = (block.text ?? '').split('\n')[0].slice(0, 120);
            if (firstLine.trim()) {
              console.log(`  [${tsLabel}] ASST: ${firstLine}`);
            }
            break;
          } else if (block.type === 'tool_use') {
            const toolName = block.name ?? '?';
            console.log(`  [${tsLabel}] TOOL: ${toolName}`);
          }
        }
      }
    }
  }

  console.log(`\n${msgCount} user messages total`);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  // argv = process.argv.slice(2)
  const args = [...argv];
  const command = args.shift();

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (command !== 'list' && command !== 'expand') {
    process.stderr.write(`Error: Unknown command '${command}'. Use 'list' or 'expand'.\n`);
    process.exit(1);
  }

  /** @type {Record<string,string|boolean|number>} */
  const opts = {
    project: null,
    all_projects: false,
  };

  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project') {
      opts.project = args[++i] ?? null;
    } else if (arg === '--all-projects') {
      opts.all_projects = true;
    } else if (arg === '--min-msgs') {
      opts.min_msgs = parseInt(args[++i], 10);
    } else if (arg === '--max-msgs') {
      opts.max_msgs = parseInt(args[++i], 10);
    } else if (arg.startsWith('--')) {
      process.stderr.write(`Error: Unknown option '${arg}'\n`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  if (command === 'list') {
    if (positional.length === 0) {
      process.stderr.write('Error: list requires DATE_EXPR argument\n');
      process.exit(1);
    }
    return {
      command,
      date_expr: positional.join(' '),
      project: opts.project,
      all_projects: opts.all_projects,
      min_msgs: opts.min_msgs !== undefined ? opts.min_msgs : 3,
    };
  }

  // expand
  if (positional.length === 0) {
    process.stderr.write('Error: expand requires SESSION_ID argument\n');
    process.exit(1);
  }
  return {
    command,
    session_id: positional[0],
    project: opts.project,
    all_projects: opts.all_projects,
    max_msgs: opts.max_msgs !== undefined ? opts.max_msgs : 50,
  };
}

function printUsage() {
  console.log(`Usage:
  recall-day.mjs list DATE_EXPR [--project PATH] [--all-projects] [--min-msgs N]
  recall-day.mjs expand SESSION_ID [--project PATH] [--all-projects] [--max-msgs N]

DATE_EXPR examples:
  today, yesterday, 2026-02-25
  "3 days ago", "last 3 days"
  "this week", "last week"
  "last monday" ... "last sunday"

All dates use your system timezone.`);
}

// ---------------------------------------------------------------------------
// Entry point — only run when executed directly, not when imported
// ---------------------------------------------------------------------------

// import.meta.main is true in Bun when this file is the entry point
if (import.meta.main) {
  const parsedArgs = parseArgs(process.argv.slice(2));
  if (parsedArgs.command === 'list') {
    cmdList(parsedArgs);
  } else if (parsedArgs.command === 'expand') {
    cmdExpand(parsedArgs);
  }
}
