import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDITED_CONFIG_MODELS,
  AUDITED_RPC_ENTITY_ACCESSORS,
  ENTITY_NAME_FIELDS,
  RPC_ENTITY_TYPE_MAP,
} from "~/lib/services/auditLog";

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

vi.mock("~/lib/db", () => {
  const dbStub: any = {
    user: {
      findUnique: vi.fn(),
    },
    apiToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    // The auto-API CR-04 mitigation wraps the gate + consumedAt stamp in
    // `baseDb.$transaction(...)` with Serializable isolation. The
    // reviewGate service module is mocked above so the inner call resolves
    // without actually hitting the tx; we just need $transaction to invoke
    // the callback with a tx-like proxy that exposes the same
    // reviewRequest.updateMany surface the consumedAt stamp uses. Tests
    // that exercise the gate hit-path configure
    // `reviewRequest.updateMany` directly on this stub.
    reviewRequest: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    // auditedTransaction sets the app.audit_context GUC as the first
    // statement inside the transaction via tx.$executeRaw, so the tx proxy
    // handed to the callback must expose the raw helpers alongside the
    // reviewRequest.updateMany surface the consumedAt stamp uses.
    $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) =>
      cb({
        $executeRaw: vi.fn(async () => []),
        $queryRaw: vi.fn(async () => []),
        reviewRequest: dbStub.reviewRequest,
      })
    ),
  };
  return { baseDb: dbStub };
});

vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(() => undefined),
}));

vi.mock("~/lib/access-fast-path", () => ({
  tryFastPathCreate: vi.fn(async () => null),
}));

vi.mock("~/lib/services/auditLog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/auditLog")>();
  // Keep the real AUDITED_CONFIG_MODELS / ENTITY_NAME_FIELDS / calculateDiff
  // (consumed at module load to build the route's audit maps); only the
  // queue-backed emitter is stubbed.
  return {
    ...actual,
    captureAuditEvent: vi.fn(async () => undefined),
  };
});

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

