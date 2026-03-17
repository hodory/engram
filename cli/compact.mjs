import { join } from 'path';
import { homedir } from 'os';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolveProject, findSessionDirs, getMemoryPath, getCompactionDir } from '../lib/resolve.mjs';
import { extractTitle, extractKeywords } from '../lib/extract.mjs';
import { generateMonthlyNode, determineStatus, parseMonthlyNode } from '../lib/monthly.mjs';
import { generateRoot } from '../lib/root-gen.mjs';
import { injectRoot } from '../lib/memory-inject.mjs';
import { acquireLock, releaseLock } from '../lib/lock.mjs';
import { execSync } from 'child_process';

const HOME = homedir();
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = {
  full: process.argv.includes('--full'),
  rootOnly: process.argv.includes('--root-only'),
};

const projectDir = args[0];
if (!projectDir) {
  console.error('Usage: engram compact <project-dir> [--full] [--root-only]');
  process.exit(1);
}

const sessionsBase = join(HOME, '.claude', 'sessions-md');
const project = resolveProject(projectDir, sessionsBase);
const compactionDir = getCompactionDir(project);
const monthlyDir = join(compactionDir, 'monthly');
const lockDir = join(compactionDir, '.lock');
const stateFile = join(compactionDir, '.state.json');

// Ensure directories exist
mkdirSync(monthlyDir, { recursive: true });

// 1. Acquire lock
if (!acquireLock(lockDir)) {
  console.error('engram: another instance is running, skipping');
  process.exit(0);
}

