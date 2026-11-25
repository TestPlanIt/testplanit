import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  isAdmin: vi.fn(),
  hasArea: vi.fn(),
  findCase: vi.fn(),
  decide: vi.fn(),
  regenerate: vi.fn(),
  tx: { tag: "tx" },
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: (...args: any[]) => any) => handler,
}));
vi.mock("~/lib/db/requestRouting", () => ({
  withRequestRouting: (handler: (...args: any[]) => any) => handler,
}));
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mocks.session(...args),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: { findUnique: (...a: any[]) => mocks.findCase(...a) },
  },
}));
vi.mock("~/lib/multiTenantDb", () => ({ getCurrentTenantId: () => "t1" }));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx),
}));
vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: (...a: any[]) => mocks.isAdmin(...a),
  userHasAreaPermission: (...a: any[]) => mocks.hasArea(...a),
}));
vi.mock("~/lib/services/caseUpkeep/decide", () => ({
  decideSuggestion: (...a: any[]) => mocks.decide(...a),
}));
vi.mock("~/lib/services/caseUpkeep/regenerate", () => ({
  regenerateSuggestion: (...a: any[]) => mocks.regenerate(...a),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function call(
  body: unknown,
  ids: { caseId?: string; suggestionId?: string } = {}
) {
  const request = new NextRequest(
    "http://localhost:3000/api/repository/cases/12/suggestions/9",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
  return POST(request, {
    params: Promise.resolve({
      caseId: ids.caseId ?? "12",
      suggestionId: ids.suggestionId ?? "9",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "u1" } });
  mocks.findCase.mockResolvedValue({ projectId: 7 });
  mocks.isAdmin.mockResolvedValue(false);
  mocks.hasArea.mockResolvedValue(true);
  mocks.decide.mockResolvedValue({ ok: true, status: "APPLIED" });
  mocks.regenerate.mockResolvedValue({ ok: true, outcome: "suggested" });
});

describe("POST /api/repository/cases/[caseId]/suggestions/[suggestionId]", () => {
  it("refuses a request with no session", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await call({ action: "apply" });
    expect(response.status).toBe(401);
    expect(mocks.findCase).not.toHaveBeenCalled();
  });

  it("refuses ids that are not numbers, an unknown action and a body that is not JSON", async () => {
    for (const response of [
      await call({ action: "apply" }, { caseId: "abc" }),
      await call({ action: "apply" }, { suggestionId: "1.5" }),
      await call({ action: "delete" }),
      await call({}),
      await call("not json"),
    ]) {
      expect(response.status).toBe(400);
    }
    expect(mocks.findCase).not.toHaveBeenCalled();
  });

  it("answers 404 for a case that does not exist", async () => {
    mocks.findCase.mockResolvedValue(null);
    const response = await call({ action: "apply" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found" });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("refuses a user who can neither administer the project nor edit its test cases", async () => {
    mocks.hasArea.mockResolvedValue(false);
    const response = await call({ action: "dismiss" });
    expect(response.status).toBe(403);
    expect(mocks.isAdmin).toHaveBeenCalledWith("u1", 7);
    expect(mocks.hasArea).toHaveBeenCalledWith(
      "u1",
      7,
      "TestCaseRepository",
      "canAddEdit"
    );
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it("lets a project administrator through without the area check", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.hasArea.mockResolvedValue(false);
    const response = await call({ action: "apply" });
    expect(response.status).toBe(200);
    expect(mocks.hasArea).not.toHaveBeenCalled();
  });

  it("applies and dismisses inside one audited transaction, as the signed-in user", async () => {
    for (const action of ["apply", "dismiss"] as const) {
      mocks.decide.mockResolvedValue({
        ok: true,
        status: action === "apply" ? "APPLIED" : "DISMISSED",
      });
      const response = await call({ action });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        status: action === "apply" ? "APPLIED" : "DISMISSED",
      });
      expect(mocks.decide).toHaveBeenLastCalledWith(mocks.tx, {
        suggestionId: 9,
        caseId: 12,
        action,
        userId: "u1",
      });
    }
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it("regenerates for the signed-in user and tenant", async () => {
    const response = await call({ action: "regenerate" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "suggested" });
    expect(mocks.regenerate).toHaveBeenCalledWith(expect.anything(), {
      suggestionId: 9,
      caseId: 12,
      userId: "u1",
      tenantId: "t1",
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["gone", 404],
    ["not_pending", 409],
    ["stale", 409],
  ] as const)(
    "answers a %s refusal with %i and its code",
    async (code, status) => {
      mocks.decide.mockResolvedValue({ ok: false, code });
      const response = await call({ action: "apply" });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
    }
  );

  it.each([
    ["no_llm", 409],
    ["failed", 502],
  ] as const)("answers a regenerate %s with %i", async (code, status) => {
    mocks.regenerate.mockResolvedValue({ ok: false, code, detail: "secret" });
    const response = await call({ action: "regenerate" });
    expect(response.status).toBe(status);
    // The model's own error text is not passed on to the browser.
    expect(await response.json()).toEqual({ code });
  });

  it("answers 500 when the work throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.decide.mockRejectedValue(new Error("deadlock"));
    const response = await call({ action: "apply" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "failed" });
  });
});
