import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    getCompare: vi.fn(),
    setCompare: vi.fn(),
  },
}));

import type {
  CompareResult,
  GitRepoAdapter,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  changedDirsOf,
  getOrComputeCompare,
  RefNotFoundError,
  resolveRefToSha,
  toDiffFileRecords,
} from "./compareService";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function makeAdapter(over: Partial<Record<keyof GitRepoAdapter, any>> = {}) {
  return {
    listCommits: vi.fn(),
    compareCommits: vi.fn(),
    ...over,
  } as unknown as GitRepoAdapter & {
    listCommits: ReturnType<typeof vi.fn>;
    compareCommits: ReturnType<typeof vi.fn>;
  };
}

function makeCompareResult(over: Partial<CompareResult> = {}): CompareResult {
  return {
    baseSha: SHA_A,
    headSha: SHA_B,
    files: [],
    commits: [],
    truncated: false,
    ...over,
  };
}

describe("resolveRefToSha", () => {
  it("passes a full 40-hex sha through, lowercased, without touching the adapter", async () => {
    const adapter = makeAdapter();
    const upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";

    await expect(resolveRefToSha(adapter, upper)).resolves.toBe(
      upper.toLowerCase()
    );
    expect(adapter.listCommits).not.toHaveBeenCalled();
  });

  it("resolves a branch name via listCommits(ref, { perPage: 1 })", async () => {
    const adapter = makeAdapter({
      listCommits: vi.fn().mockResolvedValue({ commits: [{ sha: SHA_A }] }),
    });

    await expect(resolveRefToSha(adapter, "main")).resolves.toBe(SHA_A);
    expect(adapter.listCommits).toHaveBeenCalledWith("main", { perPage: 1 });
  });

  it("resolves a short sha the same way (it is not a full sha)", async () => {
    const adapter = makeAdapter({
      listCommits: vi.fn().mockResolvedValue({ commits: [{ sha: SHA_B }] }),
    });

    await expect(resolveRefToSha(adapter, "bbbbbbb")).resolves.toBe(SHA_B);
    expect(adapter.listCommits).toHaveBeenCalledWith("bbbbbbb", { perPage: 1 });
  });

  it("throws RefNotFoundError when the ref has no commits", async () => {
    const adapter = makeAdapter({
      listCommits: vi.fn().mockResolvedValue({ commits: [] }),
    });

    const promise = resolveRefToSha(adapter, "ghost");
    await expect(promise).rejects.toBeInstanceOf(RefNotFoundError);
    await expect(promise).rejects.toMatchObject({
      name: "RefNotFoundError",
      message: "Ref not found: ghost",
    });
  });
});

describe("getOrComputeCompare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached result and never calls the adapter on a cache hit", async () => {
    const cachedResult = makeCompareResult({ truncated: true });
    (repoFileCache.getCompare as any).mockResolvedValue(cachedResult);
    const adapter = makeAdapter();

    const out = await getOrComputeCompare({
      configId: 7,
      cacheEnabled: true,
      adapter,
      baseSha: SHA_A,
      headSha: SHA_B,
    });

    expect(out).toEqual({ result: cachedResult, cached: true });
    expect(repoFileCache.getCompare).toHaveBeenCalledWith(7, SHA_A, SHA_B);
    expect(adapter.compareCommits).not.toHaveBeenCalled();
    expect(repoFileCache.setCompare).not.toHaveBeenCalled();
  });

  it("computes via compareCommits and stores the result on a cache miss", async () => {
    (repoFileCache.getCompare as any).mockResolvedValue(null);
    const live = makeCompareResult();
    const adapter = makeAdapter({
      compareCommits: vi.fn().mockResolvedValue(live),
    });
    const opts = { maxFiles: 10 };

    const out = await getOrComputeCompare({
      configId: 7,
      cacheEnabled: true,
      adapter,
      baseSha: SHA_A,
      headSha: SHA_B,
      opts,
    });

    expect(out).toEqual({ result: live, cached: false });
    expect(adapter.compareCommits).toHaveBeenCalledWith(SHA_A, SHA_B, opts);
    expect(repoFileCache.setCompare).toHaveBeenCalledWith(
      7,
      SHA_A,
      SHA_B,
      live
    );
  });

  it("never touches the cache when cacheEnabled is false", async () => {
    const live = makeCompareResult();
    const adapter = makeAdapter({
      compareCommits: vi.fn().mockResolvedValue(live),
    });

    const out = await getOrComputeCompare({
      configId: 7,
      cacheEnabled: false,
      adapter,
      baseSha: SHA_A,
      headSha: SHA_B,
    });

    expect(out).toEqual({ result: live, cached: false });
    expect(repoFileCache.getCompare).not.toHaveBeenCalled();
    expect(repoFileCache.setCompare).not.toHaveBeenCalled();
    expect(adapter.compareCommits).toHaveBeenCalledWith(
      SHA_A,
      SHA_B,
      undefined
    );
  });

  it("propagates adapter failures without writing to the cache", async () => {
    (repoFileCache.getCompare as any).mockResolvedValue(null);
    const adapter = makeAdapter({
      compareCommits: vi.fn().mockRejectedValue(new Error("boom")),
    });

    await expect(
      getOrComputeCompare({
        configId: 7,
        cacheEnabled: true,
        adapter,
        baseSha: SHA_A,
        headSha: SHA_B,
      })
    ).rejects.toThrow("boom");
    expect(repoFileCache.setCompare).not.toHaveBeenCalled();
  });
});

