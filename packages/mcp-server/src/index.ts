/**
 * @packageDocumentation
 * Model Context Protocol server for TestPlanIt.
 *
 * Library usage:
 * ```ts
 * import { runServer } from "@testplanit/mcp-server";
 * await runServer();
 * ```
 *
 * Bin usage:
 * ```sh
 * npx @testplanit/mcp-server
 * ```
 *
 * Required env vars:
 * - `TESTPLANIT_API_TOKEN` — API token from your TestPlanIt profile (must
 *   start with `tpi_`).
 * - `TESTPLANIT_API_URL` (optional) — defaults to the TestPlanIt SaaS URL
 *   (`https://app.testplanit.com`).
 */

export { runServer, defaultRunDeps } from "./cli.js";
export { createServer } from "./server.js";
export { parseEnv } from "./env.js";
export {
  validateToken,
  redactToken,
  TestPlanItHttpError,
} from "./http.js";
export { mapHttpErrorToToolResult } from "./errors.js";
export { registerAll, registerWhoami } from "./tools/index.js";

export type { ServerDeps } from "./server.js";
export type { EnvConfig } from "./env.js";
export type { WhoamiUser, ValidateResult } from "./http.js";
export type { RunDeps } from "./cli.js";
export type { ToolErrorResult } from "./errors.js";
export type { ToolRegistryDeps, WhoamiDeps } from "./tools/index.js";
