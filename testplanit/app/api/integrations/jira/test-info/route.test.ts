import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db before importing the route handler.
vi.mock("@/lib/db", () => ({
  baseDb: {
    integration: { findMany: vi.fn() },
    status: { findFirst: vi.fn() },
    issue: { findMany: vi.fn() },
  },
}));

import { baseDb } from "@/lib/db";

import { GET } from "./route";

const FORGE_API_KEY = "test-forge-key";

const buildRequest = (): NextRequest =>
  new NextRequest(
    "http://localhost/api/integrations/jira/test-info?issueKey=PROJ-1",
    { headers: { "X-Forge-Api-Key": FORGE_API_KEY } }
  );

/**
 * A linked case as the route's issue query returns it, carrying the
 * Jira-panel-enabled template fields (the jiraPanelEnabled filter lives in the
 * query's where clause, so the fixture only contains opted-in fields).
 */
const buildCase = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  name: "Case A",
  state: {
    name: "Draft",
    icon: { name: "Pencil" },
    color: { value: "#123456" },
  },
  project: { id: 5 },
  isDeleted: false,
  isArchived: false,
  source: "MANUAL",
  estimate: null,
  forecastManual: null,
  forecastAutomated: null,
  template: { caseFields: [] },
  caseFieldValues: [],
  testRuns: [],
  ...overrides,
});

const buildIssue = (...testCases: Record<string, unknown>[]) => ({
  id: 1,
  name: "PROJ-1",
  externalKey: "PROJ-1",
  externalId: "1000",
  caseIssues: testCases.map((testCase) => ({ case: testCase })),
  sessions: [],
  testRuns: [],
  testRunResults: [],
  testRunStepResults: [],
  sessionResults: [],
});

/** A TestRunCases row as the route's include returns it (live results only). */
const buildRunCase = (
  results: Record<string, unknown>[],
  overrides: Record<string, unknown> = {}
) => ({
  id: 50,
  testRun: { id: 7, name: "Regression", isCompleted: true },
  results,
  ...overrides,
});

const buildResult = (overrides: Record<string, unknown> = {}) => ({
  id: 900,
  status: { name: "Passed", color: { value: "#16a34a" } },
  executedAt: "2026-09-01T10:00:00.000Z",
  executedBy: { id: "u1", name: "Ann" },
  editedAt: null,
  editedBy: null,
  elapsed: 42,
  testRunCaseVersion: 2,
  attempt: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(baseDb.integration.findMany).mockResolvedValue([
    { id: 1, settings: { forgeApiKey: FORGE_API_KEY } },
  ] as any);
  vi.mocked(baseDb.status.findFirst).mockResolvedValue({
    name: "Untested",
    color: { value: "#9ca3af" },
  } as any);
});

describe("jira test-info deleted cases", () => {
  it("omits deleted cases that have no surviving results", async () => {
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(
        buildCase({ id: 10, name: "Live" }),
        buildCase({ id: 11, name: "Never run", isDeleted: true }),
        // The results include filters soft-deleted results out, so a run row
        // whose results were all deleted arrives empty and counts as none.
        buildCase({
          id: 12,
          name: "Results gone",
          isDeleted: true,
          testRuns: [buildRunCase([])],
        })
      ),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.testCases.map((testCase: any) => testCase.id)).toEqual([10]);
  });

  it("keeps a deleted case that has results and returns its history", async () => {
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(
        buildCase({
          id: 11,
          name: "Gone",
          isDeleted: true,
          testRuns: [buildRunCase([buildResult()])],
        })
      ),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases).toHaveLength(1);
    expect(body.testCases[0]).toMatchObject({
      id: 11,
      name: "Gone",
      isDeleted: true,
      lastResult: "Passed",
      lastResultColor: "#16a34a",
    });
    expect(body.testCases[0].resultHistory).toEqual([
      expect.objectContaining({
        resultId: 900,
        testRunId: 7,
        testRunName: "Regression",
        testRunIsCompleted: true,
        status: "Passed",
        statusColor: "#16a34a",
        executedBy: { id: "u1", name: "Ann" },
        testRunCaseVersion: 2,
      }),
    ]);
  });

  it("still returns a live case that has never been run", async () => {
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(buildCase({ id: 10, name: "Live", testRuns: [] })),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases.map((testCase: any) => testCase.id)).toEqual([10]);
    expect(body.testCases[0].lastResult).toBe("Untested");
  });
});

