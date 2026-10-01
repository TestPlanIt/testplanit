/**
 * POST value-lookup branch of handleReportPOST: `{ dimensionId, ids }`
 * resolves picker labels for a stored selection. The id list can run to
 * thousands of entries (the picker's "Select all"), so it travels in the
 * body and is chunked before it reaches the dimension's DB lookup.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ baseDb: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));

import { getServerSession } from "next-auth";
import { handleReportPOST } from "./reportApiUtils";

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/report-builder/test-execution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const filterValues = vi.fn();
const statusValues = [
  { id: 1, name: "Passed" },
  { id: 2, name: "Failed" },
  { id: 3, name: "Blocked" },
];

const config = {
  reportType: "test-execution",
  requiresProjectId: true,
  requiresAdmin: false,
  createDimensionRegistry: () => ({
    testRun: {
      id: "testRun",
      label: "Test Run",
      groupBy: "testRunId",
      join: {},
      getValues: async () => [],
      display: (v: any) => v,
      filterValues,
    },
    status: {
      id: "status",
      label: "Status",
      groupBy: "statusId",
      join: {},
      getValues: async () => statusValues,
      display: (v: any) => ({ id: v.id, name: v.name }),
    },
  }),
  createMetricRegistry: () => ({}),
};

describe("handleReportPOST value lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ADMIN skips the project-membership query.
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin", access: "ADMIN" },
    } as never);
    filterValues.mockImplementation(async (_db, _projectId, opts) => ({
      results: (opts.ids ?? []).map((id: string) => ({
        id: Number(id),
        name: `Run ${id}`,
      })),
      total: (opts.ids ?? []).length,
    }));
  });

  it("401s without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await handleReportPOST(
      postReq({ projectId: 7, dimensionId: "testRun", ids: [1] }),
      config
    );
    expect(res.status).toBe(401);
  });

  it("requires a project id for project-scoped reports", async () => {
    const res = await handleReportPOST(
      postReq({ dimensionId: "testRun", ids: [1] }),
      config
    );
    expect(res.status).toBe(400);
  });

  it("400s for an unknown dimension or a non-array ids", async () => {
    expect(
      (
        await handleReportPOST(
          postReq({ projectId: 7, dimensionId: "nope", ids: [1] }),
          config
        )
      ).status
    ).toBe(400);
    expect(
      (
        await handleReportPOST(
          postReq({ projectId: 7, dimensionId: "testRun", ids: "1,2" }),
          config
        )
      ).status
    ).toBe(400);
  });

  it("returns an empty lookup without querying when ids is empty", async () => {
    const res = await handleReportPOST(
      postReq({ projectId: 7, dimensionId: "testRun", ids: [] }),
      config
    );
    expect(await res.json()).toEqual({ results: [], total: 0 });
    expect(filterValues).not.toHaveBeenCalled();
  });

  it("looks up a small id list in one DB call sized to the list", async () => {
    const res = await handleReportPOST(
      postReq({ projectId: 7, dimensionId: "testRun", ids: [5, "6", " 7 "] }),
      config
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: 5, name: "Run 5" },
        { id: 6, name: "Run 6" },
        { id: 7, name: "Run 7" },
      ],
      total: 3,
    });
    expect(filterValues).toHaveBeenCalledTimes(1);
    expect(filterValues.mock.calls[0][1]).toBe(7);
    expect(filterValues.mock.calls[0][2]).toEqual({
      search: undefined,
      ids: ["5", "6", "7"],
      skip: 0,
      take: 3,
    });
  });

  it("chunks a large id list at 1,000 per query and concatenates the results", async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    const res = await handleReportPOST(
      postReq({ projectId: 7, dimensionId: "testRun", ids }),
      config
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2500);
    expect(body.results).toHaveLength(2500);
    expect(body.results[0]).toEqual({ id: 1, name: "Run 1" });
    expect(body.results[2499]).toEqual({ id: 2500, name: "Run 2500" });

    expect(filterValues).toHaveBeenCalledTimes(3);
    const takes = filterValues.mock.calls.map((c) => c[2].take);
    expect(takes).toEqual([1000, 1000, 500]);
    expect(filterValues.mock.calls[2][2].ids[0]).toBe("2001");
  });

  it("falls back to the dimension's getValues for dimensions without a DB lookup", async () => {
    const res = await handleReportPOST(
      postReq({ projectId: 7, dimensionId: "status", ids: [3, 1, 99] }),
      config
    );
    expect(await res.json()).toEqual({
      results: [
        { id: 1, name: "Passed" },
        { id: 3, name: "Blocked" },
      ],
      total: 2,
    });
  });
});
