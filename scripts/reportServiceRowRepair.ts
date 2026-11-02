import { readFileSync, writeFileSync } from 'node:fs';

import {
  parseServiceExportCsv,
  repairActionsToCsv,
  proposeServiceRowRepair,
} from '../src/integrations/caspio/serviceRowRepair.js';

/**
 * Report proposed Service_Table_API repairs from a CSV export.
 *
 * Default mode only writes a proposal CSV. It does not connect to Caspio.
 * --apply is refused on purpose: review the proposal before any production write.
 *
 * Usage:
 *   npx tsx scripts/reportServiceRowRepair.ts --input export.csv --output proposal.csv
 */

function readArg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0) return process.argv[index + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : undefined;
}

function main(): void {
  if (process.argv.includes('--apply')) {
    console.error(
      'Refusing --apply. This script only reports. Review the proposal CSV before any Caspio write.',
    );
    process.exitCode = 1;
    return;
  }

  const input = readArg('input');
  if (!input) {
    console.error('Usage: --input <service-export.csv> [--output <proposal.csv>]');
    process.exitCode = 1;
    return;
  }
  const output = readArg('output') ?? 'service-row-repair-proposal.csv';
  const rows = parseServiceExportCsv(readFileSync(input, 'utf8'));
  const actions = proposeServiceRowRepair(rows);
  writeFileSync(output, repairActionsToCsv(actions), 'utf8');
  const counts = actions.reduce<Record<string, number>>((totals, action) => {
    totals[action.action] = (totals[action.action] ?? 0) + 1;
    return totals;
  }, {});
  console.log(
    `Read ${rows.length} rows. Wrote ${actions.length} proposals to ${output} (${JSON.stringify(counts)}). No Caspio writes.`,
  );
}

main();
