import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: { $qb: {} },
}));

// The coverage query is raw SQL; feed rows back from the mock.
const mockedRows = vi.fn<() => unknown[]>(() => []);
vi.mock("kysely", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
    execute: async () => ({ rows: mockedRows() }),
  });
  return { sql };
});

vi.mock("~/lib/services/latestCaseResults", () => ({
  latestCaseResultsCte: () => ({ text: "latest_results AS (...)", values: [] }),
}));

vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: vi.fn(),
}));

import { authorizeReportRequest } from "~/utils/reportApiUtils";
import {
  handleIssueTestCoveragePOST,
  ISSUE_TEST_COVERAGE_MAX_PAGE_SIZE,
} from "~/utils/issueTestCoverageUtils";

const post = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/report-builder/issue-test-coverage", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

function rawRow(
  issueId: number,
  issueName: string,
  testCaseId: number,
  outcome: "pass" | "fail" | "none"
) {
  return {
    issue_id: issueId,
    issue_name: issueName,
    issue_title: `${issueName} title`,
    issue_status: "Open",
    issue_external_status: null,
    issue_priority: null,
    issue_type_name: "Bug",
    issue_type_icon_url: null,
    issue_data: {},
    external_id: null,
    external_key: issueName,
    external_url: null,
    last_synced_at: null,
    integration_id: null,
    integration_provider: null,
    test_case_id: testCaseId,
    test_case_name: `Case ${testCaseId}`,
    test_case_source: "MANUAL",
    test_case_has_parameters: false,
    test_case_automated: false,
    last_status_id: outcome === "none" ? null : 1,
    last_status_name: outcome === "none" ? null : "S",
    last_status_color: null,
    last_status_is_success: outcome === "pass",
    last_status_is_failure: outcome === "fail",
    last_executed_at: outcome === "none" ? null : new Date("2026-10-01"),
  };
}

// Issue 10 "Alpha": 3 cases, one failing. Issue 20 "Beta": 1 passing case.
// Issue 30 "Gamma": 2 untested cases. SQL order is by issue id, case id.
function fixtureRows() {
  return [
    rawRow(10, "Alpha", 1, "pass"),
    rawRow(10, "Alpha", 2, "fail"),
    rawRow(10, "Alpha", 3, "none"),
    rawRow(20, "Beta", 4, "pass"),
    rawRow(30, "Gamma", 5, "none"),
    rawRow(30, "Gamma", 6, "none"),
  ];
}

describe("handleIssueTestCoveragePOST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRows.mockReturnValue(fixtureRows());
    (authorizeReportRequest as any).mockResolvedValue({
      ok: true,
      bypass: false,
    });
  });

  it("serves every row in the default order with a summary over the whole set", async () => {
    const response = await handleIssueTestCoveragePOST(
      post({ projectId: 1 }),
      false
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(6);
    expect(body.pageSize).toBe("All");
    // Most failures first (Alpha), then lowest pass rate (Gamma 0%), then Beta.
    expect(body.data.map((r: any) => r.issueName)).toEqual([
      "Alpha",
      "Alpha",
      "Alpha",
      "Gamma",
      "Gamma",
      "Beta",
    ]);
    expect(body.summary).toMatchObject({
      totalIssues: 3,
      totalLinkedTests: 6,
      totalPassed: 2,
      totalFailed: 1,
      totalUntested: 3,
      issuesWithFailures: 1,
      issuesAllPassing: 1,
      issuesWithUntested: 2,
      overallPassRate: 67,
    });
  });

  it("never splits an issue across pages: a page runs on to the issue's last row", async () => {
    const response = await handleIssueTestCoveragePOST(
      post({ projectId: 1, pageSize: 2 }),
      false
    );
    const body = await response.json();

    // Two rows asked, but Alpha has three, so all three come.
    expect(body.data.map((r: any) => r.testCaseId)).toEqual([1, 2, 3]);
    expect(body.total).toBe(6);
    expect(body.offset).toBe(0);
    expect(body.pageSize).toBe(2);

    const next = await (
      await handleIssueTestCoveragePOST(
        post({ projectId: 1, pageSize: 2, offset: body.data.length }),
        false
      )
    ).json();
    expect(next.data.map((r: any) => r.issueName)).toEqual(["Gamma", "Gamma"]);
    expect(next.offset).toBe(3);

    const last = await (
      await handleIssueTestCoveragePOST(
        post({ projectId: 1, pageSize: 2, offset: 5 }),
        false
      )
    ).json();
    expect(last.data.map((r: any) => r.issueName)).toEqual(["Beta"]);
  });

  it("applies the table's header sort over the full set before paging", async () => {
    const response = await handleIssueTestCoveragePOST(
      post({
        projectId: 1,
        pageSize: ISSUE_TEST_COVERAGE_MAX_PAGE_SIZE,
        sortColumn: "issueId", // renders the issue name, sorts by it
        sortDirection: "asc",
      }),
      false
    );
    const body = await response.json();
    expect(body.data.map((r: any) => r.issueName)).toEqual([
      "Alpha",
      "Alpha",
      "Alpha",
      "Beta",
      "Gamma",
      "Gamma",
    ]);
  });

  it("still requires a project for the project-scoped route", async () => {
    const response = await handleIssueTestCoveragePOST(post({}), false);
    expect(response.status).toBe(400);
  });
});
