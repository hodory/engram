import { join } from 'path';
import { homedir } from 'os';
import { readdirSync, readFileSync, existsSync } from 'fs';

const HOME = homedir();
const compactionBase = join(HOME, '.claude', 'compaction');
const targetProject = process.argv.slice(2).filter(a => !a.startsWith('--'))[0];

if (!existsSync(compactionBase)) {
  console.log('No compaction data found. Run: engram init');
  process.exit(0);
}

const projects = targetProject
  ? [targetProject]
  : readdirSync(compactionBase).filter(d => {
      return existsSync(join(compactionBase, d, 'monthly'));
    });

for (const project of projects) {
  const stateFile = join(compactionBase, project, '.state.json');
  const monthlyDir = join(compactionBase, project, 'monthly');
  const rootFile = join(compactionBase, project, 'ROOT.md');

  console.log(`\n=== ${project} ===`);

  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    console.log(`  Last run: ${state.last_run || 'never'}`);
    console.log(`  Project dir: ${state.project_dir || 'unknown'}`);
  }

  if (existsSync(monthlyDir)) {
    const files = readdirSync(monthlyDir).filter(f => f.endsWith('.md'));
    console.log(`  Monthly nodes: ${files.length}`);

    for (const file of files) {
      const content = readFileSync(join(monthlyDir, file), 'utf-8');
      const statusMatch = content.match(/^status:\s*(.+)$/m);
      const countMatch = content.match(/^session-count:\s*(\d+)$/m);
      const status = statusMatch ? statusMatch[1].trim() : 'unknown';
      const count = countMatch ? countMatch[1] : '?';
      console.log(`    ${file.replace('.md', '')}: ${status} (${count} sessions)`);
    }
  }

  console.log(`  ROOT.md: ${existsSync(rootFile) ? 'exists' : 'missing'}`);
}
