#!/usr/bin/env node
/**
 * TestPlanIt CLI
 *
 * Command-line interface for TestPlanIt test management.
 */

import { Command } from "commander";
import { createConfigCommand } from "./commands/config.js";
import { createImportCommand } from "./commands/import.js";

const program = new Command();

program
  .name("testplanit")
  .description("CLI tool for TestPlanIt - import test results and manage test data")
  .version("0.1.0");

// Add config command
program.addCommand(createConfigCommand());

// Add import command (supports all formats: junit, testng, xunit, nunit, mstest, mocha, cucumber)
program.addCommand(createImportCommand());

// Parse arguments
program.parse();
