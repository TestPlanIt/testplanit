import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
  const tx = {
    webhookDelivery: { create: vi.fn(), update: vi.fn() },
    webhookConfig: { update: vi.fn() },
    webhookEventDedup: { findFirst: vi.fn(), create: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    webhookDelivery: { update: vi.fn() },
    projects: { findUnique: vi.fn() },
  };
  return { db, tx };
});
vi.mock("~/lib/db", () => ({ baseDb: db }));
vi.mock("~/lib/multiTenantDb", () => ({ getCurrentTenantId: () => undefined }));
vi.mock("~/lib/queues", () => ({
  getImpactAnalysisQueue: () => ({ add: vi.fn() }),
}));
vi.mock("~/lib/services/impact/repoAccess", () => ({
  loadRepoConfigForWorker: vi.fn(),
}));
vi.mock("~/lib/services/impact/startAnalysis", () => ({
  startImpactAnalysis: vi.fn(),
}));

import { loadRepoConfigForWorker } from "~/lib/services/impact/repoAccess";
import { startImpactAnalysis } from "~/lib/services/impact/startAnalysis";
import { applyInboundCodeChange } from "./applyInboundCodeChange";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_M = "c".repeat(40);

function makeInput(
  eventType: string,
  data: unknown,
  events = ["code:pull_request", "code:push"],
  baseBranch: string | null = null
) {
  return {
    webhookConfigId: "whc-1",
    projectId: 3,
    codeRepositoryConfigId: 9,
    subscribedEvents: events,
    baseBranch,
    adapterType: "GITHUB" as const,
    eventType,
    payload: {
      eventType,
      issueKey: "",
      externalStatus: "",
      synthetic: false,
      data,
    },
    payloadDigest: "digest-1",
    receivedAt: new Date("2026-09-14T00:00:00Z"),
    latencyMs: 5,
    statusCode: 200,
  };
}
const prPayload = {
  action: "opened",
  number: 12,
  pull_request: {
    number: 12,
    title: "Fix checkout",
    html_url: "https://github.com/acme/app/pull/12",
    head: { sha: SHA_B, ref: "feature" },
    base: { sha: SHA_A, ref: "main" },
  },
};
const pushPayload = (branch: string) => ({
  ref: `refs/heads/${branch}`,
  before: SHA_A,
  after: SHA_B,
  commits: [{}],
});

