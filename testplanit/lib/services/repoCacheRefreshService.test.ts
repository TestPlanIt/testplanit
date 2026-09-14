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

vi.mock("~/lib/valkey", () => ({ default: null }));

vi.mock("~/lib/services/impact/commitWalk", () => ({
  walkCommits: vi.fn(),
  commitWalkStore: vi.fn((configId: number, branch: string) => ({
    configId,
    branch,
  })),
}));

vi.mock("~/lib/services/impact/issueScan", () => ({
  syncIssuePins: vi.fn(),
}));

vi.mock("./resolveIssueKeys", () => {
  class IssueKeyResolutionError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    IssueKeyResolutionError,
    resolveIssueKeys: vi.fn(),
    resolveIssueTrackerIntegration: vi.fn(),
  };
});

const mockGetAdapter = vi.fn();
vi.mock("~/lib/integrations/IntegrationManager", () => ({
  integrationManager: {
    getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
  },
}));

vi.mock("~/lib/services/impact/commitFiles", () => ({
  getCommitFilePaths: vi.fn(),
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
import { walkCommits } from "~/lib/services/impact/commitWalk";
import { syncIssuePins } from "~/lib/services/impact/issueScan";
import { syncMarkerPins } from "~/lib/services/impact/markerScan";
import { refreshRepoCache, scanRepoIssues } from "./repoCacheRefreshService";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
  resolveIssueTrackerIntegration,
} from "./resolveIssueKeys";

const OWNER = "user-42";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    projectId: 1,
    purpose: "IMPACT",
    branch: "main",
    cacheEnabled: true,
    cacheTtlDays: 7,
    issueScanEnabled: true,
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
    issue: { findMany: vi.fn().mockResolvedValue([]) },
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
    (walkCommits as any).mockResolvedValue({
      commits: [],
      truncated: false,
      complete: true,
      fromCache: 0,
    });
    (syncIssuePins as any).mockResolvedValue({ created: 1 });
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

  describe("issue scan", () => {
    /** The final report: progress writes precede it under the same name. */
    function storedIssueReport(): any {
      const calls = update.mock.calls.filter(
        ([args]: any[]) => "issueScanReport" in args.data
      );
      return calls.at(-1)?.[0].data.issueScanReport;
    }

    function storedIssueReports(): any[] {
      return update.mock.calls
        .filter(([args]: any[]) => "issueScanReport" in args.data)
        .map(([args]: any[]) => args.data.issueScanReport);
    }

    it("walks recent commits, syncs ISSUE pins as the project owner, and stores the report", async () => {
      const commits = [{ sha: "c1", message: "PROJ-1", parents: ["c0"] }];
      (walkCommits as any).mockResolvedValue({
        commits,
        truncated: true,
        complete: false,
        fromCache: 1,
      });

      await refreshRepoCache(5, db);

      expect(walkCommits).toHaveBeenCalledWith(
        expect.anything(),
        "main",
        expect.objectContaining({
          lookbackDays: 90,
          maxCommits: 300,
          continueFromCache: false,
          store: { configId: 5, branch: "main" },
        })
      );
      const [, scanConfig, opts] = (syncIssuePins as any).mock.calls[0];
      expect(scanConfig).toEqual({ id: 5, projectId: 1 });
      expect(opts).toMatchObject({
        commits,
        truncated: true,
        cachedCommits: 1,
        full: false,
        actorId: OWNER,
        maxCommitFetches: 100,
        maxFilesPerCommit: 50,
      });
      expect(typeof opts.getCommitFiles).toBe("function");
      expect(typeof opts.importIssues).toBe("function");
      expect(typeof opts.onProgress).toBe("function");
      expect(storedIssueReport()).toEqual({ created: 1 });
    });

    it("marks the scan running while it walks, then stores the report", async () => {
      await refreshRepoCache(5, db);

      const reports = storedIssueReports();
      expect(reports[0]).toMatchObject({
        running: true,
        full: false,
        scannedCommits: 0,
      });
      expect(reports.at(-1)).toEqual({ created: 1 });
    });

    describe("importing named tickets", () => {
      const tokens = [
        { raw: "PROJ-1", exact: ["PROJ-1"] },
        { raw: "PROJ-2", exact: ["PROJ-2"] },
        { raw: "#7", exact: ["#7", "7"], number: "7" },
      ];

      const onProgress = vi.fn().mockResolvedValue(undefined);

      beforeEach(() => {
        // The tracker knows the PROJ project; look-alikes are filtered out.
        mockGetAdapter.mockResolvedValue({
          getProjects: vi
            .fn()
            .mockResolvedValue([{ id: "1", key: "PROJ", name: "Project" }]),
        });
      });

      async function runImport() {
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];
        return opts.importIssues(tokens, onProgress);
      }

      it("asks the tracker only for keys the project does not hold, in its own key style", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([
          { externalKey: "PROJ-1", externalId: "10001" },
        ]);
        (resolveIssueKeys as any).mockResolvedValue(
          new Map([["PROJ-2", { key: "PROJ-2", issueId: 9, created: true }]])
        );

        const result = await runImport();

        expect(db.issue.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              integrationId: 3,
              isDeleted: false,
            }),
          })
        );
        expect(db.issue.findMany.mock.calls[0][0].where).not.toHaveProperty(
          "projectId"
        );
        expect(resolveIssueKeys).toHaveBeenCalledWith({
          projectId: 1,
          keys: ["PROJ-2"],
          integrationId: 3,
          maxLookups: 1,
        });
        expect(result).toEqual({
          imported: 1,
          failed: 0,
          skipped: 0,
          moved: 0,
          failures: [],
        });
        expect(onProgress).toHaveBeenCalledWith({ lookups: 1, imported: 1 });
      });

      it("resolves in rounds, reporting after each, and stops at the lookup cap", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([]);
        const many = Array.from({ length: 45 }, (_, i) => ({
          raw: `PROJ-${i}`,
          exact: [`PROJ-${i}`],
        }));
        (resolveIssueKeys as any).mockImplementation(
          async ({ keys }: { keys: string[] }) =>
            new Map(
              keys.map((key) => [key, { key, issueId: 1, created: true }])
            )
        );
        // The refresh-time cap is 100; make this call's budget smaller.
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];

        const result = await opts.importIssues(many, onProgress);

        expect(resolveIssueKeys).toHaveBeenCalledTimes(3);
        expect((resolveIssueKeys as any).mock.calls[0][0].keys).toHaveLength(
          20
        );
        expect(onProgress).toHaveBeenLastCalledWith({
          lookups: 45,
          imported: 45,
        });
        expect(result).toMatchObject({ imported: 45, failed: 0, skipped: 0 });
      });

      it("leaves keys past the lookup cap for the next scan instead of failing them", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([]);
        // The refresh-time cap is 100 lookups; name 130 unknown tickets.
        const many = Array.from({ length: 130 }, (_, i) => ({
          raw: `PROJ-${i}`,
          exact: [`PROJ-${i}`],
        }));
        (resolveIssueKeys as any).mockImplementation(
          async ({ keys }: { keys: string[] }) =>
            new Map(
              keys.map((key) => [key, { key, issueId: 1, created: true }])
            )
        );
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];

        const result = await opts.importIssues(many, onProgress);

        expect(resolveIssueKeys).toHaveBeenCalledTimes(5);
        expect(onProgress).toHaveBeenLastCalledWith({
          lookups: 100,
          imported: 100,
        });
        expect(result).toMatchObject({
          imported: 100,
          failed: 0,
          skipped: 30,
          failures: [],
        });
      });

      it("counts a key the tracker now knows under another name as moved, not failed", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([]);
        (resolveIssueKeys as any).mockResolvedValue(
          new Map([
            ["PROJ-1", { key: "PROJ-1", error: "renamed", code: "moved" }],
            ["PROJ-2", { key: "PROJ-2", error: "HTTP 404", code: "upstream" }],
          ])
        );

        expect(await runImport()).toEqual({
          imported: 0,
          failed: 1,
          skipped: 0,
          moved: 1,
          failures: [{ key: "PROJ-2", error: "HTTP 404" }],
        });
      });

      it("does not ask Jira for prefixes that are not one of its projects", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([]);
        (resolveIssueKeys as any).mockResolvedValue(new Map());
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];

        await opts.importIssues(
          [
            { raw: "PROJ-5", exact: ["PROJ-5"] },
            { raw: "PHASE-33", exact: ["PHASE-33"] },
            { raw: "ID-24", exact: ["ID-24"] },
          ],
          onProgress
        );

        expect(resolveIssueKeys).toHaveBeenCalledWith(
          expect.objectContaining({ keys: ["PROJ-5"] })
        );
      });

      it("falls back to prefixes already imported when the tracker cannot list projects", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        mockGetAdapter.mockRejectedValue(new Error("no credentials"));
        db.issue.findMany
          // prefix lookup: tickets already on the integration
          .mockResolvedValueOnce([{ externalKey: "ABT-1" }])
          // held-key prefilter
          .mockResolvedValueOnce([]);
        (resolveIssueKeys as any).mockResolvedValue(new Map());
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];

        await opts.importIssues(
          [
            { raw: "ABT-9", exact: ["ABT-9"] },
            { raw: "ROUND-2", exact: ["ROUND-2"] },
          ],
          onProgress
        );

        expect(resolveIssueKeys).toHaveBeenCalledWith(
          expect.objectContaining({ keys: ["ABT-9"] })
        );
      });

      it("tries every key when neither the tracker nor local rows name a prefix", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        mockGetAdapter.mockResolvedValue(null);
        db.issue.findMany.mockResolvedValue([]);
        (resolveIssueKeys as any).mockResolvedValue(new Map());
        await refreshRepoCache(5, db);
        const [, , opts] = (syncIssuePins as any).mock.calls[0];

        await opts.importIssues(
          [{ raw: "NEW-1", exact: ["NEW-1"] }],
          onProgress
        );

        expect(resolveIssueKeys).toHaveBeenCalledWith(
          expect.objectContaining({ keys: ["NEW-1"] })
        );
      });

      it("counts keys the tracker could not answer as failures", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([]);
        (resolveIssueKeys as any).mockResolvedValue(
          new Map([
            ["PROJ-1", { key: "PROJ-1", issueId: 8, created: true }],
            ["PROJ-2", { key: "PROJ-2", error: "not found" }],
          ])
        );

        expect(await runImport()).toEqual({
          imported: 1,
          failed: 1,
          skipped: 0,
          moved: 0,
          failures: [{ key: "PROJ-2", error: "not found" }],
        });
      });

      it("imports nothing when the project has no usable issue tracker", async () => {
        (resolveIssueTrackerIntegration as any).mockRejectedValue(
          new IssueKeyResolutionError("no tracker", 400)
        );

        expect(await runImport()).toEqual({
          imported: 0,
          failed: 0,
          skipped: 0,
          moved: 0,
        });
        expect(resolveIssueKeys).not.toHaveBeenCalled();
      });

      it("treats a ticket another project pulled in as already here, not a failure", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        // Held on the integration by some other project.
        db.issue.findMany.mockResolvedValue([
          { externalKey: "PROJ-1", externalId: "10001" },
          { externalKey: "PROJ-2", externalId: "10002" },
        ]);

        expect(await runImport()).toEqual({
          imported: 0,
          failed: 0,
          skipped: 0,
          moved: 0,
        });
        expect(resolveIssueKeys).not.toHaveBeenCalled();
      });

      it("skips the tracker when every named key is already held", async () => {
        (resolveIssueTrackerIntegration as any).mockResolvedValue({
          integrationId: 3,
          provider: "JIRA",
        });
        db.issue.findMany.mockResolvedValue([
          { externalKey: "PROJ-1", externalId: null },
          { externalKey: "PROJ-2", externalId: null },
        ]);

        expect(await runImport()).toEqual({
          imported: 0,
          failed: 0,
          skipped: 0,
          moved: 0,
        });
        expect(resolveIssueKeys).not.toHaveBeenCalled();
      });
    });

    it("runs after the marker scan so its pins never collide with fresh markers", async () => {
      await refreshRepoCache(5, db);
      const markerOrder = (syncMarkerPins as any).mock.invocationCallOrder[0];
      const issueOrder = (syncIssuePins as any).mock.invocationCallOrder[0];
      expect(markerOrder).toBeLessThan(issueOrder);
    });

    it("skips the scan when the config has it switched off", async () => {
      db = makeDb(makeConfig({ issueScanEnabled: false }));

      await refreshRepoCache(5, db);

      expect(walkCommits).not.toHaveBeenCalled();
      expect(syncIssuePins).not.toHaveBeenCalled();
      expect(storedIssueReport()).toBeUndefined();
    });

    it("skips the scan for a QUICKSCRIPT config", async () => {
      db = makeDb(makeConfig({ purpose: "QUICKSCRIPT" }));

      await refreshRepoCache(5, db);

      expect(syncIssuePins).not.toHaveBeenCalled();
    });

    it("records a failed scan in the report without failing the refresh", async () => {
      (walkCommits as any).mockRejectedValue(new Error("no commits api"));

      const result = await refreshRepoCache(5, db);

      expect(result.success).toBe(true);
      expect(storedIssueReport()).toEqual({
        error: "no commits api",
        scannedAt: expect.any(String),
      });
    });
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

