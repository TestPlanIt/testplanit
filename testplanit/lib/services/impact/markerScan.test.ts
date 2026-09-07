import { describe, expect, it, vi } from "vitest";

import {
  hashSnippet,
  isScannableFile,
  parseAnnotations,
  parseTestMap,
  shouldScanMarkers,
  syncMarkerPins,
  type MarkerScanDb,
} from "./markerScan";

const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const CONFIG = { id: 10, projectId: 1, branch: "main" };
const OPTS = { anchorSha: SHA, actorId: "user-1" };

describe("parseAnnotations", () => {
  it.each([
    ["//", "// @testplanit case:12\nconst a = 1;\n"],
    ["#", "# @testplanit case:12\na = 1\n"],
    ["/* */", "/* @testplanit case:12 */\nconst a = 1;\n"],
    ["<!-- -->", "<!-- @testplanit case:12 -->\n<div>hi</div>\n"],
    ["--", "-- @testplanit case:12\nSELECT 1;\n"],
    ['"""', '"""\n@testplanit case:12\n"""\nx = 1\n'],
  ])("finds a marker in a %s comment", (_style, content) => {
    const markers = parseAnnotations("f", content);
    expect(markers).toHaveLength(1);
    expect(markers[0].caseIds).toEqual([12]);
    expect(markers[0].kind).toBe("RANGE");
  });

  it("collects several ids separated by commas and spaces", () => {
    const [marker] = parseAnnotations(
      "f",
      "// @testplanit case: 12, 34 ,56,56\nconst a = 1;\n"
    );
    expect(marker.caseIds).toEqual([12, 34, 56]);
  });

  it("matches `Case:` case-insensitively", () => {
    const [marker] = parseAnnotations("f", "// @testplanit Case: 4\nx = 1\n");
    expect(marker.caseIds).toEqual([4]);
  });

  it("covers a braced function to its closing brace", () => {
    const content = [
      "// @testplanit case:7",
      "export function foo() {",
      "  if (x) {",
      "    return 1;",
      "  }",
      "  return 2;",
      "}",
      "",
      "function bar() {}",
    ].join("\n");
    expect(parseAnnotations("f.ts", content)).toEqual([
      { caseIds: [7], kind: "RANGE", startLine: 1, endLine: 7, markerLine: 1 },
    ]);
  });

  it("brace-balances when the opening brace sits on a later declaration line", () => {
    const content = [
      "# @testplanit case:7",
      'resource "aws_s3_bucket" "b"',
      "{",
      '  bucket = "x"',
      "}",
      "other = 1",
    ].join("\n");
    expect(parseAnnotations("f.tf", content)[0]).toMatchObject({
      startLine: 1,
      endLine: 5,
    });
  });

  it("covers an indented Python block, trimming trailing blank lines", () => {
    const content = [
      "# @testplanit case:3",
      "def foo():",
      "    x = 1",
      "",
      "    return x",
      "",
      "def bar():",
      "    pass",
    ].join("\n");
    expect(parseAnnotations("f.py", content)).toEqual([
      { caseIds: [3], kind: "RANGE", startLine: 1, endLine: 5, markerLine: 1 },
    ]);
  });

  it("covers a one-liner as marker plus that line", () => {
    const content = "// @testplanit case:1\nconst a = 1;\nconst b = 2;\n";
    expect(parseAnnotations("f.ts", content)[0]).toMatchObject({
      kind: "RANGE",
      startLine: 1,
      endLine: 2,
    });
  });

  it("starts the block on the marker line when the marker trails code", () => {
    const content = [
      "function foo() { // @testplanit case:5",
      "  return 1;",
      "}",
      "const after = 1;",
    ].join("\n");
    expect(parseAnnotations("f.ts", content)[0]).toMatchObject({
      kind: "RANGE",
      startLine: 1,
      endLine: 3,
    });
  });

  it("skips blank and comment lines before the code", () => {
    const content = [
      "// @testplanit case:9",
      "",
      "/**",
      " * doc",
      " */",
      "const x = 1;",
    ].join("\n");
    expect(parseAnnotations("f.ts", content)[0]).toMatchObject({
      kind: "RANGE",
      endLine: 6,
    });
  });

  it("becomes a FILE marker when no code follows within 5 lines", () => {
    const content = [
      "// @testplanit case:9",
      "//",
      "//",
      "//",
      "//",
      "//",
      "const x = 1;",
    ].join("\n");
    expect(parseAnnotations("f.ts", content)).toEqual([
      { caseIds: [9], kind: "FILE", startLine: 1, endLine: 1, markerLine: 1 },
    ]);
  });

  it("becomes a FILE marker at the end of the file", () => {
    const content = "const a = 1;\n// @testplanit case:2\n";
    expect(parseAnnotations("f.ts", content)).toEqual([
      { caseIds: [2], kind: "FILE", startLine: 2, endLine: 2, markerLine: 2 },
    ]);
  });

  it("finds two markers in one file", () => {
    const content = [
      "// @testplanit case:1",
      "function a() {",
      "}",
      "",
      "// @testplanit case:2, 3",
      "function b() {",
      "}",
    ].join("\n");
    expect(parseAnnotations("f.ts", content)).toEqual([
      { caseIds: [1], kind: "RANGE", startLine: 1, endLine: 3, markerLine: 1 },
      {
        caseIds: [2, 3],
        kind: "RANGE",
        startLine: 5,
        endLine: 7,
        markerLine: 5,
      },
    ]);
  });

  it("handles CRLF line endings", () => {
    const content = "// @testplanit case:1\r\nconst a = 1;\r\nconst b = 2;\r\n";
    expect(parseAnnotations("f.ts", content)[0]).toMatchObject({
      startLine: 1,
      endLine: 2,
    });
  });

  it("returns nothing for a file without markers", () => {
    expect(parseAnnotations("f.ts", "const a = 1;\n// testplanit\n")).toEqual(
      []
    );
  });
});

