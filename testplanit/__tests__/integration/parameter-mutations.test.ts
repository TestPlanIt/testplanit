import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTx, auditedTxSpy, sessionRef } = vi.hoisted(() => {
  const tx: any = {};
  return {
    mockTx: tx,
    // Stands in for the route's transaction boundary. The route now opens its
    // tx via auditedEnhancedTransaction (GUC + tx enhance) instead of
    // getEnhancedDb().$transaction; its internals are covered by that module's
    // own tests, so here we run the caller's callback with mockTx and assert the
    // route opened exactly one transaction through it.
    auditedTxSpy: vi.fn(
      async (_session: unknown, fn: (t: any) => Promise<unknown>) => fn(tx)
    ),
    sessionRef: {
      current: { user: { id: "u-1", name: "U", email: "u@e.com" } },
    },
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));

vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedEnhancedTransaction: auditedTxSpy,
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
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionRef.current = { user: { id: "u-1", name: "U", email: "u@e.com" } };
  helperSpies.createParameterInTransaction.mockResolvedValue({
    id: 1,
    name: "username",
  });
  helperSpies.updateParameterInTransaction.mockResolvedValue({
    id: 1,
    name: "username",
  });
  helperSpies.softDeleteParameterInTransaction.mockResolvedValue(undefined);
});

describe("POST /api/repository/cases/[caseId]/parameters", () => {
  it("returns 401 when unauthenticated", async () => {
    sessionRef.current = null as never;
    const res = await parametersPost(jsonRequest({}), {
      params: Promise.resolve({ caseId: "5" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when caseId is not numeric", async () => {
    const res = await parametersPost(jsonRequest({}), {
      params: Promise.resolve({ caseId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when SELECT body has both allowedValuesJson and lookupDataSetId (XOR fail)", async () => {
    const res = await parametersPost(
      jsonRequest({
        name: "env",
        type: "SELECT",
        allowedValuesJson: ["dev"],
        lookupDataSetId: 99,
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(400);
    expect(helperSpies.createParameterInTransaction).not.toHaveBeenCalled();
  });

  it("invokes createParameterInTransaction inside $transaction with valid body", async () => {
    const res = await parametersPost(
      jsonRequest({
        name: "username",
        type: "STRING",
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(200);
    expect(auditedTxSpy).toHaveBeenCalledTimes(1);
    expect(helperSpies.createParameterInTransaction).toHaveBeenCalledTimes(1);
    const args = helperSpies.createParameterInTransaction.mock.calls[0];
    expect(args[0]).toBe(mockTx);
    expect(args[1]).toBe(5);
    expect(args[2].name).toBe("username");
    expect(args[3]).toMatchObject({ id: "u-1" });
  });

  it("rolls up to 500 when helper throws", async () => {
    helperSpies.createParameterInTransaction.mockRejectedValueOnce(
      new Error("boom")
    );
    const res = await parametersPost(
      jsonRequest({ name: "username", type: "STRING" }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/repository/cases/[caseId]/parameters/[paramId]", () => {
  it("returns 401 when unauthenticated", async () => {
    sessionRef.current = null as never;
    const res = await paramPatch(jsonRequest({ name: "x" }), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is empty", async () => {
    const res = await paramPatch(jsonRequest({}), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(400);
  });

  it("invokes updateParameterInTransaction with valid name change", async () => {
    const res = await paramPatch(jsonRequest({ name: "newName" }), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(helperSpies.updateParameterInTransaction).toHaveBeenCalledTimes(1);
    const args = helperSpies.updateParameterInTransaction.mock.calls[0];
    expect(args[1]).toBe(5);
    expect(args[2]).toBe(1);
    expect(args[3]).toMatchObject({ name: "newName" });
  });
});

describe("DELETE /api/repository/cases/[caseId]/parameters/[paramId]", () => {
  it("returns 401 when unauthenticated", async () => {
    sessionRef.current = null as never;
    const res = await paramDelete(jsonRequest({}), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("invokes softDeleteParameterInTransaction inside $transaction", async () => {
    const res = await paramDelete(jsonRequest({}), {
      params: Promise.resolve({ caseId: "5", paramId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(auditedTxSpy).toHaveBeenCalledTimes(1);
    expect(helperSpies.softDeleteParameterInTransaction).toHaveBeenCalledTimes(
      1
    );
    const args = helperSpies.softDeleteParameterInTransaction.mock.calls[0];
    expect(args[1]).toBe(5);
    expect(args[2]).toBe(1);
  });
});
