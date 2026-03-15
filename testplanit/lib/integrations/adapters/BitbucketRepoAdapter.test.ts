import { beforeEach, describe, expect, it, vi } from "vitest";
import { BitbucketRepoAdapter } from "./BitbucketRepoAdapter";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("const x = 1;"),
      });

      const result = await adapter.getFileContent("src/index.ts", "main");
      expect(result).toBe("const x = 1;");
    });
  });
});
