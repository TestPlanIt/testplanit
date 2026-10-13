import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { getHostJson } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface RunsAutomationPlanDeps {
  env: EnvConfig;
}

export function registerRunsAutomationPlan(
  server: McpServer,
  deps: RunsAutomationPlanDeps,
): void {
  server.registerTool(
    "testplanit_runs_automation_plan",
    {
      description:
        "Read the plan a CI job executes for a run: its automated cases with every identifier a runner filter can match on — `selector.fullName` (className.name), `selector.name`, `selector.idTokens` ([123], C123, TC123) and tags. Pass `executionId` to apply that execution's ad-hoc case subset and ref. Same data the job gets from TESTPLANIT_PLAN_URL or `testplanit run plan`.",
      inputSchema: {
        runId: z.number().int().positive(),
        executionId: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        const query = input.executionId ? `?executionId=${input.executionId}` : "";
        const plan = await getHostJson<unknown>(
          `/api/test-runs/${input.runId}/automation-plan${query}`,
          deps.env,
        );
        return { content: [{ type: "text", text: JSON.stringify(plan) }] };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
