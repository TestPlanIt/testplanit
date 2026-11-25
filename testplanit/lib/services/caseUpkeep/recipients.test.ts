import { describe, expect, it, vi } from "vitest";
import {
  draftRuleRecipients,
  namedRecipients,
  projectAdminIds,
  reviewersOf,
  upkeepRecipients,
} from "./recipients";

function makeDb(
  opts: {
    groupMembers?: string[];
    draftedOptions?: unknown;
    drafted?: boolean;
    project?: { createdBy: string; assignedUsers: { userId: string }[] } | null;
    liveUsers?: string[] | null;
    systemAdmins?: string[];
  } = {}
) {
  return {
    groupAssignment: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          (opts.groupMembers ?? []).map((userId) => ({ userId }))
        ),
    },
    webhookActionLog: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.drafted === false
            ? null
            : opts.draftedOptions === undefined
              ? null
              : { webhookAction: { options: opts.draftedOptions } }
        ),
    },
    projects: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.project === undefined
            ? { createdBy: "creator", assignedUsers: [{ userId: "pa-1" }] }
            : opts.project
        ),
    },
    user: {
      findMany: vi.fn(async (args: any) =>
        args.where.access === "ADMIN"
          ? (opts.systemAdmins ?? []).map((id) => ({ id }))
          : (opts.liveUsers ?? (args.where.id.in as string[]))
              .filter((id: string) => args.where.id.in.includes(id))
              .map((id: string) => ({ id }))
      ),
    },
  };
}

