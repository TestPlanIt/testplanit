import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitCaseCreated,
  emitCaseDeleted,
  emitCaseFieldValueChanged,
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
  appConfig: { findUnique: ReturnType<typeof vi.fn> };
}

// readRecordKeyConfig reads two AppConfig rows; a null row keeps the
// record-key feature disabled so displayKey resolves to null (no project
// lookup fired).
const appConfigStub = () => ({ findUnique: vi.fn(async () => null) });

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
    appConfig: appConfigStub(),
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

describe("emitCaseUpdated — resolved changes", () => {
  beforeEach(() => emitMock.mockClear());

  const fkTx = {
    repositoryCases: { findUnique: vi.fn(async () => null) },
    workflows: {
      findUnique: vi.fn(async ({ where: { id } }: any) => ({
        name: id === 14 ? "Active" : "Draft",
        color: { value: "#FFAA00" },
      })),
    },
    appConfig: appConfigStub(),
  };

  it("resolves stateId to a State row with the workflow color", async () => {
    await emitCaseUpdated(
      { ...baseCase, stateId: 14 },
      { ...baseCase, stateId: 11 },
      fkTx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [, payload] = emitMock.mock.calls[0];
    expect((payload as { changes: unknown }).changes).toEqual([
      { label: "State", from: "Active", to: "Draft", color: "#FFAA00" },
    ]);
  });

  it("does NOT emit when only bookkeeping columns changed", async () => {
    await emitCaseUpdated(
      { ...baseCase, currentVersion: 1 } as never,
      { ...baseCase, currentVersion: 2 } as never,
      fkTx as never
    );
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("emitCaseFieldValueChanged", () => {
  beforeEach(() => emitMock.mockClear());

  const fieldTx = {
    repositoryCases: {
      findUnique: vi.fn(async () => ({
        id: 11,
        name: "Case 11",
        projectId: 7,
        isDeleted: false,
      })),
    },
    caseFields: {
      findUnique: vi.fn(async () => ({
        displayName: "Priority",
        type: { type: "Dropdown" },
        fieldOptions: [
          { fieldOption: { id: 1, name: "Low" } },
          { fieldOption: { id: 2, name: "High" } },
        ],
      })),
    },
    appConfig: appConfigStub(),
  };

  it("emits case.updated with the resolved option label change", async () => {
    await emitCaseFieldValueChanged(
      { id: 5, testCaseId: 11, fieldId: 9, value: 1 },
      { id: 5, testCaseId: 11, fieldId: 9, value: 2 },
      fieldTx as never
    );
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("case.updated");
    expect((payload as { changes: unknown }).changes).toEqual([
      { label: "Priority", from: "Low", to: "High" },
    ]);
  });

  it("does NOT emit when the field value is unchanged", async () => {
    await emitCaseFieldValueChanged(
      { id: 5, testCaseId: 11, fieldId: 9, value: 2 },
      { id: 5, testCaseId: 11, fieldId: 9, value: 2 },
      fieldTx as never
    );
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
