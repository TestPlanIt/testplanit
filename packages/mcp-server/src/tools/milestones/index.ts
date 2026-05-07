import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerMilestonesList,
  type MilestonesListDeps,
} from "./list.js";
import {
  registerMilestonesGet,
  type MilestonesGetDeps,
} from "./get.js";
import {
  registerMilestoneTypesList,
  type MilestoneTypesListDeps,
} from "./types-list.js";

/**
 * Aggregate dependencies for the milestones-domain read tools. All three
 * tools share the same EnvConfig; this intersection mirrors the runs /
 * cases / sessions / issues barrel pattern so callers can pass a single
 * deps object.
 */
export type MilestonesDeps = MilestonesListDeps &
  MilestonesGetDeps &
  MilestoneTypesListDeps;

export function registerMilestones(
  server: McpServer,
  deps: MilestonesDeps,
): void {
  registerMilestonesList(server, deps);
  registerMilestonesGet(server, deps);
  registerMilestoneTypesList(server, deps);
}

export {
  registerMilestonesList,
  registerMilestonesGet,
  registerMilestoneTypesList,
};
export type {
  MilestonesListDeps,
  MilestonesGetDeps,
  MilestoneTypesListDeps,
};
