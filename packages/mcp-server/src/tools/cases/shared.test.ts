import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractProseMirrorText,
  denormalizeCustomFields,
  buildFolderBreadcrumb,
  mapCaseRow,
  mapCaseDetail,
} from "./shared.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

// ── extractProseMirrorText ─────────────────────────────────────────────────

describe("extractProseMirrorText", () => {
  it("extracts text from a plain paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Step 1 body" }],
        },
      ],
    };
    expect(extractProseMirrorText(doc)).toBe("Step 1 body");
  });

  it("joins multiple paragraphs with newline", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    };
    expect(extractProseMirrorText(doc)).toBe("First\nSecond");
  });

  it("extracts text from bold-marked nodes (marks are ignored, text passes through)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Bold",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    };
    expect(extractProseMirrorText(doc)).toBe("Bold");
  });

  it("returns empty string for null input", () => {
    expect(extractProseMirrorText(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(extractProseMirrorText(undefined)).toBe("");
  });

  it("returns the string verbatim when input is already a string (defensive — historical data)", () => {
    expect(extractProseMirrorText("plain text step")).toBe("plain text step");
  });

  it("extracts from array of nodes (no doc wrapper)", () => {
    const nodes = [
      { type: "paragraph", content: [{ type: "text", text: "Line A" }] },
      { type: "paragraph", content: [{ type: "text", text: "Line B" }] },
    ];
    const result = extractProseMirrorText(nodes);
    expect(result).toContain("Line A");
    expect(result).toContain("Line B");
  });
});

// ── denormalizeCustomFields ────────────────────────────────────────────────

