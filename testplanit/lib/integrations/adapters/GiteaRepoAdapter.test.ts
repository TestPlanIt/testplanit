import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiteaRepoAdapter } from "./GiteaRepoAdapter";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock DNS resolution to avoid real lookups in tests
vi.mock("~/utils/ssrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/ssrf")>();
  return {
    ...actual,
    assertSsrfSafeResolved: vi.fn().mockResolvedValue(undefined),
  };
});

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
    text: () =>
      Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
    url: "https://gitea.example.com",
  };
}

const REPO = "https://gitea.example.com/api/v1/repos/myorg/myrepo";
const BASE_SHA = "0000000000000000000000000000000000000000";
const C1_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

function mockRoutes(routes: Array<[string | RegExp, unknown]>) {
  mockFetch.mockImplementation((url: string) => {
    const hit = routes.find(([matcher]) =>
      typeof matcher === "string" ? url === matcher : matcher.test(url)
    );
    return Promise.resolve(
      hit ? makeResponse(hit[1]) : makeResponse({ message: "Not Found" }, 404)
    );
  });
}

function fetchedUrls(): string[] {
  return mockFetch.mock.calls.map(([url]) => url as string);
}

function giteaCommit(
  sha: string,
  parents: string[],
  message: string,
  files?: unknown[]
) {
  return {
    sha,
    html_url: `https://gitea.example.com/myorg/myrepo/commit/${sha}`,
    commit: {
      message,
      author: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        date: "2026-09-01T10:00:00Z",
      },
    },
    parents: parents.map((p) => ({ sha: p })),
    ...(files ? { files } : {}),
  };
}

const C1_FILES = [
  { filename: "src/a.ts", status: "modified" },
  { filename: "src/b.ts", status: "modified" },
  { filename: "src/tmp.ts", status: "added" },
  { filename: "src/new.ts", status: "added" },
  {
    filename: "docs/new.md",
    status: "renamed",
    previous_filename: "docs/old.md",
  },
];

const C2_FILES = [
  { filename: "src/a.ts", status: "modified" },
  { filename: "src/b.ts", status: "removed" },
  { filename: "src/tmp.ts", status: "removed" },
  { filename: "src/new.ts", status: "modified" },
  { filename: "src/gone.ts", status: "removed" },
];

const RAW_ROUTES: Array<[string, string]> = [
  [`${REPO}/raw/src/a.ts?ref=${BASE_SHA}`, "line1\nline2\n"],
  [`${REPO}/raw/src/a.ts?ref=${HEAD_SHA}`, "line1\nline2 changed\n"],
  [`${REPO}/raw/src/b.ts?ref=${BASE_SHA}`, "gone\n"],
  [`${REPO}/raw/src/new.ts?ref=${HEAD_SHA}`, "export const x = 1;\n"],
  [`${REPO}/raw/docs/old.md?ref=${BASE_SHA}`, "# Title\n"],
  [`${REPO}/raw/docs/new.md?ref=${HEAD_SHA}`, "# Title\n\nMore.\n"],
  [`${REPO}/raw/src/gone.ts?ref=${BASE_SHA}`, "bye\n"],
];

