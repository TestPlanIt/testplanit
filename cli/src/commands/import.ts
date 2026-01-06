/**
 * Import Command
 *
 * Import test results from various formats into TestPlanIt.
 */

import { Command } from "commander";
import { glob } from "glob";
import * as fs from "fs";
import * as path from "path";
import * as config from "../lib/config.js";
import * as api from "../lib/api.js";
import * as logger from "../lib/logger.js";
import { TEST_RESULT_FORMATS, type TestResultFormat, type SSEProgressEvent, type ImportOptions } from "../types.js";

const VALID_FORMATS = ["auto", ...Object.keys(TEST_RESULT_FORMATS)] as const;

export function createImportCommand(): Command {
  const cmd = new Command("import")
    .description("Import test results into TestPlanIt")
    .argument("<files...>", "Test result files or glob patterns (e.g., ./results/*.xml)")
    .requiredOption("-p, --project <value>", "Project (ID or exact name)")
    .option("-n, --name <name>", "Test run name (required unless appending to existing run with -r)")
    .option(
      "-F, --format <format>",
      `File format: ${VALID_FORMATS.join(", ")} (default: auto-detect)`,
      "auto"
    )
    .option("-s, --state <value>", "Workflow state (ID or exact name)")
    .option("-c, --config <value>", "Configuration (ID or exact name)")
    .option("-m, --milestone <value>", "Milestone (ID or exact name)")
    .option("-f, --folder <value>", "Parent folder for test cases (ID or exact name)")
    .option("-t, --tags <values>", "Tags (comma-separated IDs or names, use quotes for names with commas)")
    .option("-r, --test-run <value>", "Existing test run to append results (ID or exact name)")
    .addHelpText("after", `
Examples:

  Minimal example (required options only):
    $ testplanit import ./results.xml -p "My Project" -n "Nightly Build #123"

  Using IDs instead of names:
    $ testplanit import ./results.xml -p 1 -n "Build #123"

  Import multiple files with glob pattern:
    $ testplanit import "./test-results/**/*.xml" -p "My Project" -n "Full Test Suite"

  Append results to an existing test run (no -n needed):
    $ testplanit import ./results.xml -p "My Project" -r "Existing Test Run"

  All options with names:
    $ testplanit import ./results/*.xml \\
        --project "My Project" \\
        --name "Release 2.0 - Regression" \\
        --format junit \\
        --state "In Progress" \\
        --config "Chrome - Production" \\
        --milestone "Sprint 15" \\
        --folder "Automated Tests" \\
        --tags "regression,automated,ci"

  All options with IDs:
    $ testplanit import ./results.xml -p 1 -n "Build" -F junit -s 5 -c 10 -m 3 -f 42 -t 1,2,3

  CI/CD with environment variables:
    $ TESTPLANIT_URL=https://testplanit.example.com \\
      TESTPLANIT_TOKEN=tpi_xxx \\
      testplanit import ./junit.xml -p 1 -n "CI Build $BUILD_NUMBER"
`)
    .action(async (filePatterns: string[], options) => {
      // Validate configuration
      const validationError = config.validateConfig();
      if (validationError) {
        logger.error(validationError);
        process.exit(1);
      }

      // Validate that name is provided when not appending to existing test run
      if (!options.name && !options.testRun) {
        logger.error("Option -n, --name is required when not appending to an existing test run");
        logger.info("Either provide --name for a new test run, or --test-run to append to an existing one");
        process.exit(1);
      }

      // Validate format
      const format = options.format.toLowerCase() as TestResultFormat;
      if (!VALID_FORMATS.includes(format)) {
        logger.error(`Invalid format: ${options.format}`);
        logger.info(`Valid formats: ${VALID_FORMATS.join(", ")}`);
        process.exit(1);
      }

      // Expand file patterns using glob
      const files: string[] = [];
      for (const pattern of filePatterns) {
        const matches = await glob(pattern, { nodir: true });
        if (matches.length === 0) {
          // Check if it's a literal file path
          if (fs.existsSync(pattern)) {
            files.push(pattern);
          } else {
            logger.warn(`No files matched pattern: ${pattern}`);
          }
        } else {
          files.push(...matches);
        }
      }

      // Filter by expected extensions if format is specified
      let filteredFiles = files;
      if (format !== "auto") {
        const expectedExtensions = TEST_RESULT_FORMATS[format].extensions;
        filteredFiles = files.filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return expectedExtensions.includes(ext);
        });

        if (filteredFiles.length < files.length) {
          const skipped = files.length - filteredFiles.length;
          logger.warn(`Skipped ${skipped} file(s) with unexpected extensions for ${TEST_RESULT_FORMATS[format].label}`);
        }
      }

      if (filteredFiles.length === 0) {
        logger.error("No matching files found to import");
        process.exit(1);
      }

      // Validate all files exist and are readable
      for (const file of filteredFiles) {
        try {
          fs.accessSync(file, fs.constants.R_OK);
        } catch {
          logger.error(`Cannot read file: ${file}`);
          process.exit(1);
        }
      }

      const formatLabel = format === "auto" ? "auto-detect" : TEST_RESULT_FORMATS[format].label;
      logger.info(`Found ${logger.formatNumber(filteredFiles.length)} file(s) to import (format: ${formatLabel})`);

      // Resolve names to IDs
      const spinner = logger.startSpinner("Resolving options...");

      try {
        // Resolve project first (required for other lookups)
        logger.updateSpinner("Resolving project...");
        const projectId = await api.resolveProjectId(options.project);

        const importOptions: ImportOptions = {
          projectId,
          name: options.name,
          format: format,
        };

        // Resolve state
        if (options.state) {
          logger.updateSpinner("Resolving workflow state...");
          importOptions.stateId = await api.resolveToId(projectId, "state", options.state);
        }

        // Resolve config
        if (options.config) {
          logger.updateSpinner("Resolving configuration...");
          importOptions.configId = await api.resolveToId(projectId, "config", options.config);
        }

        // Resolve milestone
        if (options.milestone) {
          logger.updateSpinner("Resolving milestone...");
          importOptions.milestoneId = await api.resolveToId(projectId, "milestone", options.milestone);
        }

        // Resolve folder
        if (options.folder) {
          logger.updateSpinner("Resolving folder...");
          importOptions.parentFolderId = await api.resolveToId(projectId, "folder", options.folder);
        }

        // Resolve tags (creates if missing)
        if (options.tags) {
          logger.updateSpinner("Resolving tags...");
          importOptions.tagIds = await api.resolveTags(projectId, options.tags);
        }

        // Resolve test run
        if (options.testRun) {
          logger.updateSpinner("Resolving test run...");
          importOptions.testRunId = await api.resolveToId(projectId, "testRun", options.testRun);
        }

        // Start import
        logger.updateSpinner("Starting import...");

        const result = await api.importTestResults(
          filteredFiles,
          importOptions,
          (event: SSEProgressEvent) => {
            if (event.status) {
              logger.updateSpinner(`[${event.progress || 0}%] ${event.status}`);
            }
          }
        );

        logger.succeedSpinner("Import completed successfully!");

        // Show result
        const url = config.getUrl();
        console.log();
        logger.success(`Test run created with ID: ${logger.formatNumber(result.testRunId)}`);

        if (url) {
          const testRunUrl = `${url}/projects/runs/${projectId}/${result.testRunId}`;
          logger.info(`View at: ${logger.formatUrl(testRunUrl)}`);
        }
      } catch (error) {
        logger.failSpinner("Import failed");
        if (error instanceof Error) {
          // Print each line of the error message separately for proper formatting
          const lines = error.message.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              logger.error(line);
            }
          }
        } else {
          logger.error("Unknown error occurred");
        }
        process.exit(1);
      }
    });

  return cmd;
}
