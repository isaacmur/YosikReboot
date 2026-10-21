// Usage: npm run epic:probe -- [--label NAME] [--regions NAE,EU] [--rate-test N] [--no-auth]
//
// Hits every Epic endpoint the app plans to use and saves scrubbed responses to
// test/fixtures/epic/<label>/, then writes analysis.md next to them.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadLocalEnv, readClient, readDevice, readExchangeClient } from './env';
import { analyze, loadRun, renderAnalysis } from './probe/analyze';
import { argValue, parseLabel, parseRateTest, parseRegions } from './probe/args';
import { runProbe, type ProbeConfig } from './probe/run';

const FIXTURE_ROOT = 'test/fixtures/epic';

async function main() {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const outDir = join(FIXTURE_ROOT, parseLabel(argValue(args, '--label'), new Date()));
  const regions = parseRegions(argValue(args, '--regions'));
  const rateTest = parseRateTest(argValue(args, '--rate-test'));

  let config: ProbeConfig | undefined;
  if (!args.includes('--no-auth')) {
    const { client, missing: m1 } = readClient(process.env);
    const { device, missing: m2 } = readDevice(process.env);
    if (!client || !device) {
      console.error(`Missing ${[...m1, ...m2].join(', ')}. See docs/EPIC_API_NOTES.md (or pass --no-auth).`);
      process.exit(1);
    }
    config = {
      client,
      device,
      exchangeClient: readExchangeClient(process.env),
      displayName: process.env.PROBE_DISPLAY_NAME?.trim() || undefined,
    };
  }

  console.log(`Probing into ${outDir} (${regions.join(', ')})`);
  const report = await runProbe({ config, outDir, regions, rateTest, log: (l) => console.log(l) });
  const run = await loadRun(outDir);
  const findings = analyze(run.report, run.files);
  await writeFile(join(outDir, 'analysis.md'), renderAnalysis(outDir, run.report, findings));

  for (const n of report.notes) console.log(`note: ${n}`);
  console.log(`\n${findings.find((f) => f.id === 'reachability')?.answer}`);
  console.log(`Wrote ${join(outDir, 'analysis.md')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
