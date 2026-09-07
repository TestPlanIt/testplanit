import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClickUpAdapter } from "./ClickUpAdapter";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ClickUpAdapter", () => {
  let adapter: ClickUpAdapter;

  const mockClickUpTask = {
    id: "abc123",
    custom_id: null,
    name: "Test Task",
    markdown_description: "This is a test task description",
    status: { status: "in progress" },
    priority: { priority: "high" },
    date_created: "1700000000000",
    date_updated: "1700000100000",
    url: "https://app.clickup.com/t/abc123",
    creator: {
      id: 1,
      username: "reporter-user",
      email: "reporter@example.com",
    },
    assignees: [
      { id: 2, username: "assignee-user", email: "assignee@example.com" },
    ],
    tags: [{ name: "bug" }, { name: "priority:high" }],
    list: { id: "901234567" },
  };

  const authenticateAdapter = async (a: ClickUpAdapter) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: 1, username: "testuser" } }),
    });
    await a.authenticate({ type: "oauth", accessToken: "cu_valid_token" });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClickUpAdapter({
      provider: "CLICKUP",
      listId: "901234567",
      teamId: "9013456789",
    });
  });

  describe("getCapabilities", () => {
    it("returns the correct capabilities for ClickUp", () => {
      expect(adapter.getCapabilities()).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: false,
        customFields: false,
        attachments: false,
        linkedIssues: false,
        comments: true,
      });
    });
  });

  describe("authenticate", () => {
    it("authenticates successfully with a valid OAuth token", async () => {
      await expect(authenticateAdapter(adapter)).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.clickup.com/api/v2/user",
        expect.any(Object)
      );
    });

    it("throws when authData.type is not oauth", async () => {
      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "pk_something" })
      ).rejects.toThrow("only supports OAuth");
    });

    it("throws when no access token is provided", async () => {
      await expect(
        adapter.authenticate({ type: "oauth" })
      ).rejects.toThrow("requires an access token");
    });

    it("throws when the token validation request fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "bad-token" })
      ).rejects.toThrow("Invalid ClickUp OAuth access token");
    });

    it("sends the raw access token with no Bearer prefix", async () => {
      await authenticateAdapter(adapter);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("cu_valid_token");
    });
  });

  describe("OAuth", () => {
    const oauthAdapter = () =>
      new ClickUpAdapter({
        provider: "CLICKUP",
        clientId: "client-123",
        clientSecret: "secret-456",
        redirectUri:
          "https://app.example.com/api/integrations/oauth/clickup/callback",
      });

    it("advertises OAuth support", () => {
      expect(oauthAdapter().supportsOAuth).toBe(true);
    });

    it("builds the authorization URL with client id, redirect uri, and state (no scope)", () => {
      const url = new URL(oauthAdapter().getAuthorizationUrl("state-xyz"));
      expect(url.origin + url.pathname).toBe("https://app.clickup.com/api");
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://app.example.com/api/integrations/oauth/clickup/callback"
      );
      expect(url.searchParams.get("state")).toBe("state-xyz");
      expect(url.searchParams.has("scope")).toBe(false);
    });

    it("exchanges an authorization code for an access token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "cu_new_token" }),
      });

      const tokens = await oauthAdapter().exchangeCodeForTokens("auth-code");

      expect(tokens).toEqual({ accessToken: "cu_new_token" });
      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe("https://api.clickup.com/api/v2/oauth/token");
      expect(options.method).toBe("POST");
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({
        client_id: "client-123",
        client_secret: "secret-456",
        code: "auth-code",
      });
    });

    it("throws when the token exchange returns an err field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ err: "Invalid code" }),
      });

      await expect(
        oauthAdapter().exchangeCodeForTokens("bad-code")
      ).rejects.toThrow("Invalid code");
    });

    it("throws when the token exchange response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("Bad request"),
      });

      await expect(
        oauthAdapter().exchangeCodeForTokens("bad-code")
      ).rejects.toThrow("Failed to exchange code for tokens");
    });

    it("refreshTokens throws — ClickUp OAuth tokens do not expire", async () => {
      await expect(
        oauthAdapter().refreshTokens("some-refresh-token")
      ).rejects.toThrow("do not expire and cannot be refreshed");
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("creates a task in the configured list", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      const result = await adapter.createIssue({
        title: "Test Task",
        description: "This is a test task description",
        projectId: "",
        priority: "high",
        assigneeId: "2",
        labels: ["bug"],
      });

      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/list/901234567/task"
      );
      expect(options.method).toBe("POST");
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({
        name: "Test Task",
        markdown_description: "This is a test task description",
        priority: 2, // "high" -> 2
        assignees: [2],
        tags: ["bug"],
      });
      expect(result.id).toBe("abc123");
    });

    it("uses CreateIssueData.projectId as the list id when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      await adapter.createIssue({
        title: "Test Task",
        projectId: "999888777",
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/list/999888777/task"
      );
    });

    it("throws when no list id can be resolved", async () => {
      const noListAdapter = new ClickUpAdapter({ provider: "CLICKUP" });
      await authenticateAdapter(noListAdapter);

      await expect(
        noListAdapter.createIssue({ title: "Test Task", projectId: "" })
      ).rejects.toThrow("ClickUp List ID not configured");
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("sends an add/rem delta for assignee updates, not a flat array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      await adapter.updateIssue("abc123", { assigneeId: "2" });

      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe("https://api.clickup.com/api/v2/task/abc123");
      expect(options.method).toBe("PUT");
      const body = JSON.parse(options.body);
      expect(body.assignees).toEqual({ add: [2], rem: [] });
    });

    it("passes status through verbatim", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      await adapter.updateIssue("abc123", { status: "in progress" });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.status).toBe("in progress");
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("maps a ClickUp task, parsing epoch-millisecond timestamps", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      const result = await adapter.getIssue("abc123");

      expect(result.createdAt).toEqual(new Date(1700000000000));
      expect(result.updatedAt).toEqual(new Date(1700000100000));
      expect(result.status).toBe("in progress");
      expect(result.priority).toBe("high");
      expect(result.assignee).toEqual({
        id: "2",
        name: "assignee-user",
        email: "assignee@example.com",
      });
      expect(result.reporter).toEqual({
        id: "1",
        name: "reporter-user",
        email: "reporter@example.com",
      });
      expect(result.labels).toEqual(["bug", "priority:high"]);
      expect(result.key).toBe("abc123");
    });

    it("falls back to custom_id for the key when present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...mockClickUpTask, custom_id: "TP-42" }),
      });

      const result = await adapter.getIssue("abc123");
      expect(result.key).toBe("TP-42");
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("builds query params for status/assignee/updatedWithinDays", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ tasks: [mockClickUpTask], last_page: true }),
      });

      await adapter.searchIssues({
        status: ["open", "in progress"],
        assignee: "2",
        updatedWithinDays: 7,
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      const url = new URL(calledUrl);
      expect(url.searchParams.getAll("statuses[]")).toEqual([
        "open",
        "in progress",
      ]);
      expect(url.searchParams.getAll("assignees[]")).toEqual(["2"]);
      expect(url.searchParams.has("date_updated_gt")).toBe(true);
    });

    it("filters client-side on query since ClickUp has no server-side text search", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: [
              mockClickUpTask,
              { ...mockClickUpTask, id: "def456", name: "Unrelated task" },
            ],
            last_page: true,
          }),
      });

      const result = await adapter.searchIssues({ query: "Test Task" });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe("abc123");
      expect(result.total).toBe(1);
    });

    it("throws when no list id can be resolved", async () => {
      const noListAdapter = new ClickUpAdapter({ provider: "CLICKUP" });
      await authenticateAdapter(noListAdapter);

      await expect(noListAdapter.searchIssues({})).rejects.toThrow(
        "ClickUp List ID not configured"
      );
    });
  });

  describe("comments", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("getIssueComments maps ClickUp comments", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: 555,
                comment_text: "Looks good",
                date: "1700000200000",
                user: { username: "reviewer" },
              },
            ],
          }),
      });

      const comments = await adapter.getIssueComments("abc123");
      expect(comments).toEqual([
        {
          id: "555",
          author: "reviewer",
          body: "Looks good",
          created: "1700000200000",
        },
      ]);
    });

    it("getIssueComments fails soft, returning an empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      const comments = await adapter.getIssueComments("abc123");
      expect(comments).toEqual([]);
    });

    it("linkToTestCase posts a comment with comment_text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await adapter.linkToTestCase("abc123", "TC-1");

      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/task/abc123/comment"
      );
      const body = JSON.parse(options.body);
      expect(body.comment_text).toContain("TC-1");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("walks Team -> Space -> Folder/List and flattens to id/key/name", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ spaces: [{ id: "space1", name: "Engineering" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              folders: [
                {
                  id: "folder1",
                  name: "Sprint 1",
                  lists: [{ id: "list1", name: "Backlog" }],
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ lists: [{ id: "list2", name: "Folderless" }] }),
        });

      const projects = await adapter.getProjects();

      expect(projects).toEqual(
        expect.arrayContaining([
          {
            id: "list1",
            key: "list1",
            name: "Engineering / Sprint 1 / Backlog",
          },
          { id: "list2", key: "list2", name: "Engineering / Folderless" },
        ])
      );
    });

    it("throws when teamId is not configured", async () => {
      const noTeamAdapter = new ClickUpAdapter({
        provider: "CLICKUP",
        listId: "901234567",
      });
      await authenticateAdapter(noTeamAdapter);

      await expect(noTeamAdapter.getProjects()).rejects.toThrow(
        "Team (workspace) ID not configured"
      );
    });
  });
});
