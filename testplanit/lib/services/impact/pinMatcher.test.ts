import { describe, expect, it, vi } from "vitest";

import {
  parseUnifiedDiff,
  type DiffHunk,
} from "~/lib/integrations/diff/parseUnifiedDiff";

import {
  locateSnippet,
  locateSymbolBlock,
  matchPins,
  rangesIntersect,
  symbolCandidates,
  type DiffFileForMatch,
  type PinMatchContext,
  type PinMatchInput,
} from "./pinMatcher";

function hunk(...changedOldRanges: Array<[number, number]>): DiffHunk {
  const first = changedOldRanges[0] ?? [1, 1];
  return {
    oldStart: first[0],
    oldLines: 1,
    newStart: first[0],
    newLines: 1,
    changedOldRanges,
  };
}

function file(
  over: Partial<DiffFileForMatch> & { path: string }
): DiffFileForMatch {
  return { status: "modified", isBinary: false, hunks: [], ...over };
}

function pin(
  over: Partial<PinMatchInput> & {
    kind: PinMatchInput["kind"];
    filePath: string;
  }
): PinMatchInput {
  return { id: 1, ...over };
}

function context(
  baseFiles: Record<string, string>,
  baseSha = "base-sha"
): PinMatchContext & { getBaseFile: ReturnType<typeof vi.fn> } {
  return {
    baseSha,
    getBaseFile: vi.fn(async (path: string) => baseFiles[path] ?? null),
  };
}

const ORIGINAL_BLOCK = [
  "export function total(items: Item[]) {",
  "  return items.reduce((sum, item) => sum + item.price, 0);",
  "}",
];

const _ORIGINAL_FILE = [
  'import { Item } from "./types";',
  "",
  "const TAX = 0.2;",
  "",
  ...ORIGINAL_BLOCK,
  "",
  "export function withTax(items: Item[]) {",
  "  return total(items) * (1 + TAX);",
  "}",
  "",
].join("\n");

const DRIFTED_FILE = [
  'import { Item } from "./types";',
  'import { log } from "./log";',
  "",
  "const TAX = 0.2;",
  "const SHIPPING = 5;",
  "const CURRENCY = 'EUR';",
  "",
  "export function shipping() {",
  "  return SHIPPING;",
  "}",
  ...ORIGINAL_BLOCK,
  "",
  "export function withTax(items: Item[]) {",
  "  return total(items) * (1 + TAX);",
  "}",
  "",
].join("\n");

async function one(
  p: PinMatchInput,
  files: DiffFileForMatch[],
  ctx: PinMatchContext
) {
  const [outcome] = await matchPins([p], files, ctx);
  return outcome;
}

