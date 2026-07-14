/**
 * Quote-safe Railway entrypoint. Logs before heavy imports so deploy
 * failures during env/Redis module load are visible in Railway stdout.
 *
 * Also installs process-level diagnostics: if the worker exits cleanly
 * (Railway shows "Completed" and does not restart under an On-Failure
 * policy) we log the exit code, and we surface otherwise-silent async
 * errors via unhandledRejection / uncaughtException handlers.
 */
export {};

const log = (msg: string, extra: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ msg, ts: new Date().toISOString(), ...extra }));
};

log('worker_boot_start', { node: process.version, cwd: process.cwd() });

process.on('exit', (code) => {
  log('worker_boot_process_exit', { code });
});

process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      msg: 'worker_boot_unhandled_rejection',
      ts: new Date().toISOString(),
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    }),
  );
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(
    JSON.stringify({
      msg: 'worker_boot_uncaught_exception',
      ts: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  process.exit(1);
});

try {
  await import('./index.js');
  log('worker_boot_imported');
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
