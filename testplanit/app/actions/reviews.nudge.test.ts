import { beforeEach, describe, expect, it, vi } from "vitest";

// Coverage for `nudgeReviewRequest` — the requester-side "send reminder now"
// action behind the reviews inbox. The action deliberately reuses the
// scheduled reminder's whole pipeline (REVIEW_REMINDER notification, the
// `*.review_reminder` webhook, the `lastRemindedAt` stamp, the
// REVIEW_REMINDED audit row), so these tests pin the parts that are NOT
// shared with `workers/forecastWorker.ts`: who is allowed to fire it, the
// cooldown that keeps the two surfaces from double-pinging one reviewer, and
// the failure modes a person pressing a button needs reported back.
//
// `withActionAuditContext` calls `await headers()`; the unit test runs
// outside a Next request scope, so mock it the same way
// reviews.audit-context.test.ts does.

const headersMocks = vi.hoisted(() => ({
  current: new Map<string, string>([["user-agent", "vitest-agent/1.0"]]),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => headersMocks.current.get(key.toLowerCase()) ?? null,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const captureAuditEventMock = vi.fn();
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => captureAuditEventMock(...args),
}));

const systemEnabledMock = vi.fn(async () => true);
vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: () => systemEnabledMock(),
}));

type ReminderPayload = Record<string, unknown>;
const createReviewReminderNotificationMock = vi.fn(
  async (_params: ReminderPayload) => {}
);
const resolveRoleHolderUserIdsMock = vi.fn(
  async (
    _projectId: number,
    _roleId: number,
    _excludeUserId: string
  ): Promise<string[]> => []
);
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    resolveRoleHolderUserIds: (
      projectId: number,
      roleId: number,
      excludeUserId: string
    ) => resolveRoleHolderUserIdsMock(projectId, roleId, excludeUserId),
    createReviewReminderNotification: (params: ReminderPayload) =>
      createReviewReminderNotificationMock(params),
    createReviewRequestNotification: vi.fn(async () => {}),
    createReviewCancelledNotification: vi.fn(async () => {}),
  },
}));

vi.mock("~/lib/services/commentService", () => ({
  CommentService: {
    processMentions: vi.fn(async () => {}),
    createCommentMentions: vi.fn(async () => {}),
  },
}));

const emitReviewReminderEventMock = vi.fn(
  async (_input: Record<string, unknown>, _opts?: unknown) => {}
);
vi.mock("~/lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewRequestedEvent: vi.fn(async () => {}),
  emitReviewCompletedEvent: vi.fn(async () => {}),
  emitReviewReminderEvent: (input: Record<string, unknown>, opts?: unknown) =>
    emitReviewReminderEventMock(input, opts),
}));

const REQUESTER_ID = "user-requester";
const ASSIGNEE_ID = "user-assignee";
const REVIEW_REQUEST_ID = "rr-nudge-fixture";
const PROJECT_ID = 42;

type SessionUser = { id: string; name: string; access: "USER" | "ADMIN" };
let currentSessionUser: SessionUser = {
  id: REQUESTER_ID,
  name: "Rita Requester",
  access: "USER",
};
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({ user: currentSessionUser })),
}));

/** Row `baseDb.reviewRequest.findUnique` hands back; reshaped per test. */
type ReviewRow = Record<string, unknown>;
const HOUR = 60 * 60 * 1000;

function baseRow(overrides: ReviewRow = {}): ReviewRow {
  return {
    id: REVIEW_REQUEST_ID,
    status: "PENDING",
    entityType: "CASE",
    entityId: 777,
    fromStateId: 1,
    toStateId: 2,
    requestedByUserId: REQUESTER_ID,
    assigneeUserId: ASSIGNEE_ID,
    assigneeRoleId: null,
    lastRemindedAt: null,
    // 5h old — the reminder copy reports hoursPending off this.
    createdAt: new Date(Date.now() - 5 * HOUR),
    project: {
      id: PROJECT_ID,
      name: "Apollo",
      reviewWorkflowEnabled: true,
    },
    fromState: { id: 1, name: "Draft" },
    toState: { id: 2, name: "Approved", color: { value: "#00ff00" } },
    requestedBy: { id: REQUESTER_ID, name: "Rita Requester" },
    assigneeUser: { id: ASSIGNEE_ID, name: "Andy Assignee" },
    assigneeRole: null,
    ...overrides,
  };
}

