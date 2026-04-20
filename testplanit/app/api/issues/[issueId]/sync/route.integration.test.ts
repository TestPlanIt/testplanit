import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted spies / fixtures -------------------------------------------------

const {
  mockFindUnique,
  mockPerformIssueRefresh,
  queueAddSpy,
  mockGetSyncQueue,
  mockGetCurrentTenantId,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockPerformIssueRefresh: vi.fn(),
  queueAddSpy: vi.fn(async () => ({ id: "job-integration-abc" })),
  mockGetSyncQueue: vi.fn(),
  mockGetCurrentTenantId: vi.fn(() => "tenant-test"),
}));

// Mocks --------------------------------------------------------------------
// Note: intentionally NO mock on @/lib/integrations/services/SyncService
// that replaces queueIssueRefresh. The whole point of this file is to
// exercise the REAL queueIssueRefresh which transitively calls
// enqueueWithAuditContext. We DO mock the queue transport and Prisma so
// the test is hermetic (CLAUDE.md E2E rules apply to Playwright, not
// vitest; vitest unit/integration tests stay in-process).

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    issue: { findUnique: mockFindUnique },
  },
}));

// SyncService imports getSyncQueue from lib/queues and getCurrentTenantId
// from lib/multiTenantPrisma. Mock those surfaces so no real Valkey
// connection is attempted.
vi.mock("@/lib/queues", () => ({
  getSyncQueue: () => mockGetSyncQueue(),
}));

vi.mock("~/lib/queues", () => ({
  getSyncQueue: () => mockGetSyncQueue(),
}));

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: () => mockGetCurrentTenantId(),
}));

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: () => mockGetCurrentTenantId(),
}));

// Also stub performIssueRefresh at the module level so the route's
// `await syncService.performIssueRefresh(...)` call returns success
// without actually hitting an external system. This is a targeted mock
// on a SIBLING method of the one under test (queueIssueRefresh), which
// is fine — we are specifically testing the enqueue path, not the
// perform path.
vi.mock("@/lib/integrations/services/SyncService", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integrations/services/SyncService")
  >("@/lib/integrations/services/SyncService");
  return {
    ...actual,
    syncService: {
      ...actual.syncService,
      // Keep REAL queueIssueRefresh — this is the whole point of the test.
      queueIssueRefresh: actual.syncService.queueIssueRefresh.bind(
        actual.syncService,
      ),
      // Stub OTHER methods called by the route.
      performIssueRefresh: mockPerformIssueRefresh,
    },
  };
});

import { getServerSession } from "next-auth";
import { updateAuditContext } from "~/lib/auditContext";
import { expectAuditRowComplete } from "~/lib/testing/auditAssertions";

// Import the route AFTER mocks are set up.
import { POST } from "./route";

// Fixtures -----------------------------------------------------------------

const mockIssue = {
  id: 1,
  externalId: "PROJ-42",
  integrationId: 10,
  integration: { id: 10, name: "JIRA", provider: "JIRA" },
};

const mockUpdatedIssue = {
  ...mockIssue,
  project: { id: 100, name: "My Project", iconUrl: null },
};

const createRequest = (): NextRequest =>
  new NextRequest("http://localhost/api/issues/1/sync", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.9",
      "user-agent": "integration-test-agent/1.0",
    },
  });

const params = (issueId: string = "1") => ({
  params: Promise.resolve({ issueId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default queue mock: return a pretend Queue with an add() spy.
  mockGetSyncQueue.mockReturnValue({ add: queueAddSpy });
  mockFindUnique
    .mockResolvedValueOnce(mockIssue)
    .mockResolvedValueOnce(mockUpdatedIssue);
  mockPerformIssueRefresh.mockResolvedValue({ success: true });
  // Simulate the NextAuth session callback enrichment: when
  // getServerSession resolves, the real callback calls
  // updateAuditContext({ userId, userEmail, userName }). Mirror that
  // here so ALS gets identity populated inside the wrapped route.
  vi.mocked(getServerSession).mockImplementation(async () => {
    updateAuditContext({
      userId: "user-integration",
      userEmail: "integration@example.com",
      userName: "Integration User",
    });
    return {
      user: {
        id: "user-integration",
        email: "integration@example.com",
        name: "Integration User",
      },
    } as any;
  });
});

describe("POST /api/issues/[issueId]/sync — real-path integration (CR-01 regression guard)", () => {
  it("stamps complete actor context on the enqueued job payload when wrapped with withAuditContext", async () => {
    const response = await POST(createRequest(), params());
    expect(response.status).toBe(200);

    // Real queueIssueRefresh ran → real enqueueWithAuditContext ran →
    // queue.add was called with a payload that has actorContext stamped
    // from the ALS frame that withAuditContext populated + the session
    // callback enriched.
    expect(queueAddSpy).toHaveBeenCalledTimes(1);
    const firstCall = queueAddSpy.mock.calls[0] as unknown as [string, unknown];
    const [jobName, payload] = firstCall;
    expect(jobName).toBe("refresh-issue");

    const actorContext = (payload as { actorContext: unknown })
      .actorContext as {
      userId?: string;
      userEmail?: string;
      userName?: string;
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
    };

    // SC#4 gate: the stamped actorContext is complete.
    expectAuditRowComplete({
      userId: actorContext.userId,
      userEmail: actorContext.userEmail,
      userName: actorContext.userName,
      ipAddress: actorContext.ipAddress,
      userAgent: actorContext.userAgent,
      requestId: actorContext.requestId,
    });

    // Spot-check the identity fields came from the session-callback
    // enrichment simulation in beforeEach.
    expect(actorContext.userId).toBe("user-integration");
    expect(actorContext.ipAddress).toBe("203.0.113.9");
    expect(actorContext.userAgent).toBe("integration-test-agent/1.0");
  });

  it("returns 401 and does NOT enqueue when session is absent", async () => {
    vi.mocked(getServerSession).mockImplementation(async () => null);

    const response = await POST(createRequest(), params());
    expect(response.status).toBe(401);
    expect(queueAddSpy).not.toHaveBeenCalled();
  });
});
