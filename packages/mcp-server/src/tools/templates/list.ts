import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface TemplatesListDeps {
  env: EnvConfig;
}

interface RawTemplateRow {
  id: number;
  templateName: string;
  isDefault: boolean;
  caseFields: Array<{
    order: number;
    caseField: {
      displayName: string;
      systemName: string;
      isRequired: boolean;
      type: { type: string | null } | null;
    } | null;
  }>;
}

// Select the enabled, non-deleted case fields each template assigns, in
// display order — the same set the web Add-Case UI renders.
const TEMPLATE_LIST_SELECT = {
  id: true,
  templateName: true,
  isDefault: true,
  caseFields: {
    where: { caseField: { isEnabled: true, isDeleted: false } },
    orderBy: { order: "asc" },
    select: {
      order: true,
      caseField: {
        select: {
          displayName: true,
          systemName: true,
          isRequired: true,
          type: { select: { type: true } },
        },
      },
    },
  },
} as const satisfies Prisma.TemplatesSelect;

/**
 * List a project's enabled templates with the case fields each defines.
 *
 * Read-only. Mirrors the template picker in the web Add-Case UI: enabled,
 * non-deleted templates assigned to the project, each with its assigned case
 * fields (display order) — so an agent can choose a `templateId` for
 * testplanit_cases_create / testplanit_cases_create_many and know which custom
 * fields that template accepts.
 */
export function registerTemplatesList(
  server: McpServer,
  deps: TemplatesListDeps,
): void {
  server.registerTool(
    "testplanit_templates_list",
    {
      description:
        "List a project's enabled templates, each with the case fields it defines (displayName, systemName, type, required). Use this to pick a templateId for testplanit_cases_create / testplanit_cases_create_many and to learn which customFields a template accepts. Read-only.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project whose enabled templates to list."),
      },
    },
    async (input) => {
      try {
        const rows = await zenstack<RawTemplateRow[]>(
          "templates",
          "findMany",
          {
            where: {
              isDeleted: false,
              isEnabled: true,
              projects: { some: { projectId: input.projectId } },
            } satisfies Prisma.TemplatesWhereInput,
            select: TEMPLATE_LIST_SELECT,
            orderBy: { templateName: "asc" },
          },
          deps.env,
        );

        const templates = (rows ?? []).map((t) => ({
          id: t.id,
          templateName: t.templateName,
          isDefault: t.isDefault,
          fields: (t.caseFields ?? [])
            .filter((a) => a.caseField != null)
            .map((a) => ({
              displayName: a.caseField!.displayName,
              systemName: a.caseField!.systemName,
              type: a.caseField!.type?.type ?? null,
              required: a.caseField!.isRequired,
            })),
        }));

        const out = { templates };
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
