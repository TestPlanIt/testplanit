import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  MilestonesInclude,
} from "@db/input";
import * as z from "zod/v4";
import { postHostJson, zenstack } from "../../api.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { proseMirrorToMarkdown } from "../../richText.js";

export interface MilestonesUpdateDeps {
  env: EnvConfig;
}

interface MilestoneHead {
  id: number;
  isStarted: boolean;
  isCompleted: boolean;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  integrationId: number | null;
  detachedAt: string | Date | null;
}

/** A YYYY-MM-DD day pinned to UTC midnight, the app's calendar-date shape. */
const calendarDate = (day: string): string => `${day}T00:00:00.000Z`;
const today = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return calendarDate(`${y}-${m}-${d}`);
};
const toIso = (value: string | Date | null): string | null =>
  value == null ? null : new Date(value).toISOString();

// Fields the external tracker owns on a synced milestone; the host refuses
// an update that carries any of them.
const TRACKER_OWNED = ["name", "note", "isStarted", "isCompleted", "startedAt", "completedAt"] as const;

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
} as const satisfies MilestonesInclude;

export function registerMilestonesUpdate(
  server: McpServer,
  deps: MilestonesUpdateDeps,
): void {
  server.registerTool(
    "testplanit_milestones_update",
    {
      description:
        "Update an existing milestone. All fields except milestoneId are optional — only supplied fields are changed. startedAt and completedAt are calendar days (YYYY-MM-DD): completedAt is the planned due date until the milestone completes. isStarted: true keeps an existing start date or records today; isCompleted: true completes the milestone the way the app does — its completion date is the planned due date (or completedAt / today), every child milestone completes with it, and its active test runs and sessions complete too only when completeTestRuns / completeSessions are true (each needs the matching close permission). isCompleted: false reopens it, which is refused while the parent milestone is completed. Milestones synced from an external tracker cannot have their name, note, dates or state changed here. Returns the updated milestone header.",
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
          .describe("Updated note; Markdown is formatted. Pass null to clear."),
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
        startedAt: z
          .iso.date()
          .nullable()
          .optional()
          .describe("Start date, YYYY-MM-DD; null clears it."),
        completedAt: z
          .iso.date()
          .nullable()
          .optional()
          .describe("Due date (completion date once completed), YYYY-MM-DD; null clears it and turns off automatic completion and due-date notifications."),
        isStarted: z
          .boolean()
          .optional()
          .describe("Mark as started (true) or not started (false)."),
        isCompleted: z
          .boolean()
          .optional()
          .describe("Complete (true) or reopen (false). Completing cascades to child milestones."),
        completeTestRuns: z
          .boolean()
          .optional()
          .describe("With isCompleted: true, also complete the milestone's active test runs (default false)."),
        completeSessions: z
          .boolean()
          .optional()
          .describe("With isCompleted: true, also complete the milestone's active sessions (default false)."),
      },
    },
    async (input) => {
      try {
        const touched = TRACKER_OWNED.filter((f) => input[f] !== undefined);
        const changesAnything =
          touched.length > 0 ||
          input.milestoneTypeId !== undefined ||
          input.parentId !== undefined;
        if (!changesAnything) {
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

        const head = await zenstack<MilestoneHead | null>(
          "milestones",
          "findUnique",
          {
            where: { id: input.milestoneId, isDeleted: false },
            select: {
              id: true,
              isStarted: true,
              isCompleted: true,
              startedAt: true,
              completedAt: true,
              integrationId: true,
              detachedAt: true,
            },
          },
          deps.env,
        );
        if (!head) {
          throw new TestPlanItHttpError(`Milestone ${input.milestoneId} not found.`, {
            statusCode: 404,
          });
        }
        if (head.integrationId != null && head.detachedAt == null && touched.length > 0) {
          throw new TestPlanItHttpError(
            `Milestone ${input.milestoneId} is synced from an external tracker; its ${touched.join(", ")} cannot be changed here.`,
            { statusCode: 422 },
          );
        }

        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.note !== undefined) {
          // null stores the empty document, as the editor does when cleared.
          data.note = input.note === null ? "" : input.note;
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
        if (input.startedAt !== undefined) {
          data.startedAt = input.startedAt === null ? null : calendarDate(input.startedAt);
        }
        if (input.completedAt !== undefined) {
          data.completedAt = input.completedAt === null ? null : calendarDate(input.completedAt);
          if (input.completedAt === null) {
            // No due date: nothing to complete automatically or warn about.
            data.automaticCompletion = false;
            data.notifyDaysBefore = 0;
          }
        }
        if (input.isStarted !== undefined) {
          data.isStarted = input.isStarted;
          if (input.isStarted) {
            // Keep a planned start date; record today otherwise.
            if (data.startedAt === undefined && head.startedAt == null) data.startedAt = today();
          } else {
            data.startedAt = null;
          }
        }
        if (input.isCompleted === false) {
          data.isCompleted = false;
          data.completedAt = null;
        }

        const completing = input.isCompleted === true && !head.isCompleted;
        if (completing) {
          // The app's completion: due date as completion date, child
          // milestones with it, runs and sessions only when asked.
          const completionDay =
            input.completedAt ?? toIso(head.completedAt)?.slice(0, 10) ?? undefined;
          await postHostJson(
            `/api/milestones/${input.milestoneId}/complete`,
            {
              ...(completionDay ? { completionDate: completionDay } : {}),
              force: true,
              completeTestRuns: input.completeTestRuns ?? false,
              completeSessions: input.completeSessions ?? false,
            },
            deps.env,
          );
          delete data.completedAt;
          delete data.isStarted;
          delete data.startedAt;
        }

        const raw =
          Object.keys(data).length > 0
            ? await zenstack<RawUpdatedMilestone>(
                "milestones",
                "update",
                {
                  where: { id: input.milestoneId },
                  data,
                  include: UPDATED_MILESTONE_INCLUDE,
                },
                deps.env,
              )
            : await zenstack<RawUpdatedMilestone>(
                "milestones",
                "findUnique",
                {
                  where: { id: input.milestoneId },
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
