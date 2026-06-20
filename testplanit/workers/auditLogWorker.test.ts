import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectAuditRowComplete } from "../lib/testing/auditAssertions";
import type { AuditLogJobData } from "../lib/services/auditLog";

/**
 * D-18 standing enforcement helper. Reconstructs an AuditRowLike from
 * the latest prisma.auditLog.create call and asserts the six actor
 * fields via expectAuditRowComplete. The worker flattens
 * ipAddress/userAgent/requestId into metadata; this helper lifts them
 * back to the row's top level for the completeness assertion.
 */
function expectLastCreatedAuditRowComplete(
  createMock: ReturnType<typeof vi.fn>,
  opts?: { allowSystem?: boolean }
): void {
  const calls = createMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const args = calls[calls.length - 1][0] as {
    data: {
      userId: string | null;
      userEmail: string | null;
      userName: string | null;
      metadata: Record<string, unknown> | null | undefined;
    };
  };
  const md = (args.data.metadata ?? {}) as Record<string, unknown>;
  expectAuditRowComplete(
    {
      userId: args.data.userId,
      userEmail: args.data.userEmail,
      userName: args.data.userName,
      ipAddress: (md.ipAddress as string | null | undefined) ?? null,
      userAgent: (md.userAgent as string | null | undefined) ?? null,
      requestId: (md.requestId as string | null | undefined) ?? null,
      metadata: md,
    },
    opts
  );
}