describe("matchPins RANGE", () => {
  const rangePin = pin({
    kind: "RANGE",
    filePath: "src/cart.ts",
    startLine: 5,
    endLine: 7,
    anchorSha: "base-sha",
    anchorSnippet: ORIGINAL_BLOCK.join("\n"),
  });

  it.each([
    { name: "touched inside the range", ranges: [[6, 6]], matched: true },
    { name: "touched on the first line", ranges: [[5, 5]], matched: true },
    { name: "touched on the last line", ranges: [[7, 7]], matched: true },
    { name: "not touched above", ranges: [[1, 4]], matched: false },
    { name: "not touched below", ranges: [[8, 20]], matched: false },
  ] as Array<{
    name: string;
    ranges: Array<[number, number]>;
    matched: boolean;
  }>)("exact anchor at base: $name", async ({ ranges, matched }) => {
    const ctx = context({});
    const outcome = await one(
      rangePin,
      [file({ path: "src/cart.ts", hunks: [hunk(...ranges)] })],
      ctx
    );
    expect(outcome).toMatchObject({
      pinId: 1,
      matched,
      stale: false,
      staleDismissed: false,
      confidence: "exact",
      matchedPath: "src/cart.ts",
      relocatedRange: [5, 7],
      touchedRanges: matched ? ranges : [],
    });
    expect(ctx.getBaseFile).not.toHaveBeenCalled();
  });

  it("treats a missing endLine as a single-line range", async () => {
    const outcome = await one(
      pin({
        kind: "RANGE",
        filePath: "a.ts",
        startLine: 4,
        anchorSha: "base-sha",
      }),
      [file({ path: "a.ts", hunks: [hunk([4, 4])] })],
      context({})
    );
    expect(outcome.relocatedRange).toEqual([4, 4]);
    expect(outcome.matched).toBe(true);
  });

  it("relocates a block that drifted down by five lines at an older anchor", async () => {
    const ctx = context({ "src/cart.ts": DRIFTED_FILE });
    const outcome = await one(
      { ...rangePin, anchorSha: "older-sha" },
      [file({ path: "src/cart.ts", hunks: [hunk([11, 11])] })],
      ctx
    );
    expect(ctx.getBaseFile).toHaveBeenCalledWith("src/cart.ts");
    expect(outcome).toMatchObject({
      matched: true,
      stale: false,
      confidence: "exact",
      relocatedRange: [11, 13],
      touchedRanges: [[11, 11]],
    });
  });

  it("does not match when the relocated block is untouched", async () => {
    const outcome = await one(
      { ...rangePin, anchorSha: "older-sha" },
      [file({ path: "src/cart.ts", hunks: [hunk([2, 2], [15, 15])] })],
      context({ "src/cart.ts": DRIFTED_FILE })
    );
    expect(outcome).toMatchObject({
      matched: false,
      stale: false,
      confidence: "exact",
      relocatedRange: [11, 13],
      touchedRanges: [],
    });
  });

  it("finds a whitespace-only drift with normalized confidence", async () => {
    const reindented = DRIFTED_FILE.replace(
      "  return items.reduce((sum, item) => sum + item.price, 0);",
      "\treturn items.reduce((sum,  item) =>  sum + item.price, 0);"
    );
    const outcome = await one(
      { ...rangePin, anchorSha: "older-sha" },
      [file({ path: "src/cart.ts", hunks: [hunk([12, 12])] })],
      context({ "src/cart.ts": reindented })
    );
    expect(outcome).toMatchObject({
      matched: true,
      confidence: "normalized",
      relocatedRange: [11, 13],
    });
  });

  it("finds a fuzzy match at the 0.6 threshold", async () => {
    const snippet = [
      "line one",
      "line two",
      "line three",
      "line four",
      "line five",
    ];
    const base = [
      "header",
      "line one",
      "changed two",
      "line three",
      "changed four",
      "line five",
      "footer",
    ].join("\n");
    const outcome = await one(
      pin({
        kind: "RANGE",
        filePath: "f.txt",
        startLine: 1,
        endLine: 5,
        anchorSha: "older-sha",
        anchorSnippet: snippet.join("\n"),
      }),
      [file({ path: "f.txt", hunks: [hunk([3, 3])] })],
      context({ "f.txt": base })
    );
    expect(outcome).toMatchObject({
      matched: true,
      confidence: "fuzzy",
      relocatedRange: [2, 6],
      touchedRanges: [[3, 3]],
    });
  });

  it("flags SNIPPET_NOT_FOUND as stale but still matched", async () => {
    const outcome = await one(
      {
        ...rangePin,
        anchorSha: "older-sha",
        anchorSnippet: "nothing like this\nexists in the file\nat all",
      },
      [file({ path: "src/cart.ts", hunks: [hunk([1, 1])] })],
      context({ "src/cart.ts": DRIFTED_FILE })
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "SNIPPET_NOT_FOUND",
      confidence: "file",
      matchedPath: "src/cart.ts",
    });
    expect(outcome.relocatedRange).toBeUndefined();
  });

  it("flags FILE_MISSING_AT_BASE when the base file cannot be read", async () => {
    const outcome = await one(
      { ...rangePin, anchorSha: "older-sha" },
      [file({ path: "src/cart.ts", status: "added", hunks: [hunk([1, 1])] })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "FILE_MISSING_AT_BASE",
      confidence: "file",
    });
  });

  it("counts an insertion adjacent to the range boundary as touched", async () => {
    const boundaryPin = pin({
      kind: "RANGE",
      filePath: "a.ts",
      startLine: 10,
      endLine: 12,
      anchorSha: "base-sha",
    });
    const after = await one(
      boundaryPin,
      [file({ path: "a.ts", hunks: [hunk([12, 13])] })],
      context({})
    );
    const before = await one(
      boundaryPin,
      [file({ path: "a.ts", hunks: [hunk([9, 10])] })],
      context({})
    );
    const beyond = await one(
      boundaryPin,
      [file({ path: "a.ts", hunks: [hunk([13, 14])] })],
      context({})
    );
    expect(after.matched).toBe(true);
    expect(before.matched).toBe(true);
    expect(beyond.matched).toBe(false);
  });

  it("treats a binary file as a file-level match without reading the base", async () => {
    const ctx = context({});
    const outcome = await one(
      { ...rangePin, anchorSha: "older-sha" },
      [file({ path: "src/cart.ts", isBinary: true })],
      ctx
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: false,
      confidence: "file",
      matchedPath: "src/cart.ts",
    });
    expect(ctx.getBaseFile).not.toHaveBeenCalled();
  });

  it("reads each base file once across many pins", async () => {
    const ctx = context({ "src/cart.ts": DRIFTED_FILE });
    const pins = [1, 2, 3].map((id) => ({
      ...rangePin,
      id,
      anchorSha: "older-sha",
    }));
    const outcomes = await matchPins(
      pins,
      [file({ path: "src/cart.ts", hunks: [hunk([11, 11])] })],
      ctx
    );
    expect(outcomes.map((o) => o.pinId)).toEqual([1, 2, 3]);
    expect(ctx.getBaseFile).toHaveBeenCalledTimes(1);
  });
});

