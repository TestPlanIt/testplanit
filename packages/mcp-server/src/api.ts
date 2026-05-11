import type { Prisma } from "@prisma/client";
import { TestPlanItHttpError } from "./http.js";
import type { EnvConfig } from "./env.js";

/**
 * ZenStack RPC envelope returned by `/api/model/{model}/{operation}`.
 * On success: `{ data: T }`. On error: `{ error: { message, code? } }`.
 * Some failure modes return `error` as a string — handled explicitly below.
 */
interface ZenStackResponse<T> {
  data?: T;
  error?: { message: string; code?: string } | string;
}

const READ_OPS = new Set([
  "findMany",
  "findFirst",
  "findUnique",
  "count",
  "aggregate",
  "groupBy",
]);
const POST_OPS = new Set(["create", "createMany", "upsert"]);
const PATCH_OPS = new Set(["update", "updateMany"]);
const DELETE_OPS = new Set(["delete", "deleteMany"]);

const TIMEOUT_MS = 10000;

function bearerHeaders(env: EnvConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${env.apiToken}`,
    "Content-Type": "application/json",
  };
}

/**
 * Internal ZenStack RPC client.
 *
 * Replicates the dispatch pattern from `packages/api/src/client.ts` so
 * `@testplanit/mcp-server` has NO dependency on `@testplanit/api` (D-01).
 *
 * Read operations use GET with `?q=encodeURIComponent(JSON.stringify(body))`.
 * Write operations use POST/PATCH/DELETE with the JSON body.
 *
 * Errors:
 *  - Non-2xx → throws TestPlanItHttpError with statusCode + (when present) code
 *    parsed from the response body. Critical: HTTP 422 may be a route.ts
 *    remap of a ZenStack 403 (policy denial) or 404 (P2025 missing record).
 *    The error mapper in errors.ts disambiguates by message content.
 *  - 2xx with `error` envelope → throws TestPlanItHttpError with envelope code.
 *  - 2xx with `data` → returns `data` unwrapped.
 *
 * Soft-delete invariant: callers MUST use `update` with `{ data: { isDeleted: true } }`
 * for soft-delete, NEVER the `delete` or `deleteMany` operations (T-06-06).
 */
export async function zenstack<T>(
  model: string,
  operation: string,
  body: unknown,
  env: EnvConfig,
): Promise<T> {
  const baseUrl = env.apiUrl;
  let response: Response;

  if (READ_OPS.has(operation)) {
    const q = body !== undefined && body !== null
      ? `?q=${encodeURIComponent(JSON.stringify(body))}`
      : "";
    response = await fetch(`${baseUrl}/api/model/${model}/${operation}${q}`, {
      method: "GET",
      headers: bearerHeaders(env),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } else {
    const method = POST_OPS.has(operation)
      ? "POST"
      : PATCH_OPS.has(operation)
        ? "PATCH"
        : DELETE_OPS.has(operation)
          ? "DELETE"
          : "POST"; // default for any unrecognized op
    response = await fetch(`${baseUrl}/api/model/${model}/${operation}`, {
      method,
      headers: bearerHeaders(env),
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  const text = await response.text();

  if (!response.ok) {
    let code: string | undefined;
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // Body shapes seen in the wild:
      //   { error: "msg", code: "X" }
      //   { error: { message: "msg", code: "X" } }
      if (parsed && typeof parsed["code"] === "string") {
        code = parsed["code"] as string;
      }
      const errField = parsed?.["error"];
      if (errField && typeof errField === "object") {
        const errObj = errField as Record<string, unknown>;
        if (typeof errObj["code"] === "string") code = errObj["code"] as string;
        if (typeof errObj["message"] === "string") parsedMessage = errObj["message"] as string;
      }
      if (typeof errField === "string") {
        parsedMessage = errField;
      }
    } catch {
      // body is not JSON; code stays undefined
    }
    // NEVER include the bearer token in error messages (T-06-05 / T-05-06b).
    // We refer to the path + status only — no env.apiToken interpolation.
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from /api/model/${model}/${operation}${parsedMessage ? `: ${parsedMessage}` : ""}`,
      { statusCode: response.status, code },
    );
  }

  let parsed: ZenStackResponse<T>;
  try {
    parsed = JSON.parse(text) as ZenStackResponse<T>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TestPlanItHttpError(
      `Failed to parse ZenStack response from /api/model/${model}/${operation}: ${msg}`,
      { statusCode: response.status },
    );
  }

  if (parsed?.error) {
    const errMessage =
      typeof parsed.error === "string"
        ? parsed.error
        : parsed.error.message;
    const errCode =
      typeof parsed.error === "object" && parsed.error !== null
        ? parsed.error.code
        : undefined;
    throw new TestPlanItHttpError(errMessage, { code: errCode });
  }
  return parsed.data as T;
}

/**
 * Name → ID lookup via `/api/cli/lookup` (D-02).
 *
 * NOT all entity types are supported — see VERIFIED type union below. Notably,
 * `CaseField` is NOT a lookup type; resolve custom fields via
 * `zenstack("caseFields", "findMany", { where: { displayName: ..., isDeleted: false } })`.
 *
 * The `state` lookup type hardcodes `WorkflowScope.RUNS` on the host
 * (`/api/cli/lookup/route.ts` line 106). For case workflow state, use
 * `resolveCaseWorkflowState` instead.
 */
