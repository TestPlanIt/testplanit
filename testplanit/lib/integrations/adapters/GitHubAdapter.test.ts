import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAdapter } from "./GitHubAdapter";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHubAdapter", () => {
  let adapter: GitHubAdapter;

  const mockGitHubIssue = {
    number: 42,
    title: "Test Issue",
    body: "This is a test issue description",
    state: "open",
    html_url: "https://github.com/testowner/testrepo/issues/42",
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    user: {
      login: "reporter-user",
      email: "reporter@example.com",
    },
    assignee: {
      login: "assignee-user",
      email: "assignee@example.com",
    },
    labels: [{ name: "bug" }, { name: "priority:high" }],
    repository_url: "https://api.github.com/repos/testowner/testrepo",
  };

  const mockSearchResponse = {
    total_count: 2,
    incomplete_results: false,
    items: [
      mockGitHubIssue,
      {
        ...mockGitHubIssue,
        number: 43,
        title: "Another Issue",
        html_url: "https://github.com/testowner/testrepo/issues/43",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitHubAdapter({
      repository: "testowner/testrepo",
      provider: "GITHUB",
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities for GitHub", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: false,
        attachments: false,
        linkedIssues: true,
        comments: true,
      });
    });
  });

  describe("authenticate", () => {
    it("should authenticate successfully with valid PAT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });

      await adapter.authenticate({
        type: "api_key",
        apiKey: "ghp_valid_token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "token ghp_valid_token",
          }),
        })
      );
    });

    it("should throw error for invalid authentication type", async () => {
      await expect(
        adapter.authenticate({
          type: "oauth",
          accessToken: "some_token",
        })
      ).rejects.toThrow(
        "GitHub adapter only supports Personal Access Token authentication"
      );
    });

    it("should throw error when PAT is missing", async () => {
      await expect(
        adapter.authenticate({
          type: "api_key",
        })
      ).rejects.toThrow(
        "Personal Access Token is required for GitHub authentication"
      );
    });

    it("should throw error for invalid PAT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Bad credentials"),
      });

      await expect(
        adapter.authenticate({
          type: "api_key",
          apiKey: "invalid_token",
        })
      ).rejects.toThrow();
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      // Authenticate first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should create an issue successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      const result = await adapter.createIssue({
        title: "Test Issue",
        description: "This is a test issue description",
        projectId: "testowner/testrepo",
        labels: ["bug"],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/testowner/testrepo/issues",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Test Issue",
            body: "This is a test issue description",
            labels: ["bug"],
            assignees: undefined,
          }),
        })
      );

      expect(result).toEqual({
        id: "42",
        key: "#42",
        title: "Test Issue",
        description: "This is a test issue description",
        status: "open",
        priority: undefined,
        assignee: {
          id: "assignee-user",
          name: "assignee-user",
          email: "assignee@example.com",
        },
        reporter: {
          id: "reporter-user",
          name: "reporter-user",
          email: "reporter@example.com",
        },
        labels: ["bug", "priority:high"],
        customFields: {
          _github_owner: "testowner",
          _github_repo: "testrepo",
        },
        createdAt: new Date("2024-01-15T10:00:00Z"),
        updatedAt: new Date("2024-01-15T12:00:00Z"),
        url: "https://github.com/testowner/testrepo/issues/42",
      });
    });

    it("should create an issue with assignee", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        projectId: "testowner/testrepo",
        assigneeId: "some-user",
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"assignees":["some-user"]'),
        })
      );
    });

    it("should throw error when repository not configured", async () => {
      const adapterNoRepo = new GitHubAdapter({ provider: "GITHUB" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapterNoRepo.authenticate({
        type: "api_key",
        apiKey: "ghp_test_token",
      });

      await expect(
        adapterNoRepo.createIssue({
          title: "Test Issue",
          projectId: "invalid",
        })
      ).rejects.toThrow("GitHub repository not configured");
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should update issue title", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...mockGitHubIssue, title: "Updated Title" }),
      });

      await adapter.updateIssue("42", { title: "Updated Title" });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/testowner/testrepo/issues/42",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        })
      );
    });

    it("should update issue status to closed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGitHubIssue, state: "closed" }),
      });

      await adapter.updateIssue("42", { status: "closed" });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ state: "closed" }),
        })
      );
    });

    it("should map 'done' status to closed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGitHubIssue, state: "closed" }),
      });

      await adapter.updateIssue("42", { status: "done" });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ state: "closed" }),
        })
      );
    });

    it("should update multiple fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      await adapter.updateIssue("42", {
        title: "New Title",
        description: "New description",
        labels: ["enhancement"],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            title: "New Title",
            body: "New description",
            labels: ["enhancement"],
          }),
        })
      );
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should get issue by number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      const result = await adapter.getIssue("42");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/testowner/testrepo/issues/42",
        expect.any(Object)
      );
      expect(result.id).toBe("42");
      expect(result.title).toBe("Test Issue");
    });

    it("should get issue with # prefix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      await adapter.getIssue("#42");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/testowner/testrepo/issues/42",
        expect.any(Object)
      );
    });

    it("should get issue with full repo context", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      await adapter.getIssue("otherowner/otherrepo#123");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/otherowner/otherrepo/issues/123",
        expect.any(Object)
      );
    });

    it("should throw error when repository not configured", async () => {
      const adapterNoRepo = new GitHubAdapter({ provider: "GITHUB" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapterNoRepo.authenticate({
        type: "api_key",
        apiKey: "ghp_test_token",
      });

      await expect(adapterNoRepo.getIssue("42")).rejects.toThrow(
        "GitHub repository not configured"
      );
    });
  });

  describe("getLinkedIssues", () => {
    const mockSubIssuesResponse = [
      {
        id: 1234567,
        number: 42,
        title: "Sub one",
        html_url: "https://github.com/testowner/testrepo/issues/42",
      },
      {
        id: 1234568,
        number: 43,
        title: "Sub two",
        html_url: "https://github.com/testowner/testrepo/issues/43",
      },
    ];

    const mockTimelineResponse = [
      { event: "labeled", actor: { login: "u" } },
      {
        event: "cross-referenced",
        actor: { login: "u" },
        source: {
          type: "issue",
          issue: {
            id: 9876543,
            number: 99,
            repository: { full_name: "acme/other-repo" },
          },
        },
      },
      { event: "closed", actor: { login: "u" } },
    ];

    beforeEach(async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
      // Disable retry + rate-limit in this suite. We're testing the
      // sub_issues / timeline routing inside getLinkedIssues, not the
      // BaseAdapter retry loop. With retries enabled, a single rejected
      // mock would be re-fetched and consume the next mock in the queue
      // (e.g., the one intended for the parallel timeline call), leading
      // to wrong-call mock attribution. Retry behavior is covered by the
      // BaseAdapter tests separately.
      (adapter as any).maxRetries = 0;
      (adapter as any).rateLimitDelay = 0;
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should return refs from both sub_issues and cross-referenced timeline events on the happy path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSubIssuesResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTimelineResponse),
      });

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          {
            id: "1234567",
            key: "#42",
            linkType: "sub_issue",
            direction: "outward",
          },
          {
            id: "1234568",
            key: "#43",
            linkType: "sub_issue",
            direction: "outward",
          },
          {
            id: "9876543",
            key: "#99",
            linkType: "cross_referenced",
            direction: "inward",
          },
        ])
      );

      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/testowner/testrepo/issues/42/sub_issues")
        )
      ).toBe(true);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/testowner/testrepo/issues/42/timeline")
        )
      ).toBe(true);
    });

    it("should send GitHub Accept and X-GitHub-Api-Version headers on both sub_issues and timeline fetches", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSubIssuesResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTimelineResponse),
      });

      await adapter.getLinkedIssues!("42");

      const subIssuesCall = mockFetch.mock.calls.find((c) =>
        (c[0] as string).includes("/sub_issues")
      );
      const timelineCall = mockFetch.mock.calls.find((c) =>
        (c[0] as string).includes("/timeline")
      );
      expect(subIssuesCall).toBeDefined();
      expect(timelineCall).toBeDefined();
      const subHeaders = (subIssuesCall![1] as RequestInit).headers as Record<
        string,
        string
      >;
      const timelineHeaders = (timelineCall![1] as RequestInit)
        .headers as Record<string, string>;
      expect(subHeaders["Accept"]).toBe("application/vnd.github+json");
      expect(subHeaders["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(timelineHeaders["Accept"]).toBe("application/vnd.github+json");
      expect(timelineHeaders["X-GitHub-Api-Version"]).toBe("2022-11-28");
    });

    it("should return only sub_issues entries when timeline call fails with 503 and log at error level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSubIssuesResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: () => Promise.resolve("Service Unavailable"),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.linkType === "sub_issue")).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("timeline");
      errorSpy.mockRestore();
    });

    it("should return only cross-referenced entries when sub_issues call fails with 403 and log at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTimelineResponse),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toHaveLength(1);
      expect(result[0].linkType).toBe("cross_referenced");
      expect(result[0].direction).toBe("inward");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("sub_issues");
      warnSpy.mockRestore();
    });

    it("should return [] and log error twice when both sub_issues and timeline fail with 5xx", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: () => Promise.resolve("Bad Gateway"),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: () => Promise.resolve("Bad Gateway"),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      errorSpy.mockRestore();
    });

    it("should return only cross-referenced entries when sub_issues raises a network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTimelineResponse),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toHaveLength(1);
      expect(result[0].linkType).toBe("cross_referenced");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("sub_issues");
      errorSpy.mockRestore();
    });

    it("should filter timeline events to only cross-referenced ones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { event: "labeled", actor: { login: "u" } },
            {
              event: "cross-referenced",
              actor: { login: "u" },
              source: {
                type: "issue",
                issue: { id: 1, number: 1 },
              },
            },
            { event: "closed", actor: { login: "u" } },
          ]),
      });

      const result = await adapter.getLinkedIssues!("42");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "1",
        key: "#1",
        linkType: "cross_referenced",
        direction: "inward",
      });
    });

    it("should parse owner/repo#number form for both sub_issues and timeline URLs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.getLinkedIssues!("acme/widgets#42");

      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/acme/widgets/issues/42/sub_issues")
        )
      ).toBe(true);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/acme/widgets/issues/42/timeline")
        )
      ).toBe(true);
    });

    it("should use configured owner/repo and the issue number when issueId starts with #", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.getLinkedIssues!("#42");

      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/testowner/testrepo/issues/42/sub_issues")
        )
      ).toBe(true);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/testowner/testrepo/issues/42/timeline")
        )
      ).toBe(true);
    });

    it("should reject owner/repo/sub#number forms with slashes in the repo segment", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.getLinkedIssues!("acme/foo/bar#42");

      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/acme/foo/bar/issues/42/sub_issues")
        )
      ).toBe(false);
      expect(
        calledUrls.some((u) =>
          u.includes("/repos/acme/foo/issues/bar#42/sub_issues")
        )
      ).toBe(false);
    });

    it("should fail soft on bare '#' input rather than building a malformed URL", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("#");

      expect(result).toEqual([]);
      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calledUrls.some((u) => u.includes("/issues//sub_issues"))).toBe(
        false
      );
      expect(warnSpy).toHaveBeenCalled();
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      warnSpy.mockRestore();
    });

    it("should fail soft on '#abc' (non-numeric) input rather than building a malformed URL", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("#abc");

      expect(result).toEqual([]);
      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calledUrls.some((u) => u.includes("/issues/abc/sub_issues"))).toBe(
        false
      );
      expect(warnSpy).toHaveBeenCalled();
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      warnSpy.mockRestore();
    });
  });

  describe("getIssueComments", () => {
    const mockGitHubCommentsResponse = [
      {
        id: 1,
        body: "Looks good",
        user: { login: "alice" },
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        body: "Ship it",
        user: { login: "bob" },
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    beforeEach(async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should request /repos/{owner}/{repo}/issues/{n}/comments using configured owner/repo for a numeric issueId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubCommentsResponse),
      });

      await adapter.getIssueComments!("42");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain(
        "/repos/testowner/testrepo/issues/42/comments"
      );
    });

    it("should request /repos/{owner}/{repo}/issues/{n}/comments using owner/repo override for owner/repo#n form", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.getIssueComments!("acme/widgets#42");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("/repos/acme/widgets/issues/42/comments");
    });

    it("should map all comments to IssueComment[] on the happy path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubCommentsResponse),
      });

      const result = await adapter.getIssueComments!("42");

      expect(result).toEqual([
        {
          id: "1",
          author: "alice",
          body: "Looks good",
          created: "2026-01-01T00:00:00Z",
        },
        {
          id: "2",
          author: "bob",
          body: "Ship it",
          created: "2026-01-02T00:00:00Z",
        },
      ]);
    });

    it("should fall back to 'Unknown' when user is missing or login is falsy", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 10,
              body: "no user",
              created_at: "2026-01-03T00:00:00Z",
            },
            {
              id: 11,
              body: "blank login",
              user: { login: "" },
              created_at: "2026-01-04T00:00:00Z",
            },
          ]),
      });

      const result = await adapter.getIssueComments!("42");

      expect(result).toHaveLength(2);
      expect(result[0].author).toBe("Unknown");
      expect(result[1].author).toBe("Unknown");
    });

    it("should return [] when response is empty array or non-array (e.g., null)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result1 = await adapter.getIssueComments!("42");
      expect(result1).toEqual([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null),
      });

      const result2 = await adapter.getIssueComments!("42");
      expect(result2).toEqual([]);
    });

    it("should skip malformed entries and keep valid ones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            null,
            {
              id: 7,
              body: "valid",
              user: { login: "carol" },
              created_at: "2026-01-05T00:00:00Z",
            },
          ]),
      });

      const result = await adapter.getIssueComments!("42");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "7",
        author: "carol",
        body: "valid",
        created: "2026-01-05T00:00:00Z",
      });
    });

    it("should fail soft on 403 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("42");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("42");
      warnSpy.mockRestore();
    });

    it("should fail soft on 404 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Not Found"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("42");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("42");
      warnSpy.mockRestore();
    });

    it("should fail soft on 5xx by returning [] and logging at error level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: () => Promise.resolve("Service Unavailable"),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("42");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("42");
      errorSpy.mockRestore();
    });

    it("should fail soft on network error by returning [] and logging at error level", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("42");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("42");
      errorSpy.mockRestore();
    });

    it("should fail soft on bare '#' input rather than building a malformed URL", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("#");

      expect(result).toEqual([]);
      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calledUrls.some((u) => u.includes("/issues//comments"))).toBe(
        false
      );
      expect(errorSpy).toHaveBeenCalled();
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      errorSpy.mockRestore();
    });

    it("should fail soft on '#abc' (non-numeric) input rather than building a malformed URL", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("#abc");

      expect(result).toEqual([]);
      const calledUrls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calledUrls.some((u) => u.includes("/issues/abc/comments"))).toBe(
        false
      );
      expect(errorSpy).toHaveBeenCalled();
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[GitHubAdapter]");
      expect(firstArg).toContain("getIssueComments");
      errorSpy.mockRestore();
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should search issues with query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      const result = await adapter.searchIssues({
        query: "bug",
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("https://api.github.com/search/issues"),
        expect.any(Object)
      );

      // Verify query contains is:issue and repo filter
      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("is%3Aissue"); // URL encoded "is:issue"
      expect(url).toContain("repo%3Atestowner%2Ftestrepo"); // URL encoded "repo:testowner/testrepo"
      expect(url).toContain("bug");

      expect(result.issues).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should search with status filter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({
        status: ["open"],
      });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("is%3Aopen"); // URL encoded "is:open"
    });

    it("should search with assignee filter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({
        assignee: "testuser",
      });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("assignee%3Atestuser"); // URL encoded "assignee:testuser"
    });

    it("should search with label filter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({
        labels: ["bug", "critical"],
      });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("label"); // Should contain label filter
    });

    it("should handle pagination", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({
        limit: 10,
        offset: 20,
      });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("per_page=10");
      expect(url).toContain("page=3"); // offset 20 / limit 10 + 1 = 3
    });

    it("should indicate hasMore when results are incomplete", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockSearchResponse,
            incomplete_results: true,
          }),
      });

      const result = await adapter.searchIssues({});

      expect(result.hasMore).toBe(true);
    });

    it("should use number: qualifier when query is a key format #number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({ query: "#42" });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("number%3A42");
      expect(url).not.toContain("%2342"); // raw "#42" should not appear as freetext
    });

    it("should use plain query text for non-key searches", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
      });

      await adapter.searchIssues({ query: "authentication bug" });

      const url = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
      expect(url).toContain("authentication+bug");
      expect(url).not.toContain("number%3A");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should return user repositories", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { full_name: "user/repo1", name: "repo1" },
            { full_name: "user/repo2", name: "repo2" },
          ]),
      });

      const result = await adapter.getProjects();

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/user/repos?per_page=100&sort=updated",
        expect.any(Object)
      );

      expect(result).toEqual([
        { id: "user/repo1", key: "repo1", name: "user/repo1" },
        { id: "user/repo2", key: "repo2", name: "user/repo2" },
      ]);
    });
  });

  describe("linkToTestCase", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should add a comment linking to test case", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 123 }),
      });

      await adapter.linkToTestCase("42", "TC-001");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/testowner/testrepo/issues/42/comments",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Linked to test case: TC-001"),
        })
      );
    });

    it("should include metadata in comment when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 123 }),
      });

      await adapter.linkToTestCase("42", "TC-001", { testRun: "TR-100" });

      const body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body.body).toContain("Metadata:");
      expect(body.body).toContain("TR-100");
    });
  });

  describe("syncIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should fetch and return issue data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      const result = await adapter.syncIssue("42");

      expect(result.id).toBe("42");
      expect(result.title).toBe("Test Issue");
      expect(result.status).toBe("open");
    });
  });

  describe("mapGitHubIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "ghp_test_token" });
    });

    it("should map GitHub issue to IssueData format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubIssue),
      });

      const result = await adapter.getIssue("42");

      expect(result).toMatchObject({
        id: "42",
        key: "#42",
        title: "Test Issue",
        description: "This is a test issue description",
        status: "open",
        url: "https://github.com/testowner/testrepo/issues/42",
      });
    });

    it("should extract owner/repo from repository_url in search results", async () => {
      const searchResult = {
        ...mockGitHubIssue,
        repository_url: "https://api.github.com/repos/searchowner/searchrepo",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            total_count: 1,
            incomplete_results: false,
            items: [searchResult],
          }),
      });

      const result = await adapter.searchIssues({ query: "test" });

      expect(result.issues[0].customFields).toEqual({
        _github_owner: "searchowner",
        _github_repo: "searchrepo",
      });
    });

    it("should handle issue without assignee", async () => {
      const issueNoAssignee = {
        ...mockGitHubIssue,
        assignee: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issueNoAssignee),
      });

      const result = await adapter.getIssue("42");

      expect(result.assignee).toBeUndefined();
    });

    it("should handle issue without reporter", async () => {
      const issueNoReporter = {
        ...mockGitHubIssue,
        user: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issueNoReporter),
      });

      const result = await adapter.getIssue("42");

      expect(result.reporter).toBeUndefined();
    });
  });
});
