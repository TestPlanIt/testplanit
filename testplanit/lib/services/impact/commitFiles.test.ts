import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetRefList, mockSetRefList } = vi.hoisted(() => ({
  mockGetRefList: vi.fn(),
  mockSetRefList: vi.fn(),
}));

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    getRefList: (...args: unknown[]) => mockGetRefList(...args),
    setRefList: (...args: unknown[]) => mockSetRefList(...args),
  },
}));

import { getCommitFilePaths } from "./commitFiles";

const SHA = "a".repeat(40);
const PARENT = "b".repeat(40);

function makeAdapter(files: Array<{ path: string; previousPath?: string }>) {
  return {
    compareCommits: vi.fn().mockResolvedValue({
      baseSha: PARENT,
      headSha: SHA,
      files: files.map((f) => ({
        ...f,
        status: "modified",
        additions: 0,
        deletions: 0,
        isBinary: false,
      })),
      commits: [],
      truncated: false,
    }),
  };
}

describe("getCommitFilePaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRefList.mockResolvedValue(null);
    mockSetRefList.mockResolvedValue(undefined);
  });

  it("compares the commit against its first parent with no patch text", async () => {
    const adapter = makeAdapter([
      { path: "src/a.ts" },
      { path: "src/new.ts", previousPath: "src/old.ts" },
    ]);

    const result = await getCommitFilePaths({
      configId: 7,
      cacheEnabled: false,
      adapter,
      commit: { sha: SHA, parents: [PARENT, "c".repeat(40)] },
      maxFiles: 500,
    });

    expect(adapter.compareCommits).toHaveBeenCalledWith(PARENT, SHA, {
      maxFilesWithPatch: 0,
      maxCommits: 1,
      maxFiles: 500,
    });
    expect(result).toEqual({
      paths: ["src/a.ts", "src/new.ts", "src/old.ts"],
      capped: false,
    });
    expect(mockGetRefList).not.toHaveBeenCalled();
    expect(mockSetRefList).not.toHaveBeenCalled();
  });

  it("yields null for a root commit", async () => {
    const adapter = makeAdapter([]);
    const result = await getCommitFilePaths({
      configId: 7,
      cacheEnabled: true,
      adapter,
      commit: { sha: SHA, parents: [] },
      maxFiles: 500,
    });
    expect(result).toBeNull();
    expect(adapter.compareCommits).not.toHaveBeenCalled();
  });

  it("flags a list that reached the file cap", async () => {
    const adapter = makeAdapter([{ path: "a" }, { path: "b" }]);
    const result = await getCommitFilePaths({
      configId: 7,
      cacheEnabled: false,
      adapter,
      commit: { sha: SHA, parents: [PARENT] },
      maxFiles: 2,
    });
    expect(result?.capped).toBe(true);
  });

  it("serves a cached list and stores a fresh one under the commit sha", async () => {
    const adapter = makeAdapter([{ path: "src/a.ts" }]);
    const req = {
      configId: 7,
      cacheEnabled: true,
      adapter,
      commit: { sha: SHA, parents: [PARENT] },
      maxFiles: 500,
    };

    const fresh = await getCommitFilePaths(req);
    expect(fresh?.paths).toEqual(["src/a.ts"]);
    expect(mockSetRefList).toHaveBeenCalledWith(
      7,
      "commit-files",
      SHA,
      { paths: ["src/a.ts"], capped: false },
      7 * 24 * 60 * 60
    );

    mockGetRefList.mockResolvedValue({ paths: ["cached.ts"], capped: false });
    const cached = await getCommitFilePaths(req);
    expect(cached?.paths).toEqual(["cached.ts"]);
    expect(adapter.compareCommits).toHaveBeenCalledTimes(1);
  });
});
