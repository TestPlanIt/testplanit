import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JiraAdapter } from "./JiraAdapter";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("JiraAdapter", () => {
  let adapter: JiraAdapter;

  const mockJiraIssue = {
    id: "10001",
    key: "TEST-123",
    self: "https://test.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Test Issue",
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Test description" }],
          },
        ],
      },
      status: { name: "Open" },
      priority: { name: "High" },
      issuetype: { id: "10001", name: "Bug", iconUrl: "https://icon.url" },
      assignee: {
        accountId: "user-123",
        displayName: "Test User",
        emailAddress: "test@example.com",
      },
      reporter: {
        accountId: "reporter-123",
        displayName: "Reporter User",
        emailAddress: "reporter@example.com",
      },
      labels: ["bug", "priority"],
      created: "2024-01-15T10:00:00.000Z",
      updated: "2024-01-15T12:00:00.000Z",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new JiraAdapter({
      provider: "JIRA",
      baseUrl: "https://test.atlassian.net",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities for Jira", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: true,
        attachments: true,
      });
    });
  });

  describe("authenticate", () => {
    it("should authenticate successfully with API key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });

      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.atlassian.net/rest/api/3/myself",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );
    });

    it("should throw error when API key auth is missing required fields", async () => {
      await expect(
        adapter.authenticate({
          type: "api_key",
          email: "test@example.com",
          // Missing apiToken and baseUrl
        })
      ).rejects.toThrow(
        "API key authentication requires email, apiToken, and baseUrl"
      );
    });

    it("should throw error for invalid authentication type", async () => {
      await expect(
        adapter.authenticate({
          type: "basic",
          username: "user",
          password: "pass",
        })
      ).rejects.toThrow(
        "Jira adapter only supports OAuth and API key authentication"
      );
    });

    it("should throw error when API authentication fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Unauthorized",
      });

      await expect(
        adapter.authenticate({
          type: "api_key",
          email: "test@example.com",
          apiToken: "invalid-token",
          baseUrl: "https://test.atlassian.net",
        })
      ).rejects.toThrow("Jira API authentication failed: Unauthorized");
    });

    it("should authenticate with OAuth and get cloud resources", async () => {
      // Mock environment variables BEFORE creating adapter
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      // Create a new adapter with the env vars set
      const oauthAdapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://test.atlassian.net",
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "cloud-123", url: "https://test.atlassian.net" },
          ]),
      });

      await oauthAdapter.authenticate({
        type: "oauth",
        accessToken: "test-access-token",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
          }),
        })
      );

      vi.unstubAllEnvs();
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      // Reset mock completely for clean state
      mockFetch.mockReset();
      // Auth call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should create issue with project key", async () => {
      // Create issue call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      // Get issue call (to fetch full details)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      const result = await adapter.createIssue({
        title: "Test Issue",
        description: "Test description",
        projectId: "TEST",
        issueType: "10001",
        priority: "2",
        labels: ["bug"],
      });

      // Find the create call (POST)
      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      expect(body.fields.project).toEqual({ key: "TEST" });
      expect(body.fields.summary).toBe("Test Issue");
      expect(body.fields.issuetype).toEqual({ id: "10001" });
      expect(result.key).toBe("TEST-123");
    });

    it("should create issue with project ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        projectId: "12345",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      expect(body.fields.project).toEqual({ id: "12345" });
    });

    it("should handle TipTap JSON description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      const tiptapDescription = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "TipTap content" }],
          },
        ],
      };

      await adapter.createIssue({
        title: "Test Issue",
        description: tiptapDescription as any,
        projectId: "TEST",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      // Should convert to ADF format
      expect(body.fields.description.type).toBe("doc");
      expect(body.fields.description.version).toBe(1);
    });

    it("should handle HTML description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        description: "<p>HTML content</p>",
        projectId: "TEST",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      expect(body.fields.description.type).toBe("doc");
    });

    it("should handle plain text description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        description: "Plain text content",
        projectId: "TEST",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      expect(body.fields.description).toEqual({
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Plain text content" }],
          },
        ],
      });
    });

    it("should include assignee when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001", key: "TEST-123", self: "https://test.atlassian.net/rest/api/3/issue/10001" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        projectId: "TEST",
        assigneeId: "user-123",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const createCall = mockFetch.mock.calls[createCallIndex];
      const body = JSON.parse(createCall[1].body);

      expect(body.fields.assignee).toEqual({ id: "user-123" });
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should update issue fields", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockJiraIssue,
              fields: { ...mockJiraIssue.fields, summary: "Updated Title" },
            }),
        });

      const result = await adapter.updateIssue("TEST-123", {
        title: "Updated Title",
        priority: "1",
        labels: ["updated"],
      });

      const updateCall = mockFetch.mock.calls[1];
      expect(updateCall[0]).toContain("/rest/api/3/issue/TEST-123");

      const body = JSON.parse(updateCall[1].body);
      expect(body.fields.summary).toBe("Updated Title");
      expect(body.fields.priority).toEqual({ id: "1" });
      expect(body.fields.labels).toEqual(["updated"]);
    });

    it("should handle status transition", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              transitions: [
                { id: "21", to: { name: "Done" } },
                { id: "31", to: { name: "In Progress" } },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJiraIssue),
        });

      await adapter.updateIssue("TEST-123", {
        status: "Done",
      });

      // Verify transition call
      const transitionCall = mockFetch.mock.calls[3];
      expect(transitionCall[0]).toContain("/transitions");
      const body = JSON.parse(transitionCall[1].body);
      expect(body.transition.id).toBe("21");
    });

    it("should throw error when transition not found", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              transitions: [{ id: "21", to: { name: "Done" } }],
            }),
        });

      await expect(
        adapter.updateIssue("TEST-123", {
          status: "NonExistent",
        })
      ).rejects.toThrow("No transition available to status: NonExistent");
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should get issue by key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.id).toBe("10001");
      expect(result.key).toBe("TEST-123");
      expect(result.title).toBe("Test Issue");
      expect(result.status).toBe("Open");
      expect(result.priority).toBe("High");
      expect(result.assignee?.id).toBe("user-123");
      expect(result.reporter?.id).toBe("reporter-123");
      expect(result.labels).toEqual(["bug", "priority"]);
    });

    it("should throw error for invalid issue structure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "10001" }), // Missing fields
      });

      await expect(adapter.getIssue("TEST-123")).rejects.toThrow(
        "Invalid Jira issue"
      );
    });

    it("should throw error for missing summary", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            fields: { status: { name: "Open" } },
          }),
      });

      await expect(adapter.getIssue("TEST-123")).rejects.toThrow(
        "missing summary field"
      );
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should search issues with query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [mockJiraIssue],
            total: 1,
            startAt: 0,
          }),
      });

      const result = await adapter.searchIssues({
        query: "test bug",
        projectId: "TEST",
      });

      expect(result.issues).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);

      const searchCall = mockFetch.mock.calls[1];
      expect(searchCall[0]).toContain("search/jql");
      expect(searchCall[0]).toContain("project+%3D+TEST"); // URL encoded with + for spaces
    });

    it("should search with exact issue key match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [mockJiraIssue],
            total: 1,
            startAt: 0,
          }),
      });

      await adapter.searchIssues({
        query: "TEST-123",
      });

      const searchCall = mockFetch.mock.calls[1];
      // Should include key exact match for issue key pattern
      expect(searchCall[0]).toContain("key");
    });

    it("should handle pagination", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [mockJiraIssue],
            total: 100,
            startAt: 20,
          }),
      });

      const result = await adapter.searchIssues({
        limit: 50,
        offset: 20,
      });

      expect(result.hasMore).toBe(true);

      const searchCall = mockFetch.mock.calls[1];
      expect(searchCall[0]).toContain("startAt=20");
      expect(searchCall[0]).toContain("maxResults=50");
    });

    it("should filter by status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [],
            total: 0,
            startAt: 0,
          }),
      });

      await adapter.searchIssues({
        status: ["Open", "In Progress"],
      });

      const searchCall = mockFetch.mock.calls[1];
      // decodeURIComponent doesn't decode '+' to space, so replace it first
      const decodedUrl = decodeURIComponent(searchCall[0].replace(/\+/g, " "));
      expect(decodedUrl).toContain("status IN");
    });

    it("should filter by assignee", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [],
            total: 0,
            startAt: 0,
          }),
      });

      await adapter.searchIssues({
        assignee: "user-123",
      });

      const searchCall = mockFetch.mock.calls[1];
      const decodedUrl = decodeURIComponent(searchCall[0].replace(/\+/g, " "));
      expect(decodedUrl).toContain("assignee = user-123");
    });

    it("should filter by labels", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [],
            total: 0,
            startAt: 0,
          }),
      });

      await adapter.searchIssues({
        labels: ["bug", "critical"],
      });

      const searchCall = mockFetch.mock.calls[1];
      const decodedUrl = decodeURIComponent(searchCall[0].replace(/\+/g, " "));
      expect(decodedUrl).toContain("labels IN");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should return available projects", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            values: [
              { id: "1", key: "TEST", name: "Test Project" },
              { id: "2", key: "DEV", name: "Dev Project" },
            ],
          }),
      });

      const result = await adapter.getProjects();

      expect(result).toEqual([
        { id: "1", key: "TEST", name: "Test Project" },
        { id: "2", key: "DEV", name: "Dev Project" },
      ]);
    });
  });

  describe("getIssueTypes", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should return issue types for project", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issueTypes: [
              { id: "10001", name: "Bug" },
              { id: "10002", name: "Task" },
            ],
          }),
      });

      const result = await adapter.getIssueTypes("TEST");

      expect(result).toEqual([
        { id: "10001", name: "Bug" },
        { id: "10002", name: "Task" },
      ]);
    });

    it("should fallback to all issue types on error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          statusText: "Not Found",
          text: () => Promise.resolve("Not Found"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: "10001", name: "Bug", subtask: false },
              { id: "10002", name: "Sub-task", subtask: true },
            ]),
        });

      const result = await adapter.getIssueTypes("INVALID");

      // Should filter out subtasks
      expect(result).toEqual([{ id: "10001", name: "Bug" }]);
    });
  });

  describe("searchUsers", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should search users by query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              accountId: "user-123",
              displayName: "Test User",
              emailAddress: "test@example.com",
            },
          ]),
      });

      const result = await adapter.searchUsers("test");

      expect(result).toEqual({
        users: [
          {
            accountId: "user-123",
            displayName: "Test User",
            emailAddress: "test@example.com",
            avatarUrls: undefined,
          },
        ],
        total: expect.any(Number),
      });
    });

    it("should search by email", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                accountId: "user-123",
                displayName: "Test User",
                emailAddress: "test@example.com",
              },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });

      const result = await adapter.searchUsers("test@example.com");

      expect(result).toHaveProperty("users");
    });
  });

  describe("getCurrentUser", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should return current user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accountId: "user-123",
            displayName: "Current User",
            emailAddress: "current@example.com",
          }),
      });

      const result = await adapter.getCurrentUser();

      expect(result).toEqual({
        accountId: "user-123",
        displayName: "Current User",
        emailAddress: "current@example.com",
      });
    });

    it("should return null on error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await adapter.getCurrentUser();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should return OAuth authorization URL", () => {
      // Set env vars BEFORE creating adapter
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      // Create a new adapter with the env vars set
      const oauthAdapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://test.atlassian.net",
      });

      const url = oauthAdapter.getAuthorizationUrl("test-state");

      expect(url).toContain("https://auth.atlassian.com/authorize");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("state=test-state");
      expect(url).toContain("response_type=code");

      vi.unstubAllEnvs();
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("should exchange code for tokens", async () => {
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          }),
      });

      const result = await adapter.exchangeCodeForTokens("auth-code");

      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresAt).toBeInstanceOf(Date);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://auth.atlassian.com/oauth/token",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("auth-code"),
        })
      );

      vi.unstubAllEnvs();
    });

    it("should throw error on failed token exchange", async () => {
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("Invalid code"),
      });

      await expect(adapter.exchangeCodeForTokens("invalid-code")).rejects.toThrow(
        "Failed to exchange code for tokens"
      );

      vi.unstubAllEnvs();
    });
  });

  describe("refreshTokens", () => {
    it("should refresh tokens", async () => {
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "refreshed-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          }),
      });

      const result = await adapter.refreshTokens("old-refresh-token");

      expect(result.accessToken).toBe("refreshed-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");

      vi.unstubAllEnvs();
    });
  });

  describe("ADF conversion", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await adapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("should extract description from ADF format", async () => {
      const issueWithAdf = {
        ...mockJiraIssue,
        fields: {
          ...mockJiraIssue.fields,
          description: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Hello " },
                  { type: "text", text: "world", marks: [{ type: "strong" }] },
                ],
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issueWithAdf),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.description).toContain("<p>");
      expect(result.description).toContain("<strong>world</strong>");
    });

    it("should handle plain text description", async () => {
      const issueWithPlainText = {
        ...mockJiraIssue,
        fields: {
          ...mockJiraIssue.fields,
          description: "Plain text description",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issueWithPlainText),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.description).toBe("Plain text description");
    });
  });
});
