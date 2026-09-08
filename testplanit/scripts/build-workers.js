#!/usr/bin/env node
/**
 * Build script for worker files using esbuild
 * Compiles TypeScript workers to optimized JavaScript for production
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

// Clean dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}

// Worker entry points
const entryPoints = [
  "workers/notificationWorker.ts",
  "workers/emailWorker.ts",
  "workers/forecastWorker.ts",
  "workers/syncWorker.ts",
  "workers/testmoImportWorker.ts",
  "workers/elasticsearchReindexWorker.ts",
  "workers/auditLogWorker.ts",
  "workers/autoTagWorker.ts",
  "workers/deriveCaseStepsWorker.ts",
  "workers/budgetAlertWorker.ts",
  "workers/repoCacheWorker.ts",
  "workers/copyMoveWorker.ts",
  "workers/duplicateScanWorker.ts",
  "workers/magicSelectWorker.ts",
  "workers/impactAnalysisWorker.ts",
  "workers/stepSequenceScanWorker.ts",
  "workers/generateFromUrlWorker.ts",
  "workers/iterationGenerationWorker.ts",
  "workers/scimAccessRecomputeWorker.ts",
  "workers/webhookDispatchWorker.ts",
  "workers/webhookOutboxWorker.ts",
  "workers/webhookRetentionWorker.ts",
  "workers/dataChangeLogRetentionWorker.ts",
  "workers/datasetLeaseSweepWorker.ts",
  "scheduler.ts",
];

/**
 * Fail the build if any bundle inlined another entry point's source file.
 *
 * Every worker starts itself behind `require.main === module`. Inside a CJS
 * bundle that test is true for every inlined module, not just the entry, so
 * a bundle that swallows a second worker boots both in one process: the
 * extra worker steals that queue's jobs and its SIGTERM handler races the
 * real one to `process.exit`. Shared job names belong in lib/queueNames.ts.
 */
function assertOneEntryPerBundle(metafile) {
  const entries = new Set(entryPoints.map((p) => path.normalize(p)));
  const problems = [];

  for (const [outFile, output] of Object.entries(metafile.outputs)) {
    if (!output.entryPoint) continue;
    const own = path.normalize(output.entryPoint);

    for (const input of Object.keys(output.inputs)) {
      const normalized = path.normalize(input);
      if (normalized === own || !entries.has(normalized)) continue;

      const importers = Object.entries(metafile.inputs)
        .filter(([, meta]) =>
          meta.imports.some((imp) => path.normalize(imp.path) === normalized)
        )
        .map(([file]) => file);
      problems.push(
        `${outFile} inlines ${input} (imported by ${importers.join(", ") || "unknown"})`
      );
    }
  }

  if (problems.length > 0) {
    console.error("✗ Each worker bundle must contain exactly one entry point:");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
}

async function build() {
  try {
    console.log("Building workers...");

    const result = await esbuild.build({
      entryPoints,
      bundle: true, // Bundle to resolve all imports
      platform: "node",
      target: "node18",
      format: "cjs", // Use CommonJS to avoid ESM import resolution issues
      outdir: distDir,
      sourcemap: true,
      outExtension: { ".js": ".js" },
      tsconfig: path.join(rootDir, "tsconfig.workers.json"),
      packages: "external", // Don't bundle node_modules, treat them as external
      logLevel: "info",
      metafile: true,
    });

    assertOneEntryPerBundle(result.metafile);

    console.log("✓ Workers built successfully");

    // Copy email templates to dist directory
    // The template-service.ts uses __dirname to find templates relative to the compiled file
    const templatesSource = path.join(rootDir, "lib", "email", "templates");
    const templatesDest = path.join(distDir, "workers", "templates");

    if (fs.existsSync(templatesSource)) {
      fs.cpSync(templatesSource, templatesDest, { recursive: true });
      console.log("✓ Email templates copied to dist/workers/templates");
    } else {
      console.warn("⚠ Email templates directory not found at", templatesSource);
    }

    // Copy translation messages to dist directory
    // The server-translations.ts uses __dirname to find messages relative to the compiled file
    const messagesSource = path.join(rootDir, "messages");
    const messagesDest = path.join(distDir, "messages");

    if (fs.existsSync(messagesSource)) {
      fs.cpSync(messagesSource, messagesDest, { recursive: true });
      console.log("✓ Translation messages copied to dist/messages");
    } else {
      console.warn("⚠ Messages directory not found at", messagesSource);
    }
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
