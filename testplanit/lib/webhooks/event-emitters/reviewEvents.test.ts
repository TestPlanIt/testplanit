import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = Symbol("tx");
      return fn(tx);
    }),
  },
}));

import { prisma } from "~/lib/prisma";
import { webhookEvents } from "~/lib/webhooks/events";
import {
  emitReviewCompletedEvent,
  emitReviewRequestedEvent,
} from "./reviewEvents";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function baseRequestedInput() {
  return {
    reviewRequestId: "rr_1",
    projectId: 7,
    entityType: "CASE" as const,
    entityId: 42,
    entityName: "Login flow",
    fromStateId: 10,
    fromStateName: "Draft",
    toStateId: 11,
    toStateName: "Ready",
    toStateColor: "#22c55e",
    requestedByUserId: "u-req",
    requesterName: "Alice",
    assigneeUserId: "u-rev",
    assigneeUserName: "Bob",
    assigneeRoleId: null,
    assigneeRoleName: null,
    commentText: "Please review.",
  };
}

function baseCompletedInput() {
  return {
    reviewRequestId: "rr_1",
    projectId: 7,
    entityType: "CASE" as const,
    entityId: 42,
    entityName: "Login flow",
    fromStateId: 10,
    toStateId: 11,
    toStateName: "Ready",
    toStateColor: "#22c55e",
    decision: "APPROVED" as const,
    decidedByUserId: "u-rev",
    deciderName: "Bob",
    decisionComment: "Looks good.",
    requestedByUserId: "u-req",
    requesterName: "Alice",
  };
}

describe("emitReviewRequestedEvent — event name routing", () => {
  beforeEach(() => {
    emitMock.mockClear();
    txMock.mockClear();
  });

  it("CASE entity fans out to case.review_requested", async () => {
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "CASE" },
      { tx: tx as never }
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toBe("case.review_requested");
    expect(emitMock.mock.calls[0][2]).toMatchObject({ projectId: 7, tx });
  });

  it("RUN entity fans out to test_run.review_requested", async () => {
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "RUN" },
      { tx: tx as never }
    );
    expect(emitMock.mock.calls[0][0]).toBe("test_run.review_requested");
  });

  it("SESSION entity fans out to session.review_requested", async () => {
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "SESSION" },
      { tx: tx as never }
    );
    expect(emitMock.mock.calls[0][0]).toBe("session.review_requested");
  });

  it("when no tx provided, wraps emit in a $transaction", async () => {
    await emitReviewRequestedEvent(baseRequestedInput());
    expect(txMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});

describe("emitReviewRequestedEvent — payload shape", () => {
  beforeEach(() => {
    emitMock.mockClear();
    txMock.mockClear();
  });

  it("includes identity, state, and entity-typed URL for CASE", async () => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "CASE" },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      reviewRequestId: "rr_1",
      projectId: 7,
      entityType: "CASE",
      entityId: 42,
      entityName: "Login flow",
      entityUrl: "http://app.example.com/projects/repository/7/42",
      fromStateId: 10,
      fromStateName: "Draft",
      toStateId: 11,
      toStateName: "Ready",
      toStateColor: "#22c55e",
      requestedByUserId: "u-req",
      requesterName: "Alice",
      assigneeUserId: "u-rev",
      assigneeUserName: "Bob",
      assigneeRoleId: null,
      assigneeRoleName: null,
      commentText: "Please review.",
    });
  });

  it("builds a /projects/runs/<projectId>/<entityId> URL for RUN", async () => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "RUN", entityId: 99 },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.entityUrl).toBe("http://app.example.com/projects/runs/7/99");
  });

  it("builds a /projects/sessions/<projectId>/<entityId> URL for SESSION", async () => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), entityType: "SESSION", entityId: 33 },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.entityUrl).toBe(
      "http://app.example.com/projects/sessions/7/33"
    );
  });

  it("caps commentText larger than 4 KB with the truncated-bytes marker", async () => {
    const tx = Symbol("test-tx");
    const bigComment = "x".repeat(5 * 1024);
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), commentText: bigComment },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.commentText).toMatch(/^<value truncated: \d+ bytes>$/);
  });

  it("passes through null commentText unchanged", async () => {
    const tx = Symbol("test-tx");
    await emitReviewRequestedEvent(
      { ...baseRequestedInput(), commentText: null },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.commentText).toBeNull();
  });
});

describe("emitReviewCompletedEvent", () => {
  beforeEach(() => {
    emitMock.mockClear();
    txMock.mockClear();
  });

  it("CASE entity fans out to case.review_completed", async () => {
    const tx = Symbol("test-tx");
    await emitReviewCompletedEvent(
      { ...baseCompletedInput(), entityType: "CASE" },
      { tx: tx as never }
    );
    expect(emitMock.mock.calls[0][0]).toBe("case.review_completed");
  });

  it("RUN entity fans out to test_run.review_completed", async () => {
    const tx = Symbol("test-tx");
    await emitReviewCompletedEvent(
      { ...baseCompletedInput(), entityType: "RUN" },
      { tx: tx as never }
    );
    expect(emitMock.mock.calls[0][0]).toBe("test_run.review_completed");
  });

  it("SESSION entity fans out to session.review_completed", async () => {
    const tx = Symbol("test-tx");
    await emitReviewCompletedEvent(
      { ...baseCompletedInput(), entityType: "SESSION" },
      { tx: tx as never }
    );
    expect(emitMock.mock.calls[0][0]).toBe("session.review_completed");
  });

  it("payload carries decision + decider + comment + entity URL", async () => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
    const tx = Symbol("test-tx");
    await emitReviewCompletedEvent(
      { ...baseCompletedInput(), decision: "CHANGES_REQUESTED" },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      reviewRequestId: "rr_1",
      projectId: 7,
      entityType: "CASE",
      entityId: 42,
      entityName: "Login flow",
      entityUrl: "http://app.example.com/projects/repository/7/42",
      toStateName: "Ready",
      toStateColor: "#22c55e",
      decision: "CHANGES_REQUESTED",
      decidedByUserId: "u-rev",
      deciderName: "Bob",
      decisionComment: "Looks good.",
      requestedByUserId: "u-req",
      requesterName: "Alice",
    });
  });

  it("caps decisionComment larger than 4 KB", async () => {
    const tx = Symbol("test-tx");
    const big = "y".repeat(5 * 1024);
    await emitReviewCompletedEvent(
      { ...baseCompletedInput(), decisionComment: big },
      { tx: tx as never }
    );
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.decisionComment).toMatch(/^<value truncated: \d+ bytes>$/);
  });

  it("supports all four decision outcomes", async () => {
    const tx = Symbol("test-tx");
    for (const decision of [
      "APPROVED",
      "CHANGES_REQUESTED",
      "REJECTED",
      "CANCELLED",
    ] as const) {
      emitMock.mockClear();
      await emitReviewCompletedEvent(
        { ...baseCompletedInput(), decision },
        { tx: tx as never }
      );
      expect((emitMock.mock.calls[0][1] as Record<string, unknown>).decision).toBe(
        decision
      );
    }
  });
});