describe("namedRecipients", () => {
  it("returns the listed users and the members of the listed groups, once each", async () => {
    const db = makeDb({ groupMembers: ["u2", "u3"] });
    expect(
      await namedRecipients(db, {
        notifyUserIds: ["u1", "u2"],
        notifyGroupIds: [4],
      })
    ).toEqual(["u1", "u2", "u3"]);
    expect(db.groupAssignment.findMany).toHaveBeenCalledWith({
      where: { groupId: { in: [4] } },
      select: { userId: true },
    });
  });

  it("does not look up groups when none are named", async () => {
    const db = makeDb();
    expect(await namedRecipients(db, {})).toEqual([]);
    expect(await namedRecipients(db, { notifyGroupIds: [] })).toEqual([]);
    expect(db.groupAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("draftRuleRecipients", () => {
  it("reads the recipients of the rule that last drafted for the issue", async () => {
    const db = makeDb({ draftedOptions: { notifyUserIds: ["d1"] } });
    expect(await draftRuleRecipients(db, 7, 100)).toEqual(["d1"]);
    expect(db.webhookActionLog.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 7,
        issueId: 100,
        outcome: "cases_drafted",
        webhookActionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { webhookAction: { select: { options: true } } },
    });
  });

  it("is empty when nothing drafted, the rule is gone, or its options are unreadable", async () => {
    expect(
      await draftRuleRecipients(makeDb({ drafted: false }), 7, 100)
    ).toEqual([]);
    const gone = makeDb();
    gone.webhookActionLog.findFirst.mockResolvedValue({ webhookAction: null });
    expect(await draftRuleRecipients(gone, 7, 100)).toEqual([]);
    expect(
      await draftRuleRecipients(makeDb({ draftedOptions: "nonsense" }), 7, 100)
    ).toEqual([]);
  });
});

describe("projectAdminIds", () => {
  it("returns the creator and the assigned project administrators, once each", async () => {
    const db = makeDb({
      project: {
        createdBy: "creator",
        assignedUsers: [{ userId: "pa-1" }, { userId: "creator" }],
      },
    });
    expect(await projectAdminIds(db, 7)).toEqual(["creator", "pa-1"]);
    expect(db.projects.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: {
        createdBy: true,
        assignedUsers: {
          where: {
            user: { access: "PROJECTADMIN", isActive: true, isDeleted: false },
          },
          select: { userId: true },
        },
      },
    });
  });

  it("is empty for a project that is gone", async () => {
    expect(await projectAdminIds(makeDb({ project: null }), 7)).toEqual([]);
  });
});

describe("upkeepRecipients", () => {
  const base = { projectId: 7, issueId: 100 };

  it("uses the rule's own recipients when it names any", async () => {
    const db = makeDb({ draftedOptions: { notifyUserIds: ["d1"] } });
    expect(
      await upkeepRecipients(db, {
        ...base,
        options: { notifyUserIds: ["u1"] },
      })
    ).toEqual(["u1"]);
    expect(db.webhookActionLog.findFirst).not.toHaveBeenCalled();
    expect(db.projects.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the Draft rule's recipients", async () => {
    const db = makeDb({ draftedOptions: { notifyUserIds: ["d1"] } });
    expect(await upkeepRecipients(db, { ...base, options: {} })).toEqual([
      "d1",
    ]);
    expect(db.projects.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the project's administrators last", async () => {
    const db = makeDb({ drafted: false });
    expect(await upkeepRecipients(db, { ...base, options: {} })).toEqual([
      "creator",
      "pa-1",
    ]);
  });

  it("adds reviewers and requesters to whichever list applies, once each", async () => {
    const db = makeDb();
    expect(
      await upkeepRecipients(db, {
        ...base,
        options: { notifyUserIds: ["u1"] },
        alsoTell: ["rev-1", null, "u1", undefined, "req-1"],
      })
    ).toEqual(["u1", "rev-1", "req-1"]);
  });

  it("tells the system administrators when nobody in the chain is an active user", async () => {
    const db = makeDb({
      project: { createdBy: "gone", assignedUsers: [] },
      liveUsers: ["reviewer"],
      systemAdmins: ["admin-1", "admin-2"],
    });
    expect(
      await upkeepRecipients(db, {
        ...base,
        options: {},
        alsoTell: ["reviewer"],
      })
    ).toEqual(["admin-1", "admin-2", "reviewer"]);
    expect(db.user.findMany).toHaveBeenLastCalledWith({
      where: {
        access: "ADMIN",
        id: { not: "system-automation-user" },
        isActive: true,
        isDeleted: false,
      },
      select: { id: true },
    });
  });

  it("tells the system administrators when the project is gone and nobody is named", async () => {
    const db = makeDb({ project: null, systemAdmins: ["admin-1"] });
    expect(await upkeepRecipients(db, { ...base, options: {} })).toEqual([
      "admin-1",
    ]);
  });

  it("does not add system administrators when someone in the chain is active", async () => {
    const db = makeDb({ systemAdmins: ["admin-1"] });
    expect(await upkeepRecipients(db, { ...base, options: {} })).toEqual([
      "creator",
      "pa-1",
    ]);
  });

  it("leaves out the System user and anyone inactive or deleted", async () => {
    const db = makeDb({ liveUsers: ["u1"] });
    expect(
      await upkeepRecipients(db, {
        ...base,
        options: { notifyUserIds: ["u1", "gone"] },
        alsoTell: ["system-automation-user"],
      })
    ).toEqual(["u1"]);
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["u1", "gone", "system-automation-user"],
          not: "system-automation-user",
        },
        isActive: true,
        isDeleted: false,
      },
      select: { id: true },
    });
  });

  it("returns nobody when every list is empty and there is no system administrator", async () => {
    const db = makeDb({ drafted: false, project: null });
    expect(await upkeepRecipients(db, { ...base, options: {} })).toEqual([]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("reviewersOf", () => {
  const reviewDb = (approvals: unknown[] = []) => ({
    reviewRequest: { findMany: vi.fn().mockResolvedValue(approvals) },
  });

  it("returns nobody, without a lookup, when no case has a reviewer", async () => {
    const db = reviewDb();
    expect(await reviewersOf(db, [{ id: 1, reviewedById: null }])).toEqual([]);
    expect(db.reviewRequest.findMany).not.toHaveBeenCalled();
  });

  it("returns each reviewer and the requester of the review that reviewer approved", async () => {
    const db = reviewDb([
      { entityId: 1, requestedByUserId: "req-1", decidedByUserId: "rev-1" },
      {
        entityId: 1,
        requestedByUserId: "req-old",
        decidedByUserId: "someone-else",
      },
      { entityId: 2, requestedByUserId: "req-2", decidedByUserId: "rev-1" },
    ]);
    expect(
      await reviewersOf(db, [
        { id: 1, reviewedById: "rev-1" },
        { id: 2, reviewedById: "rev-2" },
        { id: 3, reviewedById: null },
      ])
    ).toEqual(["rev-1", "req-1", "rev-2"]);
    expect(db.reviewRequest.findMany).toHaveBeenCalledWith({
      where: {
        entityType: "CASE",
        entityId: { in: [1, 2] },
        status: "APPROVED",
      },
      select: {
        entityId: true,
        requestedByUserId: true,
        decidedByUserId: true,
      },
    });
  });
});
