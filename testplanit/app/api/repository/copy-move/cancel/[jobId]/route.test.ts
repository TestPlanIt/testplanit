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

import { POST } from "./route";

const createMockParams = (jobId: string) =>
  Promise.resolve({ jobId });

const createMockRedisConnection = () => ({
  set: vi.fn().mockResolvedValue("OK"),
});

const createMockJob = (overrides: Record<string, any> = {}) => ({
  id: "job-123",
  getState: vi.fn().mockResolvedValue("active"),
  remove: vi.fn().mockResolvedValue(undefined),
  data: { tenantId: "tenant-1", userId: "user-1" },
  ...overrides,
});

describe("POST /api/repository/copy-move/cancel/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isMultiTenantMode as any).mockReturnValue(false);
    (getCurrentTenantId as any).mockReturnValue(null);
  });

  it("returns 401 when no session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 503 when queue unavailable", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (getCopyMoveQueue as any).mockReturnValue(null);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("Background job queue is not available");
  });

  it("returns 404 when job not found", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(null) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Job not found");
  });

  it("returns 404 when job belongs to different tenant", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (isMultiTenantMode as any).mockReturnValue(true);
    (getCurrentTenantId as any).mockReturnValue("tenant-2");

    const mockJob = createMockJob({ data: { tenantId: "tenant-1", userId: "user-1" } });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Job not found");
  });

  it("returns 403 when non-submitter tries to cancel", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-2" } });
    const mockJob = createMockJob({ data: { tenantId: "tenant-1", userId: "user-1" } });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Forbidden");
  });

  it("returns 'Job already finished' for a completed job", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("completed"),
    });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Job already finished");
  });

  it("calls job.remove() for a waiting job and returns 'Job cancelled'", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("waiting"),
    });
    const mockQueue = { getJob: vi.fn().mockResolvedValue(mockJob) };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Job cancelled");
    expect(mockJob.remove).toHaveBeenCalledOnce();
  });

  it("sets Redis key 'copy-move:cancel:{jobId}' with EX 3600 for an active job", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    const mockConnection = createMockRedisConnection();
    const mockJob = createMockJob({
      getState: vi.fn().mockResolvedValue("active"),
    });
    const mockQueue = {
      getJob: vi.fn().mockResolvedValue(mockJob),
      client: Promise.resolve(mockConnection),
    };
    (getCopyMoveQueue as any).mockReturnValue(mockQueue);

    const response = await POST({} as Request, { params: createMockParams("job-123") });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Cancellation requested, job will stop after current case");
    expect(mockConnection.set).toHaveBeenCalledWith(
      "copy-move:cancel:job-123",
      "1",
      "EX",
      3600,
    );
  });
});
