import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami, type WhoamiDeps } from "./whoami.js";
import { registerCases, type CasesDeps } from "./cases/index.js";
import { registerFolders, type FoldersDeps } from "./folders/index.js";
import { registerTags, type TagsDeps } from "./tags/index.js";
import { registerProjects, type ProjectsDeps } from "./projects/index.js";
import { registerRuns, type RunsDeps } from "./runs/index.js";
import { registerSessions, type SessionsDeps } from "./sessions/index.js";
import {
  registerCodeRepositories,
  type CodeRepositoriesDeps,
} from "./code-repositories/index.js";
import { registerIssues, type IssuesDeps } from "./issues/index.js";
import {
  registerRepositoryCaseLinks,
  type RepositoryCaseLinksDeps,
} from "./repository-case-links/index.js";
import {
  registerMilestones,
  type MilestonesDeps,
} from "./milestones/index.js";

/**
 * Aggregate dependencies for every tool registered by
 * `@testplanit/mcp-server`. The intersection widens with each new domain;
 * adding a new domain barrel means adding the matching `& <Domain>Deps`
 * here so all registered tools see the same single deps object at runtime.
 */
export type ToolRegistryDeps =
  & WhoamiDeps
  & CasesDeps
  & FoldersDeps
  & TagsDeps
  & ProjectsDeps
  & RunsDeps
  & SessionsDeps
  & CodeRepositoriesDeps
  & IssuesDeps
  & RepositoryCaseLinksDeps
  & MilestonesDeps;

/**
 * Register every tool shipped by `@testplanit/mcp-server`.
 *
 * Tools are grouped by domain: whoami (debug/identity), cases, folders,
 * tags, projects (agent context disambiguation), runs, sessions,
 * code-repositories, issues, repository-case-links, and milestones
 * (milestones_list, milestones_get, milestone_types_list).
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
  registerRuns(server, deps);
  registerSessions(server, deps);
  registerCodeRepositories(server, deps);
  registerIssues(server, deps);
  registerRepositoryCaseLinks(server, deps);
  registerMilestones(server, deps);
}

export {
  registerWhoami,
  registerCases,
  registerFolders,
  registerTags,
  registerProjects,
  registerRuns,
  registerSessions,
  registerCodeRepositories,
  registerIssues,
  registerRepositoryCaseLinks,
  registerMilestones,
};
export type { WhoamiDeps } from "./whoami.js";
export type { CasesDeps } from "./cases/index.js";
export type { FoldersDeps } from "./folders/index.js";
export type { TagsDeps } from "./tags/index.js";
export type { ProjectsDeps } from "./projects/index.js";
export type { RunsDeps } from "./runs/index.js";
export type { SessionsDeps } from "./sessions/index.js";
export type { CodeRepositoriesDeps } from "./code-repositories/index.js";
export type { IssuesDeps } from "./issues/index.js";
export type { RepositoryCaseLinksDeps } from "./repository-case-links/index.js";
export type { MilestonesDeps } from "./milestones/index.js";
