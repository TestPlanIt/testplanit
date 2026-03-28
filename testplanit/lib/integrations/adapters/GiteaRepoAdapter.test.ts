import { beforeEach, describe, expect, it, vi } from "vitest";
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
    text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
    url: "https://gitea.example.com",
  };
}

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
      expect(() => new GiteaRepoAdapter(
        { personalAccessToken: "tok" },
        null
      )).toThrow();
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from Gitea API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

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
          commit: { commit: { tree: { sha: "tree-sha-abc" } }, sha: "commit-sha" },
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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ commit: {} })
      );

      await expect(adapter.listAllFiles("main")).rejects.toThrow(
        "Could not resolve branch to a tree SHA"
      );
    });

    it("encodes owner and repo in URL", async () => {
      const a = new GiteaRepoAdapter(
        { personalAccessToken: "tok" },
        { baseUrl: "https://gitea.example.com", owner: "my org", repo: "my repo" }
      );
      (a as any).rateLimitDelay = 0;

      mockFetch.mockResolvedValueOnce(
        makeResponse({
          commit: { commit: { tree: { sha: "abc" } } },
        })
      );
      mockFetch.mockResolvedValueOnce(
        makeResponse({ tree: [] })
      );

      await a.listAllFiles("main");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/my%20org/my%20repo/branches/"),
        expect.any(Object)
      );
    });
  });

  describe("getFileContent", () => {
    it("fetches raw file content from Gitea API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse("console.log('hello')")
      );

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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

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
});
