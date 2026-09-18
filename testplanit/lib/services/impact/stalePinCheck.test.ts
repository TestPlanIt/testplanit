import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repoAccess", () => ({
  loadRepoConfigForWorker: vi.fn(),
}));
vi.mock("./compareService", () => ({
  resolveRefToSha: vi.fn(),
}));
vi.mock("./fileAtCommit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fileAtCommit")>();
  return { ...actual, getFileAtCommit: vi.fn() };
});
vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

import { resolveRefToSha } from "./compareService";
import { getFileAtCommit } from "./fileAtCommit";
import { loadRepoConfigForWorker } from "./repoAccess";
import {
  checkStalePins,
  MANAGED_PIN_SOURCES,
  removableStalePinsWhere,
} from "./stalePinCheck";

const TIP = "f".repeat(40);
const OLD = "0".repeat(40);
const NOW = new Date("2026-09-18T10:00:00Z");

const config = {
  id: 5,
  projectId: 1,
  purpose: "IMPACT",
  branch: "main",
  cacheEnabled: true,
  repositoryId: 9,
  repository: { id: 9, name: "acme/app", provider: "github", settings: null },
};

const FUNC_FILE = [
  "import x from 'y';",
  "",
  "export function foo() {",
  "  return 1;",
  "}",
].join("\n");

