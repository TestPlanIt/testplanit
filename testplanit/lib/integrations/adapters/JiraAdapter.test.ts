import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockValkeyGet = vi.fn();
const mockValkeySet = vi.fn();
vi.mock("~/lib/valkey", () => ({
  default: {
    get: (...args: unknown[]) => mockValkeyGet(...args),
    set: (...args: unknown[]) => mockValkeySet(...args),
  },
}));

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
        linkedIssues: true,
        comments: true,
        milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: true },
      });
    });
  });

  describe("uploadAttachment", () => {
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

    it("posts multipart form data with the CSRF-bypass header (API key)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              id: 10500,
              content:
                "https://test.atlassian.net/secure/attachment/10500/screenshot.png",
            },
          ]),
      });

      const result = await adapter.uploadAttachment(
        "TEST-123",
        Buffer.from("png-bytes"),
        "screenshot.png"
      );

      const [url, options] = mockFetch.mock.calls.at(-1)!;
      expect(url).toBe(
        "https://test.atlassian.net/rest/api/3/issue/TEST-123/attachments"
      );
      expect(options.method).toBe("POST");
      expect(options.headers["X-Atlassian-Token"]).toBe("no-check");
      // fetch must set the multipart boundary itself — a preset JSON
      // Content-Type would corrupt the upload.
      expect(options.headers["Content-Type"]).toBeUndefined();
      expect(options.body).toBeInstanceOf(FormData);
      expect((options.body.get("file") as File).name).toBe("screenshot.png");
      expect(result).toEqual({
        id: "10500",
        url: "https://test.atlassian.net/secure/attachment/10500/screenshot.png",
      });
    });

    it("posts through the OAuth gateway without a JSON content type", async () => {
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      const oauthAdapter = new JiraAdapter({ provider: "JIRA" });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "cloud-123", url: "https://allego.atlassian.net" },
          ]),
      });
      await oauthAdapter.authenticate({
        type: "oauth",
        accessToken: "test-access-token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 42, content: "https://x/42" }]),
      });

      const result = await oauthAdapter.uploadAttachment(
        "ABT-1",
        Buffer.from("png-bytes"),
        "screenshot.png"
      );

      const [url, options] = mockFetch.mock.calls.at(-1)!;
      expect(url).toBe(
        "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/ABT-1/attachments"
      );
      expect(options.headers["Authorization"]).toBe("Bearer test-access-token");
      expect(options.headers["X-Atlassian-Token"]).toBe("no-check");
      expect(options.headers["Content-Type"]).toBeUndefined();
      expect(options.body).toBeInstanceOf(FormData);
      expect(result).toEqual({ id: "42", url: "https://x/42" });

      vi.unstubAllEnvs();
    });

    it("throws when Jira returns no attachment metadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await expect(
        adapter.uploadAttachment("TEST-123", Buffer.from("x"), "a.png")
      ).rejects.toThrow("Failed to upload attachment - no id returned");
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

    it("throws a clear error for a bare API token against Jira Cloud (no email/username)", async () => {
      // v3 /myself -> rejected (a bare token was guessed as Bearer, which
      // Cloud's API-key auth does not accept).
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });
      // serverInfo probe (same bad header) also fails -> detection falls to
      // the hostname heuristic, which still resolves *.atlassian.net as cloud.
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(
        adapter.authenticate({
          type: "api_key",
          apiToken: "bare-token",
          baseUrl: "https://test.atlassian.net",
        })
      ).rejects.toThrow(
        /Jira Cloud authentication requires an email address paired with the API token/
      );
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
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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

    it("converts a TipTap doc with a table to ADF table nodes (INT-05 body)", async () => {
      // The INT-05 issue-body builder ships a TipTap doc whose middle
      // block is a table (parameter name → value rows). Atlassian's ADF
      // schema requires the table to be preserved as `type: "table"`
      // with `tableRow` and `tableCell`/`tableHeader` children — wrapping
      // it in a paragraph (the previous default-case fallback) produced
      // an HTTP 400 "INVALID_INPUT" from Jira because paragraph cannot
      // contain non-text children.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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
            content: [{ type: "text", text: "Lead paragraph" }],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Parameter" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Value" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "username" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "alice" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      await adapter.createIssue({
        title: "Iteration failed",
        description: tiptapDescription as any,
        projectId: "TEST",
      });

      const createCallIndex = mockFetch.mock.calls.findIndex(
        (call: any) => call[1]?.method === "POST"
      );
      const body = JSON.parse(mockFetch.mock.calls[createCallIndex][1].body);

      const adfTable = body.fields.description.content.find(
        (n: any) => n.type === "table"
      );
      expect(adfTable).toBeDefined();
      expect(adfTable.attrs).toMatchObject({
        isNumberColumnEnabled: false,
        layout: "default",
      });
      expect(adfTable.content).toHaveLength(2); // header row + 1 data row
      expect(adfTable.content[0].type).toBe("tableRow");
      expect(adfTable.content[0].content[0].type).toBe("tableHeader");
      expect(adfTable.content[1].content[0].type).toBe("tableCell");
      // Cell content must remain a paragraph (Atlassian rejects raw
      // text in cells; the schema is row → cell → paragraph → text).
      expect(adfTable.content[1].content[0].content[0].type).toBe("paragraph");
    });

    it("should handle HTML description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "TEST-123",
            self: "https://test.atlassian.net/rest/api/3/issue/10001",
          }),
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

      // { accountId } is Jira Cloud's canonical user-ref shape ({ id } is
      // also accepted) — see userRefField in jiraDeployment.ts, which
      // reporter/assignee/user-picker custom fields all route through.
      expect(body.fields.assignee).toEqual({ accountId: "user-123" });
    });

    describe("priority mapping (dialog tokens vs numeric IDs)", () => {
      async function captureCreateBody(priority: string | undefined) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "10001",
              key: "TEST-1",
              self: "https://test.atlassian.net/rest/api/3/issue/10001",
            }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJiraIssue),
        });
        await adapter.createIssue({
          title: "Priority Test",
          projectId: "TEST",
          priority: priority as any,
        });
        const idx = mockFetch.mock.calls.findIndex(
          (call: any) => call[1]?.method === "POST"
        );
        return JSON.parse(mockFetch.mock.calls[idx][1].body).fields.priority;
      }

      it.each([
        ["low", { name: "Low" }],
        ["medium", { name: "Medium" }],
        ["high", { name: "High" }],
        ["urgent", { name: "Highest" }],
      ] as const)(
        "maps dialog token '%s' to %j (Jira looks up by name)",
        async (token, expected) => {
          const priority = await captureCreateBody(token);
          expect(priority).toEqual(expected);
        }
      );

      it("passes a numeric string through as { id } (back-compat with callers that already speak Jira-native)", async () => {
        const priority = await captureCreateBody("3");
        expect(priority).toEqual({ id: "3" });
      });

      it("passes an arbitrary non-token string through as { name } (custom Jira priority schemes)", async () => {
        const priority = await captureCreateBody("Blocker");
        expect(priority).toEqual({ name: "Blocker" });
      });

      it("omits the priority field entirely when value is empty (Jira uses project default)", async () => {
        const priority = await captureCreateBody("");
        expect(priority).toBeUndefined();
      });

      it("omits the priority field entirely when value is undefined", async () => {
        const priority = await captureCreateBody(undefined);
        expect(priority).toBeUndefined();
      });
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

      const _result = await adapter.updateIssue("TEST-123", {
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

    it("sets assignee as { accountId } on Cloud", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJiraIssue),
        });

      await adapter.updateIssue("TEST-123", { assigneeId: "user-456" });

      const updateCall = mockFetch.mock.calls[1];
      const body = JSON.parse(updateCall[1].body);
      expect(body.fields.assignee).toEqual({ accountId: "user-456" });
    });

    it("maps a user-picker custom field { accountId } through on Cloud unchanged", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockJiraIssue),
        });

      await adapter.updateIssue("TEST-123", {
        customFields: { customfield_10050: { accountId: "carol-1" } },
      });

      const updateCall = mockFetch.mock.calls[1];
      const body = JSON.parse(updateCall[1].body);
      expect(body.fields.customfield_10050).toEqual({ accountId: "carol-1" });
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

    it("builds the browse url from the admin-entered baseUrl (API key)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.url).toBe("https://test.atlassian.net/browse/TEST-123");
    });

    it("builds the browse url from the OAuth site host, not the api.atlassian.com gateway", async () => {
      vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
      vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://app.com/callback");

      // OAuth adapter has no baseUrl — the site host is only knowable from the
      // accessible-resources response captured during authentication.
      const oauthAdapter = new JiraAdapter({ provider: "JIRA" });

      mockFetch.mockReset();
      // accessible-resources: cloud id + canonical site url.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "cloud-123", url: "https://allego.atlassian.net" },
          ]),
      });
      await oauthAdapter.authenticate({
        type: "oauth",
        accessToken: "test-access-token",
      });

      // The issue's `self` echoes the api.atlassian.com gateway (as Jira does
      // for all OAuth REST traffic) — splitting it would yield a broken link.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockJiraIssue,
            key: "ABT-47646",
            self: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/10001",
          }),
      });

      const result = await oauthAdapter.getIssue("ABT-47646");

      expect(result.url).toBe("https://allego.atlassian.net/browse/ABT-47646");
      expect(result.url).not.toContain("api.atlassian.com");

      vi.unstubAllEnvs();
    });

    it("maps Jira fields.components[].name into IssueData.components", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockJiraIssue,
            fields: {
              ...mockJiraIssue.fields,
              components: [
                { id: "1", name: "Auth", self: "https://x/1" },
                { id: "2", name: "Frontend", self: "https://x/2" },
                // Defensive: drop entries without a usable name.
                { id: "3", self: "https://x/3" },
              ],
            },
          }),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.components).toEqual(["Auth", "Frontend"]);
    });

    it("returns [] for components when the Jira response omits the field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssue),
      });

      const result = await adapter.getIssue("TEST-123");

      expect(result.components).toEqual([]);
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

  describe("getLinkedIssues", () => {
    const mockJiraIssueWithLinks = {
      id: "10001",
      key: "PROJ-1",
      fields: {
        issuelinks: [
          {
            type: {
              name: "Blocks",
              inward: "is blocked by",
              outward: "blocks",
            },
            outwardIssue: { id: "10010", key: "PROJ-10" },
          },
          {
            type: {
              name: "Relates",
              inward: "relates to",
              outward: "relates to",
            },
            inwardIssue: { id: "10011", key: "PROJ-11" },
          },
        ],
        parent: { id: "10000", key: "PROJ-EPIC" },
        subtasks: [{ id: "10020", key: "PROJ-20" }],
        customfield_10014: "PROJ-EPIC-LEGACY",
      },
    };

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

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should return refs for all four sources on the happy path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssueWithLinks),
      });

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toHaveLength(5);
      expect(result).toEqual(
        expect.arrayContaining([
          {
            id: "10010",
            key: "PROJ-10",
            linkType: "Blocks",
            direction: "outward",
          },
          {
            id: "10011",
            key: "PROJ-11",
            linkType: "Relates",
            direction: "inward",
          },
          {
            id: "10000",
            key: "PROJ-EPIC",
            linkType: "parent",
            direction: "inward",
          },
          {
            id: "10020",
            key: "PROJ-20",
            linkType: "subtask",
            direction: "outward",
          },
          {
            id: "PROJ-EPIC-LEGACY",
            key: "PROJ-EPIC-LEGACY",
            linkType: "Epic-Link",
            direction: "inward",
          },
        ])
      );
    });

    it("should skip Epic-Link silently when customfield_10014 is absent", async () => {
      const responseWithoutEpicLink = {
        ...mockJiraIssueWithLinks,
        fields: {
          ...mockJiraIssueWithLinks.fields,
          customfield_10014: undefined,
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(responseWithoutEpicLink),
      });

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toHaveLength(4);
      expect(result.some((ref) => ref.linkType === "Epic-Link")).toBe(false);
    });

    it("should return [] when all sources are empty/absent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "10001",
            key: "PROJ-1",
            fields: {
              issuelinks: [],
              subtasks: [],
            },
          }),
      });

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toEqual([]);
    });

    it("should fail soft on 403 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("PROJ-1");
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

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("PROJ-1");
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

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("PROJ-1");
      errorSpy.mockRestore();
    });

    it("should fail soft on network error by returning [] and logging at error level", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getLinkedIssues!("PROJ-1");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getLinkedIssues");
      expect(firstArg).toContain("PROJ-1");
      errorSpy.mockRestore();
    });

    it("should request all four fields in the URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssueWithLinks),
      });

      await adapter.getLinkedIssues!("PROJ-1");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      const decodedUrl = decodeURIComponent(calledUrl);
      expect(decodedUrl).toContain(
        "fields=issuelinks,parent,subtasks,customfield_10014"
      );
      expect(calledUrl).toContain("/rest/api/3/issue/PROJ-1");
    });

    it("should encode issueId path-injection chars (?, /, &) in URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraIssueWithLinks),
      });

      await adapter.getLinkedIssues!("PROJ-1?fields=*all");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("/rest/api/3/issue/PROJ-1%3Ffields%3D*all?");
      expect(calledUrl).not.toContain("/rest/api/3/issue/PROJ-1?fields=*all?");
    });
  });

  describe("getIssueComments", () => {
    const mockJiraCommentsResponse = {
      comments: [
        {
          id: "1",
          author: { displayName: "Alice" },
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Hello" }],
              },
            ],
          },
          created: "2026-01-01T00:00:00Z",
        },
        {
          id: "2",
          author: { displayName: "Bob" },
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "World" }],
              },
            ],
          },
          created: "2026-01-02T00:00:00Z",
        },
      ],
    };

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

    afterEach(() => {
      mockFetch.mockReset();
    });

    it("should request /rest/api/3/issue/{key}/comment", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraCommentsResponse),
      });

      await adapter.getIssueComments!("PROJ-1");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("/rest/api/3/issue/PROJ-1/comment");
    });

    it("should map all comments to IssueComment[] on the happy path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraCommentsResponse),
      });

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toEqual([
        {
          id: "1",
          author: "Alice",
          body: "<p>Hello</p>",
          created: "2026-01-01T00:00:00Z",
        },
        {
          id: "2",
          author: "Bob",
          body: "<p>World</p>",
          created: "2026-01-02T00:00:00Z",
        },
      ]);
    });

    it("should fall back to author.emailAddress when displayName is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: "3",
                author: { emailAddress: "bob@example.com" },
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Hi" }],
                    },
                  ],
                },
                created: "2026-01-03T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe("bob@example.com");
    });

    it("should fall back to author.accountId when displayName and emailAddress are missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: "5",
                author: { accountId: "557058:abc123-anonymized" },
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Hola" }],
                    },
                  ],
                },
                created: "2026-01-05T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe("557058:abc123-anonymized");
    });

    it("should fall back to 'Unknown' when displayName, emailAddress, and accountId are all missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: "4",
                author: {},
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Hey" }],
                    },
                  ],
                },
                created: "2026-01-04T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe("Unknown");
    });

    it("should return [] when comments array is absent or empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result1 = await adapter.getIssueComments!("PROJ-1");
      expect(result1).toEqual([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ comments: [] }),
      });

      const result2 = await adapter.getIssueComments!("PROJ-1");
      expect(result2).toEqual([]);
    });

    it("should skip malformed entries and keep valid ones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              null,
              {
                id: "5",
                author: { displayName: "Carol" },
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Valid" }],
                    },
                  ],
                },
                created: "2026-01-05T00:00:00Z",
              },
            ],
          }),
      });

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe("Carol");
    });

    it("should fail soft on 403 by returning [] and logging at warn level", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("PROJ-1");
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

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstArg = warnSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("PROJ-1");
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

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("PROJ-1");
      errorSpy.mockRestore();
    });

    it("should fail soft on network error by returning [] and logging at error level", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network ECONNRESET"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await adapter.getIssueComments!("PROJ-1");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstArg = errorSpy.mock.calls[0].join(" ");
      expect(firstArg).toContain("[JiraAdapter]");
      expect(firstArg).toContain("getIssueComments");
      expect(firstArg).toContain("PROJ-1");
      errorSpy.mockRestore();
    });

    it("should encode issueId path-injection chars (?, /, &) in URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraCommentsResponse),
      });

      await adapter.getIssueComments!("PROJ-1?fields=*all");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain(
        "/rest/api/3/issue/PROJ-1%3Ffields%3D*all/comment"
      );
      expect(calledUrl).not.toContain("/rest/api/3/issue/PROJ-1?fields=*all/");
    });

    it("should encode traversal chars (../) in issueId path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJiraCommentsResponse),
      });

      await adapter.getIssueComments!("PROJ-1/../");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("PROJ-1%2F..%2F/comment");
      expect(calledUrl).not.toContain("PROJ-1/../comment");
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

    it("paginates via nextPageToken (Jira Cloud /search/jql)", async () => {
      // The new endpoint returns a cursor and no `total`.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [mockJiraIssue],
            nextPageToken: "TOKEN-2",
          }),
      });

      const result = await adapter.searchIssues({
        limit: 50,
        pageToken: "TOKEN-1",
      });

      expect(result.hasMore).toBe(true);
      expect(result.nextPageToken).toBe("TOKEN-2");

      const searchCall = mockFetch.mock.calls[1];
      expect(searchCall[0]).toContain("nextPageToken=TOKEN-1");
      expect(searchCall[0]).toContain("maxResults=50");
      // startAt must no longer be sent — the new endpoint ignores it.
      expect(searchCall[0]).not.toContain("startAt=");
    });

    it("reports the page count as total when the endpoint omits total", async () => {
      // /search/jql on the last page: issues, no token, no total.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [mockJiraIssue, mockJiraIssue],
          }),
      });

      const result = await adapter.searchIssues({ projectId: "TEST" });

      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextPageToken).toBeUndefined();
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

    it("should scope by recency window (updatedWithinDays)", async () => {
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
        projectId: "TEST",
        updatedWithinDays: 90,
      });

      const searchCall = mockFetch.mock.calls[1];
      const decodedUrl = decodeURIComponent(searchCall[0].replace(/\+/g, " "));
      expect(decodedUrl).toContain("updated >= -90d");
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

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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

    it("prefers per-integration config credentials/redirect URI over JIRA_* env vars", () => {
      // Legacy env-level app would point elsewhere…
      vi.stubEnv("JIRA_CLIENT_ID", "env-client-id");
      vi.stubEnv("JIRA_REDIRECT_URI", "https://env.example.com/callback");

      // …but the per-integration config (built by IntegrationManager from the
      // integration's stored credentials) must win.
      const perIntegrationAdapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://test.atlassian.net",
        clientId: "integration-client-id",
        redirectUri:
          "https://app.example.com/api/integrations/oauth/jira/callback",
      });

      const url = perIntegrationAdapter.getAuthorizationUrl("test-state");

      expect(url).toContain("client_id=integration-client-id");
      expect(url).not.toContain("env-client-id");
      expect(url).toContain("oauth%2Fjira%2Fcallback");

      vi.unstubAllEnvs();
    });

    it("requests granular Jira Software scopes alongside the classic platform scopes", () => {
      // The Agile API (board discovery + sprints, i.e. ITERATION milestone
      // import and sprint webhook routing) does not honour classic scopes —
      // omitting the granular trio makes every /rest/agile/1.0 call fail with
      // 401 "Unauthorized; scope does not match" while the platform endpoints
      // keep working. Locked in so the scope list can't silently regress.
      const adapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://test.atlassian.net",
        clientId: "test-client-id",
        redirectUri: "https://app.com/callback",
      });

      const scope =
        new URL(adapter.getAuthorizationUrl("test-state")).searchParams.get(
          "scope"
        ) ?? "";
      const scopes = scope.split(" ");

      expect(scopes).toEqual(
        expect.arrayContaining([
          // Jira platform (classic)
          "read:jira-work",
          "write:jira-work",
          "read:jira-user",
          // Jira Software / Agile (granular)
          "read:board-scope:jira-software",
          "read:sprint:jira-software",
          "read:project:jira",
          // Refresh tokens
          "offline_access",
        ])
      );
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

      await expect(
        adapter.exchangeCodeForTokens("invalid-code")
      ).rejects.toThrow("Failed to exchange code for tokens");

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

  describe("resolveBoardProject", () => {
    let boardAdapter: JiraAdapter;

    beforeEach(async () => {
      mockValkeyGet.mockReset();
      mockValkeySet.mockReset();
      mockValkeyGet.mockResolvedValue(null);
      mockValkeySet.mockResolvedValue("OK");

      boardAdapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://test.atlassian.net",
        integrationId: 42,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accountId: "test-user" }),
      });
      await boardAdapter.authenticate({
        type: "api_key",
        email: "test@example.com",
        apiToken: "test-token",
        baseUrl: "https://test.atlassian.net",
      });
    });

    it("fetches a SINGLE board (not a project's board list) and returns location.projectId/projectKey", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 7,
            location: { projectId: "10050", projectKey: "DEMO" },
          }),
      });

      const result = await boardAdapter.resolveBoardProject("7");

      expect(result).toEqual({ projectId: "10050", projectKey: "DEMO" });
      const calledUrl = mockFetch.mock.calls[1][0] as string;
      expect(calledUrl).toContain("/rest/agile/1.0/board/7");
      expect(calledUrl).not.toContain("projectKeyOrId");
    });

    it("caches the result in Valkey under jira-board-project:<integrationId>:<boardId>", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 7,
            location: { projectId: "10050", projectKey: "DEMO" },
          }),
      });

      await boardAdapter.resolveBoardProject("7");

      expect(mockValkeySet).toHaveBeenCalledWith(
        "jira-board-project:42:7",
        JSON.stringify({ projectId: "10050", projectKey: "DEMO" }),
        "EX",
        expect.any(Number)
      );
    });

    it("returns a cached result without calling fetch again", async () => {
      mockValkeyGet.mockResolvedValueOnce(
        JSON.stringify({ projectId: "999", projectKey: "CACHED" })
      );

      const result = await boardAdapter.resolveBoardProject("7");

      expect(result).toEqual({ projectId: "999", projectKey: "CACHED" });
      // Only the beforeEach's authenticate() call hit fetch — no board fetch.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns null (never throws) on a 404 board lookup", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Board does not exist"),
      });

      const result = await boardAdapter.resolveBoardProject("999");

      expect(result).toBeNull();
    });

    it("returns null when location.projectId is absent (defensive parse, MEDIUM-confidence shape)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 7, name: "Board without location" }),
      });

      const result = await boardAdapter.resolveBoardProject("7");

      expect(result).toBeNull();
    });

    it("REGRESSION (WR-06): rejects a non-numeric board id WITHOUT any upstream request or cache access — the id is interpolated into the REST path and cache key", async () => {
      const result = await boardAdapter.resolveBoardProject(
        "1/../../api/3/anything?x="
      );

      expect(result).toBeNull();
      // Only the beforeEach's authenticate() call hit fetch — the forged id
      // never reached makeRequest, and the cache was never consulted.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockValkeyGet).not.toHaveBeenCalled();
      expect(mockValkeySet).not.toHaveBeenCalled();
    });
  });
});

