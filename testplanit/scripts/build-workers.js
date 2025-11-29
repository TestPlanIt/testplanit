#!/usr/bin/env node
/**
 * Build script for worker files using esbuild
 * Compiles TypeScript workers to optimized JavaScript for production
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// Clean dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}

// Worker entry points
const entryPoints = [
  'workers/notificationWorker.ts',
  'workers/emailWorker.ts',
  'workers/forecastWorker.ts',
  'workers/syncWorker.ts',
  'workers/testmoImportWorker.ts',
  'workers/elasticsearchReindexWorker.ts',
  'scheduler.ts',
];

async function build() {
  try {
    console.log('Building workers...');

    await esbuild.build({
      entryPoints,
      bundle: true, // Bundle to resolve all imports
      platform: 'node',
      target: 'node18',
      format: 'cjs', // Use CommonJS to avoid ESM import resolution issues
      outdir: distDir,
      sourcemap: true,
      outExtension: { '.js': '.js' },
      tsconfig: path.join(rootDir, 'tsconfig.workers.json'),
      packages: 'external', // Don't bundle node_modules, treat them as external
      logLevel: 'info',
    });

    console.log('✓ Workers built successfully');

    // Copy email templates to dist directory
    // The template-service.ts uses __dirname to find templates relative to the compiled file
    const templatesSource = path.join(rootDir, 'lib', 'email', 'templates');
    const templatesDest = path.join(distDir, 'workers', 'templates');

    if (fs.existsSync(templatesSource)) {
      fs.cpSync(templatesSource, templatesDest, { recursive: true });
      console.log('✓ Email templates copied to dist/workers/templates');
    } else {
      console.warn('⚠ Email templates directory not found at', templatesSource);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