describe("matchPins file-level outcomes", () => {
  it("does not match a pin whose file is not in the diff", async () => {
    const outcome = await one(
      pin({ kind: "FILE", filePath: "src/other.ts" }),
      [file({ path: "src/cart.ts" })],
      context({})
    );
    expect(outcome).toEqual({
      pinId: 1,
      matched: false,
      stale: false,
      staleDismissed: false,
      confidence: "file",
    });
  });

  it("matches a FILE pin on any change to the file", async () => {
    const outcome = await one(
      pin({ kind: "FILE", filePath: "src/cart.ts" }),
      [file({ path: "src/cart.ts", hunks: [hunk([3, 3])] })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: false,
      confidence: "file",
      matchedPath: "src/cart.ts",
    });
  });

  it("flags a deleted file as stale FILE_DELETED", async () => {
    const outcome = await one(
      pin({
        kind: "RANGE",
        filePath: "src/cart.ts",
        startLine: 1,
        anchorSha: "base-sha",
      }),
      [file({ path: "src/cart.ts", status: "deleted" })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "FILE_DELETED",
      staleDismissed: false,
      confidence: "file",
      matchedPath: "src/cart.ts",
    });
  });

  it("follows a rename, suggests the new path, and still intersects", async () => {
    const ctx = context({ "src/cart.ts": DRIFTED_FILE });
    const outcome = await one(
      pin({
        kind: "RANGE",
        filePath: "src/cart.ts",
        startLine: 5,
        endLine: 7,
        anchorSha: "older-sha",
        anchorSnippet: ORIGINAL_BLOCK.join("\n"),
      }),
      [
        file({
          path: "src/basket.ts",
          previousPath: "src/cart.ts",
          status: "renamed",
          hunks: [hunk([12, 12])],
        }),
      ],
      ctx
    );
    expect(ctx.getBaseFile).toHaveBeenCalledWith("src/cart.ts");
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "FILE_RENAMED",
      suggestedPath: "src/basket.ts",
      matchedPath: "src/basket.ts",
      relocatedRange: [11, 13],
      touchedRanges: [[12, 12]],
    });
  });

  it("marks a renamed FILE pin stale but matched", async () => {
    const outcome = await one(
      pin({ kind: "FILE", filePath: "old.ts" }),
      [file({ path: "new.ts", previousPath: "old.ts", status: "renamed" })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "FILE_RENAMED",
      suggestedPath: "new.ts",
      matchedPath: "new.ts",
    });
  });

  it.each([
    {
      name: "set on a stale pin",
      dismissedAt: new Date("2026-01-01"),
      stale: true,
      expected: true,
    },
    {
      name: "set as a string on a stale pin",
      dismissedAt: "2026-01-01T00:00:00Z",
      stale: true,
      expected: true,
    },
    {
      name: "unset on a stale pin",
      dismissedAt: null,
      stale: true,
      expected: false,
    },
    {
      name: "set on a fresh pin",
      dismissedAt: new Date("2026-01-01"),
      stale: false,
      expected: false,
    },
  ])("staleDismissed $name", async ({ dismissedAt, stale, expected }) => {
    const outcome = await one(
      pin({ kind: "FILE", filePath: "a.ts", staleDismissedAt: dismissedAt }),
      [file({ path: "a.ts", status: stale ? "deleted" : "modified" })],
      context({})
    );
    expect(outcome.stale).toBe(stale);
    expect(outcome.staleDismissed).toBe(expected);
  });
});

