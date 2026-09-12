import { describe, expect, it, vi } from "vitest";
import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
import { runIssueLayer } from "./issueLayer";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function commit(sha: string, message: string): RepoCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    authorName: "dev",
    authoredAt: "2026-09-01T00:00:00Z",
    parents: ["0".repeat(40)],
  };
}

function makeDb(
  issues: Array<{ id: number; externalKey: string | null }>,
  links: Array<{ caseId: number; issueId: number }>
) {
  return {
    issue: { findMany: vi.fn().mockResolvedValue(issues) },
    repositoryCaseIssue: { findMany: vi.fn().mockResolvedValue(links) },
  };
}

const CHANGED = ["src/a.ts", "src/b.ts", "src/c.ts"];

function run(
  db: ReturnType<typeof makeDb>,
  commits: RepoCommit[],
  overrides: Partial<Parameters<typeof runIssueLayer>[1]> = {}
) {
  return runIssueLayer(db, {
    projectId: 1,
    commits,
    changedPaths: CHANGED,
    maxCommitFetches: 10,
    getCommitFiles: vi.fn().mockResolvedValue(["src/a.ts", "other.ts"]),
    ...overrides,
  });
}

describe("runIssueLayer", () => {
  it("selects nothing and skips the database when no commit names a ticket", async () => {
    const db = makeDb([], []);
    const out = await run(db, [commit(SHA_A, "refactor")]);
    expect(out.layer.size).toBe(0);
    expect(db.issue.findMany).not.toHaveBeenCalled();
    expect(await run(db, [])).toMatchObject({ issueCount: 0 });
  });

  it("scores linked cases at 90 with the commit's changed files, intersected with the range", async () => {
    const db = makeDb(
      [{ id: 30, externalKey: "PROJ-9" }],
      [
        { caseId: 22, issueId: 30 },
        { caseId: 23, issueId: 30 },
      ]
    );
    const getCommitFiles = vi
      .fn()
      .mockResolvedValue(["src/a.ts", "not/in/range.ts"]);

    const out = await run(
      db,
      [commit(SHA_A, "chore"), commit(SHA_B, "PROJ-9 fix")],
      { getCommitFiles }
    );

    expect(getCommitFiles).toHaveBeenCalledTimes(1);
    expect(getCommitFiles.mock.calls[0][0].sha).toBe(SHA_B);
    expect(out).toMatchObject({
      issueCount: 1,
      matchedCommitCount: 1,
      fetchCapped: false,
    });
    expect([...out.layer.keys()]).toEqual([22, 23]);
    expect(out.layer.get(22)).toEqual({
      caseId: 22,
      score: 90,
      reasons: [
        {
          kind: "ISSUE",
          issueId: 30,
          issueKey: "PROJ-9",
          commits: [{ sha: SHA_B, shortSha: "bbbbbbb" }],
          files: ["src/a.ts"],
        },
      ],
    });
  });

  it("uses the whole diff as the files when the range is a single commit", async () => {
    const db = makeDb(
      [{ id: 1, externalKey: "#4" }],
      [{ caseId: 9, issueId: 1 }]
    );
    const getCommitFiles = vi.fn();

    const out = await run(db, [commit(SHA_A, "Fixes #4")], { getCommitFiles });

    expect(getCommitFiles).not.toHaveBeenCalled();
    expect(out.layer.get(9)?.reasons[0]).toMatchObject({ files: CHANGED });
  });

  it("merges several commits naming the same ticket into one reason per issue", async () => {
    const db = makeDb(
      [{ id: 1, externalKey: "PROJ-1" }],
      [{ caseId: 9, issueId: 1 }]
    );
    const getCommitFiles = vi
      .fn()
      .mockResolvedValueOnce(["src/a.ts"])
      .mockResolvedValueOnce(["src/b.ts"]);

    const out = await run(
      db,
      [
        commit(SHA_A, "PROJ-1 part 1"),
        commit(SHA_B, "PROJ-1 part 2"),
        commit(SHA_C, "x"),
      ],
      { getCommitFiles }
    );

    expect(out.layer.get(9)?.reasons).toEqual([
      expect.objectContaining({
        issueKey: "PROJ-1",
        commits: [
          { sha: SHA_A, shortSha: "aaaaaaa" },
          { sha: SHA_B, shortSha: "bbbbbbb" },
        ],
        files: ["src/a.ts", "src/b.ts"],
      }),
    ]);
  });

  it("keeps one reason per issue when a case is linked to two tickets in the range", async () => {
    const db = makeDb(
      [
        { id: 1, externalKey: "PROJ-1" },
        { id: 2, externalKey: "PROJ-2" },
      ],
      [
        { caseId: 9, issueId: 1 },
        { caseId: 9, issueId: 2 },
      ]
    );
    const out = await run(db, [
      commit(SHA_A, "PROJ-1 PROJ-2"),
      commit(SHA_B, "y"),
    ]);
    expect(out.layer.get(9)?.reasons.map((r) => (r as any).issueKey)).toEqual([
      "PROJ-1",
      "PROJ-2",
    ]);
    expect(out.issueCount).toBe(2);
  });

  it("stops fetching at the cap and leaves later commits' reasons without files", async () => {
    const db = makeDb(
      [
        { id: 1, externalKey: "PROJ-1" },
        { id: 2, externalKey: "PROJ-2" },
      ],
      [
        { caseId: 9, issueId: 1 },
        { caseId: 10, issueId: 2 },
      ]
    );
    const getCommitFiles = vi.fn().mockResolvedValue(["src/a.ts"]);

    const out = await run(
      db,
      [commit(SHA_A, "PROJ-1"), commit(SHA_B, "PROJ-2"), commit(SHA_C, "z")],
      { getCommitFiles, maxCommitFetches: 1 }
    );

    expect(getCommitFiles).toHaveBeenCalledTimes(1);
    expect(out.fetchCapped).toBe(true);
    expect(out.layer.get(9)?.reasons[0]).toMatchObject({ files: ["src/a.ts"] });
    expect(out.layer.get(10)?.reasons[0]).not.toHaveProperty("files");
  });

  it("leaves the reason without files when the commit's files cannot be read", async () => {
    const db = makeDb(
      [{ id: 1, externalKey: "PROJ-1" }],
      [{ caseId: 9, issueId: 1 }]
    );
    const out = await run(db, [commit(SHA_A, "PROJ-1"), commit(SHA_B, "q")], {
      getCommitFiles: vi.fn().mockResolvedValue(null),
    });
    expect(out.layer.get(9)?.reasons[0]).not.toHaveProperty("files");
    expect(out.fetchCapped).toBe(false);
  });

  it("passes the case filter through to the link lookup", async () => {
    const db = makeDb(
      [{ id: 1, externalKey: "PROJ-1" }],
      [{ caseId: 9, issueId: 1 }]
    );
    await run(db, [commit(SHA_A, "PROJ-1")], {
      caseFilter: {
        isArchived: false,
        state: { workflowType: { not: "NOT_STARTED" } },
      },
    });
    expect(db.repositoryCaseIssue.findMany.mock.calls[0][0].where.case).toEqual(
      {
        projectId: 1,
        isDeleted: false,
        isArchived: false,
        state: { workflowType: { not: "NOT_STARTED" } },
      }
    );
  });
});
