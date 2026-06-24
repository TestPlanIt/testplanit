import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithAuditContext, SYSTEM_ACTOR_ID } from "~/lib/auditContext";

import { webhookEvents } from "./events";

/**
 * webhookEvents.emit contract.
 *
 * emit writes ONE WebhookOutboxEvent row inside the caller's transaction via a
 * raw `tx.$executeRaw` INSERT. The raw INSERT (rather than an ORM `.create`) is
 * deliberate: WebhookOutboxEvent is `@@deny('create,update,delete', true)`, so a
 * CRUD create through the policy client (e.g. when the producing mutation ran on
 * getAuthDb) would be rejected — raw SQL bypasses the CRUD policy while staying
 * in the same transaction. The tx is REQUIRED at compile time AND runtime.
 *
 * `$executeRaw` is a tagged template, so the stub receives
 * `[stringsArray, outboxRowId, projectId, eventName, eventId, eventTimestamp,
 *   actorUserId, payloadJson]`. Tests read the interpolated values by position.
 */
const IDX = {
  outboxRowId: 1,
  projectId: 2,
  eventName: 3,
  eventId: 4,
  eventTimestamp: 5,
  actorUserId: 6,
  payloadJson: 7,
} as const;

describe("webhookEvents.emit", () => {
  let execSpy: ReturnType<typeof vi.fn>;
  let tx: { $executeRaw: typeof execSpy };

  beforeEach(() => {
    execSpy = vi.fn(async () => 1);
    tx = { $executeRaw: execSpy };
  });

  const arg = (k: keyof typeof IDX) => execSpy.mock.calls[0][IDX[k]];

  it("returns {eventId, outboxRowId} (evt_<uuid> / who_<uuid>) and writes those ids", async () => {
    const result = await webhookEvents.emit(
      "test_run.completed",
      { runId: 5 },
      { projectId: 7, tx: tx as any }
    );
    expect(result).not.toBeNull();
    expect(result!.eventId).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(result!.outboxRowId).toMatch(/^who_[0-9a-f-]{36}$/);
    expect(arg("eventId")).toBe(result!.eventId);
    expect(arg("outboxRowId")).toBe(result!.outboxRowId);
  });

  it("writes eventName, projectId, actorUserId=null when no auditContext + no explicit actor", async () => {
    await webhookEvents.emit(
      "test_run.created",
      { runId: 1 },
      { projectId: 42, tx: tx as any }
    );
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(arg("eventName")).toBe("test_run.created");
    expect(arg("projectId")).toBe(42);
    expect(arg("actorUserId")).toBeNull();
  });

  it("resolves actorUserId from runWithAuditContext when no explicit actor passed", async () => {
    await runWithAuditContext({ userId: "user-42" }, async () => {
      await webhookEvents.emit(
        "issue.created",
        { issueId: 9 },
        { projectId: 1, tx: tx as any }
      );
    });
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(arg("actorUserId")).toBe("user-42");
  });

  it("explicit opts.actorUserId wins over ALS-set context userId", async () => {
    await runWithAuditContext({ userId: "user-42" }, async () => {
      await webhookEvents.emit(
        "issue.updated",
        { issueId: 9 },
        { projectId: 1, tx: tx as any, actorUserId: "user-99" }
      );
    });
    expect(arg("actorUserId")).toBe("user-99");
  });

  it("opts.actorUserId === SYSTEM_ACTOR_ID maps to null", async () => {
    await webhookEvents.emit(
      "case.deleted",
      { caseId: 123 },
      { projectId: 1, tx: tx as any, actorUserId: SYSTEM_ACTOR_ID }
    );
    expect(arg("actorUserId")).toBeNull();
  });

  it("opts.actorUserId === undefined + ALS unset produces actorUserId: null", async () => {
    await webhookEvents.emit(
      "case.created",
      { caseId: 1 },
      { projectId: 1, tx: tx as any, actorUserId: undefined }
    );
    expect(arg("actorUserId")).toBeNull();
  });

  it("returns null and does NOT write when auditContext.suppressWebhooks=true", async () => {
    const result = await runWithAuditContext(
      { userId: "u", suppressWebhooks: true },
      async () =>
        await webhookEvents.emit(
          "test_run.created",
          { runId: 1 },
          { projectId: 1, tx: tx as any }
        )
    );
    expect(result).toBeNull();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("forwards explicit eventTimestamp", async () => {
    const ts = new Date(0);
    await webhookEvents.emit(
      "test_run.completed",
      { runId: 5 },
      { projectId: 7, tx: tx as any, eventTimestamp: ts }
    );
    expect(arg("eventTimestamp")).toBe(ts);
  });

  it("serializes the payload to JSON for the jsonb column", async () => {
    const data = { runId: 5, statusCounts: [{ id: 1 }] };
    await webhookEvents.emit("test_run.completed", data, {
      projectId: 7,
      tx: tx as any,
    });
    expect(JSON.parse(arg("payloadJson"))).toEqual(data);
  });

  it("throws a clear error when called with tx: undefined (runtime guard against `as any` bypass)", async () => {
    await expect(
      webhookEvents.emit("foo", {}, { projectId: 1, tx: undefined as any })
    ).rejects.toThrow(/TxClient/);
    expect(execSpy).not.toHaveBeenCalled();
  });
});