describe("matchPins GLOB", () => {
  const files = [
    file({ path: "src/api/users.ts" }),
    file({ path: "docs/readme.md" }),
    file({
      path: "src/lib/new-name.ts",
      previousPath: "src/lib/old-name.ts",
      status: "renamed",
    }),
  ];

  it("matches on the current path", async () => {
    const outcome = await one(
      pin({ kind: "GLOB", filePath: "src/api/**/*.ts" }),
      files,
      context({})
    );
    expect(outcome).toEqual({
      pinId: 1,
      matched: true,
      stale: false,
      staleDismissed: false,
      confidence: "glob",
      matchedPath: "src/api/users.ts",
    });
  });

  it("matches on the previous path of a rename", async () => {
    const outcome = await one(
      pin({ kind: "GLOB", filePath: "src/lib/old-*.ts" }),
      files,
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      confidence: "glob",
      matchedPath: "src/lib/new-name.ts",
    });
  });

  it("reports no match when nothing fits the pattern", async () => {
    const outcome = await one(
      pin({ kind: "GLOB", filePath: "**/*.py" }),
      files,
      context({})
    );
    expect(outcome).toEqual({
      pinId: 1,
      matched: false,
      stale: false,
      staleDismissed: false,
      confidence: "glob",
    });
  });
});

const TS_SOURCE = [
  'import { db } from "./db";',
  "",
  "export function fooBar(id: number) {",
  "  return db.find(id);",
  "}",
  "",
  "export const helper = () => foo(1);",
  "",
  "export async function foo(id: number): Promise<Row | null> {",
  "  const row = await db.find(id);",
  "  if (!row) {",
  "    return null;",
  "  }",
  "  return row;",
  "}",
  "",
  "export class Store {",
  "  private items = new Map<string, Row>();",
  "",
  "  get(key: string) {",
  "    return this.items.get(key);",
  "  }",
  "}",
  "",
].join("\n");

const PY_SOURCE = [
  "import os",
  "",
  "",
  "class Cart:",
  "    def __init__(self):",
  "        self.items = []",
  "",
  "    def total(self):",
  "        return sum(i.price for i in self.items)",
  "",
  "",
  "def foo(x):",
  "    y = x + 1",
  "",
  "    return y",
  "",
  "",
  "def bar():",
  "    return foo(2)",
  "",
].join("\n");

