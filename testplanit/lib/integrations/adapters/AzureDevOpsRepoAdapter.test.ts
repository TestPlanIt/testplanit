import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsRepoAdapter } from "./AzureDevOpsRepoAdapter";

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("const x = 1;"),
      });

      const result = await adapter.getFileContent("src/index.ts", "main");
      expect(result).toBe("const x = 1;");
    });

    it("includes correct API version parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("test"),
      });

      await adapter.getFileContent("src/index.ts", "main");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api-version=7.0"),
        expect.any(Object)
      );
    });
  });
});