describe("denormalizeCustomFields", () => {
  it("maps caseFieldValues to flat displayName-keyed dict", () => {
    const rows = [
      { value: { json: "High" }, field: { displayName: "Priority" } },
      { value: 7, field: { displayName: "Severity" } },
    ];
    const result = denormalizeCustomFields(rows);
    expect(result).toEqual({ Priority: { json: "High" }, Severity: 7 });
  });

  it("returns empty object for null input", () => {
    expect(denormalizeCustomFields(null)).toEqual({});
  });

  it("returns empty object for undefined input", () => {
    expect(denormalizeCustomFields(undefined)).toEqual({});
  });

  it("returns empty object for empty array", () => {
    expect(denormalizeCustomFields([])).toEqual({});
  });

  it("skips rows with missing field metadata", () => {
    const rows = [
      { value: "foo", field: null },
      { value: "bar", field: { displayName: null } },
      { value: "baz", field: { displayName: "ValidField" } },
    ];
    const result = denormalizeCustomFields(rows);
    expect(result).toEqual({ ValidField: "baz" });
  });

  it("resolves Dropdown numeric value to FieldOption.name", () => {
    const rows = [
      {
        value: 147,
        field: {
          displayName: "Priority",
          type: { type: "Dropdown" },
          fieldOptions: [
            { fieldOption: { id: 146, name: "Low" } },
            { fieldOption: { id: 147, name: "High" } },
          ],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Priority: "High" });
  });

  it("resolves Dropdown stringified-numeric value to FieldOption.name", () => {
    const rows = [
      {
        value: "147",
        field: {
          displayName: "Priority",
          type: { type: "Dropdown" },
          fieldOptions: [{ fieldOption: { id: 147, name: "High" } }],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Priority: "High" });
  });

  it("resolves Multi-Select array of IDs to array of FieldOption names", () => {
    const rows = [
      {
        value: ["10", "12"],
        field: {
          displayName: "Tags",
          type: { type: "Multi-Select" },
          fieldOptions: [
            { fieldOption: { id: 10, name: "Smoke" } },
            { fieldOption: { id: 11, name: "Regression" } },
            { fieldOption: { id: 12, name: "Compliance" } },
          ],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({
      Tags: ["Smoke", "Compliance"],
    });
  });

  it("falls back to raw value when Dropdown option ID is unknown", () => {
    const rows = [
      {
        value: 999,
        field: {
          displayName: "Priority",
          type: { type: "Dropdown" },
          fieldOptions: [{ fieldOption: { id: 147, name: "High" } }],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Priority: 999 });
  });

  it("passes Text/Number/Date values through unchanged", () => {
    const rows = [
      {
        value: "Manual entry",
        field: {
          displayName: "Notes",
          type: { type: "Text" },
          fieldOptions: [],
        },
      },
      {
        value: 42,
        field: {
          displayName: "Severity",
          type: { type: "Number" },
          fieldOptions: [],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({
      Notes: "Manual entry",
      Severity: 42,
    });
  });
});

// ── buildFolderBreadcrumb ──────────────────────────────────────────────────

describe("buildFolderBreadcrumb", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("returns single-element breadcrumb for root folder (no parent), without calling zenstack", async () => {
    const leaf = { id: 5, name: "Root", parentId: null };
    const result = await buildFolderBreadcrumb(leaf, mockEnv);
    expect(result).toEqual([{ id: 5, name: "Root" }]);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("returns 2-level breadcrumb walking one parent", async () => {
    const leaf = { id: 12, name: "Auth", parentId: 5 };
    mockZenstack.mockResolvedValueOnce({
      id: 5,
      name: "Regression",
      parentId: null,
    });
    const result = await buildFolderBreadcrumb(leaf, mockEnv);
    expect(result).toEqual([
      { id: 5, name: "Regression" },
      { id: 12, name: "Auth" },
    ]);
    expect(mockZenstack).toHaveBeenCalledTimes(1);
    expect(mockZenstack).toHaveBeenCalledWith(
      "repositoryFolders",
      "findUnique",
      expect.objectContaining({ where: { id: 5 } }),
      mockEnv,
    );
  });

  it("halts and throws TestPlanItHttpError when depth exceeds max (depth bound at 10)", async () => {
    // Leaf starts with parentId=1; the mock always returns a parent with a non-null parentId
    // so the chain never terminates naturally — forcing the depth check to trigger.
    const leaf = { id: 999, name: "DeepLeaf", parentId: 1 };
    let counter = 1;
    mockZenstack.mockImplementation(async () => {
      const current = counter;
      counter += 1;
      // Always returns a non-null parentId — infinite chain
      return { id: current, name: `Folder${current}`, parentId: current + 1 };
    });

    const err = await buildFolderBreadcrumb(leaf, mockEnv).catch((e) => e);
    expect(err).toBeInstanceOf(TestPlanItHttpError);
    expect(err.message).toContain("depth");
    expect((err as TestPlanItHttpError).statusCode).toBe(422);
  });

  it("rethrows when ancestor zenstack call throws (inaccessible ancestor)", async () => {
    const leaf = { id: 12, name: "Auth", parentId: 5 };
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError("denied by policy", { statusCode: 422 }),
    );
    await expect(buildFolderBreadcrumb(leaf, mockEnv)).rejects.toThrow(
      TestPlanItHttpError,
    );
  });
});

// ── mapCaseRow ─────────────────────────────────────────────────────────────

describe("mapCaseRow", () => {
  const rawRow = {
    id: 101,
    name: "Login flow",
    source: "MANUAL",
    automated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: { id: 7, name: "TestProject" },
    folder: { id: 12, name: "Auth", parentId: 5 },
    state: { id: 3, name: "Active" },
    creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
    tags: [
      { id: 1, name: "smoke" },
      { id: 2, name: "auth" },
    ],
  };

  it("returns the D-09 shape with correct field mapping", () => {
    const result = mapCaseRow(rawRow);
    expect(result).toEqual({
      id: 101,
      name: "Login flow",
      source: "MANUAL",
      automated: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      project: { id: 7, name: "TestProject" },
      folder: { id: 12, name: "Auth" },
      state: { id: 3, name: "Active" },
      creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
      tags: [
        { id: 1, name: "smoke" },
        { id: 2, name: "auth" },
      ],
    });
  });

  it("WR-04: folder is required (schema invariant — folderId is non-nullable)", () => {
    // The schema makes folderId non-nullable; mapCaseRow trusts this and
    // dereferences raw.folder directly. A future schema change that
    // relaxes the constraint would surface here as a TypeError, which is
    // the signal we want — call sites in get.ts / fetchDetail.ts have
    // the same shape contract.
    const rowWithNullFolder = { ...rawRow, folder: null as unknown };
    expect(() => mapCaseRow(rowWithNullFolder as never)).toThrow();
  });
});

// ── mapCaseDetail ──────────────────────────────────────────────────────────

describe("mapCaseDetail", () => {
  const rawDetail = {
    id: 101,
    name: "Login flow",
    source: "MANUAL",
    automated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: { id: 7, name: "TestProject" },
    folder: { id: 12, name: "Auth", parentId: 5 },
    state: { id: 3, name: "Active" },
    creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
    tags: [{ id: 1, name: "smoke" }],
    issues: [
      {
        id: 55,
        externalKey: "JIRA-99",
        integration: { provider: "JIRA" },
        title: "Login bug",
        externalStatus: "Open",
      },
    ],
    steps: [
      {
        id: 1,
        order: 0,
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Open login page" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Login form visible" }],
            },
          ],
        },
      },
    ],
    caseFieldValues: [
      { value: "High", field: { displayName: "Priority" } },
    ],
    linksFrom: [
      { caseB: { id: 9, name: "automated_test_a", source: "JUNIT" } },
      { caseB: { id: 10, name: "manual_b", source: "MANUAL" } },
    ],
    linksTo: [
      { caseA: { id: 11, name: "automated_test_c", source: "TESTNG" } },
    ],
  };

  const breadcrumb = [
    { id: 5, name: "Regression" },
    { id: 12, name: "Auth" },
  ];

  it("returns D-10 full detail shape with breadcrumb, steps, custom fields, issues, linked automated tests", () => {
    const result = mapCaseDetail(rawDetail, breadcrumb);

    // Base row fields
    expect(result.id).toBe(101);
    expect(result.name).toBe("Login flow");

    // Breadcrumb
    expect(result.folderBreadcrumb).toEqual(breadcrumb);
    expect(result.folderFullPath).toBe("Regression / Auth");

    // Steps with plain text extracted
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].step).toBe("Open login page");
    expect(result.steps[0].expectedResult).toBe("Login form visible");

    // Custom fields flat dict
    expect(result.customFields).toEqual({ Priority: "High" });

    // Issues inline
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].externalKey).toBe("JIRA-99");

    // Linked automated tests — MANUAL excluded
    expect(result.linkedAutomatedTests).toHaveLength(2);
    const linkedIds = result.linkedAutomatedTests.map((t) => t.id);
    expect(linkedIds).toContain(9);
    expect(linkedIds).toContain(11);
    expect(linkedIds).not.toContain(10);
  });
});