describe("GiteaRepoAdapter", () => {
  let adapter: GiteaRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GiteaRepoAdapter(
      { personalAccessToken: "test-token-123" },
      { baseUrl: "https://gitea.example.com", owner: "myorg", repo: "myrepo" }
    );
    // Speed up tests by eliminating rate limit delays
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe("constructor", () => {
    it("stores credentials and settings", () => {
      expect((adapter as any).personalAccessToken).toBe("test-token-123");
      expect((adapter as any).owner).toBe("myorg");
      expect((adapter as any).repo).toBe("myrepo");
      expect((adapter as any).baseUrl).toBe("https://gitea.example.com");
    });

    it("strips trailing slash from baseUrl", () => {
      const a = new GiteaRepoAdapter(
        { personalAccessToken: "tok" },
        { baseUrl: "https://gitea.example.com/", owner: "o", repo: "r" }
      );
      expect((a as any).baseUrl).toBe("https://gitea.example.com");
    });

    it("throws with null settings since baseUrl is required", () => {
      expect(
        () => new GiteaRepoAdapter({ personalAccessToken: "tok" }, null)
      ).toThrow();
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from Gitea API", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      const branch = await adapter.getDefaultBranch();

      expect(branch).toBe("main");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitea.example.com/api/v1/repos/myorg/myrepo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token test-token-123",
          }),
        })
      );
    });
  });

  describe("listAllFiles", () => {
    it("resolves branch to tree SHA and lists files", async () => {
      // First call: get branch info
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: {
            commit: { tree: { sha: "tree-sha-abc" } },
            sha: "commit-sha",
          },
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
      expect(result.files[0].size).toBe(100);
      expect(result.files[1].path).toBe("src/utils/helper.ts");
      expect(result.truncated).toBe(false);
    });

    it("falls back to commit SHA if tree SHA not available", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { sha: "fallback-sha" },
        })
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          tree: [{ path: "README.md", type: "blob", size: 200 }],
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(1);
      // Verify the tree endpoint was called with the fallback SHA
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/git/trees/fallback-sha"),
        expect.any(Object)
      );
    });

    it("reports truncated when Gitea returns truncated: true", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc" } } },
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

    it("stops pagination when entries are fewer than page size", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc" } } },
        })
      );
      // Single page with fewer than 100 entries
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          tree: [
            { path: "a.ts", type: "blob", size: 10 },
            { path: "b.ts", type: "blob", size: 20 },
          ],
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2);
      // Should only make 2 fetch calls (branch + 1 tree page)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws when branch cannot be resolved to a tree SHA", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ commit: {} }));

      await expect(adapter.listAllFiles("main")).rejects.toThrow(
        "Could not resolve branch to a tree SHA"
      );
    });

    it("encodes owner and repo in URL", async () => {
      const a = new GiteaRepoAdapter(
        { personalAccessToken: "tok" },
        {
          baseUrl: "https://gitea.example.com",
          owner: "my org",
          repo: "my repo",
        }
      );
      (a as any).rateLimitDelay = 0;

      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc" } } },
        })
      );
      mockFetch.mockResolvedValueOnce(makeResponse({ tree: [] }));

      await a.listAllFiles("main");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/my%20org/my%20repo/branches/"),
        expect.any(Object)
      );
    });
  });

  describe("getFileContent", () => {
    it("fetches raw file content from Gitea API", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse("console.log('hello')"));

      const result = await adapter.getFileContent("src/index.ts", "main");
      expect(result).toBe("console.log('hello')");
    });

    it("includes ref parameter in URL", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse("content"));

      await adapter.getFileContent("src/index.ts", "feat/branch");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("?ref=feat%2Fbranch"),
        expect.any(Object)
      );
    });
  });

  describe("testConnection", () => {
    it("returns success with default branch", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "develop" })
      );

      const result = await adapter.testConnection();

      expect(result.success).toBe(true);
      expect(result.defaultBranch).toBe("develop");
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

  describe("authentication", () => {
    it("sends token in Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await adapter.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token test-token-123",
            Accept: "application/json",
          }),
        })
      );
    });
  });

  describe("listBranches", () => {
    it("paginates until a short page and flags the default branch", async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => ({
        name: i === 3 ? "main" : `feature/${i}`,
        commit: { id: `sha-${i}` },
        protected: i === 3,
      }));
      const page2 = [
        { name: "release/1.0", commit: { id: "sha-50" }, protected: false },
        { name: "hotfix", commit: { id: "sha-51" }, protected: true },
      ];
      mockRoutes([
        [REPO, { default_branch: "main" }],
        [`${REPO}/branches?page=1&limit=50`, page1],
        [`${REPO}/branches?page=2&limit=50`, page2],
      ]);

      const branches = await adapter.listBranches();

      expect(branches).toHaveLength(52);
      expect(branches[3]).toEqual({
        name: "main",
        sha: "sha-3",
        isDefault: true,
        protected: true,
      });
      expect(branches[51]).toEqual({
        name: "hotfix",
        sha: "sha-51",
        isDefault: false,
        protected: true,
      });
      expect(branches.filter((b) => b.isDefault)).toHaveLength(1);
      expect(fetchedUrls()).toEqual([
        REPO,
        `${REPO}/branches?page=1&limit=50`,
        `${REPO}/branches?page=2&limit=50`,
      ]);
    });

    it("stops at 500 branches", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === REPO) {
          return Promise.resolve(makeResponse({ default_branch: "main" }));
        }
        const page = Number(new URL(url).searchParams.get("page"));
        return Promise.resolve(
          makeResponse(
            Array.from({ length: 50 }, (_, i) => ({
              name: `b-${page}-${i}`,
              commit: { id: `sha-${page}-${i}` },
            }))
          )
        );
      });

      const branches = await adapter.listBranches();

      expect(branches).toHaveLength(500);
      expect(mockFetch).toHaveBeenCalledTimes(11);
      expect(fetchedUrls().at(-1)).toBe(`${REPO}/branches?page=10&limit=50`);
    });
  });

  describe("listCommits", () => {
    it("maps commits and reports hasMore when the page is full", async () => {
      mockRoutes([
        [
          /\/commits\?/,
          [
            giteaCommit(HEAD_SHA, [C1_SHA], "feat: second\n\nBody text"),
            giteaCommit(C1_SHA, [BASE_SHA], "feat: first"),
          ],
        ],
      ]);

      const result = await adapter.listCommits("main", { page: 2, perPage: 2 });

      expect(result.hasMore).toBe(true);
      expect(result.commits).toEqual([
        {
          sha: HEAD_SHA,
          shortSha: "2222222",
          message: "feat: second\n\nBody text",
          authorName: "Ada Lovelace",
          authorEmail: "ada@example.com",
          authoredAt: "2026-09-01T10:00:00Z",
          parents: [C1_SHA],
          url: `https://gitea.example.com/myorg/myrepo/commit/${HEAD_SHA}`,
        },
        expect.objectContaining({ sha: C1_SHA, parents: [BASE_SHA] }),
      ]);
      expect(fetchedUrls()).toEqual([
        `${REPO}/commits?sha=main&page=2&limit=2&stat=false&verification=false&files=false`,
      ]);
    });

    it("scopes the log to a path and reports no more pages", async () => {
      mockRoutes([[/\/commits\?/, [giteaCommit(C1_SHA, [BASE_SHA], "x")]]]);

      const result = await adapter.listCommits("feat/branch", {
        path: "src/a.ts",
      });

      expect(result.hasMore).toBe(false);
      expect(result.commits).toHaveLength(1);
      expect(fetchedUrls()[0]).toBe(
        `${REPO}/commits?sha=feat%2Fbranch&page=1&limit=30&stat=false&verification=false&files=false&path=src%2Fa.ts`
      );
    });

    it("clamps perPage to 100", async () => {
      mockRoutes([[/\/commits\?/, []]]);

      const result = await adapter.listCommits(HEAD_SHA, { perPage: 500 });

      expect(result).toEqual({ commits: [], hasMore: false });
      expect(fetchedUrls()[0]).toContain("&limit=100&");
    });
  });

  describe("compareCommits", () => {
    it("folds per-commit file lists oldest-first and diffs locally", async () => {
      mockRoutes([
        [
          `${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`,
          {
            total_commits: 2,
            commits: [
              giteaCommit(HEAD_SHA, [C1_SHA], "second"),
              giteaCommit(C1_SHA, [BASE_SHA], "first"),
            ],
          },
        ],
        [
          `${REPO}/git/commits/${C1_SHA}?stat=true&files=true&verification=false`,
          { sha: C1_SHA, files: C1_FILES },
        ],
        [
          `${REPO}/git/commits/${HEAD_SHA}?stat=true&files=true&verification=false`,
          { sha: HEAD_SHA, files: C2_FILES },
        ],
        ...RAW_ROUTES,
      ]);

      const result = await adapter.compareCommits(BASE_SHA, HEAD_SHA);

      const urls = fetchedUrls();
      expect(urls[0]).toBe(`${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`);
      expect(urls.filter((u) => u.includes("/git/commits/"))).toEqual([
        `${REPO}/git/commits/${C1_SHA}?stat=true&files=true&verification=false`,
        `${REPO}/git/commits/${HEAD_SHA}?stat=true&files=true&verification=false`,
      ]);
      expect(urls.filter((u) => u.includes("/raw/"))).toEqual([
        `${REPO}/raw/src/a.ts?ref=${BASE_SHA}`,
        `${REPO}/raw/src/a.ts?ref=${HEAD_SHA}`,
        `${REPO}/raw/src/b.ts?ref=${BASE_SHA}`,
        `${REPO}/raw/src/new.ts?ref=${HEAD_SHA}`,
        `${REPO}/raw/docs/old.md?ref=${BASE_SHA}`,
        `${REPO}/raw/docs/new.md?ref=${HEAD_SHA}`,
        `${REPO}/raw/src/gone.ts?ref=${BASE_SHA}`,
      ]);

      expect(
        result.files.map((f) => [
          f.path,
          f.status,
          f.previousPath,
          f.additions,
          f.deletions,
          f.isBinary,
        ])
      ).toEqual([
        ["src/a.ts", "modified", undefined, 1, 1, false],
        ["src/b.ts", "deleted", undefined, 0, 1, false],
        ["src/new.ts", "added", undefined, 1, 0, false],
        ["docs/new.md", "renamed", "docs/old.md", 2, 0, false],
        ["src/gone.ts", "deleted", undefined, 0, 1, false],
      ]);
      expect(result.files[0].patch).toBe(
        "@@ -1,2 +1,2 @@\n line1\n-line2\n+line2 changed\n"
      );
      expect(result.files[2].patch).toContain("+export const x = 1;");
      expect(result.files.some((f) => f.patchTruncated)).toBe(false);

      expect(result.commits.map((c) => c.sha)).toEqual([HEAD_SHA, C1_SHA]);
      expect(result).toMatchObject({
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        truncated: false,
        totalFiles: 5,
        aheadBy: 2,
      });
    });

    it("uses file lists embedded in the compare payload without refetching commits", async () => {
      mockRoutes([
        [
          `${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`,
          {
            total_commits: 2,
            commits: [
              giteaCommit(HEAD_SHA, [C1_SHA], "second", C2_FILES),
              giteaCommit(C1_SHA, [BASE_SHA], "first", C1_FILES),
            ],
          },
        ],
        ...RAW_ROUTES,
      ]);

      const result = await adapter.compareCommits(BASE_SHA, HEAD_SHA);

      expect(fetchedUrls().some((u) => u.includes("/git/commits/"))).toBe(
        false
      );
      expect(result.files.map((f) => [f.path, f.status])).toEqual([
        ["src/a.ts", "modified"],
        ["src/b.ts", "deleted"],
        ["src/new.ts", "added"],
        ["docs/new.md", "renamed"],
        ["src/gone.ts", "deleted"],
      ]);
    });

    it("walks an oldest-first payload without reversing it", async () => {
      mockRoutes([
        [
          `${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`,
          {
            total_commits: 2,
            commits: [
              giteaCommit(C1_SHA, [BASE_SHA], "first", [
                { filename: "src/x.ts", status: "added" },
              ]),
              giteaCommit(HEAD_SHA, [C1_SHA], "second", [
                { filename: "src/x.ts", status: "removed" },
              ]),
            ],
          },
        ],
      ]);

      const result = await adapter.compareCommits(BASE_SHA, HEAD_SHA);

      expect(result.files).toEqual([]);
      expect(result.totalFiles).toBe(0);
      expect(result.commits.map((c) => c.sha)).toEqual([HEAD_SHA, C1_SHA]);
    });

    it("caps the commit walk and flags truncation", async () => {
      mockRoutes([
        [
          `${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`,
          {
            total_commits: 2,
            commits: [
              giteaCommit(HEAD_SHA, [C1_SHA], "second", C2_FILES),
              giteaCommit(C1_SHA, [BASE_SHA], "first", [
                { filename: "src/new.ts", status: "added" },
              ]),
            ],
          },
        ],
        ...RAW_ROUTES,
      ]);

      const result = await adapter.compareCommits(BASE_SHA, HEAD_SHA, {
        maxCommits: 1,
      });

      expect(result.truncated).toBe(true);
      expect(result.commits.map((c) => c.sha)).toEqual([C1_SHA]);
      expect(result.files.map((f) => [f.path, f.status])).toEqual([
        ["src/new.ts", "added"],
      ]);
      expect(result.aheadBy).toBe(2);
    });

    it("flags truncation when a side cannot be fetched", async () => {
      mockRoutes([
        [
          `${REPO}/compare/${BASE_SHA}...${HEAD_SHA}`,
          {
            total_commits: 1,
            commits: [
              giteaCommit(HEAD_SHA, [BASE_SHA], "only", [
                { filename: "src/a.ts", status: "modified" },
              ]),
            ],
          },
        ],
        [`${REPO}/raw/src/a.ts?ref=${HEAD_SHA}`, "line1\n"],
      ]);

      const result = await adapter.compareCommits(BASE_SHA, HEAD_SHA);

      expect(result.truncated).toBe(true);
      expect(result.files).toEqual([
        expect.objectContaining({
          path: "src/a.ts",
          status: "modified",
          patchTruncated: true,
        }),
      ]);
      expect(result.files[0].patch).toBeUndefined();
    });

    it("reports servers without a compare endpoint as unsupported", async () => {
      mockRoutes([]);

      await expect(adapter.compareCommits(BASE_SHA, HEAD_SHA)).rejects.toThrow(
        "Commit compare is not supported by this Gitea/Gogs server"
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
