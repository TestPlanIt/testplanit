import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkflowsFindManyArgs, WorkflowsWhereInput } from "@db/input";
import * as z from "zod/v4";
import { zenstack, resolveDefaultTemplate } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import { resolveTagIds } from "../cases/shared.js";

type WorkflowsOrderByWithRelationInput = NonNullable<
  WorkflowsFindManyArgs["orderBy"]
>;
import {
  SESSION_DETAIL_INCLUDE,
  mapSessionDetail,
  type RawSessionDetail,
} from "./shared.js";

export interface SessionsCreateDeps {
  env: EnvConfig;
}

const SESSION_RESULTS_INLINE_CAP = 100;

export async function resolveSessionState(
  projectId: number,
  env: EnvConfig,
  name?: string,
): Promise<{ id: number; name: string }> {
  const workflows = await zenstack<{ id: number; name: string }[]>(
    "workflows",
    "findMany",
    {
      where: {
        isEnabled: true,
        isDeleted: false,
        scope: "SESSIONS",
        projects: { some: { projectId } },
        ...(name ? { name } : {}),
      } satisfies WorkflowsWhereInput,
      orderBy: { order: "asc" } satisfies WorkflowsOrderByWithRelationInput,
      take: 1,
    },
    env,
  );
  if (!workflows || workflows.length === 0) {
    const suffix = name ? ` named "${name}"` : "";
    throw new TestPlanItHttpError(
      `No SESSIONS-scope workflow state found for project ${projectId}${suffix}.`,
      { statusCode: 422 },
    );
  }
  return workflows[0];
}

export function registerSessionsCreate(
  server: McpServer,
  deps: SessionsCreateDeps,
): void {
  server.registerTool(
    "testplanit_sessions_create",
    {
      description:
        "Create a new exploratory test session in a project. Resolves the default template and SESSIONS workflow state automatically. Returns the full denormalized session detail (same shape as testplanit_sessions_get).",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project to create the session in."),
        name: z.string().min(1).max(500).describe("Session name."),
        mission: z
          .string()
          .optional()
          .describe("Plain-text mission statement for the session."),
        milestoneId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Milestone to link the session to."),
        configId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Configuration ID to associate with the session."),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "SESSIONS workflow state name. Defaults to the first state by order.",
          ),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe("Tag IDs (numbers) or tag names (strings, created if missing)."),
      },
    },
    async (input) => {
      try {
        const templateId = await resolveDefaultTemplate(
          input.projectId,
          deps.env,
        );
        const state = await resolveSessionState(
          input.projectId,
          deps.env,
          input.stateName,
        );
        const tagIds = await resolveTagIds(input.tags, deps.env);

        const created = await zenstack<{ id: number }>(
          "sessions",
          "create",
          {
            data: {
              name: input.name,
              project: { connect: { id: input.projectId } },
              template: { connect: { id: templateId } },
              state: { connect: { id: state.id } },
              ...(input.mission !== undefined
                ? { mission: input.mission }
                : {}),
              ...(input.milestoneId
                ? { milestone: { connect: { id: input.milestoneId } } }
                : {}),
              ...(input.configId
                ? { configuration: { connect: { id: input.configId } } }
                : {}),
              ...(tagIds.length > 0
                ? { tags: { connect: tagIds.map((id) => ({ id })) } }
                : {}),
            },
            select: { id: true },
          },
          deps.env,
        );

        const raw = await zenstack<RawSessionDetail | null>(
          "sessions",
          "findUnique",
          {
            where: { id: created.id },
            include: SESSION_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          throw new TestPlanItHttpError(
            `Session ${created.id} was created but could not be re-fetched.`,
            { statusCode: 422 },
          );
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