describe("matchPins SYMBOL", () => {
  it("locates a TypeScript brace block and intersects it", async () => {
    const ctx = context({ "src/foo.ts": TS_SOURCE });
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "foo" }),
      [file({ path: "src/foo.ts", hunks: [hunk([12, 12])] })],
      ctx
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: false,
      confidence: "fuzzy",
      relocatedRange: [9, 15],
      touchedRanges: [[12, 12]],
    });
  });

  it("does not match when the change is outside the symbol block", async () => {
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "foo" }),
      [file({ path: "src/foo.ts", hunks: [hunk([4, 4], [20, 21])] })],
      context({ "src/foo.ts": TS_SOURCE })
    );
    expect(outcome).toMatchObject({
      matched: false,
      stale: false,
      relocatedRange: [9, 15],
      touchedRanges: [],
    });
  });

  it("locates a Python indentation block", async () => {
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "cart.py", symbol: "foo" }),
      [file({ path: "cart.py", hunks: [hunk([15, 15])] })],
      context({ "cart.py": PY_SOURCE })
    );
    expect(outcome).toMatchObject({
      matched: true,
      confidence: "fuzzy",
      relocatedRange: [12, 15],
      touchedRanges: [[15, 15]],
    });
  });

  it("falls back to the patch text when the symbol is missing at base", async () => {
    const mentioned = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "newThing" }),
      [
        file({
          path: "src/foo.ts",
          hunks: [hunk([15, 16])],
          patch:
            "@@ -15,0 +16,3 @@\n+export function newThing() {\n+  return 1;\n+}\n",
        }),
      ],
      context({ "src/foo.ts": TS_SOURCE })
    );
    expect(mentioned).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "SYMBOL_NOT_FOUND",
      confidence: "fuzzy",
      matchedPath: "src/foo.ts",
    });

    const unmentioned = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "newThing" }),
      [
        file({
          path: "src/foo.ts",
          hunks: [hunk([4, 4])],
          patch: "@@ -4 +4 @@\n-  return db.find(id);\n+  return db.get(id);\n",
        }),
      ],
      context({ "src/foo.ts": TS_SOURCE })
    );
    expect(unmentioned).toMatchObject({
      matched: false,
      stale: true,
      staleReason: "SYMBOL_NOT_FOUND",
    });

    const partialWord = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "Thing" }),
      [
        file({
          path: "src/foo.ts",
          hunks: [hunk([4, 4])],
          patch: "+export function newThing() {\n",
        }),
      ],
      context({ "src/foo.ts": TS_SOURCE })
    );
    expect(partialWord.matched).toBe(false);
  });

  it("works from real parsed hunks", async () => {
    const patch = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -10,3 +10,3 @@ export async function foo(id: number): Promise<Row | null> {",
      "   const row = await db.find(id);",
      "-  if (!row) {",
      "+  if (row == null) {",
      "     return null;",
    ].join("\n");
    const parsed = parseUnifiedDiff(patch);
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "foo" }),
      [file({ path: "src/foo.ts", hunks: parsed.hunks, patch })],
      context({ "src/foo.ts": TS_SOURCE })
    );
    expect(outcome).toMatchObject({
      matched: true,
      relocatedRange: [9, 15],
      touchedRanges: [[11, 11]],
    });
  });

  it("flags FILE_MISSING_AT_BASE for an unreadable base", async () => {
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "src/foo.ts", symbol: "foo" }),
      [file({ path: "src/foo.ts", status: "added", hunks: [hunk([1, 1])] })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: true,
      staleReason: "FILE_MISSING_AT_BASE",
      confidence: "file",
    });
  });

  it("treats a binary file as a file-level match", async () => {
    const outcome = await one(
      pin({ kind: "SYMBOL", filePath: "img.png", symbol: "foo" }),
      [file({ path: "img.png", isBinary: true })],
      context({})
    );
    expect(outcome).toMatchObject({
      matched: true,
      stale: false,
      confidence: "file",
    });
  });
});

