// Usage: npm run epic:anonymize -- captures/epic/<label>
//
// Writes a publishable copy of a raw capture to test/fixtures/epic/<label>/
// and regenerates its analysis.md. Raw captures stay in git-ignored captures/.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { loadLocalEnv } from './env';
import { Anonymizer, findLeaks, PASS_THROUGH } from './probe/anonymize';
import { analyze, loadRun, renderAnalysis } from './probe/analyze';

const OUT_ROOT = 'test/fixtures/epic';

async function main() {
  loadLocalEnv();
  const src = process.argv[2];
  if (!src) {
    console.error('Usage: npm run epic:anonymize -- captures/epic/<label>');
    process.exit(1);
  }
  const out = join(OUT_ROOT, basename(src));
  await mkdir(out, { recursive: true });

  // OAuth client IDs are public constants, not people.
  const keepIds = ['EPIC_CLIENT_ID', 'EPIC_DEVICE_CODE_CLIENT_ID', 'EPIC_EVENTS_CLIENT_ID']
    .map((k) => process.env[k]?.trim())
    .filter((v): v is string => !!v);
  const anon = new Anonymizer({ keepIds });

  const files = (await readdir(src)).filter((f) => f.endsWith('.json')).sort();
  const rawDocs: unknown[] = [];
  const written: string[] = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(src, f), 'utf8'));
    const text = `${JSON.stringify(PASS_THROUGH.has(f) ? raw : anon.value(raw), null, 2)}\n`;
    if (!PASS_THROUGH.has(f)) rawDocs.push(raw);
    written.push(text);
    await writeFile(join(out, f), text);
  }

  const leaks = findLeaks(rawDocs, written.join('\n'), keepIds);
  if (Object.values(leaks).some((n) => n > 0)) {
    console.error(
      `Leak check FAILED (${JSON.stringify(leaks)}). Do not commit ${out}; delete it and fix the anonymizer.`,
    );
    process.exit(2);
  }

  const run = await loadRun(out);
  await writeFile(join(out, 'analysis.md'), renderAnalysis(out, run.report, analyze(run.report, run.files)));
  console.log(
    `Wrote ${files.length} files to ${out}; replaced ${anon.counts.ids} IDs and ${anon.counts.names} names. Leak check passed.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
