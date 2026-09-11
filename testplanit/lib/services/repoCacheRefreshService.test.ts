import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/integrations/adapters/GitRepoAdapter", () => ({
  createGitRepoAdapter: vi.fn(),
}));

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    invalidate: vi.fn(),
    setFiles: vi.fn(),
    setFileContents: vi.fn(),
    setError: vi.fn(),
  },
}));

vi.mock("~/lib/services/impact/compareService", () => ({
  resolveRefToSha: vi.fn(),
}));

vi.mock("~/lib/services/impact/markerScan", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/services/impact/markerScan")
  >()),
  syncMarkerPins: vi.fn(),
}));

import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { resolveRefToSha } from "~/lib/services/impact/compareService";
import { syncMarkerPins } from "~/lib/services/impact/markerScan";
import { refreshRepoCache } from "./repoCacheRefreshService";

const OWNER = "user-42";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    projectId: 1,
    purpose: "IMPACT",
    branch: "main",
    cacheEnabled: true,
    cacheTtlDays: 7,
    pathPatterns: [],
    repository: { credentials: {}, settings: null, provider: "github" },
    project: { createdBy: OWNER },
    ...overrides,
  };
}

/** An adapter that serves the whole repo from one archive download. */
function makeArchiveAdapter(files: Record<string, string>) {
  return {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    downloadArchiveTree: vi.fn().mockResolvedValue({
      files: Object.keys(files).map((path) => ({ path, size: 0 })),
      getContents: vi.fn(async (wanted: Set<string>) => {
        const map = new Map<string, string>();
        for (const path of wanted) map.set(path, files[path]);
        return map;
      }),
    }),
    listFilesInPaths: vi.fn(),
    getFileContent: vi.fn(),
    retryAfterSeconds: 0,
  };
}

/** An adapter with no archive support, so contents come one file at a time. */
function makeTreeWalkAdapter(paths: string[]) {
  return {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    downloadArchiveTree: vi
      .fn()
      .mockRejectedValue(new Error("archives unsupported")),
    listFilesInPaths: vi.fn().mockResolvedValue({
      files: paths.map((path) => ({ path, size: 10 })),
      truncated: false,
    }),
    getFileContent: vi.fn().mockResolvedValue("// file"),
    // Seconds, so the rate-limit backoff waits ~1ms per attempt here.
    retryAfterSeconds: 0.001,
  };
}

let db: any;
let update: ReturnType<typeof vi.fn>;

function makeDb(config: Record<string, unknown> | null) {
  update = vi.fn().mockResolvedValue({});
  return {
    projectCodeRepositoryConfig: {
      findUnique: vi.fn().mockResolvedValue(config),
      update,
    },
  };
}

/** The marker scan report is the only field written under that name. */
function storedReport(): any {
  const call = update.mock.calls.find(
    ([args]: any[]) => "markerScanReport" in args.data
  );
  return call?.[0].data.markerScanReport;
}

