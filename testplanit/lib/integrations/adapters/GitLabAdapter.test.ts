import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabAdapter } from "./GitLabAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitLabAdapter", () => {
  let adapter: GitLabAdapter;

  const mockGitLabIssue = {
    iid: 42,
    title: "Test Issue",
    description: "This is a test issue",
    state: "opened",
    issue_type: "issue",
    web_url: "https://gitlab.com/testgroup/testrepo/-/issues/42",
    created_at: "2024-01-15T10:00:00.000Z",
    updated_at: "2024-01-15T12:00:00.000Z",
    assignee: {
      id: 101,
      name: "Test Assignee",
      username: "testassignee",
      email: "assignee@example.com",
    },
    author: {
      id: 202,
      name: "Test Author",
      username: "testauthor",
    },
    labels: ["bug", "priority::high"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitLabAdapter({
      provider: "GITLAB",
      projectPath: "testgroup/testrepo",
      baseUrl: "https://gitlab.com",
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      expect(adapter.getCapabilities()).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: false,
        attachments: true,
        linkedIssues: true,
        comments: true,
        milestones: { kinds: ["RELEASE"], webhooks: true },
      });
    });
  });

  describe("authenticate", () => {
    it("should authenticate successfully with a PAT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "glpat-test" })
      ).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.com/api/v4/user",
        expect.any(Object)
      );
    });

    it("should use custom baseUrl from authData", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      await adapter.authenticate({
        type: "api_key",
        apiKey: "glpat-test",
        baseUrl: "https://gitlab.example.com/",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.example.com/api/v4/user",
        expect.any(Object)
      );
    });

    it("should authenticate with an OAuth access token (Bearer header)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "oauth-user" }),
      });

      await adapter.authenticate({ type: "oauth", accessToken: "gl-oauth" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitlab.com/api/v4/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer gl-oauth",
          }),
        })
      );
    });

    it("should throw for an unsupported auth type", async () => {
      await expect(
        adapter.authenticate({ type: "basic", username: "u", password: "p" })
      ).rejects.toThrow(
        "GitLab adapter only supports OAuth and Personal Access Token authentication"
      );
    });

    it("should throw when PAT is missing", async () => {
      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "" })
      ).rejects.toThrow("Personal Access Token is required");
    });

    it("should throw when the token is invalid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "401 Unauthorized" }),
      });

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad-token" })
      ).rejects.toThrow("Invalid GitLab Personal Access Token");
    });
  });

  describe("OAuth", () => {
    const oauthAdapter = (instance?: string) =>
      new GitLabAdapter({
        provider: "GITLAB",
        clientId: "client-123",
        clientSecret: "secret-456",
        redirectUri: "https://app/cb",
        ...(instance ? { instanceUrl: instance } : {}),
      });

    it("advertises OAuth support", () => {
      expect(oauthAdapter().supportsOAuth).toBe(true);
    });

    it("builds the authorization URL on gitlab.com by default", () => {
      const url = new URL(oauthAdapter().getAuthorizationUrl("st"));
      expect(url.origin + url.pathname).toBe(
        "https://gitlab.com/oauth/authorize"
      );
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("api");
      expect(url.searchParams.get("state")).toBe("st");
    });

    it("uses the self-managed instance URL for the authorization URL", () => {
      const url = new URL(
        oauthAdapter("https://gitlab.example.com").getAuthorizationUrl("st")
      );
      expect(url.origin + url.pathname).toBe(
        "https://gitlab.example.com/oauth/authorize"
      );
    });

    it("exchanges an authorization code for tokens", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 7200,
          }),
      });

      const tokens = await oauthAdapter().exchangeCodeForTokens("code");

      expect(tokens.accessToken).toBe("at");
      expect(tokens.refreshToken).toBe("rt");
      expect(tokens.expiresAt).toBeInstanceOf(Date);
      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe("https://gitlab.com/oauth/token");
      expect(JSON.parse(options.body)).toMatchObject({
        grant_type: "authorization_code",
        code: "code",
        client_id: "client-123",
      });
    });

    it("refreshes tokens with the refresh_token grant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: "at2", refresh_token: "rt2" }),
      });

      const tokens = await oauthAdapter().refreshTokens("old-rt");

      expect(tokens.accessToken).toBe("at2");
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "old-rt",
      });
    });
  });

  describe("getIssueTypes", () => {
    it("should return Issue and Incident types", async () => {
      const types = await adapter.getIssueTypes("testgroup/testrepo");
      expect(types).toEqual([
        { id: "issue", name: "Issue" },
        { id: "incident", name: "Incident" },
      ]);
    });

    it("should return the same types regardless of projectId", async () => {
      const types = await adapter.getIssueTypes("");
      expect(types).toHaveLength(2);
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
    });

    it("should create an issue and return mapped data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitLabIssue),
      });

      const result = await adapter.createIssue({
        title: "Test Issue",
        description: "Test description",
        projectId: "testgroup/testrepo",
      });

      expect(result.key).toBe("testgroup/testrepo#42");
      expect(result.title).toBe("Test Issue");
      expect(result.status).toBe("opened");
      // issueType is an { id, name } pair matching getIssueTypes, not a bare
      // string — see the AZDO/GitLab issueType mapper fix.
      expect(result.issueType).toEqual({ id: "issue", name: "Issue" });
    });

    it("should include issue_type in payload when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...mockGitLabIssue, issue_type: "incident" }),
      });

      await adapter.createIssue({
        title: "Incident",
        projectId: "testgroup/testrepo",
        issueType: "incident",
      });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.issue_type).toBe("incident");
    });

    it("should not include issue_type when not provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitLabIssue),
      });

      await adapter.createIssue({
        title: "Issue",
        projectId: "testgroup/testrepo",
      });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body).not.toHaveProperty("issue_type");
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
    });

    it("should fetch by key format namespace/project#iid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitLabIssue),
      });

      const result = await adapter.getIssue("testgroup/testrepo#42");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/42",
        expect.any(Object)
      );
      expect(result.key).toBe("testgroup/testrepo#42");
    });

    it("should map issueType from issue_type field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...mockGitLabIssue, issue_type: "incident" }),
      });

      const result = await adapter.getIssue("testgroup/testrepo#42");
      // issueType is an { id, name } pair matching getIssueTypes, not a bare
      // string — see the AZDO/GitLab issueType mapper fix.
      expect(result.issueType).toEqual({ id: "incident", name: "Incident" });
    });

    it("should default issueType to 'issue' when field is absent", async () => {
      const { issue_type: _omit, ...issueWithoutType } = mockGitLabIssue;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issueWithoutType),
      });

      const result = await adapter.getIssue("testgroup/testrepo#42");
      expect(result.issueType).toEqual({ id: "issue", name: "Issue" });
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
    });

    it("should use search= for plain text queries", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitLabIssue]),
      });

      await adapter.searchIssues({ query: "login bug" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("search=login+bug");
      expect(url).not.toContain("iids");
    });

    it("should use iids[] when query matches key format namespace/project#iid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitLabIssue]),
      });

      await adapter.searchIssues({ query: "testgroup/testrepo#42" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("iids%5B%5D=42");
      expect(url).not.toContain("search=");
    });

    it("should use iids[] for any namespace/project#number pattern", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitLabIssue]),
      });

      await adapter.searchIssues({ query: "group/sub/project#7" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("iids%5B%5D=7");
    });

    it("should filter by status open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ status: ["open"] });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("state=opened");
    });

    it("should filter by status closed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ status: ["closed"] });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("state=closed");
    });

    it("should filter by assignee", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ assignee: "jdoe" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("assignee_username=jdoe");
    });

    it("should filter by labels", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ labels: ["bug", "backend"] });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("labels=bug%2Cbackend");
    });

    it("should indicate hasMore when result count equals limit", async () => {
      const issues = Array.from({ length: 5 }, (_, i) => ({
        ...mockGitLabIssue,
        iid: i + 1,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issues),
      });

      const result = await adapter.searchIssues({ limit: 5 });
      expect(result.hasMore).toBe(true);
    });

    it("should return empty results for non-array response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null),
      });

      const result = await adapter.searchIssues({});
      expect(result.issues).toEqual([]);
    });

    it("maps the issue type as an { id, name } pair, not a bare string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([{ ...mockGitLabIssue, issue_type: "incident" }]),
      });

      const result = await adapter.searchIssues({});

      expect(result.issues[0].issueType).toEqual({
        id: "incident",
        name: "Incident",
      });
    });

    it("issues exactly one request with no issue_type param when no types are selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitLabIssue]),
      });

      await adapter.searchIssues({});

      // beforeEach's authenticate() call is calls[0]; exactly one search call follows.
      expect(mockFetch.mock.calls).toHaveLength(2);
      const url = mockFetch.mock.calls[1][0];
      expect(url).not.toContain("issue_type");
    });

    it("issues exactly one request carrying issue_type=<value> when one type is selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitLabIssue]),
      });

      await adapter.searchIssues({ issueTypeIds: ["incident"] });

      expect(mockFetch.mock.calls).toHaveLength(2);
      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("issue_type=incident");
    });

    it("fans out sequentially, one request per selected type, concatenated in selection order", async () => {
      const issueResult = { ...mockGitLabIssue, iid: 1 };
      const incidentResult = { ...mockGitLabIssue, iid: 2 };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([issueResult]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([incidentResult]),
        });

      const result = await adapter.searchIssues({
        issueTypeIds: ["issue", "incident"],
      });

      // beforeEach's authenticate() = calls[0]; two sequential per-type calls follow.
      expect(mockFetch.mock.calls).toHaveLength(3);
      expect(mockFetch.mock.calls[1][0]).toContain("issue_type=issue");
      expect(mockFetch.mock.calls[2][0]).toContain("issue_type=incident");
      // Concatenated in selection order, not re-sorted.
      expect(result.issues.map((i) => i.id)).toEqual(["1", "2"]);
    });

    it("reports hasMore true when ANY selected type's page reported more", async () => {
      const fullPage = Array.from({ length: 2 }, (_, i) => ({
        ...mockGitLabIssue,
        iid: i + 1,
      }));
      const shortPage = [{ ...mockGitLabIssue, iid: 99 }];
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fullPage),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(shortPage),
        });

      const result = await adapter.searchIssues({
        limit: 2,
        issueTypeIds: ["issue", "incident"],
      });

      // First type's page is full (length === limit) -> that type's hasMore
      // is true; the second type's short page alone would be false. The
      // combined result must still be true.
      expect(result.hasMore).toBe(true);
    });

    it("walks EVERY page of each selected type across successive orchestrator iterations, skipping none", async () => {
      // The orchestrator advances its offset by the CONCATENATED row count,
      // so with two types that offset moves two pages per iteration. Deriving
      // each type's page from it therefore steps 1 -> 3 -> 5 and never asks
      // for page 2 of either type: roughly half the matching issues are
      // silently absent, and the run still reports success.
      const fullPage = (iid: number) => [
        { ...mockGitLabIssue, iid },
        { ...mockGitLabIssue, iid: iid + 1 },
      ];
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fullPage(100 + i * 10)),
        });
      }

      // Three iterations, driven the way SyncService drives them: offset
      // advances by the rows returned, and any cursor is handed straight back.
      let offset = 0;
      let pageToken: string | undefined;
      for (let iteration = 0; iteration < 3; iteration++) {
        const result = await adapter.searchIssues({
          limit: 2,
          offset,
          pageToken,
          issueTypeIds: ["issue", "incident"],
        });
        offset += result.issues.length;
        pageToken = result.nextPageToken;
      }

      // calls[0] is authenticate(); six searches follow, in type order.
      const pagesByType: Record<string, number[]> = { issue: [], incident: [] };
      for (const [url] of mockFetch.mock.calls.slice(1)) {
        const parsed = new URL(url as string);
        const type = parsed.searchParams.get("issue_type");
        const page = Number(parsed.searchParams.get("page"));
        if (type) pagesByType[type].push(page);
      }

      // Each type must be walked 1, 2, 3 -- consecutively and independently.
      expect(pagesByType.issue).toEqual([1, 2, 3]);
      expect(pagesByType.incident).toEqual([1, 2, 3]);
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
    });

    it("should PUT to the correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGitLabIssue, title: "Updated" }),
      });

      await adapter.updateIssue("testgroup/testrepo#42", { title: "Updated" });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/42",
        expect.objectContaining({ method: "PUT" })
      );
    });

    it("should map done status to state_event close", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGitLabIssue, state: "closed" }),
      });

      await adapter.updateIssue("testgroup/testrepo#42", { status: "done" });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.state_event).toBe("close");
    });

    it("should map open status to state_event reopen", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitLabIssue),
      });

      await adapter.updateIssue("testgroup/testrepo#42", { status: "open" });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.state_event).toBe("reopen");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
    });

    it("should return projects mapped from GitLab response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              path_with_namespace: "testgroup/testrepo",
              name_with_namespace: "Test Group / Test Repo",
            },
          ]),
      });

      const projects = await adapter.getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("testgroup/testrepo");
      expect(projects[0].name).toBe("Test Group / Test Repo");
    });

    it("should return empty array for non-array response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null),
      });

      const projects = await adapter.getProjects();
      expect(projects).toEqual([]);
    });

    it("walks every page of /api/v4/projects", async () => {
      (adapter as any).rateLimitDelay = 0;
      const page = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          path_with_namespace: `g/p${from + i + 1}`,
          name_with_namespace: `G / P${from + i + 1}`,
        }));
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(page(0, 100)),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(page(100, 1)),
        });

      const projects = await adapter.getProjects();

      expect(projects).toHaveLength(101);
      expect(projects[100].id).toBe("g/p101");
      const urls = mockFetch.mock.calls
        .map((c: any[]) => c[0] as string)
        .filter((u) => u.includes("/api/v4/projects?"));
      expect(urls).toEqual([
        "https://gitlab.com/api/v4/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100&page=1",
        "https://gitlab.com/api/v4/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100&page=2",
      ]);
    });
  });

  describe("getIssueComments", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
    });

    it("walks every page of notes and drops system notes", async () => {
      const notes = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: from + i + 1,
          body: `n${from + i + 1}`,
          system: (from + i) % 2 === 1,
          author: { username: "alice" },
          created_at: "2026-01-01T00:00:00Z",
        }));
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(notes(0, 100)),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(notes(100, 2)),
        });

      const result = await adapter.getIssueComments!("testgroup/testrepo#5");

      expect(result).toHaveLength(51);
      expect(result[50]).toEqual({
        id: "101",
        author: "alice",
        body: "n101",
        created: "2026-01-01T00:00:00Z",
      });
      const urls = mockFetch.mock.calls
        .map((c: any[]) => c[0] as string)
        .filter((u) => u.includes("/notes"));
      expect(urls).toEqual([
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/5/notes?sort=asc&order_by=created_at&per_page=100&page=1",
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/5/notes?sort=asc&order_by=created_at&per_page=100&page=2",
      ]);
    });
  });

  describe("create and update fields", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitLabIssue),
      });
    });

    const sentBody = () =>
      JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);

    it("renders a TipTap document description as markdown", async () => {
      await adapter.createIssue({
        title: "From a failed iteration",
        projectId: "testgroup/testrepo",
        description: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Steps" }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Apply " },
                { type: "text", marks: [{ type: "bold" }], text: "SAVE10" },
              ],
            },
          ],
        },
      });

      expect(sentBody().description).toBe("## Steps\n\nApply **SAVE10**");
    });

    it("sends labels, every assignee and the milestone on create", async () => {
      await adapter.createIssue({
        title: "With metadata",
        projectId: "testgroup/testrepo",
        labels: ["bug", "needs tests"],
        assigneeIds: ["7", "9"],
        milestone: "12",
      });

      expect(sentBody()).toMatchObject({
        labels: "bug,needs tests",
        assignee_ids: [7, 9],
        milestone_id: 12,
      });
    });

    it("sends a single assignee given as assigneeId", async () => {
      await adapter.createIssue({
        title: "One assignee",
        projectId: "testgroup/testrepo",
        assigneeId: "7",
      });

      const body = sentBody();
      expect(body.assignee_ids).toEqual([7]);
      expect(body).not.toHaveProperty("milestone_id");
    });

    it("renders a TipTap document description on update", async () => {
      await adapter.updateIssue("testgroup/testrepo#42", {
        description: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Edited" }] },
          ],
        },
      });

      expect(sentBody().description).toBe("Edited");
    });

    it("clears assignees and the milestone on update", async () => {
      await adapter.updateIssue("testgroup/testrepo#42", {
        assigneeIds: [],
        milestone: "",
      });

      expect(sentBody()).toEqual({ assignee_ids: [], milestone_id: 0 });
    });
  });

  describe("getLinkedIssues", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
    });

    it("maps each link with its type and direction", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              iid: 2,
              link_type: "relates_to",
              references: { full: "testgroup/testrepo#2" },
            },
            {
              iid: 9,
              link_type: "blocks",
              references: { full: "othergroup/other#9" },
            },
            { iid: 4, link_type: "is_blocked_by" },
          ]),
      });

      const result = await adapter.getLinkedIssues("testgroup/testrepo#1");

      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/1/links?per_page=100&page=1"
      );
      expect(result).toEqual([
        {
          id: "2",
          key: "testgroup/testrepo#2",
          linkType: "relates_to",
          direction: "outward",
        },
        {
          id: "9",
          key: "othergroup/other#9",
          linkType: "blocks",
          direction: "outward",
        },
        {
          id: "4",
          key: "testgroup/testrepo#4",
          linkType: "is_blocked_by",
          direction: "inward",
        },
      ]);
    });

    it("returns an empty list when the request fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("404 Not found"),
      });

      await expect(
        adapter.getLinkedIssues("testgroup/testrepo#1")
      ).resolves.toEqual([]);
      warn.mockRestore();
    });
  });

  describe("attachments", () => {
    const SECRET_A = "eafe48384cf5bf2b46bf661d0184fa9c";
    const SECRET_B = "53ddf527121bba9a0db79810e3a6c4b9";

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
    });

    it("uploads the file to the project and appends its link to the description", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 3,
              full_path: `/-/project/1/uploads/${SECRET_A}/shot.png`,
              markdown: `![shot](/uploads/${SECRET_A}/shot.png)`,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ ...mockGitLabIssue, description: "Body" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockGitLabIssue),
        });

      const result = await adapter.uploadAttachment(
        "testgroup/testrepo#42",
        Buffer.from("png-bytes"),
        "shot.png"
      );

      const [uploadUrl, uploadInit] = mockFetch.mock.calls[1];
      expect(uploadUrl).toBe(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/uploads"
      );
      expect(uploadInit.method).toBe("POST");
      expect(uploadInit.body).toBeInstanceOf(FormData);
      expect(uploadInit.headers).not.toHaveProperty("Content-Type");

      const [updateUrl, updateInit] = mockFetch.mock.calls[3];
      expect(updateUrl).toBe(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues/42"
      );
      expect(updateInit.method).toBe("PUT");
      expect(JSON.parse(updateInit.body)).toEqual({
        description: `Body\n\n![shot](/uploads/${SECRET_A}/shot.png)`,
      });
      expect(result).toEqual({
        id: "3",
        url: `https://gitlab.com/-/project/1/uploads/${SECRET_A}/shot.png`,
      });
    });

    it("makes the link the whole description when the issue has none", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 4,
              markdown: `[run.log](/uploads/${SECRET_B}/run.log)`,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ ...mockGitLabIssue, description: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockGitLabIssue),
        });

      await adapter.uploadAttachment(
        "testgroup/testrepo#42",
        Buffer.from("log"),
        "run.log"
      );

      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({
        description: `[run.log](/uploads/${SECRET_B}/run.log)`,
      });
    });

    it("lists the uploads linked from the description and comments, once each", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockGitLabIssue,
              description: `Seen on checkout\n\n![shot](/uploads/${SECRET_A}/failure_screenshot.png){width=400}`,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                system: false,
                body: `Log attached: [run.log](/uploads/${SECRET_B}/run.log) and again ![shot](/uploads/${SECRET_A}/failure_screenshot.png)`,
              },
              {
                id: 2,
                system: true,
                body: "changed the description /uploads/00000000000000000000000000000000/ignored.png",
              },
            ]),
        });

      const result = await adapter.listAttachments("testgroup/testrepo#42");

      expect(result).toEqual([
        {
          id: `${SECRET_A}/failure_screenshot.png`,
          filename: "failure_screenshot.png",
          contentUrl: `https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/uploads/${SECRET_A}/failure_screenshot.png`,
        },
        {
          id: `${SECRET_B}/run.log`,
          filename: "run.log",
          contentUrl: `https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/uploads/${SECRET_B}/run.log`,
        },
      ]);
    });

    it("still lists the description's uploads when comments cannot be read", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockGitLabIssue,
              description: `![shot](/uploads/${SECRET_A}/shot.png)`,
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve("403 Forbidden"),
        });

      const result = await adapter.listAttachments("testgroup/testrepo#42");

      expect(result.map((meta) => meta.filename)).toEqual(["shot.png"]);
      warn.mockRestore();
    });

    it("downloads through the API route with the adapter's credentials", async () => {
      const bytes = Buffer.from("png-bytes");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/octet-stream" }),
        arrayBuffer: () =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            )
          ),
      });

      const result = await adapter.downloadAttachment({
        id: `${SECRET_A}/shot.png`,
        filename: "shot.png",
        contentUrl: `https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/uploads/${SECRET_A}/shot.png`,
      });

      const [url, init] = mockFetch.mock.calls[1];
      expect(url).toBe(
        `https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/uploads/${SECRET_A}/shot.png`
      );
      expect(init.headers).toEqual({ "PRIVATE-TOKEN": "glpat-test" });
      expect(result.buffer.equals(bytes)).toBe(true);
      expect(result.mimeType).toBeUndefined();
    });
  });

  describe("milestone sync", () => {
    const projectMilestone = {
      id: 1,
      iid: 1,
      project_id: 1,
      title: "1.0",
      description: "First release",
      state: "active",
      start_date: "2020-11-01",
      due_date: "2020-12-15",
      web_url: "https://gitlab.com/testgroup/testrepo/-/milestones/1",
    };
    const groupMilestone = {
      id: 3,
      iid: 1,
      group_id: 2,
      title: "Group 2027-Q1",
      description: null,
      state: "active",
      start_date: "2999-01-01",
      due_date: "2999-03-31",
      web_url: "https://gitlab.com/groups/testgroup/-/milestones/1",
    };
    const closedMilestone = {
      id: 5,
      iid: 2,
      project_id: 1,
      title: "0.9",
      state: "closed",
      start_date: null,
      due_date: null,
    };

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
    });

    it("maps project and group milestones, with an unstarted one as upcoming", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([projectMilestone, groupMilestone, closedMilestone]),
      });

      const result = await adapter.getExternalMilestones({
        projectKey: "testgroup/testrepo",
        includeClosed: true,
      });

      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/milestones?include_ancestors=true&per_page=100&page=1"
      );
      expect(result).toEqual({
        hasMore: false,
        items: [
          {
            id: "testgroup/testrepo#1",
            kind: "RELEASE",
            name: "1.0",
            description: "First release",
            startDate: new Date("2020-11-01T00:00:00.000Z"),
            endDate: new Date("2020-12-15T00:00:00.000Z"),
            state: "ACTIVE",
            rawState: "active",
            url: "https://gitlab.com/testgroup/testrepo/-/milestones/1",
          },
          {
            id: "testgroup/testrepo#3",
            kind: "RELEASE",
            name: "Group 2027-Q1",
            description: undefined,
            startDate: new Date("2999-01-01T00:00:00.000Z"),
            endDate: new Date("2999-03-31T00:00:00.000Z"),
            state: "FUTURE",
            rawState: "upcoming",
            url: "https://gitlab.com/groups/testgroup/-/milestones/1",
          },
          {
            id: "testgroup/testrepo#5",
            kind: "RELEASE",
            name: "0.9",
            description: undefined,
            startDate: undefined,
            endDate: undefined,
            state: "CLOSED",
            rawState: "closed",
            url: undefined,
          },
        ],
      });
    });

    it("asks for active milestones only unless closed ones are wanted", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([projectMilestone]),
      });

      await adapter.getExternalMilestones({ projectKey: "testgroup/testrepo" });

      expect(mockFetch.mock.calls[1][0]).toContain("state=active");
    });

    it("has no iteration milestones", async () => {
      const result = await adapter.getExternalMilestones({
        projectKey: "testgroup/testrepo",
        kind: "ITERATION",
      });

      expect(result).toEqual({ items: [], hasMore: false });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("pages the project's issues in a milestone by its title", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([projectMilestone, groupMilestone]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { ...mockGitLabIssue, iid: 4, state: "closed" },
              { ...mockGitLabIssue, iid: 2 },
            ]),
        });

      const result = await adapter.getMilestoneIssues(
        { id: "testgroup/testrepo#3", kind: "RELEASE" },
        { limit: 2, pageToken: "2" }
      );

      expect(mockFetch.mock.calls[2][0]).toBe(
        "https://gitlab.com/api/v4/projects/testgroup%2Ftestrepo/issues?milestone=Group+2027-Q1&state=all&scope=all&per_page=2&page=2"
      );
      expect(result.issues.map((issue) => [issue.id, issue.status])).toEqual([
        ["4", "closed"],
        ["2", "opened"],
      ]);
      expect(result.hasMore).toBe(true);
      expect(result.nextPageToken).toBe("3");
    });

    it("looks the title up once for milestones already listed", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([projectMilestone]),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

      await adapter.getExternalMilestones({
        projectKey: "testgroup/testrepo",
        includeClosed: true,
      });
      const result = await adapter.getMilestoneIssues({
        id: "testgroup/testrepo#1",
        kind: "RELEASE",
      });

      expect(result).toEqual({
        issues: [],
        hasMore: false,
        nextPageToken: undefined,
      });
      const urls = mockFetch.mock.calls.map((call: any[]) => call[0] as string);
      expect(urls.filter((url) => url.includes("/milestones?"))).toHaveLength(
        1
      );
    });

    it("fails for a milestone that no longer exists, so its members are not taken to have left", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([projectMilestone]),
      });

      await expect(
        adapter.getMilestoneIssues({
          id: "testgroup/testrepo#999",
          kind: "RELEASE",
        })
      ).rejects.toThrow(
        "GitLab milestone testgroup/testrepo#999 was not found"
      );
    });

    it("returns no members for another kind or a reference it cannot read", async () => {
      await expect(
        adapter.getMilestoneIssues({
          id: "testgroup/testrepo#1",
          kind: "ITERATION",
        })
      ).resolves.toEqual({ issues: [], hasMore: false });
      await expect(
        adapter.getMilestoneIssues({ id: "not-a-ref", kind: "RELEASE" })
      ).resolves.toEqual({ issues: [], hasMore: false });
    });
  });

  describe("getCreateIssueMetadata", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, username: "testuser" }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "glpat-test" });
      (adapter as any).rateLimitDelay = 0;
    });

    afterEach(() => {
      mockFetch.mockReset();
    });

    const respondByUrl = (responses: Record<string, unknown[] | "fail">) =>
      mockFetch.mockImplementation((url: string) => {
        const match = Object.keys(responses).find((part) => url.includes(part));
        const body = match ? responses[match] : [];
        if (body === "fail") {
          return Promise.resolve({
            ok: false,
            status: 403,
            text: () => Promise.resolve("403 Forbidden"),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      });

    it("returns labels by name, open milestones and active members", async () => {
      respondByUrl({
        "/labels?": [{ id: 1, name: "bug", color: "#d9534f" }],
        "/milestones?": [
          { id: 2, title: "1.1", state: "active", due_date: "2027-01-31" },
        ],
        "/members/all?": [
          { id: 7, name: "Ada Lovelace", username: "ada", avatar_url: "a.png" },
          { id: 9, username: "bot" },
        ],
      });

      const result = await adapter.getCreateIssueMetadata("testgroup/testrepo");

      expect(result).toEqual({
        labels: [{ id: "bug", name: "bug", color: "#d9534f" }],
        milestones: [
          {
            id: "2",
            title: "1.1",
            state: "active",
            dueOn: "2027-01-31",
            externalId: "testgroup/testrepo#2",
          },
        ],
        assignees: [
          { id: "7", name: "Ada Lovelace", avatarUrl: "a.png" },
          { id: "9", name: "bot", avatarUrl: undefined },
        ],
        issueTypes: [],
      });
      const urls = mockFetch.mock.calls.map((call: any[]) => call[0] as string);
      expect(urls.find((url) => url.includes("/milestones?"))).toContain(
        "state=active"
      );
      expect(urls.find((url) => url.includes("/members/all?"))).toContain(
        "state=active"
      );
    });

    it("returns the lists that loaded when one fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      respondByUrl({
        "/labels?": "fail",
        "/milestones?": [],
        "/members/all?": [{ id: 7, name: "Ada Lovelace" }],
      });

      const result = await adapter.getCreateIssueMetadata("testgroup/testrepo");

      expect(result.labels).toEqual([]);
      expect(result.assignees).toEqual([
        { id: "7", name: "Ada Lovelace", avatarUrl: undefined },
      ]);
      error.mockRestore();
    });
  });
});
