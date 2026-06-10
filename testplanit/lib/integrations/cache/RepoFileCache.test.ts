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
  return {
    default: { duplicate: () => mockValkey },
    __mockValkey: mockValkey,
  };
});

import { RepoFileCache, type PreviewListCacheEntry } from "./RepoFileCache";

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
