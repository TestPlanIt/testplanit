import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubRepoAdapter } from "./GitHubRepoAdapter";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// SSRF protection does live DNS resolution in the GitRepoAdapter base class
// (utils/ssrf.assertSsrfSafeResolved). api.github.com resolves at test time
// so the existing happy-path tests work, but unresolved hostnames like
// github.example.com fail with ENOTFOUND. Stub the SSRF checks so the GHES
// tests below can use a non-resolving demo hostname.
vi.mock("~/utils/ssrf", () => ({
  assertSsrfSafeResolved: vi.fn().mockResolvedValue(undefined),
  isSsrfSafe: vi.fn().mockReturnValue(true),
}));

function makeResponse(
  data: any,
  status = 200,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function makeRawBranch(name: string, overrides: Record<string, any> = {}) {
  return {
    name,
    commit: { sha: `sha-${name}` },
    protected: false,
    ...overrides,
  };
}

function makeRawCommit(sha: string, overrides: Record<string, any> = {}) {
  return {
    sha,
    html_url: `https://github.com/myorg/myrepo/commit/${sha}`,
    parents: [{ sha: "p".repeat(40) }],
    commit: {
      message: `commit ${sha}`,
      author: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        date: "2026-09-01T10:00:00Z",
      },
    },
    ...overrides,
  };
}

const DEFAULT_PATCH = "@@ -1 +1 @@\n-old\n+new";

function makeRawFile(overrides: Record<string, any> = {}) {
  return {
    filename: "src/app.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: DEFAULT_PATCH,
    ...overrides,
  };
}

function makeComparePage(
  files: Record<string, any>[],
  overrides: Record<string, any> = {}
) {
  return {
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    commits: [makeRawCommit("1".repeat(40))],
    files,
    ...overrides,
  };
}

