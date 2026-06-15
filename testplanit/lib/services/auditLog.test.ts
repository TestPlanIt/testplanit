import { AuditAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectAuditRowComplete } from "../testing/auditAssertions";
import {
  auditAuthEvent,
  auditBulkCreate,
  auditBulkDelete,
  auditBulkUpdate,
  auditCreate,
  auditDataExport,
  auditDelete,
  auditPasswordChange,
  auditPermissionGrant,
  auditPermissionRevoke,
  auditRoleChange,
  auditSsoConfigChange,
  auditSystemConfigChange,
  auditUpdate,
  calculateDiff,
  captureAuditEvent,
  extractEntityName,
  resolveTestRunResultAuditScope,
  type AuditEvent,
} from "./auditLog";

/**
 * D-18 standing-discipline helper for this file. Builds a synthetic
 * audit row from the jobData (event + context) that BullMQ receives,
 * then runs expectAuditRowComplete on it. Every happy-path test that
 * exercises captureAuditEvent or its callers invokes this helper on
 * the last queued jobData, matching the SC#4 enforcement pattern
 * (Plan 05 Task 3 / W3 closure).
 */
function expectLastQueuedRowComplete(
  mockQueueAdd: ReturnType<typeof vi.fn>,
  opts?: { allowSystem?: boolean }
): void {
  const calls = mockQueueAdd.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const jobData = calls[calls.length - 1][1] as {
    event: AuditEvent;
    context: Record<string, unknown> | null;
  };
  const ev = jobData.event;
  const ctx = jobData.context ?? {};
  expectAuditRowComplete(
    {
      userId:
        (ev.userId as string | null | undefined) ??
        ((ctx as Record<string, unknown>).userId as
          | string
          | null
          | undefined) ??
        null,
      userEmail:
        (ev.userEmail as string | null | undefined) ??
        ((ctx as Record<string, unknown>).userEmail as
          | string
          | null
          | undefined) ??
        null,
      userName:
        (ev.userName as string | null | undefined) ??
        ((ctx as Record<string, unknown>).userName as
          | string
          | null
          | undefined) ??
        null,
      ipAddress:
        ((ctx as Record<string, unknown>).ipAddress as
          | string
          | null
          | undefined) ?? null,
      userAgent:
        ((ctx as Record<string, unknown>).userAgent as
          | string
          | null
          | undefined) ?? null,
      requestId:
        ((ctx as Record<string, unknown>).requestId as
          | string
          | null
          | undefined) ?? null,
      metadata: ev.metadata ?? null,
    },
    opts
  );
}

// Mock the queue (IN-07 fold-in: hoisted so the factory closure captures the
// mock before any helper code runs — prevents leaking to real Valkey/DB).
const mocks = vi.hoisted(() => ({
  mockQueue: { add: vi.fn() },
}));

vi.mock("../queues", () => ({
  getAuditLogQueue: vi.fn(() => mocks.mockQueue),
}));

// Mock audit context — hoisted so individual tests can mutate the current
// context (e.g., to override requestId for the D-19 smoke test) without
// racing the mock factory evaluation.
const auditContextMocks = vi.hoisted(() => ({
  currentContext: {
    userId: "context-user-123",
    userEmail: "context@example.com",
    userName: "Context User",
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0",
    requestId: "req-default",
  } as Record<string, unknown> | null,
}));

vi.mock("../auditContext", () => ({
  getAuditContext: vi.fn(() => auditContextMocks.currentContext),
  // Re-export the sentinel so the D-18 enforcement helper (which
  // imports SYSTEM_ACTOR_ID from ~/lib/auditContext) works inside this
  // file's fully-mocked module graph.
  SYSTEM_ACTOR_ID: "__system__",
}));

// Mock multi-tenant
vi.mock("../multiTenantPrisma", () => ({
  isMultiTenantMode: vi.fn(() => false),
  getCurrentTenantId: vi.fn(() => undefined),
}));

