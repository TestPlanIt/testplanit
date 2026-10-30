import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: { $qb: {} },
}));

// The health query is raw SQL; capture the statement text and feed rows back.
const mockedRows = vi.fn<() => unknown[]>(() => []);
const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
vi.mock("kysely", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const flatten = (v: unknown): string =>
      v && typeof v === "object" && "text" in (v as any)
        ? (v as any).text
        : "?";
    const text = strings.reduce(
      (acc, part, i) =>
        acc + part + (i < values.length ? flatten(values[i]) : ""),
      ""
    );
    const fragment = {
      text,
      values,
      execute: async () => {
        sqlCalls.push({ text, values });
        return { rows: mockedRows() };
      },
    };
    return fragment;
  };
  return { sql };
});

vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: vi.fn(),
}));

vi.mock("~/utils/reportGrouping", () => ({
  resolveReportFolderFilter: vi.fn(async () => null),
}));

import { authorizeReportRequest } from "~/utils/reportApiUtils";
import {
  handleTestCaseHealthPOST,
  TEST_CASE_HEALTH_MAX_PAGE_SIZE,
} from "~/utils/testCaseHealthUtils";

const post = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/report-builder/test-case-health", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

type RawRow = {
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  test_case_has_parameters: boolean;
  test_case_automated: boolean;
  created_at: Date;
  last_executed_at: Date | null;
  all_time_last_executed_at: Date | null;
  total_executions: bigint;
  pass_count: bigint;
  fail_count: bigint;
  project_id?: number;
  project_name?: string;
};

function rawRow(id: number, overrides: Partial<RawRow> = {}): RawRow {
  return {
    test_case_id: id,
    test_case_name: `Case ${id}`,
    test_case_source: "MANUAL",
    test_case_has_parameters: false,
    test_case_automated: false,
    created_at: daysAgo(400),
    last_executed_at: null,
    all_time_last_executed_at: null,
    total_executions: 0n,
    pass_count: 0n,
    fail_count: 0n,
    ...overrides,
  };
}

// Five cases: one always failing (fresh), one never executed, one always
// passing, one healthy but stale, one healthy and fresh.
function fixtureRows(): RawRow[] {
  return [
    rawRow(1, {
      test_case_name: "Checkout",
      last_executed_at: daysAgo(1),
      all_time_last_executed_at: daysAgo(1),
      total_executions: 6n,
      pass_count: 0n,
      fail_count: 6n,
    }),
    rawRow(2, { test_case_name: "Archive" }),
    rawRow(3, {
      test_case_name: "Login",
      last_executed_at: daysAgo(2),
      all_time_last_executed_at: daysAgo(2),
      total_executions: 8n,
      pass_count: 8n,
      fail_count: 0n,
    }),
    rawRow(4, {
      test_case_name: "Export",
      last_executed_at: null,
      all_time_last_executed_at: daysAgo(45),
      total_executions: 0n,
    }),
    rawRow(5, {
      test_case_name: "Billing",
      last_executed_at: daysAgo(3),
      all_time_last_executed_at: daysAgo(3),
      total_executions: 10n,
      pass_count: 7n,
      fail_count: 3n,
    }),
  ];
}

describe("handleTestCaseHealthPOST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
    mockedRows.mockReturnValue(fixtureRows());
    (authorizeReportRequest as any).mockResolvedValue({
      ok: true,
      bypass: false,
    });
  });

  it("computes the all-time last execution with set-based aggregates, not a per-case LATERAL", async () => {
    await handleTestCaseHealthPOST(post({ projectId: 1 }), false);

    expect(sqlCalls).toHaveLength(1);
    const { text } = sqlCalls[0];
    expect(text).not.toMatch(/JOIN LATERAL/);
    expect(text).toMatch(/manual_all_time AS \(/);
    expect(text).toMatch(/junit_all_time AS \(/);
    expect(text).toMatch(/FULL OUTER JOIN junit_all_time/);
    expect(text).toMatch(/GREATEST\(m\.last_at, j\.last_at\)/);
    // The window filter scopes the stats CTE only; all-time stays unwindowed.
    expect(text.split("GROUP BY").length).toBeGreaterThanOrEqual(4);
  });

  it("serves every row with the default order and a summary over the whole set", async () => {
    const response = await handleTestCaseHealthPOST(
      post({ projectId: 1 }),
      false
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(5);
    expect(body.pageSize).toBe("All");
    expect(body.page).toBe(1);
    expect(body.data.map((r: any) => r.testCaseName)).toEqual([
      "Checkout", // always_failing first
      "Archive", // never_executed
      "Login", // always_passing
      "Export", // healthy, stale before fresh
      "Billing", // healthy
    ]);
    expect(body.summary).toMatchObject({
      total: 5,
      counts: {
        always_failing: 1,
        never_executed: 1,
        always_passing: 1,
        healthy: 2,
      },
      staleCount: 1,
      needsAttention: 3,
      healthy: 3,
    });
    expect(typeof body.summary.avgHealthScore).toBe("number");
  });

  it("returns one page of a numeric pageSize while total and summary describe the whole set", async () => {
    const response = await handleTestCaseHealthPOST(
      post({ projectId: 1, page: 2, pageSize: 2 }),
      false
    );
    const body = await response.json();

    expect(body.total).toBe(5);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.data.map((r: any) => r.testCaseName)).toEqual([
      "Login",
      "Export",
    ]);
    expect(body.summary.total).toBe(5);
  });

  it("clamps the page size and tolerates a nonsense page", async () => {
    const response = await handleTestCaseHealthPOST(
      post({ projectId: 1, page: "x", pageSize: 999999 }),
      false
    );
    const body = await response.json();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(TEST_CASE_HEALTH_MAX_PAGE_SIZE);
    expect(body.data).toHaveLength(5);
  });

  it("applies a header sort over the full set before paging, with the column ids the table uses", async () => {
    const response = await handleTestCaseHealthPOST(
      post({
        projectId: 1,
        page: 1,
        pageSize: 3,
        sortColumn: "testCaseName",
        sortDirection: "desc",
      }),
      false
    );
    const body = await response.json();

    expect(body.data.map((r: any) => r.testCaseName)).toEqual([
      "Login",
      "Export",
      "Checkout",
    ]);
    expect(body.total).toBe(5);
  });

  it("filters by derived status before building the summary and paging", async () => {
    const response = await handleTestCaseHealthPOST(
      post({
        projectId: 1,
        healthStatusFilter: ["healthy"],
        pageSize: 1,
      }),
      false
    );
    const body = await response.json();

    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].testCaseName).toBe("Export");
    expect(body.summary).toMatchObject({
      total: 2,
      counts: { healthy: 2, always_failing: 0 },
      staleCount: 1,
    });
  });

  it("still requires a project for the project-scoped route", async () => {
    const response = await handleTestCaseHealthPOST(post({}), false);
    expect(response.status).toBe(400);
    expect(sqlCalls).toHaveLength(0);
  });
});
