import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runWithAuditContext,
  SYSTEM_ACTOR_ID,
} from "~/lib/auditContext";

import { webhookEvents } from "./events";

/**
 * D-35 / D-01 / OUT-05 / OUT-20 — webhookEvents.emit contract.
 *
 * The emit helper writes ONE WebhookOutboxEvent row inside the caller's
 * Prisma.TransactionClient. The tx parameter is REQUIRED at compile time
 * AND runtime (defense-in-depth against `as any` bypasses).
 *
 * Tests use a stub `tx` whose `webhookOutboxEvent.create` is a vi.fn()
 * returning a fake row id. We assert envelope assembly, actor resolution
 * (explicit > ALS context > null), eventId format, and the suppression hatch.
 */
describe("webhookEvents.emit", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let tx: { webhookOutboxEvent: { create: typeof createSpy } };

  beforeEach(() => {
    createSpy = vi.fn(async () => ({ id: "fake-row-id" }));
    tx = { webhookOutboxEvent: { create: createSpy } };
  });

  it("returns {eventId, outboxRowId} with eventId matching evt_<uuid-v4>", async () => {
    const result = await webhookEvents.emit(
      "test_run.completed",
      { runId: 5 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { projectId: 7, tx: tx as any }
    );
    expect(result).not.toBeNull();
    expect(result!.eventId).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(result!.outboxRowId).toBe("fake-row-id");
  });

  it("calls tx.webhookOutboxEvent.create with eventName, projectId, actorUserId=null when no auditContext + no explicit actor", async () => {
    await webhookEvents.emit(
      "test_run.created",
      { runId: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { projectId: 42, tx: tx as any }
    );
    expect(createSpy).toHaveBeenCalledTimes(1);
    const call = createSpy.mock.calls[0][0];
    expect(call.data.eventName).toBe("test_run.created");
    expect(call.data.projectId).toBe(42);
    expect(call.data.actorUserId).toBeNull();
  });

  it("resolves actorUserId from runWithAuditContext when no explicit actor passed", async () => {
    await runWithAuditContext({ userId: "user-42" }, async () => {
      await webhookEvents.emit(
        "issue.created",
        { issueId: 9 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { projectId: 1, tx: tx as any }
      );
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].data.actorUserId).toBe("user-42");
  });

  it("explicit opts.actorUserId wins over ALS-set context userId", async () => {
    await runWithAuditContext({ userId: "user-42" }, async () => {
      await webhookEvents.emit(
        "issue.updated",
        { issueId: 9 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { projectId: 1, tx: tx as any, actorUserId: "user-99" }
      );
    });
    expect(createSpy.mock.calls[0][0].data.actorUserId).toBe("user-99");
  });

  it("opts.actorUserId === SYSTEM_ACTOR_ID maps to null in the DB call", async () => {
    await webhookEvents.emit(
      "case.deleted",
      { caseId: 123 },
      {
        projectId: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
        actorUserId: SYSTEM_ACTOR_ID,
      }
    );
    expect(createSpy.mock.calls[0][0].data.actorUserId).toBeNull();
  });

  it("opts.actorUserId === undefined + ALS unset produces actorUserId: null", async () => {
    await webhookEvents.emit(
      "case.created",
      { caseId: 1 },
      {
        projectId: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
        actorUserId: undefined,
      }
    );
    expect(createSpy.mock.calls[0][0].data.actorUserId).toBeNull();
  });

  it("returns null and does NOT call tx.webhookOutboxEvent.create when auditContext.suppressWebhooks=true (D-01a)", async () => {
    const result = await runWithAuditContext(
      { userId: "u", suppressWebhooks: true },
      async () =>
        await webhookEvents.emit(
          "test_run.created",
          { runId: 1 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { projectId: 1, tx: tx as any }
        )
    );
    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("forwards explicit eventTimestamp to the create payload", async () => {
    const ts = new Date(0);
    await webhookEvents.emit(
      "test_run.completed",
      { runId: 5 },
      {
        projectId: 7,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
        eventTimestamp: ts,
      }
    );
    expect(createSpy.mock.calls[0][0].data.eventTimestamp).toBe(ts);
  });

  it("forwards payload as-is to tx.webhookOutboxEvent.create", async () => {
    const data = { runId: 5, statusCounts: [{ id: 1 }] };
    await webhookEvents.emit(
      "test_run.completed",
      data,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { projectId: 7, tx: tx as any }
    );
    expect(createSpy.mock.calls[0][0].data.payload).toBe(data);
  });

  it("throws a clear error when called with tx: undefined (runtime guard against `as any` bypass)", async () => {
    await expect(
      webhookEvents.emit(
        "foo",
        {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { projectId: 1, tx: undefined as any }
      )
    ).rejects.toThrow(/Prisma\.TransactionClient/);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
