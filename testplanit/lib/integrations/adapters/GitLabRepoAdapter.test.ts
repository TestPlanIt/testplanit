import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabRepoAdapter } from "./GitLabRepoAdapter";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

      const branch = await adapter.getDefaultBranch();
      expect(branch).toBe("main");
    });

    it("URL-encodes the project path", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
      );

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
          makeResponse(
            [{ path: "a.ts", type: "blob" }],
            200,
            { "X-Next-Page": "2" }
          )
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
      mockFetch.mockResolvedValueOnce(
        makeResponse({ default_branch: "main" })
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

    it("URL-encodes path and branch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("test"),
      });

      await adapter.getFileContent("src/my file.ts", "feat/branch");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "files/src%2Fmy%20file.ts/raw?ref=feat%2Fbranch"
        ),
        expect.any(Object)
      );
    });
  });
});
