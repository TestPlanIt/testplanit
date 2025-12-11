import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  captureAuditEvent,
  auditCreate,
  auditUpdate,
  auditDelete,
  auditRoleChange,
  auditPermissionGrant,
  auditPermissionRevoke,
  auditAuthEvent,
  auditPasswordChange,
  auditSystemConfigChange,
  auditSsoConfigChange,
  auditDataExport,
  auditBulkCreate,
  auditBulkUpdate,
  auditBulkDelete,
  calculateDiff,
  extractEntityName,
  type AuditEvent,
} from "./auditLog";

// Mock the queue
const mockQueue = {
  add: vi.fn(),
};

vi.mock("../queues", () => ({
  getAuditLogQueue: vi.fn(() => mockQueue),
}));

// Mock audit context
vi.mock("../auditContext", () => ({
  getAuditContext: vi.fn(() => ({
    userId: "context-user-123",
    userEmail: "context@example.com",
    userName: "Context User",
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0",
  })),
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
      const entity = { id: "user-1", email: "test@example.com", name: "Test User" };
      expect(extractEntityName("User", entity)).toBe("test@example.com");
    });

    it("should extract name for RepositoryCases entity", () => {
      const entity = { id: 1, name: "Test Case Name", title: "Test Case Title" };
      expect(extractEntityName("RepositoryCases", entity)).toBe("Test Case Name");
    });

    it("should extract name for Projects entity", () => {
      const entity = { id: 1, name: "My Project" };
      expect(extractEntityName("Projects", entity)).toBe("My Project");
    });

    it("should extract name for ApiToken entity", () => {
      const entity = { id: "token-1", name: "CI Token", tokenPrefix: "tpi_abc" };
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
      expect(extractEntityName("UserProjectPermission", entity)).toBe("user-1:10");
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

      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await captureAuditEvent(event);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
    });

    it("should log warning when queue is not available", async () => {
      const { getAuditLogQueue } = await import("../queues");
      vi.mocked(getAuditLogQueue).mockReturnValueOnce(null);

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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

    it("should handle queue errors gracefully", async () => {
      const error = new Error("Queue error");
      mockQueue.add.mockRejectedValue(error);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const event: AuditEvent = {
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: "123",
      };

      // Should not throw
      await captureAuditEvent(event);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AuditLog] Failed to queue audit event:",
        error
      );

      consoleErrorSpy.mockRestore();
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

      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditCreate("RepositoryCases", entity, 1);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
    });
  });

  describe("auditUpdate", () => {
    it("should capture UPDATE event with changes", async () => {
      const oldEntity = { id: 123, name: "Old Name", stateId: 1 };
      const newEntity = { id: 123, name: "New Name", stateId: 2 };

      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditUpdate("RepositoryCases", oldEntity, newEntity, 1);

      expect(mockQueue.add).toHaveBeenCalledWith(
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

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("auditDelete", () => {
    it("should capture DELETE event", async () => {
      const entity = { id: 123, name: "Deleted Case", projectId: 1 };

      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditDelete("RepositoryCases", entity, 1);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditRoleChange("user-123", "USER", "ADMIN", "test@example.com");

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditAuthEvent("LOGIN", "user-123", "test@example.com", {
        method: "password",
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditAuthEvent("LOGIN_FAILED", null, "test@example.com", {
        reason: "invalid_password",
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditPasswordChange("user-123", "test@example.com", false);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditPasswordChange("user-123", "test@example.com", true);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditSystemConfigChange("MAX_UPLOAD_SIZE", "10MB", "50MB");

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const ssoProvider = { id: "sso-1", type: "SAML" };

      await auditSsoConfigChange("CREATE", ssoProvider);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditDataExport("CSV", "TestRuns", { projectId: 1, status: "PASSED" });

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      await auditBulkCreate("RepositoryCases", 50, 1, { source: "import" });

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const where = { projectId: 1, stateId: 1 };

      await auditBulkUpdate("RepositoryCases", 25, where, 1);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const where = { projectId: 1, isDeleted: true };

      await auditBulkDelete("RepositoryCases", 10, where, 1);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const permission = { id: 1, userId: "user-123", projectId: 10 };

      await auditPermissionGrant("UserProjectPermission", permission, 10);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const permission = { id: 1, userId: "user-123", projectId: 10 };

      await auditPermissionRevoke("UserProjectPermission", permission, 10);

      expect(mockQueue.add).toHaveBeenCalledWith(
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
