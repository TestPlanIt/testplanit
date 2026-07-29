#!/usr/bin/env node
/**
 * TestPlanIt CLI
 *
 * Command-line interface for TestPlanIt test management.
 */

import { Command } from "commander";
import { createRequire } from "module";
import { createConfigCommand } from "./commands/config.js";
import { createImportCommand } from "./commands/import.js";
import { createRunCommand } from "./commands/run.js";

// Read version from package.json
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const program = new Command();

program
  .name("testplanit")
  .description("CLI tool for TestPlanIt - import test results and manage test data")
  .version(packageJson.version)
  .addHelpText("after", `
Examples:

  Configure the CLI:
    $ testplanit config set --url https://testplanit.example.com --token tpi_xxx

  Create a run for a sharded pipeline, then complete it:
    $ RUN_ID=$(testplanit run create -p "My Project" -n "Build #123")
    $ export TESTPLANIT_RUN_ID="$RUN_ID"   # every shard attaches to this run
    $ testplanit run complete --id "$RUN_ID"

  Import test results (minimal):
    $ testplanit import ./results.xml -p "My Project" -n "Build #123"

  Import with all options:
    $ testplanit import ./results/*.xml -p "My Project" -n "Release Test" \\
        -s "In Progress" -c "Chrome" -m "Sprint 1" -t "regression,ci"

Run 'testplanit <command> --help' for more information on a command.
`);

// Add config command
program.addCommand(createConfigCommand());

// Add import command (supports all formats: junit, testng, xunit, nunit, mstest, mocha, cucumber)
program.addCommand(createImportCommand());

// Add run command (create/complete a run the reporters attach to)
program.addCommand(createRunCommand());

// Parse arguments
program.parse();
