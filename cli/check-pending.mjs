import { join } from 'path';
import { homedir } from 'os';
import { readdirSync, readFileSync, existsSync } from 'fs';

const HOME = homedir();
const compactionBase = join(HOME, '.claude', 'compaction');

if (!existsSync(compactionBase)) {
  process.exit(0);
}

const projects = readdirSync(compactionBase).filter(d => {
  const monthlyDir = join(compactionBase, d, 'monthly');
  return existsSync(monthlyDir);
});

for (const project of projects) {
  const monthlyDir = join(compactionBase, project, 'monthly');
  const files = readdirSync(monthlyDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(join(monthlyDir, file), 'utf-8');
    const statusMatch = content.match(/^status:\s*needs-summarization$/m);
    if (statusMatch) {
      console.log(`PENDING:${project}:monthly/${file}`);
    }
  }
}