export type LookupType =
  | "project"
  | "state"
  | "config"
  | "milestone"
  | "tag"
  | "folder"
  | "testRun";

export interface LookupRequest {
  type: LookupType;
  name: string;
  projectId?: number;
  createIfMissing?: boolean;
}

export interface LookupResponse {
  id: number;
  name: string;
  created?: boolean;
}

export async function lookup(
  options: LookupRequest,
  env: EnvConfig,
): Promise<LookupResponse> {
  const response = await fetch(`${env.apiUrl}/api/cli/lookup`, {
    method: "POST",
    headers: bearerHeaders(env),
    body: JSON.stringify(options),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    // WR-08: mirror the zenstack() error parser so a host-side
    // validation message ("tag name length exceeds limit") reaches the
    // agent instead of a generic `HTTP 400 from /api/cli/lookup`.
    let code: string | undefined;
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed?.["code"] === "string") code = parsed["code"] as string;
      const errField = parsed?.["error"];
      if (errField && typeof errField === "object") {
        const errObj = errField as Record<string, unknown>;
        if (typeof errObj["code"] === "string") code = errObj["code"] as string;
        if (typeof errObj["message"] === "string") parsedMessage = errObj["message"] as string;
      } else if (typeof errField === "string") {
        parsedMessage = errField;
      }
    } catch {
      // body is not JSON; leave parsedMessage / code undefined
    }
    // T-06-05 / T-05-06b: NEVER include the bearer token in error
    // messages — we only echo the parsed envelope `message`, never the
    // raw body or env.apiToken.
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from /api/cli/lookup${parsedMessage ? `: ${parsedMessage}` : ""}`,
      { statusCode: response.status, code },
    );
  }
  return JSON.parse(text) as LookupResponse;
}

/**
 * Resolve the single active repository for a project. Cases and folders
 * require `repositoryId` on create; the active repository is selected by
 * the first row matching `isActive=true, isDeleted=false, isArchived=false`.
 *
 * Throws TestPlanItHttpError with statusCode 422 (host-class "operation
 * refused / missing context") when no active repository exists, with a
 * human-readable message instructing the user to initialize the repo via
 * the TestPlanIt UI. The 422 status routes the error through the same
 * `mapHttpErrorToToolResult` branch as host-side missing-record errors.
 */
export async function resolveActiveRepository(
  projectId: number,
  env: EnvConfig,
): Promise<number> {
  const repos = await zenstack<{ id: number }[]>(
    "repositories",
    "findMany",
    {
      where: {
        projectId,
        isActive: true,
        isDeleted: false,
        isArchived: false,
      } satisfies Prisma.RepositoriesWhereInput,
      select: { id: true } satisfies Prisma.RepositoriesSelect,
      take: 1,
    },
    env,
  );
  if (!repos || repos.length === 0) {
    throw new TestPlanItHttpError(
      `No active repository found for project ${projectId}. Open TestPlanIt and add a test case to initialize the repository.`,
      { statusCode: 422 },
    );
  }
  return repos[0].id;
}

/**
 * Resolve a default template assigned to the project (cases require
 * `templateId` per RepositoryCases.templateId being non-nullable —
 * VERIFIED in schema.zmodel).
 */
export async function resolveDefaultTemplate(
  projectId: number,
  env: EnvConfig,
): Promise<number> {
  const templates = await zenstack<{ id: number }[]>(
    "templates",
    "findMany",
    {
      where: {
        isDeleted: false,
        isEnabled: true,
        projects: { some: { projectId } },
      } satisfies Prisma.TemplatesWhereInput,
      select: { id: true } satisfies Prisma.TemplatesSelect,
      // Deterministic selection: lowest-id enabled template wins so two
      // back-to-back create calls always pick the same template (BL-04).
      orderBy: { id: "asc" } satisfies Prisma.TemplatesOrderByWithRelationInput,
      take: 1,
    },
    env,
  );
  if (!templates || templates.length === 0) {
    throw new TestPlanItHttpError(
      `No enabled template assigned to project ${projectId}. Assign a template to the project from the TestPlanIt admin UI.`,
      { statusCode: 422 },
    );
  }
  return templates[0].id;
}

/**
 * Resolve a workflow state for the CASES scope (NOT runs). Pass `name` to
 * select by name; omit to take the first by `order asc`.
 *
 * Cannot use `/api/cli/lookup` — that endpoint hardcodes
 * `WorkflowScope.RUNS` (see /api/cli/lookup/route.ts line 106).
 */
export async function resolveCaseWorkflowState(
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
        scope: "CASES",
        projects: { some: { projectId } },
        ...(name ? { name } : {}),
      } satisfies Prisma.WorkflowsWhereInput,
      orderBy: { order: "asc" },
      take: 1,
    },
    env,
  );
  if (!workflows || workflows.length === 0) {
    const suffix = name ? ` named "${name}"` : "";
    throw new TestPlanItHttpError(
      `No CASES-scope workflow state found for project ${projectId}${suffix}.`,
      { statusCode: 422 },
    );
  }
  return workflows[0];
}