describe("applyInboundCodeChange", () => {
  let adapter: {
    getMergeBase: ReturnType<typeof vi.fn>;
    getDefaultBranch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    tx.webhookDelivery.create.mockResolvedValue({ id: "del-1" });
    tx.webhookDelivery.update.mockResolvedValue({});
    tx.webhookConfig.update.mockResolvedValue({});
    tx.webhookEventDedup.findFirst.mockResolvedValue(null);
    tx.webhookEventDedup.create.mockResolvedValue({});
    db.webhookDelivery.update.mockResolvedValue({});
    db.projects.findUnique.mockResolvedValue({
      impactEnabled: true,
      createdBy: "owner-1",
      isDeleted: false,
    });
    adapter = {
      getMergeBase: vi.fn().mockResolvedValue(SHA_M),
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
    };
    (loadRepoConfigForWorker as any).mockResolvedValue({
      config: { id: 9, projectId: 3, branch: "main" },
      adapter,
    });
    (startImpactAnalysis as any).mockResolvedValue({
      ok: true,
      analysisId: 77,
      jobId: "impact-77",
      reused: false,
    });
  });

  it("starts an analysis from the merge base to the head for an opened pull request", async () => {
    const result = await applyInboundCodeChange(
      makeInput("pull_request", prPayload)
    );

    expect(result).toEqual({
      outcome: "queued",
      deliveryId: "del-1",
      analysisId: 77,
    });
    expect(adapter.getMergeBase).toHaveBeenCalledWith("main", SHA_B);
    expect(startImpactAnalysis).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        projectId: 3,
        base: SHA_M,
        head: SHA_B,
        createdById: "owner-1",
        trigger: "pull_request",
        triggerLabel: "PR #12: Fix checkout",
        triggerUrl: "https://github.com/acme/app/pull/12",
        autoRun: expect.objectContaining({
          trigger: "pull_request",
          label: "PR #12: Fix checkout",
          deliveryId: "del-1",
        }),
      })
    );
    expect(tx.webhookEventDedup.create).toHaveBeenCalledWith({
      data: { webhookConfigId: "whc-1", payloadDigest: "digest-1" },
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectRef: "analysis:77",
          error: null,
        }),
      })
    );
  });

  it("falls back to the target sha when the provider has no merge base", async () => {
    adapter.getMergeBase.mockResolvedValue(null);
    await applyInboundCodeChange(makeInput("pull_request", prPayload));
    expect(startImpactAnalysis).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ base: SHA_A, head: SHA_B })
    );
  });

  it("compares before with after for a push to the connection's branch", async () => {
    const result = await applyInboundCodeChange(
      makeInput("push", pushPayload("main"))
    );
    expect(result.outcome).toBe("queued");
    expect(startImpactAnalysis).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ base: SHA_A, head: SHA_B, trigger: "push" })
    );
  });

  it("compares a push to the webhook's own base branch instead of the connection's", async () => {
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("develop"), undefined, "develop")
      )
    ).toMatchObject({ outcome: "queued" });
    expect((startImpactAnalysis as any).mock.calls[0][3]).toMatchObject({
      base: SHA_A,
      head: SHA_B,
    });
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("main"), undefined, "develop")
      )
    ).toMatchObject({ outcome: "ignored", reason: "push_other_branch" });
  });

  it("compares a push to another branch against the base branch when branch pushes are on", async () => {
    adapter.getMergeBase.mockResolvedValueOnce(SHA_M);
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("feature"), [
          "code:push",
          "code:branch_push",
        ])
      )
    ).toMatchObject({ outcome: "queued" });
    expect(adapter.getMergeBase).toHaveBeenCalledWith("main", SHA_B);
    expect((startImpactAnalysis as any).mock.calls[0][3]).toMatchObject({
      base: SHA_M,
      head: SHA_B,
    });

    // Without a merge base the branch name itself is the base.
    adapter.getMergeBase.mockRejectedValueOnce(new Error("unsupported"));
    await applyInboundCodeChange(
      makeInput("push", pushPayload("feature"), ["code:branch_push"], "release")
    );
    expect((startImpactAnalysis as any).mock.calls[1][3]).toMatchObject({
      base: "release",
      head: SHA_B,
    });

    // Branch pushes alone do not cover the base branch itself.
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("main"), ["code:branch_push"])
      )
    ).toMatchObject({ outcome: "ignored", reason: "event_disabled" });
  });

  it("records the Send test pull request as synthetic without starting anything", async () => {
    const synthetic = {
      action: "opened",
      number: 0,
      pull_request: { number: 0, title: "Synthetic test" },
      repository: { full_name: "__synthetic__/__synthetic__" },
    };
    const result = await applyInboundCodeChange(
      makeInput("pull_request", synthetic, [])
    );
    expect(result).toMatchObject({ outcome: "synthetic", deliveryId: "del-1" });
    expect(startImpactAnalysis).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "synthetic" }),
      })
    );
  });

  it("ignores pushes to other branches, branch creations, and closed pull requests", async () => {
    expect(
      await applyInboundCodeChange(makeInput("push", pushPayload("feature")))
    ).toMatchObject({ outcome: "ignored", reason: "push_other_branch" });
    expect(
      await applyInboundCodeChange(
        makeInput("push", {
          ref: "refs/heads/main",
          before: "0".repeat(40),
          after: SHA_B,
          created: true,
        })
      )
    ).toMatchObject({ outcome: "ignored", reason: "push_no_range" });
    expect(
      await applyInboundCodeChange(
        makeInput("pull_request", { ...prPayload, action: "closed" })
      )
    ).toMatchObject({ outcome: "ignored", reason: "pull_request_not_opened" });
    expect(startImpactAnalysis).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "ignored:push_other_branch" }),
      })
    );
  });

  it("ignores an event the webhook has switched off, and a project with Impact off", async () => {
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("main"), ["code:pull_request"])
      )
    ).toMatchObject({ outcome: "ignored", reason: "event_disabled" });
    db.projects.findUnique.mockResolvedValue({
      impactEnabled: false,
      createdBy: "o",
      isDeleted: false,
    });
    expect(
      await applyInboundCodeChange(makeInput("pull_request", prPayload))
    ).toMatchObject({ outcome: "ignored", reason: "impact_disabled" });
  });

  it("records no handler for an unrelated event and duplicate for a repeated payload", async () => {
    expect(
      await applyInboundCodeChange(makeInput("issues", { action: "opened" }))
    ).toEqual({ outcome: "no_handler", deliveryId: "del-1" });
    tx.webhookEventDedup.findFirst.mockResolvedValue({ id: "dedup-1" });
    expect(
      await applyInboundCodeChange(makeInput("pull_request", prPayload))
    ).toEqual({ outcome: "duplicate", deliveryId: "del-1" });
    expect(startImpactAnalysis).not.toHaveBeenCalled();
  });

  it("reports an analysis that could not start as an error on the delivery", async () => {
    (startImpactAnalysis as any).mockResolvedValue({
      ok: false,
      code: "ref_not_found",
      message: "Ref not found: x",
    });
    const result = await applyInboundCodeChange(
      makeInput("pull_request", prPayload)
    );
    expect(result).toMatchObject({ outcome: "error", deliveryId: "del-1" });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "analysis:ref_not_found" }),
      })
    );
  });
});
