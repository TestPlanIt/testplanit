import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";

export interface CasesCreateManyDeps {
  env: EnvConfig;
}

const FETCH_TIMEOUT_MS = 30000;

function bearerHeaders(env: EnvConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${env.apiToken}`,
    "Content-Type": "application/json",
  };
}

/** Per-case outcome echoed back from the bulk-create route. */
interface BulkCaseResult {
  id: string;
  name: string;
  status: "success" | "error";
  caseId?: number;
  error?: string;
}

interface BulkCreateResponse {
  success: boolean;
  importedCount: number;
  failedCount: number;
  results: BulkCaseResult[];
}

/**
 * POST the batch to the dedicated bulk-create route, which resolves shared
 * context once and hands each (folder, state) group to the transactional
 * importer. Mirrors the error parsing in api.ts/zenstack so a host-side
 * READ_ONLY_TOKEN (403) or validation message reaches the agent — and so the
 * `code` is preserved for the friendly mode:read mapping in errors.ts.
 */
async function postBulkCreate(
  projectId: number,
  body: unknown,
  env: EnvConfig,
): Promise<BulkCreateResponse> {
  const path = `/api/projects/${projectId}/cases/bulk-create`;
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: "POST",
    headers: bearerHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    let code: string | undefined;
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed?.["code"] === "string") code = parsed["code"] as string;
      const errField = parsed?.["error"];
      if (typeof errField === "string") {
        parsedMessage = errField;
      } else if (errField && typeof errField === "object") {
        const errObj = errField as Record<string, unknown>;
        if (typeof errObj["code"] === "string") code = errObj["code"] as string;
        if (typeof errObj["message"] === "string")
          parsedMessage = errObj["message"] as string;
      }
    } catch {
      // non-JSON body
    }
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from ${path}${parsedMessage ? `: ${parsedMessage}` : ""}`,
      { statusCode: response.status, code },
    );
  }
  return JSON.parse(text) as BulkCreateResponse;
}

export function registerCasesCreateMany(
  server: McpServer,
  deps: CasesCreateManyDeps,
): void {
  server.registerTool(
    "testplanit_cases_create_many",
    {
      description:
        "Create many test cases in one operation, far faster than calling testplanit_cases_create per case. Each case supports the same fields as a single create (name, steps, tags, customFields) plus optional per-case folderId / stateName overriding the batch defaults. Cases are grouped by their effective (folder, state) and each group is persisted in one transaction. Returns a per-case results array so partial failures are visible (each entry has status 'success' with caseId, or 'error' with a message). customFields must belong to the chosen template — out-of-template fields are reported as a per-case error, not silently dropped.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project to create the cases in."),
        folderId: z
          .number()
          .int()
          .positive()
          .describe("Default folder for the batch. Each case may override it."),
        templateId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Template for the whole batch. Defaults to the project's first enabled template.",
          ),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Default CASES workflow state name for the batch. Defaults to the first state by order. Each case may override it.",
          ),
        cases: z
          .array(
            z.object({
              name: z.string().min(1).max(2000).describe("Test case name."),
              folderId: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Override the batch folder for this case."),
              stateName: z
                .string()
                .min(1)
                .optional()
                .describe("Override the batch workflow state for this case."),
              steps: z
                .array(
                  z.object({
                    text: z.string().optional().describe("Step description."),
                    expectedResult: z
                      .string()
                      .optional()
                      .describe("Expected result."),
                    order: z
                      .number()
                      .int()
                      .nonnegative()
                      .optional()
                      .describe("Step order (0-based). Inferred if omitted."),
                  }),
                )
                .optional()
                .describe("Ordered test steps."),
              tags: z
                .array(z.union([z.number().int().positive(), z.string().min(1)]))
                .optional()
                .describe(
                  "Tag IDs (numbers) or tag names (strings, created if missing).",
                ),
              customFields: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  "Custom field values keyed by display name, e.g. { 'Priority': 'High' }. Must be fields on the chosen template.",
                ),
            }),
          )
          .min(1)
          .max(200)
          .describe("The cases to create (1–200)."),
      },
    },
    async (input) => {
      try {
        const out = await postBulkCreate(
          input.projectId,
          {
            ...(input.templateId != null ? { templateId: input.templateId } : {}),
            folderId: input.folderId,
            ...(input.stateName != null ? { stateName: input.stateName } : {}),
            cases: input.cases,
          },
          deps.env,
        );
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
