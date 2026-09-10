import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { postHostJson } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface RunsExecuteDeps {
  env: EnvConfig;
}

interface ExecuteResponse {
  executionId: number;
  status: string;
  selectionCount: number;
  queued: boolean;
}

export function registerRunsExecute(
  server: McpServer,
  deps: RunsExecuteDeps,
): void {
  server.registerTool(
    "testplanit_runs_execute",
    {
      description:
        "Ask TestPlanIt to execute a run's automated cases on one of the project's execution targets (a GitHub Actions workflow, a GitLab CI pipeline, or a signed webhook — list them with testplanit_automation_targets_list). TestPlanIt starts the job with TESTPLANIT_RUN_ID and a plan URL; the job reads the plan (testplanit_runs_automation_plan) and reports results back into the run. Optional `caseIds` limits the request to those automated cases; `ref` overrides the target's default branch. Refused (409) when the run is completed, has no automated cases, or already has an execution in flight; the run becomes HYBRID once executed. Returns the new execution's id and status (PENDING until the worker dispatches it).",
      inputSchema: {
        runId: z.number().int().positive(),
        targetId: z.number().int().positive(),
        ref: z.string().min(1).max(255).optional(),
        caseIds: z.array(z.number().int().positive()).max(5000).optional(),
      },
    },
    async (input) => {
      try {
        const result = await postHostJson<ExecuteResponse>(
          `/api/test-runs/${input.runId}/execute`,
          {
            targetId: input.targetId,
            ...(input.ref ? { ref: input.ref } : {}),
            ...(input.caseIds ? { caseIds: input.caseIds } : {}),
          },
          deps.env,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ runId: input.runId, ...result }),
            },
          ],
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
