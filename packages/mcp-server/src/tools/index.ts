import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami, type WhoamiDeps } from "./whoami.js";
import { registerCases, type CasesDeps } from "./cases/index.js";
import { registerFolders, type FoldersDeps } from "./folders/index.js";
import { registerTags, type TagsDeps } from "./tags/index.js";
import { registerProjects, type ProjectsDeps } from "./projects/index.js";

/**
 * Aggregate dependencies for every tool registered by
 * `@testplanit/mcp-server`. Phase 5 introduced WhoamiDeps; Phase 6 extends
 * with CasesDeps, FoldersDeps, TagsDeps, and ProjectsDeps.
 */
export type ToolRegistryDeps =
  & WhoamiDeps
  & CasesDeps
  & FoldersDeps
  & TagsDeps
  & ProjectsDeps;

/**
 * Register every tool shipped by `@testplanit/mcp-server`.
 *
 * Tools are grouped by domain: whoami (debug/identity), cases (CASE-01..05),
 * folders (CASE-06..10), tags (CASE-11), projects (agent context
 * disambiguation — Claude's Discretion include).
 */
export function registerAll(
  server: McpServer,
  deps: ToolRegistryDeps,
): void {
  registerWhoami(server, deps);
  registerCases(server, deps);
  registerFolders(server, deps);
  registerTags(server, deps);
  registerProjects(server, deps);
}

export { registerWhoami, registerCases, registerFolders, registerTags, registerProjects };
export type { WhoamiDeps } from "./whoami.js";
export type { CasesDeps } from "./cases/index.js";
export type { FoldersDeps } from "./folders/index.js";
export type { TagsDeps } from "./tags/index.js";
export type { ProjectsDeps } from "./projects/index.js";
