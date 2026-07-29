/**
 * Run Command
 *
 * Own a test run's lifecycle from a pipeline. A suite executed as several
 * separate reporter invocations — shards across agents, or retry waves — would
 * otherwise create one run per invocation. Create the run up front, export its
 * ID as TESTPLANIT_RUN_ID, and every invocation attaches to it; complete it
 * once everything has finished.
 */

import { Command } from "commander";
import * as api from "../lib/api.js";
import * as logger from "../lib/logger.js";
import { TEST_RUN_TYPES, type TestRunType } from "../types.js";

/**
 * Resolve the project from the option or TESTPLANIT_PROJECT_ID.
 */
async function resolveProject(value: string | undefined): Promise<number> {
  const raw = value ?? process.env.TESTPLANIT_PROJECT_ID;
  if (!raw) {
    throw new Error(
      "No project. Pass --project or set TESTPLANIT_PROJECT_ID."
    );
  }
  return api.resolveProjectId(raw);
}

function parseRunType(value: string | undefined): TestRunType | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase() as TestRunType;
  if (!TEST_RUN_TYPES.includes(upper)) {
    throw new Error(
      `Unknown run type "${value}". Expected one of: ${TEST_RUN_TYPES.join(", ")}`
    );
  }
  return upper;
}

function parseRunId(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new Error(`Test run ID must be a positive integer, got "${value}"`);
  }
  return Number(trimmed);
}

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Create and complete test runs from a pipeline")
    .addHelpText(
      "after",
      `
Examples:

  Create a run and capture its ID:
    $ RUN_ID=$(testplanit run create -p "My Project" -n "Web Regression #984")
    $ export TESTPLANIT_RUN_ID="$RUN_ID"

  Create with type, configuration, milestone and tags:
    $ testplanit run create -p 9 -n "Nightly" -T MOCHA -c "Chrome" -m "Sprint 1" -t "regression,ci"

  Complete the run once every shard and retry wave has finished:
    $ testplanit run complete --id "$RUN_ID"

The reporters (@testplanit/wdio-reporter, @testplanit/playwright-reporter) read
TESTPLANIT_RUN_ID and attach to that run without creating or completing it, so
any number of shards, agents or retry waves land in a single run.
`
    );

  // run create
  cmd
    .command("create")
    .description("Create a test run and print its ID to stdout")
    .option("-p, --project <value>", "Project (ID or exact name). Defaults to $TESTPLANIT_PROJECT_ID")
    .requiredOption("-n, --name <name>", "Test run name")
    .option("-T, --type <type>", `Run type: ${TEST_RUN_TYPES.join(", ")}`, "REGULAR")
    .option("-c, --config <value>", "Configuration (ID or exact name)")
    .option("-m, --milestone <value>", "Milestone (ID or exact name)")
    .option("-s, --state <value>", "Workflow state (ID or exact name)")
    .option("-t, --tags <values>", "Tags (comma-separated IDs or names)")
    .action(async (options) => {
      try {
        const projectId = await resolveProject(options.project);
        const testRunType = parseRunType(options.type);

        const configId = options.config
          ? await api.resolveToId(projectId, "config", options.config)
          : undefined;
        const milestoneId = options.milestone
          ? await api.resolveToId(projectId, "milestone", options.milestone)
          : undefined;
        const stateId = options.state
          ? await api.resolveToId(projectId, "state", options.state)
          : undefined;
        const tagIds = options.tags
          ? await api.resolveTags(projectId, options.tags)
          : undefined;

        const testRun = await api.createTestRun({
          projectId,
          name: options.name,
          testRunType,
          configId,
          milestoneId,
          stateId,
          tagIds,
        });

        // Diagnostics go to stderr so stdout holds only the ID, keeping
        // `RUN_ID=$(testplanit run create ...)` usable.
        logger.info(`Created test run ${testRun.id}: ${testRun.name}`);
        console.log(String(testRun.id));
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  // run complete
  cmd
    .command("complete")
    .description("Mark a test run done, after every invocation has finished")
    .requiredOption("-r, --id <id>", "Test run ID")
    .option("-p, --project <value>", "Project (ID or exact name). Read from the run when omitted")
    .action(async (options) => {
      try {
        const testRunId = parseRunId(options.id);
        const projectId = options.project
          ? await resolveProject(options.project)
          : (await api.getTestRun(testRunId)).projectId;

        const testRun = await api.completeTestRun(testRunId, projectId);
        logger.success(`Completed test run ${testRun.id}: ${testRun.name}`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  return cmd;
}