describe("AuditLog Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateDiff", () => {
    it("should return undefined when both old and new are null/undefined", () => {
      expect(calculateDiff(null, null)).toBeUndefined();
      expect(calculateDiff(undefined, undefined)).toBeUndefined();
    });

    it("should show all new values for CREATE (no old entity)", () => {
      const newEntity = {
        id: 1,
        name: "Test",
        projectId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const diff = calculateDiff(null, newEntity);

      expect(diff).toBeDefined();
      expect(diff!.id).toEqual({ old: null, new: 1 });
      expect(diff!.name).toEqual({ old: null, new: "Test" });
      expect(diff!.projectId).toEqual({ old: null, new: 10 });
      // createdAt and updatedAt should be excluded
      expect(diff!.createdAt).toBeUndefined();
      expect(diff!.updatedAt).toBeUndefined();
    });

    it("should show all old values for DELETE (no new entity)", () => {
      const oldEntity = {
        id: 1,
        name: "Test",
        projectId: 10,
      };

      const diff = calculateDiff(oldEntity, null);

      expect(diff).toBeDefined();
      expect(diff!.id).toEqual({ old: 1, new: null });
      expect(diff!.name).toEqual({ old: "Test", new: null });
    });

    it("should only include changed fields for UPDATE", () => {
      const oldEntity = {
        id: 1,
        name: "Old Name",
        description: "Same description",
        stateId: 1,
      };

      const newEntity = {
        id: 1,
        name: "New Name",
        description: "Same description",
        stateId: 2,
      };

      const diff = calculateDiff(oldEntity, newEntity);

      expect(diff).toBeDefined();
      expect(diff!.name).toEqual({ old: "Old Name", new: "New Name" });
      expect(diff!.stateId).toEqual({ old: 1, new: 2 });
      // Unchanged fields should not be included
      expect(diff!.id).toBeUndefined();
      expect(diff!.description).toBeUndefined();
    });

    it("should return undefined when no fields changed", () => {
      const entity = { id: 1, name: "Test" };
      const diff = calculateDiff(entity, { ...entity });
      expect(diff).toBeUndefined();
    });

    it("should mask sensitive fields", () => {
      const oldEntity = {
        id: 1,
        password: "oldPassword123",
        accessToken: "old-token-xyz",
      };

      const newEntity = {
        id: 1,
        password: "newPassword456",
        accessToken: "new-token-abc",
      };

      const diff = calculateDiff(oldEntity, newEntity);

      expect(diff).toBeDefined();
      expect(diff!.password).toEqual({ old: "[REDACTED]", new: "[REDACTED]" });
      // Tokens show last 4 chars
      expect(diff!.accessToken.old).toMatch(/\[\*\*\*\*.+\]/);
      expect(diff!.accessToken.new).toMatch(/\[\*\*\*\*.+\]/);
    });

    it("should handle nested object changes", () => {
      const oldEntity = {
        id: 1,
        config: { setting1: true, setting2: "value" },
      };

      const newEntity = {
        id: 1,
        config: { setting1: false, setting2: "value" },
      };

      const diff = calculateDiff(oldEntity, newEntity);

      expect(diff).toBeDefined();
      expect(diff!.config).toBeDefined();
    });
  });

  describe("extractEntityName", () => {
    it("should extract name for User entity", () => {
      const entity = {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      };
      expect(extractEntityName("User", entity)).toBe("test@example.com");
    });

    it("should extract name for RepositoryCases entity", () => {
      const entity = {
        id: 1,
        name: "Test Case Name",
        title: "Test Case Title",
      };
      expect(extractEntityName("RepositoryCases", entity)).toBe(
        "Test Case Name"
      );
    });

    it("should extract name for Projects entity", () => {
      const entity = { id: 1, name: "My Project" };
      expect(extractEntityName("Projects", entity)).toBe("My Project");
    });

    it("should extract name for ApiToken entity", () => {
      const entity = {
        id: "token-1",
        name: "CI Token",
        tokenPrefix: "tpi_abc",
      };
      expect(extractEntityName("ApiToken", entity)).toBe("CI Token");
    });

    it("should return undefined for unknown entity types", () => {
      const entity = { id: 1, name: "Test" };
      expect(extractEntityName("UnknownEntity", entity)).toBeUndefined();
    });

    it("should return undefined for null entity", () => {
      expect(extractEntityName("User", null)).toBeUndefined();
    });

    it("should handle composite keys", () => {
      const entity = { userId: "user-1", projectId: 10 };
      expect(extractEntityName("UserProjectPermission", entity)).toBe(
        "user-1:10"
      );
    });
  });

  describe("resolveTestRunResultAuditScope", () => {
    function makeClient(overrides?: {
      projectId?: number | null;
      caseName?: string | null;
    }) {
      const testRunsFindUnique = vi.fn().mockResolvedValue(
        overrides?.projectId === undefined
          ? { projectId: 42 }
          : { projectId: overrides.projectId }
      );
      const testRunCasesFindUnique = vi.fn().mockResolvedValue(
        overrides?.caseName === undefined
          ? { repositoryCase: { name: "Login smoke test" } }
          : { repositoryCase: { name: overrides.caseName } }
      );
      return {
        client: {
          testRuns: { findUnique: testRunsFindUnique },
          testRunCases: { findUnique: testRunCasesFindUnique },
        },
        testRunsFindUnique,
        testRunCasesFindUnique,
      };
    }

    it("resolves projectId from the run and entityName from the test case", async () => {
      const { client } = makeClient();
      const scope = await resolveTestRunResultAuditScope(client, {
        testRunId: 7,
        testRunCaseId: 99,
      });
      expect(scope).toEqual({
        projectId: 42,
        entityName: "Login smoke test",
      });
    });

    it("looks the case name up through repositoryCase (deep relation)", async () => {
      const { client, testRunCasesFindUnique } = makeClient();
      await resolveTestRunResultAuditScope(client, {
        testRunId: 7,
        testRunCaseId: 99,
      });
      expect(testRunCasesFindUnique).toHaveBeenCalledWith({
        where: { id: 99 },
        select: { repositoryCase: { select: { name: true } } },
      });
    });

    it("skips the lookups and yields undefined when foreign keys are absent", async () => {
      const { client, testRunsFindUnique, testRunCasesFindUnique } =
        makeClient();
      const scope = await resolveTestRunResultAuditScope(client, {});
      expect(scope).toEqual({ projectId: undefined, entityName: undefined });
      expect(testRunsFindUnique).not.toHaveBeenCalled();
      expect(testRunCasesFindUnique).not.toHaveBeenCalled();
    });

    it("tolerates a missing run or unnamed case", async () => {
      const { client } = makeClient({ projectId: null, caseName: null });
      const scope = await resolveTestRunResultAuditScope(client, {
        testRunId: 7,
        testRunCaseId: 99,
      });
      expect(scope).toEqual({ projectId: undefined, entityName: undefined });
    });
  });

  describe("captureAuditEvent", () => {
    it("should add an event to the queue", async () => {
      const event: AuditEvent = {
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: "123",
        entityName: "Test Case",
        projectId: 1,
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event,
          context: expect.objectContaining({
            userId: "context-user-123",
          }),
          queuedAt: expect.any(String),
        }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^CREATE-RepositoryCases-123-\d+$/),
        })
      );
      // D-18: assert complete actor context on the queued row (SC#4).
      expectLastQueuedRowComplete(mocks.mockQueue.add);
    });

    it("should log warning when queue is not available", async () => {
      const { getAuditLogQueue } = await import("../queues");
      vi.mocked(getAuditLogQueue).mockReturnValueOnce(null);

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const event: AuditEvent = {
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: "123",
      };

      await captureAuditEvent(event);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[AuditLog] Queue not available, logging to console:",
        expect.objectContaining({
          action: "CREATE",
          entityType: "RepositoryCases",
        })
      );

      consoleWarnSpy.mockRestore();
    });

    it("should handle queue errors gracefully with structured payload", async () => {
      const error = new Error("Generic queue connection failure");
      mocks.mockQueue.add.mockRejectedValue(error);

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const event: AuditEvent = {
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: "123",
      };

      // Should not throw (Phase 63 D-02 — helpers never propagate)
      await captureAuditEvent(event);

      // Phase 63 D-07/D-08: structured payload, not raw error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AuditLog] Failed to queue audit event:",
        expect.objectContaining({
          action: "CREATE",
          entityType: "RepositoryCases",
          entityId: "123",
          userId: "context-user-123",
          requestId: "req-default",
          errorName: "Error",
          errorMessage: "Generic queue connection failure",
        })
      );

      // Phase 63 D-10: stack traces must NOT be in the payload
      const payload = consoleErrorSpy.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(payload).not.toHaveProperty("stack");

      consoleErrorSpy.mockRestore();
    });

    it("should redact sensitive values from enqueue-failure error messages (D-19)", async () => {
      // Override context requestId so we can assert it surfaces in the payload
      auditContextMocks.currentContext = {
        userId: "u1",
        userEmail: "u@e.com",
        userName: "U",
        ipAddress: "1.1.1.1",
        userAgent: "UA",
        requestId: "req-abc-123",
      };

      // Simulate a BullMQ error that echoes a serialized payload containing
      // 2FA secrets + password — the exact CR-01 regression class we defend
      // against (D-09).
      const secretBearingError = new Error(
        'BullMQ serialization failure: {"twoFactorSecret":"ENCRYPTED_TOTP_SEED_XYZ","password":"hunter2"}'
      );
      mocks.mockQueue.add.mockRejectedValue(secretBearingError);

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await captureAuditEvent({
        action: "TWO_FACTOR_ENABLED",
        entityType: "User",
        entityId: "u1",
        userId: "u1",
      });

      // All 7 required fields present in structured payload (D-08)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AuditLog] Failed to queue audit event:",
        expect.objectContaining({
          action: "TWO_FACTOR_ENABLED",
          entityType: "User",
          entityId: "u1",
          userId: "u1",
          requestId: "req-abc-123",
          errorName: "Error",
        })
      );

      // Redaction succeeded (D-09) — secrets gone, [REDACTED] present
      const payload = consoleErrorSpy.mock.calls[0][1] as {
        errorMessage: string;
      };
      expect(payload.errorMessage).toContain("[REDACTED]");
      expect(payload.errorMessage).not.toContain("ENCRYPTED_TOTP_SEED_XYZ");
      expect(payload.errorMessage).not.toContain("hunter2");

      // No stack traces (D-10)
      expect(payload).not.toHaveProperty("stack");

      // Restore default context for downstream tests
      consoleErrorSpy.mockRestore();
      auditContextMocks.currentContext = {
        userId: "context-user-123",
        userEmail: "context@example.com",
        userName: "Context User",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        requestId: "req-default",
      };
    });

    it("captureAuditEvent merges context.systemReason into event.metadata when present", async () => {
      // Override ALS mock to include systemReason (Phase 64 W5 Option A).
      auditContextMocks.currentContext = {
        userId: "__system__",
        userEmail: "",
        userName: "",
        ipAddress: "",
        userAgent: "",
        requestId: "req-scheduled-1",
        systemReason: "scheduled:test-rollup",
      } as unknown as typeof auditContextMocks.currentContext;

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c1",
        // event.metadata omitted on purpose
      });

      expect(mocks.mockQueue.add).toHaveBeenCalledTimes(1);
      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({
        systemReason: "scheduled:test-rollup",
      });

      // Restore default context
      auditContextMocks.currentContext = {
        userId: "context-user-123",
        userEmail: "context@example.com",
        userName: "Context User",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        requestId: "req-default",
      };
    });

    it("captureAuditEvent preserves caller-explicit metadata.systemReason over ALS", async () => {
      // Caller-explicit event.metadata.systemReason must win (Phase 64 W5).
      auditContextMocks.currentContext = {
        userId: "__system__",
        userEmail: "",
        userName: "",
        ipAddress: "",
        userAgent: "",
        requestId: "req-scheduled-2",
        systemReason: "scheduled:als-value",
      } as unknown as typeof auditContextMocks.currentContext;

      mocks.mockQueue.add.mockResolvedValue({ id: "job-2" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c1",
        metadata: { systemReason: "explicit:event-value" },
      });

      expect(mocks.mockQueue.add).toHaveBeenCalledTimes(1);
      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata.systemReason).toBe("explicit:event-value");

      // Restore default context
      auditContextMocks.currentContext = {
        userId: "context-user-123",
        userEmail: "context@example.com",
        userName: "Context User",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        requestId: "req-default",
      };
    });
  });

  describe("captureAuditEvent metadata.source from tokenScopes", () => {
    const DEFAULT_CONTEXT = {
      userId: "context-user-123",
      userEmail: "context@example.com",
      userName: "Context User",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      requestId: "req-default",
    };

    function setContext(extra: Record<string, unknown>) {
      auditContextMocks.currentContext = {
        ...DEFAULT_CONTEXT,
        ...extra,
      } as unknown as typeof auditContextMocks.currentContext;
    }

    function restoreContext() {
      auditContextMocks.currentContext = { ...DEFAULT_CONTEXT };
    }

    it("derives source: 'mcp' when tokenScopes includes client:mcp", async () => {
      setContext({ tokenScopes: ["client:mcp"] });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-mcp" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c1",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({ source: "mcp" });

      restoreContext();
    });

    it("derives source: 'api' when tokenScopes is non-empty without client:mcp", async () => {
      setContext({ tokenScopes: ["mode:read"] });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-api" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c2",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({ source: "api" });

      restoreContext();
    });

    it("derives source: 'mcp' when tokenScopes includes both mode:read and client:mcp", async () => {
      setContext({ tokenScopes: ["mode:read", "client:mcp"] });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-mcp-rw" });

      await captureAuditEvent({
        action: "UPDATE",
        entityType: "TestCase",
        entityId: "c3",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({ source: "mcp" });

      restoreContext();
    });

    it("emits NO source key when tokenScopes is empty []", async () => {
      setContext({ tokenScopes: [] });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-empty" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c4",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      // Empty scopes is the existing-token default — preserve absence of source.
      const md = (jobData.event.metadata ?? {}) as Record<string, unknown>;
      expect(md).not.toHaveProperty("source");

      restoreContext();
    });

    it("emits NO source key for session-authed requests (tokenScopes undefined)", async () => {
      // Default context has no tokenScopes — simulate cookie/session auth.
      restoreContext();
      mocks.mockQueue.add.mockResolvedValue({ id: "j-session" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c5",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      const md = (jobData.event.metadata ?? {}) as Record<
        string,
        unknown
      > | null;
      // Either metadata is absent entirely, or it has no `source` key.
      if (md) {
        expect(md).not.toHaveProperty("source");
      }
    });

    it("preserves caller-explicit metadata.source over derived value (T-05-03)", async () => {
      setContext({ tokenScopes: ["client:mcp"] });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-explicit" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c6",
        metadata: { source: "import" },
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      // Caller-explicit value wins — derived "mcp" must not override "import".
      expect(jobData.event.metadata.source).toBe("import");

      restoreContext();
    });

    it("merges derived source AND ALS systemReason when both apply", async () => {
      setContext({
        tokenScopes: ["client:mcp"],
        systemReason: "scheduled:rollup",
      });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-both" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "TestCase",
        entityId: "c7",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({
        source: "mcp",
        systemReason: "scheduled:rollup",
      });

      restoreContext();
    });

    it("derives source: 'scim' when context.scimTokenId is set", async () => {
      setContext({ scimTokenId: "tok_abc123" });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-scim" });

      await captureAuditEvent({
        action: "CREATE",
        entityType: "User",
        entityId: "u1",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({ source: "scim" });

      restoreContext();
    });

    it("prefers scim over scope-derived attribution when both are set", async () => {
      // Defense-in-depth: a request shouldn't carry BOTH a SCIM bearer and an
      // ApiToken in practice (the two auth surfaces are mutually exclusive at
      // the route layer), but if a future refactor reorders the ternary, this
      // test guards against silent regression of Phase 7 audit attribution.
      setContext({
        scimTokenId: "tok_priority",
        tokenScopes: ["client:mcp"],
      });
      mocks.mockQueue.add.mockResolvedValue({ id: "j-scim-priority" });

      await captureAuditEvent({
        action: "UPDATE",
        entityType: "User",
        entityId: "u2",
      });

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.event.metadata).toMatchObject({ source: "scim" });

      restoreContext();
    });
  });

  describe("captureAuditEvent tenantId handling", () => {
    it("should use explicit tenantId from event when provided", async () => {
      const event: AuditEvent = {
        action: "CREATE",
        entityType: "Issue",
        entityId: "456",
        tenantId: "tenant-from-worker",
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          tenantId: "tenant-from-worker",
        }),
        expect.any(Object)
      );
    });

    it("should fall back to getCurrentTenantId when no explicit tenantId", async () => {
      const multiTenant = await import("../multiTenantPrisma");
      vi.mocked(multiTenant.getCurrentTenantId).mockReturnValue(
        "tenant-from-env"
      );

      const event: AuditEvent = {
        action: "CREATE",
        entityType: "Issue",
        entityId: "456",
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.tenantId).toBe("tenant-from-env");

      // Restore default
      vi.mocked(multiTenant.getCurrentTenantId).mockReturnValue(undefined);
    });

    it("should prefer explicit tenantId over getCurrentTenantId", async () => {
      const multiTenant = await import("../multiTenantPrisma");
      vi.mocked(multiTenant.getCurrentTenantId).mockReturnValue(
        "tenant-from-env"
      );

      const event: AuditEvent = {
        action: "UPDATE",
        entityType: "Issue",
        entityId: "789",
        tenantId: "tenant-explicit",
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      const jobData = mocks.mockQueue.add.mock.calls[0][1];
      expect(jobData.tenantId).toBe("tenant-explicit");

      // Restore default
      vi.mocked(multiTenant.getCurrentTenantId).mockReturnValue(undefined);
    });

    it("should result in undefined tenantId when neither provided", async () => {
      const event: AuditEvent = {
        action: "CREATE",
        entityType: "Issue",
        entityId: "456",
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          tenantId: undefined,
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditCreate", () => {
    it("should capture CREATE event with entity details", async () => {
      const entity = {
        id: 123,
        name: "New Test Case",
        projectId: 1,
        stateId: 1,
      };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditCreate("RepositoryCases", entity, 1);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "CREATE",
            entityType: "RepositoryCases",
            entityId: "123",
            entityName: "New Test Case",
            projectId: 1,
            changes: expect.objectContaining({
              name: { old: null, new: "New Test Case" },
            }),
          }),
        }),
        expect.any(Object)
      );
      // D-18 standing enforcement
      expectLastQueuedRowComplete(mocks.mockQueue.add);
    });
  });

  describe("auditUpdate", () => {
    it("should capture UPDATE event with changes", async () => {
      const oldEntity = { id: 123, name: "Old Name", stateId: 1 };
      const newEntity = { id: 123, name: "New Name", stateId: 2 };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditUpdate("RepositoryCases", oldEntity, newEntity, 1);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "UPDATE",
            entityType: "RepositoryCases",
            entityId: "123",
            changes: expect.objectContaining({
              name: { old: "Old Name", new: "New Name" },
              stateId: { old: 1, new: 2 },
            }),
          }),
        }),
        expect.any(Object)
      );
    });

    it("should not log when there are no changes", async () => {
      const entity = { id: 123, name: "Same Name" };

      await auditUpdate("RepositoryCases", entity, { ...entity }, 1);

      expect(mocks.mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("auditDelete", () => {
    it("should capture DELETE event", async () => {
      const entity = { id: 123, name: "Deleted Case", projectId: 1 };

      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditDelete("RepositoryCases", entity, 1);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "DELETE",
            entityType: "RepositoryCases",
            entityId: "123",
            entityName: "Deleted Case",
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditRoleChange", () => {
    it("should capture ROLE_CHANGED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditRoleChange("user-123", "USER", "ADMIN", "test@example.com");

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "ROLE_CHANGED",
            entityType: "User",
            entityId: "user-123",
            entityName: "test@example.com",
            changes: {
              access: { old: "USER", new: "ADMIN" },
            },
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditAuthEvent", () => {
    it("should capture LOGIN event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditAuthEvent("LOGIN", "user-123", "test@example.com", {
        method: "password",
      });

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "LOGIN",
            entityType: "User",
            entityId: "user-123",
            entityName: "test@example.com",
            userId: "user-123",
            userEmail: "test@example.com",
            metadata: { method: "password" },
          }),
        }),
        expect.any(Object)
      );
    });

    it("should capture LOGIN_FAILED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditAuthEvent("LOGIN_FAILED", null, "test@example.com", {
        reason: "invalid_password",
      });

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "LOGIN_FAILED",
            entityType: "User",
            entityId: "test@example.com",
            metadata: { reason: "invalid_password" },
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditPasswordChange", () => {
    it("should capture PASSWORD_CHANGED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditPasswordChange("user-123", "test@example.com", false);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "PASSWORD_CHANGED",
            entityType: "User",
            entityId: "user-123",
          }),
        }),
        expect.any(Object)
      );
    });

    it("should capture PASSWORD_RESET event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditPasswordChange("user-123", "test@example.com", true);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "PASSWORD_RESET",
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditSystemConfigChange", () => {
    it("should capture SYSTEM_CONFIG_CHANGED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditSystemConfigChange("MAX_UPLOAD_SIZE", "10MB", "50MB");

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "SYSTEM_CONFIG_CHANGED",
            entityType: "AppConfig",
            entityId: "MAX_UPLOAD_SIZE",
            changes: {
              value: { old: "10MB", new: "50MB" },
            },
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditSsoConfigChange", () => {
    it("should capture SSO_CONFIG_CHANGED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      const ssoProvider = { id: "sso-1", type: "SAML" };

      await auditSsoConfigChange("CREATE", ssoProvider);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "SSO_CONFIG_CHANGED",
            entityType: "SsoProvider",
            entityId: "sso-1",
            entityName: "SAML",
            metadata: { originalAction: "CREATE" },
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditDataExport", () => {
    it("should capture DATA_EXPORTED event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditDataExport("CSV", "TestRuns", {
        projectId: 1,
        status: "PASSED",
      });

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "DATA_EXPORTED",
            entityType: "TestRuns",
            entityId: "CSV",
            entityName: "TestRuns Export",
            metadata: expect.objectContaining({
              exportType: "CSV",
              filters: { projectId: 1, status: "PASSED" },
            }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditBulkCreate", () => {
    it("should capture BULK_CREATE event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditBulkCreate("RepositoryCases", 50, 1, { source: "import" });

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "BULK_CREATE",
            entityType: "RepositoryCases",
            entityName: "50 RepositoryCases",
            projectId: 1,
            metadata: expect.objectContaining({
              count: 50,
              source: "import",
            }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditBulkUpdate", () => {
    it("should capture BULK_UPDATE event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      const where = { projectId: 1, stateId: 1 };

      await auditBulkUpdate("RepositoryCases", 25, where, 1);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "BULK_UPDATE",
            entityType: "RepositoryCases",
            entityName: "25 RepositoryCases",
            metadata: expect.objectContaining({
              count: 25,
              where,
            }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditBulkDelete", () => {
    it("should capture BULK_DELETE event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      const where = { projectId: 1, isDeleted: true };

      await auditBulkDelete("RepositoryCases", 10, where, 1);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "BULK_DELETE",
            entityType: "RepositoryCases",
            entityName: "10 RepositoryCases",
            metadata: expect.objectContaining({
              count: 10,
              where,
            }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditPermissionGrant", () => {
    it("should capture PERMISSION_GRANT event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      const permission = { id: 1, userId: "user-123", projectId: 10 };

      await auditPermissionGrant("UserProjectPermission", permission, 10);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "PERMISSION_GRANT",
            entityType: "UserProjectPermission",
            projectId: 10,
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe("auditPermissionRevoke", () => {
    it("should capture PERMISSION_REVOKE event", async () => {
      mocks.mockQueue.add.mockResolvedValue({ id: "job-1" });

      const permission = { id: 1, userId: "user-123", projectId: 10 };

      await auditPermissionRevoke("UserProjectPermission", permission, 10);

      expect(mocks.mockQueue.add).toHaveBeenCalledWith(
        "audit-event",
        expect.objectContaining({
          event: expect.objectContaining({
            action: "PERMISSION_REVOKE",
            entityType: "UserProjectPermission",
            projectId: 10,
          }),
        }),
        expect.any(Object)
      );
    });
  });
});

// D-16: Phase 1 lands the five new AuditAction enum values
// (REVIEW_REQUESTED, REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED,
// REVIEW_REJECTED, REVIEW_CANCELLED) and verifies they round-trip
// through captureAuditEvent's type signature. No production capture
// sites are wired in Phase 1 — capture sites are Phase 3 work
// (AUDIT-01/02/03 against the ReviewRequest create/decide/cancel paths).
describe("captureAuditEvent — review enum acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts all five new AuditAction review enum values without throwing", async () => {
    const reviewActions: AuditAction[] = [
      AuditAction.REVIEW_REQUESTED,
      AuditAction.REVIEW_APPROVED,
      AuditAction.REVIEW_CHANGES_REQUESTED,
      AuditAction.REVIEW_REJECTED,
      AuditAction.REVIEW_CANCELLED,
    ];

    mocks.mockQueue.add.mockResolvedValue({ id: "review-enum-job" });

    for (const action of reviewActions) {
      const event: AuditEvent = {
        action,
        entityType: "ReviewRequest",
        entityId: "review-1",
      };

      await expect(captureAuditEvent(event)).resolves.toBeUndefined();
    }

    // All five enum values reached the queue mock — proves the regenerated
    // @prisma/client AuditAction includes the five new members AND that
    // captureAuditEvent's surface accepts them.
    expect(mocks.mockQueue.add).toHaveBeenCalledTimes(reviewActions.length);
    const queuedActions = mocks.mockQueue.add.mock.calls.map(
      (call) => (call[1] as { event: AuditEvent }).event.action
    );
    expect(queuedActions).toEqual(reviewActions);
  });
});