// Replicate AUDITED_ENTITIES exactly as route.ts builds it: spread the shared
// source-of-truth lists so the test cannot drift from the route (and so the
// singular/plural accessor typo class — `issues`/`sharedStepGroups` — can never
// silently reappear here).
const AUDITED_ENTITIES = new Set([
  ...AUDITED_RPC_ENTITY_ACCESSORS,
  // Admin-config catalog + access models — audited canonically on the RPC path.
  ...AUDITED_CONFIG_MODELS.map((c) => c.accessor),
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
    sessions: "name",
    projects: "name",
    milestones: "name",
    sharedStepGroup: "name",
    issue: "title",
    user: "email",
    ssoProvider: "name",
    allowedEmailDomain: "domain",
    appConfig: "key",
    apiToken: "name",
    ...Object.fromEntries(
      AUDITED_CONFIG_MODELS.flatMap((c) => {
        const f = ENTITY_NAME_FIELDS[c.entityType];
        return f ? [[c.accessor, f] as const] : [];
      })
    ),
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

// Entity type map — built from the shared source (mirrors route.ts) so the
// accessor -> PascalCase entity-type mapping cannot drift from auditLog.ts.
const entityTypeMap: Record<string, string> = {
  ...RPC_ENTITY_TYPE_MAP,
  ...Object.fromEntries(
    AUDITED_CONFIG_MODELS.map((c) => [c.accessor, c.entityType])
  ),
};

describe("ZenStack API Route Audit Interception", () => {
  describe("AUDITED_ENTITIES", () => {
    it("should include the access/config entities the RPC shim still audits", () => {
      // Project/app entities (repositoryCases, testRuns, sessions, projects,
      // issue, sharedStepGroup, …) are now recorded solely by the trigger-based
      // CDC substrate, so the RPC app-layer shim no longer audits them — only
      // the access-control + admin-config accessors remain on this path.
      expect(AUDITED_ENTITIES.has("user")).toBe(true);
      expect(AUDITED_ENTITIES.has("userProjectPermission")).toBe(true);
      expect(AUDITED_ENTITIES.has("groupProjectPermission")).toBe(true);
      // The decommissioned project/app accessors must NOT be in the shim set.
      expect(AUDITED_ENTITIES.has("repositoryCases")).toBe(false);
      expect(AUDITED_ENTITIES.has("testRuns")).toBe(false);
      expect(AUDITED_ENTITIES.has("sessions")).toBe(false);
      expect(AUDITED_ENTITIES.has("projects")).toBe(false);
      expect(AUDITED_ENTITIES.has("issue")).toBe(false);
      expect(AUDITED_ENTITIES.has("sharedStepGroup")).toBe(false);
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

    it("no longer audits test run results on the RPC shim path (CDC owns them)", () => {
      // Test run results are captured by the CDC trigger now; the RPC shim set
      // carries neither the plural nor the singular accessor.
      expect(AUDITED_ENTITIES.has("testRunResults")).toBe(false);
      expect(AUDITED_ENTITIES.has("testRunResult")).toBe(false);
    });

    it("should not include non-audited entities", () => {
      expect(AUDITED_ENTITIES.has("verificationToken")).toBe(false);
      expect(AUDITED_ENTITIES.has("session")).toBe(false);
      expect(AUDITED_ENTITIES.has("account")).toBe(false);
    });

    it("no longer audits admin-config catalog models on the RPC shim path (CDC owns them)", () => {
      // The app-layer config audit was decommissioned: AUDITED_CONFIG_MODELS is
      // intentionally empty so the CDC trigger is the sole source and the shim
      // never double-audits. The former catalog/join accessors are absent here.
      expect(AUDITED_CONFIG_MODELS).toHaveLength(0);
      for (const accessor of [
        "workflows",
        "status",
        "configurations",
        "roles",
        "tags",
        "caseFields",
        "samlConfiguration",
        "rolePermission",
        "groupAssignment",
        "projectStatusAssignment",
      ]) {
        expect(AUDITED_ENTITIES.has(accessor)).toBe(false);
      }
      // Exhaustive: every config model that DOES remain (none today) must still
      // be in the set — keeps the assertion correct if the list is repopulated.
      for (const cfg of AUDITED_CONFIG_MODELS) {
        expect(AUDITED_ENTITIES.has(cfg.accessor)).toBe(true);
      }
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

    it("should extract name for sessions", () => {
      // The Sessions display column is `name` (there is no `title` column); a
      // prior `title` mapping silently produced null entityName for sessions.
      expect(
        extractEntityName("sessions", { id: 1, name: "Exploratory Session" })
      ).toBe("Exploratory Session");
    });

    it("should extract title for issue", () => {
      expect(extractEntityName("issue", { id: 1, title: "Bug Report" })).toBe(
        "Bug Report"
      );
    });

    it("should extract name for sharedStepGroup", () => {
      expect(
        extractEntityName("sharedStepGroup", { id: 1, name: "Login Steps" })
      ).toBe("Login Steps");
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

    it("should extract name for ssoProvider", () => {
      expect(
        extractEntityName("ssoProvider", {
          id: 1,
          name: "saml-okta",
          type: "SAML",
        })
      ).toBe("saml-okta");
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
      // Attachments audit solely via the dedicated lib/baseDb.ts hook, so the
      // RPC shim has no name mapping for them (real accessor is `attachments`).
      expect(
        extractEntityName("attachments", { id: 1, filename: "test.pdf" })
      ).toBeUndefined();
    });

    it("no longer resolves names for decommissioned admin-config catalog models", () => {
      // AUDITED_CONFIG_MODELS is empty (CDC owns these), so the shim's name map
      // carries no entry for the former catalog accessors.
      expect(
        extractEntityName("workflows", { id: 1, name: "Release Flow" })
      ).toBeUndefined();
      expect(
        extractEntityName("caseFields", { id: 1, displayName: "Priority" })
      ).toBeUndefined();
      expect(
        extractEntityName("samlConfiguration", {
          id: "c1",
          issuer: "https://idp.example.com",
        })
      ).toBeUndefined();
    });

    it("no longer resolves composite names for decommissioned admin-config join models", () => {
      // Join-table name derivation lived in AUDITED_CONFIG_MODELS, now empty.
      expect(
        extractEntityName("rolePermission", { roleId: 75, area: "TestRuns" })
      ).toBeUndefined();
      expect(
        extractEntityName("groupAssignment", { userId: "u1", groupId: 3 })
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
    it("should map the access/config accessors the RPC shim still labels", () => {
      // The shim's entity-type map mirrors the audited RPC accessors. Project/
      // app accessors moved to CDC, so they are no longer mapped here.
      expect(entityTypeMap["user"]).toBe("User");
      expect(entityTypeMap["apiToken"]).toBe("ApiToken");
      expect(entityTypeMap["repositoryCases"]).toBeUndefined();
      expect(entityTypeMap["testRuns"]).toBeUndefined();
      expect(entityTypeMap["sessions"]).toBeUndefined();
      expect(entityTypeMap["sharedStepGroup"]).toBeUndefined();
      expect(entityTypeMap["issue"]).toBeUndefined();
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
      const mappedEntityType =
        entityTypeMap[parsedPath.model] || parsedPath.model;
      let entityName = extractEntityName(parsedPath.model, data);
      const projectId =
        typeof data.projectId === "number" ? data.projectId : undefined;

      // Mirror the route's bulk-op naming: a `{ count }` aggregate has no row
      // to name, so the entry is named after the affected count + entity type.
      if (auditAction.startsWith("BULK_") && typeof data.count === "number") {
        entityName = `${data.count} ${mappedEntityType}`;
      }

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
        entityType: mappedEntityType,
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

    it("should construct a CREATE event for a project permission grant", () => {
      const event = constructAuditEvent(
        "POST",
        ["userProjectPermission", "create"],
        200,
        {
          data: { id: 123, userId: "u-1", projectId: 1 },
        }
      );

      expect(event).toEqual({
        action: "CREATE",
        entityType: "UserProjectPermission",
        entityId: "123",
        entityName: undefined,
        projectId: 1,
        metadata: { operation: "create" },
      });
    });

    it("should construct an UPDATE event for a user", () => {
      const event = constructAuditEvent("PATCH", ["user", "update"], 200, {
        data: { id: "u-456", email: "updated@example.com" },
      });

      expect(event).toEqual({
        action: "UPDATE",
        entityType: "User",
        entityId: "u-456",
        entityName: "updated@example.com",
        projectId: undefined,
        metadata: { operation: "update" },
      });
    });

    it("should construct a DELETE event for a project permission", () => {
      const event = constructAuditEvent(
        "DELETE",
        ["userProjectPermission", "delete"],
        200,
        {
          data: { id: 789, userId: "u-1", projectId: 3 },
        }
      );

      expect(event).toEqual({
        action: "DELETE",
        entityType: "UserProjectPermission",
        entityId: "789",
        entityName: undefined,
        projectId: 3,
        metadata: { operation: "delete" },
      });
    });

    it("should construct a BULK_CREATE event with count", () => {
      const event = constructAuditEvent(
        "POST",
        ["userProjectPermission", "createMany"],
        200,
        {
          data: { count: 10 },
        }
      );

      expect(event).toEqual({
        action: "BULK_CREATE",
        entityType: "UserProjectPermission",
        entityId: "createMany-fallback",
        entityName: "10 UserProjectPermission",
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
        ["userProjectPermission", "deleteMany"],
        200,
        {
          data: { count: 5 },
        }
      );

      expect(event).toEqual({
        action: "BULK_DELETE",
        entityType: "UserProjectPermission",
        entityId: "deleteMany-fallback",
        entityName: "5 UserProjectPermission",
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
// before any baseDb/baseHandler call. Empty-scopes tokens still pass through.
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
    const { baseDb } = await import("~/lib/db");
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
    // No baseDb write touched.
    expect((baseDb as any).apiToken.update).not.toHaveBeenCalled();
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
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
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
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
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
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
      99,
      // Actor access for the system-admin bypass. `baseDb.user.findUnique`
      // is an unconfigured stub here, so the lookup yields undefined and the
      // gate applies in full.
      undefined
    );
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("threads the actor's ADMIN access into the gate so system admins bypass it", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
    (assertReviewGatePasses as any).mockResolvedValue(null);
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({ access: "ADMIN" });

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
      99,
      "ADMIN"
    );
  });

  it("does NOT call the gate when the update does not include stateId", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");

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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");

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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
      88,
      undefined
    );
  });

  it("translates the gate for sessions (SESSION entity type)", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
      99,
      undefined
    );
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("CR-03 — gates updateMany payloads with a scalar where.id and a stateId", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
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
      88,
      undefined
    );
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("CR-03 — does NOT block updateMany when where.id is a Prisma filter (e.g. { in: [...] })", async () => {
    // Multi-row updateMany cannot be expressed in the gate's polymorphic
    // (entityType, entityId) shape. The gate falls through to the schema
    // @@deny backstop in that case; the route does not invoke the friendly
    // gate at all. The gate would still be hit on a per-row basis when the
    // caller targets a single id; this just covers the bulk path.
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");

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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");

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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");

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

  it("CR-04 — stamps consumedAt on every approved request the strict transitive gate returned", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
    (assertReviewGatePasses as any).mockResolvedValue({
      approvedRequestIds: ["approval-1"],
    });

    const { baseDb } = await import("~/lib/db");
    (baseDb as any).reviewRequest.updateMany.mockResolvedValue({ count: 1 });

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect((baseDb as any).reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["approval-1"] }, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("CR-04 — returns 403 REVIEW_REQUIRED when the stamp count is short (lost the race on at least one approval)", async () => {
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
    (assertReviewGatePasses as any).mockResolvedValue({
      approvedRequestIds: ["approval-2"],
    });

    const { baseDb } = await import("~/lib/db");
    // Another caller consumed this approval first — our stamp comes back
    // with count: 0 and we must surface as REVIEW_REQUIRED instead of
    // handing off to ZenStack.
    (baseDb as any).reviewRequest.updateMany.mockResolvedValue({ count: 0 });

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
    const { assertReviewGatePasses } =
      await import("~/lib/services/reviewGate");
    (assertReviewGatePasses as any).mockResolvedValue(null);

    const { baseDb } = await import("~/lib/db");

    const { PATCH } = await import("./route");
    const req = makeUpdateRequest({
      where: { id: 42 },
      data: { stateId: 99 },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["repositoryCases", "update"] }),
    });

    expect(res.status).toBe(200);
    expect((baseDb as any).reviewRequest.updateMany).not.toHaveBeenCalled();
    expect(baseHandlerMock).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionResults required-result-field guard at the auto-API chokepoint.
// Closes the bypass that the placeholder in
// `.planning/backlog/999.17-session-result-required-field-enforcement/`
// documents: raw-API callers POSTing to /api/model/sessionResults could
// previously skip a server-required Result Field. The handler-level gate
// runs `hasMissingRequiredResultField` before the ZenStack pipeline executes,
// so first-party and raw-API callers go through the same check.
// ─────────────────────────────────────────────────────────────────────────────
describe("ZenStack chokepoint SessionResults required-field gate", () => {
  function makeCreateRequest(body: unknown): NextRequest {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set("authorization", "Bearer tpi_test_token");
    const json = JSON.stringify(body);
    return {
      method: "POST",
      headers,
      url: "http://localhost:3000/api/model/sessionResults/create",
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
    (extractBearerToken as any).mockReturnValue("tpi_test_token");
    const { authenticateApiTokenForMethod } =
      await import("~/lib/api-token-auth");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: true,
      userId: "user-1",
      access: "USER",
      scopes: [],
    });
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: "U",
    });
    baseHandlerMock.mockClear();
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 7 } }), { status: 200 })
    );
  });

  function mockSessionLookup(templateId: number) {
    return async () => {
      const { baseDb } = await import("~/lib/db");
      (baseDb as any).sessions = {
        findUnique: vi.fn().mockResolvedValue({ templateId }),
      };
    };
  }

  function mockRequiredFieldAssignments(
    requiredFieldIds: number[]
  ): () => Promise<void> {
    return async () => {
      const { baseDb } = await import("~/lib/db");
      (baseDb as any).templateResultAssignment = {
        findMany: vi
          .fn()
          .mockResolvedValue(
            requiredFieldIds.map((resultFieldId) => ({ resultFieldId }))
          ),
      };
    };
  }

  it("rejects with REQUIRED_FIELDS_MISSING when the body omits any required field", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([11, 12])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({
      data: {
        sessionId: 100,
        statusId: 2,
        // no resultFieldValues.create
      },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("REQUIRED_FIELDS_MISSING");
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects when only some required fields are supplied", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([11, 12])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({
      data: {
        sessionId: 100,
        statusId: 2,
        resultFieldValues: { create: [{ fieldId: 11, value: "x" }] },
      },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("REQUIRED_FIELDS_MISSING");
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("passes through to baseHandler when every required field is supplied via nested create", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([11, 12])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({
      data: {
        sessionId: 100,
        statusId: 2,
        resultFieldValues: {
          create: [
            { fieldId: 11, value: "a" },
            { fieldId: 12, value: "b" },
          ],
        },
      },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("passes through when the template has no required fields", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({
      data: { sessionId: 100, statusId: 2 },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("passes through when sessionId is missing (ZenStack will reject schema-wise)", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([11])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({ data: { statusId: 2 } });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("accepts the `session: { connect: { id } }` body shape (treated same as sessionId)", async () => {
    await mockSessionLookup(5)();
    await mockRequiredFieldAssignments([11])();

    const { POST } = await import("./route");
    const req = makeCreateRequest({
      data: {
        session: { connect: { id: 100 } },
        statusId: 2,
        resultFieldValues: { create: [{ fieldId: 11, value: "x" }] },
      },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessionResults", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SamlConfiguration cert normalization (defense-in-depth normalize-on-save).
// The admin SSO form writes the IdP cert through the generated RPC hooks, so
// this route is the universal mutation seam. A cert whose PEM newlines were
// collapsed to spaces must be re-emitted as canonical PEM before it reaches
// the ZenStack handler (and the DB), matching the normalize-on-use path in
// createSAMLClient.
// ─────────────────────────────────────────────────────────────────────────────
describe("ZenStack chokepoint audit before/after diff capture", () => {
  function makeRequest(
    model: string,
    operation: string,
    body: unknown
  ): NextRequest {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const method =
      operation === "create"
        ? "POST"
        : operation === "delete"
          ? "DELETE"
          : "PATCH";
    // ZenStack RPC carries a delete's `where` in the ?q= query param with no
    // request body — mirror that so the shim's deleted-row capture is exercised.
    const isDelete = operation === "delete";
    const url = isDelete
      ? `http://localhost:3000/api/model/${model}/${operation}?q=${encodeURIComponent(
          JSON.stringify(body)
        )}`
      : `http://localhost:3000/api/model/${model}/${operation}`;
    const json = isDelete ? "" : JSON.stringify(body);
    return {
      method,
      headers,
      url,
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
  }

  async function run(
    model: string,
    operation: string,
    body: unknown,
    responseData: unknown
  ) {
    const route = await import("./route");
    const handler =
      operation === "create"
        ? route.POST
        : operation === "delete"
          ? route.DELETE
          : route.PATCH;
    baseHandlerMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: responseData }), { status: 200 })
    );
    return handler(makeRequest(model, operation, body), {
      params: Promise.resolve({ path: [model, operation] }),
    });
  }

  let captureAuditEvent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "user-1", email: "u@e.com", name: "U", access: "ADMIN" },
    });
    const { extractBearerToken } = await import("~/lib/api-token-auth");
    (extractBearerToken as any).mockReturnValue(null);
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: "U",
      access: "ADMIN",
    });
    const auditLog = await import("~/lib/services/auditLog");
    captureAuditEvent = auditLog.captureAuditEvent as ReturnType<typeof vi.fn>;
  });

  it("records the changed fields for a real UPDATE", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).userProjectPermission = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ id: 1, accessType: "READ" }) // pre-snapshot
        .mockResolvedValueOnce({ id: 1, accessType: "WRITE" }), // after-read
    };

    const res = await run(
      "userProjectPermission",
      "update",
      { where: { id: 1 }, data: { accessType: "WRITE" } },
      { id: 1 }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityType: "UserProjectPermission",
        changes: { accessType: { old: "READ", new: "WRITE" } },
      })
    );
  });

  it("suppresses a no-op UPDATE (empty diff) instead of logging an empty row", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).userProjectPermission = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ id: 1, accessType: "READ" }) // pre-snapshot
        .mockResolvedValueOnce({ id: 1, accessType: "READ" }), // after-read (unchanged)
    };

    const res = await run(
      "userProjectPermission",
      "update",
      { where: { id: 1 }, data: { accessType: "READ" } },
      { id: 1 }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("diffs a BigInt column on UPDATE without throwing it away", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).userProjectPermission = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ id: 1, quota: 100n })
        .mockResolvedValueOnce({ id: 1, quota: 200n }),
    };

    const res = await run(
      "userProjectPermission",
      "update",
      { where: { id: 1 }, data: { quota: "200" } },
      { id: 1 }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        changes: { quota: { old: "100", new: "200" } },
      })
    );
  });

  it("records created field values for a CREATE", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).userProjectPermission = { findUnique: vi.fn() };

    const res = await run(
      "userProjectPermission",
      "create",
      { data: { accessType: "WRITE" } },
      { id: 9, accessType: "WRITE", isDeleted: false }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    const event = (captureAuditEvent.mock.calls[0] as unknown[])[0] as any;
    expect(event.action).toBe("CREATE");
    expect(event.entityType).toBe("UserProjectPermission");
    expect(event.changes.accessType).toEqual({ old: null, new: "WRITE" });
    expect(event.changes.id).toEqual({ old: null, new: 9 });
  });

  it("emits SSO_CONFIG_CHANGED named from the provider name on an ssoProvider write", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).ssoProvider = { findUnique: vi.fn() };

    const res = await run(
      "ssoProvider",
      "create",
      { data: { name: "saml-okta", type: "SAML" } },
      { id: "sso-1", name: "saml-okta", type: "SAML" }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SSO_CONFIG_CHANGED",
        entityType: "SsoProvider",
        entityName: "saml-okta",
      })
    );
  });

  it("emits SYSTEM_CONFIG_CHANGED on an appConfig write", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).appConfig = { findUnique: vi.fn() };

    const res = await run(
      "appConfig",
      "create",
      { data: { key: "FEATURE_X", value: true } },
      { key: "FEATURE_X", value: true }
    );

    expect(res.status).toBe(200);
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SYSTEM_CONFIG_CHANGED",
        entityType: "AppConfig",
        entityName: "FEATURE_X",
      })
    );
  });

  it("captures the removed row's values on a hard DELETE (where from ?q=)", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).userProjectPermission = {
      findUnique: vi.fn().mockResolvedValueOnce({ id: 1, accessType: "WRITE" }),
    };

    const res = await run(
      "userProjectPermission",
      "delete",
      { where: { id: 1 } },
      { id: 1, accessType: "WRITE" }
    );

    expect(res.status).toBe(200);
    expect(
      (baseDb as any).userProjectPermission.findUnique
    ).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    expect(captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entityType: "UserProjectPermission",
        changes: expect.objectContaining({
          accessType: { old: "WRITE", new: null },
        }),
      })
    );
  });
});

