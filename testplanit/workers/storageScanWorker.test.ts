import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runStorageScan, update, updateProgress } = vi.hoisted(() => ({
  runStorageScan: vi.fn(),
  update: vi.fn(),
  updateProgress: vi.fn(),
}));

vi.mock("../lib/services/storageScan", () => ({ runStorageScan }));
vi.mock("../lib/valkey", () => ({ default: null }));
vi.mock("../lib/multiTenantDb", () => ({
  disconnectAllTenantClients: vi.fn(),
  getDbClientForJob: vi.fn(),
  isMultiTenantMode: () => false,
  validateMultiTenantJobData: vi.fn(),
}));

import { processStorageScan } from "./storageScanWorker";

const db = { storageScan: { update } } as any;
const job = {
  id: "job-1",
  data: { scanId: 9 },
  updateProgress,
} as unknown as Job<{ scanId: number }>;

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

describe("processStorageScan", () => {
  it("records what the scan found on its row", async () => {
    runStorageScan.mockImplementation(async (_db, _scanId, onProgress) => {
      await onProgress(1000);
      return {
        objectCount: 1200,
        objectBytes: 5000,
        orphanCount: 30,
        orphanBytes: 700,
        missingCount: 4,
      };
    });

    const result = await processStorageScan(job, db);

    expect(runStorageScan).toHaveBeenCalledWith(db, 9, expect.any(Function));
    expect(result.objectCount).toBe(1200);
    // Progress while it runs, so the page can show the scan moving.
    expect(updateProgress).toHaveBeenCalledWith({ objects: 1000 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { objectCount: 1000 },
    });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: "COMPLETED",
        finishedAt: expect.any(Date),
        objectCount: 1200,
        objectBytes: BigInt(5000),
        orphanCount: 30,
        orphanBytes: BigInt(700),
        missingCount: 4,
      }),
    });
  });

  it("marks the scan failed with the reason and rethrows", async () => {
    runStorageScan.mockRejectedValue(new Error("AWS_BUCKET_NAME is not set"));

    await expect(processStorageScan(job, db)).rejects.toThrow(
      "AWS_BUCKET_NAME is not set"
    );
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: "FAILED",
        finishedAt: expect.any(Date),
        error: "AWS_BUCKET_NAME is not set",
      }),
    });
  });
});
