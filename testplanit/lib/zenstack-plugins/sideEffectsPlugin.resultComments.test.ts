/**
 * Result comment enqueue wiring. The plugin is the seam that sees a run
 * complete, so what it queues, and when it queues nothing, is checked here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnqueue } = vi.hoisted(() => ({
  mockEnqueue: vi.fn((..._args: any[]) => Promise.resolve()),
}));

vi.mock("~/lib/integrations/resultCommentEnqueue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/integrations/resultCommentEnqueue")
  >()),
  enqueueRunResultComments: mockEnqueue,
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: () => "tenant-a",
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunCreated: vi.fn(() => Promise.resolve()),
  emitTestRunDuplicated: vi.fn(() => Promise.resolve()),
  emitTestRunResultAdded: vi.fn(() => Promise.resolve()),
  emitJUnitResultAdded: vi.fn(() => Promise.resolve()),
  emitTestRunUpdateEvents: vi.fn(() => Promise.resolve()),
}));

import { sideEffectsPlugin } from "./sideEffectsPlugin";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation.$all
  .afterEntityMutation;

/** Lets the hook's detached `void enqueue…()` promise settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const githubApp = { id: 14, provider: "GITHUB", authType: "GITHUB_APP" };

function txWith(projectIntegration: unknown) {
  return {
    projectIntegration: { findFirst: vi.fn(async () => projectIntegration) },
    workflows: { findUnique: vi.fn(async () => null) },
    projects: { findUnique: vi.fn(async () => ({})) },
  };
}

function update(
  tx: unknown,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>
) {
  return afterEntityMutation({
    model: "TestRuns",
    action: before ? "update" : "create",
    client: tx,
    loadAfterMutationEntities: async () => [after],
    beforeMutationEntities: before ? [before] : undefined,
  });
}

describe("sideEffectsPlugin — result comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues the comments of a run when it first completes", async () => {
    const tx = txWith({
      config: { resultComments: { enabled: true } },
      integration: githubApp,
    });

    await update(
      tx,
      { id: 81, projectId: 374, isCompleted: false },
      { id: 81, projectId: 374, isCompleted: true }
    );
    await flush();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({
      runId: 81,
      projectId: 374,
      integrationId: 14,
      tenantId: "tenant-a",
    });
  });

  it("queues nothing for a project that has not switched comments on", async () => {
    const tx = txWith({ config: {}, integration: githubApp });

    await update(
      tx,
      { id: 81, projectId: 374, isCompleted: false },
      { id: 81, projectId: 374, isCompleted: true }
    );
    await flush();

    expect(tx.projectIntegration.findFirst).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not look at the project for an edit, a later edit of a completed run, or a run created completed", async () => {
    const tx = txWith({
      config: { resultComments: { enabled: true } },
      integration: githubApp,
    });

    await update(
      tx,
      { id: 81, projectId: 374, isCompleted: false },
      { id: 81, projectId: 374, isCompleted: false, name: "Renamed" }
    );
    await update(
      tx,
      { id: 81, projectId: 374, isCompleted: true },
      { id: 81, projectId: 374, isCompleted: true, name: "Renamed" }
    );
    await update(tx, undefined, { id: 82, projectId: 374, isCompleted: true });
    await flush();

    expect(tx.projectIntegration.findFirst).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
