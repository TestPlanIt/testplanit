import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubRepoAdapter } from "./GitHubRepoAdapter";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

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
});
