import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks for the chokepoint route-level mode:read enforcement tests
// (Task 4). Must run BEFORE the route module is imported in the second
// describe block. Mocks for `~/lib/api-token-auth` use vi.fn so individual
// tests can configure return values per case.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
  authenticateApiTokenForMethod: vi.fn(),
  extractBearerToken: vi.fn(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  enrichFromApiAuth: vi.fn(),
  // withAuditContext is the HOF wrapper around the inner handler — return
  // the handler unchanged so tests invoke innerHandler logic directly.
  withAuditContext: <T extends (...args: any[]) => any>(handler: T): T =>
    handler,
}));

vi.mock("~/lib/prisma", () => {
  const prismaStub: any = {
    user: {
      findUnique: vi.fn(),
    },
    apiToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    // The auto-API CR-04 mitigation wraps the gate + consumedAt stamp in
    // `prisma.$transaction(...)` with Serializable isolation. The
    // reviewGate service module is mocked above so the inner call resolves
    // without actually hitting the tx; we just need $transaction to invoke
    // the callback with a tx-like proxy that exposes the same
    // reviewRequest.updateMany surface the consumedAt stamp uses. Tests
    // that exercise the gate hit-path configure
    // `reviewRequest.updateMany` directly on this stub.
    reviewRequest: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) =>
      cb({
        reviewRequest: prismaStub.reviewRequest,
      }),
    ),
  };
  return { prisma: prismaStub };
});

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(() => undefined),
}));

vi.mock("~/lib/access-fast-path", () => ({
  tryFastPathCreate: vi.fn(async () => null),
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => undefined),
}));

vi.mock("~/lib/services/reviewGate", () => ({
  assertReviewGatePasses: vi.fn(async () => null),
}));

vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn(),
}));
vi.mock("~/services/milestoneSearch", () => ({
  syncMilestoneToElasticsearch: vi.fn(),
}));
vi.mock("~/services/projectSearch", () => ({
  syncProjectToElasticsearch: vi.fn(),
}));
vi.mock("~/services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: vi.fn(),
}));
vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(),
}));
vi.mock("~/services/sharedStepSearch", () => ({
  syncSharedStepToElasticsearch: vi.fn(),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(),
}));

// Mock ZenStack runtime + server adapter so importing the route does NOT
// pull in the real database/policy layer. The base handler is replaced
// by a vi.fn so tests can assert call-through.
const baseHandlerMock = vi.fn(
  async () => new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 })
);
vi.mock("@zenstackhq/runtime", () => ({
  enhance: vi.fn((p: unknown) => p),
}));
vi.mock("@zenstackhq/server/next", () => ({
  NextRequestHandler: vi.fn(() => baseHandlerMock),
}));

// Since we can't directly import private functions from route.ts,
// we'll test the audit interception logic by replicating the pure functions
// and testing the integration through mocks

// Replicate AUDITED_ENTITIES for testing
const AUDITED_ENTITIES = new Set([
  "repositoryCases",
  "testRuns",
  "sessions",
  "sharedStepGroups",
  "issues",
  "milestones",
  "projects",
  "user",
  "userProjectPermission",
  "groupProjectPermission",
  "ssoProvider",
  "allowedEmailDomain",
  "appConfig",
  "userIntegrationAuth",
  "testRunResult",
  "comment",
  "attachment",
  "apiToken",
]);

// Replicate getAuditAction
function getAuditAction(operation: string): string | null {
  switch (operation) {
    case "create":
      return "CREATE";
    case "createMany":
      return "BULK_CREATE";
    case "update":
      return "UPDATE";
    case "updateMany":
      return "BULK_UPDATE";
    case "delete":
      return "DELETE";
    case "deleteMany":
      return "BULK_DELETE";
    case "upsert":
      return "UPDATE";
    default:
      return null;
  }
}

// Replicate extractEntityName (WR-08 keeps the apiToken fallback in sync)
function extractEntityName(
  entityType: string,
  result: any
): string | undefined {
  if (!result) return undefined;

  const nameFields: Record<string, string | string[]> = {
    repositoryCases: "name",
    testRuns: "name",
    sessions: "title",
    projects: "name",
    milestones: "name",
    sharedStepGroups: "name",
    issues: "title",
    user: "email",
    ssoProvider: "type",
    allowedEmailDomain: "domain",
    appConfig: "key",
    apiToken: "name",
  };

  const field = nameFields[entityType];
  if (!field) return undefined;

  if (Array.isArray(field)) {
    return field
      .map((f) => result[f])
      .filter(Boolean)
      .join(":");
  }

  const value = result[field];
  if (entityType === "apiToken" && (value === null || value === undefined)) {
    return result.tokenPrefix ?? "(unnamed token)";
  }
  return value;
}