let currentRow: ReviewRow | null = baseRow();
type StampArgs = { where: { id: string }; data: { lastRemindedAt: Date } };
const findUniqueReviewRequestMock = vi.fn(
  async (_args?: unknown) => currentRow
);
const updateReviewRequestMock = vi.fn(async (_args: StampArgs) => ({}));
const txUpdateReviewRequestMock = vi.fn(async (_args: StampArgs) => ({}));
const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({ reviewRequest: { update: txUpdateReviewRequestMock } })
);

vi.mock("~/lib/db", () => ({
  baseDb: {
    appConfig: { findUnique: vi.fn(async () => null) },
    projects: {
      findUnique: vi.fn(async () => ({
        id: PROJECT_ID,
        name: "Apollo",
        reviewWorkflowEnabled: true,
      })),
    },
    repositoryCases: {
      findUnique: vi.fn(async () => ({ name: "Login smoke test" })),
    },
    testRuns: { findUnique: vi.fn(async () => ({ name: "Run 12" })) },
    sessions: { findUnique: vi.fn(async () => ({ name: "Session 3" })) },
    reviewRequest: {
      findUnique: (args?: unknown) => findUniqueReviewRequestMock(args),
      update: (args: StampArgs) => updateReviewRequestMock(args),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      transactionMock(fn),
  },
}));

import { nudgeReviewRequest } from "./reviews";

describe("nudgeReviewRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemEnabledMock.mockResolvedValue(true);
    resolveRoleHolderUserIdsMock.mockResolvedValue([]);
    createReviewReminderNotificationMock.mockResolvedValue(undefined);
    emitReviewReminderEventMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (fn) =>
      fn({ reviewRequest: { update: txUpdateReviewRequestMock } })
    );
    currentSessionUser = {
      id: REQUESTER_ID,
      name: "Rita Requester",
      access: "USER",
    };
    currentRow = baseRow();
  });

  it("sends the reminder to the direct assignee and reports the recipient count", async () => {
    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result).toEqual({
      success: true,
      reviewRequestId: REVIEW_REQUEST_ID,
      recipientCount: 1,
    });
    expect(createReviewReminderNotificationMock).toHaveBeenCalledTimes(1);
    const payload = createReviewReminderNotificationMock.mock.calls[0]![0];
    expect(payload.targetUserIds).toEqual([ASSIGNEE_ID]);
    expect(payload.reviewRequestId).toBe(REVIEW_REQUEST_ID);
    expect(payload.entityName).toBe("Login smoke test");
    expect(payload.hoursPending).toBe(5);
  });

  it("emits the review_reminder webhook and stamps lastRemindedAt in one transaction", async () => {
    await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(emitReviewReminderEventMock).toHaveBeenCalledTimes(1);
    expect(txUpdateReviewRequestMock).toHaveBeenCalledTimes(1);
    const stamp = txUpdateReviewRequestMock.mock.calls[0]![0];
    expect(stamp.where.id).toBe(REVIEW_REQUEST_ID);
    expect(stamp.data.lastRemindedAt).toBeInstanceOf(Date);
  });

  it("records a REVIEW_REMINDED audit row tagged as a manual nudge", async () => {
    await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(captureAuditEventMock).toHaveBeenCalledTimes(1);
    const event = captureAuditEventMock.mock.calls[0]![0] as {
      action: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(event.action).toBe("REVIEW_REMINDED");
    // Distinguishes a person pressing the button from the hourly scan,
    // which stamps "review-reminder-worker" here.
    expect(event.metadata.source).toBe("manual-nudge");
    expect(event.userId).toBe(REQUESTER_ID);
    expect(event.metadata.recipientCount).toBe(1);
  });

  it("refuses a second reminder inside the cooldown, without notifying or stamping", async () => {
    currentRow = baseRow({
      lastRemindedAt: new Date(Date.now() - 10 * 60_000),
    });

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: "TOO_SOON" });
    expect((result as { retryAt?: string }).retryAt).toEqual(
      expect.any(String)
    );
    expect(createReviewReminderNotificationMock).not.toHaveBeenCalled();
    expect(txUpdateReviewRequestMock).not.toHaveBeenCalled();
  });

  it("allows the nudge once the cooldown has elapsed", async () => {
    currentRow = baseRow({ lastRemindedAt: new Date(Date.now() - 2 * HOUR) });

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result.success).toBe(true);
    expect(createReviewReminderNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a viewer who neither requested the review nor administers the system", async () => {
    currentSessionUser = {
      id: "user-bystander",
      name: "Bystander",
      access: "USER",
    };

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result).toMatchObject({ success: false, error: "FORBIDDEN" });
    expect(createReviewReminderNotificationMock).not.toHaveBeenCalled();
  });

  it("lets an admin nudge on someone else's behalf, keeping the original requester in the copy", async () => {
    currentSessionUser = {
      id: "user-admin",
      name: "Ada Admin",
      access: "ADMIN",
    };

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result.success).toBe(true);
    const payload = createReviewReminderNotificationMock.mock.calls[0]![0];
    // The reminder reads "<requester>'s review request is still waiting on
    // you" — an admin firing it must not rewrite whose request it is.
    expect(payload.requesterName).toBe("Rita Requester");
    expect(payload.requesterUserId).toBe(REQUESTER_ID);
  });

  it("fans a role-assigned request out to every role holder except the requester", async () => {
    currentRow = baseRow({
      assigneeUserId: null,
      assigneeUser: null,
      assigneeRoleId: 9,
      assigneeRole: { id: 9, name: "QA Lead" },
    });
    resolveRoleHolderUserIdsMock.mockResolvedValue(["holder-a", "holder-b"]);

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(resolveRoleHolderUserIdsMock).toHaveBeenCalledWith(
      PROJECT_ID,
      9,
      REQUESTER_ID
    );
    expect(result).toMatchObject({ success: true, recipientCount: 2 });
  });

  it("reports NO_RECIPIENTS — and leaves the cooldown clear — when the role has no holders", async () => {
    currentRow = baseRow({
      assigneeUserId: null,
      assigneeUser: null,
      assigneeRoleId: 9,
      assigneeRole: { id: 9, name: "QA Lead" },
    });
    resolveRoleHolderUserIdsMock.mockResolvedValue([]);

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    // The scheduled scan stamps and skips here; a person pressing a button
    // needs the answer, and needs the next attempt to work once project
    // access is restored.
    expect(result).toMatchObject({ success: false, error: "NO_RECIPIENTS" });
    expect(txUpdateReviewRequestMock).not.toHaveBeenCalled();
    expect(updateReviewRequestMock).not.toHaveBeenCalled();
  });

  it("refuses to nudge a request that has already been decided", async () => {
    currentRow = baseRow({ status: "APPROVED" });

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result).toMatchObject({
      success: false,
      error: "ALREADY_DECIDED",
    });
    expect(createReviewReminderNotificationMock).not.toHaveBeenCalled();
  });

  it("refuses when the project's review workflow has since been turned off", async () => {
    currentRow = baseRow({
      project: {
        id: PROJECT_ID,
        name: "Apollo",
        reviewWorkflowEnabled: false,
      },
    });

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result).toMatchObject({
      success: false,
      error: "FEATURE_DISABLED",
    });
  });

  it("fails loudly when the notification dispatch fails, leaving the cooldown clear for a retry", async () => {
    createReviewReminderNotificationMock.mockRejectedValueOnce(
      new Error("notification queue down")
    );

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    // Unlike every other notification in this file, the reminder IS the
    // work — reporting success would leave the requester waiting on a ping
    // that never landed.
    expect(result).toMatchObject({
      success: false,
      error: "INTERNAL_ERROR",
    });
    expect(txUpdateReviewRequestMock).not.toHaveBeenCalled();
  });

  it("still stamps the cooldown when only the webhook emit fails", async () => {
    transactionMock.mockRejectedValueOnce(new Error("outbox unavailable"));

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    // Notifications already went out, so an unstamped row would let the
    // requester immediately re-nudge and double-ping the reviewer.
    expect(result).toMatchObject({ success: true });
    expect(updateReviewRequestMock).toHaveBeenCalledTimes(1);
    const stamp = updateReviewRequestMock.mock.calls[0]![0];
    expect(stamp.data.lastRemindedAt).toBeInstanceOf(Date);
  });

  it("short-circuits when the system-level review feature is off", async () => {
    systemEnabledMock.mockResolvedValue(false);

    const result = await nudgeReviewRequest(REVIEW_REQUEST_ID);

    expect(result).toMatchObject({
      success: false,
      error: "FEATURE_DISABLED",
    });
    expect(findUniqueReviewRequestMock).not.toHaveBeenCalled();
  });
});
