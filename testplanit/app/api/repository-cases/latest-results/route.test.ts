import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The linked-cases panel and the repository list's Latest Results column both
 * come through here, so this route is the single place "latest result" is
 * answered for the client. The ranking query runs on the raw client, which
 * makes the policy-layer narrowing below the only thing standing between a
 * caller and another project's execution history.
 */

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

const mockFindMany = vi.fn();
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    repositoryCases: { findMany: (...args: any[]) => mockFindMany(...args) },
  })),
}));

vi.mock("~/lib/services/latestTestResults", () => ({
  getLatestTestResultsByCase: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getLatestTestResultsByCase } from "~/lib/services/latestTestResults";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedGetLatest = getLatestTestResultsByCase as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/repository-cases/latest-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const execution = {
  resultId: 1,
  testRunId: 55,
  statusName: "Passed",
  statusColor: "#22c55e",
  isSuccess: true,
  isFailure: false,
  executedAt: "2026-02-02T10:00:00.000Z",
};

describe("POST /api/repository-cases/latest-results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "u1" } });
    mockFindMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    mockedGetLatest.mockResolvedValue(new Map([[10, [execution]]]));
  });

  it("401s without a session", async () => {
    mockedSession.mockResolvedValue(null);
    const response = await POST(makeRequest({ caseIds: [10] }));
    expect(response.status).toBe(401);
  });

  it("400s when caseIds is not an array", async () => {
    const response = await POST(makeRequest({ caseIds: "10" }));
    expect(response.status).toBe(400);
  });

  it("returns nothing for an empty list without querying", async () => {
    const response = await POST(makeRequest({ caseIds: [] }));
    expect(await response.json()).toEqual({ results: {} });
    expect(mockedGetLatest).not.toHaveBeenCalled();
  });

  it("only asks about cases the policy layer returned", async () => {
    mockFindMany.mockResolvedValue([{ id: 10 }]);
    await POST(makeRequest({ caseIds: [10, 11, 12] }));
    expect(mockedGetLatest).toHaveBeenCalledWith([10], expect.any(Number));
  });

  it("drops non-integer ids before they reach the raw query", async () => {
    await POST(makeRequest({ caseIds: [10, "11", null, 12.5] }));
    const [, whereArg] = [null, mockFindMany.mock.calls[0][0]];
    expect(whereArg.where.id.in).toEqual([10]);
  });

  it("keys the executions by case id", async () => {
    const response = await POST(makeRequest({ caseIds: [10, 11] }));
    expect(await response.json()).toEqual({ results: { 10: [execution] } });
  });

  it("caps the requested limit", async () => {
    await POST(makeRequest({ caseIds: [10], limit: 5000 }));
    const [, limit] = mockedGetLatest.mock.calls[0];
    expect(limit).toBeLessThanOrEqual(5);
  });

  it("honours a smaller limit", async () => {
    await POST(makeRequest({ caseIds: [10], limit: 1 }));
    const [, limit] = mockedGetLatest.mock.calls[0];
    expect(limit).toBe(1);
  });

  it("500s when the ranking query fails", async () => {
    mockedGetLatest.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(makeRequest({ caseIds: [10] }));
    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});
