import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { buildFolderBreadcrumb, mapCaseDetail } from "./shared.js";

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
            include: {
              project: { select: { id: true, name: true } },
              folder: { select: { id: true, name: true, parentId: true } },
              state: { select: { id: true, name: true } },
              creator: { select: { id: true, name: true, email: true } },
              tags: { select: { id: true, name: true } },
              issues: {
                select: {
                  id: true,
                  externalKey: true,
                  externalSystem: true,
                  title: true,
                  externalStatus: true,
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
                include: { field: { select: { displayName: true } } },
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
            },
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
