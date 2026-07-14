/**
 * Quote-safe Railway entrypoint. Logs before heavy imports so deploy
 * failures during env/Redis module load are visible in Railway stdout.
 */
export {};

console.log(
  JSON.stringify({
    msg: 'worker_boot_start',
    ts: new Date().toISOString(),
    node: process.version,
    cwd: process.cwd(),
  }),
);

try {
  await import('./index.js');
  console.log(JSON.stringify({ msg: 'worker_boot_imported', ts: new Date().toISOString() }));
} catch (error) {
  console.error(
    JSON.stringify({
      msg: 'worker_boot_failed',
      ts: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  process.exit(1);
}
