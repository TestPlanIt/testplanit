/**
 * PARAM-06 wiring contract: every parameter add/remove/rename/retype
 * passes through the `parameterMutations` helpers — which are the
 * canonical place that bumps `RepositoryCases.currentVersion` and
 * snapshots the case via `createTestCaseVersionInTransaction`.
 *
 * This test asserts that ALL three route surfaces (POST/PATCH/DELETE)
 * delegate to the version-bumping helpers. The helpers themselves are
 * unit-tested in `parameterMutations.test.ts` to verify they call
 * `currentVersion: { increment: 1 }` and `createTestCaseVersionInTransaction`.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { txMock, sessionRef } = vi.hoisted(() => {
  const tx: any = {};
  return {
    txMock: tx,
    sessionRef: {
      current: { user: { id: "u-1", name: "U", email: "u@e.com" } },
    },
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

// All three route surfaces open their transaction via auditedEnhancedTransaction
// (GUC + tx enhance), whose internals are covered by its own tests. Stub it to
// run the caller's callback with txMock so we can assert each route delegates to
// the version-bumping parameter helper with that same tx.
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedEnhancedTransaction: vi.fn(
    async (_session: unknown, fn: (t: any) => Promise<unknown>) => fn(txMock)
  ),
}));

const helperSpies = vi.hoisted(() => ({
  createParameterInTransaction: vi.fn(),
  updateParameterInTransaction: vi.fn(),
  softDeleteParameterInTransaction: vi.fn(),
}));

vi.mock("~/lib/services/parameterMutations", () => ({
  createParameterInTransaction: helperSpies.createParameterInTransaction,
  updateParameterInTransaction: helperSpies.updateParameterInTransaction,
  softDeleteParameterInTransaction:
    helperSpies.softDeleteParameterInTransaction,
}));

import { POST as parametersPost } from "~/app/api/repository/cases/[caseId]/parameters/route";
import {
  PATCH as paramPatch,
  DELETE as paramDelete,
} from "~/app/api/repository/cases/[caseId]/parameters/[paramId]/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  helperSpies.createParameterInTransaction.mockResolvedValue({ id: 1 });
  helperSpies.updateParameterInTransaction.mockResolvedValue({ id: 1 });
  helperSpies.softDeleteParameterInTransaction.mockResolvedValue(undefined);
});

describe("PARAM-06 — every parameter mutation routes through helpers that bump the version", () => {
  it("POST routes through createParameterInTransaction", async () => {
    const res = await parametersPost(
      jsonRequest({ name: "x", type: "STRING" }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(200);
    expect(helperSpies.createParameterInTransaction).toHaveBeenCalledTimes(1);
    expect(helperSpies.createParameterInTransaction.mock.calls[0][0]).toBe(
      txMock
    );
  });

  it("PATCH routes through updateParameterInTransaction (rename = retype = field change)", async () => {
    const res = await paramPatch(jsonRequest({ sensitive: true }), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(helperSpies.updateParameterInTransaction).toHaveBeenCalledTimes(1);
    expect(helperSpies.updateParameterInTransaction.mock.calls[0][0]).toBe(
      txMock
    );
  });

  it("DELETE routes through softDeleteParameterInTransaction", async () => {
    const res = await paramDelete(jsonRequest({}), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(helperSpies.softDeleteParameterInTransaction).toHaveBeenCalledTimes(
      1
    );
    expect(helperSpies.softDeleteParameterInTransaction.mock.calls[0][0]).toBe(
      txMock
    );
  });
});