function makeDb() {
  return {
    projectCodeRepositoryConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    repositoryCaseCodePin: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
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

function pin(overrides: Record<string, unknown>) {
  return {
    id: 1,
    kind: "RANGE",
    filePath: "src/a.ts",
    startLine: 3,
    symbol: null,
    anchorSha: OLD,
    anchorSnippet: "export function foo() {\n  return 1;\n}",
    source: "MANUAL",
    staleDismissedAt: null,
    ...overrides,
  };
}

/** The `data` each updateMany wrote, keyed by pin id. */
function writtenVerdicts(db: ReturnType<typeof makeDb>) {
  const out = new Map<number, string | null>();
  for (const call of db.repositoryCaseCodePin.updateMany.mock.calls) {
    for (const id of call[0].where.id.in) out.set(id, call[0].data.staleReason);
  }
  return out;
}

describe("checkStalePins", () => {
  let db: ReturnType<typeof makeDb>;
  const adapter = { getDefaultBranch: vi.fn().mockResolvedValue("develop") };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db = makeDb();
    (loadRepoConfigForWorker as any).mockResolvedValue({ config, adapter });
    (resolveRefToSha as any).mockResolvedValue(TIP);
  });

  it("flags each pin with why it was not found and stamps fresh ones", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE, "src/keep.ts": "const k = 1;" });
    db.repositoryCaseCodePin.findMany.mockResolvedValue([
      pin({ id: 1 }),
      pin({ id: 2, anchorSnippet: "nothing like this" }),
      pin({ id: 3, kind: "SYMBOL", symbol: "bar", anchorSnippet: null }),
      pin({
        id: 4,
        kind: "FILE",
        filePath: "src/gone.ts",
        anchorSnippet: null,
      }),
      pin({
        id: 5,
        kind: "FILE",
        filePath: "src/keep.ts",
        anchorSnippet: null,
      }),
      pin({ id: 6, kind: "GLOB", filePath: "src/**", anchorSha: null }),
      pin({ id: 7, kind: "FILE", filePath: "src/tip.ts", anchorSha: TIP }),
    ]);

    const report = await checkStalePins(5, db as any, { now: () => NOW });

    expect(loadRepoConfigForWorker).toHaveBeenCalledWith(db, 5, {
      purpose: "IMPACT",
    });
    expect(resolveRefToSha).toHaveBeenCalledWith(adapter, "main");
    // One read per distinct path; GLOB pins and pins anchored at the tip skip it.
    expect(
      (getFileAtCommit as any).mock.calls.map((c: any) => c[0].path)
    ).toEqual(["src/a.ts", "src/gone.ts", "src/keep.ts"]);
    expect(writtenVerdicts(db)).toEqual(
      new Map([
        [1, null],
        [2, "SNIPPET_NOT_FOUND"],
        [3, "SYMBOL_NOT_FOUND"],
        [4, "FILE_DELETED"],
        [5, null],
        [6, null],
        [7, null],
      ])
    );
    for (const call of db.repositoryCaseCodePin.updateMany.mock.calls) {
      expect(call[0].data.staleCheckedAt).toEqual(NOW);
    }
    expect(report).toEqual({
      checkedAt: NOW.toISOString(),
      checkedSha: TIP,
      pins: 7,
      checked: 7,
      stale: 3,
      dismissed: 0,
      managed: 0,
      unreadableFiles: 0,
      byReason: { FILE_DELETED: 1, SNIPPET_NOT_FOUND: 1, SYMBOL_NOT_FOUND: 1 },
    });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { stalePinReport: report },
    });
  });

  it("marks the config running before reading, with the file total", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    db.repositoryCaseCodePin.findMany.mockResolvedValue([
      pin({ id: 1 }),
      pin({ id: 2 }),
    ]);

    await checkStalePins(5, db as any, { now: () => NOW });

    expect(db.projectCodeRepositoryConfig.update).toHaveBeenNthCalledWith(1, {
      where: { id: 5 },
      data: {
        stalePinReport: {
          running: true,
          startedAt: NOW.toISOString(),
          progressAt: NOW.toISOString(),
          checkedFiles: 0,
          totalFiles: 1,
          pins: 2,
        },
      },
    });
  });

  it("counts dismissed and repository-managed flags apart from removable ones", async () => {
    stubFiles({});
    db.repositoryCaseCodePin.findMany.mockResolvedValue([
      pin({ id: 1, kind: "FILE", anchorSnippet: null }),
      pin({
        id: 2,
        kind: "FILE",
        anchorSnippet: null,
        staleDismissedAt: new Date(),
      }),
      pin({ id: 3, kind: "FILE", anchorSnippet: null, source: "ANNOTATION" }),
      pin({ id: 4, kind: "FILE", anchorSnippet: null, source: "MAPFILE" }),
      pin({ id: 5, kind: "FILE", anchorSnippet: null, source: "ISSUE" }),
    ]);

    const report = await checkStalePins(5, db as any, { now: () => NOW });

    expect(report).toMatchObject({
      stale: 2,
      dismissed: 1,
      managed: 2,
      byReason: { FILE_DELETED: 5 },
    });
  });

  it("leaves pins in unreadable files untouched and says so", async () => {
    stubFiles({
      "src/a.ts": FUNC_FILE,
      "src/big.ts": new Error("File too large: src/big.ts (9999999 bytes)"),
    });
    db.repositoryCaseCodePin.findMany.mockResolvedValue([
      pin({ id: 1 }),
      pin({ id: 2, kind: "FILE", filePath: "src/big.ts", anchorSnippet: null }),
    ]);

    const report = await checkStalePins(5, db as any, { now: () => NOW });

    expect(writtenVerdicts(db)).toEqual(new Map([[1, null]]));
    expect(report).toMatchObject({
      pins: 2,
      checked: 1,
      unreadableFiles: 1,
      stale: 0,
    });
  });

  it("retries a rate-limited read before giving up on the file", async () => {
    let attempts = 0;
    (getFileAtCommit as any).mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error("GitHub API error: 429 rate limit");
      return { content: FUNC_FILE, cached: false };
    });
    db.repositoryCaseCodePin.findMany.mockResolvedValue([pin({ id: 1 })]);

    const report = await checkStalePins(5, db as any, {
      now: () => NOW,
      retryDelayMs: 0,
    });

    expect(attempts).toBe(3);
    expect(report).toMatchObject({ checked: 1, unreadableFiles: 0 });
    expect(writtenVerdicts(db)).toEqual(new Map([[1, null]]));
  });

  it("uses the repository default branch when the connection names none", async () => {
    (loadRepoConfigForWorker as any).mockResolvedValue({
      config: { ...config, branch: null },
      adapter,
    });
    stubFiles({});

    await checkStalePins(5, db as any, { now: () => NOW });

    expect(resolveRefToSha).toHaveBeenCalledWith(adapter, "develop");
  });

  it("stores an error report instead of throwing", async () => {
    (loadRepoConfigForWorker as any).mockResolvedValue(null);

    const report = await checkStalePins(5, db as any, { now: () => NOW });

    expect(report).toEqual({
      error: "Impact connection 5 not found",
      checkedAt: NOW.toISOString(),
    });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { stalePinReport: report },
    });
  });

  it("writes verdicts in bounded batches", async () => {
    stubFiles({ "src/a.ts": FUNC_FILE });
    db.repositoryCaseCodePin.findMany.mockResolvedValue(
      Array.from({ length: 1200 }, (_, i) => pin({ id: i + 1 }))
    );

    await checkStalePins(5, db as any, { now: () => NOW });

    const sizes = db.repositoryCaseCodePin.updateMany.mock.calls.map(
      (call) => call[0].where.id.in.length
    );
    expect(sizes).toEqual([500, 500, 200]);
  });
});

describe("removableStalePinsWhere", () => {
  it("selects live flagged pins that are neither dismissed nor repository-managed", () => {
    expect(removableStalePinsWhere(5)).toEqual({
      configId: 5,
      isDeleted: false,
      staleReason: { not: null },
      staleDismissedAt: null,
      source: { notIn: [...MANAGED_PIN_SOURCES] },
    });
  });
});
