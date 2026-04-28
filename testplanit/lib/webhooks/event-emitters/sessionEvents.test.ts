import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitSessionCreated,
  emitSessionDuplicated,
  emitSessionResultAdded,
  emitSessionUpdateEvents,
} from "./sessionEvents";

/**
 * Plan 02-05 Task 5.2 — sessionEvents emitter contract.
 *
 * Mirrors testRunEvents 1:1 except for the session.completed payload
 * asymmetry (no getSessionSummary equivalent yet — minimal payload with
 * totalCases from sessionResults.count).
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

interface TxStub {
  workflows: { findUnique: ReturnType<typeof vi.fn> };
  sessions: { findUnique: ReturnType<typeof vi.fn> };
  sessionResults: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  status: { findUnique: ReturnType<typeof vi.fn> };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  return {
    workflows: {
      findUnique: vi.fn(async () => ({ name: "default", workflowType: "IN_PROGRESS" })),
      ...(overrides.workflows ?? {}),
    },
    sessions: {
      findUnique: vi.fn(async () => ({ id: 1, name: "Session 1", projectId: 7 })),
      ...(overrides.sessions ?? {}),
    },
    sessionResults: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
      ...(overrides.sessionResults ?? {}),
    },
    status: {
      findUnique: vi.fn(async () => ({ id: 5, name: "Passed", isCompleted: true })),
      ...(overrides.status ?? {}),
    },
  };
}

describe("emitSessionCreated", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits session.created and forwards tx", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi.fn(async () => ({ name: "Open", workflowType: "NOT_STARTED" })),
      },
    });
    await emitSessionCreated(
      { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: false },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("session.created");
    expect(payload).toMatchObject({
      sessionId: 1,
      sessionName: "Session 1",
      projectId: 7,
      stateId: 100,
      stateName: "Open",
      isCompleted: false,
    });
    expect(opts.tx).toBe(tx);
  });
});

describe("emitSessionUpdateEvents — D-10 lifecycle policy", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits NOTHING when neither stateId nor isCompleted changed", async () => {
    const tx = makeTx();
    const row = { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: false };
    await emitSessionUpdateEvents(row, row, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits ONLY session.completed when isCompleted flips false→true without a stateId change (admin marked complete in place)", async () => {
    const tx = makeTx();
    await emitSessionUpdateEvents(
      { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: true },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("session.completed");
  });

  it("emits ONLY session.state_changed when stateId changed but to-state is not isCompleted", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ name: "Open", workflowType: "NOT_STARTED" })
          .mockResolvedValueOnce({ name: "In Progress", workflowType: "IN_PROGRESS" }),
      },
    });
    await emitSessionUpdateEvents(
      { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Session 1", stateId: 200, isCompleted: false },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("session.state_changed");
    expect(emitMock.mock.calls[0][1]).toMatchObject({
      isCompletedTransition: false,
    });
  });

  it("emits BOTH session.state_changed AND session.completed when transitioning into a DONE state", async () => {
    const tx = makeTx({
      workflows: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ name: "In Progress", workflowType: "IN_PROGRESS" })
          .mockResolvedValueOnce({ name: "Done", workflowType: "DONE" }),
      },
      sessionResults: {
        count: vi.fn(async () => 4),
        findUnique: vi.fn(),
      },
    });
    await emitSessionUpdateEvents(
      { id: 1, projectId: 7, name: "Session 1", stateId: 100, isCompleted: false },
      { id: 1, projectId: 7, name: "Session 1", stateId: 200, isCompleted: true },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(2);
    expect(emitMock.mock.calls[0][0]).toBe("session.state_changed");
    expect(emitMock.mock.calls[1][0]).toBe("session.completed");
    expect(emitMock.mock.calls[1][1]).toMatchObject({
      sessionId: 1,
      sessionName: "Session 1",
      projectId: 7,
      totalCases: 4,
    });
  });
});

describe("emitSessionResultAdded", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits session.result_added with status + session enrichment", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const tx = makeTx({
      sessions: {
        findUnique: vi.fn(async () => ({ id: 1, name: "Session 1", projectId: 7 })),
      },
      status: {
        findUnique: vi.fn(async () => ({ id: 5, name: "Passed", isCompleted: true })),
      },
    });
    await emitSessionResultAdded(
      { id: 88, sessionId: 1, statusId: 5, createdById: "user-1", createdAt },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("session.result_added");
    expect(payload).toMatchObject({
      sessionId: 1,
      sessionName: "Session 1",
      resultId: 88,
      statusId: 5,
      statusName: "Passed",
      isCompleted: true,
      executedById: "user-1",
      executedAt: createdAt.toISOString(),
    });
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(7);
  });

  it("returns silently when the parent session was deleted", async () => {
    const tx = makeTx({
      sessions: { findUnique: vi.fn(async () => null) },
    });
    await emitSessionResultAdded(
      { id: 88, sessionId: 1, statusId: 5 },
      tx as never
    );
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitSessionDuplicated", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits session.duplicated with sourceSessionId and newSessionId", async () => {
    const tx = makeTx({
      sessions: {
        findUnique: vi.fn(async () => ({
          id: 2,
          name: "Copy of Session 1",
          projectId: 7,
        })),
      },
    });
    await emitSessionDuplicated(2, 1, tx as never, { projectId: 7 });
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("session.duplicated");
    expect(payload).toMatchObject({
      newSessionId: 2,
      sourceSessionId: 1,
      sessionName: "Copy of Session 1",
      projectId: 7,
    });
  });
});
