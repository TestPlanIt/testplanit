import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerCodeRepositoriesList,
  type CodeRepositoriesListDeps,
} from "./list.js";

/**
 * Aggregate dependencies for the Phase 8 code-repositories read tools. Only
 * one tool today (`testplanit_code_repositories_list`); aliasing rather than
 * intersecting keeps room to add `_get` etc. via union extension when the
 * single-row-per-project invariant relaxes.
 *
 * Registry wiring into `tools/index.ts` is intentionally deferred to plan
 * 08-05 (wave 3) so plans 08-01..08-04 can run in parallel without touching
 * the same file.
 */
export type CodeRepositoriesDeps = CodeRepositoriesListDeps;

export function registerCodeRepositories(
  server: McpServer,
  deps: CodeRepositoriesDeps,
): void {
  registerCodeRepositoriesList(server, deps);
}

export { registerCodeRepositoriesList };
export type { CodeRepositoriesListDeps };