// Replicate parseZenStackPath
function parseZenStackPath(
  path: string[]
): { model: string; operation: string } | null {
  if (path.length >= 2) {
    return { model: path[0], operation: path[1] };
  }
  return null;
}

// Entity type map
const entityTypeMap: Record<string, string> = {
  repositoryCases: "RepositoryCases",
  testRuns: "TestRuns",
  sessions: "Sessions",
  sharedStepGroups: "SharedStepGroup",
  issues: "Issue",
  milestones: "Milestones",
  projects: "Projects",
  user: "User",
  userProjectPermission: "UserProjectPermission",
  groupProjectPermission: "GroupProjectPermission",
  ssoProvider: "SsoProvider",
  allowedEmailDomain: "AllowedEmailDomain",
  appConfig: "AppConfig",
  userIntegrationAuth: "UserIntegrationAuth",
  testRunResult: "TestRunResult",
  comment: "Comment",
  attachment: "Attachment",
  apiToken: "ApiToken",
};

describe("ZenStack API Route Audit Interception", () => {
  describe("AUDITED_ENTITIES", () => {
    it("should include all main entity types", () => {
      expect(AUDITED_ENTITIES.has("repositoryCases")).toBe(true);
      expect(AUDITED_ENTITIES.has("testRuns")).toBe(true);
      expect(AUDITED_ENTITIES.has("sessions")).toBe(true);
      expect(AUDITED_ENTITIES.has("projects")).toBe(true);
      expect(AUDITED_ENTITIES.has("user")).toBe(true);
      expect(AUDITED_ENTITIES.has("issues")).toBe(true);
    });

    it("should include permission entities", () => {
      expect(AUDITED_ENTITIES.has("userProjectPermission")).toBe(true);
      expect(AUDITED_ENTITIES.has("groupProjectPermission")).toBe(true);
    });

    it("should include admin/config entities", () => {
      expect(AUDITED_ENTITIES.has("ssoProvider")).toBe(true);
      expect(AUDITED_ENTITIES.has("allowedEmailDomain")).toBe(true);
      expect(AUDITED_ENTITIES.has("appConfig")).toBe(true);
    });

    it("should include apiToken entity", () => {
      expect(AUDITED_ENTITIES.has("apiToken")).toBe(true);
    });

    it("should not include non-audited entities", () => {
      expect(AUDITED_ENTITIES.has("verificationToken")).toBe(false);
      expect(AUDITED_ENTITIES.has("session")).toBe(false);
      expect(AUDITED_ENTITIES.has("account")).toBe(false);
    });
  });

  describe("parseZenStackPath", () => {
    it("should parse a valid path with model and operation", () => {
      expect(parseZenStackPath(["repositoryCases", "create"])).toEqual({
        model: "repositoryCases",
        operation: "create",
      });
    });

    it("should parse findMany operation", () => {
      expect(parseZenStackPath(["projects", "findMany"])).toEqual({
        model: "projects",
        operation: "findMany",
      });
    });

    it("should handle paths with additional segments", () => {
      expect(parseZenStackPath(["user", "update", "extra"])).toEqual({
        model: "user",
        operation: "update",
      });
    });

    it("should return null for paths with only one segment", () => {
      expect(parseZenStackPath(["repositoryCases"])).toBeNull();
    });

    it("should return null for empty paths", () => {
      expect(parseZenStackPath([])).toBeNull();
    });
  });

  describe("getAuditAction", () => {
    it("should map create to CREATE", () => {
      expect(getAuditAction("create")).toBe("CREATE");
    });

    it("should map createMany to BULK_CREATE", () => {
      expect(getAuditAction("createMany")).toBe("BULK_CREATE");
    });

    it("should map update to UPDATE", () => {
      expect(getAuditAction("update")).toBe("UPDATE");
    });

    it("should map updateMany to BULK_UPDATE", () => {
      expect(getAuditAction("updateMany")).toBe("BULK_UPDATE");
    });

    it("should map delete to DELETE", () => {
      expect(getAuditAction("delete")).toBe("DELETE");
    });

    it("should map deleteMany to BULK_DELETE", () => {
      expect(getAuditAction("deleteMany")).toBe("BULK_DELETE");
    });

    it("should map upsert to UPDATE", () => {
      expect(getAuditAction("upsert")).toBe("UPDATE");
    });

    it("should return null for read operations", () => {
      expect(getAuditAction("findMany")).toBeNull();
      expect(getAuditAction("findUnique")).toBeNull();
      expect(getAuditAction("findFirst")).toBeNull();
      expect(getAuditAction("count")).toBeNull();
      expect(getAuditAction("aggregate")).toBeNull();
    });

    it("should return null for unknown operations", () => {
      expect(getAuditAction("unknown")).toBeNull();
    });
  });

  describe("extractEntityName", () => {
    it("should extract name for repositoryCases", () => {
      expect(
        extractEntityName("repositoryCases", { id: 1, name: "Test Case" })
      ).toBe("Test Case");
    });

    it("should extract name for testRuns", () => {
      expect(
        extractEntityName("testRuns", { id: 1, name: "Sprint 1 Run" })
      ).toBe("Sprint 1 Run");
    });

    it("should extract title for sessions", () => {
      expect(
        extractEntityName("sessions", { id: 1, title: "Exploratory Session" })
      ).toBe("Exploratory Session");
    });

    it("should extract title for issues", () => {
      expect(extractEntityName("issues", { id: 1, title: "Bug Report" })).toBe(
        "Bug Report"
      );
    });

    it("should extract name for projects", () => {
      expect(extractEntityName("projects", { id: 1, name: "My Project" })).toBe(
        "My Project"
      );
    });

    it("should extract email for user", () => {
      expect(
        extractEntityName("user", { id: "abc", email: "user@example.com" })
      ).toBe("user@example.com");
    });

    it("should extract type for ssoProvider", () => {
      expect(extractEntityName("ssoProvider", { id: 1, type: "SAML" })).toBe(
        "SAML"
      );
    });

    it("should extract domain for allowedEmailDomain", () => {
      expect(
        extractEntityName("allowedEmailDomain", {
          id: 1,
          domain: "example.com",
        })
      ).toBe("example.com");
    });

    it("should extract key for appConfig", () => {
      expect(extractEntityName("appConfig", { key: "FEATURE_FLAG" })).toBe(
        "FEATURE_FLAG"
      );
    });

    it("should extract name for apiToken", () => {
      expect(
        extractEntityName("apiToken", { id: "token-1", name: "CI Token" })
      ).toBe("CI Token");
    });

    it("WR-08 — falls back to tokenPrefix when apiToken.name is null", () => {
      expect(
        extractEntityName("apiToken", {
          id: "token-2",
          name: null,
          tokenPrefix: "tpi_abc",
        })
      ).toBe("tpi_abc");
    });

    it("WR-08 — falls back to (unnamed token) when apiToken has no name AND no tokenPrefix", () => {
      expect(
        extractEntityName("apiToken", {
          id: "token-3",
          name: null,
        })
      ).toBe("(unnamed token)");
    });

    it("should return undefined for entities without name mapping", () => {
      expect(
        extractEntityName("comment", { id: 1, content: "Test comment" })
      ).toBeUndefined();
      expect(
        extractEntityName("attachment", { id: 1, filename: "test.pdf" })
      ).toBeUndefined();
    });

    it("should return undefined for null result", () => {
      expect(extractEntityName("repositoryCases", null)).toBeUndefined();
    });

    it("should return undefined for undefined result", () => {
      expect(extractEntityName("repositoryCases", undefined)).toBeUndefined();
    });
  });

  describe("entityTypeMap", () => {
    it("should map camelCase model names to PascalCase entity types", () => {
      expect(entityTypeMap["repositoryCases"]).toBe("RepositoryCases");
      expect(entityTypeMap["testRuns"]).toBe("TestRuns");
      expect(entityTypeMap["sessions"]).toBe("Sessions");
      expect(entityTypeMap["sharedStepGroups"]).toBe("SharedStepGroup");
      expect(entityTypeMap["issues"]).toBe("Issue");
    });

    it("should map permission models correctly", () => {
      expect(entityTypeMap["userProjectPermission"]).toBe(
        "UserProjectPermission"
      );
      expect(entityTypeMap["groupProjectPermission"]).toBe(
        "GroupProjectPermission"
      );
    });

    it("should map config models correctly", () => {
      expect(entityTypeMap["ssoProvider"]).toBe("SsoProvider");
      expect(entityTypeMap["allowedEmailDomain"]).toBe("AllowedEmailDomain");
      expect(entityTypeMap["appConfig"]).toBe("AppConfig");
    });
  });

  describe("Audit Event Construction", () => {
    // Helper to simulate how the route constructs audit events
    function constructAuditEvent(
      method: string,
      path: string[],
      responseStatus: number,
      responseData: any
    ) {
      const parsedPath = parseZenStackPath(path);
      const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

      if (
        !isMutation ||
        responseStatus < 200 ||
        responseStatus >= 300 ||
        !parsedPath ||
        !AUDITED_ENTITIES.has(parsedPath.model)
      ) {
        return null;
      }

      const auditAction = getAuditAction(parsedPath.operation);
      if (!auditAction) return null;

      const data = responseData?.data;
      if (!data) return null;

      const entityId =
        data.id || data.key || `${parsedPath.operation}-fallback`;
      const entityName = extractEntityName(parsedPath.model, data);
      const projectId =
        typeof data.projectId === "number" ? data.projectId : undefined;

      // Special handling for API token operations - use specific audit actions
      let finalAuditAction = auditAction;
      if (parsedPath.model === "apiToken") {
        if (parsedPath.operation === "create") {
          finalAuditAction = "API_KEY_CREATED";
        } else if (parsedPath.operation === "delete") {
          finalAuditAction = "API_KEY_DELETED";
        }
        // Note: revocation check requires requestBody which isn't passed to this helper
      }

      return {
        action: finalAuditAction,
        entityType: entityTypeMap[parsedPath.model] || parsedPath.model,
        entityId: String(entityId),
        entityName,
        projectId,
        metadata: {
          operation: parsedPath.operation,
          ...(auditAction.startsWith("BULK_") && data.count
            ? { count: data.count }
            : {}),
        },
      };
    }

    it("should construct a CREATE event for a new test case", () => {
      const event = constructAuditEvent(
        "POST",
        ["repositoryCases", "create"],
        200,
        {
          data: { id: 123, name: "New Test Case", projectId: 1 },
        }
      );

      expect(event).toEqual({
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: "123",
        entityName: "New Test Case",
        projectId: 1,
        metadata: { operation: "create" },
      });
    });

    it("should construct an UPDATE event for a test run", () => {
      const event = constructAuditEvent("PATCH", ["testRuns", "update"], 200, {
        data: { id: 456, name: "Updated Run", projectId: 2 },
      });

      expect(event).toEqual({
        action: "UPDATE",
        entityType: "TestRuns",
        entityId: "456",
        entityName: "Updated Run",
        projectId: 2,
        metadata: { operation: "update" },
      });
    });

    it("should construct a DELETE event for a project", () => {
      const event = constructAuditEvent("DELETE", ["projects", "delete"], 200, {
        data: { id: 789, name: "Deleted Project" },
      });

      expect(event).toEqual({
        action: "DELETE",
        entityType: "Projects",
        entityId: "789",
        entityName: "Deleted Project",
        projectId: undefined,
        metadata: { operation: "delete" },
      });
    });

    it("should construct a BULK_CREATE event with count", () => {
      const event = constructAuditEvent(
        "POST",
        ["repositoryCases", "createMany"],
        200,
        {
          data: { count: 10 },
        }
      );

      expect(event).toEqual({
        action: "BULK_CREATE",
        entityType: "RepositoryCases",
        entityId: "createMany-fallback",
        entityName: undefined,
        projectId: undefined,
        metadata: { operation: "createMany", count: 10 },
      });
    });

    it("should return null for GET requests", () => {
      const event = constructAuditEvent(
        "GET",
        ["repositoryCases", "findMany"],
        200,
        {
          data: [{ id: 1 }],
        }
      );

      expect(event).toBeNull();
    });

    it("should return null for failed mutations", () => {
      const event = constructAuditEvent(
        "POST",
        ["repositoryCases", "create"],
        500,
        {
          error: "Server error",
        }
      );

      expect(event).toBeNull();
    });

    it("should return null for non-audited entities", () => {
      const event = constructAuditEvent(
        "POST",
        ["verificationToken", "create"],
        200,
        {
          data: { id: 1 },
        }
      );

      expect(event).toBeNull();
    });

    it("should return null for read operations even with POST method", () => {
      // ZenStack uses POST for findMany queries
      const event = constructAuditEvent(
        "POST",
        ["repositoryCases", "findMany"],
        200,
        {
          data: [{ id: 1 }],
        }
      );

      expect(event).toBeNull();
    });

    it("should return null when response has no data", () => {
      const event = constructAuditEvent(
        "POST",
        ["repositoryCases", "create"],
        200,
        {}
      );

      expect(event).toBeNull();
    });

    it("should handle user entity with string id", () => {
      const event = constructAuditEvent("PUT", ["user", "update"], 200, {
        data: { id: "user-uuid-123", email: "updated@example.com" },
      });

      expect(event).toEqual({
        action: "UPDATE",
        entityType: "User",
        entityId: "user-uuid-123",
        entityName: "updated@example.com",
        projectId: undefined,
        metadata: { operation: "update" },
      });
    });

    it("should handle appConfig with key as id", () => {
      const event = constructAuditEvent("POST", ["appConfig", "create"], 200, {
        data: { key: "FEATURE_X_ENABLED", value: "true" },
      });

      expect(event).toEqual({
        action: "CREATE",
        entityType: "AppConfig",
        entityId: "FEATURE_X_ENABLED",
        entityName: "FEATURE_X_ENABLED",
        projectId: undefined,
        metadata: { operation: "create" },
      });
    });

    it("should handle permission entities", () => {
      const event = constructAuditEvent(
        "POST",
        ["userProjectPermission", "create"],
        200,
        {
          data: { id: 100, userId: "user-1", projectId: 5, role: "ADMIN" },
        }
      );

      expect(event).toEqual({
        action: "CREATE",
        entityType: "UserProjectPermission",
        entityId: "100",
        entityName: undefined,
        projectId: 5,
        metadata: { operation: "create" },
      });
    });

    it("should handle BULK_DELETE with count", () => {
      const event = constructAuditEvent(
        "DELETE",
        ["repositoryCases", "deleteMany"],
        200,
        {
          data: { count: 5 },
        }
      );

      expect(event).toEqual({
        action: "BULK_DELETE",
        entityType: "RepositoryCases",
        entityId: "deleteMany-fallback",
        entityName: undefined,
        projectId: undefined,
        metadata: { operation: "deleteMany", count: 5 },
      });
    });

    it("should use API_KEY_CREATED for apiToken create operations", () => {
      const event = constructAuditEvent("POST", ["apiToken", "create"], 200, {
        data: { id: "token-123", name: "CI Token", tokenPrefix: "tpi_abc" },
      });

      expect(event).toEqual({
        action: "API_KEY_CREATED",
        entityType: "ApiToken",
        entityId: "token-123",
        entityName: "CI Token",
        projectId: undefined,
        metadata: { operation: "create" },
      });
    });

    it("should use API_KEY_DELETED for apiToken delete operations", () => {
      const event = constructAuditEvent("DELETE", ["apiToken", "delete"], 200, {
        data: { id: "token-123", name: "CI Token", tokenPrefix: "tpi_abc" },
      });

      expect(event).toEqual({
        action: "API_KEY_DELETED",
        entityType: "ApiToken",
        entityId: "token-123",
        entityName: "CI Token",
        projectId: undefined,
        metadata: { operation: "delete" },
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: route-level mode:read enforcement at the ZenStack chokepoint.
// Verifies that innerHandler calls authenticateApiTokenForMethod (NOT the
// bare authenticateApiToken) and that READ_ONLY_TOKEN errors short-circuit
// before any prisma/baseHandler call. Empty-scopes tokens still pass through.
// ─────────────────────────────────────────────────────────────────────────────
describe("ZenStack chokepoint mode:read enforcement", () => {
  function makeRequest(
    method: string,
    authHeader = "Bearer tpi_test_token"
  ): NextRequest {
    const headers = new Headers();
    headers.set("authorization", authHeader);
    return {
      method,
      headers,
      url: "http://localhost:3000/api/model/repositoryCases/create",
      clone() {
        return this;
      },
      async text() {
        return "";
      },
    } as unknown as NextRequest;
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue(null);

    const { extractBearerToken } = await import("~/lib/api-token-auth");
    (extractBearerToken as any).mockReturnValue("tpi_test_token");

    baseHandlerMock.mockClear();
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 })
    );
  });

  async function importRoute() {
    return await import("./route");
  }

  it("blocks POST with READ_ONLY_TOKEN errorCode when token has mode:read", async () => {
    const { authenticateApiTokenForMethod, authenticateApiToken } =
      await import("~/lib/api-token-auth");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: false,
      error: "Token is read-only; write operations are not permitted.",
      errorCode: "READ_ONLY_TOKEN",
    });
    const { prisma } = await import("~/lib/prisma");
    const { POST } = await importRoute();

    const req = makeRequest("POST");
    const res = await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "create"] }),
    });
    const body = await res.json();

    // 403 Forbidden — token is authenticated but lacks write permission. 401
    // would be wrong (semantically "not authenticated") and the E2E spec
    // catches the mismatch.
    expect(res.status).toBe(403);
    expect(body.code).toBe("READ_ONLY_TOKEN");
    // The swap MUST have happened — bare authenticateApiToken not called.
    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(authenticateApiTokenForMethod).toHaveBeenCalledWith(req);
    // No mutation reached the underlying ZenStack handler.
    expect(baseHandlerMock).not.toHaveBeenCalled();
    // No prisma write touched.
    expect((prisma as any).apiToken.update).not.toHaveBeenCalled();
  });

  it("allows POST through to ZenStack handler when token has empty scopes (TOK-06 regression)", async () => {
    const { authenticateApiTokenForMethod, authenticateApiToken } =
      await import("~/lib/api-token-auth");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: true,
      userId: "user-123",
      access: "USER",
      scopes: [],
    });
    const { prisma } = await import("~/lib/prisma");
    (prisma as any).user.findUnique.mockResolvedValue({
      id: "user-123",
      email: "u@e.com",
      name: "U",
    });
    const { POST } = await importRoute();

    const req = makeRequest("POST");
    const res = await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(authenticateApiTokenForMethod).toHaveBeenCalledWith(req);
    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("allows GET through when token has mode:read scope (read allowed)", async () => {
    const { authenticateApiTokenForMethod, authenticateApiToken } =
      await import("~/lib/api-token-auth");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: true,
      userId: "user-123",
      access: "USER",
      scopes: ["mode:read"],
    });
    const { prisma } = await import("~/lib/prisma");
    (prisma as any).user.findUnique.mockResolvedValue({
      id: "user-123",
      email: "u@e.com",
      name: "U",
    });
    const { GET } = await importRoute();

    const req = makeRequest("GET");
    const res = await GET(req, {
      params: Promise.resolve({ path: ["repositoryCases", "findMany"] }),
    });

    expect(res.status).toBe(200);
    expect(authenticateApiTokenForMethod).toHaveBeenCalledWith(req);
    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("verifies the swap: route never calls bare authenticateApiToken", async () => {
    // Independent assertion: across both blocked and allowed flows, the
    // bare authenticateApiToken function must remain uncalled. This is the
    // W-11 verification at the route layer (separate from the file-grep gate
    // documented in the plan acceptance criteria).
    const { authenticateApiTokenForMethod, authenticateApiToken } =
      await import("~/lib/api-token-auth");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: false,
      error: "Invalid API token",
      errorCode: "INVALID_TOKEN",
    });
    const { POST } = await importRoute();

    const req = makeRequest("POST");
    await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "create"] }),
    });

    expect(authenticateApiToken).not.toHaveBeenCalled();
    expect(authenticateApiTokenForMethod).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan 01-04: Review & Approval gate at the auto-API chokepoint.
