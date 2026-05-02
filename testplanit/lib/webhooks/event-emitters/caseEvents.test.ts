import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitCaseCreated,
  emitCaseDeleted,
  emitCaseUpdated,
} from "./caseEvents";

/**
 * caseEvents emitter contract.
 *
 * catalog: case.created / case.updated / case.deleted.
 * case.created ships full case structure (caseFieldValues + steps).
 * case.updated carries computeObjectDiff result.
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "row_1",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

const baseCase = {
  id: 11,
  projectId: 7,
  name: "Case 11",
  className: null,
  automated: false,
  stateId: 1,
  templateId: 100,
};

interface TxStub {
  repositoryCases: { findUnique: ReturnType<typeof vi.fn> };
}

function makeTx(
  caseFieldValues: Array<{ id: number; value: unknown }> = [],
  steps: Array<{ id: number; description: string }> = []
): TxStub {
  return {
    repositoryCases: {
      findUnique: vi.fn(async () => ({
        ...baseCase,
        caseFieldValues,
        steps,
      })),
    },
  };
}

describe("emitCaseCreated", () => {
  beforeEach(() => emitMock.mockClear());

  it("emits case.created with full structure (fields + steps)", async () => {
    const tx = makeTx(
      [{ id: 1, value: "Severity: high" }],
      [
        { id: 10, description: "Open browser" },
        { id: 11, description: "Click login" },
      ]
    );
    await emitCaseCreated(baseCase, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("case.created");
    expect(payload).toMatchObject({
      id: 11,
      projectId: 7,
      name: "Case 11",
      automated: false,
      fields: [{ id: 1, value: "Severity: high" }],
      steps: [
        { id: 10, description: "Open browser" },
        { id: 11, description: "Click login" },
      ],
    });
    expect(opts.tx).toBe(tx);
  });

  it("returns silently if the case was deleted between insert and emit", async () => {
    const tx = {
      repositoryCases: { findUnique: vi.fn(async () => null) },
    };
    await emitCaseCreated(baseCase, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitCaseUpdated", () => {
  beforeEach(() => emitMock.mockClear());

  it("does NOT emit when oldRow === newRow (zero diff)", async () => {
    const tx = makeTx();
    await emitCaseUpdated(baseCase, baseCase, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("emits case.updated with diff.changedFields populated", async () => {
    const tx = makeTx();
    await emitCaseUpdated(
      { ...baseCase, name: "Old name" },
      { ...baseCase, name: "New name" },
      tx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("case.updated");
    const diff = (payload as { diff: { changedFields: string[] } }).diff;
    expect(diff.changedFields).toContain("name");
  });

  it("returns silently when oldRow is null", async () => {
    const tx = makeTx();
    await emitCaseUpdated(null, baseCase, tx as never);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitCaseDeleted", () => {
  beforeEach(() => emitMock.mockClear());

  it("emits case.deleted with id + name from the pre-delete snapshot", async () => {
    const tx = makeTx();
    await emitCaseDeleted(baseCase, tx as never);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("case.deleted");
    expect(payload).toMatchObject({
      id: 11,
      name: "Case 11",
      projectId: 7,
    });
  });
});