describe("parseTestMap", () => {
  it("parses entries with cases, tags and notes, ignoring unknown keys", () => {
    const { entries, errors } = parseTestMap(
      [
        "version: 1",
        "pins:",
        '  - glob: "src/auth/**"',
        "    cases: [1, 2, 2]",
        "    note: auth flows",
        '  - glob: "src/billing/**"',
        "    tags: [billing, Payments]",
      ].join("\n")
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { glob: "src/auth/**", cases: [1, 2], tags: [], note: "auth flows" },
      { glob: "src/billing/**", cases: [], tags: ["billing", "Payments"] },
    ]);
  });

  it("reports a YAML syntax error as a single error", () => {
    const { entries, errors } = parseTestMap("pins: [\n  - glob: x\n");
    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("rejects a document that is not a mapping with a pins list", () => {
    const { entries, errors } = parseTestMap("- glob: x\n  cases: [1]\n");
    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("treats an empty file as no entries", () => {
    expect(parseTestMap("")).toEqual({ entries: [], errors: [] });
  });

  it("skips an entry with neither cases nor tags", () => {
    const { entries, errors } = parseTestMap(
      "pins:\n  - glob: a/**\n  - glob: b/**\n    cases: [3]\n"
    );
    expect(entries).toEqual([{ glob: "b/**", cases: [3], tags: [] }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("pins[0]");
  });

  it("skips an entry with a non-integer case id", () => {
    const { entries, errors } = parseTestMap(
      'pins:\n  - glob: a/**\n    cases: ["12"]\n  - glob: b/**\n    cases: [1.5]\n'
    );
    expect(entries).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("pins[0]");
    expect(errors[1]).toContain("pins[1]");
  });
});

describe("shouldScanMarkers", () => {
  it("scans only IMPACT configs with caching on", () => {
    expect(shouldScanMarkers({ purpose: "IMPACT", cacheEnabled: true })).toBe(
      true
    );
    expect(shouldScanMarkers({ purpose: "IMPACT", cacheEnabled: false })).toBe(
      false
    );
    expect(
      shouldScanMarkers({ purpose: "QUICKSCRIPT", cacheEnabled: true })
    ).toBe(false);
    expect(shouldScanMarkers({ purpose: undefined, cacheEnabled: true })).toBe(
      false
    );
  });
});

describe("isScannableFile", () => {
  it("rejects binaries and oversized files", () => {
    expect(isScannableFile("plain text")).toBe(true);
    expect(isScannableFile("PNG\0\0\0")).toBe(false);
    expect(isScannableFile("x".repeat(512 * 1024 + 1))).toBe(false);
  });
});

interface Fixture {
  tags?: { name: string; caseTags: { caseId: number }[] }[];
  cases?: { id: number; projectId: number }[];
  pins?: Record<string, unknown>[];
}

function makeDb(fx: Fixture = {}) {
  return {
    tags: {
      findMany: vi.fn(async (args: any) => {
        const wanted = new Set<string>(
          args.where.name.in.map((n: string) => n.toLowerCase())
        );
        return (fx.tags ?? []).filter((t) => wanted.has(t.name.toLowerCase()));
      }),
    },
    repositoryCases: {
      findMany: vi.fn(async (args: any) => {
        const ids = new Set<number>(args.where.id.in);
        return (fx.cases ?? [])
          .filter(
            (c) =>
              ids.has(c.id) &&
              (args.where.projectId === undefined ||
                c.projectId === args.where.projectId)
          )
          .map((c) => ({ id: c.id }));
      }),
    },
    repositoryCaseCodePin: {
      findMany: vi.fn<(args: unknown) => Promise<Record<string, unknown>[]>>(
        async () => fx.pins ?? []
      ),
      createMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(
        async () => ({ count: 0 })
      ),
      updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(
        async () => ({ count: 0 })
      ),
      update: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
  };
}

function run(db: ReturnType<typeof makeDb>, files: Record<string, string>) {
  return syncMarkerPins(
    db as unknown as MarkerScanDb,
    CONFIG,
    new Map(Object.entries(files)),
    OPTS
  );
}

const SIMPLE_FILE = "// @testplanit case:12\nconst a = 1;\n";
const SIMPLE_SNIPPET = "// @testplanit case:12\nconst a = 1;";

function existingRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    caseId: 12,
    kind: "RANGE",
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 2,
    symbol: null,
    anchorSha: SHA,
    anchorSnippet: SIMPLE_SNIPPET,
    anchorHash: hashSnippet(SIMPLE_SNIPPET),
    source: "ANNOTATION",
    note: null,
    ...over,
  };
}

describe("syncMarkerPins", () => {
  it("creates pins for new annotation markers", async () => {
    const db = makeDb({ cases: [{ id: 12, projectId: 1 }] });
    const report = await run(db, { "src/a.ts": SIMPLE_FILE });

    expect(db.repositoryCaseCodePin.createMany).toHaveBeenCalledTimes(1);
    expect(db.repositoryCaseCodePin.createMany.mock.calls[0][0]).toEqual({
      data: [
        {
          caseId: 12,
          kind: "RANGE",
          filePath: "src/a.ts",
          startLine: 1,
          endLine: 2,
          symbol: null,
          anchorSha: SHA,
          anchorSnippet: SIMPLE_SNIPPET,
          anchorHash: hashSnippet(SIMPLE_SNIPPET),
          source: "ANNOTATION",
          note: null,
          configId: 10,
          createdById: "user-1",
        },
      ],
    });
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      scannedFiles: 1,
      skippedFiles: 0,
      annotationMarkers: 1,
      mapEntries: 0,
      created: 1,
      updated: 0,
      removed: 0,
      unchanged: 0,
      problems: [],
      problemCount: 0,
      anchorSha: SHA,
    });
    expect(typeof report.scannedAt).toBe("string");
  });

  it("creates a FILE pin hashed over the whole file for a marker with no code", async () => {
    const db = makeDb({ cases: [{ id: 12, projectId: 1 }] });
    const content = "const a = 1;\n// @testplanit case:12\n";
    await run(db, { "src/a.ts": content });

    expect(db.repositoryCaseCodePin.createMany.mock.calls[0][0]).toEqual({
      data: [
        expect.objectContaining({
          caseId: 12,
          kind: "FILE",
          filePath: "src/a.ts",
          startLine: null,
          endLine: null,
          anchorSha: SHA,
          anchorSnippet: null,
          anchorHash: hashSnippet(content),
          source: "ANNOTATION",
        }),
      ],
    });
  });

  it("only reads ANNOTATION and MAPFILE pins, leaving MANUAL and AI alone", async () => {
    const db = makeDb();
    await run(db, {});
    expect(db.repositoryCaseCodePin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          configId: 10,
          source: { in: ["ANNOTATION", "MAPFILE"] },
          isDeleted: false,
        },
      })
    );
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
  });

  it("leaves an unchanged pin alone", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [existingRow()],
    });
    const report = await run(db, { "src/a.ts": SIMPLE_FILE });

    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      created: 0,
      updated: 0,
      removed: 0,
      unchanged: 1,
    });
  });

  it("advances the anchor sha of an unchanged pin in bulk", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [existingRow({ anchorSha: OLD_SHA })],
    });
    const report = await run(db, { "src/a.ts": SIMPLE_FILE });

    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledTimes(1);
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { anchorSha: SHA },
    });
    expect(report).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it("updates a pin whose block changed at the same start line", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [existingRow({ anchorSha: OLD_SHA })],
    });
    const content = "// @testplanit case:12\nfunction f() {\n  return 1;\n}\n";
    const snippet = "// @testplanit case:12\nfunction f() {\n  return 1;\n}";
    const report = await run(db, { "src/a.ts": content });

    expect(db.repositoryCaseCodePin.update).toHaveBeenCalledTimes(1);
    expect(db.repositoryCaseCodePin.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        endLine: 4,
        anchorSha: SHA,
        anchorSnippet: snippet,
        anchorHash: hashSnippet(snippet),
        note: null,
      },
    });
    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      created: 0,
      updated: 1,
      removed: 0,
      unchanged: 0,
    });
  });

  it("soft-deletes pins whose marker is gone", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [
        existingRow({ id: 1 }),
        existingRow({ id: 2, filePath: "src/gone.ts" }),
        existingRow({
          id: 3,
          kind: "GLOB",
          filePath: "src/**",
          startLine: null,
          endLine: null,
          anchorSha: null,
          anchorSnippet: null,
          anchorHash: null,
          source: "MAPFILE",
        }),
      ],
    });
    const report = await run(db, { "src/a.ts": SIMPLE_FILE });

    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledTimes(1);
    const call = db.repositoryCaseCodePin.updateMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ id: { in: [2, 3] } });
    expect(call.data.isDeleted).toBe(true);
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(report).toMatchObject({
      created: 0,
      updated: 0,
      removed: 2,
      unchanged: 1,
    });
  });

  it("removes duplicate rows for the same key", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [existingRow({ id: 1 }), existingRow({ id: 2 })],
    });
    const report = await run(db, { "src/a.ts": SIMPLE_FILE });
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [2] } } })
    );
    expect(report).toMatchObject({ removed: 1, unchanged: 1 });
  });

  it("reports unknown and foreign case ids without creating pins for them", async () => {
    const db = makeDb({
      cases: [
        { id: 12, projectId: 1 },
        { id: 55, projectId: 2 },
      ],
    });
    const report = await run(db, {
      "src/a.ts": "// @testplanit case:12, 99, 55\nconst a = 1;\n",
    });

    expect(report.created).toBe(1);
    expect(db.repositoryCaseCodePin.createMany.mock.calls[0][0]).toEqual({
      data: [expect.objectContaining({ caseId: 12 })],
    });
    expect(report.problems).toEqual([
      { kind: "unknown_case", detail: expect.stringContaining("99") },
      { kind: "foreign_case", detail: expect.stringContaining("55") },
    ]);
    expect(report.problems[0].detail).toContain("src/a.ts:1");
    expect(report.problemCount).toBe(2);
  });

  it("caps reported problems at 20 while counting them all", async () => {
    const db = makeDb();
    const ids = Array.from({ length: 25 }, (_, i) => 1000 + i).join(", ");
    const report = await run(db, {
      "src/a.ts": `// @testplanit case:${ids}\nconst a = 1;\n`,
    });
    expect(report.problems).toHaveLength(20);
    expect(report.problemCount).toBe(25);
    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
  });

  it("creates GLOB pins from the testmap, resolving tags to cases", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      tags: [{ name: "Billing", caseTags: [{ caseId: 20 }, { caseId: 21 }] }],
    });
    const report = await run(db, {
      ".testplanit/testmap.yml": [
        "pins:",
        '  - glob: "src/billing/**"',
        "    cases: [12]",
        "    tags: [billing]",
        "    note: billing area",
      ].join("\n"),
    });

    expect(db.tags.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { in: ["billing"], mode: "insensitive" },
          isDeleted: false,
        },
      })
    );
    const created = (
      db.repositoryCaseCodePin.createMany.mock.calls[0][0] as any
    ).data;
    expect(created.map((p: any) => p.caseId).sort()).toEqual([12, 20, 21]);
    for (const pin of created) {
      expect(pin).toMatchObject({
        kind: "GLOB",
        filePath: "src/billing/**",
        startLine: null,
        endLine: null,
        anchorSha: null,
        anchorSnippet: null,
        anchorHash: null,
        source: "MAPFILE",
        note: "billing area",
        configId: 10,
        createdById: "user-1",
      });
    }
    expect(report).toMatchObject({ mapEntries: 1, created: 3, problems: [] });
  });

  it("accepts the .yaml spelling of the testmap", async () => {
    const db = makeDb({ cases: [{ id: 12, projectId: 1 }] });
    const report = await run(db, {
      ".testplanit/testmap.yaml": "pins:\n  - glob: a/**\n    cases: [12]\n",
    });
    expect(report).toMatchObject({ mapEntries: 1, created: 1 });
  });

  it("reports unknown tags and tags with no cases in the project", async () => {
    const db = makeDb({ tags: [{ name: "empty", caseTags: [] }] });
    const report = await run(db, {
      ".testplanit/testmap.yml":
        "pins:\n  - glob: a/**\n    tags: [nope, empty]\n",
    });
    expect(report.problems).toEqual([
      { kind: "unknown_tag", detail: 'Tag "nope" not found' },
      {
        kind: "unknown_tag",
        detail: 'Tag "empty" has no cases in this project',
      },
    ]);
    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
  });

  it("reports testmap YAML and entry errors", async () => {
    const yamlDb = makeDb();
    const yamlReport = await run(yamlDb, {
      ".testplanit/testmap.yml": "pins: [\n",
    });
    expect(yamlReport.problems).toEqual([
      { kind: "yaml_error", detail: expect.any(String) },
    ]);

    const entryDb = makeDb();
    const entryReport = await run(entryDb, {
      ".testplanit/testmap.yml": "pins:\n  - glob: a/**\n",
    });
    expect(entryReport.problems).toEqual([
      { kind: "invalid_entry", detail: expect.stringContaining("pins[0]") },
    ]);
    expect(entryReport.mapEntries).toBe(0);
  });

  it("updates a MAPFILE pin whose note changed", async () => {
    const db = makeDb({
      cases: [{ id: 12, projectId: 1 }],
      pins: [
        existingRow({
          id: 3,
          kind: "GLOB",
          filePath: "a/**",
          startLine: null,
          endLine: null,
          anchorSha: null,
          anchorSnippet: null,
          anchorHash: null,
          source: "MAPFILE",
          note: "old",
        }),
      ],
    });
    const report = await run(db, {
      ".testplanit/testmap.yml":
        "pins:\n  - glob: a/**\n    cases: [12]\n    note: new\n",
    });
    expect(db.repositoryCaseCodePin.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        endLine: null,
        anchorSha: null,
        anchorSnippet: null,
        anchorHash: null,
        note: "new",
      },
    });
    expect(report).toMatchObject({ updated: 1, unchanged: 0 });
  });

  it("skips binary and oversized files", async () => {
    const db = makeDb({ cases: [{ id: 12, projectId: 1 }] });
    const report = await run(db, {
      "img.png": "PNG\0\0// @testplanit case:12\nx\n",
      "big.js":
        "x".repeat(512 * 1024) + "\n// @testplanit case:12\nconst a = 1;\n",
      "ok.js": SIMPLE_FILE,
    });
    expect(report).toMatchObject({
      scannedFiles: 1,
      skippedFiles: 2,
      annotationMarkers: 1,
      created: 1,
    });
    expect(db.repositoryCaseCodePin.createMany.mock.calls[0][0]).toEqual({
      data: [expect.objectContaining({ filePath: "ok.js" })],
    });
  });

  it("batches creates and deletes in groups of 200", async () => {
    const cases = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      projectId: 1,
    }));
    const pins = Array.from({ length: 201 }, (_, i) =>
      existingRow({ id: 1000 + i, caseId: 5000 + i, filePath: "gone.ts" })
    );
    const db = makeDb({ cases, pins });
    const ids = cases.map((c) => c.id).join(",");
    const report = await run(db, {
      "src/a.ts": `// @testplanit case:${ids}\nconst a = 1;\n`,
    });
    expect(db.repositoryCaseCodePin.createMany).toHaveBeenCalledTimes(2);
    expect(
      (db.repositoryCaseCodePin.createMany.mock.calls[0][0] as any).data
    ).toHaveLength(200);
    expect(
      (db.repositoryCaseCodePin.createMany.mock.calls[1][0] as any).data
    ).toHaveLength(50);
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ created: 250, removed: 201 });
  });
});
