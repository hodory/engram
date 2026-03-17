#!/usr/bin/env bun
/**
 * Build interactive temporal graph of sessions and files they touched.
 *
 * Usage:
 *   session-graph.mjs DATE_EXPR [--min-files N] [--min-msgs N] [--all-projects]
 *                                [--no-open] [-o PATH]
 *
 * DATE_EXPR: yesterday, today, last week, this week, YYYY-MM-DD, "last N days", etc.
 * All dates in KST (UTC+9).
 *
 * Imports parseDateExpr and getProjectDirs from ./recall-day.mjs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { parseDateExpr, getProjectDirs } from './recall-day.mjs';

// --- Path filtering ---

const SKIP_PREFIXES = ['/tmp/', '/dev/', '/var/', '/usr/', '/private/tmp/'];

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /__pycache__\//,
  /\.venv\//,
  /venv\//,
  /\.cache\//,
  /\.DS_Store/,
];

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.mp3', '.mp4', '.wav', '.mov', '.avi',
  '.pdf', '.zip', '.tar', '.gz', '.bz2',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pyc', '.pyo', '.class', '.o', '.so', '.dylib',
]);

const NOISE_FILES = new Set([
  'CLAUDE.md', 'CLAUDE.local.md', 'package.json', 'package-lock.json',
  'tsconfig.json', '.gitignore', 'Makefile', 'Dockerfile',
]);

// --- File path extraction from JSONL ---

const FILE_PATH_RE = /(?:^|[\s"'=])(\/[a-zA-Z][^\s"'<>|;,\]})]{5,})/g;

/**
 * Parse JSONL session file, extract file paths from tool calls.
 * @param {string} jsonlPath
 * @returns {object|null}
 */
function extractFilePaths(jsonlPath) {
  const filesTouched = new Map(); // path -> Set of operations
  let sessionId = path.basename(jsonlPath, '.jsonl');
  let startTime = null;
  let firstUserMsg = null;
  let userMsgCount = 0;

  let content;
  try {
    content = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  for (const line of lines) {
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

    const tsStr = obj.timestamp;
    if (tsStr && !startTime) {
      try {
        startTime = new Date(tsStr.replace('Z', '+00:00'));
        if (isNaN(startTime.getTime())) startTime = null;
      } catch {
        // ignore
      }
    }

    const msg = obj.message || {};

    // Count user messages
    if (obj.type === 'user' && msg.role === 'user') {
      userMsgCount++;
      if (firstUserMsg === null) {
        const rawContent = msg.content || '';
        let text = '';
        if (typeof rawContent === 'string') {
          text = rawContent;
        } else if (Array.isArray(rawContent)) {
          text = rawContent
            .filter(b => typeof b === 'object' && b !== null && b.type === 'text')
            .map(b => b.text || '')
            .join(' ');
        }
        text = text.trim();
        if (text && text.length >= 5 && !text.startsWith('<')) {
          firstUserMsg = text.split('\n')[0].slice(0, 80);
        }
      }
    }

    // Extract file paths from assistant tool_use
    if (obj.type !== 'assistant') continue;

    const msgContent = msg.content;
    if (!Array.isArray(msgContent)) continue;

    for (const block of msgContent) {
      if (typeof block !== 'object' || block === null || block.type !== 'tool_use') continue;

      const name = block.name || '';
      const inp = block.input || {};

      if (name === 'Read') {
        const fp = inp.file_path || '';
        if (fp) addOp(filesTouched, fp, 'read');

      } else if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
        const fp = inp.file_path || '';
        if (fp) addOp(filesTouched, fp, 'write');

      } else if (name === 'Glob') {
        const p = inp.path || '';
        if (p) addOp(filesTouched, p, 'search');

      } else if (name === 'Grep') {
        const p = inp.path || '';
        if (p) addOp(filesTouched, p, 'search');

      } else if (name === 'Bash') {
        const cmd = inp.command || '';
        // Reset lastIndex before each use
        FILE_PATH_RE.lastIndex = 0;
        let match;
        while ((match = FILE_PATH_RE.exec(cmd)) !== null) {
          const fp = match[1];
          const norm = normalizePath(fp);
          if (norm) addOp(filesTouched, norm, 'bash');
        }
      }
    }
  }

  if (!startTime) return null;

  // Normalize all paths
  const normalized = new Map();
  for (const [fp, ops] of filesTouched) {
    const norm = normalizePath(fp);
    if (norm) {
      if (!normalized.has(norm)) normalized.set(norm, new Set());
      for (const op of ops) normalized.get(norm).add(op);
    }
  }

  // Convert startTime to KST-aware timestamp (store as Date, display in KST)
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const startTimeKST = new Date(startTime.getTime() + KST_OFFSET);

  return {
    sessionId,
    startTime: startTimeKST,   // Date object shifted to KST wall time (treated as UTC internally)
    userMsgCount,
    title: firstUserMsg || 'Untitled',
    files: normalized,
    filepath: jsonlPath,
  };
}

