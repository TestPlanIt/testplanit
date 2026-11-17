import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

/**
 * Unit tests for the revert guard ladder.
 *
 * Every dependency is mocked: the point here is the ORDER and the OUTCOME of
 * the guards, not the database. The live-DB behaviour of the partial unique
 * index `review_request_one_pending_per_entity` is covered by the
 * supersession tests below via the translated error.
 *
 * Run:
 *   cd testplanit && pnpm test --run lib/services/reviewDecisionRevert.test.ts
 */

const DECIDER_ID = "user-decider";
const REQUESTER_ID = "user-requester";
const OTHER_ID = "user-other";
const REVIEW_ID = "rev-1";

const NOW = new Date("2026-10-27T12:00:00Z");

let systemFlagEnabled = true;
let loadedRequest: Record<string, unknown> | null;
let supersedingRow: { id: string } | null;
let appConfigValue: unknown;
let updateManyResult: { count: number };
let rowStillExists: boolean;
let updateManyError: unknown;
let entityStateId: number | null;

const updateManySpy = vi.fn();
const commentCreateSpy = vi.fn();
const notifySpy = vi.fn();
const webhookSpy = vi.fn();
const auditSpy = vi.fn();
const entityUpdateSpy = vi.fn();
const unconsumeSpy = vi.fn();

vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: vi.fn(async () => systemFlagEnabled),
}));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      reviewRequest: {
        updateMany: async (args: unknown) => {
          updateManySpy(args);
          if (updateManyError) throw updateManyError;
          // The un-consume sweep is a second updateMany with no `status` in
          // its WHERE; only the status flip returns the guarded count.
          const where = (args as { where: Record<string, unknown> }).where;
          if (!("status" in where)) {
            unconsumeSpy(args);
            return { count: 1 };
          }
          return updateManyResult;
        },
        findUnique: async () => (rowStillExists ? { id: REVIEW_ID } : null),
      },
      comment: {
        create: async (args: unknown) => {
          commentCreateSpy(args);
          return { id: "comment-1" };
        },
      },
      repositoryCases: {
        findUnique: async () => ({ stateId: entityStateId }),
        update: async (args: unknown) => {
          entityUpdateSpy(args);
          return {};
        },
      },
      testRuns: {
        findUnique: async () => ({ stateId: entityStateId }),
        update: async (args: unknown) => {
          entityUpdateSpy(args);
          return {};
        },
      },
      sessions: {
        findUnique: async () => ({ stateId: entityStateId }),
        update: async (args: unknown) => {
          entityUpdateSpy(args);
          return {};
        },
      },
    })
  ),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    reviewRequest: {
      findUniqueOrThrow: async () => {
        if (!loadedRequest) throw new Error("No ReviewRequest found");
        return loadedRequest;
      },
      findFirst: async () => supersedingRow,
      findUnique: async () => loadedRequest,
    },
    appConfig: {
      findUnique: async () =>
        appConfigValue === undefined ? null : { value: appConfigValue },
    },
    repositoryCases: { findUnique: async () => ({ name: "Case A" }) },
    testRuns: { findUnique: async () => ({ name: "Run A" }) },
    sessions: { findUnique: async () => ({ name: "Session A" }) },
  },
}));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createReviewDecisionRevertedNotification: (...a: unknown[]) => {
      notifySpy(...a);
      return Promise.resolve();
    },
  },
}));

vi.mock("~/lib/services/commentService", () => ({
  CommentService: { createCommentMentions: vi.fn(async () => undefined) },
}));

vi.mock("~/lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewRevertedEvent: (...a: unknown[]) => {
    webhookSpy(...a);
    return Promise.resolve();
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...a: unknown[]) => {
    auditSpy(...a);
    return Promise.resolve();
  },
}));

import { revertReviewDecision } from "./reviewDecisionRevert";
import {
  isIneligibleReverterError,
  isReviewSupersededError,
  isRevertWindowExpiredError,
  isFeatureDisabledError,
  isReviewEntityMovedError,
} from "~/lib/utils/errors";

