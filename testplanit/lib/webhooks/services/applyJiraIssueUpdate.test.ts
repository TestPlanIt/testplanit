import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplyJiraIssueUpdateInput } from "./types";

/**
 * Hoisted mocks for `prisma`, `captureAuditEvent`, and `isUniqueConstraintError`.
 * Mirrors the project-standard pattern in `lib/services/auditLog.test.ts` (vi.hoisted).
 *
 * Each test mutates the per-call return values via `mocks.tx.*` setters; the same
 * `tx` object is yielded from every `prisma.$transaction(fn)` invocation so we can
 * spy on the per-model calls (`webhookDelivery.create/update`, `webhookEventDedup.create`,
 * `issue.findFirst`, `issue.update`, `webhookConfig.update`).
 */
const mocks = vi.hoisted(() => {
  const tx = {
    webhookDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
    webhookEventDedup: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    issue: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    webhookConfig: {
      update: vi.fn(),
    },
  };
  const $transaction = vi.fn(async (fn: any) => fn(tx));
  return {
    tx,
    prisma: { $transaction },
    captureAuditEvent: vi.fn(async () => undefined),
    isUniqueConstraintError: vi.fn((err: unknown) => {
      return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      );
    }),
  };
});

vi.mock("~/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: mocks.captureAuditEvent,
}));

vi.mock("~/lib/utils/errors", () => ({
  isUniqueConstraintError: mocks.isUniqueConstraintError,
}));

// Defer the import of the SUT until after the mocks are wired up so that the
// service's module-level imports resolve to the mocked modules.
const importSut = async () =>
  (await import("./applyJiraIssueUpdate")).applyJiraIssueUpdate;

const RECEIVED_AT = new Date("2026-04-26T20:00:00.000Z");

const baseInput = (
  overrides: Partial<ApplyJiraIssueUpdateInput> = {}
): ApplyJiraIssueUpdateInput => ({
  webhookConfigId: "wc_demo",
  projectId: 7,
  payload: {
    eventType: "jira:issue_updated",
    issueKey: "DEMO-42",
    externalStatus: "In Progress",
    synthetic: false,
  },
  payloadDigest: "deadbeef".padEnd(64, "0"),
  receivedAt: RECEIVED_AT,
  latencyMs: 12,
  statusCode: 200,
  ...overrides,
});

const p2002 = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

const resetTxMocks = () => {
  for (const model of Object.values(mocks.tx)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  mocks.prisma.$transaction.mockClear();
  mocks.prisma.$transaction.mockImplementation(async (fn: any) =>
    fn(mocks.tx)
  );
  mocks.captureAuditEvent.mockReset();
  mocks.captureAuditEvent.mockResolvedValue(undefined);
  // Default: webhookDelivery.create returns a stable id.
  mocks.tx.webhookDelivery.create.mockResolvedValue({ id: "del_1" });
  mocks.tx.webhookDelivery.update.mockResolvedValue({});
  mocks.tx.webhookConfig.update.mockResolvedValue({});
  mocks.tx.issue.update.mockResolvedValue({});
  mocks.tx.webhookEventDedup.create.mockResolvedValue({});
  mocks.tx.webhookEventDedup.delete.mockResolvedValue({});
  mocks.tx.issue.findFirst.mockResolvedValue(null);
  mocks.isUniqueConstraintError.mockImplementation((err: unknown) => {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    );
  });
};

