import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabRepoAdapter } from "./GitLabRepoAdapter";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("~/utils/ssrf", () => ({
  assertSsrfSafeResolved: vi.fn().mockResolvedValue(undefined),
  isSsrfSafe: vi.fn().mockReturnValue(true),
}));

const PROJECT_URL = "https://gitlab.com/api/v4/projects/mygroup%2Fmyproject";
const SAMPLE_DIFF = "@@ -1,3 +1,4 @@\n a\n-b\n+B\n+c\n d\n";

function gitlabCommit(overrides: Record<string, any> = {}) {
  return {
    id: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
    short_id: "a1b2c3d4",
    title: "Fix the thing",
    message: "Fix the thing\n\nLonger body.",
    author_name: "Jane Doe",
    author_email: "jane@example.com",
    authored_date: "2026-09-01T10:00:00.000+02:00",
    parent_ids: ["0000000000000000000000000000000000000001"],
    web_url: "https://gitlab.com/mygroup/myproject/-/commit/a1b2c3d4",
    ...overrides,
  };
}

function gitlabDiff(overrides: Record<string, any> = {}) {
  return {
    old_path: "src/a.ts",
    new_path: "src/a.ts",
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    diff: SAMPLE_DIFF,
    ...overrides,
  };
}

function compareResponse(diffs: any[], extra: Record<string, any> = {}) {
  return makeResponse({ commits: [], diffs, ...extra });
}

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

