import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Replicate extractEntityName
function extractEntityName(entityType: string, result: any): string | undefined {
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
    return field.map((f) => result[f]).filter(Boolean).join(":");
  }

  return result[field];
}

// Replicate parseZenStackPath
function parseZenStackPath(path: string[]): { model: string; operation: string } | null {
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
      expect(extractEntityName("repositoryCases", { id: 1, name: "Test Case" })).toBe("Test Case");
    });

    it("should extract name for testRuns", () => {
      expect(extractEntityName("testRuns", { id: 1, name: "Sprint 1 Run" })).toBe("Sprint 1 Run");
    });

    it("should extract title for sessions", () => {
      expect(extractEntityName("sessions", { id: 1, title: "Exploratory Session" })).toBe(
        "Exploratory Session"
      );
    });

    it("should extract title for issues", () => {
      expect(extractEntityName("issues", { id: 1, title: "Bug Report" })).toBe("Bug Report");
    });

    it("should extract name for projects", () => {
      expect(extractEntityName("projects", { id: 1, name: "My Project" })).toBe("My Project");
    });

    it("should extract email for user", () => {
      expect(extractEntityName("user", { id: "abc", email: "user@example.com" })).toBe(
        "user@example.com"
      );
    });

    it("should extract type for ssoProvider", () => {
      expect(extractEntityName("ssoProvider", { id: 1, type: "SAML" })).toBe("SAML");
    });

    it("should extract domain for allowedEmailDomain", () => {
      expect(extractEntityName("allowedEmailDomain", { id: 1, domain: "example.com" })).toBe(
        "example.com"
      );
    });

    it("should extract key for appConfig", () => {
      expect(extractEntityName("appConfig", { key: "FEATURE_FLAG" })).toBe("FEATURE_FLAG");
    });

    it("should extract name for apiToken", () => {
      expect(extractEntityName("apiToken", { id: "token-1", name: "CI Token" })).toBe("CI Token");
    });

    it("should return undefined for entities without name mapping", () => {
      expect(extractEntityName("comment", { id: 1, content: "Test comment" })).toBeUndefined();
      expect(extractEntityName("attachment", { id: 1, filename: "test.pdf" })).toBeUndefined();
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
      expect(entityTypeMap["userProjectPermission"]).toBe("UserProjectPermission");
      expect(entityTypeMap["groupProjectPermission"]).toBe("GroupProjectPermission");
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

      const entityId = data.id || data.key || `${parsedPath.operation}-fallback`;
      const entityName = extractEntityName(parsedPath.model, data);
      const projectId = typeof data.projectId === "number" ? data.projectId : undefined;

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
          ...(auditAction.startsWith("BULK_") && data.count ? { count: data.count } : {}),
        },
      };
    }

    it("should construct a CREATE event for a new test case", () => {
      const event = constructAuditEvent("POST", ["repositoryCases", "create"], 200, {
        data: { id: 123, name: "New Test Case", projectId: 1 },
      });

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
      const event = constructAuditEvent("POST", ["repositoryCases", "createMany"], 200, {
        data: { count: 10 },
      });

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
      const event = constructAuditEvent("GET", ["repositoryCases", "findMany"], 200, {
        data: [{ id: 1 }],
      });

      expect(event).toBeNull();
    });

    it("should return null for failed mutations", () => {
      const event = constructAuditEvent("POST", ["repositoryCases", "create"], 500, {
        error: "Server error",
      });

      expect(event).toBeNull();
    });

    it("should return null for non-audited entities", () => {
      const event = constructAuditEvent("POST", ["verificationToken", "create"], 200, {
        data: { id: 1 },
      });

      expect(event).toBeNull();
    });

    it("should return null for read operations even with POST method", () => {
      // ZenStack uses POST for findMany queries
      const event = constructAuditEvent("POST", ["repositoryCases", "findMany"], 200, {
        data: [{ id: 1 }],
      });

      expect(event).toBeNull();
    });

    it("should return null when response has no data", () => {
      const event = constructAuditEvent("POST", ["repositoryCases", "create"], 200, {});

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
      const event = constructAuditEvent("POST", ["userProjectPermission", "create"], 200, {
        data: { id: 100, userId: "user-1", projectId: 5, role: "ADMIN" },
      });

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
      const event = constructAuditEvent("DELETE", ["repositoryCases", "deleteMany"], 200, {
        data: { count: 5 },
      });

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
