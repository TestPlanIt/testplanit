import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./compareService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compareService")>();
  return { ...actual, resolveRefToSha: vi.fn() };
});

import { RefNotFoundError, resolveRefToSha } from "./compareService";
import { startImpactAnalysis } from "./startAnalysis";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const loaded = {
  config: { id: 9, projectId: 3 },
  adapter: {},
} as any;

function makeDb(reusable: unknown = null) {
  return {
    impactAnalysis: {
      findFirst: vi.fn().mockResolvedValue(reusable),
      create: vi.fn().mockResolvedValue({ id: 77 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}
function makeQueue() {
  return { add: vi.fn().mockResolvedValue({}) };
}
const input = {
  projectId: 3,
  base: "main",
  head: "feature",
  createdById: "user-1",
};

describe("startImpactAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) => (ref === "main" ? SHA_A : SHA_B)
    );
  });

  it("creates the row with the trigger and enqueues the job with the auto-run", async () => {
    const db = makeDb();
    const queue = makeQueue();
    const autoRun = { trigger: "pull_request", label: "PR #1: x", url: null };

    const result = await startImpactAnalysis(db, loaded, queue, {
      ...input,
      trigger: "pull_request",
      triggerLabel: "PR #1: x",
      triggerUrl: "https://example/pr/1",
      autoRun,
      tenantId: "t1",
    });

    expect(result).toEqual({
      ok: true,
      analysisId: 77,
      jobId: "impact-77",
      reused: false,
    });
    expect(db.impactAnalysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          configId: 9,
          baseSha: SHA_A,
          headSha: SHA_B,
          trigger: "pull_request",
          triggerLabel: "PR #1: x",
          triggerUrl: "https://example/pr/1",
          createdById: "user-1",
        }),
      })
    );
    expect(queue.add).toHaveBeenCalledWith(
      "analyze",
      expect.objectContaining({ analysisId: 77, autoRun, tenantId: "t1" }),
      { jobId: "impact-77" }
    );
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { jobId: "impact-77" },
    });
  });

  it("reuses a recent completed analysis of the same pair unless forced", async () => {
    const db = makeDb({ id: 12, jobId: "impact-12" });
    const queue = makeQueue();

    const reused = await startImpactAnalysis(db, loaded, queue, input);
    expect(reused).toEqual({
      ok: true,
      analysisId: 12,
      jobId: "impact-12",
      reused: true,
    });
    expect(db.impactAnalysis.create).not.toHaveBeenCalled();

    await startImpactAnalysis(db, loaded, queue, { ...input, force: true });
    expect(db.impactAnalysis.create).toHaveBeenCalled();
  });

  it("reports an unknown ref and the same-commit case without writing", async () => {
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) => {
        if (ref === "ghost") throw new RefNotFoundError(ref);
        return SHA_A;
      }
    );
    const db = makeDb();

    expect(
      await startImpactAnalysis(db, loaded, makeQueue(), {
        ...input,
        head: "ghost",
      })
    ).toMatchObject({ ok: false, code: "ref_not_found" });
    expect(
      await startImpactAnalysis(db, loaded, makeQueue(), {
        ...input,
        head: "main",
      })
    ).toMatchObject({ ok: false, code: "same_commit" });
    expect(db.impactAnalysis.create).not.toHaveBeenCalled();
  });

  it("marks the row failed when there is no queue or the enqueue throws", async () => {
    const db = makeDb();

    const noQueue = await startImpactAnalysis(db, loaded, null, input);
    expect(noQueue).toMatchObject({
      ok: false,
      code: "queue_unavailable",
      analysisId: 77,
    });
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: {
        status: "FAILED",
        error: "Background job queue is not available",
      },
    });

    const queue = makeQueue();
    queue.add.mockRejectedValue(new Error("redis down"));
    const failed = await startImpactAnalysis(makeDb(), loaded, queue, input);
    expect(failed).toMatchObject({ ok: false, code: "enqueue_failed" });
  });
});
