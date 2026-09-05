import { beforeEach, describe, expect, it, vi } from "vitest";
import { BitbucketRepoAdapter } from "./BitbucketRepoAdapter";

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

describe("BitbucketRepoAdapter", () => {
  let adapter: BitbucketRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BitbucketRepoAdapter(
      { email: "test@example.com", apiToken: "testtoken" },
      { workspace: "myworkspace", repoSlug: "myrepo" }
    );
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  describe("auth headers", () => {
    it("uses Basic auth with base64-encoded email:apiToken", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ mainbranch: { name: "main" } })
      );

      await adapter.getDefaultBranch();

      const expectedAuth = `Basic ${Buffer.from("test@example.com:testtoken").toString("base64")}`;
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
    it("returns mainbranch.name", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ mainbranch: { name: "master" } })
      );

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("master");
    });

    it("defaults to 'main' when mainbranch is missing", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}));

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("main");
    });
  });

  describe("listAllFiles", () => {
    it("uses max_depth for recursive listing", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/index.ts", type: "commit_file", size: 100 },
            { path: "src/utils/helper.ts", type: "commit_file", size: 50 },
          ],
          next: null,
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/utils/helper.ts");
      // Verify max_depth is included in the URL
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("max_depth="),
        expect.any(Object)
      );
    });

    it("queues directories deeper than max_depth for follow-up", async () => {
      // First response includes a directory (deeper than max_depth)
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/index.ts", type: "commit_file", size: 100 },
            { path: "src/deep", type: "commit_directory" },
          ],
          next: null,
        })
      );
      // Follow-up for the deep directory
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/deep/nested.ts", type: "commit_file", size: 50 },
          ],
          next: null,
        })
      );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/deep/nested.ts");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("deduplicates files returned across pages", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            values: [
              { path: "src/a.ts", type: "commit_file", size: 10 },
              { path: "src/b.ts", type: "commit_file", size: 20 },
            ],
            next: "https://api.bitbucket.org/page2",
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            values: [
              { path: "src/b.ts", type: "commit_file", size: 20 },
              { path: "src/c.ts", type: "commit_file", size: 30 },
            ],
            next: null,
          })
        );

      const result = await adapter.listAllFiles("main");

      expect(result.files).toHaveLength(3);
      expect(result.files.map((f) => f.path)).toEqual([
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
      ]);
    });

    it("paginates using next URL", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            values: [{ path: "a.ts", type: "commit_file", size: 10 }],
            next: "https://api.bitbucket.org/page2",
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            values: [{ path: "b.ts", type: "commit_file", size: 20 }],
            next: null,
          })
        );

      const result = await adapter.listAllFiles("main");
      expect(result.files).toHaveLength(2);
    });
  });

  describe("listFilesInPaths root handling", () => {
    it("lists the repo root as /src/<branch>/ (no '.' segment) for an empty base path", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [{ path: "CLAUDE.md", type: "commit_file", size: 100 }],
          next: null,
        })
      );

      const result = await adapter.listFilesInPaths("main", [""]);

      expect(result.files.map((f) => f.path)).toEqual(["CLAUDE.md"]);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/src/main/?");
      expect(calledUrl).not.toContain("/src/main/.");
    });

    it("normalizes a literal '.' base path to the repo root URL", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [{ path: "CLAUDE.md", type: "commit_file", size: 100 }],
          next: null,
        })
      );

      await adapter.listFilesInPaths("main", ["."]);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/src/main/?");
      expect(calledUrl).not.toContain("/src/main/.");
    });

    it("lists mixed root + scoped base paths correctly", async () => {
      // First seed "" (root)
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "CLAUDE.md", type: "commit_file", size: 100 },
            { path: "src/index.ts", type: "commit_file", size: 50 },
          ],
          next: null,
        })
      );
      // Second seed "src"
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/index.ts", type: "commit_file", size: 50 }, // dup
            { path: "src/util.ts", type: "commit_file", size: 60 },
          ],
          next: null,
        })
      );

      const result = await adapter.listFilesInPaths("main", ["", "src"]);

      expect(result.files.map((f) => f.path)).toEqual([
        "CLAUDE.md",
        "src/index.ts",
        "src/util.ts",
      ]);
      const rootUrl = mockFetch.mock.calls[0][0] as string;
      const srcUrl = mockFetch.mock.calls[1][0] as string;
      expect(rootUrl).toContain("/src/main/?");
      expect(srcUrl).toContain("/src/main/src?");
    });
  });

  describe("depth-bounded listing", () => {
    it("scans the root seed shallow (max_depth=1) and does not descend subdirs for a bounded glob", async () => {
      // Root listing at depth 1 returns top-level files plus subdirectories.
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "README.md", type: "commit_file", size: 100 },
            { path: "src", type: "commit_directory" },
            { path: "docs", type: "commit_directory" },
          ],
          next: null,
        })
      );

      const result = await adapter.listFilesInPaths("main", [""], undefined, {
        "": 1,
      });

      // Only the top-level file — subdirectories were NOT followed.
      expect(result.files.map((f) => f.path)).toEqual(["README.md"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("max_depth=1");
    });

    it("still recurses subdirectories for a deep glob (default depth)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/index.ts", type: "commit_file", size: 10 },
            { path: "src/deep", type: "commit_directory" },
          ],
          next: null,
        })
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            { path: "src/deep/nested.ts", type: "commit_file", size: 20 },
          ],
          next: null,
        })
      );

      const result = await adapter.listFilesInPaths(
        "main",
        ["src"],
        undefined,
        {
          src: 10,
        }
      );

      expect(result.files.map((f) => f.path)).toEqual([
        "src/index.ts",
        "src/deep/nested.ts",
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("rate-limited partial listing", () => {
    it("returns the files collected so far (truncated) instead of throwing", async () => {
      (adapter as any).maxRetries = 0;
      // First page succeeds...
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [{ path: "a.ts", type: "commit_file", size: 10 }],
          next: "https://api.bitbucket.org/page2",
        })
      );
      // ...second page is rate limited.
      mockFetch.mockResolvedValue(makeResponse({}, 429));

      const result = await adapter.listFilesInPaths("main", [""]);

      expect(result.truncated).toBe(true);
      expect(result.files.map((f) => f.path)).toEqual(["a.ts"]);
    });

    it("rethrows when rate limited before any files are collected", async () => {
      (adapter as any).maxRetries = 0;
      mockFetch.mockResolvedValue(makeResponse({}, 429));

      await expect(adapter.listFilesInPaths("main", [""])).rejects.toThrow(
        /rate limit/i
      );
    });
  });

  describe("non-JSON listing response", () => {
    it("throws a friendly error (not a raw SyntaxError) when a path resolves to a file body", async () => {
      // Bitbucket resolves a bad path to a FILE and returns its raw markdown body.
      (adapter as any).maxRetries = 0;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/markdown" }),
        json: () =>
          Promise.reject(new SyntaxError("Unexpected token '#' in JSON")),
        text: () => Promise.resolve("# CLAUDE.md\n\nProject docs go here."),
      });

      const promise = adapter.listFilesInPaths("main", ["docs"]);

      await expect(promise).rejects.toThrow(/non-JSON content/i);
      await expect(promise).rejects.not.toThrow(SyntaxError);
    });
  });

  describe("testConnection", () => {
    it("returns success with default branch", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ mainbranch: { name: "main" } })
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
  });

  describe("getAllFileContents (archive)", () => {
    async function makeZipResponse(
      entries: Record<string, string>,
      topDir = "myworkspace-myrepo-abc123"
    ) {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const [path, content] of Object.entries(entries)) {
        zip.file(`${topDir}/${path}`, content);
      }
      const buf: Buffer = await zip.generateAsync({ type: "nodebuffer" });
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      );
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(ab),
      };
    }

    it("downloads the zip archive from bitbucket.org and strips the top-level dir", async () => {
      mockFetch.mockResolvedValueOnce(
        await makeZipResponse({
          "src/foo.ts": "export const foo = 1;",
          "README.md": "# readme",
        })
      );

      const result = await adapter.getAllFileContents("main");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://bitbucket.org/myworkspace/myrepo/get/main.zip",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );
      expect(result).not.toBeNull();
      expect(result!.get("src/foo.ts")).toBe("export const foo = 1;");
      expect(result!.get("README.md")).toBe("# readme");
      // Top-level wrapper dir must be stripped from the keys.
      expect(
        [...result!.keys()].some((k) => k.startsWith("myworkspace-"))
      ).toBe(false);
    });

    it("returns only wantedPaths when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        await makeZipResponse({
          "src/foo.ts": "foo",
          "src/bar.ts": "bar",
          "README.md": "readme",
        })
      );

      const result = await adapter.getAllFileContents(
        "main",
        new Set(["src/foo.ts"])
      );

      expect([...result!.keys()]).toEqual(["src/foo.ts"]);
    });

    it("downloadArchiveTree derives the file list and lazily extracts contents", async () => {
      mockFetch.mockResolvedValueOnce(
        await makeZipResponse({
          "src/foo.ts": "foo",
          "src/bar.ts": "bar",
        })
      );

      const tree = await adapter.downloadArchiveTree("main");
      expect(tree).not.toBeNull();
      // File list derived from the archive (top-level dir stripped) — no
      // separate API tree-walk needed.
      expect(tree!.files.map((f) => f.path).sort()).toEqual([
        "src/bar.ts",
        "src/foo.ts",
      ]);

      // Contents are decompressed only for the requested subset.
      const contents = await tree!.getContents(new Set(["src/foo.ts"]));
      expect([...contents.keys()]).toEqual(["src/foo.ts"]);
      expect(contents.get("src/foo.ts")).toBe("foo");
    });
  });

  describe("listBranches", () => {
    it("follows next pages and flags the mainbranch as default", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ mainbranch: { name: "develop" } })
        )
        .mockResolvedValueOnce(
          makeResponse({
            values: [
              { name: "main", target: { hash: "aaa111" } },
              { name: "develop", target: { hash: "bbb222" } },
            ],
            next: "https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/refs/branches?page=2",
          })
        )
        .mockResolvedValueOnce(
          makeResponse({
            values: [{ name: "feature/x", target: { hash: "ccc333" } }],
          })
        );

      const branches = await adapter.listBranches();

      expect(branches).toEqual([
        { name: "main", sha: "aaa111", isDefault: false },
        { name: "develop", sha: "bbb222", isDefault: true },
        { name: "feature/x", sha: "ccc333", isDefault: false },
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/refs/branches?pagelen=100"
      );
      expect(mockFetch.mock.calls[2][0]).toBe(
        "https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/refs/branches?page=2"
      );
    });

    it("stops following pages at 500 branches", async () => {
      const page = (offset: number) =>
        Array.from({ length: 100 }, (_, i) => ({
          name: `b${offset + i}`,
          target: { hash: `${offset + i}` },
        }));
      mockFetch.mockResolvedValueOnce(
        makeResponse({ mainbranch: { name: "main" } })
      );
      for (let p = 0; p < 5; p++) {
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            values: page(p * 100),
            next: `https://api.bitbucket.org/page${p + 2}`,
          })
        );
      }

      const branches = await adapter.listBranches();

      expect(branches).toHaveLength(500);
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });
  });

  describe("listCommits", () => {
    const commit = {
      hash: "0123456789abcdef0123456789abcdef01234567",
      message: "feat: add thing\n\nLonger body.",
      author: {
        raw: "Jane Doe <jane@example.com>",
        user: { display_name: "Jane D." },
      },
      date: "2026-09-01T10:00:00+00:00",
      parents: [{ hash: "fedcba9876543210fedcba9876543210fedcba98" }],
      links: {
        html: {
          href: "https://bitbucket.org/myworkspace/myrepo/commits/0123456789abcdef0123456789abcdef01234567",
        },
      },
    };

    it("maps commits and reports hasMore from next", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [commit],
          next: "https://api.bitbucket.org/page2",
        })
      );

      const result = await adapter.listCommits("main");

      expect(result.hasMore).toBe(true);
      expect(result.commits).toEqual([
        {
          sha: "0123456789abcdef0123456789abcdef01234567",
          shortSha: "0123456",
          message: "feat: add thing\n\nLonger body.",
          authorName: "Jane D.",
          authorEmail: "jane@example.com",
          authoredAt: "2026-09-01T10:00:00+00:00",
          parents: ["fedcba9876543210fedcba9876543210fedcba98"],
          url: "https://bitbucket.org/myworkspace/myrepo/commits/0123456789abcdef0123456789abcdef01234567",
        },
      ]);
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/commits/main?pagelen=30&page=1"
      );
    });

    it("falls back to the raw author name when there is no user", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            {
              ...commit,
              author: { raw: "Anon Committer <anon@example.com>" },
            },
            { ...commit, hash: "abcdef1234567", author: { raw: "No Email" } },
          ],
        })
      );

      const result = await adapter.listCommits("main");

      expect(result.hasMore).toBe(false);
      expect(result.commits[0].authorName).toBe("Anon Committer");
      expect(result.commits[0].authorEmail).toBe("anon@example.com");
      expect(result.commits[1].authorName).toBe("No Email");
      expect(result.commits[1].authorEmail).toBeUndefined();
    });

    it("passes page, perPage (max 100) and path through", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ values: [] }));

      await adapter.listCommits("feature/x", {
        page: 3,
        perPage: 500,
        path: "src/index.ts",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/commits/feature%2Fx?pagelen=100&page=3&path=src%2Findex.ts"
      );
    });
  });

  describe("compareCommits", () => {
    const BASE = "1111111111111111111111111111111111111111";
    const HEAD = "2222222222222222222222222222222222222222";

    function makeTextResponse(text: string) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: () => Promise.reject(new SyntaxError("not json")),
        text: () => Promise.resolve(text),
      };
    }

    function row(
      status: string,
      oldPath: string | null,
      newPath: string | null,
      added = 0,
      removed = 0
    ) {
      return {
        type: "diffstat",
        status,
        lines_added: added,
        lines_removed: removed,
        old: oldPath ? { path: oldPath } : null,
        new: newPath ? { path: newPath } : null,
      };
    }

    const rawDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");

    const fullDiffstat = [
      row("modified", "src/a.ts", "src/a.ts", 1, 1),
      row("removed", "src/gone.ts", null, 0, 1),
      row("renamed", "old.ts", "new.ts", 1, 1),
      row("modified", "img.png", "img.png", 0, 0),
      row("added", null, "logo.bin", 0, 0),
    ];

    it("requests head..base for diffstat and diff, and head?exclude=base for commits", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse({ values: [], size: 0 }))
        .mockResolvedValueOnce(makeTextResponse(""))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD);

      expect(mockFetch.mock.calls[0][0]).toBe(
        `https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/diffstat/${HEAD}..${BASE}?pagelen=500`
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        `https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/diff/${HEAD}..${BASE}`
      );
      expect(mockFetch.mock.calls[2][0]).toBe(
        `https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/commits/${HEAD}?exclude=${BASE}&pagelen=100`
      );
      expect(result).toEqual({
        baseSha: BASE,
        headSha: HEAD,
        files: [],
        commits: [],
        truncated: false,
        totalFiles: 0,
      });
    });

    it("maps diffstat statuses, joins diff chunks by path and detects binaries", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ values: fullDiffstat, size: fullDiffstat.length })
        )
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(
          makeResponse({
            values: [
              {
                hash: HEAD,
                message: "head",
                author: { raw: "A <a@example.com>" },
                date: "2026-09-02T00:00:00+00:00",
                parents: [{ hash: BASE }],
              },
            ],
          })
        );

      const result = await adapter.compareCommits(BASE, HEAD);

      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(5);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].sha).toBe(HEAD);
      expect(result.commits[0].parents).toEqual([BASE]);

      expect(result.files).toEqual([
        {
          path: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          isBinary: false,
          patch: "@@ -1,2 +1,2 @@\n-old\n+new\n ctx",
        },
        {
          path: "src/gone.ts",
          status: "deleted",
          additions: 0,
          deletions: 1,
          isBinary: false,
          patch: "@@ -1 +0,0 @@\n-bye",
        },
        {
          path: "new.ts",
          previousPath: "old.ts",
          status: "renamed",
          additions: 1,
          deletions: 1,
          isBinary: false,
          patch: "@@ -1 +1 @@\n-x\n+y",
        },
        {
          path: "img.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          isBinary: true,
        },
        {
          path: "logo.bin",
          status: "added",
          additions: 0,
          deletions: 0,
          isBinary: true,
        },
      ]);
    });

    it("stops the diffstat listing at maxFiles and flags truncated", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            values: fullDiffstat.slice(0, 3),
            size: 5,
            next: "https://api.bitbucket.org/diffstat-page2",
          })
        )
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD, { maxFiles: 2 });

      expect(result.files.map((f) => f.path)).toEqual([
        "src/a.ts",
        "src/gone.ts",
      ]);
      expect(result.truncated).toBe(true);
      expect(result.totalFiles).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("follows diffstat next pages until the cap", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            values: fullDiffstat.slice(0, 2),
            next: "https://api.bitbucket.org/diffstat-page2",
          })
        )
        .mockResolvedValueOnce(makeResponse({ values: fullDiffstat.slice(2) }))
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD);

      expect(result.files).toHaveLength(5);
      expect(result.truncated).toBe(false);
      expect(result.totalFiles).toBe(5);
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://api.bitbucket.org/diffstat-page2"
      );
    });

    it("drops patches past maxFilesWithPatch with patchTruncated", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ values: fullDiffstat.slice(0, 3) })
        )
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD, {
        maxFilesWithPatch: 1,
      });

      expect(result.truncated).toBe(true);
      expect(result.files[0].patch).toBeDefined();
      expect(result.files[0].patchTruncated).toBeUndefined();
      expect(result.files[1].patch).toBeUndefined();
      expect(result.files[1].patchTruncated).toBe(true);
      expect(result.files[2].patch).toBeUndefined();
      expect(result.files[2].patchTruncated).toBe(true);
    });

    it("drops a single patch larger than maxPatchBytesPerFile", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ values: fullDiffstat.slice(0, 2) })
        )
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD, {
        maxPatchBytesPerFile: 25,
      });

      expect(result.truncated).toBe(true);
      expect(result.files[0].patch).toBeUndefined();
      expect(result.files[0].patchTruncated).toBe(true);
      expect(result.files[1].patch).toBe("@@ -1 +0,0 @@\n-bye");
      expect(result.files[1].patchTruncated).toBeUndefined();
    });

    it("stops attaching patches once maxTotalPatchBytes is reached", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ values: fullDiffstat.slice(0, 3) })
        )
        .mockResolvedValueOnce(makeTextResponse(rawDiff))
        .mockResolvedValueOnce(makeResponse({ values: [] }));

      const result = await adapter.compareCommits(BASE, HEAD, {
        maxTotalPatchBytes: 50,
      });

      expect(result.truncated).toBe(true);
      expect(result.files[0].patch).toBeDefined();
      expect(result.files[1].patch).toBeDefined();
      expect(result.files[2].patch).toBeUndefined();
      expect(result.files[2].patchTruncated).toBe(true);
    });

    it("caps the commit listing at maxCommits and flags truncated", async () => {
      const commit = (hash: string) => ({
        hash,
        message: hash,
        author: { raw: "A <a@example.com>" },
        date: "2026-09-02T00:00:00+00:00",
        parents: [],
      });
      mockFetch
        .mockResolvedValueOnce(makeResponse({ values: [], size: 0 }))
        .mockResolvedValueOnce(makeTextResponse(""))
        .mockResolvedValueOnce(
          makeResponse({
            values: [commit("aaaaaaa1"), commit("aaaaaaa2")],
            next: "https://api.bitbucket.org/commits-page2",
          })
        );

      const result = await adapter.compareCommits(BASE, HEAD, {
        maxCommits: 2,
      });

      expect(result.commits.map((c) => c.sha)).toEqual([
        "aaaaaaa1",
        "aaaaaaa2",
      ]);
      expect(result.truncated).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
  describe("listPullRequests", () => {
    function makeRawPr(id: number, overrides: Record<string, any> = {}) {
      return {
        id,
        title: `PR ${id}`,
        state: "OPEN",
        author: { nickname: "ada", display_name: "Ada Lovelace" },
        source: {
          branch: { name: `feature-${id}` },
          commit: { hash: `head${id}` },
        },
        destination: {
          branch: { name: "main" },
          commit: { hash: `base${id}` },
        },
        links: {
          html: {
            href: `https://bitbucket.org/myworkspace/myrepo/pull-requests/${id}`,
          },
        },
        updated_on: "2026-09-01T10:00:00Z",
        ...overrides,
      };
    }

    it("maps a pull request from the values array", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ values: [makeRawPr(11)] })
      );

      const result = await adapter.listPullRequests();

      expect(mockFetch.mock.calls[0][0]).toContain("/pullrequests?");
      expect(result.pullRequests).toEqual([
        {
          number: 11,
          title: "PR 11",
          state: "open",
          authorName: "ada",
          sourceBranch: "feature-11",
          targetBranch: "main",
          headSha: "head11",
          baseSha: "base11",
          url: "https://bitbucket.org/myworkspace/myrepo/pull-requests/11",
          updatedAt: "2026-09-01T10:00:00Z",
        },
      ]);
    });

    it("repeats the state parameter, which is how Bitbucket takes a set", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ values: [] }));

      await adapter.listPullRequests({ state: "all" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("state=OPEN");
      expect(url).toContain("state=MERGED");
      expect(url).toContain("state=DECLINED");
      expect(url).toContain("state=SUPERSEDED");
    });

    it("asks for both closed spellings, since Bitbucket has two", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ values: [] }));

      await adapter.listPullRequests({ state: "closed" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("state=DECLINED");
      expect(url).toContain("state=SUPERSEDED");
      expect(url).not.toContain("state=OPEN");
      expect(url).not.toContain("state=MERGED");
    });

    it("reads SUPERSEDED and DECLINED as closed", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          values: [
            makeRawPr(1, { state: "SUPERSEDED" }),
            makeRawPr(2, { state: "DECLINED" }),
            makeRawPr(3, { state: "MERGED" }),
          ],
        })
      );

      const result = await adapter.listPullRequests();

      expect(result.pullRequests.map((pr) => pr.state)).toEqual([
        "closed",
        "closed",
        "merged",
      ]);
    });

    it("takes hasMore from the provider's next link, not the page size", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ values: [makeRawPr(1)], next: "https://api/next" })
      );
      await expect(adapter.listPullRequests()).resolves.toMatchObject({
        hasMore: true,
      });

      mockFetch.mockResolvedValueOnce(makeResponse({ values: [makeRawPr(2)] }));
      await expect(adapter.listPullRequests()).resolves.toMatchObject({
        hasMore: false,
      });
    });

    it("clamps the page size to Bitbucket's lower maximum", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ values: [] }));

      await adapter.listPullRequests({ perPage: 100 });

      expect(mockFetch.mock.calls[0][0]).toContain("pagelen=50");
    });

    it("survives a payload with no values array", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ type: "error" }));

      const result = await adapter.listPullRequests();

      expect(result.pullRequests).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("getMergeBase", () => {
    it("asks for the revspec as a single encoded segment", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ hash: "m".repeat(40) }));

      const sha = await adapter.getMergeBase("main", "feature");

      expect(mockFetch.mock.calls[0][0]).toContain("/merge-base/main..feature");
      expect(sha).toBe("m".repeat(40));
    });

    it("returns null rather than throwing when the endpoint is unavailable", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ error: "nope" }, 404));

      await expect(adapter.getMergeBase("main", "feature")).resolves.toBeNull();
    });
  });
});
