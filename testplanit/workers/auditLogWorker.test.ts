import { describe, it, expect, vi, beforeEach } from "vitest";
import { Job } from "bullmq";
import type { AuditLogJobData } from "../lib/services/auditLog";

// Create mock prisma instance
const mockPrisma = {
  auditLog: {
    create: vi.fn(),
  },
  projects: {
    findUnique: vi.fn(),
  },
  $disconnect: vi.fn(),
};

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock the multiTenantPrisma module to return our mock prisma client
vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

describe("AuditLogWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // By default, mock projects.findUnique to return a valid project
    mockPrisma.projects.findUnique.mockResolvedValue({ id: 1 });
  });

  describe("processor", () => {
    it("should create an audit log entry for a CREATE action", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Test Case 1",
          projectId: 1,
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
          userName: "Test User",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          requestId: "req-abc",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-1",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-123",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: "user-123",
          userEmail: "test@example.com",
          userName: "Test User",
          action: "CREATE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Test Case 1",
          changes: undefined,
          metadata: expect.objectContaining({
            ipAddress: "192.168.1.1",
            userAgent: "Mozilla/5.0",
            requestId: "req-abc",
            queuedAt: jobData.queuedAt,
            processedAt: expect.any(String),
          }),
          projectId: 1,
        },
      });
    });

    it("should create an audit log entry for an UPDATE action with changes", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "UPDATE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Test Case 1 Updated",
          projectId: 1,
          changes: {
            name: { old: "Test Case 1", new: "Test Case 1 Updated" },
            stateId: { old: 1, new: 2 },
          },
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
          userName: "Test User",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-2",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-124",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "UPDATE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Test Case 1 Updated",
          changes: {
            name: { old: "Test Case 1", new: "Test Case 1 Updated" },
            stateId: { old: 1, new: 2 },
          },
          projectId: 1,
        }),
      });
    });

    it("should create an audit log entry for a DELETE action", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "DELETE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Deleted Test Case",
          projectId: 1,
        },
        context: {
          userId: "user-123",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-3",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-125",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "DELETE",
          entityType: "RepositoryCases",
          entityId: "123",
          entityName: "Deleted Test Case",
          projectId: 1,
        }),
      });
    });

    it("should handle LOGIN action without project context", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "LOGIN",
          entityType: "User",
          entityId: "user-123",
          entityName: "test@example.com",
          userId: "user-123",
          userEmail: "test@example.com",
        },
        context: {
          ipAddress: "10.0.0.1",
          userAgent: "Chrome/120",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-4",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-126",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "LOGIN",
          entityType: "User",
          entityId: "user-123",
          entityName: "test@example.com",
          userId: "user-123",
          userEmail: "test@example.com",
          projectId: null,
          metadata: expect.objectContaining({
            ipAddress: "10.0.0.1",
            userAgent: "Chrome/120",
          }),
        }),
      });
    });

    it("should handle BULK_CREATE action with metadata", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "BULK_CREATE",
          entityType: "RepositoryCases",
          entityId: "bulk-1234567890",
          entityName: "50 RepositoryCases",
          projectId: 1,
          metadata: {
            count: 50,
          },
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-5",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-127",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "BULK_CREATE",
          entityType: "RepositoryCases",
          entityId: "bulk-1234567890",
          entityName: "50 RepositoryCases",
          metadata: expect.objectContaining({
            count: 50,
          }),
        }),
      });
    });

    it("should use event user info when context is missing", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "Projects",
          entityId: "456",
          entityName: "New Project",
          userId: "event-user-id",
          userEmail: "event@example.com",
          userName: "Event User",
        },
        context: null,
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-6",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-128",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "event-user-id",
          userEmail: "event@example.com",
          userName: "Event User",
        }),
      });
    });

    it("should handle database errors and rethrow", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "RepositoryCases",
          entityId: "123",
        },
        context: null,
        queuedAt: new Date().toISOString(),
      };

      const dbError = new Error("Database connection failed");
      mockPrisma.auditLog.create.mockRejectedValue(dbError);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-129",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await expect(processor(mockJob)).rejects.toThrow("Database connection failed");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AuditLogWorker] Failed to create audit log:",
        dbError
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle PERMISSION_GRANT action", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "PERMISSION_GRANT",
          entityType: "UserProjectPermission",
          entityId: "user-123:project-456",
          projectId: 456,
          changes: {
            userId: { old: null, new: "user-123" },
            projectId: { old: null, new: 456 },
            accessType: { old: null, new: "FULL_ACCESS" },
          },
        },
        context: {
          userId: "admin-user",
          userEmail: "admin@example.com",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-7",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-130",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "PERMISSION_GRANT",
          entityType: "UserProjectPermission",
          projectId: 456,
        }),
      });
    });

    it("should handle SSO_CONFIG_CHANGED action", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "SSO_CONFIG_CHANGED",
          entityType: "SsoProvider",
          entityId: "sso-1",
          entityName: "SAML",
          metadata: {
            originalAction: "UPDATE",
          },
        },
        context: {
          userId: "admin-user",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-8",
        ...jobData.event,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-131",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "SSO_CONFIG_CHANGED",
          entityType: "SsoProvider",
          entityId: "sso-1",
          entityName: "SAML",
          metadata: expect.objectContaining({
            originalAction: "UPDATE",
          }),
        }),
      });
    });

    it("should handle non-existent project gracefully", async () => {
      // Mock project not found
      mockPrisma.projects.findUnique.mockResolvedValue(null);

      const jobData: AuditLogJobData = {
        event: {
          action: "BULK_CREATE",
          entityType: "RepositoryCases",
          entityId: "bulk-9999",
          entityName: "10 RepositoryCases",
          projectId: 999, // Non-existent project
          metadata: {
            count: 10,
          },
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: "audit-9",
        ...jobData.event,
        projectId: null,
      });

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-132",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await processor(mockJob);

      // Should have checked if project exists
      expect(mockPrisma.projects.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
        select: { id: true },
      });

      // Should create audit log without projectId but with originalProjectId in metadata
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "BULK_CREATE",
          entityType: "RepositoryCases",
          entityId: "bulk-9999",
          projectId: null,
          metadata: expect.objectContaining({
            count: 10,
            originalProjectId: 999,
          }),
        }),
      });
    });
  });
});