describe("applyJiraIssueUpdate", () => {
  beforeEach(() => {
    resetTxMocks();
  });

  it("Test 1: synthetic short-circuit (no prior dedup) writes dedup INSIDE synthetic branch and never touches Issue", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput({
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "SYN-1",
        externalStatus: "ignored",
        synthetic: true,
      },
    });

    const result = await applyJiraIssueUpdate(input);

    expect(result.outcome).toBe("synthetic");
    expect(result.deliveryId).toBe("del_1");
    // Issue lookup MUST NOT be called when synthetic.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Dedup INSERT IS called (so SC#5 second click can collide).
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledWith({
      data: {
        webhookConfigId: input.webhookConfigId,
        payloadDigest: input.payloadDigest,
        processedAt: input.receivedAt,
      },
    });
    // Delivery row finalized error='synthetic'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "synthetic",
      },
    });
    // WebhookConfig.lastReceivedAt updated.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
    // Audit emitted with synthetic outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        entityType: "WebhookDelivery",
        entityId: "del_1",
        userId: "__system__",
        metadata: expect.objectContaining({ outcome: "synthetic" }),
      })
    );
  });

  it("Test 1b: synthetic-then-synthetic = duplicate (SC#5 demo lock)", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput({
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "SYN-1",
        externalStatus: "ignored",
        synthetic: true,
      },
    });

    // First synthetic call: dedup INSERT succeeds → outcome 'synthetic'.
    const first = await applyJiraIssueUpdate(input);
    expect(first.outcome).toBe("synthetic");

    // Reset only call counts; keep mock implementations the same except the dedup.
    mocks.tx.webhookDelivery.create.mockClear();
    mocks.tx.webhookDelivery.update.mockClear();
    mocks.tx.webhookConfig.update.mockClear();
    mocks.tx.issue.findFirst.mockClear();
    mocks.tx.issue.update.mockClear();
    mocks.tx.webhookEventDedup.create.mockClear();
    mocks.captureAuditEvent.mockClear();
    mocks.tx.webhookDelivery.create.mockResolvedValue({ id: "del_2" });
    mocks.tx.webhookEventDedup.create.mockRejectedValueOnce(p2002());

    // Second synthetic call: dedup INSERT throws P2002 → outcome 'duplicate'.
    const second = await applyJiraIssueUpdate(input);
    expect(second.outcome).toBe("duplicate");
    expect(second.deliveryId).toBe("del_2");
    // No Issue mutation.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Delivery row finalized error='duplicate'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_2" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "duplicate",
      },
    });
    // Audit emitted with duplicate outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        metadata: expect.objectContaining({ outcome: "duplicate" }),
      })
    );
  });

  it("Test 2: linked-Issue duplicate (P2002) — fresh delivery row, no Issue mutation, attempt=1", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 99 });
    mocks.tx.webhookEventDedup.create.mockRejectedValueOnce(p2002());

    const result = await applyJiraIssueUpdate(input);

    expect(result.outcome).toBe("duplicate");
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Fresh delivery row was created (attempt=1 — duplicates distinguishable by error, NOT attempt).
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 1 }),
      })
    );
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "duplicate",
      },
    });
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "duplicate" }),
      })
    );
  });

  it("Test 3 + Test 11: no-link path leaves dedup table untouched (no INSERT, no DELETE)", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue(null);

    const result = await applyJiraIssueUpdate(input);

    expect(result.outcome).toBe("no-link");
    // T-03-09 / T-03-10: dedup table NEVER touched.
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.delete).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "no-link",
      },
    });
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
    // Audit emitted with no-link outcome (D-16).
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        userId: "__system__",
        metadata: expect.objectContaining({ outcome: "no-link" }),
      })
    );
  });

  it("Test 4: happy path (D-09 / WBHK-04) — Issue.externalStatus + lastSyncedAt updated, all six writes present", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    const result = await applyJiraIssueUpdate(input);

    expect(result).toEqual({
      outcome: "updated",
      deliveryId: "del_1",
      issueId: 100,
    });
    // 1. Delivery row created.
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledTimes(1);
    // 2. Linked Issue lookup with tenant scope.
    expect(mocks.tx.issue.findFirst).toHaveBeenCalledWith({
      where: {
        externalKey: input.payload.issueKey,
        isDeleted: false,
        project: { id: input.projectId },
      },
      select: { id: true },
    });
    // 3. Dedup INSERT.
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledWith({
      data: {
        webhookConfigId: input.webhookConfigId,
        payloadDigest: input.payloadDigest,
        processedAt: input.receivedAt,
      },
    });
    // 4. Issue.update with externalStatus + lastSyncedAt.
    expect(mocks.tx.issue.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: {
        externalStatus: input.payload.externalStatus,
        lastSyncedAt: input.receivedAt,
      },
    });
    // 5. Delivery row finalized error=null.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: null,
      },
    });
    // 6. WebhookConfig.lastReceivedAt updated.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
  });

  it("Test 5: atomicity (D-11) — Issue.update throws → tx rolls back, no audit, returns error", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    // Simulate $transaction rolling back: callback throws, $transaction rejects.
    const txError = new Error("Connection lost mid-transaction");
    mocks.tx.issue.update.mockRejectedValueOnce(txError);
    mocks.prisma.$transaction.mockImplementationOnce(async (fn: any) => {
      // Run the callback; if it throws, propagate (Prisma rolls back).
      return fn(mocks.tx);
    });

    const result = await applyJiraIssueUpdate(input);

    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("Connection lost mid-transaction");
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
  });

  it("Test 6: D-10 — Issue.status (internal) is NOT in the update data clause", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyJiraIssueUpdate(input);

    // Capture the data argument to issue.update and confirm 'status' is not a key.
    const callArgs = mocks.tx.issue.update.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.data).toBeDefined();
    expect(Object.keys(callArgs.data)).not.toContain("status");
    expect(Object.keys(callArgs.data)).toEqual(
      expect.arrayContaining(["externalStatus", "lastSyncedAt"])
    );
  });

  it("Test 7: D-17 audit metadata shape — WEBHOOK_RECEIVED with full metadata", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyJiraIssueUpdate(input);

    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        entityType: "WebhookDelivery",
        entityId: "del_1",
        projectId: input.projectId,
        userId: "__system__",
        metadata: {
          adapterType: "JIRA",
          eventType: input.payload.eventType,
          payloadDigest: input.payloadDigest,
          webhookConfigId: input.webhookConfigId,
          outcome: "updated",
          issueId: 100,
        },
      })
    );
  });

  it("Test 8: audit emission is awaited (Phase 63 REL-01) — service waits for captureAuditEvent before resolving", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    let auditResolve!: () => void;
    const auditDeferred = new Promise<void>((resolve) => {
      auditResolve = resolve;
    });
    let auditCalled = false;
    mocks.captureAuditEvent.mockImplementationOnce(async () => {
      auditCalled = true;
      await auditDeferred;
    });

    let serviceResolved = false;
    const servicePromise = applyJiraIssueUpdate(input).then((r) => {
      serviceResolved = true;
      return r;
    });

    // Yield to the microtask queue so the service awaits captureAuditEvent.
    await new Promise((r) => setTimeout(r, 5));
    expect(auditCalled).toBe(true);
    expect(serviceResolved).toBe(false); // service has NOT resolved while audit is pending

    auditResolve();
    const result = await servicePromise;
    expect(serviceResolved).toBe(true);
    expect(result.outcome).toBe("updated");
  });

  it("Test 9: audit entityType=WebhookDelivery, entityId=delivery cuid", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.webhookDelivery.create.mockResolvedValueOnce({ id: "del_xyz" });
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyJiraIssueUpdate(input);

    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "WebhookDelivery",
        entityId: "del_xyz",
      })
    );
  });

  it("Test 10: WBHK-07 — delivery row column completeness (direction, adapterType, eventType, payloadDigest)", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyJiraIssueUpdate(input);

    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookConfigId: input.webhookConfigId,
        direction: "INBOUND",
        adapterType: "JIRA",
        eventType: input.payload.eventType,
        payloadDigest: input.payloadDigest,
        attempt: 1,
        receivedAt: input.receivedAt,
      }),
    });
  });

  it("Test 12: non-P2002 error from dedup INSERT → outcome 'error', not 'duplicate'", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    // Simulate a non-P2002 error (e.g., connection timeout).
    const connTimeout = new Error("ECONNRESET: connection reset");
    mocks.tx.webhookEventDedup.create.mockRejectedValueOnce(connTimeout);

    const result = await applyJiraIssueUpdate(input);

    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("ECONNRESET");
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
  });

  it("Test 13: post-link retry succeeds — D-14 retry semantics without any DELETE", async () => {
    const applyJiraIssueUpdate = await importSut();
    const input = baseInput();
    // First call: no linked Issue → outcome 'no-link', dedup never touched.
    mocks.tx.issue.findFirst.mockResolvedValueOnce(null);
    const first = await applyJiraIssueUpdate(input);
    expect(first.outcome).toBe("no-link");
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.delete).not.toHaveBeenCalled();

    // Second call: link is now created (mock returns a real Issue row);
    // dedup INSERT succeeds (no prior row blocking it) → outcome 'updated'.
    mocks.tx.webhookDelivery.create.mockResolvedValueOnce({ id: "del_2" });
    mocks.tx.issue.findFirst.mockResolvedValueOnce({ id: 200 });
    const second = await applyJiraIssueUpdate(input);
    expect(second.outcome).toBe("updated");
    expect(second.issueId).toBe(200);
    // Dedup INSERT happened on second call (and only second call).
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    // Issue.update happened on second call.
    expect(mocks.tx.issue.update).toHaveBeenCalledWith({
      where: { id: 200 },
      data: {
        externalStatus: input.payload.externalStatus,
        lastSyncedAt: input.receivedAt,
      },
    });
  });
});