describe("locateSymbolBlock", () => {
  const ts = TS_SOURCE.split("\n");
  const py = PY_SOURCE.split("\n");

  it("does not let fooBar satisfy foo", () => {
    expect(locateSymbolBlock(ts, "foo")).toEqual([9, 15]);
    expect(locateSymbolBlock(ts, "fooBar")).toEqual([3, 5]);
    expect(
      locateSymbolBlock(["function fooBar() {", "  return 1;", "}"], "foo")
    ).toBeNull();
    expect(
      locateSymbolBlock(["const myfoo = 1;", "obj.foo = 2;"], "foo")
    ).toBeNull();
  });

  it("prefers the declaration over an earlier call site", () => {
    expect(locateSymbolBlock(ts, "foo")?.[0]).toBe(9);
  });

  it("finds a class method and a class", () => {
    expect(locateSymbolBlock(ts, "get")).toEqual([20, 22]);
    expect(locateSymbolBlock(ts, "Store")).toEqual([17, 23]);
  });

  it("finds Python def and class blocks by indentation", () => {
    expect(locateSymbolBlock(py, "foo")).toEqual([12, 15]);
    expect(locateSymbolBlock(py, "Cart")).toEqual([4, 9]);
    expect(locateSymbolBlock(py, "total")).toEqual([8, 9]);
    expect(locateSymbolBlock(py, "bar")).toEqual([18, 19]);
  });

  it("returns [decl, decl] for a bare one-liner", () => {
    expect(
      locateSymbolBlock(
        ["const a = 1;", "const foo = 2;", "const b = 3;"],
        "foo"
      )
    ).toEqual([2, 2]);
    expect(
      locateSymbolBlock(
        [
          "class X {",
          "  foo() { return 1; }",
          "  bar() {",
          "    return 2;",
          "  }",
          "}",
        ],
        "foo"
      )
    ).toEqual([2, 2]);
  });

  it("handles Allman braces and multi-line signatures", () => {
    expect(
      locateSymbolBlock(
        ["int foo(int x)", "{", "  return x;", "}", "int bar() { return 0; }"],
        "foo"
      )
    ).toEqual([1, 4]);
    expect(
      locateSymbolBlock(
        [
          "export function foo(",
          "  a: string,",
          "  b: number",
          "): void {",
          "  use(a, b);",
          "}",
          "",
        ],
        "foo"
      )
    ).toEqual([1, 6]);
  });

  it("handles Go receivers and Ruby end blocks", () => {
    expect(
      locateSymbolBlock(
        [
          "package x",
          "",
          "func (r *Repo) Find(id int) error {",
          "\treturn nil",
          "}",
        ],
        "Find"
      )
    ).toEqual([3, 5]);
    expect(
      locateSymbolBlock(["def foo", "  1", "end", "", "def bar", "end"], "foo")
    ).toEqual([1, 3]);
  });

  it("ignores braces inside strings and comments", () => {
    expect(
      locateSymbolBlock(
        [
          "function foo() { // opens {",
          '  const s = "}";',
          "  return s;",
          "}",
          "const after = 1;",
        ],
        "foo"
      )
    ).toEqual([1, 4]);
  });

  it("returns null for an unknown or empty symbol", () => {
    expect(locateSymbolBlock(ts, "missing")).toBeNull();
    expect(locateSymbolBlock(ts, "")).toBeNull();
  });
});

