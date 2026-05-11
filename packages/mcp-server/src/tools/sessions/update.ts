import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { resolveTagIds } from "../cases/shared.js";
import { resolveSessionState } from "./create.js";
import {
  SESSION_DETAIL_INCLUDE,
  mapSessionDetail,
  type RawSessionDetail,
} from "./shared.js";

export interface SessionsUpdateDeps {
  env: EnvConfig;
}

const SESSION_RESULTS_INLINE_CAP = 100;

export function registerSessionsUpdate(
  server: McpServer,
  deps: SessionsUpdateDeps,
): void {
  server.registerTool(
    "testplanit_sessions_update",
    {
      description:
        "Update an existing exploratory test session. All fields except sessionId are optional — only supplied fields are changed. Tags use full-replacement semantics (the new list replaces all current tags). Returns the full denormalized session detail.",
      inputSchema: {
        sessionId: z
          .number()
          .int()
          .positive()
          .describe("ID of the session to update."),
        name: z.string().min(1).max(500).optional().describe("New session name."),
        mission: z
          .string()
          .nullable()
          .optional()
          .describe("Updated mission statement. Pass null to clear."),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe("SESSIONS workflow state name to transition to."),
        milestoneId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Milestone to link; pass null to remove."),
        configId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Configuration ID; pass null to remove."),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe("Replacement tag list (full set). Replaces all current tags."),
        isCompleted: z
          .boolean()
          .optional()
          .describe("Mark the session completed (true) or reopen it (false)."),
      },
    },
    async (input) => {
      try {
        const data: Record<string, unknown> = {};

        if (input.name !== undefined) data.name = input.name;
        if (input.mission !== undefined) {
          data.mission = input.mission;
        }

        if (input.stateName !== undefined) {
          const session = await zenstack<{ projectId: number } | null>(
            "sessions",
            "findUnique",
            {
              where: { id: input.sessionId },
              select: { projectId: true } satisfies Prisma.SessionsSelect,
            },
            deps.env,
          );
          if (!session) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Session ${input.sessionId} not found.`,
                },
              ],
            };
          }
          const state = await resolveSessionState(
            session.projectId,
            deps.env,
            input.stateName,
          );
          data.state = { connect: { id: state.id } };
        }

        if (input.milestoneId !== undefined) {
          data.milestone =
            input.milestoneId === null
              ? { disconnect: true }
              : { connect: { id: input.milestoneId } };
        }

        if (input.configId !== undefined) {
          data.configuration =
            input.configId === null
              ? { disconnect: true }
              : { connect: { id: input.configId } };
        }

        if (input.isCompleted !== undefined) {
          data.isCompleted = input.isCompleted;
          if (input.isCompleted) {
            data.completedAt = new Date().toISOString();
          } else {
            data.completedAt = null;
          }
        }

        if (input.tags !== undefined) {
          const tagIds = await resolveTagIds(input.tags, deps.env);
          data.tags = { set: tagIds.map((id) => ({ id })) };
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

        await zenstack(
          "sessions",
          "update",
          {
            where: { id: input.sessionId },
            data,
            select: { id: true },
          },
          deps.env,
        );

        const raw = await zenstack<RawSessionDetail | null>(
          "sessions",
          "findUnique",
          {
            where: { id: input.sessionId },
            include: SESSION_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Session ${input.sessionId} not found after update.`,
              },
            ],
          };
        }

        const sessionResultsRaw = raw.sessionResults ?? [];
        const truncated = sessionResultsRaw.length > SESSION_RESULTS_INLINE_CAP;
        const trimmedRaw: RawSessionDetail = {
          ...raw,
          sessionResults: sessionResultsRaw.slice(0, SESSION_RESULTS_INLINE_CAP),
        };

        const detail = mapSessionDetail(trimmedRaw, { truncated });
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
