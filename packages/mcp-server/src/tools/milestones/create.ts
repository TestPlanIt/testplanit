import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  MilestonesInclude,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import { proseMirrorToMarkdown } from "../../richText.js";

export interface MilestonesCreateDeps {
  env: EnvConfig;
}

interface RawCreatedMilestone {
  id: number;
  name: string;
  isStarted: boolean;
  isCompleted: boolean;
  createdAt: string | Date;
  milestoneType: { id: number; name: string };
  creator: { id: string; name: string | null; email: string };
  parent: { id: number; name: string } | null;
  note: unknown;
}

const CREATED_MILESTONE_INCLUDE = {
  milestoneType: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, name: true } },
} as const satisfies MilestonesInclude;

export function registerMilestonesCreate(
  server: McpServer,
  deps: MilestonesCreateDeps,
): void {
  server.registerTool(
    "testplanit_milestones_create",
    {
      description:
        "Create a new milestone in a project. The milestone type defaults to the one marked Default; use testplanit_milestone_types_list to pick another. Optionally nest under a parent milestone. Returns the created milestone header.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project to create the milestone in."),
        name: z.string().min(1).max(500).describe("Milestone name."),
        milestoneTypeId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Milestone type ID. Defaults to the type marked Default. Use testplanit_milestone_types_list to get the available types.",
          ),
        parentId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Parent milestone ID for nesting."),
        note: z
          .string()
          .optional()
          .describe("Note for the milestone. Markdown is formatted."),
      },
    },
    async (input) => {
      try {
        // The web UI preselects the type marked Default.
        let milestoneTypeId = input.milestoneTypeId;
        if (milestoneTypeId == null) {
          const def = await zenstack<{ id: number } | null>(
            "milestoneTypes",
            "findFirst",
            {
              where: { isDefault: true, isDeleted: false },
              select: { id: true },
            },
            deps.env,
          );
          if (!def) {
            throw new TestPlanItHttpError(
              "No milestone type is marked Default; pass milestoneTypeId (see testplanit_milestone_types_list).",
              { statusCode: 422 },
            );
          }
          milestoneTypeId = def.id;
        }

        const raw = await zenstack<RawCreatedMilestone>(
          "milestones",
          "create",
          {
            data: {
              name: input.name,
              project: { connect: { id: input.projectId } },
              milestoneType: { connect: { id: milestoneTypeId } },
              ...(input.parentId
                ? { parent: { connect: { id: input.parentId } } }
                : {}),
              ...(input.note !== undefined ? { note: input.note } : {}),
            },
            include: CREATED_MILESTONE_INCLUDE,
          },
          deps.env,
        );

        const detail = {
          id: raw.id,
          name: raw.name,
          isStarted: raw.isStarted,
          isCompleted: raw.isCompleted,
          createdAt: raw.createdAt,
          milestoneType: raw.milestoneType
            ? { id: raw.milestoneType.id, name: raw.milestoneType.name }
            : null,
          creator: raw.creator
            ? {
                id: raw.creator.id,
                name: raw.creator.name,
                email: raw.creator.email,
              }
            : null,
          parent: raw.parent
            ? { id: raw.parent.id, name: raw.parent.name }
            : null,
          note: proseMirrorToMarkdown(raw.note),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(detail) }],
          structuredContent: detail as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
