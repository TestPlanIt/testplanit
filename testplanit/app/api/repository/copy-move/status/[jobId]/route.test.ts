import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/lib/queues", () => ({
  getCopyMoveQueue: vi.fn(),
}));

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
  isMultiTenantMode: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

import { getServerSession } from "next-auth";
import { getCopyMoveQueue } from "~/lib/queues";
import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";

import { GET } from "./route";

const createMockParams = (jobId: string) =>
  Promise.resolve({ jobId });

const createMockJob = (overrides: Record<string, any> = {}) => ({
  id: "job-123",
  getState: vi.fn().mockResolvedValue("completed"),
  progress: 100,
  returnvalue: { copiedCount: 5, movedCount: 0, droppedLinkCount: 0 },
  failedReason: null,
  timestamp: 1700000000000,
  processedOn: 1700000001000,
  finishedOn: 1700000002000,
  data: { tenantId: "tenant-1", userId: "user-1" },
  ...overrides,
});

describe("GET /api/repository/copy-move/status/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isMultiTenantMode as any).mockReturnValue(false);
    (getCurrentTenantId as any).mockReturnValue(null);
  });

  it("returns 401 when no session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 503 when queue unavailable", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (getCopyMoveQueue as any).mockReturnValue(null);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("Background job queue is not available");
  });

  it("returns 404 when job not found", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(null) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Job not found");
  });

  it("returns 404 when job belongs to different tenant (multi-tenant isolation)", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (isMultiTenantMode as any).mockReturnValue(true);
    (getCurrentTenantId as any).mockReturnValue("tenant-2");

    const mockJob = createMockJob({ data: { tenantId: "tenant-1", userId: "user-1" } });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Job not found");
  });

  it("returns job state, progress, and result for a completed job", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const returnvalue = { copiedCount: 5, movedCount: 0, droppedLinkCount: 0 };
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("completed"),
      returnvalue,
    });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.jobId).toBe("job-123");
    expect(data.state).toBe("completed");
    expect(data.progress).toBe(100);
    expect(data.result).toEqual(returnvalue);
    expect(data.failedReason).toBeNull();
    expect(data.timestamp).toBe(1700000000000);
    expect(data.processedOn).toBe(1700000001000);
    expect(data.finishedOn).toBe(1700000002000);
  });

  it("returns failedReason for a failed job", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("failed"),
      returnvalue: null,
      failedReason: "Source case not found",
    });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.state).toBe("failed");
    expect(data.failedReason).toBe("Source case not found");
    expect(data.result).toBeNull();
  });

  it("returns progress for an active job", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("active"),
      progress: 42,
      returnvalue: null,
      failedReason: null,
    });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await GET({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.state).toBe("active");
    expect(data.progress).toBe(42);
    expect(data.result).toBeNull();
  });
});
