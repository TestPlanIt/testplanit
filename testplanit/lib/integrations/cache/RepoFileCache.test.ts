import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock valkey connection (mirrors IssueCache.test.ts).
vi.mock("../../valkey", () => {
  const mockValkey = {
    get: vi.fn(),
    setex: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockImplementation(() => ({
      setex: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    hgetall: vi.fn(),
    disconnect: vi.fn(),
  };
  // Each RepoFileCache takes whichever backend is current when it is built.
  const backend = { current: mockValkey as unknown };
  return {
    default: { duplicate: () => backend.current },
    __mockValkey: mockValkey,
    __backend: backend,
  };
});

import { FakeValkey } from "~/__tests__/helpers/fakeValkey";
import {
  RepoFileCache,
  type PreviewListCacheEntry,
  type RepoFileEntry,
} from "./RepoFileCache";

let mockValkey: any;

const entry: PreviewListCacheEntry = {
  files: [{ path: "src/a.ts", size: 10, type: "file" }],
  truncated: false,
};

describe("RepoFileCache preview listing", () => {
  let cache: RepoFileCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    const valkeyModule = await import("../../valkey");
    mockValkey = (valkeyModule as any).__mockValkey;
    (valkeyModule as any).__backend.current = mockValkey;
    cache = new RepoFileCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on a miss", async () => {
    mockValkey.get.mockResolvedValue(null);
    const result = await cache.getPreviewList(7, "main", ["src"]);
    expect(result).toBeNull();
  });

  it("returns the parsed entry on a hit", async () => {
    mockValkey.get.mockResolvedValue(JSON.stringify(entry));
    const result = await cache.getPreviewList(7, "main", ["src"]);
    expect(result).toEqual(entry);
  });

  it("stores with a 5-minute TTL and a repo-scoped key", async () => {
    await cache.setPreviewList(7, "main", ["src"], entry);
    expect(mockValkey.setex).toHaveBeenCalledWith(
      expect.stringContaining("repo-preview-list:repo:7:"),
      300,
      JSON.stringify(entry)
    );
  });

  it("uses an order-independent key for base paths", async () => {
    await cache.setPreviewList(7, "main", ["src", "tests"], entry);
    await cache.setPreviewList(7, "main", ["tests", "src"], entry);
    expect(mockValkey.setex.mock.calls[0][0]).toBe(
      mockValkey.setex.mock.calls[1][0]
    );
  });

  it("uses a different key per branch and per base path", async () => {
    await cache.setPreviewList(7, "main", ["src"], entry);
    await cache.setPreviewList(7, "dev", ["src"], entry);
    await cache.setPreviewList(7, "main", ["lib"], entry);
    const [k1, k2, k3] = mockValkey.setex.mock.calls.map((c: any[]) => c[0]);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("drops a corrupted entry and returns null", async () => {
    mockValkey.get.mockResolvedValue("{not json");
    const result = await cache.getPreviewList(7, "main", ["src"]);
    expect(result).toBeNull();
    expect(mockValkey.del).toHaveBeenCalled();
  });
});

describe("RepoFileCache staged refresh", () => {
  const DAY = 24 * 3600;
  let fake: FakeValkey;
  let cache: RepoFileCache;

  const file = (path: string): RepoFileEntry => ({
    path,
    size: 1,
    type: "file",
  });

  /** A complete live cache, as the last successful refresh left it. */
  async function seedLive(paths: string[]) {
    const staged = await cache.stage(
      5,
      paths.map(file),
      new Map(paths.map((p) => [p, `old ${p}`]))
    );
    await cache.commitStaged(staged, 7);
  }

  beforeEach(async () => {
    delete process.env.INSTANCE_TENANT_ID;
    const valkeyModule = await import("../../valkey");
    fake = new FakeValkey();
    (valkeyModule as any).__backend.current = fake;
    cache = new RepoFileCache();
  });

  afterEach(() => {
    delete process.env.INSTANCE_TENANT_ID;
  });

  it("keeps serving the live cache while a refresh is staged", async () => {
    await seedLive(["a.ts"]);

    await cache.stage(5, [file("b.ts")], new Map([["b.ts", "new"]]));

    expect(await cache.getFiles(5)).toEqual([file("a.ts")]);
    expect(await cache.getFileContents(5)).toEqual(
      new Map([["a.ts", "old a.ts"]])
    );
    expect((await cache.getMeta(5))?.fileCount).toBe(1);
  });

  it("replaces the contents hash whole, so files deleted upstream do not linger", async () => {
    await seedLive(["a.ts", "gone.ts"]);

    const staged = await cache.stage(
      5,
      [file("a.ts"), file("b.ts")],
      new Map([
        ["a.ts", "new a"],
        ["b.ts", "new b"],
      ]),
      { truncated: true }
    );
    await cache.commitStaged(staged, 3);

    expect(await cache.getFiles(5)).toEqual([file("a.ts"), file("b.ts")]);
    expect(await cache.getFileContents(5)).toEqual(
      new Map([
        ["a.ts", "new a"],
        ["b.ts", "new b"],
      ])
    );
    expect(await cache.getMeta(5)).toMatchObject({
      status: "success",
      fileCount: 2,
      totalSize: 2,
      truncated: true,
    });
    expect(fake.keys().sort()).toEqual([
      "repo-file-contents:config:5",
      "repo-files-meta:config:5",
      "repo-files:config:5",
    ]);
    for (const key of fake.keys()) expect(fake.ttls.get(key)).toBe(3 * DAY);
  });

  it("drops the live contents when the refresh fetched none", async () => {
    await seedLive(["a.ts"]);

    const staged = await cache.stage(5, [file("a.ts")], new Map());
    await cache.commitStaged(staged, 7);

    expect(await cache.getFiles(5)).toEqual([file("a.ts")]);
    expect(await cache.getFileContents(5)).toBeNull();
  });

  it("discarding a staged refresh removes it and leaves the live keys alone", async () => {
    await seedLive(["a.ts"]);
    const live = new Map(fake.strings);

    const staged = await cache.stage(
      5,
      [file("b.ts")],
      new Map([["b.ts", "x"]])
    );
    await cache.discardStaged(staged);

    expect(fake.keys().filter((k) => k.includes(":staging:"))).toEqual([]);
    expect(fake.strings).toEqual(live);
    expect(await cache.getFileContents(5)).toEqual(
      new Map([["a.ts", "old a.ts"]])
    );
  });

  it("gives staging keys a short TTL so a crashed refresh cleans itself up", async () => {
    await cache.stage(5, [file("a.ts")], new Map([["a.ts", "x"]]));

    const staging = fake.keys().filter((k) => k.includes(":staging:"));
    expect(staging).toHaveLength(3);
    for (const key of staging) expect(fake.ttls.get(key)).toBe(3600);
  });

  it("keeps the tenant prefix on staging and live keys", async () => {
    process.env.INSTANCE_TENANT_ID = "acme";

    const staged = await cache.stage(
      5,
      [file("a.ts")],
      new Map([["a.ts", "x"]])
    );
    const staging = fake.keys();
    expect(staging).toEqual(
      expect.arrayContaining([
        `repo-files:acme:config:5:staging:${staged.token}`,
        `repo-files-meta:acme:config:5:staging:${staged.token}`,
        `repo-file-contents:acme:config:5:staging:${staged.token}`,
      ])
    );

    await cache.commitStaged(staged, 7);
    expect(fake.keys().sort()).toEqual([
      "repo-file-contents:acme:config:5",
      "repo-files-meta:acme:config:5",
      "repo-files:acme:config:5",
    ]);
  });

  it("fails the commit when a staged key has gone missing", async () => {
    const staged = await cache.stage(5, [file("a.ts")], new Map());
    await fake.del(...fake.keys());

    await expect(cache.commitStaged(staged, 7)).rejects.toThrow(/no such key/);
  });

  describe("setError", () => {
    it("keeps a live cache usable and records the failure beside its metadata", async () => {
      await seedLive(["a.ts"]);
      const before = await cache.getMeta(5);
      fake.ttls.set("repo-files-meta:config:5", 1234);

      const kept = await cache.setError(5, "HTTP 403", 7);

      expect(kept).toBe(true);
      expect(await cache.getFiles(5)).toEqual([file("a.ts")]);
      expect(await cache.getMeta(5)).toEqual({
        ...before,
        lastError: { message: "HTTP 403", at: expect.any(String) },
      });
      expect(fake.ttls.get("repo-files-meta:config:5")).toBe(1234);
    });

    it("stores an error entry when there is no live cache", async () => {
      const kept = await cache.setError(5, "HTTP 403", 2);

      expect(kept).toBe(false);
      expect(await cache.getMeta(5)).toMatchObject({
        status: "error",
        error: "HTTP 403",
        fileCount: 0,
      });
      expect(fake.ttls.get("repo-files-meta:config:5")).toBe(2 * DAY);
    });

    it("a later successful refresh clears the recorded failure", async () => {
      await seedLive(["a.ts"]);
      await cache.setError(5, "HTTP 403", 7);

      await seedLive(["a.ts"]);

      expect((await cache.getMeta(5))?.lastError).toBeUndefined();
    });
  });
});
