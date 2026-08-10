/**
 * The completion gate's job is to make the server refuse a completion the UI
 * would never have offered. Two things are load-bearing and easy to regress:
 * it must NOT fire on payloads that don't touch `isCompleted` (every other run
 * and session update would start paying for a permission lookup, and the
 * review-gate flows would break), and it must NOT fire on a no-op re-save.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const userHasAreaPermission = vi.fn();

vi.mock("~/lib/services/areaPermission", () => ({
  userHasAreaPermission: (...args: unknown[]) => userHasAreaPermission(...args),
}));

vi.mock("~/lib/db", () => ({ baseDb: {} }));

const {
  assertCanFlipCompletion,
  CompletionPermissionError,
  isCompletionGatedModel,
  isCompletionPermissionError,
  readCompletionIntent,
  resolveTransitioningRows,
} = await import("./completionGate");

const db = {
  testRuns: { findMany: vi.fn() },
  sessions: { findMany: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  userHasAreaPermission.mockResolvedValue(true);
  db.testRuns.findMany.mockResolvedValue([]);
  db.sessions.findMany.mockResolvedValue([]);
});

describe("isCompletionGatedModel", () => {
  it("covers exactly the two completable models", () => {
    expect(isCompletionGatedModel("testRuns")).toBe(true);
    expect(isCompletionGatedModel("sessions")).toBe(true);
    expect(isCompletionGatedModel("testRunCases")).toBe(false);
    expect(isCompletionGatedModel("milestones")).toBe(false);
  });
});

describe("readCompletionIntent", () => {
  it("reads data.isCompleted for update and updateMany", () => {
    expect(
      readCompletionIntent("update", { data: { isCompleted: true } })
    ).toEqual({ nextValue: true });
    expect(
      readCompletionIntent("updateMany", { data: { isCompleted: false } })
    ).toEqual({ nextValue: false });
  });

  it("reads the update branch of an upsert", () => {
    expect(
      readCompletionIntent("upsert", {
        create: { isCompleted: true },
        update: { isCompleted: true },
      })
    ).toEqual({ nextValue: true });
  });

  it("reads data.isCompleted for create", () => {
    expect(
      readCompletionIntent("create", { data: { isCompleted: true } })
    ).toEqual({ nextValue: true });
  });

  // The gate must be invisible to every payload that doesn't touch the flag —
  // otherwise ordinary edits (and the review-gate stateId flows) pay for it.
  it("returns null when the payload does not touch isCompleted", () => {
    expect(readCompletionIntent("update", { data: { stateId: 4 } })).toBeNull();
    expect(
      readCompletionIntent("update", { data: { configurationGroupId: "g" } })
    ).toBeNull();
    expect(readCompletionIntent("delete", { where: { id: 1 } })).toBeNull();
    expect(readCompletionIntent("findMany", {})).toBeNull();
    expect(readCompletionIntent("update", undefined)).toBeNull();
  });

  it("ignores a non-boolean isCompleted", () => {
    expect(
      readCompletionIntent("update", { data: { isCompleted: "true" } })
    ).toBeNull();
    expect(
      readCompletionIntent("update", { data: { isCompleted: 1 } })
    ).toBeNull();
  });
});

describe("resolveTransitioningRows", () => {
  it("uses the pre-snapshot for a single-row update", async () => {
    const rows = await resolveTransitioningRows(
      "testRuns",
      "update",
      { where: { id: 5 }, data: { isCompleted: true } },
      true,
      { id: 5, projectId: 9, isCompleted: false },
      db
    );
    expect(rows).toEqual([{ id: 5, projectId: 9 }]);
    expect(db.testRuns.findMany).not.toHaveBeenCalled();
  });

  // A form that round-trips the whole entity re-sends isCompleted unchanged.
  // Treating that as a completion would deny edits nobody gated before.
  it("treats a no-op re-save as no transition", async () => {
    const rows = await resolveTransitioningRows(
      "testRuns",
      "update",
      { where: { id: 5 }, data: { isCompleted: true } },
      true,
      { id: 5, projectId: 9, isCompleted: true },
      db
    );
    expect(rows).toEqual([]);
  });

  it("queries the matched rows for updateMany", async () => {
    db.testRuns.findMany.mockResolvedValue([
      { id: 1, projectId: 3 },
      { id: 2, projectId: 4 },
    ]);
    const rows = await resolveTransitioningRows(
      "testRuns",
      "updateMany",
      { where: { milestoneId: 7 }, data: { isCompleted: true } },
      true,
      null,
      db
    );
    expect(db.testRuns.findMany).toHaveBeenCalledWith({
      where: { milestoneId: 7, isCompleted: false },
      select: { id: true, projectId: true },
    });
    expect(rows).toEqual([
      { id: 1, projectId: 3 },
      { id: 2, projectId: 4 },
    ]);
  });

  // Nothing else stops a row being inserted already completed.
  it("gates a create that is born completed", async () => {
    const rows = await resolveTransitioningRows(
      "sessions",
      "create",
      { data: { projectId: 12, isCompleted: true } },
      true,
      null,
      db
    );
    expect(rows).toEqual([{ id: 0, projectId: 12 }]);
  });

  it("ignores a create that is not completed", async () => {
    const rows = await resolveTransitioningRows(
      "sessions",
      "create",
      { data: { projectId: 12, isCompleted: false } },
      false,
      null,
      db
    );
    expect(rows).toEqual([]);
  });
});

describe("assertCanFlipCompletion", () => {
  const params = {
    model: "testRuns" as const,
    operation: "update",
    body: { where: { id: 5 }, data: { isCompleted: true } },
    actorUserId: "u1",
    preSnapshot: { id: 5, projectId: 9, isCompleted: false },
    db,
  };

  it("passes when the actor holds canClose", async () => {
    await expect(assertCanFlipCompletion(params)).resolves.toBeUndefined();
    expect(userHasAreaPermission).toHaveBeenCalledWith(
      "u1",
      9,
      "TestRuns",
      "canClose"
    );
  });

  it("throws COMPLETE_NOT_PERMITTED when the actor does not", async () => {
    userHasAreaPermission.mockResolvedValue(false);
    await expect(assertCanFlipCompletion(params)).rejects.toBeInstanceOf(
      CompletionPermissionError
    );
    await assertCanFlipCompletion(params).catch((err) => {
      expect(isCompletionPermissionError(err)).toBe(true);
      expect(err.code).toBe("COMPLETE_NOT_PERMITTED");
      expect(err.entityType).toBe("RUN");
      expect(err.entityIds).toEqual([5]);
    });
  });

  // Un-completing has no UI affordance at all, so the reversal is held to the
  // same bar as the action it reverses.
  it("gates the un-complete direction too", async () => {
    userHasAreaPermission.mockResolvedValue(false);
    await expect(
      assertCanFlipCompletion({
        ...params,
        body: { where: { id: 5 }, data: { isCompleted: false } },
        preSnapshot: { id: 5, projectId: 9, isCompleted: true },
      })
    ).rejects.toBeInstanceOf(CompletionPermissionError);
  });

  it("reports the session entity type for sessions", async () => {
    userHasAreaPermission.mockResolvedValue(false);
    await assertCanFlipCompletion({
      ...params,
      model: "sessions",
    }).catch((err) => {
      expect(err.entityType).toBe("SESSION");
    });
    expect(userHasAreaPermission).toHaveBeenCalledWith(
      "u1",
      9,
      "Sessions",
      "canClose"
    );
  });

  it("does nothing when the payload does not touch isCompleted", async () => {
    await assertCanFlipCompletion({
      ...params,
      body: { where: { id: 5 }, data: { stateId: 3 } },
    });
    expect(userHasAreaPermission).not.toHaveBeenCalled();
  });

  it("does nothing on a no-op re-save", async () => {
    userHasAreaPermission.mockResolvedValue(false);
    await expect(
      assertCanFlipCompletion({
        ...params,
        preSnapshot: { id: 5, projectId: 9, isCompleted: true },
      })
    ).resolves.toBeUndefined();
    expect(userHasAreaPermission).not.toHaveBeenCalled();
  });

  // A cross-project batch must not be waved through on one project's answer.
  it("resolves permission once per distinct project and rejects on any failure", async () => {
    db.testRuns.findMany.mockResolvedValue([
      { id: 1, projectId: 3 },
      { id: 2, projectId: 3 },
      { id: 4, projectId: 8 },
    ]);
    userHasAreaPermission.mockImplementation(
      async (_u: string, projectId: number) => projectId === 3
    );

    await assertCanFlipCompletion({
      ...params,
      operation: "updateMany",
      body: { where: { milestoneId: 7 }, data: { isCompleted: true } },
      preSnapshot: null,
    }).catch((err) => {
      expect(err.entityIds).toEqual([4]);
    });

    expect(userHasAreaPermission).toHaveBeenCalledTimes(2);
  });
});
