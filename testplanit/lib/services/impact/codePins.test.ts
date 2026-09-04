import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./compareService", () => ({
  resolveRefToSha: vi.fn(),
}));

// isSafeRepoPath must stay real: the create schema depends on it.
vi.mock("./fileAtCommit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fileAtCommit")>();
  return {
    ...actual,
    getFileAtCommit: vi.fn(),
  };
});

// The real fileAtCommit module (kept for isSafeRepoPath) imports the cache,
// which would otherwise open a Valkey connection at import.
vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

// Spy on the locators so tests can assert how they are called and force the
// not-found branches, while defaulting to the real implementations.
vi.mock("./pinMatcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pinMatcher")>();
  return {
    ...actual,
    locateSnippet: vi.fn(actual.locateSnippet),
    locateSymbolBlock: vi.fn(actual.locateSymbolBlock),
  };
});

import type { GitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  anchorPin,
  codePinCreateSchema,
  computePinStaleness,
  hashSnippet,
  MAX_ANCHOR_SNIPPET_BYTES,
  MAX_PIN_RANGE_LINES,
  MAX_STALENESS_CHECKS,
  PinAnchorError,
  type StalenessPinInput,
} from "./codePins";
import { resolveRefToSha } from "./compareService";
import { getFileAtCommit } from "./fileAtCommit";
import { locateSnippet, locateSymbolBlock } from "./pinMatcher";
import type { LoadedRepoConfig } from "./repoAccess";

const TIP = "f".repeat(40);
const OLD = "0".repeat(40);

const config: LoadedRepoConfig = {
  id: 5,
  projectId: 1,
  purpose: "IMPACT",
  branch: "main",
  cacheEnabled: true,
  repositoryId: 9,
  repository: { id: 9, name: "acme/app", provider: "github", settings: null },
};

function makeAdapter() {
  return {
    getDefaultBranch: vi.fn().mockResolvedValue("develop"),
  } as unknown as GitRepoAdapter & {
    getDefaultBranch: ReturnType<typeof vi.fn>;
  };
}

/** Route getFileAtCommit by path: a string is content, an Error is thrown. */
function stubFiles(files: Record<string, string | Error>) {
  (getFileAtCommit as any).mockImplementation(
    async ({ path }: { path: string }) => {
      const entry = files[path];
      if (entry === undefined) {
        throw new Error("GitHub API error: 404 Not Found");
      }
      if (entry instanceof Error) throw entry;
      return { content: entry, cached: false };
    }
  );
}

const FUNC_FILE = [
  "import x from 'y';",
  "",
  "export function foo() {",
  "  return 1;",
  "}",
  "",
  "const tail = true;",
].join("\n");

describe("codePinCreateSchema", () => {
  const base = { configId: 5, filePath: "src/a.ts" };

  it("accepts a FILE pin with just a path", () => {
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "FILE" }).success
    ).toBe(true);
  });

  it("requires startLine for RANGE", () => {
    const result = codePinCreateSchema.safeParse({ ...base, kind: "RANGE" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain(
      "startLine"
    );
  });

  it("accepts a single-line RANGE (endLine defaults to startLine)", () => {
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "RANGE", startLine: 10 })
        .success
    ).toBe(true);
  });

  it("rejects a RANGE whose end is before its start", () => {
    const result = codePinCreateSchema.safeParse({
      ...base,
      kind: "RANGE",
      startLine: 10,
      endLine: 9,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["endLine"],
      message: "Before start",
    });
  });

  it("rejects a RANGE spanning more than MAX_PIN_RANGE_LINES and accepts exactly that many", () => {
    const tooBig = codePinCreateSchema.safeParse({
      ...base,
      kind: "RANGE",
      startLine: 1,
      endLine: MAX_PIN_RANGE_LINES + 1,
    });
    expect(tooBig.success).toBe(false);
    expect(tooBig.error?.issues[0]).toMatchObject({
      path: ["endLine"],
      message: "Range too large",
    });

    expect(
      codePinCreateSchema.safeParse({
        ...base,
        kind: "RANGE",
        startLine: 1,
        endLine: MAX_PIN_RANGE_LINES,
      }).success
    ).toBe(true);
  });

  it("requires symbol for SYMBOL, and rejects a whitespace-only symbol", () => {
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "SYMBOL" }).success
    ).toBe(false);
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "SYMBOL", symbol: "   " })
        .success
    ).toBe(false);
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "SYMBOL", symbol: "foo" })
        .success
    ).toBe(true);
  });

  it("skips the safe-path check for GLOB", () => {
    expect(
      codePinCreateSchema.safeParse({
        configId: 5,
        kind: "GLOB",
        filePath: "../**/*.ts",
      }).success
    ).toBe(true);
  });

  it("rejects an unsafe path for every non-GLOB kind", () => {
    for (const kind of ["FILE", "RANGE", "SYMBOL"] as const) {
      const result = codePinCreateSchema.safeParse({
        configId: 5,
        kind,
        filePath: "../etc/passwd",
        startLine: 1,
        symbol: "x",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        path: ["filePath"],
        message: "Invalid path",
      });
    }
  });

  it("rejects non-positive ids and lines, and an unknown kind", () => {
    expect(
      codePinCreateSchema.safeParse({ ...base, configId: 0, kind: "FILE" })
        .success
    ).toBe(false);
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "RANGE", startLine: 0 })
        .success
    ).toBe(false);
    expect(
      codePinCreateSchema.safeParse({ ...base, kind: "LINE" }).success
    ).toBe(false);
  });
});

