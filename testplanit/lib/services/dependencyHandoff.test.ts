import { beforeEach, describe, expect, it, vi } from "vitest";

const createRunCaseUnblockedNotification = vi.hoisted(() => vi.fn());
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: { createRunCaseUnblockedNotification },
}));

import { notifyUnblockedDependants } from "./dependencyHandoff";

const base = {
  actorUserId: "crm",
  testRunId: 50,
  testRunName: "Order to billing",
  projectId: 3,
  projectName: "Telco",
  prerequisiteCaseName: "Create order",
};

describe("notifyUnblockedDependants", () => {
  beforeEach(() => {
    createRunCaseUnblockedNotification.mockReset();
    createRunCaseUnblockedNotification.mockResolvedValue(undefined);
  });

  it("notifies each assigned dependant with the run, case and prerequisite", async () => {
    await notifyUnblockedDependants({
      ...base,
      dependants: [
        {
          testRunCaseId: 20,
          repositoryCaseId: 2,
          name: "Verify provisioning",
          assignedToId: "prov",
        },
        {
          testRunCaseId: 40,
          repositoryCaseId: 4,
          name: "Validate billing",
          assignedToId: "bill",
        },
      ],
    });

    expect(createRunCaseUnblockedNotification).toHaveBeenCalledTimes(2);
    expect(createRunCaseUnblockedNotification).toHaveBeenCalledWith({
      userId: "prov",
      testRunId: 50,
      testRunName: "Order to billing",
      projectId: 3,
      projectName: "Telco",
      testRunCaseId: 20,
      testCaseId: 2,
      testCaseName: "Verify provisioning",
      prerequisiteCaseName: "Create order",
      unblockedById: "crm",
    });
  });

  it("skips unassigned dependants and the actor's own cases", async () => {
    await notifyUnblockedDependants({
      ...base,
      dependants: [
        {
          testRunCaseId: 20,
          repositoryCaseId: 2,
          name: "A",
          assignedToId: null,
        },
        {
          testRunCaseId: 30,
          repositoryCaseId: 3,
          name: "B",
          assignedToId: "crm",
        },
        {
          testRunCaseId: 40,
          repositoryCaseId: 4,
          name: "C",
          assignedToId: "bill",
        },
      ],
    });

    expect(createRunCaseUnblockedNotification).toHaveBeenCalledTimes(1);
    expect(createRunCaseUnblockedNotification.mock.calls[0][0].userId).toBe(
      "bill"
    );
  });

  it("keeps going when one delivery fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    createRunCaseUnblockedNotification
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      notifyUnblockedDependants({
        ...base,
        dependants: [
          {
            testRunCaseId: 20,
            repositoryCaseId: 2,
            name: "A",
            assignedToId: "x",
          },
          {
            testRunCaseId: 40,
            repositoryCaseId: 4,
            name: "C",
            assignedToId: "y",
          },
        ],
      })
    ).resolves.toBeUndefined();

    expect(createRunCaseUnblockedNotification).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
