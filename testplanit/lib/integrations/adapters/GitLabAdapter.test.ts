import { beforeEach, describe, expect, it, vi } from "vitest";
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
        attachments: false,
        linkedIssues: false,
        comments: true,
        milestones: false,
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
  });
});
