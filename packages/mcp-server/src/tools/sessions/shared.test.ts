import { describe, it, expect, vi } from "vitest";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import {
  mapSessionRow,
  mapSessionDetail,
  mapSessionResultRow,
  mapSessionResultDetail,
  mapFinding,
  denormalizeResultFieldValues,
} from "./shared.js";

const proseDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

// ── mapSessionRow ──────────────────────────────────────────────────────────

describe("mapSessionRow", () => {
  const baseRaw = {
    id: 1,
    name: "Exploratory session A",
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    mission: proseDoc("Find auth bugs"),
    note: proseDoc("Started at 9am"),
    project: { id: 7, name: "TestProject" },
    state: { id: 3, name: "Active" },
    createdBy: {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    },
    assignedTo: null,
    template: { id: 4, name: "ExploratoryTemplate" },
    configuration: null,
    milestone: null,
    tags: [{ id: 9, name: "exploratory" }],
  };

  it("D7-12: enumerates exactly the documented keys; mission/note routed through extractProseMirrorText", () => {
    const result = mapSessionRow(baseRaw);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "name",
        "isCompleted",
        "completedAt",
        "createdAt",
        "mission",
        "note",
        "project",
        "state",
        "createdBy",
        "assignedTo",
        "template",
        "configuration",
        "milestone",
        "tags",
      ].sort(),
    );
    expect(result.mission).toBe("Find auth bugs");
    expect(result.note).toBe("Started at 9am");
  });

  it("null configuration / milestone / assignedTo handled — returns null (never undefined)", () => {
    const result = mapSessionRow({
      ...baseRaw,
      configuration: null,
      milestone: null,
      assignedTo: null,
    });
    expect(result.configuration).toBeNull();
    expect(result.milestone).toBeNull();
    expect(result.assignedTo).toBeNull();
  });
});

// ── mapSessionDetail ───────────────────────────────────────────────────────

describe("mapSessionDetail", () => {
  const baseRaw = {
    id: 1,
    name: "Exploratory session A",
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    mission: proseDoc("Find auth bugs"),
    note: proseDoc("Started at 9am"),
    project: { id: 7, name: "TestProject" },
    state: { id: 3, name: "Active" },
    createdBy: {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    },
    assignedTo: null,
    template: { id: 4, name: "ExploratoryTemplate" },
    configuration: null,
    milestone: null,
    tags: [{ id: 9, name: "exploratory" }],
    issues: [
      {
        id: 1,
        externalKey: "JIRA-1",
        title: "Bug",
        externalStatus: "Open",
        integration: { provider: "JIRA" },
      },
    ],
    sessionResults: [],
    sessionFieldValues: [
      {
        value: "High",
        field: {
          displayName: "Severity",
          type: { type: "Text" },
          fieldOptions: [],
        },
      },
    ],
  };

  it("D7-12: sessionResults inlined up to take limit; truncated flag forwarded", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      id: i,
      createdAt: "2026-01-01T00:00:00Z",
      status: { id: 1, name: "Pass" },
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
      elapsed: null,
      session: { id: 1, name: "Exploratory session A", projectId: 7 },
      resultData: null,
    }));
    const result = mapSessionDetail(
      { ...baseRaw, sessionResults: five },
      { truncated: false },
    );
    expect(result.sessionResults).toHaveLength(5);
    expect(result.truncated).toBe(false);

    const hundred = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      createdAt: "2026-01-01T00:00:00Z",
      status: { id: 1, name: "Pass" },
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
      elapsed: null,
      session: { id: 1, name: "Exploratory session A", projectId: 7 },
      resultData: null,
    }));
    const truncatedResult = mapSessionDetail(
      { ...baseRaw, sessionResults: hundred },
      { truncated: true },
    );
    expect(truncatedResult.sessionResults).toHaveLength(100);
    expect(truncatedResult.truncated).toBe(true);
  });

  it("issues, customFields, tags inlined", () => {
    const result = mapSessionDetail(baseRaw, { truncated: false });
    expect(result.issues).toEqual([
      {
        id: 1,
        externalKey: "JIRA-1",
        title: "Bug",
        externalStatus: "Open",
        externalSystem: "JIRA",
      },
    ]);
    expect(result.customFields).toEqual({ Severity: "High" });
    expect(result.tags).toEqual([{ id: 9, name: "exploratory" }]);
  });
});

// ── denormalizeResultFieldValues ──────────────────────────────────────────

