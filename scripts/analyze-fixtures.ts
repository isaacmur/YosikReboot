// Usage: npm run epic:analyze -- test/fixtures/epic/<label>
//
// Re-runs the analysis on a saved probe run (e.g. after tweaking the analyzer).

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze, loadRun, renderAnalysis } from './probe/analyze';

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: npm run epic:analyze -- test/fixtures/epic/<label>');
    process.exit(1);
  }
  const { report, files } = await loadRun(dir);
  const md = renderAnalysis(dir, report, analyze(report, files));
  await writeFile(join(dir, 'analysis.md'), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
