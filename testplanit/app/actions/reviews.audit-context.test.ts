import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the audit-context fix shipped with the
// withActionAuditContext wrappers on requestReview + cancelReviewRequest.
// The earlier shape of these actions left REVIEW_REQUESTED and
// REVIEW_CANCELLED audit rows with userId=null because no
// AsyncLocalStorage frame was established for server-action invocations.
// REVIEW_APPROVED rows captured actor context correctly because the decide
// path routes through a REST handler wrapped in withAuditContext. These
// tests pin the fix: assert captureAuditEvent receives event.userId
// populated for both server actions.
//
// The withActionAuditContext HOF calls `await headers()` from next/headers;
// the unit test runs outside a Next.js request scope so the real call
// throws. Match the share-links.server.test.ts hoisted-mock pattern.

const headersMocks = vi.hoisted(() => ({
  current: new Map<string, string>([
    ["user-agent", "vitest-agent/1.0"],
    ["x-forwarded-for", "10.0.0.1"],
  ]),
  spy: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    headersMocks.spy();
    return {
      get: (key: string) => headersMocks.current.get(key.toLowerCase()) ?? null,
    };
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// captureAuditEvent is the call site under test. Mock and spy.
const captureAuditEventMock = vi.fn();
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => captureAuditEventMock(...args),
}));

// System feature-flag short-circuit: always enabled.
vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: vi.fn(async () => true),
}));

// Notification + webhook + comment-mention side effects are not under test.
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    resolveRoleHolderUserIds: vi.fn(async () => []),
    createReviewRequestNotification: vi.fn(async () => {}),
    createReviewCancelledNotification: vi.fn(async () => {}),
  },
}));

vi.mock("~/lib/services/commentService", () => ({
  CommentService: {
    processMentions: vi.fn(async () => {}),
  },
}));

vi.mock("~/lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewRequestedEvent: vi.fn(async () => {}),
  emitReviewCompletedEvent: vi.fn(async () => {}),
}));

// Session: signed-in user with a known id.
const TEST_USER_ID = "audit-ctx-user";
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(async () => ({
    user: { id: TEST_USER_ID, name: "Audit Ctx Tester", access: "USER" },
  })),
}));

// Minimal baseDb stub: just enough surface so each action reaches the
// captureAuditEvent call. The transactional create returns a fixed id so
// the assertions can pin it.
const REVIEW_REQUEST_ID = "rr-audit-ctx-fixture";

vi.mock("~/lib/db", () => ({
  baseDb: {
    appConfig: { findUnique: vi.fn(async () => null) },
    projects: {
      findUnique: vi.fn(async () => ({ reviewWorkflowEnabled: true })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        id: TEST_USER_ID,
        name: "Audit Ctx Tester",
      })),
    },
    reviewRequest: {
      findUnique: vi.fn(async () => ({
        id: REVIEW_REQUEST_ID,
        status: "PENDING",
        requestedByUserId: TEST_USER_ID,
        assigneeUserId: null,
        assigneeRoleId: null,
        entityType: "CASE",
        entityId: 123,
        fromStateId: 1,
        toStateId: 2,
        project: { id: 99, name: "Sample", reviewWorkflowEnabled: true },
        fromState: { id: 1, name: "Draft" },
        toState: { id: 2, name: "Under Review", color: { value: "#000" } },
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    repositoryCases: {
      findUnique: vi.fn(async () => ({ name: "case-name" })),
    },
    testRuns: {
      findUnique: vi.fn(async () => ({ name: "run-name" })),
    },
    sessions: {
      findUnique: vi.fn(async () => ({ name: "session-name" })),
    },
    workflows: {
      findUnique: vi.fn(async () => ({
        name: "state-name",
        color: { value: "#000" },
      })),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        $executeRaw: vi.fn().mockResolvedValue([]),
        $queryRaw: vi.fn().mockResolvedValue([]),
        reviewRequest: {
          create: vi.fn(async () => ({ id: REVIEW_REQUEST_ID })),
        },
        comment: { create: vi.fn(async () => ({ id: "comment-fixture" })) },
      })
    ),
  },
}));

// Imports under test — these must come AFTER the vi.mock declarations
// because top-level vi.mock is hoisted but ESM resolution still needs the
// real import to follow the mocks.
import { cancelReviewRequest, requestReview } from "./reviews";

describe("server-action audit context", () => {
  beforeEach(() => {
    captureAuditEventMock.mockReset();
    headersMocks.spy.mockClear();
  });

  it("requestReview emits an audit event with top-level userId populated", async () => {
    const result = await requestReview({
      projectId: 99,
      entityType: "CASE",
      entityId: 123,
      fromStateId: 1,
      toStateId: 2,
      assigneeUserId: null,
      assigneeRoleId: null,
      commentText: "please review",
    });

    expect(result.success).toBe(true);
    expect(captureAuditEventMock).toHaveBeenCalledTimes(1);

    const event = captureAuditEventMock.mock.calls[0]![0] as {
      action: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    };
    expect(event.action).toBe("REVIEW_REQUESTED");
    expect(event.userId).toBe(TEST_USER_ID);
    // metadata still carries the requester id for callers that read it.
    expect(event.metadata?.requestedByUserId).toBe(TEST_USER_ID);
    // Structural: requestReview must be wrapped in withActionAuditContext.
    // The wrapper is what establishes the AsyncLocalStorage frame so that
    // captureAuditEvent picks up ipAddress / userAgent / requestId from
    // the request headers. Without the wrapper, those metadata fields are
    // silently absent in production audit rows even though userId still
    // lands via the explicit field. The cheapest structural proof is that
    // next/headers#headers() was called as part of invoking the action.
    expect(headersMocks.spy).toHaveBeenCalled();
  });

  it("cancelReviewRequest emits an audit event with top-level userId populated", async () => {
    const result = await cancelReviewRequest(REVIEW_REQUEST_ID);

    expect(result.success).toBe(true);
    expect(captureAuditEventMock).toHaveBeenCalledTimes(1);

    const event = captureAuditEventMock.mock.calls[0]![0] as {
      action: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    };
    expect(event.action).toBe("REVIEW_CANCELLED");
    expect(event.userId).toBe(TEST_USER_ID);
    expect(event.metadata?.cancelerUserId).toBe(TEST_USER_ID);
    expect(headersMocks.spy).toHaveBeenCalled();
  });
});