function sessionFor(userId: string, access: string | null = null): Session {
  return {
    user: { id: userId, name: "Tester", email: "t@example.com", access },
    expires: NOW.toISOString(),
  } as unknown as Session;
}

function buildRequest(over: Record<string, unknown> = {}) {
  return {
    id: REVIEW_ID,
    status: "REJECTED",
    entityType: "CASE",
    entityId: 42,
    projectId: 7,
    fromStateId: 1,
    toStateId: 2,
    decisionComment: "not yet",
    decidedByUserId: DECIDER_ID,
    // 30 minutes before NOW — comfortably inside the 24h default.
    decidedAt: new Date("2026-10-27T11:30:00Z"),
    revertCount: 0,
    consumedAt: null,
    project: {
      id: 7,
      name: "Proj",
      reviewWorkflowEnabled: true,
      revertDecisionDurationSeconds: null,
    },
    requestedBy: { id: REQUESTER_ID, name: "Reqy" },
    fromState: { name: "Draft" },
    toState: { name: "Ready", color: { value: "#fff" } },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  systemFlagEnabled = true;
  loadedRequest = buildRequest();
  supersedingRow = null;
  appConfigValue = undefined;
  updateManyResult = { count: 1 };
  rowStillExists = true;
  updateManyError = undefined;
  entityStateId = 2; // the request's toStateId
});

describe("revertReviewDecision — feature flags", () => {
  it("refuses when the system flag is off", async () => {
    systemFlagEnabled = false;
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isFeatureDisabledError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });

  it("refuses when the project flag is off", async () => {
    loadedRequest = buildRequest({
      project: {
        id: 7,
        name: "Proj",
        reviewWorkflowEnabled: false,
        revertDecisionDurationSeconds: null,
      },
    });
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isFeatureDisabledError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });
});

describe("revertReviewDecision — revertable statuses", () => {
  it.each(["CHANGES_REQUESTED", "REJECTED"])("reverts %s", async (status) => {
    loadedRequest = buildRequest({ status });
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).resolves.toBeDefined();
    expect(updateManySpy).toHaveBeenCalledTimes(1);
  });

  it("reverts APPROVED", async () => {
    loadedRequest = buildRequest({ status: "APPROVED" });
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).resolves.toBeDefined();
    expect(updateManySpy).toHaveBeenCalled();
  });

  // Never decided / withdrawn rather than judged — nothing to undo.
  it.each(["PENDING", "CANCELLED"])(
    "refuses %s without mutating anything",
    async (status) => {
      loadedRequest = buildRequest({ status });
      await expect(
        revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
      ).rejects.toThrow(/not revertable/i);
      expect(updateManySpy).not.toHaveBeenCalled();
    }
  );
});