describe("hashSnippet", () => {
  it("is insensitive to indentation and internal whitespace runs", () => {
    expect(hashSnippet("  const a =   1;\n\tconst b = 2;  ")).toBe(
      hashSnippet("const a = 1;\nconst b = 2;")
    );
  });

  it("still distinguishes different content", () => {
    expect(hashSnippet("const a = 1;")).not.toBe(hashSnippet("const a = 2;"));
  });
});

describe("anchorPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveRefToSha as any).mockResolvedValue(TIP);
  });

  it("GLOB: returns an empty anchor and performs no ref or file lookups", async () => {
    const adapter = makeAdapter();

    const anchor = await anchorPin(config, adapter, {
      kind: "GLOB",
      filePath: "src/**/*.ts",
    });

    expect(anchor).toEqual({
      anchorSha: null,
      anchorSnippet: null,
      anchorHash: null,
      startLine: null,
      endLine: null,
    });
    expect(resolveRefToSha).not.toHaveBeenCalled();
    expect(getFileAtCommit).not.toHaveBeenCalled();
    expect(adapter.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("FILE: hashes the whole file and stores no snippet or lines", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const adapter = makeAdapter();

    const anchor = await anchorPin(config, adapter, {
      kind: "FILE",
      filePath: "src/a.ts",
    });

    expect(anchor).toEqual({
      anchorSha: TIP,
      anchorSnippet: null,
      anchorHash: hashSnippet(FUNC_FILE),
      startLine: null,
      endLine: null,
    });
    expect(getFileAtCommit).toHaveBeenCalledWith({
      configId: 5,
      cacheEnabled: true,
      adapter,
      path: "src/a.ts",
      sha: TIP,
    });
  });

  it("resolves the config branch by default, an explicit ref when given, and the default branch as a last resort", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const adapter = makeAdapter();

    await anchorPin(config, adapter, { kind: "FILE", filePath: "src/a.ts" });
    expect(resolveRefToSha).toHaveBeenLastCalledWith(adapter, "main");

    await anchorPin(config, adapter, {
      kind: "FILE",
      filePath: "src/a.ts",
      ref: "release/1.0",
    });
    expect(resolveRefToSha).toHaveBeenLastCalledWith(adapter, "release/1.0");
    expect(adapter.getDefaultBranch).not.toHaveBeenCalled();

    await anchorPin({ ...config, branch: null }, adapter, {
      kind: "FILE",
      filePath: "src/a.ts",
    });
    expect(adapter.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(resolveRefToSha).toHaveBeenLastCalledWith(adapter, "develop");
  });

  it("RANGE: stores the exact lines, their hash, and the resolved range", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const adapter = makeAdapter();

    const anchor = await anchorPin(config, adapter, {
      kind: "RANGE",
      filePath: "src/a.ts",
      startLine: 3,
      endLine: 5,
    });

    const expectedSnippet = "export function foo() {\n  return 1;\n}";
    expect(anchor).toEqual({
      anchorSha: TIP,
      anchorSnippet: expectedSnippet,
      anchorHash: hashSnippet(expectedSnippet),
      startLine: 3,
      endLine: 5,
    });
    // The hash is whitespace-normalized: a reindented copy hashes the same.
    expect(anchor.anchorHash).toBe(
      hashSnippet("export function foo() {\n\t\treturn   1;\n  }")
    );
  });

  it("RANGE: a single line pin defaults endLine to startLine", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });

    const anchor = await anchorPin(config, makeAdapter(), {
      kind: "RANGE",
      filePath: "src/a.ts",
      startLine: 4,
    });

    expect(anchor.startLine).toBe(4);
    expect(anchor.endLine).toBe(4);
    expect(anchor.anchorSnippet).toBe("  return 1;");
  });

  it("RANGE: throws line_out_of_range when the range runs past the file", async () => {
    stubFiles({ "src/a.ts": "one\ntwo\nthree" });

    const promise = anchorPin(config, makeAdapter(), {
      kind: "RANGE",
      filePath: "src/a.ts",
      startLine: 2,
      endLine: 4,
    });

    await expect(promise).rejects.toBeInstanceOf(PinAnchorError);
    await expect(promise).rejects.toMatchObject({
      code: "line_out_of_range",
      message: "File has 3 lines",
    });
  });

  it("SYMBOL: locates the block with locateSymbolBlock and anchors its lines", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });

    const anchor = await anchorPin(config, makeAdapter(), {
      kind: "SYMBOL",
      filePath: "src/a.ts",
      symbol: "foo",
    });

    expect(locateSymbolBlock).toHaveBeenCalledWith(
      FUNC_FILE.split("\n"),
      "foo"
    );
    expect(anchor.startLine).toBe(3);
    expect(anchor.endLine).toBe(5);
    expect(anchor.anchorSnippet).toBe(
      "export function foo() {\n  return 1;\n}"
    );
    expect(anchor.anchorHash).toBe(hashSnippet(anchor.anchorSnippet!));
    expect(anchor.anchorSha).toBe(TIP);
  });

  it("SYMBOL: throws symbol_not_found when the locator finds nothing", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    (locateSymbolBlock as any).mockReturnValueOnce(null);

    const promise = anchorPin(config, makeAdapter(), {
      kind: "SYMBOL",
      filePath: "src/a.ts",
      symbol: "missing",
    });

    await expect(promise).rejects.toBeInstanceOf(PinAnchorError);
    await expect(promise).rejects.toMatchObject({
      code: "symbol_not_found",
      message: "Symbol not found: missing",
    });
  });

  it("maps a 404-ish adapter error to file_not_found", async () => {
    stubFiles({});

    const promise = anchorPin(config, makeAdapter(), {
      kind: "FILE",
      filePath: "src/missing.ts",
    });

    await expect(promise).rejects.toBeInstanceOf(PinAnchorError);
    await expect(promise).rejects.toMatchObject({
      code: "file_not_found",
      message: "File not found: src/missing.ts",
    });
  });

  it("maps a 'not found' message to file_not_found too", async () => {
    stubFiles({ "src/a.ts": new Error("Path not found in repository") });

    await expect(
      anchorPin(config, makeAdapter(), { kind: "FILE", filePath: "src/a.ts" })
    ).rejects.toMatchObject({ code: "file_not_found" });
  });

  it("lets other adapter errors propagate untouched", async () => {
    const boom = new Error("GitHub API error: 403 rate limited");
    stubFiles({ "src/a.ts": boom });

    await expect(
      anchorPin(config, makeAdapter(), { kind: "FILE", filePath: "src/a.ts" })
    ).rejects.toBe(boom);
  });

  it("throws snippet_too_large when the pinned block exceeds MAX_ANCHOR_SNIPPET_BYTES", async () => {
    stubFiles({ "src/big.ts": "x".repeat(MAX_ANCHOR_SNIPPET_BYTES + 1) });

    const promise = anchorPin(config, makeAdapter(), {
      kind: "RANGE",
      filePath: "src/big.ts",
      startLine: 1,
      endLine: 1,
    });

    await expect(promise).rejects.toBeInstanceOf(PinAnchorError);
    await expect(promise).rejects.toMatchObject({ code: "snippet_too_large" });
  });
});

