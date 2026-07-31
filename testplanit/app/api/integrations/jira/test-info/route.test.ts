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

const buildIssue = (testCase: Record<string, unknown>) => ({
  id: 1,
  name: "PROJ-1",
  externalKey: "PROJ-1",
  externalId: "1000",
  caseIssues: [{ case: testCase }],
  sessions: [],
  testRuns: [],
  testRunResults: [],
  testRunStepResults: [],
  sessionResults: [],
});

describe("jira test-info fields resolution", () => {
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
