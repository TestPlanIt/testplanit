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
    webhookAction: { findMany: vi.fn() },
  };
  return { db, tx };
});
vi.mock("~/lib/db", () => ({ baseDb: db }));
vi.mock("~/lib/multiTenantDb", () => ({ getCurrentTenantId: () => undefined }));
const mockActorId = vi.fn(async () => "system-automation-user");
vi.mock("~/lib/webhooks/actions/actor", () => ({
  webhookActorId: (...args: unknown[]) => mockActorId(...(args as [])),
}));
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

type Rule = {
  id: string;
  trigger: string;
  action?: string;
  isEnabled?: boolean;
  options?: unknown;
};
let rules: Rule[] = [];

/** The webhook's rules: enabled Create test run rules, one per trigger by default. */
function setRules(triggers: string[]) {
  rules = triggers.map((trigger, i) => ({
    id: `act-${i + 1}`,
    trigger,
    options: {},
  }));
}

function makeInput(
  eventType: string,
  data: unknown,
  triggers: string[] | null = ["CODE_PULL_REQUEST", "CODE_PUSH"],
  baseBranch: string | null = null
) {
  if (triggers) setRules(triggers);
  return {
    webhookConfigId: "whc-1",
    projectId: 3,
    codeRepositoryConfigId: 9,
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
    rules = [];
    db.webhookAction.findMany.mockImplementation(async ({ where }: any) =>
      rules
        .filter(
          (r) =>
            (r.isEnabled ?? true) === where.isEnabled &&
            (r.action ?? "CREATE_RUN") === where.action &&
            where.trigger.in.includes(r.trigger)
        )
        .map(({ id, trigger, options }) => ({ id, trigger, options }))
    );
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
        createdById: "system-automation-user",
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
    expect(mockActorId).toHaveBeenCalledWith(db, "owner-1");
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

  it("names and links the pull request a push to the base branch merged", async () => {
    const result = await applyInboundCodeChange(
      makeInput("push", {
        ...pushPayload("main"),
        compare: "https://github.com/acme/app/compare/a...b",
        repository: { html_url: "https://github.com/acme/app" },
        head_commit: {
          message: "Merge pull request #12 from acme/feature\n\nFix checkout",
        },
      })
    );
    expect(result.outcome).toBe("queued");
    expect(startImpactAnalysis).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        trigger: "push",
        triggerLabel: "main aaaaaaa…bbbbbbb (PR #12: Fix checkout)",
        triggerUrl: "https://github.com/acme/app/pull/12",
        notes:
          "main aaaaaaa…bbbbbbb\nhttps://github.com/acme/app/compare/a...b\nPR #12: Fix checkout\nhttps://github.com/acme/app/pull/12",
        autoRun: expect.objectContaining({
          label: "main aaaaaaa…bbbbbbb (PR #12: Fix checkout)",
          links: [
            {
              label: "main aaaaaaa…bbbbbbb",
              url: "https://github.com/acme/app/compare/a...b",
            },
            {
              label: "PR #12: Fix checkout",
              url: "https://github.com/acme/app/pull/12",
            },
          ],
        }),
      })
    );
  });

  const smokeFilter = [{ dimension: "tags", operator: "any", values: [2] }];

  it("hands each matching rule's minimum score, test case filters and execution to the analysis, one run each", async () => {
    rules = [
      {
        id: "act-1",
        trigger: "CODE_PULL_REQUEST",
        options: { minScore: 70, caseFilter: smokeFilter },
      },
      {
        id: "act-2",
        trigger: "CODE_PULL_REQUEST",
        options: { autoExecute: { targetId: 4, ref: "main" } },
      },
      { id: "act-3", trigger: "CODE_PUSH", options: { minScore: 10 } },
      {
        id: "act-4",
        trigger: "CODE_PULL_REQUEST",
        options: { minScore: "bad" },
      },
    ];
    await applyInboundCodeChange(makeInput("pull_request", prPayload, null));

    expect(db.webhookAction.findMany).toHaveBeenCalledWith({
      where: {
        webhookConfigId: "whc-1",
        isEnabled: true,
        action: "CREATE_RUN",
        trigger: { in: ["CODE_PULL_REQUEST"] },
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, trigger: true, options: true },
    });
    const autoRun = (startImpactAnalysis as any).mock.calls[0][3].autoRun;
    expect(autoRun.webhookConfigId).toBe("whc-1");
    expect(autoRun.minScore).toBeUndefined();
    expect(autoRun.actions).toEqual([
      {
        actionId: "act-1",
        trigger: "CODE_PULL_REQUEST",
        branch: null,
        minScore: 70,
        caseFilter: smokeFilter,
        autoExecute: null,
      },
      {
        actionId: "act-2",
        trigger: "CODE_PULL_REQUEST",
        branch: null,
        minScore: null,
        caseFilter: null,
        autoExecute: { targetId: 4, ref: "main" },
      },
      // unreadable options act with none
      {
        actionId: "act-4",
        trigger: "CODE_PULL_REQUEST",
        branch: null,
        minScore: null,
        caseFilter: null,
        autoExecute: null,
      },
    ]);
  });

  it("hands only the rules for the push's own trigger", async () => {
    rules = [
      { id: "act-1", trigger: "CODE_PUSH" },
      { id: "act-2", trigger: "CODE_BRANCH_PUSH" },
    ];
    await applyInboundCodeChange(makeInput("push", pushPayload("main"), null));
    expect(
      (startImpactAnalysis as any).mock.calls[0][3].autoRun.actions
    ).toEqual([
      {
        actionId: "act-1",
        trigger: "CODE_PUSH",
        branch: "main",
        minScore: null,
        caseFilter: null,
        autoExecute: null,
      },
    ]);

    await applyInboundCodeChange(
      makeInput("push", pushPayload("feature"), null)
    );
    expect(
      (startImpactAnalysis as any).mock.calls[1][3].autoRun.actions
    ).toEqual([
      {
        actionId: "act-2",
        trigger: "CODE_BRANCH_PUSH",
        branch: "feature",
        minScore: null,
        caseFilter: null,
        autoExecute: null,
      },
    ]);
  });

  it("ignores the event when its only rules are disabled or not Create test run", async () => {
    rules = [
      { id: "act-1", trigger: "CODE_PULL_REQUEST", isEnabled: false },
      { id: "act-2", trigger: "CODE_PULL_REQUEST", action: "DRAFT_CASES" },
    ];
    expect(
      await applyInboundCodeChange(makeInput("pull_request", prPayload, null))
    ).toMatchObject({ outcome: "ignored", reason: "event_disabled" });
    expect(startImpactAnalysis).not.toHaveBeenCalled();
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
          "CODE_PUSH",
          "CODE_BRANCH_PUSH",
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
      makeInput("push", pushPayload("feature"), ["CODE_BRANCH_PUSH"], "release")
    );
    expect((startImpactAnalysis as any).mock.calls[1][3]).toMatchObject({
      base: "release",
      head: SHA_B,
    });

    // Branch pushes alone do not cover the base branch itself.
    expect(
      await applyInboundCodeChange(
        makeInput("push", pushPayload("main"), ["CODE_BRANCH_PUSH"])
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
        makeInput("push", pushPayload("main"), ["CODE_PULL_REQUEST"])
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

  it.each(["same_commit", "ref_not_found"])(
    "ignores a change the analysis refuses as %s, so the provider doesn't retry",
    async (code) => {
      (startImpactAnalysis as any).mockResolvedValue({
        ok: false,
        code,
        message: "nothing to compare",
      });
      const result = await applyInboundCodeChange(
        makeInput("pull_request", prPayload)
      );
      expect(result).toEqual({
        outcome: "ignored",
        deliveryId: "del-1",
        reason: code,
      });
      expect(db.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ error: `ignored:${code}` }),
        })
      );
    }
  );

  it("reports a queue failure as an error so the provider retries", async () => {
    (startImpactAnalysis as any).mockResolvedValue({
      ok: false,
      code: "enqueue_failed",
      message: "Failed to enqueue analysis",
      analysisId: 5,
    });
    const result = await applyInboundCodeChange(
      makeInput("pull_request", prPayload)
    );
    expect(result).toMatchObject({ outcome: "error", deliveryId: "del-1" });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "analysis:enqueue_failed" }),
      })
    );
  });
});
