import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedCaseFieldValuesFindMany = vi.fn();
const mockedTagsFindMany = vi.fn();
vi.mock("~/lib/db", () => ({
  baseDb: {
    caseFieldValues: {
      findMany: (...args: any[]) => mockedCaseFieldValuesFindMany(...args),
    },
    tags: { findMany: (...args: any[]) => mockedTagsFindMany(...args) },
  },
}));

// The run-tag options are raw SQL; capture the statement and its values.
const mockedRunTagRows = vi.fn();
const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
vi.mock("kysely", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment = {
      text: strings.join("?"),
      values,
      execute: async () => {
        sqlCalls.push({ text: fragment.text, values });
        return { rows: mockedRunTagRows() };
      },
    };
    return fragment;
  };
  return { sql };
});

vi.mock("~/lib/services/latestTestResults", () => ({
  queryLatestTestResults: vi.fn(),
}));

vi.mock("~/lib/services/executionScopeFilterOptions", () => ({
  getExecutionScopeFilterOptions: vi.fn(),
}));

vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: vi.fn(),
}));

import { getExecutionScopeFilterOptions } from "~/lib/services/executionScopeFilterOptions";
import { queryLatestTestResults } from "~/lib/services/latestTestResults";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import {
  handleFlakyTestsOptionsGET,
  handleFlakyTestsPOST,
} from "~/utils/flakyTestsUtils";

const post = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/report-builder/flaky-tests", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const get = (query = "") =>
  new NextRequest(`http://localhost/api/report-builder/flaky-tests${query}`);

const queryOptions = () => (queryLatestTestResults as any).mock.calls[0][0];

describe("handleFlakyTestsPOST filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authorizeReportRequest as any).mockResolvedValue({
      ok: true,
      bypass: false,
    });
    (queryLatestTestResults as any).mockResolvedValue([]);
  });

  it("passes case and run filters through to the results query", async () => {
    const response = await handleFlakyTestsPOST(
      post({
        projectId: 7,
        templateIds: [1],
        stateIds: [2, 3],
        caseTagIds: [4],
        runTagIds: [5],
        milestoneIds: [6],
        configIds: [8],
      }),
      false
    );

    expect(response.status).toBe(200);
    expect(queryOptions()).toMatchObject({
      projectId: 7,
      projectIds: undefined,
      caseIds: undefined,
      templateIds: [1],
      stateIds: [2, 3],
      caseTagIds: [4],
      runTagIds: [5],
      milestoneIds: [6],
      configIds: [8],
    });
  });

  it("treats empty and null filters as inactive", async () => {
    await handleFlakyTestsPOST(
      post({
        projectId: 7,
        templateIds: [],
        caseTagIds: null,
        milestoneIds: [],
        dynamicFieldFilters: {},
      }),
      false
    );

    const options = queryOptions();
    expect(options.templateIds).toBeUndefined();
    expect(options.caseTagIds).toBeUndefined();
    expect(options.milestoneIds).toBeUndefined();
    expect(options.caseIds).toBeUndefined();
    expect(mockedCaseFieldValuesFindMany).not.toHaveBeenCalled();
  });

  it("ignores the project filter on the project-scoped report", async () => {
    await handleFlakyTestsPOST(post({ projectId: 7, projectIds: [9] }), false);

    expect(queryOptions()).toMatchObject({ projectId: 7 });
    expect(queryOptions().projectIds).toBeUndefined();
  });

  it("applies the project filter on the cross-project report", async () => {
    await handleFlakyTestsPOST(post({ projectIds: [9, 10] }), true);

    expect(queryOptions()).toMatchObject({
      projectId: null,
      projectIds: [9, 10],
    });
  });

  it.each([
    ["a non-array id list", { caseTagIds: "4" }],
    ["a non-positive id", { runTagIds: [0] }],
    ["a non-integer id", { templateIds: [1.5] }],
    ["a malformed milestone scope", { milestoneIds: ["x"] }],
    ["a non-object custom field filter", { dynamicFieldFilters: [1] }],
    ["an invalid custom field id", { dynamicFieldFilters: { abc: ["x"] } }],
  ])("rejects %s with 400", async (_label, filters) => {
    const response = await handleFlakyTestsPOST(
      post({ projectId: 7, ...filters }),
      false
    );

    expect(response.status).toBe(400);
    expect(queryLatestTestResults).not.toHaveBeenCalled();
  });

  it("narrows to cases matching every custom field filter", async () => {
    mockedCaseFieldValuesFindMany.mockResolvedValue([
      // Case 1 matches both fields (field 20 is a multi-select).
      { testCaseId: 1, fieldId: 10, value: "High" },
      { testCaseId: 1, fieldId: 20, value: ["web", "api"] },
      // Case 2 matches field 10 only.
      { testCaseId: 2, fieldId: 10, value: "High" },
      { testCaseId: 2, fieldId: 20, value: ["mobile"] },
      // Case 3 matches neither.
      { testCaseId: 3, fieldId: 10, value: "Low" },
    ]);

    await handleFlakyTestsPOST(
      post({
        projectId: 7,
        dynamicFieldFilters: { 10: ["High"], 20: ["api"] },
      }),
      false
    );

    expect(mockedCaseFieldValuesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fieldId: { in: [10, 20] },
          testCase: { isDeleted: false, projectId: { in: [7] } },
        }),
      })
    );
    expect(queryOptions().caseIds).toEqual([1]);
  });

  it("sends an empty case list when no case matches the custom fields", async () => {
    mockedCaseFieldValuesFindMany.mockResolvedValue([]);

    await handleFlakyTestsPOST(
      post({ projectId: 7, dynamicFieldFilters: { 10: ["High"] } }),
      false
    );

    expect(queryOptions().caseIds).toEqual([]);
  });
});

