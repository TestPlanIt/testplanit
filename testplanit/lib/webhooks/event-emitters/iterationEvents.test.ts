import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitIterationResultRecorded } from "./iterationEvents";

/**
 * INT-04 emitter contract.
 *
 * - Emits `iteration.result.recorded` with the full payload through
 *   `webhookEvents.emit` (mocked here so we can introspect the call args).
 * - Forwards the caller's `tx` to the emit helper — atomicity contract.
 * - Throws when called without a tx (defense in depth on top of the
 *   runtime guard in lib/webhooks/events.ts).
 * - Caps individual value bytes at 4 KB to bound payload size.
 *
 * D-13 boundary: this emitter does NOT redact — the caller has already
 * computed `redactedValues` with `viewerCanReadSensitive=false`. The
 * integration test at `app/api/test-runs/submit-result/submitResult.integration.test.ts`
 * proves the divergence from `auditPayload.redactedValues` in the live-DB tx.
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_42",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

function makeTx() {
  // The emitter resolves statusName (Status) and runTitle (TestRuns) before
  // forwarding; the readers return fixed names regardless of id. appConfig
  // backs readRecordKeyConfig — null rows keep the record-key feature disabled
  // so displayKey resolves to null.
  return {
    status: { findUnique: vi.fn(async () => ({ name: "Passed" })) },
    testRuns: {
      findUnique: vi.fn(async () => ({ name: "Run 7", project: null })),
    },
    appConfig: { findUnique: vi.fn(async () => null) },
  } as any;
}

describe("emitIterationResultRecorded — Wave 2 INT-04 contract", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits iteration.result.recorded with redacted values and forwards tx + projectId", async () => {
    const tx = makeTx();
    await emitIterationResultRecorded(
      {
        iterationId: 9001,
        testRunCaseId: 50,
        testRunId: 7,
        statusId: 5,
        projectId: 42,
        rowIndex: 1,
        redactedValues: {
          username: "alice",
          password: "[REDACTED]",
        },
      },
      tx,
      { actorUserId: "user-1" }
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("iteration.result.recorded");
    expect(payload).toEqual({
      iterationId: 9001,
      testRunCaseId: 50,
      testRunId: 7,
      statusId: 5,
      projectId: 42,
      rowIndex: 1,
      redactedValues: {
        username: "alice",
        password: "[REDACTED]",
      },
      statusName: "Passed",
      runTitle: "Run 7",
      displayKey: null,
    });
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(42);
    expect(opts.actorUserId).toBe("user-1");
  });

  it("requires a transaction client (throws when tx is missing)", async () => {
    await expect(
      emitIterationResultRecorded(
        {
          iterationId: 9001,
          testRunCaseId: 50,
          testRunId: 7,
          statusId: 5,
          projectId: 42,
          rowIndex: 0,
          redactedValues: {},
        },
        // @ts-expect-error — exercising the runtime guard against `as any` bypasses
        undefined,
        { actorUserId: "user-1" }
      )
    ).rejects.toThrow(/TxClient/);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("truncates redactedValues entries larger than 4 KB to a <value truncated: N bytes> sentinel", async () => {
    const tx = makeTx();
    const bigValue = "y".repeat(5 * 1024); // 5 KB, over the cap.
    await emitIterationResultRecorded(
      {
        iterationId: 9100,
        testRunCaseId: 60,
        testRunId: 8,
        statusId: 6,
        projectId: 42,
        rowIndex: 0,
        redactedValues: {
          short: "ok",
          payload: bigValue,
        },
      },
      tx
    );
    const [, payload] = emitMock.mock.calls[0];
    expect(payload.redactedValues.short).toBe("ok");
    expect(payload.redactedValues.payload).toMatch(
      /^<value truncated: \d+ bytes>$/
    );
    expect(payload.redactedValues.payload).toContain(`${5 * 1024}`);
  });

  it("WR-05: truncates nested-object values whose serialized size exceeds the cap", async () => {
    const tx = makeTx();
    // Single non-string top-level entry that previously escaped the
    // cap entirely. Serialized size is ~5 KB (the inner string + JSON
    // structural overhead).
    const blob = { blob: "x".repeat(5 * 1024) };
    await emitIterationResultRecorded(
      {
        iterationId: 9101,
        testRunCaseId: 60,
        testRunId: 8,
        statusId: 6,
        projectId: 42,
        rowIndex: 0,
        redactedValues: {
          short: "ok",
          nested: blob,
        },
      },
      tx
    );
    const [, payload] = emitMock.mock.calls[0];
    expect(payload.redactedValues.short).toBe("ok");
    expect(payload.redactedValues.nested).toMatch(
      /^<value truncated: \d+ bytes>$/
    );
  });

  it("WR-05: leaves small nested-object values unchanged", async () => {
    const tx = makeTx();
    const small = { foo: "bar", n: 1 };
    await emitIterationResultRecorded(
      {
        iterationId: 9102,
        testRunCaseId: 60,
        testRunId: 8,
        statusId: 6,
        projectId: 42,
        rowIndex: 0,
        redactedValues: { nested: small },
      },
      tx
    );
    const [, payload] = emitMock.mock.calls[0];
    expect(payload.redactedValues.nested).toEqual(small);
  });

  it("falls back to actorUserId undefined when not provided", async () => {
    const tx = makeTx();
    await emitIterationResultRecorded(
      {
        iterationId: 1,
        testRunCaseId: 2,
        testRunId: 3,
        statusId: 4,
        projectId: 5,
        rowIndex: 0,
        redactedValues: {},
      },
      tx
    );
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts.actorUserId).toBeUndefined();
  });

  it("uses opts.projectId override when supplied (allows the caller to set explicit project scope)", async () => {
    const tx = makeTx();
    await emitIterationResultRecorded(
      {
        iterationId: 1,
        testRunCaseId: 2,
        testRunId: 3,
        statusId: 4,
        projectId: 5,
        rowIndex: 0,
        redactedValues: {},
      },
      tx,
      { projectId: 999 }
    );
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts.projectId).toBe(999);
  });
});