describe("symbolCandidates", () => {
  const ts = TS_SOURCE.split("\n");
  const py = PY_SOURCE.split("\n");

  it("lists TypeScript declarations in file order", () => {
    expect(symbolCandidates(ts)).toEqual(["fooBar", "helper", "foo", "Store"]);
  });

  it("leaves out value bindings, which resolve to a single line", () => {
    // `row` is a local inside foo(); `items` is a class field. Both are legal
    // pin targets and both are nearly useless as ones.
    expect(symbolCandidates(ts)).not.toContain("row");
    expect(symbolCandidates(ts)).not.toContain("items");
  });

  it("leaves out route-file config exports but keeps the handler", () => {
    expect(
      symbolCandidates([
        'export const runtime = "nodejs";',
        'export const dynamic = "force-dynamic";',
        "export async function POST(request: NextRequest) {",
        '  const clientIp = request.headers.get("x-forwarded-for");',
        "  return Response.json({ clientIp });",
        "}",
      ])
    ).toEqual(["POST"]);
  });

  it("keeps a function assigned to a wrapper call", () => {
    expect(
      symbolCandidates([
        "export const GET = withAuditContext(async (request) => {",
        "  return Response.json({});",
        "});",
      ])
    ).toEqual(["GET"]);
  });

  it("leaves out an awaited value whose line happens to hold an arrow", () => {
    expect(
      symbolCandidates([
        "const errorData = await response.json().catch(() => ({}));",
      ])
    ).toEqual([]);
  });

  it("lists Python classes and defs", () => {
    expect(symbolCandidates(py)).toEqual([
      "Cart",
      "__init__",
      "total",
      "foo",
      "bar",
    ]);
  });

  it("leaves out a bare class method, which only the loose pass finds", () => {
    // `get(key) {` carries no declaration keyword. The matcher still locates
    // it, so pinning it by hand works; the picker stays quiet rather than
    // guessing call sites apart from declarations. Free text covers the gap.
    expect(symbolCandidates(ts)).not.toContain("get");
    expect(locateSymbolBlock(ts, "get")).toEqual([20, 22]);
  });

  it("offers only names locateSymbolBlock can find again", () => {
    for (const lines of [ts, py]) {
      for (const name of symbolCandidates(lines)) {
        expect(locateSymbolBlock(lines, name)).not.toBeNull();
      }
    }
  });

  it("includes a const arrow function, which a keyword-narrow scan would miss", () => {
    expect(
      symbolCandidates(["const handleSubmit = async (e) => {", "};"])
    ).toEqual(["handleSubmit"]);
  });

  it("skips comments, imports and call sites", () => {
    expect(
      symbolCandidates([
        "// function commented() {}",
        'import { thing } from "./thing";',
        "return other(1);",
        "obj.method(2);",
      ])
    ).toEqual([]);
  });

  it("skips a declaration keyword standing in for a name", () => {
    expect(symbolCandidates(["export default function page() {"])).toEqual([
      "page",
    ]);
  });

  it("deduplicates repeated names and honors the limit", () => {
    const lines = [
      "function alpha() {}",
      "function alpha() {}",
      "function beta() {}",
      "function gamma() {}",
    ];
    expect(symbolCandidates(lines)).toEqual(["alpha", "beta", "gamma"]);
    expect(symbolCandidates(lines, 2)).toEqual(["alpha", "beta"]);
  });

  it("returns nothing for a file with no declarations", () => {
    expect(symbolCandidates(["{", '  "name": "value"', "}"])).toEqual([]);
  });
});