describe("revertReviewDecision — eligibility", () => {
  it("allows the decider", async () => {
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).resolves.toBeDefined();
  });

  it("allows a system admin who did not decide", async () => {
    await expect(
      revertReviewDecision(sessionFor(OTHER_ID, "ADMIN"), REVIEW_ID)
    ).resolves.toBeDefined();
  });

  it("refuses an unrelated user", async () => {
    await expect(
      revertReviewDecision(sessionFor(OTHER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isIneligibleReverterError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });

  // The requester must not be able to reopen their own rejection — that
  // would defeat the review gate.
  it("refuses the requester", async () => {
    await expect(
      revertReviewDecision(sessionFor(REQUESTER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isIneligibleReverterError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });
});

describe("revertReviewDecision — the window", () => {
  it("refuses the decider once the default 24h window has elapsed", async () => {
    loadedRequest = buildRequest({
      decidedAt: new Date("2026-10-26T11:00:00Z"), // 25h ago
    });
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isRevertWindowExpiredError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });

  // Documented behaviour (Brad, 2026-10-27): admins inherit the
  // assertResultEditWindowOpen bypass and may revert a decision of any age.
  it("lets a system admin revert a year-old decision", async () => {
    loadedRequest = buildRequest({
      decidedAt: new Date("2025-10-27T12:00:00Z"),
    });
    await expect(
      revertReviewDecision(sessionFor(OTHER_ID, "ADMIN"), REVIEW_ID)
    ).resolves.toBeDefined();
  });

  it("honours a tighter project override", async () => {
    loadedRequest = buildRequest({
      decidedAt: new Date("2026-10-27T11:30:00Z"), // 30 min ago
      project: {
        id: 7,
        name: "Proj",
        reviewWorkflowEnabled: true,
        revertDecisionDurationSeconds: 600, // 10 min
      },
    });
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isRevertWindowExpiredError);
  });

  it("treats a system policy of 0 as reverting disabled", async () => {
    appConfigValue = 0;
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isRevertWindowExpiredError);
  });

  it("still lets an admin through when reverting is disabled", async () => {
    appConfigValue = 0;
    await expect(
      revertReviewDecision(sessionFor(OTHER_ID, "ADMIN"), REVIEW_ID)
    ).resolves.toBeDefined();
  });
});

describe("revertReviewDecision — supersession", () => {
  it("refuses when a newer PENDING request exists for the entity", async () => {
    supersedingRow = { id: "rev-2" };
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isReviewSupersededError);
    expect(updateManySpy).not.toHaveBeenCalled();
  });

  // The pre-check cannot close the window; the partial unique index is the
  // real authority, and its violation must surface as the same typed error.
  it("translates the unique-index violation into a superseded error", async () => {
    updateManyError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "review_request_one_pending_per_entity"'
      ),
      { code: "23505" }
    );
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isReviewSupersededError);
  });
});

describe("revertReviewDecision — the write", () => {
  it("clears the decision fields, flips to PENDING and stamps the reverter", async () => {
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);

    const args = updateManySpy.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Scoped to the prior status so two concurrent reverts cannot both win.
    expect(args.where).toEqual({ id: REVIEW_ID, status: "REJECTED" });
    expect(args.data).toMatchObject({
      status: "PENDING",
      decisionComment: null,
      decidedByUserId: null,
      decidedAt: null,
      consumedAt: null,
      revertedByUserId: DECIDER_ID,
      revertCount: 1,
    });
    expect(args.data.revertedAt).toBeInstanceOf(Date);
  });

  it("increments revertCount from the existing value", async () => {
    loadedRequest = buildRequest({ revertCount: 3 });
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);
    const args = updateManySpy.mock.calls[0][0] as {
      data: { revertCount: number };
    };
    expect(args.data.revertCount).toBe(4);
  });

  it("writes a thread comment naming the reverter, in the same transaction", async () => {
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);
    expect(commentCreateSpy).toHaveBeenCalledTimes(1);
    const args = commentCreateSpy.mock.calls[0][0] as {
      data: {
        type: string;
        reviewRequestId: string;
        repositoryCaseId: number;
        content: unknown;
      };
    };
    expect(args.data.type).toBe("REVIEW_DECISION");
    expect(args.data.reviewRequestId).toBe(REVIEW_ID);
    expect(args.data.repositoryCaseId).toBe(42);
    expect(JSON.stringify(args.data.content)).toContain("reverted their");
  });

  it("reports 'not revertable' when a concurrent write won the race", async () => {
    updateManyResult = { count: 0 };
    rowStillExists = true;
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toThrow(/not revertable/i);
  });

  it("reports not-found when the row disappeared mid-flight", async () => {
    updateManyResult = { count: 0 };
    rowStillExists = false;
    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toThrow(/No ReviewRequest found/i);
  });
});

