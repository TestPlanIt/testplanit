import { beforeEach, describe, expect, it, vi } from "vitest";
import { GiteaAdapter } from "./GiteaAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GiteaAdapter", () => {
  let adapter: GiteaAdapter;

  const mockGiteaIssue = {
    number: 7,
    title: "Test Issue",
    body: "This is a test issue body",
    state: "open",
    html_url: "https://gitea.example.com/testowner/testrepo/issues/7",
    created_at: "2024-01-15T10:00:00.000Z",
    updated_at: "2024-01-15T12:00:00.000Z",
    user: { login: "reporter", full_name: "Reporter User" },
    assignee: { login: "assignee", full_name: "Assignee User" },
    labels: [{ name: "bug" }, { name: "backend" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GiteaAdapter({
      provider: "GITEA",
      owner: "testowner",
      repo: "testrepo",
      baseUrl: "https://gitea.example.com",
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
        json: () => Promise.resolve({ id: 1, login: "testuser" }),
      });

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "gitea-token" })
      ).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitea.example.com/api/v1/user",
        expect.any(Object)
      );
    });

    it("should use baseUrl from authData", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      const adapterNoUrl = new GiteaAdapter({ provider: "GITEA" });
      await adapterNoUrl.authenticate({
        type: "api_key",
        apiKey: "tok",
        baseUrl: "https://forgejo.example.com/",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://forgejo.example.com/api/v1/user",
        expect.any(Object)
      );
    });

    it("should authenticate with an OAuth access token (Bearer header)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, login: "oauth-user" }),
      });

      await adapter.authenticate({ type: "oauth", accessToken: "gitea-oauth" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://gitea.example.com/api/v1/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer gitea-oauth",
          }),
        })
      );
    });

    it("should throw for an unsupported auth type", async () => {
      await expect(
        adapter.authenticate({ type: "basic", username: "u", password: "p" })
      ).rejects.toThrow(
        "Gitea adapter only supports OAuth and Personal Access Token authentication"
      );
    });

    it("should throw when no baseUrl is available", async () => {
      const adapterNoUrl = new GiteaAdapter({ provider: "GITEA" });
      await expect(
        adapterNoUrl.authenticate({ type: "api_key", apiKey: "tok" })
      ).rejects.toThrow("instance URL is required");
    });

    it("should throw when the token is invalid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "Unauthorized" }),
      });

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad-token" })
      ).rejects.toThrow("Invalid Gitea Personal Access Token");
    });
  });

  describe("OAuth", () => {
    const oauthAdapter = () =>
      new GiteaAdapter({
        provider: "GITEA",
        owner: "testowner",
        repo: "testrepo",
        instanceUrl: "https://gitea.example.com",
        clientId: "client-123",
        clientSecret: "secret-456",
        redirectUri: "https://app/cb",
      });

    it("advertises OAuth support", () => {
      expect(oauthAdapter().supportsOAuth).toBe(true);
    });

    it("builds the authorization URL on the configured instance", () => {
      const url = new URL(oauthAdapter().getAuthorizationUrl("st"));
      expect(url.origin + url.pathname).toBe(
        "https://gitea.example.com/login/oauth/authorize"
      );
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe("st");
    });

    it("exchanges an authorization code for tokens", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
          }),
      });

      const tokens = await oauthAdapter().exchangeCodeForTokens("code");

      expect(tokens.accessToken).toBe("at");
      expect(tokens.refreshToken).toBe("rt");
      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(
        "https://gitea.example.com/login/oauth/access_token"
      );
      expect(JSON.parse(options.body)).toMatchObject({
        grant_type: "authorization_code",
        code: "code",
      });
    });

    it("refreshes tokens with the refresh_token grant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "at2" }),
      });

      await oauthAdapter().refreshTokens("old-rt");

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "old-rt",
      });
    });
  });

  describe("createIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
    });

    it("should POST to the correct endpoint and return mapped data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      const result = await adapter.createIssue({
        title: "Test Issue",
        description: "Test body",
        projectId: "testowner/testrepo",
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues",
        expect.objectContaining({ method: "POST" })
      );
      expect(result.key).toBe("testowner/testrepo#7");
      expect(result.title).toBe("Test Issue");
    });
  });

  describe("getIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
    });

    it("should fetch by key format owner/repo#number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      const result = await adapter.getIssue("testowner/testrepo#7");

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues/7",
        expect.any(Object)
      );
      expect(result.key).toBe("testowner/testrepo#7");
    });

    it("should map key as owner/repo#number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      const result = await adapter.getIssue("testowner/testrepo#7");
      expect(result.key).toBe("testowner/testrepo#7");
      expect(result.id).toBe("7");
    });

    // Gitea's API sends created_at/updated_at. A wrong field name here is
    // silent data loss downstream: buildSyncedIssueData drops non-finite
    // dates, so Issue.data.createdAt (the coverage-debt "Uncovered Since"
    // source) would simply never be written for Gitea rows.
    it("maps the API's created_at/updated_at into createdAt/updatedAt", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      const result = await adapter.getIssue("testowner/testrepo#7");
      expect(result.createdAt).toEqual(new Date("2024-01-15T10:00:00.000Z"));
      expect(result.updatedAt).toEqual(new Date("2024-01-15T12:00:00.000Z"));
    });

    it("falls back to bare created/updated field names", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockGiteaIssue,
            created_at: undefined,
            updated_at: undefined,
            created: "2023-06-01T08:00:00.000Z",
            updated: "2023-06-02T09:00:00.000Z",
          }),
      });

      const result = await adapter.getIssue("testowner/testrepo#7");
      expect(result.createdAt).toEqual(new Date("2023-06-01T08:00:00.000Z"));
      expect(result.updatedAt).toEqual(new Date("2023-06-02T09:00:00.000Z"));
    });
  });

  describe("searchIssues", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
    });

    it("should use q= for plain text queries", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGiteaIssue]),
      });

      await adapter.searchIssues({ query: "login bug" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("q=login+bug");
    });

    it("should fetch by issue number when query matches key format owner/repo#number", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      const result = await adapter.searchIssues({
        query: "testowner/testrepo#7",
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues/7",
        expect.any(Object)
      );
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].key).toBe("testowner/testrepo#7");
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it("should return empty results when key lookup fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("404 Not Found"));

      const result = await adapter.searchIssues({
        query: "testowner/testrepo#999",
      });

      expect(result.issues).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should not use key lookup for plain number without # prefix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGiteaIssue]),
      });

      await adapter.searchIssues({ query: "7" });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("/issues?");
      expect(url).toContain("q=7");
    });

    it("should filter by status open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ status: ["open"] });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("state=open");
    });

    it("should filter by status closed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await adapter.searchIssues({ status: ["done"] });

      const url = mockFetch.mock.calls[1][0];
      expect(url).toContain("state=closed");
    });

    it("should indicate hasMore when result count equals limit", async () => {
      const issues = Array.from({ length: 10 }, (_, i) => ({
        ...mockGiteaIssue,
        number: i + 1,
      }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(issues),
      });

      const result = await adapter.searchIssues({ limit: 10 });
      expect(result.hasMore).toBe(true);
    });
  });

  describe("updateIssue", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
    });

    it("should PATCH to the correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGiteaIssue, title: "Updated" }),
      });

      await adapter.updateIssue("testowner/testrepo#7", { title: "Updated" });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues/7",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("should map done status to closed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockGiteaIssue, state: "closed" }),
      });

      await adapter.updateIssue("testowner/testrepo#7", { status: "done" });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.state).toBe("closed");
    });

    it("should map open status to open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      await adapter.updateIssue("testowner/testrepo#7", { status: "open" });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.state).toBe("open");
    });
  });

  describe("getProjects", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
    });

    it("should return repos from search response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { full_name: "testowner/testrepo", name: "testrepo" },
          ]),
      });

      const projects = await adapter.getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("testowner/testrepo");
    });
  });

  describe("getIssueTypes (labels as the designation vocabulary)", () => {
    const orgNotFound = {
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    };

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
      mockFetch.mockClear();
    });

    it("unions repository and organization labels, id === name, deduped", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 1, name: "epic", color: "ff0000" },
              { id: 2, name: "requirement", color: "00ff00" },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 9, name: "requirement", color: "00ff00" },
              { id: 10, name: "org-wide", color: "0000ff" },
            ]),
        });

      const issueTypes = await adapter.getIssueTypes("testowner/testrepo");

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/labels?limit=100&page=1",
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://gitea.example.com/api/v1/orgs/testowner/labels?limit=100&page=1",
        expect.any(Object)
      );
      expect(issueTypes).toEqual([
        { id: "epic", name: "epic" },
        { id: "requirement", name: "requirement" },
        { id: "org-wide", name: "org-wide" },
      ]);
    });

    it("tolerates a missing org labels endpoint (user-owned repo)", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ id: 1, name: "epic", color: "f00" }]),
        })
        .mockResolvedValueOnce(orgNotFound);

      const issueTypes = await adapter.getIssueTypes("testowner/testrepo");

      expect(issueTypes).toEqual([{ id: "epic", name: "epic" }]);
    });

    it("resolves a short repo key with the configured owner", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ id: 1, name: "epic", color: "f00" }]),
        })
        .mockResolvedValueOnce(orgNotFound);

      await adapter.getIssueTypes("otherrepo");

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://gitea.example.com/api/v1/repos/testowner/otherrepo/labels?limit=100&page=1",
        expect.any(Object)
      );
    });

    it("resolves a full owner/repo ref over the configured repository", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ id: 1, name: "epic", color: "f00" }]),
        })
        .mockResolvedValueOnce(orgNotFound);

      await adapter.getIssueTypes("otherowner/otherrepo");

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://gitea.example.com/api/v1/repos/otherowner/otherrepo/labels?limit=100&page=1",
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://gitea.example.com/api/v1/orgs/otherowner/labels?limit=100&page=1",
        expect.any(Object)
      );
    });

    // Gitea pages with limit/page — a copied per_page would be ignored and
    // silently truncate the vocabulary at the 30-row server default.
    it("pages past a full first page with limit/page and stops on a short one", async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `label-${i}`,
        color: "cccccc",
      }));
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fullPage),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ id: 200, name: "tail" }]),
        })
        .mockResolvedValueOnce(orgNotFound);

      const issueTypes = await adapter.getIssueTypes("testowner/testrepo");

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/labels?limit=100&page=2",
        expect.any(Object)
      );
      expect(issueTypes).toHaveLength(101);
      expect(issueTypes[100]).toEqual({ id: "tail", name: "tail" });
    });

    it("throws when no repository can be resolved", async () => {
      const bare = new GiteaAdapter({
        provider: "GITEA",
        baseUrl: "https://gitea.example.com",
      });
      await expect(bare.getIssueTypes("")).rejects.toThrow(
        "Gitea repository not configured"
      );
    });
  });
});
