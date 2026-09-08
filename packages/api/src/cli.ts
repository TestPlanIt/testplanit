/**
 * @packageDocumentation
 * `testplanit` — pipeline helpers for owning a test run's lifecycle from CI.
 *
 * A suite executed as several separate reporter invocations (sharded across
 * agents, or rerun in retry waves) would otherwise create one run per
 * invocation. Creating the run up front and exporting its ID as
 * `TESTPLANIT_RUN_ID` makes every invocation attach to that single run; the
 * pipeline completes it once everything has finished.
 *
 * @example
 * ```bash
 * RUN_ID=$(testplanit create-run --project 9 --name "Web Regression - DEV #984" --type MOCHA)
 * export TESTPLANIT_RUN_ID="$RUN_ID"
 * # ...run every shard, agent and retry wave...
 * testplanit complete-run --id "$RUN_ID"
 * ```
 */

import { TestPlanItClient, TestPlanItError } from "./client.js";
import type { TestRunType } from "./types.js";

const TEST_RUN_TYPES: TestRunType[] = [
  "REGULAR",
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
];

const USAGE = `testplanit — TestPlanIt pipeline helpers

Usage:
  testplanit create-run --project <id> --name <name> [options]
  testplanit complete-run --id <id> [--project <id>]

Commands:
  create-run      Create a test run and print its ID to stdout. Export the ID
                  as TESTPLANIT_RUN_ID so every reporter invocation attaches
                  to that run instead of creating its own.
  complete-run    Mark a test run done. Run this once, after every
                  invocation reporting into the run has finished.

Options for create-run:
  --project <id>        Project ID. Defaults to $TESTPLANIT_PROJECT_ID.
  --name <name>         Run name (required).
  --type <type>         ${TEST_RUN_TYPES.join(" | ")}
                        (default: REGULAR)
  --config <id|name>    Configuration to attach.
  --milestone <id|name> Milestone to attach.
  --tag <id|name>       Tag to attach. Repeatable.

Options for complete-run:
  --id <id>             Test run ID (required).
  --project <id>        Project ID. Read from the run when omitted.

Common options:
  --url <url>           TestPlanIt base URL. Defaults to $TESTPLANIT_URL,
                        then $TESTPLANIT_API_URL.
  --token <token>       API token. Defaults to $TESTPLANIT_API_TOKEN.
  -h, --help            Show this help.

Environment:
  TESTPLANIT_URL / TESTPLANIT_API_URL   Base URL of your TestPlanIt instance
  TESTPLANIT_API_TOKEN                  API token (starts with tpi_)
  TESTPLANIT_PROJECT_ID                 Default project ID
  TESTPLANIT_RUN_ID                     Read by the reporters — set it from
                                        create-run's output
`;

interface ParsedArgs {
  flags: Map<string, string[]>;
  positional: string[];
}

/**
 * Parse `--flag value` and `--flag=value` pairs. Repeated flags accumulate, so
 * `--tag a --tag b` yields both values.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }

    const withoutDashes = arg.replace(/^--?/, "");
    const equalsAt = withoutDashes.indexOf("=");

    let name: string;
    let value: string | undefined;

    if (equalsAt !== -1) {
      name = withoutDashes.slice(0, equalsAt);
      value = withoutDashes.slice(equalsAt + 1);
    } else {
      name = withoutDashes;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i++;
      }
    }

    const existing = flags.get(name) ?? [];
    existing.push(value ?? "");
    flags.set(name, existing);
  }

  return { flags, positional };
}

function firstFlag(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const values = args.flags.get(name);
    if (values && values[0] !== "") {
      return values[0];
    }
  }
  return undefined;
}

function requireFlag(args: ParsedArgs, name: string, label: string): string {
  const value = firstFlag(args, name);
  if (!value) {
    throw new TestPlanItError(`${label} is required (--${name})`);
  }
  return value;
}

/**
 * Parse a value that must be a positive integer ID.
 */