describe("revertReviewDecision — side channels", () => {
  it("notifies the requester, emits the webhook and records the audit entry", async () => {
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0][0]).toMatchObject({
      requesterUserId: REQUESTER_ID,
      reverterUserId: DECIDER_ID,
      revertedDecision: "REJECTED",
    });

    expect(webhookSpy).toHaveBeenCalledTimes(1);
    expect(webhookSpy.mock.calls[0][0]).toMatchObject({
      reviewRequestId: REVIEW_ID,
      revertedDecision: "REJECTED",
      revertedDecisionComment: "not yet",
      revertCount: 1,
    });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      action: "REVIEW_DECISION_REVERTED",
      entityType: "ReviewRequest",
      entityId: REVIEW_ID,
    });
    // The row no longer holds the decision, so the audit entry must carry it.
    expect(
      (auditSpy.mock.calls[0][0] as { metadata: Record<string, unknown> })
        .metadata
    ).toMatchObject({
      revertedDecision: "REJECTED",
      revertedDecisionComment: "not yet",
    });
  });

  it("keeps the revert when a side channel throws", async () => {
    notifySpy.mockImplementation(() => {
      throw new Error("notification down");
    });
    webhookSpy.mockImplementation(() => {
      throw new Error("webhook down");
    });
    auditSpy.mockImplementation(() => {
      throw new Error("audit down");
    });

    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).resolves.toBeDefined();
    expect(updateManySpy).toHaveBeenCalledTimes(1);
  });
});

describe("revertReviewDecision — undoing an approval's transition", () => {
  it("rolls the entity back to fromStateId when the approval was consumed", async () => {
    loadedRequest = buildRequest({
      status: "APPROVED",
      consumedAt: new Date("2026-10-27T11:30:00Z"),
    });
    entityStateId = 2; // still where the approval put it

    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);

    expect(entityUpdateSpy).toHaveBeenCalledTimes(1);
    expect(entityUpdateSpy.mock.calls[0][0]).toEqual({
      where: { id: 42 },
      data: { stateId: 1 }, // fromStateId
    });
  });

  it("does not touch the entity when the approval was never consumed", async () => {
    loadedRequest = buildRequest({ status: "APPROVED", consumedAt: null });
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);
    expect(entityUpdateSpy).not.toHaveBeenCalled();
    expect(unconsumeSpy).not.toHaveBeenCalled();
  });

  // Forcing the entity back would regress whatever moved it on.
  it("refuses when the entity has moved past the approved state", async () => {
    loadedRequest = buildRequest({
      status: "APPROVED",
      consumedAt: new Date("2026-10-27T11:30:00Z"),
    });
    entityStateId = 5;

    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isReviewEntityMovedError);
    expect(entityUpdateSpy).not.toHaveBeenCalled();
  });

  it("refuses when the entity no longer exists", async () => {
    loadedRequest = buildRequest({
      status: "APPROVED",
      consumedAt: new Date("2026-10-27T11:30:00Z"),
    });
    entityStateId = null;

    await expect(
      revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID)
    ).rejects.toSatisfy(isReviewEntityMovedError);
  });

  // A strict-transitive crossing can spend several approvals at once, all
  // stamped with one `consumedAt`. Releasing the group stops a revert from
  // silently burning the other gates' approvals.
  it("un-consumes every approval the same crossing spent", async () => {
    const consumedAt = new Date("2026-10-27T11:30:00Z");
    loadedRequest = buildRequest({ status: "APPROVED", consumedAt });

    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);

    expect(unconsumeSpy).toHaveBeenCalledTimes(1);
    const args = unconsumeSpy.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      entityType: "CASE",
      entityId: 42,
      consumedAt,
      id: { not: REVIEW_ID },
    });
    expect(args.data).toEqual({ consumedAt: null });
  });

  it("reports the approval in the audit entry and webhook", async () => {
    loadedRequest = buildRequest({
      status: "APPROVED",
      consumedAt: new Date("2026-10-27T11:30:00Z"),
    });
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);

    expect(webhookSpy.mock.calls[0][0]).toMatchObject({
      revertedDecision: "APPROVED",
    });
    expect(
      (auditSpy.mock.calls[0][0] as { metadata: Record<string, unknown> })
        .metadata
    ).toMatchObject({ revertedDecision: "APPROVED" });
  });

  it("names the approval in the thread comment", async () => {
    loadedRequest = buildRequest({
      status: "APPROVED",
      consumedAt: new Date("2026-10-27T11:30:00Z"),
    });
    await revertReviewDecision(sessionFor(DECIDER_ID), REVIEW_ID);
    const args = commentCreateSpy.mock.calls[0][0] as {
      data: { content: unknown };
    };
    expect(JSON.stringify(args.data.content)).toContain("approval");
  });
});
