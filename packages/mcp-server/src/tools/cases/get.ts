import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryCasesInclude,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { buildFolderBreadcrumb, mapCaseDetail } from "./shared.js";

export const CASE_DETAIL_INCLUDE = {
  // Phase-8 D8-02: surface inline codeRepository on cases_get by chaining
  // through the project's optional ProjectCodeRepositoryConfig back-relation
  // (schema.zmodel:394). The `repository` join is select-only; the secrets
  // column (credentials) is INTENTIONALLY ABSENT so it never crosses the
  // wire (defense in depth — T-08-PITFALL-7 / T-08-CRED-LEAK).
  project: {
    select: {
      id: true,
      name: true,
      codeRepositoryConfig: {
        select: {
          repository: {
            select: {
              id: true,
              name: true,
              provider: true,
              status: true,
              lastTestedAt: true,
              settings: true,
              // credentials INTENTIONALLY ABSENT — defense in depth, never expose secrets in MCP responses
            },
          },
        },
      },
    },
  },
  folder: { select: { id: true, name: true, parentId: true } },
  state: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  // RepositoryCases tags / issues now live on the explicit
  // RepositoryCaseTag / RepositoryCaseIssue join models — select through
  // caseTags.tag and caseIssues.issue (the implicit `tags` / `issues`
  // relations no longer exist and would 422).
  caseTags: { select: { tag: { select: { id: true, name: true } } } },
  caseIssues: {
    select: {
      issue: {
        select: {
          id: true,
          externalKey: true,
          integration: { select: { provider: true } },
          title: true,
          externalStatus: true,
        },
      },
    },
  },
  steps: {
    where: { isDeleted: false },
    orderBy: { order: "asc" },
    select: {
      id: true,
      step: true,
      expectedResult: true,
      order: true,
    },
  },
  caseFieldValues: {
    include: {
      field: {
        select: {
          displayName: true,
          type: { select: { type: true } },
          fieldOptions: {
            select: {
              fieldOption: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  linksFrom: {
    where: { isDeleted: false },
    include: {
      caseB: { select: { id: true, name: true, source: true } },
    },
  },
  linksTo: {
    where: { isDeleted: false },
    include: {
      caseA: { select: { id: true, name: true, source: true } },
    },
  },
  // Same latest-version / latest-result sub-includes as CASE_ROW_INCLUDE so
  // detail responses (get/create/update) carry truthful lastUpdatedAt,
  // latestResult, hasAutomatedResults, and lastAutomatedResultAt instead of
  // the always-null placeholders the mapper emits when these are absent.
  repositoryCaseVersions: {
    orderBy: [{ version: "desc" }, { id: "desc" }],
    take: 1,
    select: { createdAt: true, version: true },
  },
  // nulls:"last" — executedAt is nullable and plain desc puts NULLs first
  // in Postgres, which would let a timestampless row shadow the latest
  // real result (see CASE_ROW_INCLUDE).
  junitResults: {
    orderBy: [{ executedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      executedAt: true,
      status: { select: { id: true, name: true } },
    },
  },
  testRuns: {
    orderBy: [{ id: "desc" }],
    take: 1,
    select: {
      results: {
        where: { isDeleted: false },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          executedAt: true,
          status: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const satisfies RepositoryCasesInclude;

export interface CasesGetDeps {
  env: EnvConfig;
}

export function registerCasesGet(server: McpServer, deps: CasesGetDeps): void {
  server.registerTool(
    "testplanit_cases_get",
    {
      description:
        "Fetch a single test case by id with full denormalized details — steps (plain text), custom fields (flat dict), folder breadcrumb, tags, linked issues, linked automated tests. (per D-05 / CASE-02)",
      inputSchema: {
        caseId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<{
          folder: { id: number; name: string; parentId: number | null };
          [k: string]: unknown;
        }>(
          "repositoryCases",
          "findUnique",
          {
            where: { id: input.caseId },
            include: CASE_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test case ${input.caseId} not found.`,
              },
            ],
          };
        }

        const breadcrumb = await buildFolderBreadcrumb(
          {
            id: raw.folder.id,
            name: raw.folder.name,
            parentId: raw.folder.parentId,
          },
          deps.env,
        );

        const detail = mapCaseDetail(raw as never, breadcrumb);
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