export function parseId(raw: string, label: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new TestPlanItError(`${label} must be a positive integer, got "${raw}"`);
  }
  const parsed = Number(raw.trim());
  if (parsed <= 0) {
    throw new TestPlanItError(`${label} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function buildClient(args: ParsedArgs): TestPlanItClient {
  const baseUrl =
    firstFlag(args, "url") ??
    process.env.TESTPLANIT_URL ??
    process.env.TESTPLANIT_API_URL;
  const apiToken = firstFlag(args, "token") ?? process.env.TESTPLANIT_API_TOKEN;

  if (!baseUrl) {
    throw new TestPlanItError(
      "No TestPlanIt URL. Pass --url or set TESTPLANIT_URL."
    );
  }
  if (!apiToken) {
    throw new TestPlanItError(
      "No API token. Pass --token or set TESTPLANIT_API_TOKEN."
    );
  }

  return new TestPlanItClient({ baseUrl, apiToken });
}

function resolveProjectId(args: ParsedArgs): number {
  const raw = firstFlag(args, "project") ?? process.env.TESTPLANIT_PROJECT_ID;
  if (!raw) {
    throw new TestPlanItError(
      "No project. Pass --project or set TESTPLANIT_PROJECT_ID."
    );
  }
  return parseId(raw, "Project ID");
}

/**
 * Resolve a reference that may already be a numeric ID, falling back to a
 * name lookup.
 */
async function resolveRef(
  raw: string,
  label: string,
  lookup: (name: string) => Promise<{ id: number } | undefined>
): Promise<number> {
  if (/^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  const found = await lookup(raw);
  if (!found) {
    throw new TestPlanItError(`${label} not found: "${raw}"`);
  }
  return found.id;
}

async function createRunCommand(args: ParsedArgs): Promise<string> {
  const client = buildClient(args);
  const projectId = resolveProjectId(args);
  const name = requireFlag(args, "name", "Run name");

  const typeRaw = firstFlag(args, "type");
  let testRunType: TestRunType | undefined;
  if (typeRaw) {
    const upper = typeRaw.toUpperCase() as TestRunType;
    if (!TEST_RUN_TYPES.includes(upper)) {
      throw new TestPlanItError(
        `Unknown run type "${typeRaw}". Expected one of: ${TEST_RUN_TYPES.join(", ")}`
      );
    }
    testRunType = upper;
  }

  const configRaw = firstFlag(args, "config");
  const configId = configRaw
    ? await resolveRef(configRaw, "Configuration", (n) =>
        client.findConfigurationByName(projectId, n)
      )
    : undefined;

  const milestoneRaw = firstFlag(args, "milestone");
  const milestoneId = milestoneRaw
    ? await resolveRef(milestoneRaw, "Milestone", (n) =>
        client.findMilestoneByName(projectId, n)
      )
    : undefined;

  const tagRefs = (args.flags.get("tag") ?? []).filter((t) => t !== "");
  const tagIds = tagRefs.length
    ? await client.resolveTagIds(
        projectId,
        tagRefs.map((t) => (/^\d+$/.test(t) ? Number(t) : t))
      )
    : undefined;

  const testRun = await client.createTestRun({
    projectId,
    name,
    testRunType,
    configId,
    milestoneId,
    tagIds,
  });

  console.error(`[TestPlanIt] Created test run ${testRun.id}: ${testRun.name}`);
  return String(testRun.id);
}

async function completeRunCommand(args: ParsedArgs): Promise<string> {
  const client = buildClient(args);
  const testRunId = parseId(requireFlag(args, "id", "Test run ID"), "Test run ID");

  const projectRaw = firstFlag(args, "project") ?? process.env.TESTPLANIT_PROJECT_ID;
  const projectId = projectRaw
    ? parseId(projectRaw, "Project ID")
    : (await client.getTestRun(testRunId)).projectId;

  const testRun = await client.completeTestRun(testRunId, projectId);
  console.error(`[TestPlanIt] Completed test run ${testRun.id}: ${testRun.name}`);
  return String(testRun.id);
}

/**
 * Run the CLI. Returns the text to print to stdout — command output is kept
 * clean so `RUN_ID=$(testplanit create-run ...)` captures only the ID.
 */
export async function run(argv: string[]): Promise<string> {
  const args = parseArgs(argv);
  const command = args.positional[0];

  if (!command || args.flags.has("help") || args.flags.has("h")) {
    return USAGE;
  }

  switch (command) {
    case "create-run":
      return createRunCommand(args);
    case "complete-run":
      return completeRunCommand(args);
    default:
      throw new TestPlanItError(
        `Unknown command "${command}". Run "testplanit --help" for usage.`
      );
  }
}

async function main(): Promise<void> {
  try {
    const output = await run(process.argv.slice(2));
    console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TestPlanIt] ${message}`);
    process.exitCode = 1;
  }
}

// Top-level entry guard: only fires when this module is the npm bin entry.
// `process.argv[1]` reports the installed shim (e.g. `.bin/testplanit`), so it
// is resolved through realpathSync to reach the real `dist/cli.js`. Tests
// import `run` directly, where argv[1] is the vitest runner and this is false.
function isInvokedAsBin(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.realpathSync(argv1).endsWith("cli.js");
  } catch {
    return false;
  }
}
if (isInvokedAsBin()) {
  void main();
}
