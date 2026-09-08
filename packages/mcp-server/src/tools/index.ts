import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami, type WhoamiDeps } from "./whoami.js";
import { registerCases, type CasesDeps } from "./cases/index.js";
import { registerTemplates, type TemplatesDeps } from "./templates/index.js";
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
import { registerReviews, type ReviewsDeps } from "./reviews/index.js";

/**
 * Aggregate dependencies for every tool registered by
 * `@testplanit/mcp-server`. The intersection widens with each new domain;
 * adding a new domain barrel means adding the matching `& <Domain>Deps`
 * here so all registered tools see the same single deps object at runtime.
 */
export type ToolRegistryDeps =
  & WhoamiDeps
  & CasesDeps
  & TemplatesDeps
  & FoldersDeps
  & TagsDeps
  & ProjectsDeps
  & RunsDeps
  & SessionsDeps
  & CodeRepositoriesDeps
  & IssuesDeps
  & RepositoryCaseLinksDeps
  & MilestonesDeps
  & ReviewsDeps;

/**
 * Register every tool shipped by `@testplanit/mcp-server`.
 *
 * Tools are grouped by domain: whoami (debug/identity), cases, templates
 * (templates_list), folders, tags, projects (agent context disambiguation),
 * runs, sessions, code-repositories, issues, repository-case-links,
 * milestones (milestones_list, milestones_get, milestone_types_list), and
 * reviews (the caller's own review inbox).
 */
export function registerAll(
  server: McpServer,
  deps: ToolRegistryDeps,
): void {
  registerWhoami(server, deps);
  registerCases(server, deps);
  registerTemplates(server, deps);
  registerFolders(server, deps);
  registerTags(server, deps);
  registerProjects(server, deps);
  registerRuns(server, deps);
  registerSessions(server, deps);
  registerCodeRepositories(server, deps);
  registerIssues(server, deps);
  registerRepositoryCaseLinks(server, deps);
  registerMilestones(server, deps);
  registerReviews(server, deps);
}

export {
  registerWhoami,
  registerCases,
  registerTemplates,
  registerFolders,
  registerTags,
  registerProjects,
  registerRuns,
  registerSessions,
  registerCodeRepositories,
  registerIssues,
  registerRepositoryCaseLinks,
  registerMilestones,
  registerReviews,
};
export type { WhoamiDeps } from "./whoami.js";
export type { CasesDeps } from "./cases/index.js";
export type { TemplatesDeps } from "./templates/index.js";
export type { FoldersDeps } from "./folders/index.js";
export type { TagsDeps } from "./tags/index.js";
export type { ProjectsDeps } from "./projects/index.js";
export type { RunsDeps } from "./runs/index.js";
export type { SessionsDeps } from "./sessions/index.js";
export type { CodeRepositoriesDeps } from "./code-repositories/index.js";
export type { IssuesDeps } from "./issues/index.js";
export type { RepositoryCaseLinksDeps } from "./repository-case-links/index.js";
export type { MilestonesDeps } from "./milestones/index.js";
export type { ReviewsDeps } from "./reviews/index.js";
