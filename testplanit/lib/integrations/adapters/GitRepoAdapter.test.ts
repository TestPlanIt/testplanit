import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsRepoAdapter } from "./AzureDevOpsRepoAdapter";
import { BitbucketRepoAdapter } from "./BitbucketRepoAdapter";
import { GiteaRepoAdapter } from "./GiteaRepoAdapter";
import { GitHubRepoAdapter } from "./GitHubRepoAdapter";
import { GitLabRepoAdapter } from "./GitLabRepoAdapter";

// Stub fetch so adapters don't error
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
    url: "https://api.github.com/repos/test/test",
  };
}

// The factory uses require() which fails in Vitest's ESM context.
// Instead of testing the factory directly, test that each adapter can be
// instantiated correctly — which is what the factory does internally.

describe("GitRepoAdapter adapter instantiation", () => {
  const creds = { personalAccessToken: "test-token" };

  it("instantiates GitHubRepoAdapter with credentials and settings", () => {
    const adapter = new GitHubRepoAdapter(creds, {
      owner: "testorg",
      repo: "testrepo",
    });
    expect(adapter).toBeInstanceOf(GitHubRepoAdapter);
    expect((adapter as any).personalAccessToken).toBe("test-token");
    expect((adapter as any).owner).toBe("testorg");
    expect((adapter as any).repo).toBe("testrepo");
  });

  it("instantiates GitLabRepoAdapter with credentials and settings", () => {
    const adapter = new GitLabRepoAdapter(creds, {
      projectPath: "group/project",
    });
    expect(adapter).toBeInstanceOf(GitLabRepoAdapter);
    expect((adapter as any).projectPath).toBe("group/project");
  });

  it("instantiates BitbucketRepoAdapter with credentials and settings", () => {
    const adapter = new BitbucketRepoAdapter(
      { email: "user@example.com", apiToken: "token" },
      { workspace: "ws", repoSlug: "repo" }
    );
    expect(adapter).toBeInstanceOf(BitbucketRepoAdapter);
    expect((adapter as any).email).toBe("user@example.com");
    expect((adapter as any).workspace).toBe("ws");
  });

  it("instantiates AzureDevOpsRepoAdapter with credentials and settings", () => {
    const adapter = new AzureDevOpsRepoAdapter(creds, {
      organizationUrl: "https://dev.azure.com/myorg",
      project: "myproject",
      repositoryId: "myrepo",
    });
    expect(adapter).toBeInstanceOf(AzureDevOpsRepoAdapter);
    expect((adapter as any).project).toBe("myproject");
  });

  it("instantiates GiteaRepoAdapter with credentials and settings", () => {
    const adapter = new GiteaRepoAdapter(creds, {
      baseUrl: "https://gitea.example.com",
      owner: "testorg",
      repo: "testrepo",
    });
    expect(adapter).toBeInstanceOf(GiteaRepoAdapter);
    expect((adapter as any).personalAccessToken).toBe("test-token");
    expect((adapter as any).baseUrl).toBe("https://gitea.example.com");
    expect((adapter as any).owner).toBe("testorg");
    expect((adapter as any).repo).toBe("testrepo");
  });

  it("handles null settings gracefully", () => {
    const adapter = new GitHubRepoAdapter(creds, null);
    expect(adapter).toBeInstanceOf(GitHubRepoAdapter);
    expect((adapter as any).owner).toBe("");
    expect((adapter as any).repo).toBe("");
  });

  it("handles undefined settings gracefully", () => {
    const adapter = new GitHubRepoAdapter(creds, undefined);
    expect(adapter).toBeInstanceOf(GitHubRepoAdapter);
    expect((adapter as any).owner).toBe("");
    expect((adapter as any).repo).toBe("");
  });

  it("all adapters have required abstract methods", () => {
    const adapters = [
      new GitHubRepoAdapter(creds, {}),
      new GitLabRepoAdapter(creds, {}),
      new BitbucketRepoAdapter({ username: "u", appPassword: "p" }, {}),
      new AzureDevOpsRepoAdapter(creds, {}),
      new GiteaRepoAdapter(creds, { baseUrl: "https://gitea.example.com" }),
    ];

    for (const adapter of adapters) {
      expect(typeof adapter.listAllFiles).toBe("function");
      expect(typeof adapter.getDefaultBranch).toBe("function");
      expect(typeof adapter.testConnection).toBe("function");
      expect(typeof adapter.getFileContent).toBe("function");
    }
  });
});

describe("GitRepoAdapter redirect protection", () => {
  let adapter: GitHubRepoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubRepoAdapter(
      { personalAccessToken: "test-token" },
      { owner: "testorg", repo: "testrepo" }
    );
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).lastRequestTime = 0;
  });

  it("follows safe redirects with SSRF validation", async () => {
    // First response: redirect
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 301,
      statusText: "Moved",
      headers: new Headers({ Location: "https://api.github.com/repos/testorg/testrepo-new" }),
      url: "https://api.github.com/repos/testorg/testrepo",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });
    // Second response: actual data after redirect
    mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

    const branch = await adapter.getDefaultBranch();

    expect(branch).toBe("main");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second fetch should use redirect: "error" to prevent chains
    expect(mockFetch.mock.calls[1][1]).toEqual(
      expect.objectContaining({ redirect: "error" })
    );
  });

  it("rejects redirect with no Location header", async () => {
    // Disable retries so the redirect error propagates directly
    (adapter as any).maxRetries = 0;

    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: new Headers({}),
      url: "https://api.github.com/repos/testorg/testrepo",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    });

    await expect(adapter.getDefaultBranch()).rejects.toThrow(
      "Redirect (302) with no Location header"
    );
  });

  it("uses redirect: manual to prevent automatic redirect following", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ default_branch: "main" }));

    await adapter.getDefaultBranch();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" })
    );
  });
});
