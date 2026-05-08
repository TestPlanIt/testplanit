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
import {
  registerMilestonesCreate,
  type MilestonesCreateDeps,
} from "./create.js";
import {
  registerMilestonesUpdate,
  type MilestonesUpdateDeps,
} from "./update.js";

export type MilestonesDeps = MilestonesListDeps &
  MilestonesGetDeps &
  MilestoneTypesListDeps &
  MilestonesCreateDeps &
  MilestonesUpdateDeps;

export function registerMilestones(
  server: McpServer,
  deps: MilestonesDeps,
): void {
  registerMilestonesList(server, deps);
  registerMilestonesGet(server, deps);
  registerMilestoneTypesList(server, deps);
  registerMilestonesCreate(server, deps);
  registerMilestonesUpdate(server, deps);
}

export {
  registerMilestonesList,
  registerMilestonesGet,
  registerMilestoneTypesList,
  registerMilestonesCreate,
  registerMilestonesUpdate,
};
export type {
  MilestonesListDeps,
  MilestonesGetDeps,
  MilestoneTypesListDeps,
  MilestonesCreateDeps,
  MilestonesUpdateDeps,
};