function addOp(map, path, op) {
  if (!map.has(path)) map.set(path, new Set());
  map.get(path).add(op);
}

/**
 * Validate and normalize a file path, filtering noise.
 * @param {string} fp
 * @returns {string|null}
 */
function normalizePath(fp) {
  if (!fp || !fp.startsWith('/')) return null;

  for (const prefix of SKIP_PREFIXES) {
    if (fp.startsWith(prefix)) return null;
  }

  for (const pat of SKIP_PATTERNS) {
    if (pat.test(fp)) return null;
  }

  const ext = path.extname(fp).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return null;

  const basename = path.basename(fp);
  if (NOISE_FILES.has(basename)) return null;

  // Must look like a real file (has extension or known filename starting with uppercase)
  if (!ext && basename.length > 0 && basename[0] !== basename[0].toUpperCase()) return null;
  if (!ext && basename[0] === basename[0].toLowerCase()) return null;

  return fp;
}

// --- Color schemes ---

const DAY_COLORS = {
  0: '#B8A9E8',  // Monday - lavender
  1: '#A8D8B9',  // Tuesday - mint
  2: '#F5C6AA',  // Wednesday - peach
  3: '#F0B4C8',  // Thursday - blush
  4: '#C4A8E0',  // Friday - lilac
  5: '#F0E4A0',  // Saturday - butter
  6: '#A8C4E8',  // Sunday - periwinkle
};

const DAY_NAMES_KR = { 0: '월', 1: '화', 2: '수', 3: '목', 4: '금', 5: '토', 6: '일' };
const DAY_NAMES_EN = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' };

const FOLDER_COLORS = {
  'app/':       '#81C784',  // green - app code
  'lib/':       '#64B5F6',  // blue - library
  'model/':     '#FFB74D',  // orange - model
  'framework/': '#E57373',  // red - framework
  'echost/':    '#BA68C8',  // purple - legacy
  '.claude/':   '#4DB6AC',  // teal - claude config
  'tests':      '#FFF176',  // yellow - tests
};

const DEFAULT_FILE_COLOR = '#78909C';  // gray

