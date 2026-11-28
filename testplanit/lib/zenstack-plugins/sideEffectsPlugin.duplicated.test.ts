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
  emitSessionUpdateEvents,
} from "~/lib/webhooks/event-emitters/sessionEvents";
import {
  emitTestRunCreated,
  emitTestRunDuplicated,
  emitTestRunUpdateEvents,
} from "~/lib/webhooks/event-emitters/testRunEvents";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation.$all
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

function runUpdate(
  model: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  client: Record<string, unknown> = {}
) {
  return afterEntityMutation({
    model,
    action: "update",
    client,
    loadAfterMutationEntities: async () => [after],
    beforeMutationEntities: [before],
  });
}

// A client that has alert rules to count, as every real one does.
const clientWithAlertRules = () => ({
  alertRule: { count: vi.fn().mockResolvedValue(0) },
});

describe("sideEffectsPlugin — an update is never announced as a create", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<{
    name: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [
    {
      name: "a plain edit",
      before: { id: 3, projectId: 7, name: "Old", isCompleted: false },
      after: { id: 3, projectId: 7, name: "New", isCompleted: false },
    },
    {
      name: "an edit of a duplicate",
      before: { id: 3, projectId: 7, duplicatedFromId: 1, isCompleted: false },
      after: { id: 3, projectId: 7, duplicatedFromId: 1, isCompleted: false },
    },
    {
      name: "a completion",
      before: { id: 3, projectId: 7, isCompleted: false },
      after: { id: 3, projectId: 7, isCompleted: true },
    },
    {
      name: "an edit after completion",
      before: { id: 3, projectId: 7, isCompleted: true },
      after: { id: 3, projectId: 7, isCompleted: true, note: "x" },
    },
  ];

  for (const client of [
    { label: "with alert rules to count", make: clientWithAlertRules },
    { label: "without", make: () => ({}) },
  ]) {
    for (const entry of cases) {
      it(`run, ${entry.name}, ${client.label}`, async () => {
        await runUpdate("TestRuns", entry.before, entry.after, client.make());

        expect(emitTestRunUpdateEvents).toHaveBeenCalledTimes(1);
        expect(emitTestRunCreated).not.toHaveBeenCalled();
        expect(emitTestRunDuplicated).not.toHaveBeenCalled();
      });

      it(`session, ${entry.name}, ${client.label}`, async () => {
        await runUpdate("Sessions", entry.before, entry.after, client.make());

        expect(emitSessionUpdateEvents).toHaveBeenCalledTimes(1);
        expect(emitSessionCreated).not.toHaveBeenCalled();
        expect(emitSessionDuplicated).not.toHaveBeenCalled();
      });
    }
  }
});
