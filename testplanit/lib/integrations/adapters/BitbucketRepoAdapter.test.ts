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
});