describe("jira test-info fields resolution", () => {
  it("resolves each field type like the repository case table", async () => {
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 101,
              displayName: "Priority",
              type: { type: "Dropdown" },
              fieldOptions: [
                {
                  fieldOption: {
                    id: 7,
                    name: "High",
                    icon: { name: "Flame" },
                    iconColor: { value: "#ff0000" },
                  },
                },
              ],
            },
          },
          {
            caseField: {
              id: 102,
              displayName: "Automated",
              type: { type: "Checkbox" },
              fieldOptions: [],
            },
          },
          {
            caseField: {
              id: 103,
              displayName: "Notes",
              type: { type: "Text Long" },
              fieldOptions: [],
            },
          },
          {
            caseField: {
              id: 104,
              displayName: "Build",
              type: { type: "Text String" },
              fieldOptions: [],
            },
          },
        ],
      },
      caseFieldValues: [
        // Dropdown values arrive as the selected option id (string or number).
        { fieldId: 101, value: "7" },
        { fieldId: 102, value: true },
        {
          fieldId: 103,
          value: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "hello world" }],
              },
            ],
          },
        },
        // No value for 104 — the field still appears, with a null value.
      ],
    });
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(testCase),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.testCases).toHaveLength(1);
    expect(body.testCases[0].fields).toEqual([
      {
        id: 101,
        label: "Priority",
        type: "Dropdown",
        value: null,
        options: [{ name: "High", icon: "Flame", iconColor: "#ff0000" }],
      },
      { id: 102, label: "Automated", type: "Checkbox", value: true },
      { id: 103, label: "Notes", type: "Text Long", value: "hello world" },
      { id: 104, label: "Build", type: "Text String", value: null },
    ]);
  });

  it("resolves Multi-Select values in selection order and drops unknown option ids", async () => {
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 201,
              displayName: "Browsers",
              type: { type: "Multi-Select" },
              fieldOptions: [
                {
                  fieldOption: {
                    id: 1,
                    name: "Chrome",
                    icon: null,
                    iconColor: null,
                  },
                },
                {
                  fieldOption: {
                    id: 2,
                    name: "Firefox",
                    icon: { name: "Flame" },
                    iconColor: { value: "#f60" },
                  },
                },
              ],
            },
          },
        ],
      },
      caseFieldValues: [{ fieldId: 201, value: ["2", "1", "999"] }],
    });
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(testCase),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([
      {
        id: 201,
        label: "Browsers",
        type: "Multi-Select",
        value: null,
        options: [
          { name: "Firefox", icon: "Flame", iconColor: "#f60" },
          { name: "Chrome", icon: null, iconColor: null },
        ],
      },
    ]);
  });

  it("resolves Steps from the steps relation, expanding shared groups and dropping deleted ones", async () => {
    const doc = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 301,
              displayName: "Steps",
              type: { type: "Steps" },
              fieldOptions: [],
            },
          },
        ],
      },
      steps: [
        {
          id: 1,
          order: 1,
          step: doc("Open the page"),
          expectedResult: doc("Page loads"),
          sharedStepGroupId: null,
          sharedStepGroup: null,
        },
        {
          id: 2,
          order: 2,
          step: null,
          expectedResult: null,
          sharedStepGroupId: 9,
          sharedStepGroup: {
            name: "Login preamble",
            isDeleted: false,
            items: [
              {
                step: doc("Open sign-in"),
                expectedResult: doc("Form visible"),
              },
              { step: doc("Sign in"), expectedResult: doc("Dashboard loads") },
            ],
          },
        },
        {
          id: 3,
          order: 3,
          step: null,
          expectedResult: null,
          sharedStepGroupId: 10,
          sharedStepGroup: { name: "Gone", isDeleted: true, items: [] },
        },
      ],
    });
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(testCase),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([
      {
        id: 301,
        label: "Steps",
        type: "Steps",
        value: null,
        steps: [
          { step: "Open the page", expected: "Page loads" },
          {
            group: "Login preamble",
            items: [
              { step: "Open sign-in", expected: "Form visible" },
              { step: "Sign in", expected: "Dashboard loads" },
            ],
          },
        ],
      },
    ]);
  });

  it("returns an empty fields array when the template has no panel-enabled fields", async () => {
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue(buildCase()),
    ] as any);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([]);
  });

  it("rejects requests without a valid Forge API key", async () => {
    const request = new NextRequest(
      "http://localhost/api/integrations/jira/test-info?issueKey=PROJ-1",
      { headers: { "X-Forge-Api-Key": "wrong-key" } }
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(baseDb.issue.findMany).not.toHaveBeenCalled();
  });
});
