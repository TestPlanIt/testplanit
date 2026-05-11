import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { extractProseMirrorText } from "../cases/shared.js";

export interface MilestonesUpdateDeps {
  env: EnvConfig;
}

interface RawUpdatedMilestone {
  id: number;
  name: string;
  isStarted: boolean;
  isCompleted: boolean;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
  milestoneType: { id: number; name: string };
  creator: { id: string; name: string | null; email: string };
  parent: { id: number; name: string } | null;
  note: unknown;
}

const UPDATED_MILESTONE_INCLUDE = {
  milestoneType: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, name: true } },
} as const;

export function registerMilestonesUpdate(
  server: McpServer,
  deps: MilestonesUpdateDeps,
): void {
  server.registerTool(
    "testplanit_milestones_update",
    {
      description:
        "Update an existing milestone. All fields except milestoneId are optional — only supplied fields are changed. Setting isCompleted: true also records completedAt; setting isStarted: true records startedAt. Returns the updated milestone header.",
      inputSchema: {
        milestoneId: z
          .number()
          .int()
          .positive()
          .describe("ID of the milestone to update."),
        name: z.string().min(1).max(500).optional().describe("New name."),
        note: z
          .string()
          .nullable()
          .optional()
          .describe("Updated plain-text note. Pass null to clear."),
        milestoneTypeId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Change the milestone type."),
        parentId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Move under a different parent; null to make top-level."),
        isStarted: z
          .boolean()
          .optional()
          .describe("Mark as started (true) or not started (false)."),
        isCompleted: z
          .boolean()
          .optional()
          .describe("Mark as completed (true) or reopen (false)."),
      },
    },
    async (input) => {
      try {
        const data: Record<string, unknown> = {};

        if (input.name !== undefined) data.name = input.name;
        if (input.note !== undefined) {
          data.note = input.note === null ? null : input.note;
        }
        if (input.milestoneTypeId !== undefined) {
          data.milestoneType = { connect: { id: input.milestoneTypeId } };
        }
        if (input.parentId !== undefined) {
          data.parent =
            input.parentId === null
              ? { disconnect: true }
              : { connect: { id: input.parentId } };
        }
        if (input.isStarted !== undefined) {
          data.isStarted = input.isStarted;
          data.startedAt = input.isStarted ? new Date().toISOString() : null;
        }
        if (input.isCompleted !== undefined) {
          data.isCompleted = input.isCompleted;
          data.completedAt = input.isCompleted
            ? new Date().toISOString()
            : null;
        }

        if (Object.keys(data).length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "No fields to update — provide at least one optional field.",
              },
            ],
          };
        }

        const raw = await zenstack<RawUpdatedMilestone>(
          "milestones",
          "update",
          {
            where: { id: input.milestoneId },
            data,
            include: UPDATED_MILESTONE_INCLUDE,
          },
          deps.env,
        );

        const detail = {
          id: raw.id,
          name: raw.name,
          isStarted: raw.isStarted,
          isCompleted: raw.isCompleted,
          startedAt: raw.startedAt ?? null,
          completedAt: raw.completedAt ?? null,
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
          note: extractProseMirrorText(raw.note),
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