describe("JiraAdapter Data Center / Server", () => {
  // Reuses the module-level `mockFetch` + `global.fetch` declared at the
  // top of this file (Cloud tests). Each test resets it in its own
  // beforeEach.
  let adapter: JiraAdapter;

  // Field shapes below (plain-string description, name/key user refs) match
  // a live Jira DC 10.3.13 GET /issue response recorded in
  // __fixtures__/jira-dc/call-004.json — DC v2 returns descriptions as plain
  // strings (or null), never ADF, unlike Cloud's v3.
  const dcIssue = {
    id: "20001",
    key: "DC-1",
    self: "https://jira.mycompany.domain/rest/api/2/issue/20001",
    fields: {
      summary: "DC Issue",
      description: "DC body",
      status: { name: "Open" },
      priority: { name: "High" },
      issuetype: { id: "10001", name: "Bug", iconUrl: "https://icon.url" },
      assignee: {
        name: "alice",
        displayName: "Alice",
        emailAddress: "alice@mycompany.domain",
      },
      reporter: {
        name: "bob",
        displayName: "Bob",
        emailAddress: "bob@mycompany.domain",
      },
      labels: [],
      created: "2024-01-15T10:00:00.000Z",
      updated: "2024-01-15T12:00:00.000Z",
    },
  };

  beforeEach(() => {
    mockFetch.mockReset();
    adapter = new JiraAdapter({
      provider: "JIRA",
      deploymentType: "server",
      baseUrl: "https://jira.mycompany.domain",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates against /rest/api/2 with Basic username:password", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice", displayName: "Alice" }),
    });

    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, any];
    expect(url).toBe("https://jira.mycompany.domain/rest/api/2/myself");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(
      Buffer.from(init.headers.Authorization.slice(6), "base64").toString(
        "utf8"
      )
    ).toBe("alice:secret");
  });

  it("auto-detects Data Center via v3 404 + serverInfo and authenticates a PAT as Bearer", async () => {
    const auto = new JiraAdapter({
      provider: "JIRA",
      baseUrl: "https://jira.mycompany.domain",
    });

    // v3 /myself -> 404 (Data Center has no v3)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    // serverInfo -> Server
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deploymentType: "Server", version: "10.3.13" }),
    });
    // v2 /myself -> ok
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice", displayName: "Alice" }),
    });

    await auto.authenticate({
      type: "api_key",
      apiToken: "pat-123",
      baseUrl: "https://jira.mycompany.domain",
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://jira.mycompany.domain/rest/api/3/myself"
    );
    const v2Call = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "https://jira.mycompany.domain/rest/api/2/myself"
    );
    expect(v2Call).toBeTruthy();
    expect((v2Call![1] as any).headers.Authorization).toBe("Bearer pat-123");
  });

  it("uses /rest/api/2/search (not search/jql) on Data Center", async () => {
    // auth (v2 /myself)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ issues: [dcIssue], total: 1, startAt: 0 }),
    });

    const res = await adapter.searchIssues({ query: "DC", limit: 1 });

    const searchCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/rest/api/2/search?")
    );
    expect(searchCall).toBeTruthy();
    expect(searchCall![0]).not.toContain("search/jql");
    expect(res.issues).toHaveLength(1);
  });

  it("maps Data Center users by name (not accountId)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dcIssue),
    });

    const issue = await adapter.getIssue("DC-1");
    expect(issue.assignee?.id).toBe("alice");
    expect(issue.reporter?.id).toBe("bob");
  });

  it("emits reporter and assignee as { name } when creating issues on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // create response (only id/key/self) -> triggers a getIssue fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "20001",
          key: "DC-1",
          self: "https://jira.mycompany.domain/rest/api/2/issue/20001",
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dcIssue),
    });

    await adapter.createIssue({
      title: "DC Issue",
      projectId: "DC",
      issueType: "10001",
      assigneeId: "alice",
      customFields: { reporter: { accountId: "bob" } },
    } as any);

    const createCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/issue")
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse((createCall![1] as any).body);
    expect(body.fields.assignee).toEqual({ name: "alice" });
    expect(body.fields.reporter).toEqual({ name: "bob" });
  });

  it("handles Jira's 204 No Content on PUT /issue and the transition-execute POST (live contract suite #9)", async () => {
    // Confirmed live against jira.rapidsoft.ru: both the issue-update PUT
    // and the transition-execute POST return 204 with an empty body.
    // makeRequest used to call response.json() unconditionally, which
    // throws "Unexpected end of JSON input" on an empty body — this was a
    // real, previously undiscovered crash in updateIssue()/status changes,
    // on Cloud as much as Data Center, since nothing had ever driven a
    // live transition before the contract suite's #9 test.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch
      // PUT /issue/{id} (fields update, empty since only status changes here)
      .mockResolvedValueOnce({ ok: true, status: 204 })
      // GET /issue/{id}/transitions
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            transitions: [
              { id: "21", name: "Start", to: { name: "In Progress" } },
            ],
          }),
      })
      // POST /issue/{id}/transitions (execute) -> 204
      .mockResolvedValueOnce({ ok: true, status: 204 })
      // getIssue() at the end of updateIssue()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

    await expect(
      adapter.updateIssue("DC-1", { status: "In Progress" })
    ).resolves.toBeTruthy();

    const transitionPost = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" &&
        c[0].endsWith("/transitions") &&
        (c[1] as any)?.method === "POST"
    );
    expect(transitionPost).toBeTruthy();
    expect(JSON.parse((transitionPost![1] as any).body)).toEqual({
      transition: { id: "21" },
    });
  });

  it("maps a user-picker custom field { accountId } to { name } when creating issues on Data Center", async () => {
    // The form/route always emit a user-picker value as { accountId } (Jira's
    // own Cloud convention) regardless of deployment — worklist #7. Request
    // body shape below matches a live POST /issue recording (status 201)
    // against jira.rapidsoft.ru: no description supplied -> "" (not null,
    // and not omitted); no assignee/reporter/priority keys when unset.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: "20001",
          key: "DC-1",
          self: "https://jira.mycompany.domain/rest/api/2/issue/20001",
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dcIssue),
    });

    await adapter.createIssue({
      title: "DC Issue",
      projectId: "DC",
      issueType: "10001",
      customFields: { customfield_10050: { accountId: "carol" } },
    } as any);

    const createCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/issue")
    );
    expect((createCall![1] as any).method).toBe("POST");
    const body = JSON.parse((createCall![1] as any).body);
    expect(body).toEqual({
      fields: {
        project: { key: "DC" },
        summary: "DC Issue",
        description: "",
        issuetype: { id: "10001" },
        labels: [],
        customfield_10050: { name: "carol" },
      },
    });
  });

  it("maps a user-picker custom field { accountId } to { name } when updating issues on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // PUT /issue/{id} really returns 204 No Content on Data Center (and
    // Cloud) — no `.json()` method on this mock at all, so this test fails
    // if makeRequest's 204 handling regresses (it used to call
    // response.json() unconditionally and crash on a live empty body).
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

    await adapter.updateIssue("DC-1", {
      customFields: { customfield_10050: { accountId: "carol" } },
    });

    const updateCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/issue/DC-1")
    );
    expect((updateCall![1] as any).method).toBe("PUT");
    const body = JSON.parse((updateCall![1] as any).body);
    expect(body.fields.customfield_10050).toEqual({ name: "carol" });
  });

  it("synthesizes a startAt-based nextPageToken on Data Center so pagination can advance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // Page 1: one issue back, two more exist (total=3, startAt=0).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ issues: [dcIssue], total: 3, startAt: 0 }),
    });
    const page1 = await adapter.searchIssues({ projectId: "DC", limit: 1 });
    expect(page1.hasMore).toBe(true);
    expect(page1.nextPageToken).toBe("1");

    // Page 2: pass the returned cursor back in — the adapter must send it
    // as startAt (this is the SyncService.performProjectImport contract).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ issues: [dcIssue], total: 3, startAt: 1 }),
    });
    const page2 = await adapter.searchIssues({
      projectId: "DC",
      limit: 1,
      pageToken: page1.nextPageToken,
    });

    const searchCalls = mockFetch.mock.calls.filter(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/rest/api/2/search?")
    );
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[0]![0]).not.toContain("startAt");
    expect(searchCalls[1]![0]).toContain("startAt=1");
    expect(page2.hasMore).toBe(true);
    expect(page2.nextPageToken).toBe("2");
  });

  it("omits nextPageToken on Data Center once the last page is reached", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ issues: [dcIssue], total: 1, startAt: 0 }),
    });
    const res = await adapter.searchIssues({ projectId: "DC", limit: 50 });
    expect(res.hasMore).toBe(false);
    expect(res.nextPageToken).toBeUndefined();
  });

  // Below: Phase C mock tightening for the 4 endpoints that only had
  // Cloud-shaped hand-written mocks (see JiraAdapter.test.ts's top-level
  // "getProjects"/"getIssueTypes"/"searchUsers" describes). Request URLs and
  // response bodies match live recordings under
  // __fixtures__/jira-dc/jira-dc-live-contract-pat-bearer-{3,4,8,11}-*/
  // (project key/IDs trimmed for readability; shapes are unchanged).

  it("getProjects: uses GET /project (bare array, not /project/search) on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // Bare array, no `{ values }` wrapper — matches a live GET
    // /rest/api/2/project recording against jira.rapidsoft.ru.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "12881",
            key: "TITP",
            name: "TestPlanIt Integration Test project",
            projectTypeKey: "software",
          },
          {
            id: "10145",
            key: "SUPPORT",
            name: "Техническая поддержка",
            projectTypeKey: "software",
          },
        ]),
    });

    const projects = await adapter.getProjects();

    const call = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/project")
    );
    expect(call).toBeTruthy();
    expect(call![0]).not.toContain("/project/search");
    expect(projects).toEqual([
      { id: "12881", key: "TITP", name: "TestPlanIt Integration Test project" },
      { id: "10145", key: "SUPPORT", name: "Техническая поддержка" },
    ]);
  });

  it("getIssueTypes: reads project.issueTypes from GET /project/{key} on Data Center, subtasks included", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // Matches a live GET /rest/api/2/project/TITP recording: issue types
    // live under `project.issueTypes`, unfiltered — only the /issuetype
    // fallback path (project lookup failure) drops subtasks.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          key: "TITP",
          issueTypes: [
            { id: "3", name: "Task", subtask: false },
            { id: "15", name: "Sub-task", subtask: true },
            { id: "1", name: "Bug", subtask: false },
          ],
        }),
    });

    const types = await adapter.getIssueTypes("TITP");

    const call = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/project/TITP")
    );
    expect(call).toBeTruthy();
    expect(types).toEqual([
      { id: "3", name: "Task" },
      { id: "15", name: "Sub-task" },
      { id: "1", name: "Bug" },
    ]);
  });

  it("searchUsers: uses ?username= (not ?query=) on Data Center and ids users by name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // Bare array with name/key (no accountId) — matches a live GET
    // /rest/api/2/user/search?username=... recording.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            key: "JIRAUSER16307",
            name: "testplanit",
            emailAddress: "testplanit@rapidsoft.ru",
            displayName: "TestPlanIt",
          },
        ]),
    });

    const result = await adapter.searchUsers("testplanit");

    const call = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/rest/api/2/user/search?")
    );
    expect(call).toBeTruthy();
    expect(call![0]).toContain("username=testplanit");
    expect(call![0]).not.toContain("query=");
    expect(result).toEqual({
      users: [
        {
          accountId: "testplanit",
          displayName: "TestPlanIt",
          emailAddress: "testplanit@rapidsoft.ru",
          avatarUrls: undefined,
        },
      ],
      total: 1,
    });
  });

  it("searchUsers: assignable search uses ?username= (not ?query=) on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // Server/DC /user/assignable/search filters by `username` and silently
    // ignores the Cloud-only `query` param (verified live on DC 10.3.13:
    // query= returns the full unfiltered assignable list).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            key: "JIRAUSER16307",
            name: "testplanit",
            emailAddress: "testplanit@rapidsoft.ru",
            displayName: "TestPlanIt",
          },
        ]),
    });

    const result = await adapter.searchUsers("testplanit", "TITP");

    const call = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" &&
        c[0].includes("/rest/api/2/user/assignable/search?")
    );
    expect(call).toBeTruthy();
    expect(call![0]).toContain("project=TITP");
    expect(call![0]).toContain("username=testplanit");
    expect(call![0]).not.toContain("query=");
    expect(result).toEqual({
      users: [
        {
          accountId: "testplanit",
          displayName: "TestPlanIt",
          emailAddress: "testplanit@rapidsoft.ru",
          avatarUrls: undefined,
        },
      ],
      total: 1,
    });
  });

  it("addComment: sends a plain-string body (not ADF) on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // 201 with the created comment — matches a live POST
    // /rest/api/2/issue/{key}/comment recording.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: "619041",
          body: "contract comment",
          author: { name: "testplanit", displayName: "TestPlanIt" },
        }),
    });

    await (adapter as any).addComment("DC-1", "contract comment");

    const call = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" &&
        c[0].endsWith("/rest/api/2/issue/DC-1/comment")
    );
    expect(call).toBeTruthy();
    expect((call![1] as any).method).toBe("POST");
    expect(JSON.parse((call![1] as any).body)).toEqual({
      body: "contract comment",
    });
  });

  // Rich text on Data Center: descriptions are Jira Wiki Markup, not stripped
  // plain text (proven live — a wiki-markup string round-trips to formatted
  // HTML via Jira's own renderer). These guard the write side (TipTap/HTML ->
  // wiki markup) and the read side (Jira-rendered HTML in / renderedFields /
  // renderedBody).

  it("createIssue: sends a formatted description as Jira Wiki Markup (not stripped plain text)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // create -> {id,key,self}, then getIssue for the full issue
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            id: "20001",
            key: "DC-1",
            self: "https://jira.mycompany.domain/rest/api/2/issue/20001",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

    // TipTap doc as emitted by the rich-text editor: a paragraph with a bold
    // run and a link, then a bullet list.
    await adapter.createIssue({
      title: "DC rich text",
      projectId: "DC",
      issueType: "10001",
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "see " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " and " },
              {
                type: "text",
                text: "a link",
                marks: [
                  { type: "link", attrs: { href: "https://example.com" } },
                ],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "one" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "two" }],
                  },
                ],
              },
            ],
          },
        ],
      } as any,
    });

    const createCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].endsWith("/rest/api/2/issue")
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse((createCall![1] as any).body);
    // A plain string field (wiki markup), NOT an ADF object — and formatting
    // is preserved, not stripped.
    expect(typeof body.fields.description).toBe("string");
    expect(body.fields.description).toBe(
      "see *bold* and [a link|https://example.com]\n\n* one\n* two"
    );
  });

  it("updateIssue: sends a formatted description as Jira Wiki Markup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // PUT -> 204, then getIssue
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

    await adapter.updateIssue("DC-1", {
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "now italic", marks: [{ type: "italic" }] },
            ],
          },
        ],
      } as any,
    });

    const updateCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" &&
        c[0].endsWith("/rest/api/2/issue/DC-1") &&
        (c[1] as any)?.method === "PUT"
    );
    expect(updateCall).toBeTruthy();
    const body = JSON.parse((updateCall![1] as any).body);
    expect(body.fields.description).toBe("_now italic_");
  });

  it("getIssue: requests renderedFields and surfaces Jira's rendered HTML on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    // dcIssue.fields.description is raw wiki markup; renderedFields carries
    // Jira's own HTML rendering of it (shape matches a live GET recording).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ...dcIssue,
          fields: { ...dcIssue.fields, description: "*bold* body" },
          renderedFields: { description: "<p><b>bold</b> body</p>" },
        }),
    });

    const issue = await adapter.getIssue("DC-1");

    const getCall = mockFetch.mock.calls.find(
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/rest/api/2/issue/DC-1?")
    );
    expect(getCall).toBeTruthy();
    // expand must include renderedFields (URLSearchParams encodes the comma)
    expect(decodeURIComponent(getCall![0] as string)).toContain(
      "expand=names,schema,renderedFields"
    );
    // The rendered HTML wins over the raw "*bold* body" markup.
    expect(issue.description).toBe("<p><b>bold</b> body</p>");
  });

  it("getIssueComments: requests renderedBody and surfaces Jira's rendered HTML on Data Center", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice" }),
    });
    await adapter.authenticate({
      type: "api_key",
      username: "alice",
      password: "secret",
      baseUrl: "https://jira.mycompany.domain",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          comments: [
            {
              id: "1",
              author: { displayName: "Alice" },
              body: "*bold* comment",
              renderedBody: "<p><b>bold</b> comment</p>",
              created: "2024-01-15T10:00:00.000Z",
            },
          ],
        }),
    });

    const comments = await adapter.getIssueComments("DC-1");

    const getCall = mockFetch.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/comment")
    );
    expect(getCall).toBeTruthy();
    expect(getCall![0] as string).toContain("expand=renderedBody");
    expect(comments[0]!.body).toBe("<p><b>bold</b> comment</p>");
  });
});