describe("computePinStaleness", () => {
  const basePin: StalenessPinInput = {
    id: 1,
    kind: "RANGE",
    filePath: "src/a.ts",
    startLine: 3,
    endLine: 5,
    symbol: null,
    anchorSha: OLD,
    anchorSnippet: "export function foo() {\n  return 1;\n}",
    staleDismissedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (resolveRefToSha as any).mockResolvedValue(TIP);
  });

  it("returns an empty map and skips every lookup when there are no pins", async () => {
    const adapter = makeAdapter();

    const out = await computePinStaleness(config, adapter, []);

    expect(out.size).toBe(0);
    expect(resolveRefToSha).not.toHaveBeenCalled();
    expect(adapter.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("resolves the branch tip once (config branch, else default branch)", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const adapter = makeAdapter();

    await computePinStaleness(config, adapter, [
      basePin,
      { ...basePin, id: 2 },
    ]);
    expect(resolveRefToSha).toHaveBeenCalledTimes(1);
    expect(resolveRefToSha).toHaveBeenCalledWith(adapter, "main");

    await computePinStaleness({ ...config, branch: null }, adapter, [basePin]);
    expect(adapter.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(resolveRefToSha).toHaveBeenLastCalledWith(adapter, "develop");
  });

  it("marks a pin anchored at the tip fresh without fetching the file", async () => {
    const out = await computePinStaleness(config, makeAdapter(), [
      { ...basePin, anchorSha: TIP },
    ]);

    expect(out.get(1)).toEqual({
      stale: false,
      staleDismissed: false,
      checkedSha: TIP,
    });
    expect(getFileAtCommit).not.toHaveBeenCalled();
  });

  it("always marks GLOB pins fresh without fetching", async () => {
    const out = await computePinStaleness(config, makeAdapter(), [
      { ...basePin, kind: "GLOB", filePath: "src/**", anchorSha: null },
    ]);

    expect(out.get(1)).toEqual({
      stale: false,
      staleDismissed: false,
      checkedSha: TIP,
    });
    expect(getFileAtCommit).not.toHaveBeenCalled();
  });

  it("reports FILE_DELETED when the file is gone at the tip", async () => {
    stubFiles({});

    const out = await computePinStaleness(config, makeAdapter(), [basePin]);

    expect(out.get(1)).toEqual({
      stale: true,
      staleReason: "FILE_DELETED",
      staleDismissed: false,
      checkedSha: TIP,
    });
  });

  it("marks a FILE pin fresh whenever the file still exists", async () => {
    stubFiles({ "src/a.ts": "completely different content" });

    const out = await computePinStaleness(config, makeAdapter(), [
      {
        ...basePin,
        kind: "FILE",
        startLine: null,
        endLine: null,
        anchorSnippet: null,
      },
    ]);

    expect(out.get(1)).toEqual({
      stale: false,
      staleDismissed: false,
      checkedSha: TIP,
    });
    expect(locateSnippet).not.toHaveBeenCalled();
  });

  it("RANGE: reports the current range when the snippet has moved", async () => {
    // Two lines inserted above the block: it now sits at 5-7.
    stubFiles({ "src/a.ts": "// new\n// header\n" + FUNC_FILE });

    const out = await computePinStaleness(config, makeAdapter(), [basePin]);

    expect(locateSnippet).toHaveBeenCalledWith(
      expect.any(Array),
      basePin.anchorSnippet!.split("\n"),
      3
    );
    expect(out.get(1)).toEqual({
      stale: false,
      staleDismissed: false,
      checkedSha: TIP,
      currentRange: [5, 7],
    });
  });

  it("RANGE: reports SNIPPET_NOT_FOUND when the snippet cannot be located", async () => {
    stubFiles({ "src/a.ts": "nothing like the snippet\nat all" });

    const out = await computePinStaleness(config, makeAdapter(), [basePin]);

    expect(out.get(1)).toEqual({
      stale: true,
      staleReason: "SNIPPET_NOT_FOUND",
      staleDismissed: false,
      checkedSha: TIP,
    });
  });

  it("SYMBOL: reports the current block, or SYMBOL_NOT_FOUND", async () => {
    stubFiles({ "src/a.ts": "// moved\n" + FUNC_FILE });
    const symbolPin: StalenessPinInput = {
      ...basePin,
      kind: "SYMBOL",
      symbol: "foo",
      anchorSnippet: null,
    };

    const found = await computePinStaleness(config, makeAdapter(), [symbolPin]);
    expect(locateSymbolBlock).toHaveBeenCalledWith(expect.any(Array), "foo");
    expect(found.get(1)).toEqual({
      stale: false,
      staleDismissed: false,
      checkedSha: TIP,
      currentRange: [4, 6],
    });

    const missing = await computePinStaleness(config, makeAdapter(), [
      { ...symbolPin, symbol: "gone" },
    ]);
    expect(missing.get(1)).toEqual({
      stale: true,
      staleReason: "SYMBOL_NOT_FOUND",
      staleDismissed: false,
      checkedSha: TIP,
    });
  });

  it("passes staleDismissed through on stale pins only", async () => {
    stubFiles({ "src/a.ts": "no match here", "src/b.ts": FUNC_FILE });

    const out = await computePinStaleness(config, makeAdapter(), [
      { ...basePin, id: 1, staleDismissedAt: new Date("2026-01-01") },
      {
        ...basePin,
        id: 2,
        filePath: "src/b.ts",
        staleDismissedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    expect(out.get(1)).toMatchObject({
      stale: true,
      staleReason: "SNIPPET_NOT_FOUND",
      staleDismissed: true,
    });
    // A fresh pin never reports a dismissal, even if one is recorded.
    expect(out.get(2)).toMatchObject({ stale: false, staleDismissed: false });
  });

  it("fetches each path once across many pins", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE, "src/b.ts": FUNC_FILE });

    await computePinStaleness(config, makeAdapter(), [
      { ...basePin, id: 1 },
      {
        ...basePin,
        id: 2,
        startLine: 4,
        endLine: 4,
        anchorSnippet: "  return 1;",
      },
      { ...basePin, id: 3, kind: "FILE", anchorSnippet: null },
      { ...basePin, id: 4, filePath: "src/b.ts" },
    ]);

    expect(getFileAtCommit).toHaveBeenCalledTimes(2);
    const paths = (getFileAtCommit as any).mock.calls.map(
      (c: any[]) => c[0].path
    );
    expect(paths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("stops checking after MAX_STALENESS_CHECKS and leaves later pins unmarked", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const pins: StalenessPinInput[] = Array.from(
      { length: MAX_STALENESS_CHECKS + 2 },
      (_, i) => ({ ...basePin, id: i + 1 })
    );

    const out = await computePinStaleness(config, makeAdapter(), pins);

    expect(out.size).toBe(MAX_STALENESS_CHECKS);
    expect(out.has(MAX_STALENESS_CHECKS)).toBe(true);
    expect(out.has(MAX_STALENESS_CHECKS + 1)).toBe(false);
    expect(out.has(MAX_STALENESS_CHECKS + 2)).toBe(false);
  });

  it("does not count tip-anchored or GLOB pins toward the cap", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    const cheap: StalenessPinInput[] = Array.from(
      { length: MAX_STALENESS_CHECKS },
      (_, i) =>
        i % 2 === 0
          ? { ...basePin, id: i + 1, anchorSha: TIP }
          : { ...basePin, id: i + 1, kind: "GLOB", anchorSha: null }
    );
    const checked: StalenessPinInput = { ...basePin, id: 1000 };

    const out = await computePinStaleness(config, makeAdapter(), [
      ...cheap,
      checked,
    ]);

    expect(out.size).toBe(MAX_STALENESS_CHECKS + 1);
    expect(out.get(1000)).toMatchObject({ stale: false, currentRange: [3, 5] });
  });

  it("leaves a pin unmarked when the provider fails for a non-404 reason, and keeps going", async () => {
    stubFiles({
      "src/a.ts": new Error("GitHub API error: 503 unavailable"),
      "src/b.ts": FUNC_FILE,
    });

    const out = await computePinStaleness(config, makeAdapter(), [
      { ...basePin, id: 1 },
      { ...basePin, id: 2, filePath: "src/b.ts" },
    ]);

    expect(out.has(1)).toBe(false);
    expect(out.get(2)).toMatchObject({ stale: false, currentRange: [3, 5] });
  });
});
