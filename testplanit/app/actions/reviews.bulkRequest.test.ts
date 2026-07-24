// @vitest-environment node
/**
 * Unit coverage for the `bulkRequestReview` server action.
 *
 * Scope is the batch logic the action owns: input guards, the fan-out
 * collapse (one aggregate notification for N requests), per-request webhook
 * and audit fidelity, and the pass-through of the resolver's skip lists. The
 * gate resolution itself is covered in reviewGate.bulkTargets.test.ts and is
 * mocked here so each test can state its work-list directly.
 *
 * Everything below the action — Prisma, notifications, webhooks, audit — is
 * mocked, so this suite runs in CI without a database (unlike the live-DB
 * reviews.canApprove.test.ts, which is gated on RUN_DB_INTEGRATION).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const sessionMock = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => sessionMock(),
}));

const isReviewFeatureSystemEnabled = vi.fn(async () => true);
vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: () => isReviewFeatureSystemEnabled(),
}));

const resolveBulkReviewTargets = vi.fn();
vi.mock("~/lib/services/reviewGate", () => ({
  resolveBulkReviewTargets: (...args: unknown[]) =>
    resolveBulkReviewTargets(...args),
}));

const resolveEffectiveProjectRoleId = vi.fn(async () => 1);
vi.mock("~/lib/services/effectiveRole", () => ({
  resolveEffectiveProjectRoleId: () => resolveEffectiveProjectRoleId(),
}));

// Spies declare a rest parameter so call-forwarding type-checks and
// `.mock.calls[n][0]` is indexable — a zero-arg `vi.fn(async () => {})` types
// its calls as the empty tuple, which tsc rejects on both counts.
const createCommentMentions = vi.fn(async (..._a: any[]) => {});
vi.mock("~/lib/services/commentService", () => ({
  CommentService: {
    createCommentMentions: (...a: unknown[]) => createCommentMentions(...a),
    processMentions: vi.fn(async (..._a: any[]) => {}),
  },
}));

const createBulkReviewRequestNotification = vi.fn(async (..._a: any[]) => {});
const createReviewRequestNotification = vi.fn(async (..._a: any[]) => {});
const resolveRoleHolderUserIds = vi.fn(async () => ["role-holder-1"]);
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createBulkReviewRequestNotification: (...a: unknown[]) =>
      createBulkReviewRequestNotification(...a),
    createReviewRequestNotification: (...a: unknown[]) =>
      createReviewRequestNotification(...a),
    resolveRoleHolderUserIds: () => resolveRoleHolderUserIds(),
  },
}));

const emitReviewRequestedEvent = vi.fn(async (..._a: any[]) => {});
vi.mock("~/lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewRequestedEvent: (...a: unknown[]) => emitReviewRequestedEvent(...a),
  emitReviewCompletedEvent: vi.fn(async (..._a: any[]) => {}),
}));

const captureAuditEvent = vi.fn(async (..._a: any[]) => {});
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...a: unknown[]) => captureAuditEvent(...a),
}));

// Transaction stub: hands the callback a tx whose creates return
// deterministic ids so the test can assert on what was written.
const createdReviewRequests: any[] = [];
const createdComments: any[] = [];
const auditedTransaction = vi.fn(async (fn: any) => {
  let seq = 0;
  const tx = {
    reviewRequest: {
      create: async (args: any) => {
        seq += 1;
        createdReviewRequests.push(args.data);
        return { id: `rev-${seq}` };
      },
    },
    comment: {
      create: async (args: any) => {
        createdComments.push(args.data);
        return { id: `cmt-${createdComments.length}` };
      },
    },
  };
  return fn(tx);
});
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (...a: any[]) => auditedTransaction(...(a as [any])),
}));

const projectFindUnique = vi.fn(async () => ({
  id: 7,
  name: "Payments",
  reviewWorkflowEnabled: true,
}));
const rolePermissionFindUnique = vi.fn(async () => ({ canApprove: true }));
vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: { findUnique: () => projectFindUnique() },
    rolePermission: { findUnique: () => rolePermissionFindUnique() },
    user: {
      findUnique: async () => ({ id: "reviewer-1", name: "Alice" }),
    },
    roles: { findUnique: async () => ({ name: "QA Lead" }) },
    workflows: {
      findMany: async () => [
        { id: 10, name: "Draft", color: { value: "#111111" } },
        { id: 30, name: "Ready", color: { value: "#222222" } },
        { id: 40, name: "In Review", color: { value: "#333333" } },
        { id: 50, name: "Approved", color: { value: "#444444" } },
      ],
    },
    repositoryCases: {
      findMany: async (args: any) =>
        (args?.where?.id?.in ?? []).map((id: number) => ({
          id,
          name: `Case ${id}`,
        })),
    },
    testRuns: { findMany: async () => [] },
    sessions: { findMany: async () => [] },
  },
}));

import { bulkRequestReview } from "./reviews";

const REQUESTER = "requester-1";

const baseInput = {
  projectId: 7,
  entityType: "CASE" as const,
  entityIds: [1, 2, 3],
  toStateId: 50,
  assigneeUserId: "reviewer-1",
  assigneeRoleId: null,
};

describe("bulkRequestReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdReviewRequests.length = 0;
    createdComments.length = 0;

    sessionMock.mockResolvedValue({
      user: { id: REQUESTER, name: "Brad" },
    });
    isReviewFeatureSystemEnabled.mockResolvedValue(true);
    projectFindUnique.mockResolvedValue({
      id: 7,
      name: "Payments",
      reviewWorkflowEnabled: true,
    });
    rolePermissionFindUnique.mockResolvedValue({ canApprove: true });
    resolveEffectiveProjectRoleId.mockResolvedValue(1);
    resolveRoleHolderUserIds.mockResolvedValue(["role-holder-1"]);
    resolveBulkReviewTargets.mockResolvedValue({
      targets: [
        { entityId: 1, fromStateId: 10, gateId: 30 },
        { entityId: 2, fromStateId: 10, gateId: 30 },
        { entityId: 3, fromStateId: 40, gateId: 50 },
      ],
      skippedPending: [],
      skippedNotBlocked: [],
    });
  });

  // ── Input guards ───────────────────────────────────────────────────────

  it("rejects an unauthenticated caller", async () => {
    sessionMock.mockResolvedValue(null);

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({ success: false, error: "UNAUTHORIZED" });
  });

  it("rejects an empty selection", async () => {
    const result = await bulkRequestReview({ ...baseInput, entityIds: [] });

    expect(result).toEqual({ success: false, error: "INVALID_INPUT" });
  });

  it("rejects a selection past the batch ceiling", async () => {
    const result = await bulkRequestReview({
      ...baseInput,
      entityIds: Array.from({ length: 501 }, (_, i) => i + 1),
    });

    expect(result).toEqual({ success: false, error: "SELECTION_TOO_LARGE" });
  });

  it("counts the ceiling against DEDUPED ids", async () => {
    // 600 entries but only 3 distinct cases — that's a 3-request batch.
    const dupes = Array.from({ length: 600 }, (_, i) => (i % 3) + 1);

    const result = await bulkRequestReview({ ...baseInput, entityIds: dupes });

    expect(result.success).toBe(true);
  });

  it("rejects both assignee kinds at once", async () => {
    const result = await bulkRequestReview({
      ...baseInput,
      assigneeUserId: "reviewer-1",
      assigneeRoleId: 5,
    });

    expect(result).toEqual({ success: false, error: "INVALID_INPUT" });
  });

  it("rejects neither assignee kind", async () => {
    const result = await bulkRequestReview({
      ...baseInput,
      assigneeUserId: null,
      assigneeRoleId: null,
    });

    expect(result).toEqual({ success: false, error: "INVALID_INPUT" });
  });

  it("rejects self-assignment", async () => {
    const result = await bulkRequestReview({
      ...baseInput,
      assigneeUserId: REQUESTER,
    });

    expect(result).toEqual({ success: false, error: "INELIGIBLE_ASSIGNEE" });
  });

  it("rejects when the system feature flag is off", async () => {
    isReviewFeatureSystemEnabled.mockResolvedValue(false);

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({ success: false, error: "FEATURE_DISABLED" });
  });

  it("rejects when the project has review workflow off", async () => {
    projectFindUnique.mockResolvedValue({
      id: 7,
      name: "Payments",
      reviewWorkflowEnabled: false,
    });

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({ success: false, error: "FEATURE_DISABLED" });
  });

  it("rejects an assignee who cannot approve", async () => {
    rolePermissionFindUnique.mockResolvedValue({ canApprove: false });

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({ success: false, error: "INELIGIBLE_ASSIGNEE" });
  });

  // ── Row writes ─────────────────────────────────────────────────────────

  it("creates one request per resolved target, keyed on that target's gate", async () => {
    const result = await bulkRequestReview(baseInput);

    expect(result).toMatchObject({ success: true, created: 3 });
    expect(createdReviewRequests).toHaveLength(3);
    // Each request targets the entity's OWN first missing gate, not the
    // bulk target state — cases 1/2 need gate 30, case 3 needs gate 50.
    expect(
      createdReviewRequests.map((r) => [r.entityId, r.fromStateId, r.toStateId])
    ).toEqual([
      [1, 10, 30],
      [2, 10, 30],
      [3, 40, 50],
    ]);
    expect(createdReviewRequests.every((r) => r.status === "PENDING")).toBe(
      true
    );
    expect(
      createdReviewRequests.every((r) => r.requestedByUserId === REQUESTER)
    ).toBe(true);
  });

  it("pairs every request with a comment on the right entity", async () => {
    await bulkRequestReview(baseInput);

    expect(createdComments).toHaveLength(3);
    expect(createdComments.map((c) => c.repositoryCaseId)).toEqual([1, 2, 3]);
    expect(createdComments.every((c) => c.type === "REVIEW_REQUEST")).toBe(
      true
    );
    expect(createdComments.map((c) => c.reviewRequestId)).toEqual([
      "rev-1",
      "rev-2",
      "rev-3",
    ]);
  });

  it("writes an auto-comment with a mention node for a user assignee", async () => {
    await bulkRequestReview(baseInput);

    const paragraph = createdComments[0].content.content[0];
    expect(paragraph.content[0]).toMatchObject({
      type: "mention",
      attrs: { id: "reviewer-1" },
    });
    // No requester prose in bulk — the body is the localized default only.
    expect(paragraph.content.at(-1).type).toBe("text");
  });

  it("omits the mention node for a role assignee", async () => {
    await bulkRequestReview({
      ...baseInput,
      assigneeUserId: null,
      assigneeRoleId: 5,
    });

    const paragraph = createdComments[0].content.content[0];
    expect(paragraph.content.some((n: any) => n.type === "mention")).toBe(
      false
    );
  });

  // ── Fan-out ────────────────────────────────────────────────────────────

  it("sends exactly ONE aggregate notification for the whole batch", async () => {
    await bulkRequestReview(baseInput);

    expect(createBulkReviewRequestNotification).toHaveBeenCalledTimes(1);
    expect(createBulkReviewRequestNotification.mock.calls[0][0]).toMatchObject({
      targetUserIds: ["reviewer-1"],
      count: 3,
      projectName: "Payments",
    });
    // The per-entity notification path must not also fire.
    expect(createReviewRequestNotification).not.toHaveBeenCalled();
  });

  it("addresses the aggregate notification to every role holder", async () => {
    resolveRoleHolderUserIds.mockResolvedValue(["u1", "u2"]);

    await bulkRequestReview({
      ...baseInput,
      assigneeUserId: null,
      assigneeRoleId: 5,
    });

    expect(createBulkReviewRequestNotification.mock.calls[0][0]).toMatchObject({
      targetUserIds: ["u1", "u2"],
    });
  });

  it("still writes mention rows per comment so @mentions highlight in-thread", async () => {
    await bulkRequestReview(baseInput);

    expect(createCommentMentions).toHaveBeenCalledTimes(3);
  });

  it("emits one webhook event per request", async () => {
    await bulkRequestReview(baseInput);

    expect(emitReviewRequestedEvent).toHaveBeenCalledTimes(3);
    expect(emitReviewRequestedEvent.mock.calls[2][0]).toMatchObject({
      reviewRequestId: "rev-3",
      entityId: 3,
      entityName: "Case 3",
      toStateId: 50,
      toStateName: "Approved",
      // Bulk requests carry no requester prose.
      commentText: null,
    });
  });

  it("emits one audit event per request, tagged as bulk", async () => {
    await bulkRequestReview(baseInput);

    expect(captureAuditEvent).toHaveBeenCalledTimes(3);
    expect(captureAuditEvent.mock.calls[0][0]).toMatchObject({
      action: "REVIEW_REQUESTED",
      entityType: "ReviewRequest",
      entityId: "rev-1",
      metadata: expect.objectContaining({ bulk: true, bulkSize: 3 }),
    });
  });

  it("survives a notification failure without losing the requests", async () => {
    // `Once` matters: clearAllMocks resets calls but not implementations, so
    // a persistent rejection would bleed into every later test.
    createBulkReviewRequestNotification.mockRejectedValueOnce(
      new Error("smtp")
    );

    const result = await bulkRequestReview(baseInput);

    expect(result).toMatchObject({ success: true, created: 3 });
  });

  // ── Skips ──────────────────────────────────────────────────────────────

  it("reports skips and opens no transaction when nothing is blocked", async () => {
    resolveBulkReviewTargets.mockResolvedValue({
      targets: [],
      skippedPending: [2],
      skippedNotBlocked: [1, 3],
    });

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({
      success: true,
      created: 0,
      reviewRequestIds: [],
      skippedPending: [2],
      skippedNotBlocked: [1, 3],
    });
    expect(auditedTransaction).not.toHaveBeenCalled();
    expect(createBulkReviewRequestNotification).not.toHaveBeenCalled();
  });

  it("passes the resolver's skip lists through alongside created requests", async () => {
    resolveBulkReviewTargets.mockResolvedValue({
      targets: [{ entityId: 1, fromStateId: 10, gateId: 30 }],
      skippedPending: [2],
      skippedNotBlocked: [3],
    });

    const result = await bulkRequestReview(baseInput);

    expect(result).toMatchObject({
      success: true,
      created: 1,
      skippedPending: [2],
      skippedNotBlocked: [3],
    });
  });

  it("returns INTERNAL_ERROR when the transaction fails", async () => {
    auditedTransaction.mockRejectedValueOnce(new Error("deadlock"));

    const result = await bulkRequestReview(baseInput);

    expect(result).toEqual({ success: false, error: "INTERNAL_ERROR" });
  });
});