describe("ZenStack chokepoint SamlConfiguration cert normalization", () => {
  // 48 raw bytes → exactly 64 base64 chars (one PEM line).
  const CERT_BODY = Buffer.from("x".repeat(48)).toString("base64");
  const CANONICAL_PEM = `-----BEGIN CERTIFICATE-----\n${CERT_BODY}\n-----END CERTIFICATE-----\n`;
  const MANGLED = `-----BEGIN CERTIFICATE----- ${CERT_BODY} -----END CERTIFICATE-----`;

  function makeRequest(
    method: string,
    operation: string,
    body: unknown
  ): NextRequest {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const json = JSON.stringify(body);
    return {
      method,
      headers,
      url: `http://localhost:3000/api/model/samlConfiguration/${operation}`,
      clone() {
        return this;
      },
      async text() {
        return json;
      },
    } as unknown as NextRequest;
  }

  async function forwardedBody(): Promise<any> {
    expect(baseHandlerMock).toHaveBeenCalled();
    const forwardedReq = (
      baseHandlerMock.mock.calls[0] as unknown[]
    )[0] as Request;
    return JSON.parse(await forwardedReq.text());
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "user-1", email: "u@e.com", name: "U", access: "ADMIN" },
    });
    const { extractBearerToken } = await import("~/lib/api-token-auth");
    (extractBearerToken as any).mockReturnValue(null);
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: "U",
      access: "ADMIN",
    });
    // The audited-update path takes a best-effort before/after snapshot of the
    // row; stub it so the test output stays clean (the value is irrelevant to
    // the cert-normalization assertions).
    (baseDb as any).samlConfiguration = {
      findUnique: vi.fn().mockResolvedValue(null),
    };
    baseHandlerMock.mockClear();
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 7 } }), { status: 200 })
    );
  });

  it("normalizes the space-mangled cert on create before forwarding", async () => {
    const { POST } = await import("./route");
    const req = makeRequest("POST", "create", {
      data: { providerId: "p1", entryPoint: "https://idp", cert: MANGLED },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["samlConfiguration", "create"] }),
    });

    expect(res.status).toBe(200);
    const body = await forwardedBody();
    expect(body.data.cert).toBe(CANONICAL_PEM);
    // Untouched fields are preserved.
    expect(body.data.providerId).toBe("p1");
  });

  it("normalizes the cert in both branches of an upsert", async () => {
    const { POST } = await import("./route");
    const req = makeRequest("POST", "upsert", {
      where: { providerId: "p1" },
      create: { providerId: "p1", cert: MANGLED },
      update: { cert: MANGLED },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["samlConfiguration", "upsert"] }),
    });

    expect(res.status).toBe(200);
    const body = await forwardedBody();
    expect(body.create.cert).toBe(CANONICAL_PEM);
    expect(body.update.cert).toBe(CANONICAL_PEM);
  });

  it("passes through unchanged when the write carries no cert", async () => {
    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", "update", {
      where: { id: 7 },
      data: { entryPoint: "https://idp/new" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["samlConfiguration", "update"] }),
    });

    expect(res.status).toBe(200);
    const body = await forwardedBody();
    expect(body.data).toEqual({ entryPoint: "https://idp/new" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Configuration-group membership guard. `configurationGroupId` links runs /
// sessions that cover the same logical work across configurations, and is now
// editable after the fact — so the generic RPC route is the write path and the
// invariants (one project per group, uuid-or-null, addressable targets) are
// enforced here. Mirrors the CR-03 shape: update, updateMany AND upsert.
// ─────────────────────────────────────────────────────────────────────────────
describe("ZenStack chokepoint configuration-group guard", () => {
  const GROUP_A = "11111111-1111-4111-8111-111111111111";
  const GROUP_B = "22222222-2222-4222-8222-222222222222";

  type GroupRow = {
    id: number;
    projectId: number;
    configurationGroupId: string | null;
    isDeleted: boolean;
  };

  function installTable(db: any, model: string, rows: GroupRow[]) {
    const matches = (r: GroupRow, where: any): boolean => {
      if (!where) return true;
      if (where.id !== undefined) {
        if (typeof where.id === "object" && Array.isArray(where.id.in)) {
          if (!where.id.in.includes(r.id)) return false;
        } else if (r.id !== where.id) {
          return false;
        }
      }
      if (
        where.configurationGroupId !== undefined &&
        r.configurationGroupId !== where.configurationGroupId
      ) {
        return false;
      }
      if (where.isDeleted !== undefined && r.isDeleted !== where.isDeleted) {
        return false;
      }
      return true;
    };
    const delegate = {
      findUnique: vi.fn(async ({ where }: any) => {
        const hit = rows.find((r) => matches(r, where));
        return hit ? { ...hit } : null;
      }),
      findMany: vi.fn(async ({ where, take }: any) => {
        const hits = rows
          .filter((r) => matches(r, where))
          .map((r) => ({ ...r }));
        return typeof take === "number" ? hits.slice(0, take) : hits;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const hit = rows.find((r) => r.id === where.id);
        if (hit) Object.assign(hit, data);
        return hit ? { ...hit } : null;
      }),
    };
    db[model] = delegate;
    return delegate;
  }

  function makeRequest(
    method: string,
    pathSegments: string[],
    body: unknown
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

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "user-1", email: "u@e.com", name: "U" },
    });
    const { extractBearerToken } = await import("~/lib/api-token-auth");
    (extractBearerToken as any).mockReturnValue(null);
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: "U",
    });
    baseHandlerMock.mockClear();
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 })
    );
  });

  it("rejects a cross-project join on update and skips baseHandler", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
      { id: 2, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: GROUP_A },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CONFIGURATION_GROUP_INVALID");
    expect(body.error.message).toMatch(/same project/);
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("allows a same-project join on update", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: GROUP_A },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("gates the upsert update-branch (sessions)", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "sessions", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
      { id: 2, projectId: 9, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["sessions", "upsert"], {
      where: { id: 1 },
      create: { name: "fresh" },
      update: { configurationGroupId: GROUP_A },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["sessions", "upsert"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CONFIGURATION_GROUP_INVALID");
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("gates updateMany with an { in: [...] } target list", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
      { id: 2, projectId: 8, configurationGroupId: null, isDeleted: false },
    ]);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["testRuns", "updateMany"], {
      where: { id: { in: [1, 2] } },
      data: { configurationGroupId: GROUP_A },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "updateMany"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/same project/);
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects a non-null assignment whose targets are an opaque filter", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", []);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["testRuns", "updateMany"], {
      where: { projectId: 7 },
      data: { configurationGroupId: GROUP_A },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "updateMany"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/specific records/);
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid group id", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
    ]);

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: "not-a-uuid" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/UUID/);
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("matches the model case-insensitively (TestRuns path casing)", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: null, isDeleted: false },
      { id: 2, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["TestRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: GROUP_A },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["TestRuns", "update"] }),
    });

    expect(res.status).toBe(400);
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("pays no query cost when the payload does not touch the field", async () => {
    const { baseDb } = await import("~/lib/db");
    const delegate = installTable(baseDb as any, "testRuns", [
      { id: 1, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { name: "renamed" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(delegate.findMany).not.toHaveBeenCalled();
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it("auto-dissolves the lone survivor after a member clears its group", async () => {
    const { baseDb } = await import("~/lib/db");
    const rows: GroupRow[] = [
      { id: 1, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
    ];
    const delegate = installTable(baseDb as any, "testRuns", rows);
    // Stand in for the real write the handler would have committed.
    baseHandlerMock.mockImplementation(async () => {
      rows[0].configurationGroupId = null;
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 });
    });

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: null },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { configurationGroupId: null },
    });
    expect(rows[1].configurationGroupId).toBeNull();
  });

  it("leaves a 3-member group intact when one member clears its group", async () => {
    const { baseDb } = await import("~/lib/db");
    const rows: GroupRow[] = [
      { id: 1, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 3, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
    ];
    const delegate = installTable(baseDb as any, "testRuns", rows);
    baseHandlerMock.mockImplementation(async () => {
      rows[0].configurationGroupId = null;
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 });
    });

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: null },
    });
    await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });

    expect(delegate.update).not.toHaveBeenCalled();
    expect(rows[1].configurationGroupId).toBe(GROUP_A);
    expect(rows[2].configurationGroupId).toBe(GROUP_A);
  });

  it("auto-dissolves the lone survivor after a member is soft-deleted", async () => {
    const { baseDb } = await import("~/lib/db");
    const rows: GroupRow[] = [
      { id: 1, projectId: 7, configurationGroupId: GROUP_B, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_B, isDeleted: false },
    ];
    const delegate = installTable(baseDb as any, "sessions", rows);
    baseHandlerMock.mockImplementation(async () => {
      rows[0].isDeleted = true;
      return new Response(JSON.stringify({ data: { id: 1 } }), { status: 200 });
    });

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["sessions", "update"], {
      where: { id: 1 },
      data: { isDeleted: true },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ["sessions", "update"] }),
    });

    expect(res.status).toBe(200);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { configurationGroupId: null },
    });
  });

  it("rejects a create that reaches into another project's group", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 9, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 10, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["testRuns", "create"], {
      data: { name: "run", projectId: 7, configurationGroupId: GROUP_A },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "create"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CONFIGURATION_GROUP_INVALID");
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects an upsert whose create branch reaches into another project's group", async () => {
    // `upsert` carries its own create payload, which runs whenever `where`
    // matches nothing — the same rule as `create` has to reach it.
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", [
      { id: 9, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 10, projectId: 8, configurationGroupId: GROUP_A, isDeleted: false },
    ]);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["testRuns", "upsert"], {
      where: { id: 99999999 },
      create: { name: "run", projectId: 7, configurationGroupId: GROUP_A },
      update: {},
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "upsert"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CONFIGURATION_GROUP_INVALID");
    expect(baseHandlerMock).not.toHaveBeenCalled();
  });

  it("allows the create-modal batch that mints a fresh group", async () => {
    const { baseDb } = await import("~/lib/db");
    installTable(baseDb as any, "testRuns", []);

    const { POST } = await import("./route");
    const req = makeRequest("POST", ["testRuns", "create"], {
      data: { name: "run", projectId: 7, configurationGroupId: GROUP_B },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["testRuns", "create"] }),
    });

    expect(res.status).toBe(200);
    expect(baseHandlerMock).toHaveBeenCalled();
  });

  it("skips auto-dissolve when the underlying mutation failed", async () => {
    const { baseDb } = await import("~/lib/db");
    const rows: GroupRow[] = [
      { id: 1, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
      { id: 2, projectId: 7, configurationGroupId: GROUP_A, isDeleted: false },
    ];
    const delegate = installTable(baseDb as any, "testRuns", rows);
    baseHandlerMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "denied" } }), {
        status: 403,
      })
    );

    const { PATCH } = await import("./route");
    const req = makeRequest("PATCH", ["testRuns", "update"], {
      where: { id: 1 },
      data: { configurationGroupId: null },
    });
    await PATCH(req, {
      params: Promise.resolve({ path: ["testRuns", "update"] }),
    });

    expect(delegate.update).not.toHaveBeenCalled();
    expect(rows[1].configurationGroupId).toBe(GROUP_A);
  });
});
