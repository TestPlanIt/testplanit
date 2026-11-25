import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  recipients: vi.fn(),
  reviewers: vi.fn(),
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: { createCasesUpdatedNotification: mocks.notify },
}));
vi.mock("./recipients", () => ({
  upkeepRecipients: mocks.recipients,
  reviewersOf: mocks.reviewers,
}));

import { remindAboutWaitingSuggestions } from "./reminders";

const NOW = new Date("2026-11-25T10:00:00Z");
const CUTOFF = new Date("2026-11-24T10:00:00Z");

const waiting = (
  id: number,
  extra: {
    issueId?: number;
    webhookActionId?: string | null;
    caseId?: number;
    reviewedById?: string | null;
    externalKey?: string | null;
  } = {}
) => ({
  id,
  projectId: 7,
  issueId: extra.issueId ?? 100,
  webhookActionId:
    extra.webhookActionId === undefined ? "rule-1" : extra.webhookActionId,
  case: {
    id: extra.caseId ?? id + 10,
    reviewedById: extra.reviewedById ?? null,
  },
  issue: {
    name: "DEMO-42",
    externalKey:
      extra.externalKey === undefined ? "DEMO-42" : extra.externalKey,
    title: "Checkout totals",
  },
});

function makeDb(
  rows: ReturnType<typeof waiting>[],
  opts: { rule?: unknown; project?: unknown } = {}
) {
  return {
    caseChangeSuggestion: {
      findMany: vi.fn().mockResolvedValue(rows),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    webhookAction: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.rule === undefined
            ? { options: { notifyUserIds: ["u1"] } }
            : opts.rule
        ),
    },
    projects: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.project === undefined ? { name: "Shop" } : opts.project
        ),
    },
  };
}

const run = (db: ReturnType<typeof makeDb>) =>
  remindAboutWaitingSuggestions(db, {
    cutoff: CUTOFF,
    now: NOW,
    tenantId: "t1",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recipients.mockResolvedValue(["u1"]);
  mocks.reviewers.mockResolvedValue([]);
});

describe("remindAboutWaitingSuggestions", () => {
  it("looks for undecided suggestions older than the threshold that have not been reminded about since", async () => {
    const db = makeDb([]);
    expect(await run(db)).toEqual({ reminders: 0, suggestions: 0 });
    expect(db.caseChangeSuggestion.findMany.mock.calls[0][0].where).toEqual({
      status: "PENDING",
      createdAt: { lt: CUTOFF },
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: CUTOFF } }],
      case: { isDeleted: false },
      issue: { isDeleted: false },
    });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(db.caseChangeSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it("sends one reminder per person for an issue, counting every case waiting, and stamps them", async () => {
    mocks.recipients.mockResolvedValue(["u1", "rev-1"]);
    mocks.reviewers.mockResolvedValue(["rev-1"]);
    const db = makeDb([
      waiting(1, { reviewedById: "rev-1" }),
      waiting(2),
      waiting(3),
    ]);

    expect(await run(db)).toEqual({ reminders: 2, suggestions: 3 });

    expect(mocks.reviewers).toHaveBeenCalledWith(db, [
      { id: 11, reviewedById: "rev-1" },
      { id: 12, reviewedById: null },
      { id: 13, reviewedById: null },
    ]);
    expect(mocks.recipients).toHaveBeenCalledWith(db, {
      projectId: 7,
      issueId: 100,
      options: { notifyUserIds: ["u1"] },
      alsoTell: ["rev-1"],
    });
    expect(mocks.notify.mock.calls.map((c) => c[0])).toEqual(
      ["u1", "rev-1"].map((userId) => ({
        userId,
        kind: "reminder",
        projectId: 7,
        projectName: "Shop",
        issueId: 100,
        issueKey: "DEMO-42",
        issueTitle: "Checkout totals",
        suggested: 3,
        tenantId: "t1",
      }))
    );
    expect(db.caseChangeSuggestion.updateMany).toHaveBeenCalledTimes(1);
    expect(db.caseChangeSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      data: { lastRemindedAt: NOW },
    });
  });

  it("reminds separately for each issue and for each rule", async () => {
    const db = makeDb([
      waiting(1),
      waiting(2, { issueId: 101 }),
      waiting(3, { webhookActionId: "rule-2" }),
    ]);
    expect(await run(db)).toEqual({ reminders: 3, suggestions: 3 });
    expect(mocks.notify.mock.calls.map((c) => c[0].issueId)).toEqual([
      100, 101, 100,
    ]);
    expect(mocks.notify.mock.calls.every((c) => c[0].suggested === 1)).toBe(
      true
    );
    expect(db.caseChangeSuggestion.updateMany).toHaveBeenCalledTimes(3);
  });

  it("uses no rule options when the suggestion names no rule, or the rule is gone", async () => {
    const noRule = makeDb([waiting(1, { webhookActionId: null })]);
    await run(noRule);
    expect(noRule.webhookAction.findUnique).not.toHaveBeenCalled();
    expect(mocks.recipients.mock.calls[0][1].options).toEqual({});

    const ruleGone = makeDb([waiting(1)], { rule: null });
    await run(ruleGone);
    expect(mocks.recipients.mock.calls[1][1].options).toEqual({});
  });

  it("names the issue by its own name without a tracker key, and copes with a missing project", async () => {
    const db = makeDb([waiting(1, { externalKey: null })], { project: null });
    await run(db);
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      issueKey: "DEMO-42",
      projectName: "",
    });
  });

  it("stamps suggestions nobody could be told about, so they are not looked up again every hour", async () => {
    mocks.recipients.mockResolvedValue([]);
    const db = makeDb([waiting(1)]);
    expect(await run(db)).toEqual({ reminders: 0, suggestions: 1 });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(db.caseChangeSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { lastRemindedAt: NOW },
    });
  });
});
