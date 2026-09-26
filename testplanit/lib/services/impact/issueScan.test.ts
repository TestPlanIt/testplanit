import { describe, expect, it, vi } from "vitest";
import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
import type { CommitFiles } from "./commitFiles";
import { syncIssuePins, type IssueScanDb } from "./issueScan";

const SHA_NEW = "a".repeat(40);
const SHA_OLD = "b".repeat(40);
const SHA_OTHER = "c".repeat(40);

function commit(
  sha: string,
  message: string,
  authoredAt = "2026-09-10T00:00:00Z"
): RepoCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    authorName: "dev",
    authoredAt,
    parents: ["0".repeat(40)],
  };
}

interface Row {
  id: number;
  caseId: number;
  filePath: string;
  kind?: string;
  symbol?: string | null;
  source: string;
  anchorSha: string | null;
  note: string | null;
  isDeleted: boolean;
}

function makeDb(
  issues: Array<{ id: number; externalKey: string | null }>,
  links: Array<{ caseId: number; issueId: number }>,
  pins: Row[] = []
) {
  return {
    issue: { findMany: vi.fn().mockResolvedValue(issues) },
    repositoryCaseIssue: { findMany: vi.fn().mockResolvedValue(links) },
    repositoryCaseCodePin: {
      // Older fixtures describe whole-file pins; fill in what the scan reads.
      findMany: vi
        .fn()
        .mockResolvedValue(
          pins.map((pin) => ({ kind: "FILE", symbol: null, ...pin }))
        ),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
  } satisfies IssueScanDb;
}

const CONFIG = { id: 7, projectId: 1 };
const LINKED = {
  issues: [{ id: 30, externalKey: "PROJ-9" }],
  links: [{ caseId: 22, issueId: 30 }],
};

function files(paths: string[], capped = false): CommitFiles {
  return { paths, capped };
}

function sync(
  db: ReturnType<typeof makeDb>,
  commits: RepoCommit[],
  overrides: Partial<Parameters<typeof syncIssuePins>[2]> = {}
) {
  return syncIssuePins(db, CONFIG, {
    commits,
    truncated: false,
    getCommitFiles: vi.fn().mockResolvedValue(files(["src/a.ts"])),
    maxCommitFetches: 10,
    maxFilesPerCommit: 50,
    actorId: "owner",
    ...overrides,
  });
}

function created(db: ReturnType<typeof makeDb>) {
  return db.repositoryCaseCodePin.createMany.mock.calls.flatMap(
    ([args]: any[]) => args.data
  );
}

describe("syncIssuePins", () => {
  it("creates whole-file ISSUE pins for the source files a ticket commit touched", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const getCommitFiles = vi
      .fn()
      .mockResolvedValue(
        files([
          "src/a.ts",
          "config/app.yml",
          "src/a.test.ts",
          "docs/readme.md",
          "pnpm-lock.yaml",
          "logo.png",
        ])
      );

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9 fix")], {
      getCommitFiles,
    });

    expect(created(db)).toEqual([
      {
        caseId: 22,
        configId: 7,
        kind: "FILE",
        symbol: null,
        filePath: "src/a.ts",
        anchorSha: SHA_NEW,
        source: "ISSUE",
        note: "PROJ-9",
        createdById: "owner",
      },
      expect.objectContaining({ filePath: "config/app.yml" }),
    ]);
    expect(report).toMatchObject({
      scannedCommits: 1,
      matchedCommits: 1,
      issues: 1,
      created: 2,
      updated: 0,
      removed: 0,
      unchanged: 0,
      skippedLargeCommits: 0,
      fetchCapped: false,
      truncated: false,
    });
    expect(db.repositoryCaseCodePin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          configId: 7,
          kind: { in: ["FILE", "SYMBOL"] },
          OR: [{ isDeleted: false }, { source: "ISSUE" }],
        },
      })
    );
  });

  it("does nothing beyond the report when no commit names a linked ticket", async () => {
    const db = makeDb([], []);
    const report = await sync(db, [commit(SHA_NEW, "tidy")]);
    expect(report).toMatchObject({ scannedCommits: 1, matchedCommits: 0 });
    expect(db.issue.findMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
  });

  it("lets the newest commit claim a file and skips commits that are too large or capped", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const getCommitFiles = vi
      .fn()
      .mockResolvedValueOnce(files(["src/a.ts"]))
      .mockResolvedValueOnce(files(["src/a.ts", "src/b.ts", "src/c.ts"]))
      .mockResolvedValueOnce(files(["src/d.ts"], true));

    const report = await sync(
      db,
      [
        commit(SHA_NEW, "PROJ-9 newest"),
        commit(SHA_OLD, "PROJ-9 older"),
        commit(SHA_OTHER, "PROJ-9 capped"),
      ],
      { getCommitFiles, maxFilesPerCommit: 2 }
    );

    expect(created(db).map((p: any) => [p.filePath, p.anchorSha])).toEqual([
      ["src/a.ts", SHA_NEW],
    ]);
    expect(report.skippedLargeCommits).toBe(2);
  });

  it("stops reading commits at the fetch cap and keeps existing pins", async () => {
    const stale: Row = {
      id: 1,
      caseId: 22,
      filePath: "src/gone.ts",
      source: "ISSUE",
      anchorSha: SHA_OTHER,
      note: "PROJ-9",
      isDeleted: false,
    };
    const db = makeDb(LINKED.issues, LINKED.links, [stale]);
    const getCommitFiles = vi.fn().mockResolvedValue(files(["src/a.ts"]));

    const report = await sync(
      db,
      [commit(SHA_NEW, "PROJ-9 a"), commit(SHA_OLD, "PROJ-9 b")],
      { getCommitFiles, maxCommitFetches: 1 }
    );

    expect(getCommitFiles).toHaveBeenCalledTimes(1);
    expect(report.fetchCapped).toBe(true);
    expect(report.removed).toBe(0);
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a matching ISSUE pin, re-anchors one whose commit changed, and leaves one anchored before the walk alone", async () => {
    const rows: Row[] = [
      {
        id: 1,
        caseId: 22,
        filePath: "src/a.ts",
        source: "ISSUE",
        anchorSha: SHA_NEW,
        note: "PROJ-9",
        isDeleted: false,
      },
      {
        id: 2,
        caseId: 22,
        filePath: "src/b.ts",
        source: "ISSUE",
        anchorSha: SHA_OLD,
        note: "PROJ-9",
        isDeleted: false,
      },
      {
        id: 3,
        caseId: 22,
        filePath: "src/gone.ts",
        source: "ISSUE",
        anchorSha: SHA_OLD,
        note: "PROJ-9",
        isDeleted: false,
      },
    ];
    const db = makeDb(LINKED.issues, LINKED.links, rows);

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
      getCommitFiles: vi
        .fn()
        .mockResolvedValue(files(["src/a.ts", "src/b.ts"])),
    });

    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: {
        anchorSha: SHA_NEW,
        note: "PROJ-9",
        staleCheckedAt: null,
        staleReason: null,
      },
    });
    // SHA_OLD was never walked: a recent-window scan cannot judge that pin.
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
      removed: 0,
      full: false,
    });
  });

  it("removes a pin whose walked commit no longer yields it, even when the walk was cut short", async () => {
    const rows: Row[] = [
      {
        id: 3,
        caseId: 22,
        filePath: "src/gone.ts",
        source: "ISSUE",
        anchorSha: SHA_NEW,
        note: "PROJ-9",
        isDeleted: false,
      },
      {
        id: 4,
        caseId: 22,
        filePath: "src/older.ts",
        source: "ISSUE",
        anchorSha: SHA_OLD,
        note: "PROJ-9",
        isDeleted: false,
      },
    ];
    const db = makeDb(LINKED.issues, LINKED.links, rows);

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
      truncated: true,
    });

    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3] } },
      data: { isDeleted: true },
    });
    expect(report.removed).toBe(1);
    expect(report.truncated).toBe(true);
  });

  it("keeps pins of matched commits the fetch cap left unread", async () => {
    const rows: Row[] = [
      {
        id: 5,
        caseId: 22,
        filePath: "src/capped.ts",
        source: "ISSUE",
        anchorSha: SHA_OLD,
        note: "PROJ-9",
        isDeleted: false,
      },
    ];
    const db = makeDb(LINKED.issues, LINKED.links, rows);

    const report = await sync(
      db,
      [commit(SHA_NEW, "PROJ-9"), commit(SHA_OLD, "PROJ-9")],
      { maxCommitFetches: 1 }
    );

    expect(report.fetchCapped).toBe(true);
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report.removed).toBe(0);
  });

  it("removes pins whose commit an uncut full scan never met", async () => {
    const rows: Row[] = [
      {
        id: 6,
        caseId: 22,
        filePath: "src/rebased-away.ts",
        source: "ISSUE",
        anchorSha: SHA_OTHER,
        note: "PROJ-9",
        isDeleted: false,
      },
    ];
    const db = makeDb(LINKED.issues, LINKED.links, rows);

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
      full: true,
    });

    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [6] } },
      data: { isDeleted: true },
    });
    expect(report).toMatchObject({ removed: 1, full: true });
  });

  it("keeps unmet pins when a full scan was cut short by the commit cap", async () => {
    const rows: Row[] = [
      {
        id: 6,
        caseId: 22,
        filePath: "src/deep-history.ts",
        source: "ISSUE",
        anchorSha: SHA_OTHER,
        note: "PROJ-9",
        isDeleted: false,
      },
    ];
    const db = makeDb(LINKED.issues, LINKED.links, rows);

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
      full: true,
      truncated: true,
    });

    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report.removed).toBe(0);
  });

  it("imports the named tickets before resolving them and reports the counts", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const importIssues = vi.fn().mockResolvedValue({
      imported: 2,
      failed: 1,
      skipped: 4,
      failures: [{ key: "PROJ-10", error: "tracked by project 4" }],
    });

    const report = await sync(
      db,
      [commit(SHA_NEW, "PROJ-9 and PROJ-10"), commit(SHA_OLD, "PROJ-10")],
      { importIssues }
    );

    expect(importIssues).toHaveBeenCalledTimes(1);
    const tokens = importIssues.mock.calls[0][0];
    expect(tokens.map((t: { exact: string[] }) => t.exact[0])).toEqual([
      "PROJ-9",
      "PROJ-10",
    ]);
    expect(importIssues.mock.invocationCallOrder[0]).toBeLessThan(
      db.issue.findMany.mock.invocationCallOrder[0]
    );
    expect(report).toMatchObject({
      importedIssues: 2,
      importFailures: 1,
      importSkipped: 4,
      importFailureDetails: [{ key: "PROJ-10", error: "tracked by project 4" }],
      commitsNamingTickets: 2,
      namedTickets: 2,
    });
  });

  it("counts commits that name any ticket apart from those that name a linked one", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);

    const report = await sync(db, [
      commit(SHA_NEW, "PROJ-9 and PROJ-10"),
      commit(SHA_OLD, "OTHER-1"),
      commit(SHA_OTHER, "tidy up"),
    ]);

    expect(report).toMatchObject({
      scannedCommits: 3,
      commitsNamingTickets: 2,
      namedTickets: 3,
      matchedCommits: 1,
    });
  });

  it("does not call the importer when no commit names a ticket", async () => {
    const db = makeDb([], []);
    const importIssues = vi.fn();

    await sync(db, [commit(SHA_NEW, "tidy up")], { importIssues });

    expect(importIssues).not.toHaveBeenCalled();
  });

  it("reports progress as matched commits are read", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const onProgress = vi.fn();

    await sync(db, [commit(SHA_NEW, "PROJ-9")], { onProgress });

    expect(onProgress).toHaveBeenCalledWith({
      stage: "inspect",
      scannedCommits: 1,
      cachedCommits: 0,
      matchedCommits: 1,
      fetchedCommits: 0,
      importLookups: 0,
      importedIssues: 0,
    });
  });

  it("reports the import stage with the importer's counts before inspecting", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const onProgress = vi.fn();
    const importIssues = vi.fn(
      async (
        _tokens: unknown,
        report: (p: { lookups: number; imported: number }) => Promise<void>
      ) => {
        await report({ lookups: 5, imported: 2 });
        return { imported: 2, failed: 3 };
      }
    );

    await sync(db, [commit(SHA_NEW, "PROJ-9")], { onProgress, importIssues });

    const stages = onProgress.mock.calls.map(([p]) => p.stage);
    expect(stages).toEqual(["import", "import", "inspect"]);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "import",
        importLookups: 5,
        importedIssues: 2,
      })
    );
  });

  it("yields to a pin of another source on the same file and never touches it", async () => {
    const manual: Row = {
      id: 5,
      caseId: 22,
      filePath: "src/a.ts",
      source: "MANUAL",
      anchorSha: null,
      note: null,
      isDeleted: false,
    };
    const db = makeDb(LINKED.issues, LINKED.links, [manual]);

    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")]);

    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.update).not.toHaveBeenCalled();
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 0 });
  });

  it("does not recreate a derived pin the user removed for the same commit, but does for a newer one", async () => {
    const removed: Row = {
      id: 8,
      caseId: 22,
      filePath: "src/a.ts",
      source: "ISSUE",
      anchorSha: SHA_OLD,
      note: "PROJ-9",
      isDeleted: true,
    };
    const db = makeDb(LINKED.issues, LINKED.links, [removed]);

    await sync(db, [commit(SHA_OLD, "PROJ-9")]);
    expect(db.repositoryCaseCodePin.createMany).not.toHaveBeenCalled();

    await sync(db, [commit(SHA_NEW, "PROJ-9 again")]);
    expect(created(db).map((p: any) => p.anchorSha)).toEqual([SHA_NEW]);
  });

  it("skips a root commit whose files cannot be read", async () => {
    const db = makeDb(LINKED.issues, LINKED.links);
    const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
      getCommitFiles: vi.fn().mockResolvedValue(null),
    });
    expect(report).toMatchObject({ matchedCommits: 1, created: 0 });
  });

  describe("symbol pins", () => {
    const withSymbols = (): CommitFiles => ({
      paths: ["src/a.ts", "src/b.ts"],
      capped: false,
      symbolsByPath: { "src/a.ts": ["login", "LoginForm"] },
    });

    it("pins the declarations a commit's patch touched, and the whole file where it names none", async () => {
      const db = makeDb(LINKED.issues, LINKED.links);

      const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
        getCommitFiles: vi.fn().mockResolvedValue(withSymbols()),
        symbolPins: true,
      });

      expect(
        created(db).map((p: any) => [p.kind, p.filePath, p.symbol])
      ).toEqual([
        ["SYMBOL", "src/a.ts", "login"],
        ["SYMBOL", "src/a.ts", "LoginForm"],
        ["FILE", "src/b.ts", null],
      ]);
      expect(report).toMatchObject({ created: 3, createdSymbolPins: 2 });
    });

    it("ignores patch symbols while symbol pins are off", async () => {
      const db = makeDb(LINKED.issues, LINKED.links);

      const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
        getCommitFiles: vi.fn().mockResolvedValue(withSymbols()),
        symbolPins: false,
      });

      expect(created(db).map((p: any) => [p.kind, p.filePath])).toEqual([
        ["FILE", "src/a.ts"],
        ["FILE", "src/b.ts"],
      ]);
      expect(report.createdSymbolPins).toBe(0);
    });

    it("lets the newest commit settle a file, so an older whole-file claim is not added", async () => {
      const db = makeDb(LINKED.issues, LINKED.links);
      const getCommitFiles = vi
        .fn()
        .mockResolvedValueOnce(withSymbols())
        .mockResolvedValueOnce(files(["src/a.ts"]));

      await sync(
        db,
        [commit(SHA_NEW, "PROJ-9 newest"), commit(SHA_OLD, "PROJ-9 older")],
        { getCommitFiles, symbolPins: true }
      );

      const aPins = created(db).filter((p: any) => p.filePath === "src/a.ts");
      expect(aPins.map((p: any) => p.kind)).toEqual(["SYMBOL", "SYMBOL"]);
      expect(aPins.every((p: any) => p.anchorSha === SHA_NEW)).toBe(true);
    });

    it("yields to the user's own pin on the file, whatever its kind", async () => {
      const manual: Row = {
        id: 5,
        caseId: 22,
        filePath: "src/a.ts",
        kind: "RANGE",
        source: "MANUAL",
        anchorSha: SHA_OLD,
        note: null,
        isDeleted: false,
      };
      const db = makeDb(LINKED.issues, LINKED.links, [manual]);

      await sync(db, [commit(SHA_NEW, "PROJ-9")], {
        getCommitFiles: vi.fn().mockResolvedValue(withSymbols()),
        symbolPins: true,
      });

      expect(created(db).map((p: any) => p.filePath)).toEqual(["src/b.ts"]);
      expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    });

    it("replaces an older whole-file ticket pin with symbol pins once the patch names declarations", async () => {
      const whole: Row = {
        id: 8,
        caseId: 22,
        filePath: "src/a.ts",
        kind: "FILE",
        source: "ISSUE",
        anchorSha: SHA_NEW,
        note: "PROJ-9",
        isDeleted: false,
      };
      const db = makeDb(LINKED.issues, LINKED.links, [whole]);

      const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
        getCommitFiles: vi.fn().mockResolvedValue(withSymbols()),
        symbolPins: true,
      });

      expect(created(db).map((p: any) => [p.kind, p.symbol])).toEqual([
        ["SYMBOL", "login"],
        ["SYMBOL", "LoginForm"],
        ["FILE", null],
      ]);
      expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [8] } },
        data: { isDeleted: true },
      });
      expect(report.removed).toBe(1);
    });

    it("keeps a matching symbol pin and does not recreate one the user removed for the same commit", async () => {
      const rows: Row[] = [
        {
          id: 1,
          caseId: 22,
          filePath: "src/a.ts",
          kind: "SYMBOL",
          symbol: "login",
          source: "ISSUE",
          anchorSha: SHA_NEW,
          note: "PROJ-9",
          isDeleted: false,
        },
        {
          id: 2,
          caseId: 22,
          filePath: "src/a.ts",
          kind: "SYMBOL",
          symbol: "LoginForm",
          source: "ISSUE",
          anchorSha: SHA_NEW,
          note: "PROJ-9",
          isDeleted: true,
        },
      ];
      const db = makeDb(LINKED.issues, LINKED.links, rows);

      const report = await sync(db, [commit(SHA_NEW, "PROJ-9")], {
        getCommitFiles: vi.fn().mockResolvedValue(withSymbols()),
        symbolPins: true,
      });

      expect(created(db).map((p: any) => [p.kind, p.filePath])).toEqual([
        ["FILE", "src/b.ts"],
      ]);
      expect(report).toMatchObject({ unchanged: 1, created: 1 });
    });
  });
});
