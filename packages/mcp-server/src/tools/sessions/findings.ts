import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  IssueInclude,
  IssueWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { mapFinding } from "./shared.js";

export interface SessionsFindingsDeps {
  env: EnvConfig;
}

const FINDINGS_TAKE_CAP = 500;

// Issue-detail include for issueId mode — surfaces linkedSessions and
// linkedSessionResults inline (D7-11 issueId-mode response). Each include
// carries `where: { isDeleted: false }` and a take cap so a single issue
// surfacing in many sessions cannot fan out to an unbounded payload (T-07-06).
const ISSUE_DETAIL_INCLUDE = {
  sessions: {
    where: { isDeleted: false },
    take: FINDINGS_TAKE_CAP,
    select: {
      id: true,
      name: true,
      createdAt: true,
      isCompleted: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  },
  sessionResults: {
    where: { isDeleted: false },
    take: FINDINGS_TAKE_CAP,
    select: {
      id: true,
      sessionId: true,
      createdAt: true,
      status: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  },
  integration: { select: { provider: true } },
} as const satisfies IssueInclude;

interface RawIssueDetail {
  id: number;
  externalKey: string | null;
  title: string | null;
  status: string | null;
  externalStatus: string | null;
  priority: string | null;
  integration: { provider: string } | null;
  sessions: Array<{
    id: number;
    name: string;
    createdAt: string | Date;
    isCompleted: boolean;
    createdBy: { id: string; name: string | null; email: string } | null;
  }>;
  sessionResults: Array<{
    id: number;
    sessionId: number;
    createdAt: string | Date;
    status: { id: number; name: string } | null;
    createdBy: { id: string; name: string | null; email: string } | null;
  }>;
}

export function registerSessionsFindings(
  server: McpServer,
  deps: SessionsFindingsDeps,
): void {
  server.registerTool(
    "testplanit_sessions_findings_list",
    {
      description:
        "List findings — Issue rows linked to a session OR retrieve the cross-cutting view of one issue across sessions/results. Provide EXACTLY ONE of `sessionId` or `issueId` (XOR; per D7-11). " +
        "sessionId mode returns { session: {id,name}, findings: Issue[], truncated }. Findings are issues linked to the session OR to any of the session's results (Issue.sessions OR Issue.sessionResults.session per D7-11). Capped at 500 rows; truncated:true indicates overflow. " +
        "issueId mode returns { issue: {...full Issue with externalSystem}, linkedSessions: [...], linkedSessionResults: [...] } — use this to ask 'where did this issue surface?'. " +
        "Note: issueKey (e.g. JIRA-123) is intentionally NOT supported in Phase 7 because Issue.externalKey is not globally unique; resolve external keys via the upcoming Phase-8 issue tools first. (per SESS-05 / D7-11)",
      inputSchema: {
        sessionId: z.number().int().positive().optional(),
        issueId: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        // XOR validation per D7-11 / RESEARCH discretion. We validate inside
        // the handler (not via zod refine on the raw shape) — same pattern
        // Phase 6 folder reparent disambiguation uses; raw-shape inputSchema
        // doesn't compose cleanly with refine.
        const hasSession = input.sessionId !== undefined;
        const hasIssue = input.issueId !== undefined;
        if (hasSession === hasIssue) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "Provide exactly one of sessionId or issueId.",
              },
            ],
          };
        }

        if (hasSession) {
          // sessionId mode: Issue.findMany with OR over both link paths.
          const sessionId = input.sessionId!;
          const where = {
            isDeleted: false,
            OR: [
              { sessions: { some: { id: sessionId } } },
              { sessionResults: { some: { session: { id: sessionId } } } },
            ],
          } satisfies IssueWhereInput;

          const issuesBody: Record<string, unknown> = {
            where,
            select: {
              id: true,
              externalKey: true,
              title: true,
              status: true,
              externalStatus: true,
              priority: true,
              integration: { select: { provider: true } },
            },
            // BL-04 deterministic ordering — newest first; id breaks ties.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            // T-07-06 cap — take FINDINGS_TAKE_CAP+1 to detect overflow.
            take: FINDINGS_TAKE_CAP + 1,
          };

          const issues =
            (await zenstack<unknown[]>(
              "issue",
              "findMany",
              issuesBody,
              deps.env,
            )) ?? [];
          const truncated = issues.length > FINDINGS_TAKE_CAP;
          const trimmed = issues.slice(0, FINDINGS_TAKE_CAP);
          const findings = trimmed.map((i) => mapFinding(i as never));

          // Resolve session header for the response envelope. If the host's
          // ZenStack @@allow policy denies the row (or it truly doesn't exist),
          // findUnique returns null — surfaced as not-found per T-07-02.
          const session = await zenstack<{ id: number; name: string } | null>(
            "sessions",
            "findUnique",
            {
              where: { id: sessionId },
              select: { id: true, name: true },
            },
            deps.env,
          );
          if (!session) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Session ${sessionId} not found.`,
                },
              ],
            };
          }

          const result = { session, findings, truncated };
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        // issueId mode: single findUnique on Issue with linkedSessions /
        // linkedSessionResults inlined under the documented include.
        const issueId = input.issueId!;
        const raw = await zenstack<RawIssueDetail | null>(
          "issue",
          "findUnique",
          {
            where: { id: issueId },
            include: ISSUE_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Issue ${issueId} not found.`,
              },
            ],
          };
        }

        // Map the issue to the canonical finding shape — externalSystem from
        // integration.provider so issueId-mode and sessionId-mode return the
        // same per-issue shape.
        const issue = mapFinding(raw as never);

        const linkedSessions = (raw.sessions ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          isCompleted: s.isCompleted,
          createdBy: s.createdBy
            ? {
                id: s.createdBy.id,
                name: s.createdBy.name,
                email: s.createdBy.email,
              }
            : null,
        }));
        const linkedSessionResults = (raw.sessionResults ?? []).map((r) => ({
          id: r.id,
          sessionId: r.sessionId,
          createdAt: r.createdAt,
          status: r.status ? { id: r.status.id, name: r.status.name } : null,
          createdBy: r.createdBy
            ? {
                id: r.createdBy.id,
                name: r.createdBy.name,
                email: r.createdBy.email,
              }
            : null,
        }));

        const result = {
          issue,
          linkedSessions,
          linkedSessionResults,
        };
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
