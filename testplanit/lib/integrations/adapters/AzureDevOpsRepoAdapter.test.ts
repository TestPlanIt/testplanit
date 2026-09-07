import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsRepoAdapter } from "./AzureDevOpsRepoAdapter";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("~/utils/ssrf", () => ({
  assertSsrfSafeResolved: vi.fn().mockResolvedValue(undefined),
  isSsrfSafe: vi.fn().mockReturnValue(true),
}));

function makeResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function textResponse(body: string) {
  const resp = makeResponse({});
  resp.text = () => Promise.resolve(body);
  return resp;
}

function routeFetch(routes: Array<[string, any]>) {
  mockFetch.mockImplementation(async (url: string) => {
    const match = routes.find(([needle]) => url.includes(needle));
    if (!match) return makeResponse({}, 404);
    return typeof match[1] === "string"
      ? textResponse(match[1])
      : makeResponse(match[1]);
  });
}

function fetchedUrls(): string[] {
  return mockFetch.mock.calls.map((call) => call[0] as string);
}

const BASE = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";

describe("AzureDevOpsRepoAdapter", () => {
  let adapter: AzureDevOpsRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AzureDevOpsRepoAdapter(
      { personalAccessToken: "ado-pat-123" },
      {
        organizationUrl: "https://dev.azure.com/myorg",
        project: "myproject",
        repositoryId: "myrepo",
      }
    );
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  describe("constructor", () => {
    it("strips trailing slash from organizationUrl", () => {
      const a = new AzureDevOpsRepoAdapter(
        { personalAccessToken: "test" },
        {
          organizationUrl: "https://dev.azure.com/myorg/",
          project: "p",
          repositoryId: "r",
        }
      );
      expect((a as any).organizationUrl).toBe("https://dev.azure.com/myorg");
    });
  });

  describe("auth headers", () => {
    it("uses Basic auth with empty username and PAT as password", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ defaultBranch: "refs/heads/main" })
      );

      await adapter.getDefaultBranch();

      const expectedAuth = `Basic ${Buffer.from(":ado-pat-123").toString("base64")}`;
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        })
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("strips refs/heads/ prefix from default branch", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ defaultBranch: "refs/heads/main" })
      );

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("main");
    });

    it("handles branch without refs/heads/ prefix", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ defaultBranch: "develop" })
      );

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("develop");
    });

    it("defaults to 'main' when defaultBranch is null", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}));

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("main");
    });
  });

  describe("listAllFiles", () => {
    it("lists files filtering by gitObjectType blob", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          value: [
            { path: "/src/index.ts", gitObjectType: "blob", size: 100 },
            { path: "/src/", gitObjectType: "tree", size: 0 },
            { path: "/src/utils.ts", gitObjectType: "blob", size: 50 },
          ],
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2);
      // Leading slash should be stripped
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/utils.ts");
    });

    it("strips leading slash from file paths", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          value: [{ path: "/README.md", gitObjectType: "blob", size: 300 }],
        })
      );

      const result = await adapter.listAllFiles("main");
      expect(result.files[0].path).toBe("README.md");
    });
  });

  describe("testConnection", () => {
    it("returns success with default branch", async () => {
      // testConnection makes two API calls: repo info then getDefaultBranch
      mockFetch
        .mockResolvedValueOnce(makeResponse({ id: "repo-id" }))
        .mockResolvedValueOnce(
          makeResponse({ defaultBranch: "refs/heads/main" })
        );

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

    it("includes correct API version parameter", async () => {
      const resp = makeResponse({});
      resp.text = () => Promise.resolve("test");
      mockFetch.mockResolvedValueOnce(resp);

      await adapter.getFileContent("src/index.ts", "main");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api-version=7.0"),
        expect.any(Object)
      );
    });
  });

  describe("getFileContentAtCommit", () => {
    it("fetches item content with a commit version descriptor", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("const x = 2;"));

      const result = await adapter.getFileContentAtCommit("src/index.ts", HEAD);

      expect(result).toBe("const x = 2;");
      expect(fetchedUrls()[0]).toContain(
        `/items?path=src%2Findex.ts&versionDescriptor.version=${HEAD}&versionDescriptor.versionType=commit&api-version=7.0`
      );
    });
  });

  describe("listBranches", () => {
    it("strips refs/heads/ and marks the default branch", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ defaultBranch: "refs/heads/main" })
        )
        .mockResolvedValueOnce(
          makeResponse({
            value: [
              { name: "refs/heads/main", objectId: "aaa111" },
              { name: "refs/heads/feature/login", objectId: "bbb222" },
            ],
          })
        );

      const branches = await adapter.listBranches();

      expect(branches).toEqual([
        { name: "main", sha: "aaa111", isDefault: true },
        { name: "feature/login", sha: "bbb222", isDefault: false },
      ]);
      expect(fetchedUrls()[1]).toContain(
        "/refs?filter=heads/&$top=500&api-version=7.0"
      );
    });

    it("returns an empty list when the repo has no branches", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ defaultBranch: "refs/heads/main" })
        )
        .mockResolvedValueOnce(makeResponse({}));

      expect(await adapter.listBranches()).toEqual([]);
    });
  });

  describe("listCommits", () => {
    const commitPayload = {
      value: [
        {
          commitId: "abcdef1234567890abcdef1234567890abcdef12",
          comment: "Fix login\n\nLonger body",
          author: {
            name: "Ada",
            email: "ada@example.com",
            date: "2026-09-01T10:00:00Z",
          },
          remoteUrl: "https://dev.azure.com/myorg/_git/myrepo/commit/abcdef1",
        },
      ],
    };

    it("uses versionType=branch and default paging for a branch ref", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(commitPayload));

      const result = await adapter.listCommits("main");

      expect(fetchedUrls()[0]).toContain(
        "/commits?searchCriteria.itemVersion.version=main&searchCriteria.itemVersion.versionType=branch&searchCriteria.$top=30&searchCriteria.$skip=0&api-version=7.0"
      );
      expect(result.hasMore).toBe(false);
      expect(result.commits).toEqual([
        {
          sha: "abcdef1234567890abcdef1234567890abcdef12",
          shortSha: "abcdef1",
          message: "Fix login\n\nLonger body",
          authorName: "Ada",
          authorEmail: "ada@example.com",
          authoredAt: "2026-09-01T10:00:00Z",
          parents: [],
          url: "https://dev.azure.com/myorg/_git/myrepo/commit/abcdef1",
        },
      ]);
    });

    it("uses versionType=commit for a sha and translates page/perPage to $top/$skip", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(commitPayload));

      await adapter.listCommits(HEAD, { page: 3, perPage: 20 });

      expect(fetchedUrls()[0]).toContain(
        `searchCriteria.itemVersion.version=${HEAD}&searchCriteria.itemVersion.versionType=commit&searchCriteria.$top=20&searchCriteria.$skip=40`
      );
    });

    it("scopes to a path with a leading slash and caps perPage at 100", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ value: [] }));

      await adapter.listCommits("main", { perPage: 500, path: "src/app.ts" });

      const url = fetchedUrls()[0];
      expect(url).toContain("searchCriteria.$top=100");
      expect(url).toContain("searchCriteria.itemPath=%2Fsrc%2Fapp.ts");
    });

    it("reports hasMore when the page is full", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          value: [
            { commitId: "a".repeat(40), author: {} },
            { commitId: "b".repeat(40), author: {} },
          ],
        })
      );

      const result = await adapter.listCommits("main", { perPage: 2 });

      expect(result.hasMore).toBe(true);
      expect(result.commits[0].authorEmail).toBeUndefined();
    });
  });

  describe("compareCommits", () => {
    const commitsBetween = {
      value: [
        {
          commitId: "c".repeat(40),
          comment: "Change a",
          author: { name: "Ada", date: "2026-09-02T00:00:00Z" },
        },
      ],
    };

    it("drops folders and maps change types to statuses", async () => {
      routeFetch([
        [
          "/diffs/commits?",
          {
            allChangesIncluded: true,
            changes: [
              { item: { path: "/src", isFolder: true }, changeType: "edit" },
              {
                item: { path: "/docs", gitObjectType: "tree" },
                changeType: "add",
              },
              {
                item: { path: "/src/new.ts", gitObjectType: "blob" },
                changeType: "add",
              },
              {
                item: { path: "/src/mod.ts", gitObjectType: "blob" },
                changeType: "edit",
              },
              {
                item: { path: "/src/gone.ts", gitObjectType: "blob" },
                changeType: "delete",
              },
              {
                item: { path: "/src/renamed.ts", gitObjectType: "blob" },
                changeType: "edit, rename",
                sourceServerItem: "/src/original.ts",
              },
              {
                item: { path: "/src/moved.ts", gitObjectType: "blob" },
                changeType: "rename",
                sourceServerItem: "/src/old.ts",
              },
            ],
          },
        ],
        ["/items?", "same\n"],
        ["compareVersion.version", commitsBetween],
      ]);

      const result = await adapter.compareCommits(BASE, HEAD);

      expect(
        result.files.map((f) => [f.path, f.status, f.previousPath])
      ).toEqual([
        ["src/new.ts", "added", undefined],
        ["src/mod.ts", "modified", undefined],
        ["src/gone.ts", "deleted", undefined],
        ["src/renamed.ts", "renamed", "src/original.ts"],
        ["src/moved.ts", "renamed", "src/old.ts"],
      ]);
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(5);
      expect(fetchedUrls()[0]).toContain(
        `/diffs/commits?baseVersion=${BASE}&baseVersionType=commit&targetVersion=${HEAD}&targetVersionType=commit&$top=500&$skip=0&api-version=7.0`
      );
    });

    it("fetches the change list, then both sides at each commit, then the commits between", async () => {
      routeFetch([
        [
          "/diffs/commits?",
          {
            allChangesIncluded: true,
            changes: [
              {
                item: { path: "/src/a.ts", gitObjectType: "blob" },
                changeType: "edit",
              },
            ],
          },
        ],
        [`versionDescriptor.version=${BASE}`, "a\nb\n"],
        [`versionDescriptor.version=${HEAD}`, "a\nc\n"],
        ["compareVersion.version", commitsBetween],
      ]);

      const result = await adapter.compareCommits(BASE, HEAD);

      const urls = fetchedUrls();
      expect(urls).toHaveLength(4);
      expect(urls[0]).toContain("/diffs/commits?");
      expect(urls[1]).toContain(
        `/items?path=src%2Fa.ts&versionDescriptor.version=${BASE}&versionDescriptor.versionType=commit`
      );
      expect(urls[2]).toContain(
        `/items?path=src%2Fa.ts&versionDescriptor.version=${HEAD}&versionDescriptor.versionType=commit`
      );
      expect(urls[3]).toContain(
        `/commits?searchCriteria.itemVersion.version=${HEAD}&searchCriteria.itemVersion.versionType=commit&searchCriteria.compareVersion.version=${BASE}&searchCriteria.compareVersion.versionType=commit&searchCriteria.$top=250&api-version=7.0`
      );

      expect(result.files).toEqual([
        {
          path: "src/a.ts",
          previousPath: undefined,
          status: "modified",
          additions: 1,
          deletions: 1,
          isBinary: false,
          patch: "@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
        },
      ]);
      expect(result.commits).toEqual([
        {
          sha: "c".repeat(40),
          shortSha: "ccccccc",
          message: "Change a",
          authorName: "Ada",
          authorEmail: undefined,
          authoredAt: "2026-09-02T00:00:00Z",
          parents: [],
          url: undefined,
        },
      ]);
      expect(result.aheadBy).toBe(1);
      expect(result.baseSha).toBe(BASE);
      expect(result.headSha).toBe(HEAD);
    });

    it("fetches only the head side for an added file", async () => {
      routeFetch([
        [
          "/diffs/commits?",
          {
            allChangesIncluded: true,
            changes: [
              {
                item: { path: "/src/new.ts", gitObjectType: "blob" },
                changeType: "add",
              },
            ],
          },
        ],
        [`versionDescriptor.version=${HEAD}`, "x\ny\n"],
        ["compareVersion.version", { value: [] }],
      ]);

      const result = await adapter.compareCommits(BASE, HEAD);

      const itemUrls = fetchedUrls().filter((u) => u.includes("/items?"));
      expect(itemUrls).toHaveLength(1);
      expect(itemUrls[0]).toContain(`versionDescriptor.version=${HEAD}`);
      expect(result.files[0]).toMatchObject({
        path: "src/new.ts",
        status: "added",
        additions: 2,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+x\n+y\n",
      });
    });

    it("pages the change list with $skip until allChangesIncluded", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            allChangesIncluded: false,
            changes: [
              {
                item: { path: "/a.txt", gitObjectType: "blob" },
                changeType: "add",
              },
              { item: { path: "/dir", isFolder: true }, changeType: "add" },
            ],
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            allChangesIncluded: true,
            changes: [
              {
                item: { path: "/b.txt", gitObjectType: "blob" },
                changeType: "add",
              },
            ],
          })
        )
        .mockResolvedValueOnce(textResponse("a\n"))
        .mockResolvedValueOnce(textResponse("b\n"))
        .mockResolvedValueOnce(makeResponse({ value: [] }));

      const result = await adapter.compareCommits(BASE, HEAD);

      const urls = fetchedUrls();
      expect(urls[0]).toContain("$top=500&$skip=0&");
      expect(urls[1]).toContain("$top=500&$skip=2&");
      expect(result.files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
      expect(result.truncated).toBe(false);
    });

    it("stops at the file cap and reports truncated", async () => {
      routeFetch([
        [
          "/diffs/commits?",
          {
            allChangesIncluded: false,
            changes: [
              {
                item: { path: "/a.txt", gitObjectType: "blob" },
                changeType: "add",
              },
              {
                item: { path: "/b.txt", gitObjectType: "blob" },
                changeType: "add",
              },
            ],
          },
        ],
        ["/items?", "x\n"],
        ["compareVersion.version", { value: [] }],
      ]);

      const result = await adapter.compareCommits(BASE, HEAD, { maxFiles: 1 });

      expect(result.files.map((f) => f.path)).toEqual(["a.txt"]);
      expect(result.truncated).toBe(true);
      expect(result.totalFiles).toBeUndefined();
      expect(
        fetchedUrls().filter((u) => u.includes("/diffs/commits?"))
      ).toHaveLength(1);
    });
  });
  describe("listPullRequests", () => {
    function makeRawPr(id: number, overrides: Record<string, any> = {}) {
      return {
        pullRequestId: id,
        title: `PR ${id}`,
        status: "active",
        createdBy: { displayName: "Ada Lovelace" },
        sourceRefName: `refs/heads/feature-${id}`,
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: { commitId: `head${id}` },
        lastMergeTargetCommit: { commitId: `base${id}` },
        _links: {
          web: {
            href: `https://dev.azure.com/myorg/_git/myrepo/pullrequest/${id}`,
          },
        },
        creationDate: "2026-09-01T10:00:00Z",
        ...overrides,
      };
    }

    it("strips refs/heads/ from both branch names", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ value: [makeRawPr(21)] }));

      const result = await adapter.listPullRequests();

      expect(result.pullRequests).toEqual([
        {
          number: 21,
          title: "PR 21",
          state: "open",
          authorName: "Ada Lovelace",
          sourceBranch: "feature-21",
          targetBranch: "main",
          headSha: "head21",
          baseSha: "base21",
          url: "https://dev.azure.com/myorg/_git/myrepo/pullrequest/21",
          updatedAt: "2026-09-01T10:00:00Z",
        },
      ]);
    });

    it("reads completed as merged and abandoned as closed", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          value: [
            makeRawPr(1, { status: "completed" }),
            makeRawPr(2, { status: "abandoned" }),
            makeRawPr(3, { status: "active" }),
          ],
        })
      );

      const result = await adapter.listPullRequests();

      expect(result.pullRequests.map((pr) => pr.state)).toEqual([
        "merged",
        "closed",
        "open",
      ]);
    });

    it("maps each state onto Azure's own status vocabulary", async () => {
      const cases: Array<[any, string]> = [
        ["open", "active"],
        ["merged", "completed"],
        ["closed", "abandoned"],
        ["all", "all"],
      ];
      for (const [state, expected] of cases) {
        mockFetch.mockResolvedValueOnce(makeResponse({ value: [] }));
        await adapter.listPullRequests({ state });
        const url = mockFetch.mock.calls.at(-1)![0] as string;
        expect(url).toContain(`searchCriteria.status=${expected}`);
      }
    });

    it("pages by skip, because Azure has no page number", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ value: [] }));

      await adapter.listPullRequests({ page: 3, perPage: 20 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("$top=20");
      expect(url).toContain("$skip=40");
    });

    it("asks for the first page without skipping anything", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ value: [] }));

      await adapter.listPullRequests({ page: 1, perPage: 50 });

      expect(mockFetch.mock.calls[0][0]).toContain("$skip=0");
    });

    it("reports hasMore only when the page came back full", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ value: [makeRawPr(1), makeRawPr(2)] })
      );
      await expect(
        adapter.listPullRequests({ perPage: 2 })
      ).resolves.toMatchObject({ hasMore: true });

      mockFetch.mockResolvedValueOnce(makeResponse({ value: [makeRawPr(3)] }));
      await expect(
        adapter.listPullRequests({ perPage: 2 })
      ).resolves.toMatchObject({ hasMore: false });
    });

    it("survives a payload with no value array", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ count: 0 }));

      const result = await adapter.listPullRequests();

      expect(result.pullRequests).toEqual([]);
    });
  });

  describe("getMergeBase", () => {
    it("reads the first entry of the mergebases collection", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ value: [{ commitId: "m".repeat(40) }] })
      );

      const sha = await adapter.getMergeBase("main", "feature");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/commits/main/mergebases");
      expect(url).toContain("otherCommitId=feature");
      expect(sha).toBe("m".repeat(40));
    });

    it("returns null when the collection is empty", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ value: [] }));

      await expect(adapter.getMergeBase("main", "feature")).resolves.toBeNull();
    });

    it("returns null rather than throwing when the preview API is unavailable", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ message: "gone" }, 404));

      await expect(adapter.getMergeBase("main", "feature")).resolves.toBeNull();
    });
  });
});