describe("refreshRepoCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db = makeDb(makeConfig());
    (repoFileCache.invalidate as any).mockResolvedValue(undefined);
    (repoFileCache.setFiles as any).mockResolvedValue(undefined);
    (repoFileCache.setFileContents as any).mockResolvedValue(undefined);
    (repoFileCache.setError as any).mockResolvedValue(undefined);
    (resolveRefToSha as any).mockResolvedValue("abc123");
    (syncMarkerPins as any).mockResolvedValue({ pinsCreated: 2 });
    (createGitRepoAdapter as any).mockReturnValue(
      makeArchiveAdapter({ "lib/auth.ts": "// @testplanit case: 1" })
    );
  });

  it("throws when the config does not exist", async () => {
    db = makeDb(null);

    await expect(refreshRepoCache(5, db)).rejects.toThrow(
      "ProjectCodeRepositoryConfig 5 not found"
    );
  });

  describe("marker scan", () => {
    it("syncs pins as the project owner and stores what the scan reported", async () => {
      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(true);
      expect(syncMarkerPins).toHaveBeenCalledTimes(1);
      const [, scanConfig, contents, opts] = (syncMarkerPins as any).mock
        .calls[0];
      expect(scanConfig).toEqual({ id: 5, projectId: 1, branch: "main" });
      expect([...contents.keys()]).toEqual(["lib/auth.ts"]);
      expect(opts).toEqual({ anchorSha: "abc123", actorId: OWNER });
      expect(storedReport()).toEqual({ pinsCreated: 2 });
    });

    it("does not scan a config that is not for impact analysis", async () => {
      db = makeDb(makeConfig({ purpose: "QUICKSCRIPT" }));

      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(true);
      expect(syncMarkerPins).not.toHaveBeenCalled();
      expect(storedReport()).toBeUndefined();
    });

    it("records privacy mode instead of scanning when caching is off", async () => {
      db = makeDb(makeConfig({ cacheEnabled: false }));

      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/caching is disabled/i);
      expect(syncMarkerPins).not.toHaveBeenCalled();
      expect(createGitRepoAdapter).not.toHaveBeenCalled();
      expect(storedReport()).toMatchObject({ skipped: "privacy_mode" });
    });

    it("skips the scan when the provider rate-limited the content fetch", async () => {
      const adapter = makeTreeWalkAdapter(["lib/auth.ts"]);
      adapter.getFileContent.mockRejectedValue(
        new Error("API rate limit exceeded")
      );
      (createGitRepoAdapter as any).mockReturnValue(adapter);

      const result = await refreshRepoCache(5, db);

      // Half a repo would delete every pin whose file happened to be missing.
      expect(result.contentRateLimited).toBe(true);
      expect(result.success).toBe(true);
      expect(syncMarkerPins).not.toHaveBeenCalled();
      expect(resolveRefToSha).not.toHaveBeenCalled();
      expect(storedReport()).toMatchObject({ skipped: "partial_contents" });
      expect(storedReport().scannedAt).toEqual(expect.any(String));
    });

    it("records a failed scan without failing the refresh", async () => {
      (syncMarkerPins as any).mockRejectedValue(new Error("pin sync exploded"));

      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(1);
      expect(storedReport()).toMatchObject({ error: "pin sync exploded" });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cacheStatus: "success" }),
        })
      );
    });

    it("records a failure to resolve the anchor commit", async () => {
      (resolveRefToSha as any).mockRejectedValue(new Error("no such ref"));

      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(true);
      expect(syncMarkerPins).not.toHaveBeenCalled();
      expect(storedReport()).toMatchObject({ error: "no such ref" });
    });

    it("survives a failure to store the report", async () => {
      update.mockImplementation(async ({ data }: any) =>
        "markerScanReport" in data
          ? Promise.reject(new Error("column is gone"))
          : {}
      );

      await expect(refreshRepoCache(5, db)).resolves.toMatchObject({
        success: true,
      });
    });
  });

  describe("cache write-through", () => {
    it("stores the file list and contents, then marks the config successful", async () => {
      const result = await refreshRepoCache(5, db);

      expect(repoFileCache.invalidate).toHaveBeenCalledWith(5);
      expect(repoFileCache.setFiles).toHaveBeenCalledWith(
        5,
        [{ path: "lib/auth.ts", size: 22 }],
        7,
        { truncated: false }
      );
      expect(repoFileCache.setFileContents).toHaveBeenCalledWith(
        5,
        expect.any(Map),
        7
      );
      expect(result).toMatchObject({
        success: true,
        fileCount: 1,
        totalSize: 22,
        contentCached: 1,
        contentRateLimited: false,
      });
    });

    it("records the provider failure on the config and reports it", async () => {
      const adapter = makeTreeWalkAdapter(["lib/auth.ts"]);
      adapter.listFilesInPaths.mockRejectedValue(new Error("HTTP 500"));
      (createGitRepoAdapter as any).mockReturnValue(adapter);

      const result = await refreshRepoCache(5, db);

      expect(result).toMatchObject({ success: false, error: "HTTP 500" });
      expect(repoFileCache.setError).toHaveBeenCalledWith(5, "HTTP 500", 7);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cacheStatus: "error",
            cacheError: "HTTP 500",
          }),
        })
      );
      expect(syncMarkerPins).not.toHaveBeenCalled();
    });
  });
});