describe("locateSnippet", () => {
  const base = [
    "a",
    "b",
    "block start",
    "block body",
    "block end",
    "c",
    "d",
    "e",
    "f",
    "block start",
    "block body",
    "block end",
    "g",
  ];
  const snippet = ["block start", "block body", "block end"];

  it("returns the first exact match without a hint", () => {
    expect(locateSnippet(base, snippet)).toEqual({
      start: 3,
      end: 5,
      confidence: "exact",
    });
  });

  it("breaks ties by distance to the hint", () => {
    expect(locateSnippet(base, snippet, 9)).toEqual({
      start: 10,
      end: 12,
      confidence: "exact",
    });
    expect(locateSnippet(base, snippet, 4)).toEqual({
      start: 3,
      end: 5,
      confidence: "exact",
    });
  });

  it("ignores a trailing empty element and rejects an empty snippet", () => {
    expect(locateSnippet(base, [...snippet, ""])).toEqual({
      start: 3,
      end: 5,
      confidence: "exact",
    });
    expect(locateSnippet(base, [])).toBeNull();
    expect(locateSnippet(base, [""])).toBeNull();
  });

  it("falls back to normalized whitespace", () => {
    expect(
      locateSnippet(
        base,
        ["  block   start", "block body\t", " block end "],
        10
      )
    ).toEqual({
      start: 10,
      end: 12,
      confidence: "normalized",
    });
  });

  it.each([
    { name: "3 of 5 lines match", matching: 3, found: true },
    { name: "2 of 5 lines match", matching: 2, found: false },
  ])("fuzzy threshold: $name", ({ matching, found }) => {
    const target = ["one", "two", "three", "four", "five"];
    const drifted = target.map((line, i) =>
      i < matching ? line : `changed ${line}`
    );
    const lines = ["x", "y", ...drifted, "z"];
    const result = locateSnippet(lines, target);
    if (found) {
      expect(result).toEqual({ start: 3, end: 7, confidence: "fuzzy" });
    } else {
      expect(result).toBeNull();
    }
  });

  it("accepts a long snippet whose three leading and trailing lines match", () => {
    const target = Array.from({ length: 16 }, (_, i) => `line ${i}`);
    const drifted = target.map((line, i) =>
      i < 3 || i >= 13 ? line : `edited ${i}`
    );
    const lines = ["pre", ...drifted, "post"];
    expect(locateSnippet(lines, target)).toEqual({
      start: 2,
      end: 17,
      confidence: "fuzzy",
    });
  });

  it("prefers the higher fuzzy score, then the hint", () => {
    const target = ["p", "q", "r", "s", "t"];
    const lines = [
      ...["p", "q", "r", "X", "Y"],
      "gap",
      ...["p", "q", "r", "s", "Y"],
      "gap",
      ...["p", "q", "r", "X", "Y"],
    ];
    expect(locateSnippet(lines, target)).toMatchObject({ start: 7, end: 11 });
    const equalLines = [
      ...["p", "q", "r", "X", "Y"],
      "gap",
      ...["p", "q", "r", "X", "Y"],
    ];
    expect(locateSnippet(equalLines, target, 7)).toMatchObject({
      start: 7,
      end: 11,
    });
    expect(locateSnippet(equalLines, target, 1)).toMatchObject({
      start: 1,
      end: 5,
    });
  });

  it("returns null when the base is shorter than the snippet", () => {
    expect(locateSnippet(["a"], ["a", "b"])).toBeNull();
  });
});

describe("rangesIntersect", () => {
  it.each([
    {
      name: "inside",
      range: [10, 20],
      hunks: [hunk([12, 14])],
      expected: [[12, 14]],
    },
    {
      name: "overlapping the start",
      range: [10, 20],
      hunks: [hunk([5, 10])],
      expected: [[5, 10]],
    },
    {
      name: "overlapping the end",
      range: [10, 20],
      hunks: [hunk([20, 25])],
      expected: [[20, 25]],
    },
    {
      name: "enclosing",
      range: [10, 20],
      hunks: [hunk([1, 40])],
      expected: [[1, 40]],
    },
    {
      name: "just before",
      range: [10, 20],
      hunks: [hunk([1, 9])],
      expected: [],
    },
    {
      name: "just after",
      range: [10, 20],
      hunks: [hunk([21, 30])],
      expected: [],
    },
    {
      name: "across hunks",
      range: [10, 20],
      hunks: [hunk([1, 3], [11, 11]), hunk([19, 22], [30, 31])],
      expected: [
        [11, 11],
        [19, 22],
      ],
    },
    { name: "no hunks", range: [10, 20], hunks: [], expected: [] },
    {
      name: "reversed range",
      range: [20, 10],
      hunks: [hunk([15, 15])],
      expected: [[15, 15]],
    },
  ] as Array<{
    name: string;
    range: [number, number];
    hunks: DiffHunk[];
    expected: Array<[number, number]>;
  }>)("$name", ({ range, hunks, expected }) => {
    expect(rangesIntersect(range, hunks)).toEqual(expected);
  });
});
