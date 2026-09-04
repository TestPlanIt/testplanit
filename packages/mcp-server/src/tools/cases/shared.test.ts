import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractProseMirrorText,
  denormalizeCustomFields,
  buildFolderBreadcrumb,
  mapCaseRow,
  mapCaseDetail,
  lastUpdatedAtFromRaw,
  resolveLatestResult,
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

  // Issue #594: the web UI stores rich text as `JSON.stringify(doc)`, so the
  // same column comes back as a document object or as a string of one
  // depending on which client saved the row last.
  it("extracts text from a document the web UI stored as a JSON string", () => {
    const serialized = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open the login page in a private window." },
          ],
        },
      ],
    });
    expect(extractProseMirrorText(serialized)).toBe(
      "Open the login page in a private window.",
    );
  });

  it("joins block nodes with newlines when the document arrives as a JSON string", () => {
    const serialized = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    });
    expect(extractProseMirrorText(serialized)).toBe("First\nSecond");
  });

  it("extracts an array of nodes stored as a JSON string", () => {
    const serialized = JSON.stringify([
      { type: "paragraph", content: [{ type: "text", text: "Line A" }] },
      { type: "paragraph", content: [{ type: "text", text: "Line B" }] },
    ]);
    expect(extractProseMirrorText(serialized)).toBe("Line A\nLine B");
  });

  it("returns plain text that merely looks like JSON verbatim", () => {
    // Flattening this to "" would silently destroy the user's content.
    expect(extractProseMirrorText('{"foo": 1}')).toBe('{"foo": 1}');
    expect(extractProseMirrorText("[1, 2, 3]")).toBe("[1, 2, 3]");
  });

  it("returns malformed JSON verbatim", () => {
    expect(extractProseMirrorText('{"type": "doc"')).toBe('{"type": "doc"');
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

  it("WR-05: code_block with multiple text runs concatenates inline (no stray newlines)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "code_block",
          content: [
            { type: "text", text: "const x = 1;" },
            { type: "text", text: " // inline" },
          ],
        },
      ],
    };
    // Code-block runs are joined inline; only one block in the doc, so no
    // outer newline either.
    expect(extractProseMirrorText(doc)).toBe("const x = 1; // inline");
  });

  it("WR-05: bullet_list of two items renders one line per item (no extra blanks)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
            {
              type: "list_item",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "second" }],
                },
              ],
            },
          ],
        },
      ],
    };
    // bullet_list is a non-block container (joins children with "\n"),
    // list_item / paragraph are block-level (children inline). Result is
    // exactly "first\nsecond" — not "first\n\nsecond" (the bug).
    expect(extractProseMirrorText(doc)).toBe("first\nsecond");
  });

  it("WR-05: heading with multiple inline runs renders as one line", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            { type: "text", text: "Hello, " },
            { type: "text", text: "world" },
          ],
        },
      ],
    };
    expect(extractProseMirrorText(doc)).toBe("Hello, world");
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

  // Issue #594: Text Long is a rich-text document — the UI stores a JSON
  // string, this server stores plain text. Readers get text either way.
  it("flattens a Text Long value the web UI stored as a JSON string", () => {
    const rows = [
      {
        value: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Notes here" }] },
          ],
        }),
        field: { displayName: "Description", type: { type: "Text Long" } },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Description: "Notes here" });
  });

  it("passes a Text Long value this server stored as plain text through unchanged", () => {
    const rows = [
      {
        value: "Notes here",
        field: { displayName: "Description", type: { type: "Text Long" } },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Description: "Notes here" });
  });

  it("leaves an unset Text Long value null rather than turning it into an empty string", () => {
    const rows = [
      {
        value: null,
        field: { displayName: "Description", type: { type: "Text Long" } },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({ Description: null });
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

  it("WR-06: Dropdown with non-integer numeric value (147.5) does NOT misroute to FieldOption 147", () => {
    const rows = [
      {
        value: 147.5,
        field: {
          displayName: "Priority",
          type: { type: "Dropdown" },
          fieldOptions: [{ fieldOption: { id: 147, name: "High" } }],
        },
      },
    ];
    // 147.5 is rejected by coerceOptionId, so denormalize falls back to
    // the raw value rather than incorrectly returning "High".
    expect(denormalizeCustomFields(rows)).toEqual({ Priority: 147.5 });
  });

  it("WR-06: Dropdown with negative or zero numeric value falls back to raw", () => {
    const rows = [
      {
        value: -1,
        field: {
          displayName: "Priority",
          type: { type: "Dropdown" },
          fieldOptions: [{ fieldOption: { id: 147, name: "High" } }],
        },
      },
      {
        value: 0,
        field: {
          displayName: "Severity",
          type: { type: "Dropdown" },
          fieldOptions: [{ fieldOption: { id: 5, name: "Low" } }],
        },
      },
    ];
    expect(denormalizeCustomFields(rows)).toEqual({
      Priority: -1,
      Severity: 0,
    });
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
    // Raw rows now carry tags through the RepositoryCaseTag join (caseTags[].tag);
    // mapCaseRow flattens them back to the tags[] output shape.
    caseTags: [
      { tag: { id: 1, name: "smoke" } },
      { tag: { id: 2, name: "auth" } },
    ],
  };

  it("returns the D-09 shape with correct field mapping (Phase-8 widened: + lastUpdatedAt + latestResult)", () => {
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
      // Phase-8 D8-02 additive fields. The Phase-6 rawRow fixture
      // doesn't seed repositoryCaseVersions / junitResults / testRuns,
      // so both new fields default to null per the optional-include
      // contract documented on RawCaseRow.
      lastUpdatedAt: null,
      latestResult: null,
      // Automation-reality pair: no junitResults in the fixture → no
      // execution evidence.
      hasAutomatedResults: false,
      lastAutomatedResultAt: null,
    });
  });

  it("automation-reality pair: junitResults rows drive hasAutomatedResults + lastAutomatedResultAt", () => {
    const row = {
      ...rawRow,
      junitResults: [
        {
          id: 900,
          executedAt: "2026-02-01T00:00:00.000Z",
          status: { id: 1, name: "Passed" },
        },
      ],
    };
    const result = mapCaseRow(row as never);
    expect(result.hasAutomatedResults).toBe(true);
    expect(result.lastAutomatedResultAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("automation-reality pair: a result row with null executedAt still counts as evidence, timestamp stays null", () => {
    const row = {
      ...rawRow,
      junitResults: [{ id: 901, executedAt: null, status: null }],
    };
    const result = mapCaseRow(row as never);
    expect(result.hasAutomatedResults).toBe(true);
    expect(result.lastAutomatedResultAt).toBeNull();
  });

  it("folderPaths map widens the folder object to path/ancestorIds/rootId/rootName", () => {
    const paths = new Map([
      [
        12,
        {
          path: "Content / Documents / Auth",
          ancestorIds: [1, 5],
          rootId: 1,
          rootName: "Content",
        },
      ],
    ]);
    const result = mapCaseRow(rawRow as never, paths);
    expect(result.folder).toEqual({
      id: 12,
      name: "Auth",
      path: "Content / Documents / Auth",
      ancestorIds: [1, 5],
      rootId: 1,
      rootName: "Content",
    });
    // A folder absent from the map keeps the narrow shape.
    const miss = mapCaseRow(rawRow as never, new Map());
    expect(miss.folder).toEqual({ id: 12, name: "Auth" });
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
    // Raw detail carries tags / issues through the explicit join models
    // (caseTags[].tag, caseIssues[].issue); the mappers flatten them back
    // to the tags[] / issues[] output shape.
    caseTags: [{ tag: { id: 1, name: "smoke" } }],
    caseIssues: [
      {
        issue: {
          id: 55,
          externalKey: "JIRA-99",
          integration: { provider: "JIRA" },
          title: "Login bug",
          externalStatus: "Open",
        },
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

// ── lastUpdatedAtFromRaw (Phase 8 / D8-02) ─────────────────────────────────

describe("lastUpdatedAtFromRaw", () => {
  it("returns repositoryCaseVersions[0].createdAt when present", () => {
    const raw = {
      repositoryCaseVersions: [
        { createdAt: "2026-04-15T12:34:56.000Z", version: 3 },
      ],
    };
    expect(lastUpdatedAtFromRaw(raw)).toBe("2026-04-15T12:34:56.000Z");
  });

  it("returns null when array is empty", () => {
    expect(lastUpdatedAtFromRaw({ repositoryCaseVersions: [] })).toBeNull();
  });

  it("returns null when repositoryCaseVersions is undefined", () => {
    expect(lastUpdatedAtFromRaw({})).toBeNull();
  });
});

// ── resolveLatestResult (Phase 8 / D8-02) ──────────────────────────────────

describe("resolveLatestResult", () => {
  const junitStatus = { id: 5, name: "Passed" };
  const runStatus = { id: 6, name: "Failed" };

  it("returns null when both undefined", () => {
    expect(resolveLatestResult(undefined, undefined)).toBeNull();
  });

  it("returns junit shape when only junit present", () => {
    const result = resolveLatestResult(
      { id: 1, executedAt: "2026-04-01T00:00:00.000Z", status: junitStatus },
      undefined,
    );
    expect(result).toEqual({
      id: 1,
      status: junitStatus,
      executedAt: "2026-04-01T00:00:00.000Z",
      source: "JUnit",
    });
  });

  it("returns testRun shape when only testRun present", () => {
    const result = resolveLatestResult(undefined, {
      id: 2,
      executedAt: "2026-04-01T00:00:00.000Z",
      status: runStatus,
    });
    expect(result).toEqual({
      id: 2,
      status: runStatus,
      executedAt: "2026-04-01T00:00:00.000Z",
      source: "TestRun",
    });
  });

  it("picks junit when both present and junit executedAt is newer", () => {
    const result = resolveLatestResult(
      { id: 1, executedAt: "2026-04-10T00:00:00.000Z", status: junitStatus },
      { id: 2, executedAt: "2026-04-01T00:00:00.000Z", status: runStatus },
    );
    expect(result?.source).toBe("JUnit");
    expect(result?.id).toBe(1);
  });

  it("picks testRun when both present and testRun executedAt is newer", () => {
    const result = resolveLatestResult(
      { id: 1, executedAt: "2026-04-01T00:00:00.000Z", status: junitStatus },
      { id: 2, executedAt: "2026-04-10T00:00:00.000Z", status: runStatus },
    );
    expect(result?.source).toBe("TestRun");
    expect(result?.id).toBe(2);
  });

  it("returns null when junit has no executedAt and runResult is undefined", () => {
    expect(
      resolveLatestResult(
        { id: 1, executedAt: null, status: junitStatus },
        undefined,
      ),
    ).toBeNull();
  });
});

// ── mapCaseRow Phase-8 extensions ──────────────────────────────────────────

describe("mapCaseRow Phase-8 extensions", () => {
  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 101,
      name: "Login flow",
      source: "MANUAL",
      automated: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      project: { id: 7, name: "TestProject" },
      folder: { id: 12, name: "Auth", parentId: 5 },
      state: { id: 3, name: "Active" },
      creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
      // Raw rows carry tags through the caseTags join model.
      caseTags: [],
      ...overrides,
    };
  }

  it("returns lastUpdatedAt populated from repositoryCaseVersions[0]", () => {
    const row = makeRow({
      repositoryCaseVersions: [
        { createdAt: "2026-03-12T00:00:00.000Z", version: 2 },
      ],
    });
    const mapped = mapCaseRow(row as never);
    expect(mapped.lastUpdatedAt).toBe("2026-03-12T00:00:00.000Z");
  });

  it("returns lastUpdatedAt: null when repositoryCaseVersions is empty", () => {
    const row = makeRow({ repositoryCaseVersions: [] });
    const mapped = mapCaseRow(row as never);
    expect(mapped.lastUpdatedAt).toBeNull();
  });

  it("returns latestResult populated when junitResults[0] is present", () => {
    const row = makeRow({
      junitResults: [
        {
          id: 99,
          executedAt: "2026-04-01T00:00:00.000Z",
          status: { id: 5, name: "Passed" },
        },
      ],
      testRuns: [],
    });
    const mapped = mapCaseRow(row as never);
    expect(mapped.latestResult).toEqual({
      id: 99,
      status: { id: 5, name: "Passed" },
      executedAt: "2026-04-01T00:00:00.000Z",
      source: "JUnit",
    });
  });

  it("returns latestResult populated when testRuns[0].results[0] is present", () => {
    const row = makeRow({
      junitResults: [],
      testRuns: [
        {
          results: [
            {
              id: 77,
              executedAt: "2026-04-02T00:00:00.000Z",
              status: { id: 6, name: "Failed" },
            },
          ],
        },
      ],
    });
    const mapped = mapCaseRow(row as never);
    expect(mapped.latestResult).toEqual({
      id: 77,
      status: { id: 6, name: "Failed" },
      executedAt: "2026-04-02T00:00:00.000Z",
      source: "TestRun",
    });
  });

  it("returns latestResult: null when both junitResults and testRuns are empty", () => {
    const row = makeRow({ junitResults: [], testRuns: [] });
    const mapped = mapCaseRow(row as never);
    expect(mapped.latestResult).toBeNull();
  });

  it("regression: existing fields (id, name, source, automated, createdAt, project, folder, state, creator, tags) still populated", () => {
    const row = makeRow({
      repositoryCaseVersions: [],
      junitResults: [],
      testRuns: [],
    });
    const mapped = mapCaseRow(row as never);
    expect(mapped.id).toBe(101);
    expect(mapped.name).toBe("Login flow");
    expect(mapped.source).toBe("MANUAL");
    expect(mapped.automated).toBe(false);
    expect(mapped.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mapped.project).toEqual({ id: 7, name: "TestProject" });
    expect(mapped.folder).toEqual({ id: 12, name: "Auth" });
    expect(mapped.state).toEqual({ id: 3, name: "Active" });
    expect(mapped.creator).toEqual({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(mapped.tags).toEqual([]);
  });
});

// ── mapCaseDetail Phase-8 codeRepository extension (D8-02) ─────────────────

describe("mapCaseDetail Phase-8 codeRepository extension", () => {
  function makeDetail(overrides: Record<string, unknown> = {}) {
    return {
      id: 101,
      name: "Login flow",
      source: "MANUAL",
      automated: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      project: { id: 7, name: "TestProject" },
      folder: { id: 12, name: "Auth", parentId: 5 },
      state: { id: 3, name: "Active" },
      creator: { id: "user-1", name: "Alice", email: "alice@example.com" },
      // Raw detail carries tags / issues through the caseTags / caseIssues
      // join models.
      caseTags: [],
      caseIssues: [],
      steps: [],
      caseFieldValues: [],
      linksFrom: [],
      linksTo: [],
      ...overrides,
    };
  }

  const breadcrumb = [{ id: 12, name: "Auth" }];

  it("returns codeRepository: null when project.codeRepositoryConfig is null", () => {
    const detail = makeDetail({
      project: { id: 7, name: "TestProject", codeRepositoryConfig: null },
    });
    const result = mapCaseDetail(detail as never, breadcrumb);
    expect(result.codeRepository).toBeNull();
  });

  it("returns codeRepository: null when project has no codeRepositoryConfig at all", () => {
    const detail = makeDetail();
    const result = mapCaseDetail(detail as never, breadcrumb);
    expect(result.codeRepository).toBeNull();
  });

  it("returns codeRepository populated for a GITHUB project config with derived url", () => {
    const detail = makeDetail({
      project: {
        id: 7,
        name: "TestProject",
        codeRepositoryConfig: {
          repository: {
            id: 5,
            name: "acme/tools",
            provider: "GITHUB",
            status: "ACTIVE",
            lastTestedAt: null,
            settings: {
              owner: "acme",
              repo: "tools",
              personalAccessToken: "pat_secret",
            },
          },
        },
      },
    });
    const result = mapCaseDetail(detail as never, breadcrumb);
    expect(result.codeRepository).toEqual({
      id: 5,
      name: "acme/tools",
      type: "GITHUB",
      url: "https://github.com/acme/tools",
    });
  });

  it("regression: existing detail fields still present when codeRepository null", () => {
    const detail = makeDetail({
      project: { id: 7, name: "TestProject", codeRepositoryConfig: null },
      caseFieldValues: [{ value: "High", field: { displayName: "Priority" } }],
      // Raw issues now arrive through the caseIssues join model.
      caseIssues: [
        {
          issue: {
            id: 55,
            externalKey: "JIRA-99",
            integration: { provider: "JIRA" },
            title: "Login bug",
            externalStatus: "Open",
          },
        },
      ],
    });
    const result = mapCaseDetail(detail as never, breadcrumb);
    expect(result.customFields).toEqual({ Priority: "High" });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].externalKey).toBe("JIRA-99");
    expect(result.folderBreadcrumb).toEqual(breadcrumb);
  });
});