describe("denormalizeResultFieldValues", () => {
  it("Dropdown option-id resolves to option name (delegates to denormalizeCustomFields)", () => {
    const rows = [
      {
        value: 7,
        field: {
          displayName: "Severity",
          type: { type: "Dropdown" },
          fieldOptions: [
            { fieldOption: { id: 7, name: "High" } },
            { fieldOption: { id: 8, name: "Low" } },
          ],
        },
      },
    ];
    expect(denormalizeResultFieldValues(rows)).toEqual({ Severity: "High" });
  });

  it("Multi-Select array of IDs resolves to array of names", () => {
    const rows = [
      {
        value: [7, 8],
        field: {
          displayName: "Tags",
          type: { type: "Multi-Select" },
          fieldOptions: [
            { fieldOption: { id: 7, name: "High" } },
            { fieldOption: { id: 8, name: "Low" } },
          ],
        },
      },
    ];
    expect(denormalizeResultFieldValues(rows)).toEqual({
      Tags: ["High", "Low"],
    });
  });

  it("plain Text passes value through unchanged", () => {
    const rows = [
      {
        value: "any text",
        field: {
          displayName: "Notes",
          type: { type: "Text" },
          fieldOptions: [],
        },
      },
    ];
    expect(denormalizeResultFieldValues(rows)).toEqual({
      Notes: "any text",
    });
  });

  it("empty / null / undefined input returns {}", () => {
    expect(denormalizeResultFieldValues(null)).toEqual({});
    expect(denormalizeResultFieldValues(undefined)).toEqual({});
    expect(denormalizeResultFieldValues([])).toEqual({});
  });
});

// ── mapSessionResultRow ────────────────────────────────────────────────────

describe("mapSessionResultRow", () => {
  it("list-shape: enumerates id / createdAt / status / createdBy / elapsed / session / resultDataText (no resultFieldValues, no attachments)", () => {
    const raw = {
      id: 1,
      createdAt: "2026-01-01T00:00:00Z",
      status: { id: 1, name: "Pass" },
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
      elapsed: 60,
      session: { id: 7, name: "Exploratory session A", projectId: 9 },
      resultData: proseDoc("Tested login flow"),
    };
    const result = mapSessionResultRow(raw);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "createdAt",
        "status",
        "createdBy",
        "elapsed",
        "session",
        "resultDataText",
      ].sort(),
    );
    expect(result.resultDataText).toBe("Tested login flow");
  });
});

// ── mapSessionResultDetail ────────────────────────────────────────────────

describe("mapSessionResultDetail", () => {
  it("full shape: customFields denormalized, attachments + issues + resultDataText present", () => {
    const raw = {
      id: 1,
      createdAt: "2026-01-01T00:00:00Z",
      status: { id: 1, name: "Pass" },
      createdBy: { id: "u1", name: "Alice", email: "a@b" },
      elapsed: 60,
      session: { id: 7, name: "Exploratory session A", projectId: 9 },
      resultData: proseDoc("Tested login flow"),
      attachments: [{ id: 1, name: "screen.png", url: "https://x" }],
      issues: [
        {
          id: 7,
          externalKey: "GH-7",
          title: "Issue",
          externalStatus: "open",
          integration: { provider: "GITHUB" },
        },
      ],
      resultFieldValues: [
        {
          value: 7,
          field: {
            displayName: "Severity",
            type: { type: "Dropdown" },
            fieldOptions: [{ fieldOption: { id: 7, name: "High" } }],
          },
        },
      ],
    };
    const result = mapSessionResultDetail(raw);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "createdAt",
        "status",
        "createdBy",
        "elapsed",
        "resultDataText",
        "customFields",
        "attachments",
        "issues",
        "session",
      ].sort(),
    );
    expect(result.customFields).toEqual({ Severity: "High" });
    expect(result.attachments).toEqual([
      { id: 1, fileName: "screen.png", url: "https://x" },
    ]);
    expect(result.issues).toEqual([
      {
        id: 7,
        externalKey: "GH-7",
        title: "Issue",
        externalStatus: "open",
        externalSystem: "GITHUB",
      },
    ]);
    expect(result.resultDataText).toBe("Tested login flow");
  });
});

// ── mapFinding ────────────────────────────────────────────────────────────

describe("mapFinding", () => {
  it("Issue row → externalSystem from integration.provider", () => {
    const raw = {
      id: 1,
      externalKey: "JIRA-1",
      title: "Bug",
      status: "open",
      externalStatus: "In Progress",
      priority: "high",
      integration: { provider: "JIRA" },
    };
    expect(mapFinding(raw)).toEqual({
      id: 1,
      externalKey: "JIRA-1",
      title: "Bug",
      status: "open",
      externalStatus: "In Progress",
      priority: "high",
      externalSystem: "JIRA",
    });
  });
});