describe("GitHubRepoAdapter", () => {
  let adapter: GitHubRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubRepoAdapter(
      { personalAccessToken: "ghp_test123" },
      { owner: "myorg", repo: "myrepo" }
    );
    // Speed up tests by eliminating rate limit delays
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from GitHub API", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      const branch = await adapter.getDefaultBranch();

      expect(branch).toBe("main");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/myorg/myrepo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token ghp_test123",
          }),
        })
      );
    });
  });

  describe("listAllFiles", () => {
    it("lists files from recursive tree API", async () => {
      // First call: get branch SHA
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc123" } } },
        })
      );
      // Second call: get tree
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          tree: [
            { path: "src/index.ts", type: "blob", size: 100 },
            { path: "src/utils", type: "tree", size: 0 },
            { path: "src/utils/helper.ts", type: "blob", size: 50 },
          ],
          truncated: false,
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2); // Only blobs
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/utils/helper.ts");
      expect(result.truncated).toBe(false);
    });

    it("reports truncated when GitHub returns truncated: true", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc123" } } },
        })
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          tree: [{ path: "src/index.ts", type: "blob", size: 100 }],
          truncated: true,
        })
      );

      const result = await adapter.listAllFiles("main");
      expect(result.truncated).toBe(true);
    });
  });

  describe("getFileContent", () => {
    it("decodes base64 content from GitHub API", async () => {
      const content = Buffer.from("console.log('hello')").toString("base64");
      mockFetch.mockResolvedValueOnce(makeResponse({ content }));

      const result = await adapter.getFileContent("src/index.ts", "main");
      expect(result).toBe("console.log('hello')");
    });

    it("encodes path and branch in URL", async () => {
      const content = Buffer.from("test").toString("base64");
      mockFetch.mockResolvedValueOnce(makeResponse({ content }));

      await adapter.getFileContent("src/my file.ts", "feat/branch");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "contents/src%2Fmy%20file.ts?ref=feat%2Fbranch"
        ),
        expect.any(Object)
      );
    });
  });

  describe("testConnection", () => {
    it("returns success with default branch", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      const result = await adapter.testConnection();

      expect(result.success).toBe(true);
      expect(result.defaultBranch).toBe("main");
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ message: "Not Found" }, 404)
      );

      const result = await adapter.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("listBranches", () => {
    const repoUrl = "https://api.github.com/repos/myorg/myrepo";

    it("paginates branches and flags the default branch", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          Array.from({ length: 100 }, (_, i) => makeRawBranch(`feature/${i}`))
        )
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          makeRawBranch("main", { protected: true }),
          makeRawBranch("release/1.0"),
        ])
      );

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toBe(repoUrl);
      expect(mockFetch.mock.calls[1][0]).toBe(
        `${repoUrl}/branches?per_page=100&page=1`
      );
      expect(mockFetch.mock.calls[2][0]).toBe(
        `${repoUrl}/branches?per_page=100&page=2`
      );
      expect(branches).toHaveLength(102);
      expect(branches[0]).toStrictEqual({
        name: "feature/0",
        sha: "sha-feature/0",
        isDefault: false,
        protected: false,
      });
      expect(branches.find((b) => b.name === "main")).toStrictEqual({
        name: "main",
        sha: "sha-main",
        isDefault: true,
        protected: true,
      });
      expect(branches.filter((b) => b.isDefault)).toHaveLength(1);
    });

    it("stops after a short page", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));
      mockFetch.mockResolvedValueOnce(
        makeResponse([makeRawBranch("main"), makeRawBranch("dev")])
      );

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(branches.map((b) => b.name)).toEqual(["main", "dev"]);
    });

    it("caps the listing at 500 branches", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));
      for (let page = 0; page < 5; page++) {
        mockFetch.mockResolvedValueOnce(
          makeResponse(
            Array.from({ length: 100 }, (_, i) =>
              makeRawBranch(`b${page * 100 + i}`)
            )
          )
        );
      }

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(6);
      expect(branches).toHaveLength(500);
    });
  });

  describe("listCommits", () => {
    const commitsUrl = "https://api.github.com/repos/myorg/myrepo/commits";

    it("maps commits and scopes the log to a path", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          makeRawCommit("a".repeat(40), {
            parents: [{ sha: "b".repeat(40) }, { sha: "c".repeat(40) }],
          }),
          makeRawCommit("b".repeat(40)),
        ])
      );

      const result = await adapter.listCommits("feat/branch", {
        page: 3,
        perPage: 2,
        path: "src/app.ts",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        `${commitsUrl}?sha=feat%2Fbranch&per_page=2&page=3&path=src%2Fapp.ts`
      );
      expect(result.hasMore).toBe(true);
      expect(result.commits).toHaveLength(2);
      expect(result.commits[0]).toStrictEqual({
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        message: `commit ${"a".repeat(40)}`,
        authorName: "Ada Lovelace",
        authorEmail: "ada@example.com",
        authoredAt: "2026-09-01T10:00:00Z",
        parents: ["b".repeat(40), "c".repeat(40)],
        url: `https://github.com/myorg/myrepo/commit/${"a".repeat(40)}`,
      });
    });

    it("defaults to page 1 of 30 and reports hasMore false on a short page", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([makeRawCommit("d".repeat(40))])
      );

      const result = await adapter.listCommits("main");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${commitsUrl}?sha=main&per_page=30&page=1`
      );
      expect(result.hasMore).toBe(false);
      expect(result.commits).toHaveLength(1);
    });

    it("clamps perPage to 100", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));

      const result = await adapter.listCommits("main", { perPage: 500 });

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${commitsUrl}?sha=main&per_page=100&page=1`
      );
      expect(result).toEqual({ commits: [], hasMore: false });
    });

    it("omits email and url when GitHub does not return them", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          {
            sha: "e".repeat(40),
            parents: [],
            commit: {
              message: "no metadata",
              author: { name: "Anon", date: "2026-09-02T00:00:00Z" },
            },
          },
        ])
      );

      const result = await adapter.listCommits("main");

      expect(result.commits[0]).toStrictEqual({
        sha: "e".repeat(40),
        shortSha: "eeeeeee",
        message: "no metadata",
        authorName: "Anon",
        authoredAt: "2026-09-02T00:00:00Z",
        parents: [],
      });
    });
  });

  describe("compareCommits", () => {
    const compareUrl =
      "https://api.github.com/repos/myorg/myrepo/compare/abc123...feat%2Fx";

    it("maps statuses, renames, binaries and commits from a single page", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage(
            [
              makeRawFile({
                filename: "src/new.ts",
                status: "added",
                additions: 3,
                deletions: 0,
                patch: "@@ -0,0 +1,3 @@\n+a\n+b\n+c",
              }),
              makeRawFile({ filename: "src/app.ts", status: "modified" }),
              makeRawFile({
                filename: "src/old.ts",
                status: "removed",
                additions: 0,
                deletions: 2,
                patch: "@@ -1,2 +0,0 @@\n-a\n-b",
              }),
              makeRawFile({
                filename: "src/renamed.ts",
                previous_filename: "src/original.ts",
                status: "renamed",
                additions: 0,
                deletions: 0,
                patch: undefined,
              }),
              makeRawFile({ filename: "src/copy.ts", status: "copied" }),
              makeRawFile({ filename: "src/mode.ts", status: "changed" }),
              makeRawFile({
                filename: "assets/logo.png",
                status: "modified",
                additions: 0,
                deletions: 0,
                patch: undefined,
              }),
            ],
            {
              ahead_by: 2,
              behind_by: 1,
              total_commits: 2,
              commits: [
                makeRawCommit("1".repeat(40)),
                makeRawCommit("2".repeat(40)),
              ],
            }
          )
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(
        `${compareUrl}?per_page=100&page=1`
      );
      expect(result.baseSha).toBe("abc123");
      expect(result.headSha).toBe("feat/x");
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(7);
      expect(result.aheadBy).toBe(2);
      expect(result.behindBy).toBe(1);
      expect(result.commits.map((c) => c.shortSha)).toEqual([
        "1111111",
        "2222222",
      ]);
      expect(result.files.map((f) => f.path)).toEqual([
        "src/new.ts",
        "src/app.ts",
        "src/old.ts",
        "src/renamed.ts",
        "src/copy.ts",
        "src/mode.ts",
        "assets/logo.png",
      ]);

      const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
      expect(byPath["src/new.ts"]).toStrictEqual({
        path: "src/new.ts",
        status: "added",
        additions: 3,
        deletions: 0,
        isBinary: false,
        patch: "@@ -0,0 +1,3 @@\n+a\n+b\n+c",
      });
      expect(byPath["src/app.ts"].status).toBe("modified");
      expect(byPath["src/app.ts"].patch).toBe(DEFAULT_PATCH);
      expect(byPath["src/old.ts"].status).toBe("deleted");
      expect(byPath["src/renamed.ts"]).toStrictEqual({
        path: "src/renamed.ts",
        previousPath: "src/original.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        isBinary: false,
      });
      expect(byPath["src/copy.ts"].status).toBe("added");
      expect(byPath["src/mode.ts"].status).toBe("modified");
      expect(byPath["assets/logo.png"]).toStrictEqual({
        path: "assets/logo.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        isBinary: true,
      });
    });

    it("paginates files across two pages and takes commits from the first", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage(
            Array.from({ length: 100 }, (_, i) =>
              makeRawFile({ filename: `src/file${i}.ts` })
            )
          )
        )
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([
            makeRawFile({ filename: "src/last-a.ts" }),
            makeRawFile({ filename: "src/last-b.ts" }),
          ])
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        `${compareUrl}?per_page=100&page=2`
      );
      expect(result.files).toHaveLength(102);
      expect(result.files[100].path).toBe("src/last-a.ts");
      expect(result.commits).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(102);
    });

    it("stops listing at maxFiles and reports truncated", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage(
            Array.from({ length: 100 }, (_, i) =>
              makeRawFile({ filename: `src/file${i}.ts` })
            )
          )
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxFiles: 5,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.files.map((f) => f.path)).toEqual([
        "src/file0.ts",
        "src/file1.ts",
        "src/file2.ts",
        "src/file3.ts",
        "src/file4.ts",
      ]);
      expect(result.truncated).toBe(true);
      expect(result.totalFiles).toBeUndefined();
    });

    it("treats a full page that lands exactly on maxFiles as truncated without fetching more", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage(
            Array.from({ length: 100 }, (_, i) =>
              makeRawFile({ filename: `src/file${i}.ts` })
            )
          )
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxFiles: 100,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.files).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    it("drops a patch over maxPatchBytesPerFile but keeps smaller ones", async () => {
      const bigPatch =
        "@@ -1 +1 @@\n-" + "x".repeat(200) + "\n+" + "y".repeat(200);
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([
            makeRawFile({ filename: "src/big.ts", patch: bigPatch }),
            makeRawFile({ filename: "src/small.ts" }),
          ])
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxPatchBytesPerFile: 100,
      });

      expect(result.files[0]).toStrictEqual({
        path: "src/big.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        isBinary: false,
        patchTruncated: true,
      });
      expect(result.files[0].patch).toBeUndefined();
      expect(result.files[1].patch).toBe(DEFAULT_PATCH);
      expect(result.files[1].patchTruncated).toBeUndefined();
      expect(result.truncated).toBe(true);
    });

    it("stops attaching patches after maxFilesWithPatch", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([
            makeRawFile({ filename: "src/one.ts" }),
            makeRawFile({ filename: "src/two.ts" }),
          ])
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxFilesWithPatch: 1,
      });

      expect(result.files[0].patch).toBe(DEFAULT_PATCH);
      expect(result.files[1].patch).toBeUndefined();
      expect(result.files[1].patchTruncated).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it("stops attaching patches once maxTotalPatchBytes is spent", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([
            makeRawFile({ filename: "src/one.ts" }),
            makeRawFile({ filename: "src/two.ts" }),
          ])
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxTotalPatchBytes: Buffer.byteLength(DEFAULT_PATCH) + 5,
      });

      expect(result.files[0].patch).toBe(DEFAULT_PATCH);
      expect(result.files[1].patch).toBeUndefined();
      expect(result.files[1].patchTruncated).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it("flags a text file whose patch GitHub omitted as patchTruncated", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([
            makeRawFile({
              filename: "src/huge.ts",
              additions: 5000,
              deletions: 10,
              patch: undefined,
            }),
          ])
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x");

      expect(result.files[0]).toStrictEqual({
        path: "src/huge.ts",
        status: "modified",
        additions: 5000,
        deletions: 10,
        isBinary: false,
        patchTruncated: true,
      });
      expect(result.truncated).toBe(true);
    });

    it("caps commits at maxCommits", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([], {
            total_commits: 3,
            commits: [
              makeRawCommit("1".repeat(40)),
              makeRawCommit("2".repeat(40)),
              makeRawCommit("3".repeat(40)),
            ],
          })
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x", {
        maxCommits: 2,
      });

      expect(result.commits.map((c) => c.shortSha)).toEqual([
        "1111111",
        "2222222",
      ]);
      expect(result.truncated).toBe(true);
    });

    it("reports truncated when GitHub returns fewer commits than total_commits", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          makeComparePage([makeRawFile()], {
            total_commits: 300,
            commits: [
              makeRawCommit("1".repeat(40)),
              makeRawCommit("2".repeat(40)),
            ],
          })
        )
      );

      const result = await adapter.compareCommits("abc123", "feat/x");

      expect(result.commits).toHaveLength(2);
      expect(result.files).toHaveLength(1);
      expect(result.truncated).toBe(true);
      expect(result.totalFiles).toBeUndefined();
    });
  });

  describe("GitHub Enterprise Server (custom base URL)", () => {
    it("falls back to api.github.com when the baseUrl setting is an empty string", async () => {
      const ghesAdapter = new GitHubRepoAdapter(
        { personalAccessToken: "ghp_test123" },
        { owner: "myorg", repo: "myrepo", baseUrl: "" }
      );
      (ghesAdapter as any).rateLimitDelay = 0;
      (ghesAdapter as any).lastRequestTime = 0;
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await expect(ghesAdapter.getDefaultBranch()).resolves.toBe("main");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/myorg/myrepo",
        expect.any(Object)
      );
    });

    it("hits the configured baseUrl instead of api.github.com", async () => {
      const ghesAdapter = new GitHubRepoAdapter(
        { personalAccessToken: "ghp_test123" },
        {
          owner: "myorg",
          repo: "myrepo",
          baseUrl: "https://github.example.com/api/v3",
        }
      );
      (ghesAdapter as any).rateLimitDelay = 0;
      (ghesAdapter as any).lastRequestTime = 0;
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await ghesAdapter.getDefaultBranch();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/repos/myorg/myrepo",
        expect.any(Object)
      );
    });

    it("normalizes a trailing slash on the baseUrl", async () => {
      const ghesAdapter = new GitHubRepoAdapter(
        { personalAccessToken: "ghp_test123" },
        {
          owner: "myorg",
          repo: "myrepo",
          baseUrl: "https://github.example.com/api/v3/",
        }
      );
      (ghesAdapter as any).rateLimitDelay = 0;
      (ghesAdapter as any).lastRequestTime = 0;
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await ghesAdapter.getDefaultBranch();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.example.com/api/v3/repos/myorg/myrepo",
        expect.any(Object)
      );
    });

    it("defaults to api.github.com when baseUrl is omitted", async () => {
      const ghComAdapter = new GitHubRepoAdapter(
        { personalAccessToken: "ghp_test123" },
        { owner: "myorg", repo: "myrepo" }
      );
      (ghComAdapter as any).rateLimitDelay = 0;
      (ghComAdapter as any).lastRequestTime = 0;
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await ghComAdapter.getDefaultBranch();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/myorg/myrepo",
        expect.any(Object)
      );
    });
  });
});
