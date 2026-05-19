/**
 * Atomicity contract for parameter rename: the rewrite of step JSON +
 * dataset row keys + version snapshot all happen inside the SAME
 * `$transaction`. If any step throws, the route handler must propagate
 * the failure (which the caller's `$transaction` rolls back).
 *
 * This test asserts the wiring contract — the route opens a single
 * transaction and the helper does ALL its work inside it. Real database
 * rollback is exercised by the underlying transaction client when a
 * non-mocked DB is used; here we prove the route never escapes the tx.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, txMock, sessionRef } = vi.hoisted(() => {
  const tx = { __isTransaction__: true } as any;
  const db = {
    $transaction: vi.fn(async (fn: (t: any) => Promise<unknown>) => fn(tx)),
    testCaseParameter: { findFirst: vi.fn() },
  };
  return {
    mockDb: db,
    txMock: tx,
    sessionRef: { current: { user: { id: "u-1", name: "U", email: "u@e.com" } } },
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => mockDb),
}));

const helperSpies = vi.hoisted(() => ({
  updateParameterInTransaction: vi.fn(),
}));

vi.mock("~/lib/services/parameterMutations", () => ({
  updateParameterInTransaction: helperSpies.updateParameterInTransaction,
  createParameterInTransaction: vi.fn(),
  softDeleteParameterInTransaction: vi.fn(),
}));

import { PATCH as paramPatch } from "~/app/api/repository/cases/[caseId]/parameters/[paramId]/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  helperSpies.updateParameterInTransaction.mockResolvedValue({
    id: 1,
    name: "newName",
  });
});

describe("rename atomicity wiring", () => {
  it("invokes updateParameterInTransaction with the SAME tx the $transaction created", async () => {
    await paramPatch(jsonRequest({ name: "newName" }), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(helperSpies.updateParameterInTransaction).toHaveBeenCalledTimes(1);
    const passedTx = helperSpies.updateParameterInTransaction.mock.calls[0][0];
    expect(passedTx).toBe(txMock);
  });

  it("propagates helper errors so caller transaction rolls back", async () => {
    helperSpies.updateParameterInTransaction.mockRejectedValueOnce(
      new Error("simulated rewrite failure"),
    );
    const res = await paramPatch(jsonRequest({ name: "newName" }), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    // Route returns 500; the underlying $transaction would roll back DB writes
    // because the rejection bubbled out of the transaction callback.
    expect(res.status).toBe(500);
  });
});
