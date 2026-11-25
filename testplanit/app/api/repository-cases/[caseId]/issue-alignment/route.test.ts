import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));
vi.mock("~/lib/utils/errors", () => ({
  isNotFoundError: vi.fn(),
  isAccessPolicyError: vi.fn(),
}));
vi.mock("~/lib/db/requestRouting", () => ({
  withRequestRouting: (handler: unknown) => handler,
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAccessPolicyError, isNotFoundError } from "~/lib/utils/errors";
import { POST } from "./route";

const session = getServerSession as unknown as ReturnType<typeof vi.fn>;
const enhancedDb = getEnhancedDb as unknown as ReturnType<typeof vi.fn>;
const notFound = isNotFoundError as unknown as ReturnType<typeof vi.fn>;
const denied = isAccessPolicyError as unknown as ReturnType<typeof vi.fn>;

function call(body?: unknown, caseId = "5") {
  const request = new NextRequest(
    `http://localhost/api/repository-cases/${caseId}/issue-alignment`,
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: typeof body === "string" ? body : JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
  return POST(request, { params: Promise.resolve({ caseId }) });
}

describe("POST /api/repository-cases/[caseId]/issue-alignment", () => {
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue({ user: { id: "user-1" } });
    update = vi.fn(async (args: any) => ({
      caseId: 5,
      issueId: 42,
      alignedAt: args.data.alignedAt,
    }));
    enhancedDb.mockResolvedValue({ repositoryCaseIssue: { update } });
    notFound.mockReturnValue(false);
    denied.mockReturnValue(false);
  });

  it("refuses a request with no session", async () => {
    session.mockResolvedValue(null);
    expect((await call({ issueId: 42 })).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a case id that is not a whole number", async () => {
    expect((await call({ issueId: 42 }, "abc")).status).toBe(400);
    expect((await call({ issueId: 42 }, "1.5")).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a missing, malformed or invalid body", async () => {
    for (const body of [
      undefined,
      "not json",
      {},
      { issueId: 0 },
      { issueId: "42" },
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("stamps the link with the server's clock through the policy client", async () => {
    const before = Date.now();
    const response = await call({ issueId: 42, alignedAt: "1999-01-01" });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { caseId_issueId: { caseId: 5, issueId: 42 } },
      data: { alignedAt: expect.any(Date) },
    });
    const stamped = (update.mock.calls[0][0].data.alignedAt as Date).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(new Date((await response.json()).alignedAt).getTime()).toBe(stamped);
  });

  it("answers 404 when the case is not linked to the issue", async () => {
    update.mockRejectedValue(new Error("not found"));
    notFound.mockReturnValue(true);
    expect((await call({ issueId: 42 })).status).toBe(404);
  });

  it("answers 403 when the user may not edit the case's links", async () => {
    update.mockRejectedValue(new Error("denied"));
    denied.mockReturnValue(true);
    expect((await call({ issueId: 42 })).status).toBe(403);
  });

  it("answers 500 for any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    update.mockRejectedValue(new Error("database is down"));
    expect((await call({ issueId: 42 })).status).toBe(500);
  });
});
