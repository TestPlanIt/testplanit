import { describe, expect, it, vi } from "vitest";
import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
import type { CommitFiles } from "./commitFiles";
import {
  listRecentCommits,
  syncIssuePins,
  type IssueScanDb,
} from "./issueScan";

const NOW = new Date("2026-09-12T00:00:00Z");
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

describe("listRecentCommits", () => {
  it("pages until the provider runs out, newest first", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValueOnce({
        commits: [commit(SHA_NEW, "a")],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        commits: [commit(SHA_OLD, "b")],
        hasMore: false,
      });

    const out = await listRecentCommits({ listCommits }, "main", {
      lookbackDays: 90,
      maxCommits: 300,
      now: NOW,
    });

    expect(listCommits).toHaveBeenNthCalledWith(1, "main", {
      page: 1,
      perPage: 100,
    });
    expect(listCommits).toHaveBeenNthCalledWith(2, "main", {
      page: 2,
      perPage: 100,
    });
    expect(out.commits.map((c) => c.sha)).toEqual([SHA_NEW, SHA_OLD]);
    expect(out.truncated).toBe(false);
  });

  it("stops at the first commit older than the lookback without marking truncation", async () => {
    const listCommits = vi.fn().mockResolvedValue({
      commits: [
        commit(SHA_NEW, "a", "2026-09-10T00:00:00Z"),
        commit(SHA_OLD, "b", "2026-01-01T00:00:00Z"),
        commit(SHA_OTHER, "c", "2025-12-01T00:00:00Z"),
      ],
      hasMore: true,
    });

    const out = await listRecentCommits({ listCommits }, "main", {
      lookbackDays: 90,
      maxCommits: 300,
      now: NOW,
    });

    expect(out.commits.map((c) => c.sha)).toEqual([SHA_NEW]);
    expect(out.truncated).toBe(false);
    expect(listCommits).toHaveBeenCalledTimes(1);
  });

  it("marks the walk truncated when the commit cap stops it", async () => {
    const listCommits = vi.fn().mockResolvedValue({
      commits: [commit(SHA_NEW, "a"), commit(SHA_OLD, "b")],
      hasMore: true,
    });

    const out = await listRecentCommits({ listCommits }, "main", {
      lookbackDays: 90,
      maxCommits: 1,
      now: NOW,
    });

    expect(out.commits).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });
});

interface Row {
  id: number;
  caseId: number;
  filePath: string;
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
      findMany: vi.fn().mockResolvedValue(pins),
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
          kind: "FILE",
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

  it("keeps a matching ISSUE pin, re-anchors one whose commit changed, and removes one that aged out", async () => {
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
      data: { anchorSha: SHA_NEW, note: "PROJ-9" },
    });
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3] } },
      data: { isDeleted: true, deletedAt: expect.any(Date) },
    });
    expect(report).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
      removed: 1,
    });
  });

  it("keeps existing pins when the commit walk was cut short", async () => {
    const rows: Row[] = [
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
      truncated: true,
    });

    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
    expect(report.removed).toBe(0);
    expect(report.truncated).toBe(true);
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
});
