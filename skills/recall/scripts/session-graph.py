#!/usr/bin/env python3
"""Build interactive temporal graph of sessions and files they touched.

Usage:
    session-graph.py DATE_EXPR [--min-files N] [--min-msgs N] [--all-projects]
                               [--no-open] [-o PATH]

DATE_EXPR: yesterday, today, last week, this week, YYYY-MM-DD, "last N days", etc.
All dates in KST (UTC+9).

Requires: pip install networkx pyvis
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import networkx as nx
    from pyvis.network import Network
except ImportError:
    print("Error: networkx and pyvis required. Install with: pip3 install networkx pyvis", file=sys.stderr)
    sys.exit(1)

# Import recall-day for date parsing
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from importlib import import_module
_recall_day = None

def _get_recall_day():
    global _recall_day
    if _recall_day is None:
        spec = __import__('importlib').util.spec_from_file_location(
            'recall_day', SCRIPT_DIR / 'recall-day.py'
        )
        _recall_day = __import__('importlib').util.module_from_spec(spec)
        spec.loader.exec_module(_recall_day)
    return _recall_day

KST = timezone(timedelta(hours=9))
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"

# --- Path filtering ---

SKIP_PREFIXES = ('/tmp/', '/dev/', '/var/', '/usr/', '/private/tmp/')

SKIP_PATTERNS = [
    re.compile(r'node_modules/'),
    re.compile(r'\.git/'),
    re.compile(r'__pycache__/'),
    re.compile(r'\.venv/'),
    re.compile(r'venv/'),
    re.compile(r'\.cache/'),
    re.compile(r'\.DS_Store'),
]

SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
    '.mp3', '.mp4', '.wav', '.mov', '.avi',
    '.pdf', '.zip', '.tar', '.gz', '.bz2',
    '.woff', '.woff2', '.ttf', '.eot',
    '.pyc', '.pyo', '.class', '.o', '.so', '.dylib',
}

NOISE_FILES = {
    'CLAUDE.md', 'CLAUDE.local.md', 'package.json', 'package-lock.json',
    'tsconfig.json', '.gitignore', 'Makefile', 'Dockerfile',
}

# --- File path extraction from JSONL ---

FILE_PATH_RE = re.compile(r'(?:^|[\s"\'=])(/[a-zA-Z][^\s"\'<>|;,\]})]{5,})')

def extract_file_paths(jsonl_path: Path) -> dict | None:
    """Parse JSONL session file, extract file paths from tool calls."""
    files_touched = defaultdict(set)  # path -> set of operations
    session_id = jsonl_path.stem
    start_time = None
    first_user_msg = None
    user_msg_count = 0

    try:
        with open(jsonl_path) as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if obj.get('sessionId'):
                    session_id = obj['sessionId']

                ts_str = obj.get('timestamp')
                if ts_str and not start_time:
                    try:
                        start_time = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    except (ValueError, TypeError):
                        pass

                msg = obj.get('message', {})

                # Count user messages
                if obj.get('type') == 'user' and msg.get('role') == 'user':
                    user_msg_count += 1
                    if first_user_msg is None:
                        content = msg.get('content', '')
                        if isinstance(content, str):
                            text = content
                        elif isinstance(content, list):
                            text = ' '.join(
                                b.get('text', '') for b in content
                                if isinstance(b, dict) and b.get('type') == 'text'
                            )
                        else:
                            text = ''
                        text = text.strip()
                        if text and len(text) >= 5 and not text.startswith('<'):
                            first_user_msg = text.split('\n')[0][:80]

                # Extract file paths from assistant tool_use
                if obj.get('type') != 'assistant':
                    continue

                content = msg.get('content', [])
                if not isinstance(content, list):
                    continue

                for block in content:
                    if not isinstance(block, dict) or block.get('type') != 'tool_use':
                        continue

                    name = block.get('name', '')
                    inp = block.get('input', {})

                    if name == 'Read':
                        fp = inp.get('file_path', '')
                        if fp:
                            files_touched[fp].add('read')

                    elif name in ('Edit', 'Write', 'NotebookEdit'):
                        fp = inp.get('file_path', '')
                        if fp:
                            files_touched[fp].add('write')

                    elif name == 'Glob':
                        path = inp.get('path', '')
                        if path:
                            files_touched[path].add('search')

                    elif name == 'Grep':
                        path = inp.get('path', '')
                        if path:
                            files_touched[path].add('search')

                    elif name == 'Bash':
                        cmd = inp.get('command', '')
                        # Extract file paths from bash commands
                        for match in FILE_PATH_RE.finditer(cmd):
                            fp = match.group(1)
                            norm = normalize_path(fp)
                            if norm:
                                files_touched[norm].add('bash')

    except (OSError, UnicodeDecodeError):
        return None

    if not start_time:
        return None

    # Normalize all paths
    normalized = {}
    for fp, ops in files_touched.items():
        norm = normalize_path(fp)
        if norm:
            if norm not in normalized:
                normalized[norm] = set()
            normalized[norm].update(ops)

    return {
        'session_id': session_id,
        'start_time': start_time.astimezone(KST),
        'user_msg_count': user_msg_count,
        'title': first_user_msg or 'Untitled',
        'files': normalized,
        'filepath': str(jsonl_path),
    }


def normalize_path(fp: str) -> str | None:
    """Validate and normalize a file path, filtering noise."""
    if not fp or not fp.startswith('/'):
        return None

    # Skip system directories
    for prefix in SKIP_PREFIXES:
        if fp.startswith(prefix):
            return None

    # Skip patterns
    for pat in SKIP_PATTERNS:
        if pat.search(fp):
            return None

    # Skip binary/media extensions
    ext = Path(fp).suffix.lower()
    if ext in SKIP_EXTENSIONS:
        return None

    # Skip if no extension and no meaningful filename
    basename = Path(fp).name
    if basename in NOISE_FILES:
        return None

    # Must look like a real file (has extension or known filename)
    if '.' not in basename and not basename[0].isupper():
        return None

    return fp


# --- Color schemes ---

DAY_COLORS = {
    0: '#B8A9E8',  # Monday - lavender
    1: '#A8D8B9',  # Tuesday - mint
    2: '#F5C6AA',  # Wednesday - peach
    3: '#F0B4C8',  # Thursday - blush
    4: '#C4A8E0',  # Friday - lilac
    5: '#F0E4A0',  # Saturday - butter
    6: '#A8C4E8',  # Sunday - periwinkle
}

DAY_NAMES_KR = {
    0: '월', 1: '화', 2: '수', 3: '목', 4: '금', 5: '토', 6: '일',
}

DAY_NAMES_EN = {
    0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun',
}

FOLDER_COLORS = {
    'app/': '#81C784',       # green - app code
    'lib/': '#64B5F6',       # blue - library
    'model/': '#FFB74D',     # orange - model
    'framework/': '#E57373', # red - framework
    'echost/': '#BA68C8',    # purple - legacy
    '.claude/': '#4DB6AC',   # teal - claude config
    'tests': '#FFF176',      # yellow - tests
}

DEFAULT_FILE_COLOR = '#78909C'  # gray


def get_folder_color(path: str) -> str:
    """Assign color based on path components."""
    for prefix, color in FOLDER_COLORS.items():
        if prefix in path:
            return color
    return DEFAULT_FILE_COLOR


def recency_color(t: float) -> str:
    """Generate color based on recency (0=oldest, 1=newest)."""
    # HSL: hue=252 (lavender), sat 25-85%, light 30-78%
    sat = 25 + t * 60
    light = 30 + t * 48
    return _hsl_to_hex(252, sat, light)


def _hsl_to_hex(h: float, s: float, l: float) -> str:
    """Convert HSL to hex color."""
    s /= 100
    l /= 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    r, g, b = int((r + m) * 255), int((g + m) * 255), int((b + m) * 255)
    return f'#{r:02x}{g:02x}{b:02x}'


# --- Graph construction ---

def build_graph(sessions: list[dict], min_files: int = 2) -> nx.Graph:
    """Build a bipartite graph: session nodes <-> file nodes."""
    G = nx.Graph()

    # Compute file frequency for noise detection
    file_freq = defaultdict(int)
    for s in sessions:
        for fp in s['files']:
            file_freq[fp] += 1

    noise_threshold = max(3, int(len(sessions) * 0.6))

    # Compute recency for coloring
    if sessions:
        times = [s['start_time'].timestamp() for s in sessions]
        t_min, t_max = min(times), max(times)
        t_range = t_max - t_min if t_max > t_min else 1
    else:
        t_min, t_range = 0, 1

    for s in sessions:
        files = {fp: ops for fp, ops in s['files'].items()
                 if file_freq[fp] <= noise_threshold}

        if len(files) < min_files:
            continue

        # Session node
        sid = s['session_id'][:8]
        t = (s['start_time'].timestamp() - t_min) / t_range
        day = s['start_time'].weekday()
        day_color = DAY_COLORS.get(day, '#999')
        time_str = s['start_time'].strftime('%H:%M')
        date_str = s['start_time'].strftime('%m/%d')
        title_short = s['title'][:50]

        label = f"{date_str} {time_str}"
        tooltip = f"<b>{date_str} ({DAY_NAMES_KR[day]}) {time_str}</b><br>{title_short}<br>Files: {len(files)} | Msgs: {s['user_msg_count']}"

        G.add_node(
            f"s:{sid}",
            label=label,
            title=tooltip,
            color=day_color,
            shape='dot',
            size=max(10, min(30, s['user_msg_count'] * 2)),
            group='session',
            font={'color': '#E0E0E0', 'size': 10},
        )

        # File nodes and edges
        for fp, ops in files.items():
            # Shorten path for display
            short = fp
            home = str(Path.home())
            if short.startswith(home):
                short = '~' + short[len(home):]
            if len(short) > 60:
                parts = short.split('/')
                short = '/'.join(parts[:2]) + '/.../' + parts[-1]

            basename = Path(fp).name
            color = get_folder_color(fp)
            ref_count = file_freq[fp]

            tooltip_file = f"<b>{basename}</b><br>{short}<br>Referenced by {ref_count} session(s)"

            if f"f:{fp}" not in G:
                G.add_node(
                    f"f:{fp}",
                    label=basename,
                    title=tooltip_file,
                    color=color,
                    shape='square',
                    size=max(8, min(20, ref_count * 3)),
                    group='file',
                    font={'color': '#B0B0B0', 'size': 9},
                )

            # Edge: thicker for writes
            has_write = 'write' in ops
            G.add_edge(
                f"s:{sid}", f"f:{fp}",
                color={'color': '#555' if has_write else '#333', 'opacity': 0.6 if has_write else 0.3},
                width=2 if has_write else 1,
            )

    return G


# --- HTML rendering ---

def render_graph(G: nx.Graph, output_path: str, date_label: str, sessions_meta: list[dict]):
    """Render graph as interactive HTML using pyvis."""
    if len(G.nodes) == 0:
        print("No nodes to visualize.")
        return

    net = Network(
        height='100vh',
        width='100%',
        bgcolor='#1e1e2e',
        font_color='#cdd6f4',
        directed=False,
        notebook=False,
    )

    # Physics configuration
    net.set_options("""
    {
        "physics": {
            "barnesHut": {
                "gravitationalConstant": -8000,
                "centralGravity": 0.3,
                "springLength": 120,
                "springConstant": 0.04,
                "damping": 0.09
            },
            "maxVelocity": 50,
            "minVelocity": 0.1,
            "stabilization": {
                "enabled": true,
                "iterations": 200,
                "updateInterval": 25
            }
        },
        "interaction": {
            "hover": true,
            "tooltipDelay": 200,
            "multiselect": true,
            "navigationButtons": false,
            "keyboard": {
                "enabled": true
            }
        },
        "nodes": {
            "borderWidth": 1,
            "borderWidthSelected": 3
        },
        "edges": {
            "smooth": {
                "type": "continuous"
            }
        }
    }
    """)

    # Add nodes and edges from NetworkX graph
    for node, attrs in G.nodes(data=True):
        net.add_node(node, **attrs)

    for u, v, attrs in G.edges(data=True):
        net.add_edge(u, v, **attrs)

    # Build custom HTML
    session_count = sum(1 for n in G.nodes if n.startswith('s:'))
    file_count = sum(1 for n in G.nodes if n.startswith('f:'))
    edge_count = len(G.edges)

    # Build legend HTML
    legend_items = []
    for day_num in sorted(DAY_COLORS.keys()):
        color = DAY_COLORS[day_num]
        name = f"{DAY_NAMES_KR[day_num]} ({DAY_NAMES_EN[day_num]})"
        legend_items.append(f'<span style="display:inline-block;width:12px;height:12px;background:{color};border-radius:50%;margin-right:4px;vertical-align:middle;"></span>{name}')

    legend_html = ' &nbsp; '.join(legend_items)

    custom_css = """
    <style>
        body { margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        #header {
            position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
            background: #1e1e2e; border-bottom: 1px solid #45475a;
            padding: 8px 16px; color: #cdd6f4; font-size: 13px;
            display: flex; justify-content: space-between; align-items: center;
        }
        #header .title { font-weight: 600; font-size: 15px; }
        #header .stats { color: #a6adc8; }
        #header .legend { color: #bac2de; font-size: 12px; }
        #mynetwork { margin-top: 42px; }
    </style>
    """

    custom_header = f"""
    <div id="header">
        <div>
            <span class="title">Session Graph: {date_label}</span>
            <span class="stats"> &mdash; {session_count} sessions, {file_count} files, {edge_count} edges</span>
        </div>
        <div class="legend">{legend_html}</div>
    </div>
    """

    custom_js = """
    <script>
    // Neighbor highlighting on hover
    network.on("hoverNode", function(params) {
        var nodeId = params.node;
        var connectedNodes = network.getConnectedNodes(nodeId);
        var connectedEdges = network.getConnectedEdges(nodeId);
        var allNodes = nodes.get();
        var allEdges = edges.get();

        // Dim all nodes
        allNodes.forEach(function(n) {
            if (n.id === nodeId || connectedNodes.indexOf(n.id) !== -1) {
                n.opacity = 1.0;
            } else {
                n.opacity = 0.15;
            }
        });
        nodes.update(allNodes);

        // Dim all edges
        allEdges.forEach(function(e) {
            if (connectedEdges.indexOf(e.id) !== -1) {
                e.hidden = false;
            } else {
                e.hidden = true;
            }
        });
        edges.update(allEdges);
    });

    network.on("blurNode", function() {
        var allNodes = nodes.get();
        var allEdges = edges.get();
        allNodes.forEach(function(n) { n.opacity = 1.0; });
        nodes.update(allNodes);
        allEdges.forEach(function(e) { e.hidden = false; });
        edges.update(allEdges);
    });
    </script>
    """

    # Save HTML
    net.save_graph(output_path)

    # Inject custom CSS, header, and JS
    with open(output_path) as f:
        html = f.read()

    html = html.replace('</head>', custom_css + '</head>')
    html = html.replace('<body>', '<body>' + custom_header)
    html = html.replace('</body>', custom_js + '</body>')

    with open(output_path, 'w') as f:
        f.write(html)

    print(f"\nGraph saved: {output_path}")
    print(f"  Sessions: {session_count}")
    print(f"  Files: {file_count}")
    print(f"  Edges: {edge_count}")


# --- Main ---

def main():
    parser = argparse.ArgumentParser(
        description='Interactive session-file relationship graph (KST)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('date_expr', nargs='+', help='Date expression')
    parser.add_argument('--min-files', type=int, default=2, help='Min files per session (default: 2)')
    parser.add_argument('--min-msgs', type=int, default=3, help='Min user messages (default: 3)')
    parser.add_argument('--all-projects', action='store_true', help='Scan all projects')
    parser.add_argument('--project', help='Specific project path')
    parser.add_argument('-o', '--output', default='/tmp/session-graph.html', help='Output path')
    parser.add_argument('--no-open', action='store_true', help="Don't open browser")

    args = parser.parse_args()
    date_expr = ' '.join(args.date_expr)

    # Parse date range using recall-day's parser
    recall_day = _get_recall_day()
    date_start, date_end = recall_day.parse_date_expr(date_expr)

    # Get project directories
    project_dirs = recall_day.get_project_dirs(
        args.project if hasattr(args, 'project') else None,
        args.all_projects
    )

    # Extract file paths from all sessions in date range
    sessions = []
    for proj_dir in project_dirs:
        for jsonl_path in proj_dir.glob("*.jsonl"):
            try:
                mtime = datetime.fromtimestamp(jsonl_path.stat().st_mtime, tz=KST)
                if mtime < date_start - timedelta(days=1):
                    continue
            except OSError:
                continue

            result = extract_file_paths(jsonl_path)
            if result is None:
                continue

            # Date filter
            if result['start_time'] < date_start or result['start_time'] >= date_end:
                continue

            # Message filter
            if result['user_msg_count'] < args.min_msgs:
                continue

            sessions.append(result)

    sessions.sort(key=lambda s: s['start_time'])

    if not sessions:
        print(f"No sessions found for '{date_expr}'")
        return

    # Format date label
    if date_end - date_start <= timedelta(days=1):
        date_label = date_start.strftime('%Y-%m-%d (%A)')
    else:
        date_label = f"{date_start.strftime('%Y-%m-%d')} ~ {(date_end - timedelta(days=1)).strftime('%Y-%m-%d')}"

    print(f"\nBuilding graph for {date_label} (KST)")
    print(f"Found {len(sessions)} sessions")

    # Build and render graph
    G = build_graph(sessions, min_files=args.min_files)
    render_graph(G, args.output, date_label, sessions)

    # Open in browser
    if not args.no_open:
        try:
            subprocess.run(['open', args.output], check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"Open manually: file://{args.output}")


if __name__ == '__main__':
    main()