describe("toDiffFileRecords", () => {
  const patch = [
    "@@ -1,3 +1,4 @@",
    " unchanged",
    "-old line",
    "+new line",
    "+another new line",
    " trailing",
  ].join("\n");

  it("parses hunks from the patch and drops the patch text", () => {
    const records = toDiffFileRecords(
      makeCompareResult({
        files: [
          {
            path: "src/a.ts",
            status: "modified",
            additions: 2,
            deletions: 1,
            isBinary: false,
            patch,
          },
        ],
      })
    );

    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({
      path: "src/a.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      isBinary: false,
    });
    expect(record).not.toHaveProperty("patch");
    expect(record.hunks).toHaveLength(1);
    expect(record.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
    });
    expect(record.hunks[0].changedOldRanges.length).toBeGreaterThan(0);
  });

  it("emits an empty hunk list for files without a patch", () => {
    const [record] = toDiffFileRecords(
      makeCompareResult({
        files: [
          {
            path: "assets/logo.png",
            status: "added",
            additions: 0,
            deletions: 0,
            isBinary: true,
          },
        ],
      })
    );

    expect(record.hunks).toEqual([]);
    expect(record.isBinary).toBe(true);
  });

  it("includes previousPath and patchTruncated only when present", () => {
    const [plain, renamed] = toDiffFileRecords(
      makeCompareResult({
        files: [
          {
            path: "src/plain.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            isBinary: false,
            patchTruncated: false,
          },
          {
            path: "src/new.ts",
            previousPath: "src/old.ts",
            status: "renamed",
            additions: 1,
            deletions: 1,
            isBinary: false,
            patchTruncated: true,
          },
        ],
      })
    );

    expect(plain).not.toHaveProperty("previousPath");
    expect(plain).not.toHaveProperty("patchTruncated");
    expect(renamed.previousPath).toBe("src/old.ts");
    expect(renamed.patchTruncated).toBe(true);
  });
});

describe("changedDirsOf", () => {
  it("yields nothing for a root-level file", () => {
    expect(changedDirsOf(["README.md"])).toEqual([]);
  });

  it("returns every parent up to the depth cap, sorted and deduped", () => {
    const dirs = changedDirsOf([
      "a/b/c/d/e.ts",
      "a/b/c/f.ts",
      "a/x.ts",
      "z/y.ts",
    ]);

    expect(dirs).toEqual(["a", "a/b", "a/b/c", "z"]);
  });

  it("honors a custom depth cap", () => {
    expect(changedDirsOf(["a/b/c/d/e.ts"], 1)).toEqual(["a"]);
    expect(changedDirsOf(["a/b/c/d/e.ts"], 4)).toEqual([
      "a",
      "a/b",
      "a/b/c",
      "a/b/c/d",
    ]);
  });

  it("does not include the file itself as a directory", () => {
    expect(changedDirsOf(["src/index.ts"])).toEqual(["src"]);
  });
});