describe("scanRepoIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db = makeDb(makeConfig());
    (walkCommits as any).mockResolvedValue({
      commits: [],
      truncated: false,
      complete: true,
      fromCache: 0,
    });
    (syncIssuePins as any).mockResolvedValue({ created: 0, full: true });
    (createGitRepoAdapter as any).mockReturnValue(makeArchiveAdapter({}));
  });

  function issueReports(): any[] {
    return update.mock.calls
      .filter(([args]: any[]) => "issueScanReport" in args.data)
      .map(([args]: any[]) => args.data.issueScanReport);
  }

  it("walks the whole branch for a full scan with the full-scan caps", async () => {
    const report = await scanRepoIssues(5, db, { full: true });

    expect(walkCommits).toHaveBeenCalledWith(
      expect.anything(),
      "main",
      expect.objectContaining({
        lookbackDays: Number.POSITIVE_INFINITY,
        maxCommits: 20000,
        continueFromCache: true,
      })
    );
    const [, , opts] = (syncIssuePins as any).mock.calls[0];
    expect(opts).toMatchObject({ full: true, maxCommitFetches: 2000 });
    expect(issueReports()[0]).toMatchObject({ running: true, full: true });
    expect(report).toEqual({ created: 0, full: true });
    expect(issueReports().at(-1)).toEqual({ created: 0, full: true });
  });

  it("uses the recent window when not asked for a full scan", async () => {
    await scanRepoIssues(5, db);

    expect(walkCommits).toHaveBeenCalledWith(
      expect.anything(),
      "main",
      expect.objectContaining({ lookbackDays: 90, maxCommits: 300 })
    );
  });

  it("does not touch the file cache", async () => {
    await scanRepoIssues(5, db, { full: true });

    expect(repoFileCache.invalidate).not.toHaveBeenCalled();
    expect(repoFileCache.setFiles).not.toHaveBeenCalled();
  });

  it("refuses a config that is not for impact analysis", async () => {
    db = makeDb(makeConfig({ purpose: "QUICKSCRIPT" }));

    await expect(scanRepoIssues(5, db)).rejects.toThrow(
      "not an Impact repository"
    );
  });

  it("records a cancelled scan when the walk was stopped, without importing or syncing", async () => {
    (walkCommits as any).mockResolvedValue({
      commits: [{ sha: "c1", message: "PROJ-1", parents: ["c0"] }],
      truncated: true,
      complete: false,
      fromCache: 0,
      cancelled: true,
    });

    const report = await scanRepoIssues(5, db, {
      full: true,
      isCancelled: async () => true,
    });

    expect(report).toEqual({
      cancelled: true,
      full: true,
      scannedAt: expect.any(String),
    });
    expect(syncIssuePins).not.toHaveBeenCalled();
    expect(issueReports().at(-1)).toEqual(report);
    const [, , walkOpts] = (walkCommits as any).mock.calls[0];
    expect(typeof walkOpts.shouldStop).toBe("function");
  });

  it("records a cancelled scan when a cancel arrives during the pin sync", async () => {
    let cancelled = false;
    (syncIssuePins as any).mockImplementation(
      async (_db: unknown, _config: unknown, opts: any) => {
        cancelled = true;
        await opts.onProgress({ stage: "inspect", scannedCommits: 1 });
        return { created: 0 };
      }
    );

    const report = await scanRepoIssues(5, db, {
      isCancelled: async () => cancelled,
    });

    expect(report).toMatchObject({ cancelled: true, full: false });
  });

  it("records a failure before the walk, so the running flag is not left behind", async () => {
    (createGitRepoAdapter as any).mockImplementation(() => {
      throw new Error("bad credentials");
    });

    const report = await scanRepoIssues(5, db, { full: true });

    expect(report).toEqual({
      error: "bad credentials",
      scannedAt: expect.any(String),
    });
    expect(issueReports().at(-1)).toEqual(report);
  });

  it("records a failed walk as the report instead of throwing", async () => {
    (walkCommits as any).mockRejectedValue(new Error("rate limited"));

    const report = await scanRepoIssues(5, db, { full: true });

    expect(report).toEqual({
      error: "rate limited",
      scannedAt: expect.any(String),
    });
    expect(issueReports().at(-1)).toEqual(report);
  });
});