// Verifies that PATCH/PUT to a gated model with `data.stateId` calls
// `assertReviewGatePasses` before tryFastPathCreate / baseHandler, and that
// ReviewGateError / AlreadyPendingError are translated to structured 403 / 409
// responses with the typed code payload.
// ─────────────────────────────────────────────────────────────────────────────
describe("ZenStack chokepoint Review & Approval gate", () => {
  function makeUpdateRequest(body: unknown): NextRequest {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify(body);
    return {
      method: "PATCH",
      headers,
      url: "http://localhost:3000/api/model/repositoryCases/update",
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "user-1", email: "u@e.com", name: "U" },
    });
    const { extractBearerToken } = await import("~/lib/api-token-auth");
    (extractBearerToken as any).mockReturnValue(null);
    const { prisma } = await import("~/lib/prisma");
    (prisma as any).user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: "U",
    });
    baseHandlerMock.mockClear();
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 7 } }), { status: 200 })
    );
  });

  it("translates ReviewGateError to a 403 with REVIEW_REQUIRED payload and skips baseHandler", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");
    const { ReviewGateError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new ReviewGateError("REVIEW_REQUIRED", "CASE", 42, 99)
    );

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toEqual({
      code: "REVIEW_REQUIRED",
      entityType: "CASE",
      entityId: 42,
      toStateId: 99,
    });
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("translates AlreadyPendingError to a 409 with PENDING_REVIEW_EXISTS payload", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");
    const { AlreadyPendingError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new AlreadyPendingError("CASE", 42, "pending-req-1")
    );

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toEqual({ code: "PENDING_REVIEW_EXISTS" });
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("passes through to baseHandler when the gate returns null (ungated path)", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");
    (assertReviewGatePasses as any).mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(assertReviewGatePasses).toHaveBeenCalledWith(
      expect.anything(),
      "CASE",
      42,
      99
    );
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("does NOT call the gate when the update does not include stateId", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { name: "renamed only" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(assertReviewGatePasses).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("does NOT call the gate for non-gated models even when stateId is in the patch", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");

    const { PATCH } = await import("./route");
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify({
      where: { id: 1 },
      data: { stateId: 9 },
    });
    const req = {
      method: "PATCH",
      headers,
      url: "http://localhost:3000/api/model/milestones/update",
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
    await PATCH(req, {
      params: Promise.resolve({ path: ["milestones", "update"] }),
    });

    expect(assertReviewGatePasses).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("translates the gate for testRuns (RUN entity type)", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");
    const { ReviewGateError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new ReviewGateError("REVIEW_REQUIRED", "RUN", 5, 88)
    );

    const { PATCH } = await import("./route");
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify({
      where: { id: 5 },
      data: { stateId: 88 },
    });
    const req = {
      method: "PATCH",
      headers,
      url: "http://localhost:3000/api/model/testRuns/update",
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.entityType).toBe("RUN");
    expect(assertReviewGatePasses).toHaveBeenCalledWith(
      expect.anything(),
      "RUN",
      5,
      88
    );
  });

  it("translates the gate for sessions (SESSION entity type)", async () => {
    const { assertReviewGatePasses } = await import("~/lib/services/reviewGate");
    const { ReviewGateError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new ReviewGateError("REVIEW_REQUIRED", "SESSION", 3, 77)
    );

    const { PATCH } = await import("./route");
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify({
      where: { id: 3 },
      data: { stateId: 77 },
    });
    const req = {
      method: "PATCH",
      headers,
      url: "http://localhost:3000/api/model/sessions/update",
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["sessions", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.entityType).toBe("SESSION");
  });

  // ───────────────────────────────────────────────────────────────────────
  // CR-03 regression: the gate now covers `upsert` and `updateMany` payloads
  // that carry a `stateId`. Previously only `update` was gated, so callers
  // could route a state flip through upsert (data lands under
  // body.update.stateId) or updateMany and bypass the friendly-error path.
  // ───────────────────────────────────────────────────────────────────────

  function makePathRequest(
    method: string,
    body: unknown,
    pathSegments: string[]
  ): NextRequest {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify(body);
    return {
      method,
      headers,
      url: `http://localhost:3000/api/model/${pathSegments.join("/")}`,
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
  }

  it("CR-03 — gates upsert payloads whose update branch carries stateId", async () => {
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );
    const { ReviewGateError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new ReviewGateError("REVIEW_REQUIRED", "CASE", 42, 99)
    );

    const { POST } = await import("./route");
    const req = makePathRequest(
      "POST",
      {
        where: { id: 42 },
        create: { name: "fresh", stateId: 1 },
        update: { stateId: 99 },
      },
      ["repositoryCases", "upsert"]
    );
    const res = await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "upsert"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toEqual({
      code: "REVIEW_REQUIRED",
      entityType: "CASE",
      entityId: 42,
      toStateId: 99,
    });
    expect(assertReviewGatePasses).toHaveBeenCalledWith(
      expect.anything(),
      "CASE",
      42,
      99
    );
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("CR-03 — gates updateMany payloads with a scalar where.id and a stateId", async () => {
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );
    const { ReviewGateError } = await import("~/lib/utils/errors");
    (assertReviewGatePasses as any).mockRejectedValue(
      new ReviewGateError("REVIEW_REQUIRED", "RUN", 5, 88)
    );

    const { POST } = await import("./route");
    const req = makePathRequest(
      "POST",
      {
        where: { id: 5 },
        data: { stateId: 88 },
      },
      ["testRuns", "updateMany"]
    );
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "updateMany"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.entityType).toBe("RUN");
    expect(assertReviewGatePasses).toHaveBeenCalledWith(
      expect.anything(),
      "RUN",
      5,
      88
    );
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("CR-03 — does NOT block updateMany when where.id is a Prisma filter (e.g. { in: [...] })", async () => {
    // Multi-row updateMany cannot be expressed in the gate's polymorphic
    // (entityType, entityId) shape. The gate falls through to the schema
    // @@deny backstop in that case; the route does not invoke the friendly
    // gate at all. The gate would still be hit on a per-row basis when the
    // caller targets a single id; this just covers the bulk path.
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );

    const { POST } = await import("./route");
    const req = makePathRequest(
      "POST",
      {
        where: { id: { in: [1, 2, 3] } },
        data: { stateId: 99 },
      },
      ["testRuns", "updateMany"]
    );
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "updateMany"] }),
    });

    expect(res.status).toBe(200);
    expect(assertReviewGatePasses).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("CR-03 — does NOT block upsert when only the create branch carries stateId (no transition)", async () => {
    // upsert.create.stateId is fresh-row creation, gated at row-creation
    // time by FK + workflow rules — not by the review gate which targets
    // transitions of existing entities.
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );

    const { POST } = await import("./route");
    const req = makePathRequest(
      "POST",
      {
        where: { id: 99 },
        create: { name: "new", stateId: 7 },
        update: { name: "renamed" },
      },
      ["repositoryCases", "upsert"]
    );
    const res = await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "upsert"] }),
    });

    expect(res.status).toBe(200);
    expect(assertReviewGatePasses).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("CR-03 — gracefully ignores non-finite stateId values (no NaN slip into the gate)", async () => {
    // Today stateId is a numeric primary key, but the new defensive coercion
    // explicitly NaN's anything non-numeric so a hypothetical future payload
    // shape (e.g. clearing the field to null) does not silently invoke the
    // gate with NaN.
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );

    const { POST } = await import("./route");
    const req = makePathRequest(
      "POST",
      {
        where: { id: 7 },
        data: { stateId: null },
      },
      ["repositoryCases", "update"]
    );
    const res = await POST(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(assertReviewGatePasses).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // CR-04 regression: the auto-API gate must atomically stamp `consumedAt`
  // BEFORE handing off to ZenStack, so concurrent callers race on the
  // `updateMany({ where: { id, consumedAt: null } })` instead of slipping
  // between the (previously) read-only gate commit and the entity-update
  // transaction. A lose-the-race outcome must surface as a typed 403.
  // ───────────────────────────────────────────────────────────────────────

  it("CR-04 — stamps consumedAt on the approved request when the gate hits", async () => {
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );
    (assertReviewGatePasses as any).mockResolvedValue({
      approvedRequestId: "approval-1",
    });

    const { prisma } = await import("~/lib/prisma");
    (prisma as any).reviewRequest.updateMany.mockResolvedValue({ count: 1 });

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect((prisma as any).reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "approval-1", consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("CR-04 — returns 403 REVIEW_REQUIRED when consumedAt stamp loses the race", async () => {
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );
    (assertReviewGatePasses as any).mockResolvedValue({
      approvedRequestId: "approval-2",
    });

    const { prisma } = await import("~/lib/prisma");
    // Another caller consumed this approval first — our stamp comes back
    // with count: 0 and we must surface as REVIEW_REQUIRED instead of
    // handing off to ZenStack.
    (prisma as any).reviewRequest.updateMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toEqual({
      code: "REVIEW_REQUIRED",
      entityType: "CASE",
      entityId: 42,
      toStateId: 99,
    });
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("CR-04 — does NOT stamp consumedAt when the gate short-circuits (no approval needed)", async () => {
    // When the target state does not require review (or the feature flag
    // is off), the gate returns null and there is no approval to consume.
    const { assertReviewGatePasses } = await import(
      "~/lib/services/reviewGate"
    );
    (assertReviewGatePasses as any).mockResolvedValue(null);

    const { prisma } = await import("~/lib/prisma");

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect((prisma as any).reviewRequest.updateMany).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });
});
