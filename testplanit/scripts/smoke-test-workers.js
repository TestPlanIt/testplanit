#!/usr/bin/env node
/**
 * Smoke-test: verify every worker's compiled entry point loads cleanly
 * inside the workers Docker image.
 *
 * Background: on 2026-04-22 the multitenant-workers deploy crashlooped
 * at startup because a module imported by testmoImportWorker had a
 * top-level `import "next/headers"` — but the workers image strips
 * Next.js from node_modules to save ~900MB. `docker build` never
 * surfaces this: the build only compiles files, never loads them at
 * runtime. This script closes that gap.
 *
 * What it does: `require()` each compiled worker entry so Node's CJS
 * resolver walks the full import graph. Any missing/unresolved module
 * throws synchronously and fails this script. Workers use a
 * `require.main === module` guard so startup side-effects (BullMQ
 * Worker construction, Valkey connection) only fire when the file is
 * executed directly — not when loaded via require here.
 *
 * Env shims below satisfy modules that validate process.env at load
 * time (env.js uses @t3-oss/env-nextjs which throws synchronously on
 * missing DATABASE_URL / NEXTAUTH_* during createEnv). We're not
 * testing runtime config correctness, just module-graph integrity.
 *
 * Keep the list in sync with ecosystem.config.js + scripts/build-workers.js.
 */

// Fill in dummy values for any env vars validated at module load time.
// Using `||=` so any real value injected by the CI runner is preserved.
process.env.DATABASE_URL ||= "postgresql://dummy:dummy@dummy:5432/dummy";
process.env.NEXTAUTH_SECRET ||= "dummy-secret-for-smoke-test-32ch";
process.env.NEXTAUTH_URL ||= "http://localhost:3000";
process.env.VALKEY_URL ||= "valkey://dummy:6379";
process.env.NODE_ENV ||= "production";
process.env.SKIP_VALKEY_CONNECTION ||= "true";

const path = require("path");

// Worker entrypoints — must match scripts/build-workers.js entryPoints.
const WORKERS = [
  "notificationWorker",
  "emailWorker",
  "forecastWorker",
  "syncWorker",
  "testmoImportWorker",
  "elasticsearchReindexWorker",
  "auditLogWorker",
  "autoTagWorker",
  "budgetAlertWorker",
  "repoCacheWorker",
  "copyMoveWorker",
  "duplicateScanWorker",
  "magicSelectWorker",
  "stepSequenceScanWorker",
  "generateFromUrlWorker",
];

const entryPoints = [
  ...WORKERS.map((name) => ({ name, file: `dist/workers/${name}.js` })),
  { name: "scheduler", file: "dist/scheduler.js" },
];

let failed = 0;
for (const { name, file } of entryPoints) {
  const abs = path.resolve(process.cwd(), file);
  try {
    require(abs);
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}: ${err && err.message ? err.message : err}`);
    if (err && err.stack) {
      console.error(err.stack);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} worker entrypoint(s) failed to load.`);
  // Exit on the next tick so pending error logs flush before we bail.
  process.exit(1);
}

console.log(
  `\nAll ${entryPoints.length} worker entrypoints loaded successfully.`
);
// Force exit to short-circuit any async startup work (BullMQ workers
// keep the event loop alive once new Worker(...) has been called).
process.exit(0);