try {
  // 2. Load state
  let state = { schema_version: 1, last_run: null, monthly_nodes: {} };
  if (existsSync(stateFile)) {
    state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  }

  const lastRun = state.last_run ? new Date(state.last_run) : new Date(0);

  // 3. Scan session directories
  const sessionDirs = findSessionDirs(project, sessionsBase);
  const sessionsByMonth = new Map();
  const allSessions = [];

  for (const dir of sessionDirs) {
    const dirPath = join(sessionsBase, dir);
    const monthDirs = readdirSync(dirPath).filter(d => /^\d{4}-\d{2}$/.test(d));

    for (const monthDir of monthDirs) {
      const monthPath = join(dirPath, monthDir);
      const files = readdirSync(monthPath).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = join(monthPath, file);
        const fileStat = statSync(filePath);

        // Skip unchanged files unless --full
        if (!flags.full && fileStat.mtime <= lastRun) continue;

        const content = readFileSync(filePath, 'utf-8');
        const title = extractTitle(content);
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : monthDir + '-01';
        const period = date.slice(0, 7); // "YYYY-MM"

        const entry = { date, title, source: `${dir}/${monthDir}/${file}` };

        if (!sessionsByMonth.has(period)) sessionsByMonth.set(period, []);
        sessionsByMonth.get(period).push(entry);
        allSessions.push(entry);
      }
    }
  }

  // If --full, also read existing unchanged sessions for complete monthly nodes
  if (flags.full) {
    // Already scanning all files above
  }

  // For months that haven't changed, load existing monthly nodes
  if (!flags.full) {
    const existingMonthFiles = existsSync(monthlyDir)
      ? readdirSync(monthlyDir).filter(f => f.endsWith('.md'))
      : [];

    for (const mf of existingMonthFiles) {
      const period = mf.replace('.md', '');
      if (sessionsByMonth.has(period)) continue; // has new data

      // Load existing node for ROOT generation
      const content = readFileSync(join(monthlyDir, mf), 'utf-8');
      const parsed = parseMonthlyNode(content);
      if (parsed && parsed.status === 'fixed') {
        // Keep as-is, don't need to reload sessions
      }
    }
  }

  const now = new Date();
  const monthlyNodes = [];

  if (!flags.rootOnly) {
    // 4. Generate/update monthly nodes
    for (const [period, sessions] of sessionsByMonth) {
      const existingNodePath = join(monthlyDir, `${period}.md`);
      let currentStatus = null;

      if (existsSync(existingNodePath)) {
        const existing = readFileSync(existingNodePath, 'utf-8');
        const parsed = parseMonthlyNode(existing);
        if (parsed) {
          currentStatus = parsed.status;
          // Skip fixed nodes unless --full
          if (currentStatus === 'fixed' && !flags.full) continue;
        }
      }

      // For full rebuild: need ALL sessions for this month, not just changed ones
      let allMonthSessions = sessions;
      if (flags.full) {
        allMonthSessions = [];
        for (const dir of sessionDirs) {
          const monthPath = join(sessionsBase, dir, period.slice(0, 7));
          if (!existsSync(monthPath)) continue;
          const files = readdirSync(monthPath).filter(f => f.endsWith('.md'));
          for (const file of files) {
            const content = readFileSync(join(monthPath, file), 'utf-8');
            const title = extractTitle(content);
            const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
            allMonthSessions.push({
              date: dateMatch ? dateMatch[1] : period + '-01',
              title,
              source: `${dir}/${period}/${file}`,
            });
          }
        }
      }

      const keywords = extractKeywords(allMonthSessions.map(s => s.title));
      const status = determineStatus(period, allMonthSessions.length, now, currentStatus);

      const nodeContent = generateMonthlyNode({
        period,
        sessions: allMonthSessions,
        keywords,
        status,
      });

      writeFileSync(existingNodePath, nodeContent, 'utf-8');
      monthlyNodes.push({ period, keywords, status, sessionCount: allMonthSessions.length });

      state.monthly_nodes[period] = {
        status,
        session_count: allMonthSessions.length,
        last_updated: now.toISOString().slice(0, 10),
      };
    }
  }

  // Load all monthly nodes for ROOT generation (including unchanged ones)
  const allMonthlyNodes = [];
  if (existsSync(monthlyDir)) {
    const monthFiles = readdirSync(monthlyDir).filter(f => f.endsWith('.md'));
    for (const mf of monthFiles) {
      const period = mf.replace('.md', '');
      const content = readFileSync(join(monthlyDir, mf), 'utf-8');

      // Extract keywords from ## Key Topics section
      const keywords = [];
      const topicSection = content.match(/## Key Topics\n([\s\S]*?)(?=\n##|\n---|\n$)/);
      if (topicSection) {
        const topicLines = topicSection[1].trim().split('\n');
        for (const line of topicLines) {
          const match = line.match(/^- (.+?) \((\d+)\)$/);
          if (match) keywords.push([match[1], parseInt(match[2], 10)]);
        }
      }

      allMonthlyNodes.push({ period, keywords });
    }
  }

  // 5. Generate ROOT.md
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentSessions = allSessions
    .filter(s => new Date(s.date) >= sevenDaysAgo)
    .sort((a, b) => b.date.localeCompare(a.date));

  const rootContent = generateRoot({
    recentSessions,
    monthlyNodes: allMonthlyNodes,
    allSessions,
  });

  writeFileSync(join(compactionDir, 'ROOT.md'), rootContent, 'utf-8');

  // 6. Inject into MEMORY.md
  const memoryPath = getMemoryPath(projectDir);
  if (existsSync(memoryPath)) {
    const memoryContent = readFileSync(memoryPath, 'utf-8');
    const updated = injectRoot(memoryContent, rootContent);
    writeFileSync(memoryPath, updated, 'utf-8');
  }

  // 7. Register QMD collections + update + embed
  // 7a. sessions-md collection (기존 stop-hook에서 하던 역할 흡수)
  for (const dir of sessionDirs) {
    if (dir.startsWith('-')) continue; // raw name은 스킵
    try {
      execSync(`qmd collection show "${dir}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {
      try {
        execSync(`cd "${sessionsBase}" && qmd collection add "${dir}"`, { stdio: 'ignore' });
      } catch { /* continue */ }
    }
  }

  // 7b. compaction collection
  const collectionName = `${project}-compaction`;
  try {
    execSync(`qmd collection show "${collectionName}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    try {
      execSync(`cd "${compactionDir}" && qmd collection add "${collectionName}"`, { stdio: 'ignore' });
    } catch { /* continue */ }
  }

  // 7c. BM25 인덱스 동기 업데이트 (~0.5초)
  try {
    execSync('qmd update', { stdio: 'ignore', timeout: 10000 });
  } catch { /* qmd update failed, continue */ }

  // 7d. 벡터 임베딩 백그라운드 실행 (5분+, 블로킹 방지)
  try {
    execSync('nohup qmd embed >/dev/null 2>&1 &', { stdio: 'ignore', shell: true });
  } catch { /* continue */ }

  // 8. Save state
  state.last_run = now.toISOString();
  state.project = project;
  state.project_dir = projectDir;
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');

  console.log(`engram: ${project} updated (${sessionsByMonth.size} months, ${allSessions.length} sessions)`);
} finally {
  releaseLock(lockDir);
}