function getFolderColor(filePath) {
  for (const [prefix, color] of Object.entries(FOLDER_COLORS)) {
    if (filePath.includes(prefix)) return color;
  }
  return DEFAULT_FILE_COLOR;
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// --- Graph construction ---

/**
 * Build a bipartite graph: session nodes <-> file nodes.
 * @param {object[]} sessions
 * @param {number} minFiles
 * @returns {{ nodes: Map, edges: object[] }}
 */
function buildGraph(sessions, minFiles = 2) {
  const graph = {
    nodes: new Map(),  // id -> {label, title, color, shape, size, group, font}
    edges: [],         // [{from, to, color, width}]
  };

  // Compute file frequency for noise detection
  const fileFreq = new Map();
  for (const s of sessions) {
    for (const fp of s.files.keys()) {
      fileFreq.set(fp, (fileFreq.get(fp) || 0) + 1);
    }
  }

  const noiseThreshold = Math.max(3, Math.floor(sessions.length * 0.6));

  // Compute recency for coloring
  let tMin = 0, tRange = 1;
  if (sessions.length > 0) {
    const times = sessions.map(s => s.startTime.getTime());
    tMin = Math.min(...times);
    const tMax = Math.max(...times);
    tRange = tMax > tMin ? tMax - tMin : 1;
  }

  const home = os.homedir();

  for (const s of sessions) {
    // Filter noisy files
    const files = new Map();
    for (const [fp, ops] of s.files) {
      if ((fileFreq.get(fp) || 0) <= noiseThreshold) {
        files.set(fp, ops);
      }
    }

    if (files.size < minFiles) continue;

    // Session node
    const sid = s.sessionId.slice(0, 8);
    // startTime was shifted to KST, so day-of-week is KST local
    const dt = s.startTime;
    // weekday in KST: dt is already a Date whose UTC values represent KST wall time
    const dayOfWeek = dt.getUTCDay();          // 0=Sun..6=Sat  (JS UTC day of shifted time)
    // Convert JS day (0=Sun) to Python-style weekday (0=Mon)
    const day = (dayOfWeek + 6) % 7;
    const dayColor = DAY_COLORS[day] || '#999';
    const timeStr = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;
    const dateStr = `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
    const titleShort = s.title.slice(0, 50);
    const label = `${dateStr} ${timeStr}`;
    const tooltip = `<b>${dateStr} (${DAY_NAMES_KR[day]}) ${timeStr}</b><br>${titleShort}<br>Files: ${files.size} | Msgs: ${s.userMsgCount}`;
    const nodeSize = Math.max(10, Math.min(30, s.userMsgCount * 2));

    graph.nodes.set(`s:${sid}`, {
      id: `s:${sid}`,
      label,
      title: tooltip,
      color: dayColor,
      shape: 'dot',
      size: nodeSize,
      group: 'session',
      font: { color: '#E0E0E0', size: 10 },
    });

    // File nodes and edges
    for (const [fp, ops] of files) {
      // Shorten path for display
      let short = fp;
      if (short.startsWith(home)) {
        short = '~' + short.slice(home.length);
      }
      if (short.length > 60) {
        const parts = short.split('/');
        short = parts.slice(0, 2).join('/') + '/.../' + parts[parts.length - 1];
      }

      const basename = path.basename(fp);
      const color = getFolderColor(fp);
      const refCount = fileFreq.get(fp) || 1;
      const tooltipFile = `<b>${basename}</b><br>${short}<br>Referenced by ${refCount} session(s)`;
      const fileNodeSize = Math.max(8, Math.min(20, refCount * 3));

      if (!graph.nodes.has(`f:${fp}`)) {
        graph.nodes.set(`f:${fp}`, {
          id: `f:${fp}`,
          label: basename,
          title: tooltipFile,
          color,
          shape: 'square',
          size: fileNodeSize,
          group: 'file',
          font: { color: '#B0B0B0', size: 9 },
        });
      }

      // Edge: thicker for writes
      const hasWrite = ops.has('write');
      graph.edges.push({
        from: `s:${sid}`,
        to: `f:${fp}`,
        color: { color: hasWrite ? '#555' : '#333', opacity: hasWrite ? 0.6 : 0.3 },
        width: hasWrite ? 2 : 1,
      });
    }
  }

  return graph;
}

// --- HTML rendering ---

/**
 * Render graph as self-contained interactive HTML using vis.js CDN.
 * @param {{ nodes: Map, edges: object[] }} graph
 * @param {string} outputPath
 * @param {string} dateLabel
 */
function renderGraph(graph, outputPath, dateLabel) {
  const nodeCount = graph.nodes.size;
  if (nodeCount === 0) {
    console.log('No nodes to visualize.');
    return;
  }

  const sessionCount = [...graph.nodes.keys()].filter(k => k.startsWith('s:')).length;
  const fileCount = [...graph.nodes.keys()].filter(k => k.startsWith('f:')).length;
  const edgeCount = graph.edges.length;

  // Build legend HTML
  const legendItems = Object.keys(DAY_COLORS)
    .map(Number)
    .sort((a, b) => a - b)
    .map(dayNum => {
      const color = DAY_COLORS[dayNum];
      const name = `${DAY_NAMES_KR[dayNum]} (${DAY_NAMES_EN[dayNum]})`;
      return `<span style="display:inline-block;width:12px;height:12px;background:${color};border-radius:50%;margin-right:4px;vertical-align:middle;"></span>${name}`;
    });
  const legendHtml = legendItems.join(' &nbsp; ');

  // Serialize nodes and edges as JSON
  const nodesArray = [...graph.nodes.values()];
  const nodesJson = JSON.stringify(nodesArray);
  const edgesJson = JSON.stringify(graph.edges);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Session Graph: ${escapeHtml(dateLabel)}</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
  body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1e1e2e; }
  #header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    background: #1e1e2e; border-bottom: 1px solid #45475a;
    padding: 8px 16px; color: #cdd6f4; font-size: 13px;
    display: flex; justify-content: space-between; align-items: center;
  }
  #header .title { font-weight: 600; font-size: 15px; }
  #header .stats { color: #a6adc8; }
  #header .legend { color: #bac2de; font-size: 12px; }
  #mynetwork {
    position: fixed;
    top: 42px; left: 0; right: 0; bottom: 0;
    background: #1e1e2e;
  }
</style>
</head>
<body>
<div id="header">
  <div>
    <span class="title">Session Graph: ${escapeHtml(dateLabel)}</span>
    <span class="stats"> &mdash; ${sessionCount} sessions, ${fileCount} files, ${edgeCount} edges</span>
  </div>
  <div class="legend">${legendHtml}</div>
</div>
<div id="mynetwork"></div>
<script>
  var nodesData = ${nodesJson};
  var edgesData = ${edgesJson};

  // Assign stable integer IDs for vis.js edges while keeping string node IDs
  edgesData = edgesData.map(function(e, i) {
    return Object.assign({ id: i }, e);
  });

  var nodes = new vis.DataSet(nodesData);
  var edges = new vis.DataSet(edgesData);

  var container = document.getElementById('mynetwork');
  var data = { nodes: nodes, edges: edges };
  var options = {
    physics: {
      barnesHut: {
        gravitationalConstant: -8000,
        centralGravity: 0.3,
        springLength: 120,
        springConstant: 0.04,
        damping: 0.09
      },
      maxVelocity: 50,
      minVelocity: 0.1,
      stabilization: {
        enabled: true,
        iterations: 200,
        updateInterval: 25
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 200,
      multiselect: true,
      navigationButtons: false,
      keyboard: { enabled: true }
    },
    nodes: {
      borderWidth: 1,
      borderWidthSelected: 3
    },
    edges: {
      smooth: { type: 'continuous' }
    }
  };

  var network = new vis.Network(container, data, options);

  // Neighbor highlighting on hover
  network.on('hoverNode', function(params) {
    var nodeId = params.node;
    var connectedNodes = network.getConnectedNodes(nodeId);
    var connectedEdges = network.getConnectedEdges(nodeId);
    var allNodes = nodes.get();
    var allEdges = edges.get();

    allNodes.forEach(function(n) {
      if (n.id === nodeId || connectedNodes.indexOf(n.id) !== -1) {
        n.opacity = 1.0;
      } else {
        n.opacity = 0.15;
      }
    });
    nodes.update(allNodes);

    allEdges.forEach(function(e) {
      e.hidden = connectedEdges.indexOf(e.id) === -1;
    });
    edges.update(allEdges);
  });

  network.on('blurNode', function() {
    var allNodes = nodes.get();
    var allEdges = edges.get();
    allNodes.forEach(function(n) { n.opacity = 1.0; });
    nodes.update(allNodes);
    allEdges.forEach(function(e) { e.hidden = false; });
    edges.update(allEdges);
  });
</script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`\nGraph saved: ${outputPath}`);
  console.log(`  Sessions: ${sessionCount}`);
  console.log(`  Files:    ${fileCount}`);
  console.log(`  Edges:    ${edgeCount}`);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Argument parsing ---

function parseArgs(argv) {
  const args = {
    dateExprParts: [],
    minFiles: 2,
    minMsgs: 3,
    allProjects: false,
    project: null,
    output: '/tmp/session-graph.html',
    noOpen: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--min-files') {
      args.minFiles = parseInt(argv[++i], 10);
    } else if (arg === '--min-msgs') {
      args.minMsgs = parseInt(argv[++i], 10);
    } else if (arg === '--all-projects') {
      args.allProjects = true;
    } else if (arg === '--project') {
      args.project = argv[++i];
    } else if (arg === '-o' || arg === '--output') {
      args.output = argv[++i];
    } else if (arg === '--no-open') {
      args.noOpen = true;
    } else if (!arg.startsWith('-')) {
      args.dateExprParts.push(arg);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  if (args.dateExprParts.length === 0) {
    console.error('Usage: session-graph.mjs DATE_EXPR [--min-files N] [--min-msgs N] [--all-projects] [--no-open] [-o PATH]');
    console.error('DATE_EXPR: yesterday, today, last week, this week, YYYY-MM-DD, "last N days", etc.');
    process.exit(1);
  }

  args.dateExpr = args.dateExprParts.join(' ');
  return args;
}

// --- Main ---

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // Parse date range using recall-day's parser
  const [dateStart, dateEnd] = parseDateExpr(args.dateExpr);

  // Get project directories
  const projectDirs = getProjectDirs(args.project, args.allProjects);

  // Extract file paths from all sessions in date range
  const sessions = [];
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  for (const projDir of projectDirs) {
    let entries;
    try {
      entries = fs.readdirSync(projDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const jsonlPath = path.join(projDir, entry);

      // Quick mtime pre-filter
      try {
        const stat = fs.statSync(jsonlPath);
        const mtime = stat.mtimeMs;
        if (mtime < dateStart.getTime() - ONE_DAY_MS) continue;
      } catch {
        continue;
      }

      const result = extractFilePaths(jsonlPath);
      if (result === null) continue;

      // Date filter (startTime already shifted to KST wall time stored as UTC)
      const t = result.startTime.getTime();
      if (t < dateStart.getTime() || t >= dateEnd.getTime()) continue;

      // Message filter
      if (result.userMsgCount < args.minMsgs) continue;

      sessions.push(result);
    }
  }

  sessions.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (sessions.length === 0) {
    console.log(`No sessions found for '${args.dateExpr}'`);
    return;
  }

  // Format date label
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let dateLabel;
  if (dateEnd.getTime() - dateStart.getTime() <= ONE_DAY) {
    // Format dateStart as KST date string
    const d = dateStart;
    const dayOfWeek = d.getUTCDay();
    const day = (dayOfWeek + 6) % 7;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    dateLabel = `${yyyy}-${mm}-${dd} (${dayNames[day]})`;
  } else {
    const fmtDate = d => {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    const endDay = new Date(dateEnd.getTime() - ONE_DAY);
    dateLabel = `${fmtDate(dateStart)} ~ ${fmtDate(endDay)}`;
  }

  console.log(`\nBuilding graph for ${dateLabel} (KST)`);
  console.log(`Found ${sessions.length} sessions`);

  // Build and render graph
  const graph = buildGraph(sessions, args.minFiles);
  renderGraph(graph, args.output, dateLabel);

  // Open in browser
  if (!args.noOpen) {
    const result = spawnSync('open', [args.output]);
    if (result.error) {
      console.log(`Open manually: file://${args.output}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
