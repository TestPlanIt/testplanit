import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { generateQuickScript } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface CasesGenerateScriptDeps {
  env: EnvConfig;
}

export function registerCasesGenerateScript(
  server: McpServer,
  deps: CasesGenerateScriptDeps,
): void {
  server.registerTool(
    "testplanit_cases_generate_script",
    {
      description:
        "Generate a QuickScript — an AI-authored automation test script — from one or more stored test cases. The server resolves the project's export template and, when a code repository is connected to the project, pulls repository context so the script follows the repo's existing framework, fixtures, and page objects (this takes precedence over the template's framework — intended behavior). When no LLM integration is configured or generation fails, each file falls back to the deterministic template render (generatedBy=\"template\"). Requires QuickScript to be enabled for the project. Returns the generated file(s) plus the resolved framework/language/fileExtension for naming.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project the cases belong to."),
        caseIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .describe("Stored test case IDs to generate a script from (1–50)."),
        templateId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Export template to use. Defaults to the project's default/assigned template. Use testplanit_templates_list to discover templates.",
          ),
        outputMode: z
          .enum(["combined", "perCase"])
          .optional()
          .describe(
            "\"combined\" (default): one file containing all cases. \"perCase\": one file per case.",
          ),
      },
    },
    async (input) => {
      try {
        const result = await generateQuickScript(
          {
            projectId: input.projectId,
            caseIds: input.caseIds,
            ...(input.templateId != null
              ? { templateId: input.templateId }
              : {}),
            ...(input.outputMode ? { outputMode: input.outputMode } : {}),
          },
          deps.env,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
