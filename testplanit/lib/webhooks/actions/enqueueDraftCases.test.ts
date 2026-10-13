import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWebhookActionsQueue: vi.fn(),
  runDraftCases: vi.fn(),
  getDbClientForJob: vi.fn(() => ({ tag: "db" })),
}));
vi.mock("~/lib/queues", () => ({
  getWebhookActionsQueue: mocks.getWebhookActionsQueue,
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getDbClientForJob: mocks.getDbClientForJob,
}));
vi.mock("./draftCases", () => ({ runDraftCases: mocks.runDraftCases }));

import { enqueueDraftCases } from "./enqueueDraftCases";

const job = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  webhookActionId: "draft-1",
  projectId: 7,
  issueId: 100,
  tenantId: "t",
};

describe("enqueueDraftCases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a retried job keyed by delivery and rule", async () => {
    const add = vi.fn().mockResolvedValue({});
    mocks.getWebhookActionsQueue.mockReturnValue({ add });
    await enqueueDraftCases(job);
    expect(add).toHaveBeenCalledWith("draft-cases", job, {
      jobId: "draft-cases-del-1-draft-1",
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
    });
    expect(mocks.runDraftCases).not.toHaveBeenCalled();
  });

  it("drafts inline when there is no queue", async () => {
    mocks.getWebhookActionsQueue.mockReturnValue(null);
    mocks.runDraftCases.mockResolvedValue({ outcome: "has_cases" });
    await enqueueDraftCases(job);
    expect(mocks.runDraftCases).toHaveBeenCalledWith({ tag: "db" }, job);
  });
});
