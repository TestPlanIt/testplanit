import { beforeEach, describe, expect, it, vi } from "vitest";

// The Sessions/TestRuns create path in the plugin only touches ES sync + the
// webhook emitters; mock those so we can assert the routing decision without a
// DB, live ES, or the webhook pipeline. (ES sync returns a promise so the
// fire-and-forget `.catch()` in the plugin doesn't blow up.)
vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/sessionEvents", () => ({
  emitSessionCreated: vi.fn(),
  emitSessionDuplicated: vi.fn(),
  emitSessionResultAdded: vi.fn(),
  emitSessionUpdateEvents: vi.fn(),
}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunCreated: vi.fn(),
  emitTestRunDuplicated: vi.fn(),
  emitTestRunResultAdded: vi.fn(),
  emitJUnitResultAdded: vi.fn(),
  emitTestRunUpdateEvents: vi.fn(),
}));

import { sideEffectsPlugin } from "./sideEffectsPlugin";
import {
  emitSessionCreated,
  emitSessionDuplicated,
} from "~/lib/webhooks/event-emitters/sessionEvents";
import {
  emitTestRunCreated,
  emitTestRunDuplicated,
} from "~/lib/webhooks/event-emitters/testRunEvents";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation
  .afterEntityMutation;

function runCreate(model: string, row: Record<string, unknown>) {
  return afterEntityMutation({
    model,
    action: "create",
    client: {},
    loadAfterMutationEntities: async () => [row],
    beforeMutationEntities: undefined, // create → no before-image
  });
}

describe("sideEffectsPlugin — .duplicated routing on create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a duplicated session to session.duplicated, not .created", async () => {
    await runCreate("Sessions", { id: 2, projectId: 7, duplicatedFromId: 1 });
    expect(emitSessionDuplicated).toHaveBeenCalledWith(
      2,
      1,
      expect.anything(),
      {
        projectId: 7,
      }
    );
    expect(emitSessionCreated).not.toHaveBeenCalled();
  });

  it("routes a plain session create to session.created", async () => {
    await runCreate("Sessions", {
      id: 3,
      projectId: 7,
      duplicatedFromId: null,
    });
    expect(emitSessionCreated).toHaveBeenCalledTimes(1);
    expect(emitSessionDuplicated).not.toHaveBeenCalled();
  });

  it("routes a duplicated run to test_run.duplicated, not .created", async () => {
    await runCreate("TestRuns", { id: 2, projectId: 7, duplicatedFromId: 1 });
    expect(emitTestRunDuplicated).toHaveBeenCalledWith(
      2,
      1,
      expect.anything(),
      {
        projectId: 7,
      }
    );
    expect(emitTestRunCreated).not.toHaveBeenCalled();
  });

  it("routes a plain run create to test_run.created", async () => {
    await runCreate("TestRuns", {
      id: 3,
      projectId: 7,
      duplicatedFromId: null,
    });
    expect(emitTestRunCreated).toHaveBeenCalledTimes(1);
    expect(emitTestRunDuplicated).not.toHaveBeenCalled();
  });
});
