import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/multiTenantDb", () => ({ getCurrentTenantId: vi.fn() }));

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    projectCodeRepositoryConfig: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ baseDb: db }));
vi.mock("~/lib/queues", () => ({ getRepoCacheQueue: vi.fn() }));

import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth/next";
import { JOB_SCAN_REPO_ISSUES } from "~/lib/queueNames";
import { getRepoCacheQueue } from "~/lib/queues";
import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/code-repositories/8/scan-issues/cancel",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}
const params = () => ({ params: Promise.resolve({ id: "8" }) });

function makeJob(state: string) {
  return {
    id: "job-3",
    name: JOB_SCAN_REPO_ISSUES,
    data: { configId: 9 },
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeQueue(jobs: unknown[]) {
  const client = { set: vi.fn().mockResolvedValue("OK") };
  return {
    getJobs: vi.fn().mockResolvedValue(jobs),
    client: Promise.resolve(client),
    _client: client,
  };
}

describe("POST /api/code-repositories/[id]/scan-issues/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (getServerSession as any).mockResolvedValue({ user: { id: "u1" } });
    (getCurrentTenantId as any).mockReturnValue(undefined);
    db.user.findUnique.mockResolvedValue({ access: "ADMIN" });
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue({
      id: 9,
      purpose: "IMPACT",
      issueScanReport: { running: true, full: true },
    });
    db.projectCodeRepositoryConfig.update.mockResolvedValue({});
    (getRepoCacheQueue as any).mockReturnValue(makeQueue([]));
  });

  it("returns 401 without a session and 403 for a plain user", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(request({ projectConfigId: 9 }), params())).status).toBe(
      401
    );
    (getServerSession as any).mockResolvedValue({ user: { id: "u1" } });
    db.user.findUnique.mockResolvedValue({ access: "USER" });
    expect((await POST(request({ projectConfigId: 9 }), params())).status).toBe(
      403
    );
  });

  it("returns 404 when the config does not exist", async () => {
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue(null);
    expect((await POST(request({ projectConfigId: 9 }), params())).status).toBe(
      404
    );
  });

  it("removes a waiting job and marks the report cancelled", async () => {
    const job = makeJob("waiting");
    (getRepoCacheQueue as any).mockReturnValue(makeQueue([job]));

    const res = await POST(request({ projectConfigId: 9 }), params());

    expect(await res.json()).toEqual({ cancelled: true, wasRunning: false });
    expect(job.remove).toHaveBeenCalled();
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        issueScanReport: {
          cancelled: true,
          full: true,
          scannedAt: expect.any(String),
        },
      },
    });
  });

  it("flags an active job for the worker to stop", async () => {
    const job = makeJob("active");
    const queue = makeQueue([job]);
    (getRepoCacheQueue as any).mockReturnValue(queue);

    const res = await POST(request({ projectConfigId: 9 }), params());

    expect(await res.json()).toEqual({ cancelling: true, jobId: "job-3" });
    expect(queue._client.set).toHaveBeenCalledWith(
      "impact:issue-scan:cancel:9",
      "1",
      { EX: 3600 }
    );
    expect(job.remove).not.toHaveBeenCalled();
    expect(db.projectCodeRepositoryConfig.update).not.toHaveBeenCalled();
  });

  it("clears a leftover running flag when no job exists", async () => {
    const res = await POST(request({ projectConfigId: 9 }), params());

    expect(await res.json()).toEqual({ cancelled: true, wasRunning: true });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { issueScanReport: expect.objectContaining({ cancelled: true }) },
      })
    );
  });

  it("does nothing when nothing is running and no job exists", async () => {
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue({
      id: 9,
      purpose: "IMPACT",
      issueScanReport: { scannedAt: "2026-09-13T00:00:00Z" },
    });

    const res = await POST(request({ projectConfigId: 9 }), params());

    expect(await res.json()).toEqual({ cancelled: true, wasRunning: false });
    expect(db.projectCodeRepositoryConfig.update).not.toHaveBeenCalled();
  });
});
