import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    getFileAtCommit: vi.fn(),
    setFileAtCommit: vi.fn(),
  },
}));

import type { GitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { MAX_FILE_AT_COMMIT_BYTES } from "~/lib/integrations/diff/limits";
import {
  FileTooLargeError,
  getFileAtCommit,
  isSafeRepoPath,
} from "./fileAtCommit";

const SHA = "c".repeat(40);

function makeAdapter(content: string | Error = "hello") {
  const getFileContentAtCommit =
    content instanceof Error
      ? vi.fn().mockRejectedValue(content)
      : vi.fn().mockResolvedValue(content);
  return {
    getFileContentAtCommit,
  } as unknown as GitRepoAdapter & {
    getFileContentAtCommit: ReturnType<typeof vi.fn>;
  };
}

describe("getFileAtCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached content without calling the adapter on a hit", async () => {
    (repoFileCache.getFileAtCommit as any).mockResolvedValue("cached body");
    const adapter = makeAdapter("live body");

    const out = await getFileAtCommit({
      configId: 3,
      cacheEnabled: true,
      adapter,
      path: "src/a.ts",
      sha: SHA,
    });

    expect(out).toEqual({ content: "cached body", cached: true });
    expect(repoFileCache.getFileAtCommit).toHaveBeenCalledWith(
      3,
      SHA,
      "src/a.ts"
    );
    expect(adapter.getFileContentAtCommit).not.toHaveBeenCalled();
    expect(repoFileCache.setFileAtCommit).not.toHaveBeenCalled();
  });

  it("treats an empty cached string as a hit (only null is a miss)", async () => {
    (repoFileCache.getFileAtCommit as any).mockResolvedValue("");
    const adapter = makeAdapter("live body");

    const out = await getFileAtCommit({
      configId: 3,
      cacheEnabled: true,
      adapter,
      path: "src/empty.ts",
      sha: SHA,
    });

    expect(out).toEqual({ content: "", cached: true });
    expect(adapter.getFileContentAtCommit).not.toHaveBeenCalled();
  });

  it("reads from the adapter and stores the content on a miss", async () => {
    (repoFileCache.getFileAtCommit as any).mockResolvedValue(null);
    const adapter = makeAdapter("live body");

    const out = await getFileAtCommit({
      configId: 3,
      cacheEnabled: true,
      adapter,
      path: "src/a.ts",
      sha: SHA,
    });

    expect(out).toEqual({ content: "live body", cached: false });
    expect(adapter.getFileContentAtCommit).toHaveBeenCalledWith(
      "src/a.ts",
      SHA
    );
    expect(repoFileCache.setFileAtCommit).toHaveBeenCalledWith(
      3,
      SHA,
      "src/a.ts",
      "live body"
    );
  });

  it("never touches the cache in privacy mode (cacheEnabled=false)", async () => {
    const adapter = makeAdapter("live body");

    const out = await getFileAtCommit({
      configId: 3,
      cacheEnabled: false,
      adapter,
      path: "src/a.ts",
      sha: SHA,
    });

    expect(out).toEqual({ content: "live body", cached: false });
    expect(repoFileCache.getFileAtCommit).not.toHaveBeenCalled();
    expect(repoFileCache.setFileAtCommit).not.toHaveBeenCalled();
  });

  it("throws FileTooLargeError over MAX_FILE_AT_COMMIT_BYTES and does not cache it", async () => {
    (repoFileCache.getFileAtCommit as any).mockResolvedValue(null);
    const oversized = "x".repeat(MAX_FILE_AT_COMMIT_BYTES + 1);
    const adapter = makeAdapter(oversized);

    const promise = getFileAtCommit({
      configId: 3,
      cacheEnabled: true,
      adapter,
      path: "big.bin",
      sha: SHA,
    });

    await expect(promise).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(promise).rejects.toMatchObject({
      name: "FileTooLargeError",
      message: `File too large: big.bin (${MAX_FILE_AT_COMMIT_BYTES + 1} bytes)`,
    });
    expect(repoFileCache.setFileAtCommit).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the byte cap", async () => {
    const atCap = "x".repeat(MAX_FILE_AT_COMMIT_BYTES);
    const adapter = makeAdapter(atCap);

    const out = await getFileAtCommit({
      configId: 3,
      cacheEnabled: false,
      adapter,
      path: "big.bin",
      sha: SHA,
    });

    expect(out.content).toHaveLength(MAX_FILE_AT_COMMIT_BYTES);
  });

  it("measures bytes, not characters, when applying the cap", async () => {
    // Each "é" is two UTF-8 bytes; half the cap in characters overflows it.
    const multibyte = "é".repeat(MAX_FILE_AT_COMMIT_BYTES / 2 + 1);
    const adapter = makeAdapter(multibyte);

    await expect(
      getFileAtCommit({
        configId: 3,
        cacheEnabled: false,
        adapter,
        path: "utf8.txt",
        sha: SHA,
      })
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("propagates adapter errors untouched", async () => {
    const adapter = makeAdapter(new Error("GitHub API error: 404 Not Found"));

    await expect(
      getFileAtCommit({
        configId: 3,
        cacheEnabled: false,
        adapter,
        path: "missing.ts",
        sha: SHA,
      })
    ).rejects.toThrow("GitHub API error: 404 Not Found");
  });
});

describe("isSafeRepoPath", () => {
  it.each([
    ["src/index.ts", true],
    ["README.md", true],
    ["a/b/c/d.txt", true],
    ["dir.with.dots/file..name.ts", true],
    ["./relative.ts", true],
  ])("accepts %s", (path, expected) => {
    expect(isSafeRepoPath(path)).toBe(expected);
  });

  it.each([
    ["../etc/passwd", "parent traversal at the start"],
    ["src/../../etc/passwd", "parent traversal in the middle"],
    ["src/..", "parent traversal at the end"],
    ["/etc/passwd", "leading slash"],
    ["src\\index.ts", "backslash separator"],
    ["src//index.ts", "empty segment"],
    ["src/", "trailing slash (empty segment)"],
    ["", "empty path"],
  ])("rejects %s (%s)", (path) => {
    expect(isSafeRepoPath(path)).toBe(false);
  });

  it("rejects paths longer than 4096 characters and accepts exactly 4096", () => {
    expect(isSafeRepoPath("a".repeat(4097))).toBe(false);
    expect(isSafeRepoPath("a".repeat(4096))).toBe(true);
  });
});