describe("GitLabRepoAdapter", () => {
  let adapter: GitLabRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitLabRepoAdapter(
      { personalAccessToken: "glpat-test123" },
      { projectPath: "mygroup/myproject", baseUrl: "https://gitlab.com" }
    );
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const a = new GitLabRepoAdapter(
        { personalAccessToken: "test" },
        { projectPath: "g/p", baseUrl: "https://gitlab.example.com/" }
      );
      // Verify by calling a method that uses the baseUrl
      expect((a as any).baseUrl).toBe("https://gitlab.example.com");
    });

    it("defaults baseUrl to https://gitlab.com", () => {
      const a = new GitLabRepoAdapter(
        { personalAccessToken: "test" },
        { projectPath: "g/p" }
      );
      expect((a as any).baseUrl).toBe("https://gitlab.com");
    });
  });

  describe("getDefaultBranch", () => {
    it("returns default branch", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("main");
    });

    it("URL-encodes the project path", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

      await adapter.getDefaultBranch();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.com/api/v4/projects/mygroup%2Fmyproject",
        expect.any(Object)
      );
    });

    it("uses numeric project ID directly without encoding", async () => {
      const numericAdapter = new GitLabRepoAdapter(
        { personalAccessToken: "test" },
        { projectPath: "12345" }
      );
      (numericAdapter as any).rateLimitDelay = 0;

      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "develop" })
      );

      await numericAdapter.getDefaultBranch();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.com/api/v4/projects/12345",
        expect.any(Object)
      );
    });
  });

  describe("listAllFiles", () => {
    it("lists files from recursive tree API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse(
          [
            { path: "src/index.ts", type: "blob" },
            { path: "src", type: "tree" },
            { path: "src/utils.ts", type: "blob" },
          ],
          200,
          {} // No X-Next-Page = single page
        )
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/utils.ts");
      // GitLab doesn't return file sizes in recursive tree
      expect(result.files[0].size).toBe(0);
    });

    it("paginates when X-Next-Page header is present", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse([{ path: "a.ts", type: "blob" }], 200, {
            "X-Next-Page": "2",
          })
        )
        .mockResolvedValueOnce(
          makeResponse(
            [{ path: "b.ts", type: "blob" }],
            200,
            {} // No next page
          )
        );

      const result = await adapter.listAllFiles("main");
      expect(result.files).toHaveLength(2);
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
      mockFetch.mockResolvedValueOnce(makeResponse({}, 401));

      const result = await adapter.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getFileContent", () => {
    it("fetches raw file content", async () => {
      const resp = makeResponse({});
      resp.text = () => Promise.resolve("const x = 1;");
      mockFetch.mockResolvedValueOnce(resp);

      const result = await adapter.getFileContent("src/index.ts", "main");
      expect(result).toBe("const x = 1;");
    });

    it("URL-encodes path and branch", async () => {
      const resp = makeResponse({});
      resp.text = () => Promise.resolve("test");
      mockFetch.mockResolvedValueOnce(resp);

      await adapter.getFileContent("src/my file.ts", "feat/branch");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "files/src%2Fmy%20file.ts/raw?ref=feat%2Fbranch"
        ),
        expect.any(Object)
      );
    });
  });

  describe("listBranches", () => {
    it("maps branches and flags the default", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          {
            name: "main",
            commit: { id: "abc123" },
            default: true,
            protected: true,
          },
          {
            name: "feature/x",
            commit: { id: "def456" },
            default: false,
            protected: false,
          },
        ])
      );

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${PROJECT_URL}/repository/branches?per_page=100&page=1`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test123",
          }),
        })
      );
      expect(branches).toEqual([
        { name: "main", sha: "abc123", isDefault: true, protected: true },
        {
          name: "feature/x",
          sha: "def456",
          isDefault: false,
          protected: false,
        },
      ]);
    });

    it("paginates while a page comes back full", async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        name: `b${i}`,
        commit: { id: `sha${i}` },
        default: false,
        protected: false,
      }));
      mockFetch
        .mockResolvedValueOnce(makeResponse(fullPage))
        .mockResolvedValueOnce(
          makeResponse([
            {
              name: "last",
              commit: { id: "zzz" },
              default: true,
              protected: false,
            },
          ])
        );

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        `${PROJECT_URL}/repository/branches?per_page=100&page=2`
      );
      expect(branches).toHaveLength(101);
      expect(branches[100]).toMatchObject({ name: "last", isDefault: true });
    });

    it("stops at 500 branches", async () => {
      for (let p = 0; p < 5; p++) {
        mockFetch.mockResolvedValueOnce(
          makeResponse(
            Array.from({ length: 100 }, (_, i) => ({
              name: `b${p * 100 + i}`,
              commit: { id: `sha${p * 100 + i}` },
              default: false,
              protected: false,
            }))
          )
        );
      }

      const branches = await adapter.listBranches();

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(branches).toHaveLength(500);
    });
  });

  describe("listCommits", () => {
    it("maps commits with default paging", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([gitlabCommit()]));

      const result = await adapter.listCommits("main");

      expect(mockFetch).toHaveBeenCalledWith(
        `${PROJECT_URL}/repository/commits?ref_name=main&per_page=30&page=1`,
        expect.any(Object)
      );
      expect(result.hasMore).toBe(false);
      expect(result.commits).toEqual([
        {
          sha: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
          shortSha: "a1b2c3d",
          message: "Fix the thing\n\nLonger body.",
          authorName: "Jane Doe",
          authorEmail: "jane@example.com",
          authoredAt: "2026-09-01T10:00:00.000+02:00",
          parents: ["0000000000000000000000000000000000000001"],
          url: "https://gitlab.com/mygroup/myproject/-/commit/a1b2c3d4",
        },
      ]);
    });

    it("scopes to a path and reports hasMore when the page is full", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([gitlabCommit({ id: "1111111abc" }), gitlabCommit()])
      );

      const result = await adapter.listCommits("feat/branch", {
        page: 3,
        perPage: 2,
        path: "src/app dir/x.ts",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${PROJECT_URL}/repository/commits?ref_name=feat%2Fbranch&per_page=2&page=3&path=src%2Fapp%20dir%2Fx.ts`,
        expect.any(Object)
      );
      expect(result.commits).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it("clamps perPage to 100", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));

      const result = await adapter.listCommits("main", { perPage: 500 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${PROJECT_URL}/repository/commits?ref_name=main&per_page=100&page=1`,
        expect.any(Object)
      );
      expect(result).toEqual({ commits: [], hasMore: false });
    });

    it("tolerates missing optional commit fields", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          gitlabCommit({
            author_email: null,
            web_url: undefined,
            parent_ids: undefined,
          }),
        ])
      );

      const { commits } = await adapter.listCommits("main");

      expect(commits[0].authorEmail).toBeUndefined();
      expect(commits[0].url).toBeUndefined();
      expect(commits[0].parents).toEqual([]);
    });
  });

  describe("compareCommits", () => {
    it("requests a straight compare and maps every status", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse(
          [
            gitlabDiff({
              old_path: "src/new.ts",
              new_path: "src/new.ts",
              new_file: true,
              diff: "@@ -0,0 +1,2 @@\n+x\n+y\n",
            }),
            gitlabDiff(),
            gitlabDiff({
              old_path: "src/gone.ts",
              new_path: "src/gone.ts",
              deleted_file: true,
              diff: "@@ -1,2 +0,0 @@\n-x\n-y\n",
            }),
            gitlabDiff({
              old_path: "src/old-name.ts",
              new_path: "src/new-name.ts",
              renamed_file: true,
              diff: "",
            }),
          ],
          { commits: [gitlabCommit()] }
        )
      );

      const result = await adapter.compareCommits("abc1234", "def5678");

      expect(mockFetch).toHaveBeenCalledWith(
        `${PROJECT_URL}/repository/compare?from=abc1234&to=def5678&straight=true`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "PRIVATE-TOKEN": "glpat-test123",
          }),
        })
      );
      expect(result.baseSha).toBe("abc1234");
      expect(result.headSha).toBe("def5678");
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(4);
      expect(result.files).toEqual([
        {
          path: "src/new.ts",
          status: "added",
          additions: 2,
          deletions: 0,
          isBinary: false,
          patch: "@@ -0,0 +1,2 @@\n+x\n+y\n",
        },
        {
          path: "src/a.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          isBinary: false,
          patch: SAMPLE_DIFF,
        },
        {
          path: "src/gone.ts",
          status: "deleted",
          additions: 0,
          deletions: 2,
          isBinary: false,
          patch: "@@ -1,2 +0,0 @@\n-x\n-y\n",
        },
        {
          path: "src/new-name.ts",
          previousPath: "src/old-name.ts",
          status: "renamed",
          additions: 0,
          deletions: 0,
          isBinary: false,
        },
      ]);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0]).toMatchObject({
        sha: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
        shortSha: "a1b2c3d",
        authorName: "Jane Doe",
      });
    });

    it("strips ---/+++ header lines so the patch starts at the first hunk", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff({
            diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
          }),
        ])
      );

      const { files } = await adapter.compareCommits("abc1234", "def5678");

      expect(files[0]).toMatchObject({
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-a\n+b\n",
      });
    });

    it("detects binary files from the diff text or an empty diff", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff({
            old_path: "logo.png",
            new_path: "logo.png",
            diff: "Binary files a/logo.png and b/logo.png differ\n",
          }),
          gitlabDiff({
            old_path: "blob.bin",
            new_path: "blob.bin",
            diff: "",
          }),
        ])
      );

      const { files, truncated } = await adapter.compareCommits(
        "abc1234",
        "def5678"
      );

      expect(truncated).toBe(false);
      expect(files).toEqual([
        {
          path: "logo.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          isBinary: true,
        },
        {
          path: "blob.bin",
          status: "modified",
          additions: 0,
          deletions: 0,
          isBinary: true,
        },
      ]);
    });

    it("drops the patch for too_large and collapsed diffs", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff({ diff: "", too_large: true }),
          gitlabDiff({
            old_path: "src/b.ts",
            new_path: "src/b.ts",
            collapsed: true,
          }),
        ])
      );

      const { files, truncated } = await adapter.compareCommits(
        "abc1234",
        "def5678"
      );

      expect(truncated).toBe(true);
      expect(files).toEqual([
        {
          path: "src/a.ts",
          status: "modified",
          additions: 0,
          deletions: 0,
          isBinary: false,
          patchTruncated: true,
        },
        {
          path: "src/b.ts",
          status: "modified",
          additions: 0,
          deletions: 0,
          isBinary: false,
          patchTruncated: true,
        },
      ]);
    });

    it("cuts the file list at maxFiles", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff(),
          gitlabDiff({ old_path: "src/b.ts", new_path: "src/b.ts" }),
          gitlabDiff({ old_path: "src/c.ts", new_path: "src/c.ts" }),
        ])
      );

      const result = await adapter.compareCommits("abc1234", "def5678", {
        maxFiles: 2,
      });

      expect(result.truncated).toBe(true);
      expect(result.totalFiles).toBe(3);
      expect(result.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("drops patches over maxPatchBytesPerFile but keeps the counts", async () => {
      mockFetch.mockResolvedValueOnce(compareResponse([gitlabDiff()]));

      const { files, truncated } = await adapter.compareCommits(
        "abc1234",
        "def5678",
        { maxPatchBytesPerFile: Buffer.byteLength(SAMPLE_DIFF) - 1 }
      );

      expect(truncated).toBe(true);
      expect(files[0]).toEqual({
        path: "src/a.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        isBinary: false,
        patchTruncated: true,
      });
    });

    it("stops attaching patches once maxTotalPatchBytes is reached", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff(),
          gitlabDiff({ old_path: "src/b.ts", new_path: "src/b.ts" }),
        ])
      );

      const { files, truncated } = await adapter.compareCommits(
        "abc1234",
        "def5678",
        { maxTotalPatchBytes: Buffer.byteLength(SAMPLE_DIFF) * 2 - 1 }
      );

      expect(truncated).toBe(true);
      expect(files[0].patch).toBe(SAMPLE_DIFF);
      expect(files[0].patchTruncated).toBeUndefined();
      expect(files[1].patch).toBeUndefined();
      expect(files[1].patchTruncated).toBe(true);
    });

    it("stops attaching patches past maxFilesWithPatch", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([
          gitlabDiff(),
          gitlabDiff({ old_path: "src/b.ts", new_path: "src/b.ts" }),
        ])
      );

      const { files, truncated } = await adapter.compareCommits(
        "abc1234",
        "def5678",
        { maxFilesWithPatch: 1 }
      );

      expect(truncated).toBe(true);
      expect(files[0].patch).toBe(SAMPLE_DIFF);
      expect(files[1]).toMatchObject({ additions: 2, deletions: 1 });
      expect(files[1].patch).toBeUndefined();
      expect(files[1].patchTruncated).toBe(true);
    });

    it("caps the commit list at maxCommits", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([], {
          commits: [gitlabCommit({ id: "1111111aaa" }), gitlabCommit()],
        })
      );

      const result = await adapter.compareCommits("abc1234", "def5678", {
        maxCommits: 1,
      });

      expect(result.truncated).toBe(true);
      expect(result.commits.map((c) => c.sha)).toEqual(["1111111aaa"]);
    });

    it("reports truncated when GitLab timed out the compare", async () => {
      mockFetch.mockResolvedValueOnce(
        compareResponse([gitlabDiff()], { compare_timeout: true })
      );

      const result = await adapter.compareCommits("abc1234", "def5678");

      expect(result.truncated).toBe(true);
      expect(result.files).toHaveLength(1);
    });
  });
  describe("listPullRequests", () => {
    function makeRawMr(iid: number, overrides: Record<string, any> = {}) {
      return {
        iid,
        title: `MR ${iid}`,
        state: "opened",
        author: { username: "ada", name: "Ada Lovelace" },
        source_branch: `feature-${iid}`,
        target_branch: "main",
        sha: `head${iid}`,
        web_url: `https://gitlab.com/mygroup/myproject/-/merge_requests/${iid}`,
        updated_at: "2026-09-01T10:00:00Z",
        ...overrides,
      };
    }

    it("reads merge requests and maps opened to open", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([makeRawMr(4)]));

      const result = await adapter.listPullRequests();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/merge_requests?");
      expect(url).toContain("order_by=updated_at&sort=desc");
      expect(result.pullRequests).toEqual([
        {
          number: 4,
          title: "MR 4",
          state: "open",
          authorName: "ada",
          sourceBranch: "feature-4",
          targetBranch: "main",
          headSha: "head4",
          baseSha: undefined,
          url: "https://gitlab.com/mygroup/myproject/-/merge_requests/4",
          updatedAt: "2026-09-01T10:00:00Z",
        },
      ]);
    });

    it("treats a locked merge request as closed", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          makeRawMr(1, { state: "locked" }),
          makeRawMr(2, { state: "merged" }),
          makeRawMr(3, { state: "closed" }),
        ])
      );

      const result = await adapter.listPullRequests();

      expect(result.pullRequests.map((pr) => pr.state)).toEqual([
        "closed",
        "merged",
        "closed",
      ]);
    });

    it("uses GitLab's own spelling of the open state", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));

      await adapter.listPullRequests({ state: "open" });

      expect(mockFetch.mock.calls[0][0]).toContain("state=opened");
    });

    it("sends no state parameter for all, which GitLab reads as unfiltered", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));

      await adapter.listPullRequests({ state: "all" });

      expect(mockFetch.mock.calls[0][0]).not.toContain("state=");
    });

    it("filters merged and closed at the API, since GitLab distinguishes them", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));
      await adapter.listPullRequests({ state: "merged" });
      expect(mockFetch.mock.calls[0][0]).toContain("state=merged");

      mockFetch.mockResolvedValueOnce(makeResponse([]));
      await adapter.listPullRequests({ state: "closed" });
      expect(mockFetch.mock.calls[1][0]).toContain("state=closed");
    });

    it("falls back to the numeric id when a merge request has no iid", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([{ ...makeRawMr(0), iid: undefined, id: 99 }])
      );

      const result = await adapter.listPullRequests();

      expect(result.pullRequests[0].number).toBe(99);
    });

    it("takes the base sha only when diff_refs is present", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([makeRawMr(5, { diff_refs: { base_sha: "base5" } })])
      );

      const result = await adapter.listPullRequests();

      expect(result.pullRequests[0].baseSha).toBe("base5");
    });

    it("reports hasMore only when the page came back full", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([makeRawMr(1), makeRawMr(2)])
      );
      await expect(
        adapter.listPullRequests({ perPage: 2 })
      ).resolves.toMatchObject({ hasMore: true });

      mockFetch.mockResolvedValueOnce(makeResponse([makeRawMr(3)]));
      await expect(
        adapter.listPullRequests({ perPage: 2 })
      ).resolves.toMatchObject({ hasMore: false });
    });
  });

  describe("getMergeBase", () => {
    it("passes both refs as a repeated refs[] parameter", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ id: "m".repeat(40) }));

      const sha = await adapter.getMergeBase("main", "feature");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/repository/merge_base?");
      expect(url).toContain("refs%5B%5D=main");
      expect(url).toContain("refs%5B%5D=feature");
      expect(sha).toBe("m".repeat(40));
    });

    it("returns null rather than throwing when the provider refuses", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ message: "404" }, 404));

      await expect(adapter.getMergeBase("main", "feature")).resolves.toBeNull();
    });
  });
});
