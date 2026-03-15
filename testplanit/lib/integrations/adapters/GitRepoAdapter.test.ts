import { describe, expect, it, vi } from "vitest";
import { AzureDevOpsRepoAdapter } from "./AzureDevOpsRepoAdapter";
import { BitbucketRepoAdapter } from "./BitbucketRepoAdapter";
import { GitHubRepoAdapter } from "./GitHubRepoAdapter";
import { GitLabRepoAdapter } from "./GitLabRepoAdapter";

// Stub fetch so adapters don't error
vi.stubGlobal("fetch", vi.fn());

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
    ];

    for (const adapter of adapters) {
      expect(typeof adapter.listAllFiles).toBe("function");
      expect(typeof adapter.getDefaultBranch).toBe("function");
      expect(typeof adapter.testConnection).toBe("function");
      expect(typeof adapter.getFileContent).toBe("function");
    }
  });
});
