import { beforeEach, describe, expect, it, vi } from "vitest";

// The JUnit create paths only touch the hybrid projection and the SSE
// wake-up emitter; mock both so the routing can be asserted without a DB.
vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunCreated: vi.fn(),
  emitTestRunDuplicated: vi.fn(),
  emitTestRunResultAdded: vi.fn(),
  emitJUnitResultAdded: vi.fn(),
  emitTestRunUpdateEvents: vi.fn(),
}));
vi.mock("~/lib/execution/service", () => ({
  markExecutionResultsReceived: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/hybridRunProjection", () => ({
  promoteRunToHybrid: vi.fn(() => Promise.resolve(true)),
  projectJUnitResultOntoRunCase: vi.fn(() => Promise.resolve()),
}));

import { sideEffectsPlugin } from "./sideEffectsPlugin";
import {
  projectJUnitResultOntoRunCase,
  promoteRunToHybrid,
} from "~/lib/services/hybridRunProjection";
import { markExecutionResultsReceived } from "~/lib/execution/service";
import { emitJUnitResultAdded } from "~/lib/webhooks/event-emitters/testRunEvents";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation
  .afterEntityMutation;

function runMutation(
  model: string,
  action: "create" | "update",
  row: Record<string, unknown>
) {
  return afterEntityMutation({
    model,
    action,
    client: {},
    loadAfterMutationEntities: async () => [row],
    beforeMutationEntities: action === "create" ? undefined : [row],
  });
}

describe("sideEffectsPlugin — hybrid-run projection on JUnit writes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes the run when a JUnit suite is created", async () => {
    await runMutation("JUnitTestSuite", "create", { id: 3, testRunId: 7 });
    expect(promoteRunToHybrid).toHaveBeenCalledWith(expect.anything(), 7);
    expect(markExecutionResultsReceived).toHaveBeenCalledWith(
      expect.anything(),
      7
    );
  });

  it("ignores suite updates", async () => {
    await runMutation("JUnitTestSuite", "update", { id: 3, testRunId: 7 });
    expect(promoteRunToHybrid).not.toHaveBeenCalled();
  });

  it("projects a created JUnit result onto its run-case, then emits the wake-up", async () => {
    const row = { id: 40, testSuiteId: 3, repositoryCaseId: 11, statusId: 5 };
    await runMutation("JUnitTestResult", "create", row);

    expect(projectJUnitResultOntoRunCase).toHaveBeenCalledWith(
      expect.anything(),
      { testSuiteId: 3, repositoryCaseId: 11, statusId: 5 }
    );
    expect(emitJUnitResultAdded).toHaveBeenCalledWith(row, expect.anything());
    const projectionOrder = (projectJUnitResultOntoRunCase as any).mock
      .invocationCallOrder[0];
    const emitOrder = (emitJUnitResultAdded as any).mock.invocationCallOrder[0];
    expect(projectionOrder).toBeLessThan(emitOrder);
  });

  it("passes nulls through for a result with no case or status", async () => {
    await runMutation("JUnitTestResult", "create", { id: 41, testSuiteId: 3 });
    expect(projectJUnitResultOntoRunCase).toHaveBeenCalledWith(
      expect.anything(),
      { testSuiteId: 3, repositoryCaseId: null, statusId: null }
    );
  });
});