describe("handleFlakyTestsOptionsGET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
    mockedRunTagRows.mockReturnValue([]);
    (authorizeReportRequest as any).mockResolvedValue({
      ok: true,
      bypass: false,
    });
    (getExecutionScopeFilterOptions as any).mockResolvedValue({
      milestones: [{ id: 3, name: "Release 1", parentId: null }],
      configurations: [{ id: 4, name: "Chrome" }],
    });
  });

  it("returns case tags, run tags, and the project's execution scope", async () => {
    mockedTagsFindMany.mockResolvedValue([
      { id: 1, name: "login", _count: { caseTags: 12 } },
    ]);
    mockedRunTagRows.mockReturnValue([{ id: 2, name: "regression", count: 3 }]);

    const response = await handleFlakyTestsOptionsGET(
      get("?projectId=7"),
      false
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(authorizeReportRequest).toHaveBeenCalledWith(expect.anything(), {
      requiresAdmin: false,
      projectId: 7,
    });
    expect(data).toEqual({
      dimensions: [],
      metrics: [],
      caseTags: [{ id: 1, name: "login", count: 12 }],
      runTags: [{ id: 2, name: "regression", count: 3 }],
      milestones: [{ id: 3, name: "Release 1", parentId: null }],
      configurations: [{ id: 4, name: "Chrome" }],
    });
    expect(getExecutionScopeFilterOptions).toHaveBeenCalledWith(7);
    expect(
      mockedTagsFindMany.mock.calls[0][0].where.caseTags.some.case
    ).toEqual({ isDeleted: false, projectId: 7 });
    const projectScope = sqlCalls[0].values[0] as {
      text: string;
      values: unknown[];
    };
    expect(projectScope.text).toContain('tr."projectId"');
    expect(projectScope.values).toEqual([7]);
  });

  it("omits the execution scope on the cross-project report", async () => {
    mockedTagsFindMany.mockResolvedValue([]);

    const response = await handleFlakyTestsOptionsGET(get(), true);
    const data = await response.json();

    expect(authorizeReportRequest).toHaveBeenCalledWith(expect.anything(), {
      requiresAdmin: true,
      projectId: undefined,
    });
    expect(data.milestones).toEqual([]);
    expect(data.configurations).toEqual([]);
    expect(getExecutionScopeFilterOptions).not.toHaveBeenCalled();
    expect(
      mockedTagsFindMany.mock.calls[0][0].where.caseTags.some.case
    ).toEqual({ isDeleted: false });
    expect((sqlCalls[0].values[0] as { text: string }).text).toBe("");
  });

  it("requires a project id on the project-scoped report", async () => {
    const response = await handleFlakyTestsOptionsGET(get(), false);

    expect(response.status).toBe(400);
    expect(mockedTagsFindMany).not.toHaveBeenCalled();
  });

  it("returns the authorization failure unchanged", async () => {
    (authorizeReportRequest as any).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await handleFlakyTestsOptionsGET(
      get("?projectId=7"),
      false
    );

    expect(response.status).toBe(401);
    expect(mockedTagsFindMany).not.toHaveBeenCalled();
  });
});
