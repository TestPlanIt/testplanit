import { beforeEach, describe, expect, it, vi } from "vitest";

const createNotification = vi.fn(async (_payload: unknown) => undefined);
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: (payload: unknown) => createNotification(payload),
  },
}));

import {
  notifyRunCaseAssignment,
  notifySessionAssignment,
} from "./assignmentNotifications";

const runCase = (id: number, runId: number) => ({
  id,
  repositoryCaseId: 100 + id,
  repositoryCase: { name: `Case ${id}` },
  testRun: { id: runId, name: `Run ${runId}`, project: { id: 1, name: "Web" } },
});

const db = (rows: unknown[]) =>
  ({
    testRunCases: { findMany: vi.fn(async () => rows) },
    sessions: {
      findUnique: vi.fn(async () => ({
        id: 5,
        name: "Explore checkout",
        project: { id: 1, name: "Web" },
      })),
    },
  }) as any;

const actor = { id: "u-lead", name: "Lead" };

describe("notifyRunCaseAssignment", () => {
  beforeEach(() => createNotification.mockClear());

  it("sends the single-case notification for one run case", async () => {
    await notifyRunCaseAssignment(db([runCase(1, 7)]), {
      testRunCaseIds: [1],
      assignedToId: "u-tester",
      actor,
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0]![0]).toMatchObject({
      userId: "u-tester",
      type: "WORK_ASSIGNED",
      title: "New Test Case Assignment",
      message: 'Lead assigned you to test case "Case 1" in project "Web"',
      relatedEntityId: "1",
      relatedEntityType: "TestRunCase",
      data: {
        assignedById: "u-lead",
        testRunId: 7,
        testCaseId: 101,
        projectId: 1,
      },
    });
  });

  it("sends one bulk notification grouped by run for several run cases", async () => {
    await notifyRunCaseAssignment(
      db([runCase(1, 7), runCase(2, 7), runCase(3, 8)]),
      {
        testRunCaseIds: [1, 2, 3],
        assignedToId: "u-tester",
        actor: { id: "u-lead", name: null },
      }
    );
    expect(createNotification).toHaveBeenCalledTimes(1);
    const payload = createNotification.mock.calls[0]![0] as any;
    expect(payload).toMatchObject({
      title: "Multiple Test Cases Assigned",
      message: "Unknown User assigned you 3 test cases",
      data: { count: 3, isBulkAssignment: true },
    });
    expect(
      payload.data.testRunGroups.map((g: any) => [
        g.testRunId,
        g.testCases.length,
      ])
    ).toEqual([
      [7, 2],
      [8, 1],
    ]);
  });

  it("stays quiet when the run cases are gone", async () => {
    await notifyRunCaseAssignment(db([]), {
      testRunCaseIds: [9],
      assignedToId: "u",
      actor,
    });
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("notifySessionAssignment", () => {
  beforeEach(() => createNotification.mockClear());

  it("sends the session notification", async () => {
    await notifySessionAssignment(db([]), {
      sessionId: 5,
      assignedToId: "u-tester",
      actor,
    });
    expect(createNotification.mock.calls[0]![0]).toMatchObject({
      type: "SESSION_ASSIGNED",
      relatedEntityId: "5",
      relatedEntityType: "Session",
      message:
        'Lead assigned you to session "Explore checkout" in project "Web"',
      data: { sessionId: 5, projectId: 1 },
    });
  });
});
