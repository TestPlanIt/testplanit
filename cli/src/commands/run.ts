/**
 * Run Command
 *
 * Helpers for a CI job that TestPlanIt dispatched (or that reports into a
 * pre-created run): read the plan of automated cases, complete the run,
 * finish the execution.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as config from "../lib/config.js";
import * as logger from "../lib/logger.js";
import {
  completeTestRun,
  EXECUTION_CONCLUSIONS,
  finishExecution,
  formatPlan,
  getAutomationPlan,
  parseEnvId,
  PLAN_FORMATS,
  SELECTOR_FIELDS,
  type ExecutionConclusion,
  type PlanFormat,
  type SelectorField,
} from "../lib/execution.js";

function requireConfig(): void {
  const validationError = config.validateConfig();
  if (validationError) {
    logger.error(validationError);
    process.exit(1);
  }
}

function resolveRunId(option: string | undefined): number {
  const raw = option ?? process.env.TESTPLANIT_RUN_ID;
  const id = parseEnvId(raw);
  if (!id) {
    logger.error(
      "No test run. Pass --run <id> or set TESTPLANIT_RUN_ID (TestPlanIt sets it when it dispatches a job)."
    );
    process.exit(1);
  }
  return id;
}

function resolveExecutionId(
  option: string | undefined,
  required: boolean
): number | undefined {
  const raw = option ?? process.env.TESTPLANIT_EXECUTION_ID;
  const id = parseEnvId(raw);
  if (!id && required) {
    logger.error(
      "No execution. Pass --execution <id> or set TESTPLANIT_EXECUTION_ID."
    );
    process.exit(1);
  }
  return id;
}

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Work with a test run TestPlanIt dispatched to CI")
    .addHelpText("after", `
Examples:

  Print the plan of automated cases as JSON (run id from TESTPLANIT_RUN_ID):
    $ testplanit run plan

  One selector per line, for a shell shim:
    $ testplanit run plan --format lines --selector-field fullName > plan.txt
    $ npx playwright test --grep "$(paste -sd'|' plan.txt)"

  Mark the run complete once every job has reported:
    $ testplanit run complete

  Tell TestPlanIt the execution finished (generic-webhook targets cannot be polled):
    $ testplanit run finish --conclusion success

Environment:
  TESTPLANIT_RUN_ID         Set by TestPlanIt when it dispatches a job
  TESTPLANIT_EXECUTION_ID   Set by TestPlanIt when it dispatches a job
  TESTPLANIT_PLAN_URL       Direct URL of the plan (same data as 'run plan')
`);

  cmd
    .command("plan")
    .description("Print the run's automated cases (the plan a CI job executes)")
    .option("-r, --run <id>", "Test run ID (default: $TESTPLANIT_RUN_ID)")
    .option(
      "--execution <id>",
      "Execution ID; applies its case subset and ref (default: $TESTPLANIT_EXECUTION_ID)"
    )
    .option(
      "-F, --format <format>",
      `Output format: ${PLAN_FORMATS.join(", ")} (default: json)`,
      "json"
    )
    .option(
      "--selector-field <field>",
      `Value printed per case with --format lines: ${SELECTOR_FIELDS.join(", ")} (default: selector)`,
      "selector"
    )
    .option("-o, --output <file>", "Write to a file instead of stdout")
    .action(async (options) => {
      requireConfig();
      const runId = resolveRunId(options.run);
      const executionId = resolveExecutionId(options.execution, false);
      const format = String(options.format).toLowerCase() as PlanFormat;
      if (!PLAN_FORMATS.includes(format)) {
        logger.error(`Invalid format: ${options.format}`);
        logger.info(`Valid formats: ${PLAN_FORMATS.join(", ")}`);
        process.exit(1);
      }
      const field = String(options.selectorField) as SelectorField;
      if (!SELECTOR_FIELDS.includes(field)) {
        logger.error(`Invalid selector field: ${options.selectorField}`);
        logger.info(`Valid fields: ${SELECTOR_FIELDS.join(", ")}`);
        process.exit(1);
      }
      try {
        const plan = await getAutomationPlan(runId, executionId);
        const text = formatPlan(plan, format, field);
        if (options.output) {
          fs.writeFileSync(options.output, text + (text ? "\n" : ""));
          logger.info(
            `Wrote ${plan.totals.cases} case(s) for run ${runId} to ${options.output}`
          );
        } else {
          process.stdout.write(text + (text ? "\n" : ""));
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  cmd
    .command("complete")
    .description("Mark the run complete (do this once, after every job has reported)")
    .option("-r, --run <id>", "Test run ID (default: $TESTPLANIT_RUN_ID)")
    .option("-p, --project <id>", "Project ID (read from the run when omitted)")
    .action(async (options) => {
      requireConfig();
      const runId = resolveRunId(options.run);
      const projectId = parseEnvId(options.project);
      try {
        const run = await completeTestRun(runId, projectId);
        logger.success(`Test run ${run.id} completed`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  cmd
    .command("finish")
    .description("Report the execution's outcome to TestPlanIt")
    .option("-r, --run <id>", "Test run ID (default: $TESTPLANIT_RUN_ID)")
    .option("--execution <id>", "Execution ID (default: $TESTPLANIT_EXECUTION_ID)")
    .requiredOption(
      "--conclusion <conclusion>",
      `Outcome: ${EXECUTION_CONCLUSIONS.join(", ")}`
    )
    .option("--message <text>", "Short note stored with the execution")
    .action(async (options) => {
      requireConfig();
      const runId = resolveRunId(options.run);
      const executionId = resolveExecutionId(options.execution, true)!;
      const conclusion = String(options.conclusion).toLowerCase() as ExecutionConclusion;
      if (!EXECUTION_CONCLUSIONS.includes(conclusion)) {
        logger.error(`Invalid conclusion: ${options.conclusion}`);
        logger.info(`Valid conclusions: ${EXECUTION_CONCLUSIONS.join(", ")}`);
        process.exit(1);
      }
      try {
        const result = await finishExecution(
          runId,
          executionId,
          conclusion,
          options.message
        );
        logger.success(`Execution ${result.id} marked ${result.status}`);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return cmd;
}
