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
        webhooks: true,
        customFields: true,
        attachments: true,
        linkedIssues: true,
        comments: true,
        milestones: false,
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
      await expect(adapter.authenticate({ type: "oauth" })).rejects.toThrow(
        "requires an access token"
      );
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

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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

      const [, options] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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
        json: () => Promise.resolve({ ...mockClickUpTask, custom_id: "TP-42" }),
      });

      const result = await adapter.getIssue("abc123");
      expect(result.key).toBe("TP-42");
    });

    it("asks for the markdown description and maps the plain Task type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      const result = await adapter.getIssue("abc123");

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/task/abc123?include_markdown_description=true"
      );
      expect(result.issueType).toEqual({ id: "0", name: "Task" });
      expect(result.customFields).toMatchObject({
        _clickup_list_id: "901234567",
      });
    });

    it("resolves a custom task id inside the configured workspace", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockClickUpTask, custom_id: "TP-42" }),
      });

      await adapter.getIssue("TP-42");

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/task/TP-42?include_markdown_description=true&custom_task_ids=true&team_id=9013456789"
      );
    });

    it("surfaces custom field values and the custom task type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockClickUpTask,
            custom_item_id: 1300,
            custom_fields: [
              { id: "f-sev", name: "Severity", type: "drop_down", value: 2 },
              { id: "f-empty", name: "Notes", type: "text", value: null },
            ],
          }),
      });

      const result = await adapter.getIssue("abc123");

      expect(result.issueType).toEqual({ id: "1300", name: "Type 1300" });
      expect(result.customFields).toEqual({
        _clickup_list_id: "901234567",
        "f-sev": 2,
      });
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

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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

    it("computes the ClickUp page from its fixed page size, not the caller's limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [], last_page: true }),
      });

      // A bulk-import-style call: 50 items already consumed (one ClickUp
      // page's worth of tasks minus some), requesting the next 50. ClickUp
      // itself pages in batches of 100, so this must still ask for
      // ClickUp page 1 (tasks 101-200), not page 2 (dividing 100 by the
      // caller's limit of 50) which would skip tasks 101-200 entirely.
      await adapter.searchIssues({ limit: 50, offset: 100 });

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const url = new URL(calledUrl);
      expect(url.searchParams.get("page")).toBe("1");
    });

    it("scans additional ClickUp pages to find a query match past the first page", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              tasks: [
                { ...mockClickUpTask, id: "page0-task", name: "No match here" },
              ],
              last_page: false,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              tasks: [mockClickUpTask],
              last_page: true,
            }),
        });

      const result = await adapter.searchIssues({ query: "Test Task" });

      // Two ClickUp task pages fetched (plus the one auth call from
      // authenticateAdapter() in beforeEach) — the interactive search
      // dialog only calls searchIssues() once and never re-requests with a
      // later page, so the adapter itself must keep scanning until it
      // finds a match or runs out of pages.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe("abc123");
      expect(result.hasMore).toBe(false);
    });

    it("stops scanning once enough matches are found without exhausting all pages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: [mockClickUpTask],
            last_page: false,
          }),
      });

      const result = await adapter.searchIssues({
        query: "Test Task",
        limit: 1,
      });

      // One task page fetched (plus the one auth call from
      // authenticateAdapter() in beforeEach).
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.issues).toHaveLength(1);
      expect(result.hasMore).toBe(true);
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

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
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
            Promise.resolve({
              spaces: [{ id: "space1", name: "Engineering" }],
            }),
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

  describe("custom task types", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("offers the plain Task first and then the workspace's custom task types", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            custom_items: [
              { id: 1300, name: "Bug", name_plural: "Bugs" },
              { id: 1301, name: "Story", name_plural: "Stories" },
            ],
          }),
      });

      const types = await adapter.getIssueTypes("901234567");

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/team/9013456789/custom_item"
      );
      expect(types).toEqual([
        { id: "0", name: "Task" },
        { id: "1300", name: "Bug" },
        { id: "1301", name: "Story" },
      ]);
    });

    it("names a task's custom type once the types have been loaded", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ custom_items: [{ id: 1300, name: "Bug" }] }),
      });
      await adapter.getIssueTypes("901234567");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...mockClickUpTask, custom_item_id: 1300 }),
      });
      const result = await adapter.getIssue("abc123");
      expect(result.issueType).toEqual({ id: "1300", name: "Bug" });
    });

    it("sends a custom task type on create and ignores ids that are not types", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });
      await adapter.createIssue({
        title: "Typed",
        projectId: "",
        issueType: "1300",
      });
      let body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body.custom_item_id).toBe(1300);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });
      await adapter.createIssue({
        title: "Untyped",
        projectId: "",
        issueType: "not-a-type",
      });
      body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body).not.toHaveProperty("custom_item_id");
    });
  });

  describe("custom fields", () => {
    const listFields = {
      fields: [
        { id: "f-text", name: "Notes", type: "text", required: false },
        {
          id: "f-sev",
          name: "Severity",
          type: "drop_down",
          required: true,
          type_config: {
            options: [
              { id: "opt-high", name: "High", orderindex: 0 },
              { id: "opt-low", name: "Low", orderindex: 1 },
            ],
          },
        },
        {
          id: "f-area",
          name: "Area",
          type: "labels",
          type_config: {
            options: [
              { id: "lab-api", label: "API" },
              { id: "lab-ui", label: "UI" },
            ],
          },
        },
        { id: "f-points", name: "Points", type: "number" },
        { id: "f-due", name: "Target", type: "date" },
        { id: "f-flag", name: "Regression", type: "checkbox" },
        { id: "f-owner", name: "Owner", type: "users" },
        { id: "f-sum", name: "Rollup", type: "formula" },
      ],
    };

    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("getCustomFields reads the List's fields and their options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });

      const fields = await adapter.getCustomFields("901234567");

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/list/901234567/field"
      );
      expect(fields).toHaveLength(8);
      expect(fields[1]).toEqual({
        id: "f-sev",
        name: "Severity",
        type: "drop_down",
        required: true,
        options: [
          { id: "opt-high", value: "High" },
          { id: "opt-low", value: "Low" },
        ],
      });
      expect(fields[2].options).toEqual([
        { id: "lab-api", value: "API" },
        { id: "lab-ui", value: "UI" },
      ]);
      expect(fields[0]).not.toHaveProperty("options");
    });

    it("getIssueTypeFields offers only editable field types in the create-form shape", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });

      const fields = await adapter.getIssueTypeFields("901234567", "0");

      expect(fields.map((f: any) => f.key)).toEqual([
        "f-text",
        "f-sev",
        "f-area",
        "f-points",
        "f-due",
        "f-flag",
      ]);
      expect(fields[1]).toMatchObject({
        key: "f-sev",
        name: "Severity",
        required: true,
        allowedValues: [
          { id: "opt-high", name: "High" },
          { id: "opt-low", name: "Low" },
        ],
      });
      expect(fields[2].schema).toEqual({ type: "array" });
      expect(fields[3].schema).toEqual({ type: "number" });
      expect(fields[5].allowedValues).toEqual([
        { id: "true", name: "Yes" },
        { id: "false", name: "No" },
      ]);
    });

    it("caches the List's fields across calls", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });
      await adapter.getCustomFields("901234567");
      const calls = mockFetch.mock.calls.length;
      await adapter.getIssueTypeFields("901234567", "0");
      expect(mockFetch.mock.calls.length).toBe(calls);
    });

    it("createIssue coerces custom field values per type and drops unknown keys", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      await adapter.createIssue({
        title: "With fields",
        projectId: "",
        customFields: {
          "f-text": "hello",
          "f-sev": "opt-high",
          "f-area": "lab-api",
          "f-points": "5",
          "f-due": "2026-10-06T00:00:00.000Z",
          "f-flag": "true",
          "f-owner": "7",
          reporter: { accountId: "1" },
          "f-blank": "",
        },
      });

      const body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body.custom_fields).toEqual([
        { id: "f-text", value: "hello" },
        { id: "f-sev", value: "opt-high" },
        { id: "f-area", value: ["lab-api"] },
        { id: "f-points", value: 5 },
        { id: "f-due", value: Date.parse("2026-10-06T00:00:00.000Z") },
        { id: "f-flag", value: true },
      ]);
    });

    it("createIssue omits custom_fields entirely when nothing usable was given", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });

      await adapter.createIssue({
        title: "No fields",
        projectId: "",
        customFields: { reporter: { accountId: "1" } },
      });

      const body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body).not.toHaveProperty("custom_fields");
    });

    it("updateIssue writes each custom field through its own endpoint and re-reads the task", async () => {
      // PUT task → field list → POST field → GET task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockClickUpTask),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(listFields),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockClickUpTask, name: "Renamed" }),
      });

      const result = await adapter.updateIssue("abc123", {
        title: "Renamed",
        customFields: { "f-points": 8 },
      });

      const fieldCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 2];
      expect(fieldCall[0]).toBe(
        "https://api.clickup.com/api/v2/task/abc123/field/f-points"
      );
      expect(fieldCall[1].method).toBe("POST");
      expect(JSON.parse(fieldCall[1].body)).toEqual({ value: 8 });
      expect(result.title).toBe("Renamed");
    });
  });

  describe("statuses and priorities", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("getStatuses reads the default List's statuses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "901234567",
            statuses: [
              { status: "to do", type: "open" },
              { status: "done", type: "closed" },
            ],
          }),
      });

      expect(await adapter.getStatuses()).toEqual([
        { id: "to do", name: "to do" },
        { id: "done", name: "done" },
      ]);
    });

    it("getStatuses is empty without a default List", async () => {
      const noList = new ClickUpAdapter({ provider: "CLICKUP" });
      await authenticateAdapter(noList);
      expect(await noList.getStatuses()).toEqual([]);
    });

    it("getPriorities lists ClickUp's four levels", async () => {
      expect((await adapter.getPriorities()).map((p) => p.id)).toEqual([
        "urgent",
        "high",
        "normal",
        "low",
      ]);
    });
  });

  describe("searchIssues filters", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("narrows to custom task types via custom_items[]", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [], last_page: true }),
      });

      await adapter.searchIssues({ issueTypeIds: ["1300", "1301"] });

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const params = new URL(calledUrl).searchParams;
      expect(params.getAll("custom_items[]")).toEqual(["1300", "1301"]);
    });

    it("matches a query against the custom id as well as the name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: [
              { ...mockClickUpTask, id: "aaa", custom_id: "TP-7", name: "x" },
              { ...mockClickUpTask, id: "bbb", custom_id: "TP-8", name: "y" },
            ],
            last_page: true,
          }),
      });

      const result = await adapter.searchIssues({ query: "tp-7" });
      expect(result.issues.map((i) => i.key)).toEqual(["TP-7"]);
    });
  });

  describe("countIssues", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("is exact when the first page is also the last", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ tasks: [mockClickUpTask], last_page: true }),
      });
      expect(await adapter.countIssues({})).toEqual({
        count: 1,
        exactness: "exact",
      });
    });

    it("is a floor when more pages follow", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: Array.from({ length: 100 }, () => mockClickUpTask),
            last_page: false,
          }),
      });
      expect(await adapter.countIssues({})).toEqual({
        count: 100,
        exactness: "floor",
      });
    });

    it("is unknown without a List", async () => {
      const noList = new ClickUpAdapter({ provider: "CLICKUP" });
      await authenticateAdapter(noList);
      expect(await noList.countIssues({})).toEqual({
        count: 0,
        exactness: "unknown",
      });
    });
  });

  describe("users", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    const teams = {
      teams: [
        {
          id: "9013456789",
          name: "Acme",
          members: [
            {
              user: {
                id: 1,
                username: "alice",
                email: "alice@example.com",
                profilePicture: "https://img/alice.png",
              },
            },
            { user: { id: 2, username: "bob", email: "bob@example.com" } },
          ],
        },
        { id: "other", name: "Other", members: [{ user: { id: 9 } }] },
      ],
    };

    it("searchUsers filters the configured workspace's members client-side", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(teams),
      });

      const result = await adapter.searchUsers("ali");

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe("https://api.clickup.com/api/v2/team");
      expect(result).toEqual({
        users: [
          {
            accountId: "1",
            displayName: "alice",
            emailAddress: "alice@example.com",
            avatarUrls: { "48x48": "https://img/alice.png" },
          },
        ],
        total: 1,
      });
    });

    it("searchUsers pages an empty query over every member", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(teams),
      });

      const result = await adapter.searchUsers("", undefined, 1, 1);
      expect(result.total).toBe(2);
      expect(result.users.map((u) => u.accountId)).toEqual(["2"]);
    });

    it("getCurrentUser maps the authorized user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: { id: 1, username: "alice", email: "alice@example.com" },
          }),
      });

      expect(await adapter.getCurrentUser()).toEqual({
        accountId: "1",
        displayName: "alice",
        emailAddress: "alice@example.com",
      });
    });
  });

  describe("linked issues", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("maps task links and both directions of a dependency", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockClickUpTask,
            linked_tasks: [
              { task_id: "abc123", link_id: "lnk001" },
              { task_id: "lnk002", link_id: "abc123" },
            ],
            dependencies: [
              { task_id: "abc123", depends_on: "dep001", type: 1 },
              { task_id: "dep002", depends_on: "abc123", type: 1 },
            ],
          }),
      });

      const refs = await adapter.getLinkedIssues("abc123");

      expect(refs).toEqual([
        { id: "lnk001", linkType: "relates to", direction: "outward" },
        { id: "lnk002", linkType: "relates to", direction: "outward" },
        { id: "dep001", linkType: "waiting on", direction: "outward" },
        { id: "dep002", linkType: "blocking", direction: "inward" },
      ]);
    });

    it("fails soft with an empty list", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
        headers: new Headers(),
      });
      expect(await adapter.getLinkedIssues("missing")).toEqual([]);
    });
  });

  describe("attachments", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("uploadAttachment posts multipart form data under the attachment field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "att-1",
            title: "shot.png",
            url: "https://attachments.clickup.com/att-1/shot.png",
          }),
      });

      const result = await adapter.uploadAttachment(
        "abc123",
        Buffer.from("png-bytes"),
        "shot.png"
      );

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/task/abc123/attachment"
      );
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);
      const part = (options.body as FormData).get("attachment") as File;
      expect(part.name).toBe("shot.png");
      expect(options.headers["Content-Type"]).toBeUndefined();
      expect(result).toEqual({
        id: "att-1",
        url: "https://attachments.clickup.com/att-1/shot.png",
      });
    });

    it("listAttachments reads them off the task, preferring the signed URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockClickUpTask,
            attachments: [
              {
                id: "att-1",
                title: "shot.png",
                mimetype: "image/png",
                size: 1234,
                date: "1700000000000",
                url: "https://attachments.clickup.com/att-1/shot.png",
                url_w_query:
                  "https://attachments.clickup.com/att-1/shot.png?sig=abc",
              },
              { id: "att-2", title: "gone.txt", url: "x", deleted: true },
              { id: "att-3", title: "nolink.txt" },
            ],
          }),
      });

      const list = await adapter.listAttachments("abc123");

      expect(list).toEqual([
        {
          id: "att-1",
          filename: "shot.png",
          mimeType: "image/png",
          byteSize: 1234,
          createdAt: new Date(1700000000000),
          contentUrl: "https://attachments.clickup.com/att-1/shot.png?sig=abc",
        },
      ]);
    });

    it("downloadAttachment fetches the content URL and keeps a real content type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "image/png",
          "content-length": "3",
        }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      const result = await adapter.downloadAttachment({
        id: "att-1",
        filename: "shot.png",
        contentUrl: "https://attachments.clickup.com/att-1/shot.png?sig=abc",
      });

      const [calledUrl] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://attachments.clickup.com/att-1/shot.png?sig=abc"
      );
      expect(result.mimeType).toBe("image/png");
      expect([...result.buffer]).toEqual([1, 2, 3]);
    });

    it("downloadAttachment refuses metadata without a content URL", async () => {
      await expect(
        adapter.downloadAttachment({ id: "att-1", filename: "x" })
      ).rejects.toThrow("no download URL");
    });
  });

  describe("webhooks", () => {
    beforeEach(async () => {
      await authenticateAdapter(adapter);
    });

    it("registerWebhook creates the webhook on the workspace scoped to a List and returns ClickUp's secret", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "wh-1",
            webhook: {
              id: "wh-1",
              endpoint: "https://tpi.example/api/webhooks/whk_1",
              events: ["taskStatusUpdated"],
              health: { status: "active", fail_count: 0 },
              secret: "minted-by-clickup",
            },
          }),
      });

      const result = await adapter.registerWebhook(
        "https://tpi.example/api/webhooks/whk_1",
        ["taskStatusUpdated"],
        undefined,
        { listId: "555" }
      );

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(
        "https://api.clickup.com/api/v2/team/9013456789/webhook"
      );
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        endpoint: "https://tpi.example/api/webhooks/whk_1",
        events: ["taskStatusUpdated"],
        list_id: 555,
      });
      expect(result).toEqual({
        id: "wh-1",
        url: "https://tpi.example/api/webhooks/whk_1",
        events: ["taskStatusUpdated"],
        secret: "minted-by-clickup",
        active: true,
      });
    });

    it("registerWebhook falls back to the default List and the handled events", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "wh-2",
            webhook: { id: "wh-2", secret: "s", events: ["taskStatusUpdated"] },
          }),
      });

      await adapter.registerWebhook("https://tpi.example/hook", []);

      const body = JSON.parse(
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
      );
      expect(body.list_id).toBe(901234567);
      expect(body.events).toEqual(["taskCreated", "taskStatusUpdated"]);
    });

    it("registerWebhook rejects a response without a secret", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "wh-3", webhook: { id: "wh-3" } }),
      });
      await expect(
        adapter.registerWebhook("https://tpi.example/hook", [])
      ).rejects.toThrow("webhook id and secret");
    });

    it("registerWebhook needs a workspace id", async () => {
      const noTeam = new ClickUpAdapter({ provider: "CLICKUP" });
      await authenticateAdapter(noTeam);
      await expect(
        noTeam.registerWebhook("https://tpi.example/hook", [])
      ).rejects.toThrow("Team (workspace) ID not configured");
    });

    it("unregisterWebhook deletes the webhook", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await adapter.unregisterWebhook("wh-1");

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe("https://api.clickup.com/api/v2/webhook/wh-1");
      expect(options.method).toBe("DELETE");
    });
  });
});
