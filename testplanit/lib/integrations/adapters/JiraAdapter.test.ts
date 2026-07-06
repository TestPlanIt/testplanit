import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        "Jira Cloud authentication requires an email and an API token"
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

      expect(body.fields.assignee).toEqual({ id: "user-123" });
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
});

describe("JiraAdapter Server / Data Center", () => {
  const BASE = "https://jira.example.com";

  // A REAL v2 issue shape: descriptions and comment bodies are wiki-markup
  // STRINGS (never ADF), users carry name/key (never accountId), and
  // renderedFields holds the server-rendered HTML when requested.
  const dcIssue = {
    id: "20001",
    key: "DC-1",
    self: `${BASE}/rest/api/2/issue/20001`,
    renderedFields: {
      description: "<p>DC <b>body</b></p>",
    },
    fields: {
      summary: "DC Issue",
      description: "DC *body*",
      status: { name: "Open" },
      priority: { name: "High" },
      issuetype: { id: "10001", name: "Bug", iconUrl: "https://icon.url" },
      assignee: {
        name: "alice",
        key: "JIRAUSER100",
        displayName: "Alice",
        emailAddress: "alice@example.com",
      },
      reporter: {
        name: "bob",
        key: "JIRAUSER200",
        displayName: "Bob",
        emailAddress: "bob@example.com",
      },
      labels: [],
      created: "2024-01-15T10:00:00.000Z",
      updated: "2024-01-15T12:00:00.000Z",
    },
  };

  let adapter: JiraAdapter;

  const authenticateServer = async (
    target: JiraAdapter,
    creds: Record<string, string> = { username: "alice", password: "s3cret" }
  ) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "alice", displayName: "Alice" }),
    });
    await target.authenticate({
      type: "api_key",
      baseUrl: BASE,
      ...creds,
    } as any);
    mockFetch.mockClear();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new JiraAdapter({
      provider: "JIRA",
      baseUrl: BASE,
      deploymentType: "server",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("probes v2 /myself with Bearer for a Personal Access Token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: "svc" }),
      });

      await adapter.authenticate({
        type: "api_key",
        apiToken: "pat-1",
        baseUrl: BASE,
      });

      const [url, init] = mockFetch.mock.calls[0] as [string, any];
      expect(url).toBe(`${BASE}/rest/api/2/myself`);
      expect(init.headers.Authorization).toBe("Bearer pat-1");
    });

    it("probes v2 /myself with Basic for username + password", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: "alice" }),
      });

      await adapter.authenticate({
        type: "api_key",
        username: "alice",
        password: "s3cret",
        baseUrl: BASE,
      } as any);

      const [url, init] = mockFetch.mock.calls[0] as [string, any];
      expect(url).toBe(`${BASE}/rest/api/2/myself`);
      expect(
        Buffer.from(
          init.headers.Authorization.slice("Basic ".length),
          "base64"
        ).toString("utf8")
      ).toBe("alice:s3cret");
    });

    it("sends a PAT as Bearer even when an email is also configured (#494)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: "svc" }),
      });

      await adapter.authenticate({
        type: "api_key",
        email: "user@example.com",
        apiToken: "pat-1",
        baseUrl: BASE,
      });

      const [, init] = mockFetch.mock.calls[0] as [string, any];
      expect(init.headers.Authorization).toBe("Bearer pat-1");
    });

    it("fails with an actionable error when no server credential shape is present", async () => {
      await expect(
        adapter.authenticate({
          type: "api_key",
          email: "user@example.com",
          baseUrl: BASE,
        })
      ).rejects.toThrow(/Personal Access Token or a username and password/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("getProjects", () => {
    it("uses /rest/api/2/project (bare array) — /project/search does not exist on Server", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "1", key: "DC", name: "Data Center Project" },
          ]),
      });

      const projects = await adapter.getProjects();

      expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/rest/api/2/project`);
      expect(projects).toEqual([
        { id: "1", key: "DC", name: "Data Center Project" },
      ]);
    });
  });

  describe("searchIssues", () => {
    it("uses classic /rest/api/2/search with startAt pagination and renderedFields", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [dcIssue],
            total: 3,
            startAt: 0,
            maxResults: 1,
          }),
      });

      const result = await adapter.searchIssues({
        query: "DC",
        limit: 1,
        offset: 0,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/rest/api/2/search?");
      expect(url).not.toContain("search/jql");
      expect(url).toContain("startAt=0");
      expect(url).toContain("expand=renderedFields");
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.nextPageToken).toBeUndefined();
      // v2 wiki-markup description is replaced by the rendered HTML.
      expect(result.issues[0].description).toBe("<p>DC <b>body</b></p>");
    });

    it("reports hasMore=false on the final page", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ issues: [dcIssue], total: 3, startAt: 2 }),
      });

      const result = await adapter.searchIssues({ limit: 2, offset: 2 });
      expect(result.hasMore).toBe(false);
    });
  });

  describe("createIssue", () => {
    it("sends a wiki-markup string description and name-based user refs to v2", async () => {
      await authenticateServer(adapter);
      // create response, then the follow-up getIssue fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ id: "20001", key: "DC-1", self: dcIssue.self }),
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
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "broken", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
        customFields: { reporter: { accountId: "bob" } },
      });

      const createCall = mockFetch.mock.calls.find((c: any[]) =>
        String(c[0]).endsWith("/rest/api/2/issue")
      );
      expect(createCall).toBeTruthy();
      const body = JSON.parse((createCall![1] as any).body);
      expect(body.fields.description).toBe("*broken*");
      expect(body.fields.assignee).toEqual({ name: "alice" });
      expect(body.fields.reporter).toEqual({ name: "bob" });
    });
  });

  describe("updateIssue", () => {
    it("PUTs to v2 with a string description and { name } assignee", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

      await adapter.updateIssue("DC-1", {
        description: "plain update",
        assigneeId: "alice",
      });

      const [url, init] = mockFetch.mock.calls[0] as [string, any];
      expect(url).toBe(`${BASE}/rest/api/2/issue/DC-1`);
      const body = JSON.parse(init.body);
      expect(body.fields.description).toBe("plain update");
      expect(body.fields.assignee).toEqual({ name: "alice" });
    });
  });

  describe("comments", () => {
    it("posts comment bodies as plain strings (v2 rejects ADF)", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await (adapter as any).addComment("DC-1", "linked from TestPlanIt");

      const [url, init] = mockFetch.mock.calls[0] as [string, any];
      expect(url).toBe(`${BASE}/rest/api/2/issue/DC-1/comment`);
      expect(JSON.parse(init.body)).toEqual({
        body: "linked from TestPlanIt",
      });
    });

    it("reads comments with expand=renderedBody and prefers the rendered HTML", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: 1,
                author: { name: "alice", displayName: "Alice" },
                body: "wiki *comment*",
                renderedBody: "<p>wiki <b>comment</b></p>",
                created: "2024-01-15T10:00:00.000Z",
              },
            ],
          }),
      });

      const comments = await adapter.getIssueComments("DC-1");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE}/rest/api/2/issue/DC-1/comment?expand=renderedBody`
      );
      expect(comments[0].body).toBe("<p>wiki <b>comment</b></p>");
      expect(comments[0].author).toBe("Alice");
    });
  });

  describe("getIssue", () => {
    it("requests renderedFields and maps name-based users", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dcIssue),
      });

      const issue = await adapter.getIssue("DC-1");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/rest/api/2/issue/DC-1?");
      expect(url).toContain("renderedFields");
      expect(issue.description).toBe("<p>DC <b>body</b></p>");
      expect(issue.assignee?.id).toBe("alice");
      expect(issue.reporter?.id).toBe("bob");
    });

    it("falls back to the raw wiki string when renderedFields is absent", async () => {
      await authenticateServer(adapter);
      const { renderedFields: _omitted, ...withoutRendered } = dcIssue;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(withoutRendered),
      });

      const issue = await adapter.getIssue("DC-1");
      expect(issue.description).toBe("DC *body*");
    });
  });

  describe("searchUsers", () => {
    it("searches with the v2 username parameter and never calls accountId search", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              name: "alice",
              key: "JIRAUSER100",
              displayName: "Alice",
              emailAddress: "alice@example.com",
            },
          ]),
      });

      const result = await adapter.searchUsers("alice@example.com");

      const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
      for (const url of urls) {
        expect(url).toContain("username=");
        expect(url).not.toContain("query=");
        expect(url).not.toContain("accountId=");
      }
      const users = Array.isArray(result) ? result : result.users;
      // The Server username fills the accountId slot — it IS the identifier
      // this deployment addresses users by.
      expect(users[0].accountId).toBe("alice");
    });
  });

  describe("getIssueTypeFields", () => {
    it("uses the Jira 9+ per-issue-type createmeta endpoint (classic was removed in 9.0)", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            values: [
              {
                fieldId: "summary",
                name: "Summary",
                required: true,
              },
              {
                fieldId: "customfield_10100",
                name: "Severity",
                required: false,
                allowedValues: [{ value: "Low" }],
              },
            ],
          }),
      });

      const fields = await adapter.getIssueTypeFields("DC", "10001");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE}/rest/api/2/issue/createmeta/DC/issuetypes/10001?maxResults=200`
      );
      // summary is dialog-handled and filtered out; fieldId maps to key.
      expect(fields).toEqual([
        expect.objectContaining({ key: "customfield_10100", name: "Severity" }),
      ]);
    });

    it("falls back to classic createmeta for Jira 8.x", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("no such resource"),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            projects: [
              {
                issuetypes: [
                  {
                    fields: {
                      labels: { name: "Labels", required: false },
                    },
                  },
                ],
              },
            ],
          }),
      });

      const fields = await adapter.getIssueTypeFields("DC", "10001");

      expect(mockFetch.mock.calls[1][0]).toContain(
        "/rest/api/2/issue/createmeta?projectKeys=DC"
      );
      expect(fields).toEqual([
        expect.objectContaining({ key: "labels", name: "Labels" }),
      ]);
    });
  });

  describe("getCurrentUser", () => {
    it("returns the Server username in the accountId slot", async () => {
      await authenticateServer(adapter);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "svc-tpi",
            displayName: "TestPlanIt Service",
            emailAddress: "svc@example.com",
          }),
      });

      const user = await adapter.getCurrentUser();

      expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/rest/api/2/myself`);
      expect(user).toEqual({
        accountId: "svc-tpi",
        displayName: "TestPlanIt Service",
        emailAddress: "svc@example.com",
      });
    });
  });
});
