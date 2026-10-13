import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { getHostJson } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface AutomationTargetsListDeps {
  env: EnvConfig;
}

interface TargetsResponse {
  targets: Array<{
    id: number;
    name: string;
    provider: string;
    defaultRef: string | null;
    isEnabled: boolean;
  }>;
}

export function registerAutomationTargetsList(
  server: McpServer,
  deps: AutomationTargetsListDeps,
): void {
  server.registerTool(
    "testplanit_automation_targets_list",
    {
      description:
        "List a project's execution targets (where automated cases can be dispatched): id, name, provider (GITHUB_ACTIONS | GITLAB_CI | GENERIC_WEBHOOK), default ref and whether the target is enabled. Credentials and URLs are never returned. Use a target id with testplanit_runs_execute.",
      inputSchema: {
        projectId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const result = await getHostJson<TargetsResponse>(
          `/api/projects/${input.projectId}/execution-targets`,
          deps.env,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result.targets) }],
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