// Create mock prisma instance
const mockPrisma = {
  auditLog: {
    create: vi.fn(),
  },
  projects: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  // Delegates re-read by the post-commit scope backfill in tests below.
  sessions: {
    findUnique: vi.fn(),
  },
  testRunCases: {
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
    // By default no backfill match; tests that exercise the actor backfill
    // override this.
    mockPrisma.user.findUnique.mockResolvedValue(null);
    // Scope-backfill delegates resolve nothing unless a test overrides them.
    mockPrisma.sessions.findUnique.mockResolvedValue(null);
    mockPrisma.testRunCases.findUnique.mockResolvedValue(null);
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
          operationId: null,
        },
      });
      // D-18 standing enforcement (SC#4): six actor fields on persisted row.
      expectLastCreatedAuditRowComplete(mockPrisma.auditLog.create);
    });

    it("stamps operationId from the context so aggregate events group with their CDC detail rows", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "BULK_UPDATE",
          entityType: "RepositoryCases",
          entityId: "bulk",
          entityName: "3 RepositoryCases",
          projectId: 1,
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
          userName: "Test User",
          operationId: "ff031e6b-0000-4000-8000-000000000000",
        },
        queuedAt: new Date().toISOString(),
      };
      mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-2" });
      const { processor } = await import("./auditLogWorker");
      await processor({
        id: "job-bulk",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "BULK_UPDATE",
          operationId: "ff031e6b-0000-4000-8000-000000000000",
        }),
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

    it("should backfill userEmail/userName from the user record when only userId is on the event", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "backfilled@example.com",
        name: "Backfilled User",
      });

      const jobData: AuditLogJobData = {
        event: {
          action: "UPDATE",
          entityType: "CaseSharedDataSetAssignment",
          entityId: "92",
          projectId: 1,
          userId: "user-only-id",
          metadata: { caseId: 106780, sharedDataSetId: 396 },
        },
        // No request-level context (route not wrapped in withAuditContext).
        context: null,
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-bf-1" });

      const { processor } = await import("./auditLogWorker");

      await processor({
        id: "job-bf-1",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-only-id" },
        select: { email: true, name: true },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-only-id",
          userEmail: "backfilled@example.com",
          userName: "Backfilled User",
        }),
      });
    });

    it("should not look up the user when email and name are already present", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "UPDATE",
          entityType: "RepositoryCases",
          entityId: "123",
          projectId: 1,
          changes: { name: { old: "a", new: "b" } },
        },
        context: {
          userId: "user-123",
          userEmail: "test@example.com",
          userName: "Test User",
        },
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-bf-2" });

      const { processor } = await import("./auditLogWorker");

      await processor({
        id: "job-bf-2",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should not look up the system sentinel actor", async () => {
      const { SYSTEM_ACTOR_ID } = await import("../lib/auditContextConstants");

      const jobData: AuditLogJobData = {
        event: {
          action: "UPDATE",
          entityType: "AppConfig",
          entityId: "some.key",
          userId: SYSTEM_ACTOR_ID,
          metadata: { systemReason: "scheduled-recompute" },
        },
        context: null,
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-bf-3" });

      const { processor } = await import("./auditLogWorker");

      await processor({
        id: "job-bf-3",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should still write the audit row when the actor backfill lookup fails", async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error("db down"));
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const jobData: AuditLogJobData = {
        event: {
          action: "DELETE",
          entityType: "CaseSharedDataSetAssignment",
          entityId: "92",
          projectId: 1,
          userId: "user-only-id",
        },
        context: null,
        queuedAt: new Date().toISOString(),
      };

      mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-bf-4" });

      const { processor } = await import("./auditLogWorker");

      await processor({
        id: "job-bf-4",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-only-id",
          userEmail: null,
          userName: null,
        }),
      });
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
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

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { processor } = await import("./auditLogWorker");

      const mockJob = {
        id: "job-129",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>;

      await expect(processor(mockJob)).rejects.toThrow(
        "Database connection failed"
      );

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

    it("should backfill a missing entityName and projectId from a committed re-read", async () => {
      // A ZenStack RPC create whose result was a partial `{ id }`: the event
      // reaches the worker with no name and no project scope.
      mockPrisma.sessions.findUnique.mockResolvedValue({
        id: 77,
        name: "Exploratory session",
        projectId: 4,
      });

      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "Sessions",
          entityId: "77",
        },
        context: { userId: "user-123", userEmail: "test@example.com" },
        queuedAt: new Date().toISOString(),
      };

      const { processor } = await import("./auditLogWorker");
      await processor({
        id: "job-bf1",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.sessions.findUnique).toHaveBeenCalledWith({
        where: { id: 77 },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "Sessions",
          entityId: "77",
          entityName: "Exploratory session",
          projectId: 4,
        }),
      });
    });

    it("should backfill projectId through a parent relation", async () => {
      // TestRunCases has no scalar projectId — it is scoped through its run.
      mockPrisma.testRunCases.findUnique.mockResolvedValue({
        id: 88,
        repositoryCase: { name: "Checkout flow" },
        testRun: { projectId: 6 },
      });

      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "TestRunCases",
          entityId: "88",
        },
        context: { userId: "user-123", userEmail: "test@example.com" },
        queuedAt: new Date().toISOString(),
      };

      const { processor } = await import("./auditLogWorker");
      await processor({
        id: "job-bf2",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.testRunCases.findUnique).toHaveBeenCalledWith({
        where: { id: 88 },
        include: {
          repositoryCase: { select: { name: true } },
          testRun: { select: { projectId: true } },
        },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "TestRunCases",
          entityId: "88",
          entityName: "Checkout flow",
          projectId: 6,
        }),
      });
    });

    it("should not re-read when name and projectId are already present", async () => {
      const jobData: AuditLogJobData = {
        event: {
          action: "UPDATE",
          entityType: "Sessions",
          entityId: "77",
          entityName: "Already named",
          projectId: 4,
        },
        context: { userId: "user-123", userEmail: "test@example.com" },
        queuedAt: new Date().toISOString(),
      };

      const { processor } = await import("./auditLogWorker");
      await processor({
        id: "job-bf3",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      expect(mockPrisma.sessions.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityName: "Already named",
          projectId: 4,
        }),
      });
    });

    it("should still write the audit row when the scope backfill lookup fails", async () => {
      mockPrisma.sessions.findUnique.mockRejectedValue(new Error("db down"));

      const jobData: AuditLogJobData = {
        event: {
          action: "CREATE",
          entityType: "Sessions",
          entityId: "77",
        },
        context: { userId: "user-123", userEmail: "test@example.com" },
        queuedAt: new Date().toISOString(),
      };

      const { processor } = await import("./auditLogWorker");
      await processor({
        id: "job-bf4",
        name: "audit-event",
        data: jobData,
      } as Job<AuditLogJobData>);

      // The re-read threw, but the row is still persisted with the gap intact.
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "Sessions",
          entityId: "77",
          entityName: null,
          projectId: null,
        }),
      });
    });
  });
});
