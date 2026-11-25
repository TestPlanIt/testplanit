import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWebhookActionsQueue: vi.fn(),
  runUpdateCases: vi.fn(),
  getDbClientForJob: vi.fn(() => ({ tag: "db" })),
}));
vi.mock("~/lib/queues", () => ({
  getWebhookActionsQueue: mocks.getWebhookActionsQueue,
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getDbClientForJob: mocks.getDbClientForJob,
}));
vi.mock("./updateCases", () => ({ runUpdateCases: mocks.runUpdateCases }));

const job = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  webhookActionId: "update-1",
  projectId: 7,
  issueId: 100,
  tenantId: "t",
};

async function load(delay?: string) {
  vi.resetModules();
  if (delay === undefined) delete process.env.WEBHOOK_UPDATE_CASES_DELAY_MS;
  else process.env.WEBHOOK_UPDATE_CASES_DELAY_MS = delay;
  return import("./enqueueUpdateCases");
}

describe("enqueueUpdateCases", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete process.env.WEBHOOK_UPDATE_CASES_DELAY_MS;
  });

  it("adds one delayed job per rule and issue that a later delivery replaces and restarts", async () => {
    const { enqueueUpdateCases } = await load();
    const add = vi.fn().mockResolvedValue({});
    mocks.getWebhookActionsQueue.mockReturnValue({ add });

    await enqueueUpdateCases(job);
    await enqueueUpdateCases({ ...job, deliveryId: "del-2" });

    expect(add).toHaveBeenCalledWith("update-cases", job, {
      deduplication: {
        id: "update-cases-t-update-1-100",
        ttl: 300000,
        extend: true,
        replace: true,
      },
      delay: 300000,
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
    });
    // The same key whatever the delivery, so the second replaces the first.
    expect(add.mock.calls[1][2].deduplication.id).toBe(
      add.mock.calls[0][2].deduplication.id
    );
    expect(mocks.runUpdateCases).not.toHaveBeenCalled();
  });

  it("keys a different rule, issue or tenant separately", async () => {
    const { updateCasesDedupId } = await load();
    const ids = new Set([
      updateCasesDedupId(job),
      updateCasesDedupId({ ...job, webhookActionId: "update-2" }),
      updateCasesDedupId({ ...job, issueId: 101 }),
      updateCasesDedupId({ ...job, tenantId: "other" }),
      updateCasesDedupId({ ...job, tenantId: undefined }),
    ]);
    expect(ids.size).toBe(5);
    expect(updateCasesDedupId({ ...job, tenantId: undefined })).toBe(
      "update-cases-default-update-1-100"
    );
  });

  it("takes its delay from the environment, ignoring a value that is not a delay", async () => {
    expect((await load("1000")).UPDATE_CASES_SETTLE_MS).toBe(1000);
    expect((await load("0")).UPDATE_CASES_SETTLE_MS).toBe(0);
    expect((await load("soon")).UPDATE_CASES_SETTLE_MS).toBe(300000);
    expect((await load("-5")).UPDATE_CASES_SETTLE_MS).toBe(300000);
    expect((await load()).UPDATE_CASES_SETTLE_MS).toBe(300000);
  });

  it("checks the cases inline when there is no queue", async () => {
    const { enqueueUpdateCases } = await load();
    mocks.getWebhookActionsQueue.mockReturnValue(null);
    mocks.runUpdateCases.mockResolvedValue({ outcome: "no_cases" });
    await enqueueUpdateCases(job);
    expect(mocks.runUpdateCases).toHaveBeenCalledWith({ tag: "db" }, job);
  });
});
