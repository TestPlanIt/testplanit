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
        attachments: true,
        linkedIssues: true,
        comments: true,
        milestones: { kinds: ["RELEASE"], webhooks: false },
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

    it("uses the linked project's owner/repo when the key is the short name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGiteaIssue),
      });

      await adapter.createIssue({
        title: "Test Issue",
        projectId: "otherrepo",
        externalProjectId: "otherowner/otherrepo",
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://gitea.example.com/api/v1/repos/otherowner/otherrepo/issues",
        expect.objectContaining({ method: "POST" })
      );
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

    it("walks every page of /repos/search", async () => {
      (adapter as any).rateLimitDelay = 0;
      const repos = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          full_name: `o/r${from + i + 1}`,
          name: `r${from + i + 1}`,
        }));
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: repos(0, 50) }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: repos(50, 4) }),
        });

      const projects = await adapter.getProjects();

      expect(projects).toHaveLength(54);
      expect(projects[53].id).toBe("o/r54");
      const urls = mockFetch.mock.calls
        .map((c: any[]) => c[0] as string)
        .filter((u) => u.includes("/repos/search"));
      expect(urls).toEqual([
        "https://gitea.example.com/api/v1/repos/search?token=&limit=50&page=1",
        "https://gitea.example.com/api/v1/repos/search?token=&limit=50&page=2",
      ]);
    });
  });

  describe("getIssueComments", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });
      await adapter.authenticate({ type: "api_key", apiKey: "gitea-token" });
      (adapter as any).rateLimitDelay = 0;
    });

    it("walks every page of the comments endpoint", async () => {
      const comments = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: from + i + 1,
          body: `c${from + i + 1}`,
          user: { login: "alice" },
          created: "2026-01-01T00:00:00Z",
        }));
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(comments(0, 50)),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(comments(50, 1)),
        });

      const result = await adapter.getIssueComments!("testowner/testrepo#7");

      expect(result).toHaveLength(51);
      expect(result[50].id).toBe("51");
      const urls = mockFetch.mock.calls
        .map((c: any[]) => c[0] as string)
        .filter((u) => u.includes("/comments"));
      expect(urls).toEqual([
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues/7/comments?limit=50&page=1",
        "https://gitea.example.com/api/v1/repos/testowner/testrepo/issues/7/comments?limit=50&page=2",
      ]);
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

  const API = "https://gitea.example.com/api/v1";
  const REPO = `${API}/repos/testowner/testrepo`;

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  const failure = (status: number, text = "not found") => ({
    ok: false,
    status,
    text: () => Promise.resolve(text),
    headers: new Headers(),
  });

  type Route = (url: URL, init: RequestInit | undefined) => unknown;

  /**
   * Answers each request from the first route whose key matches
   * "<METHOD> <path>"; anything unrouted is a 404. Returns the requests
   * made, as "<METHOD> <path+query>".
   */
  function routeFetch(routes: Record<string, Route>): string[] {
    const calls: string[] = [];
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}${url.search}`);
      const route = routes[`${method} ${url.pathname}`];
      return Promise.resolve(route ? route(url, init) : failure(404));
    });
    return calls;
  }

  async function authenticated(config: Record<string, unknown> = {}) {
    const instance = new GiteaAdapter({
      provider: "GITEA",
      owner: "testowner",
      repo: "testrepo",
      baseUrl: "https://gitea.example.com",
      ...config,
    });
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(ok({ id: 1 }));
    await instance.authenticate({ type: "api_key", apiKey: "gitea-token" });
    (instance as any).rateLimitDelay = 0;
    return instance;
  }

  const tiptapDoc = {
    type: "doc" as const,
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Failed iteration" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Step 2 " },
          { type: "text", marks: [{ type: "bold" }], text: "failed" },
        ],
      },
    ],
  };

  describe("createIssue with labels, milestone, assignees and rich text", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    it("sends label ids for label names, from repository and organization labels", async () => {
      let posted: any;
      const calls = routeFetch({
        "GET /api/v1/repos/testowner/testrepo/labels": () =>
          ok([
            { id: 11, name: "bug" },
            { id: 12, name: "feature" },
          ]),
        "GET /api/v1/orgs/testowner/labels": () =>
          ok([{ id: 90, name: "org-wide" }]),
        "POST /api/v1/repos/testowner/testrepo/issues": (_url, init) => {
          posted = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.createIssue({
        title: "Labelled",
        projectId: "testrepo",
        labels: ["bug", "org-wide", "no such label", "bug"],
      });

      expect(posted.labels).toEqual([11, 90]);
      expect(calls.at(-1)).toBe("POST /api/v1/repos/testowner/testrepo/issues");
    });

    it("creates the issue without labels when none of the names exist", async () => {
      let posted: any;
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/labels": () => ok([]),
        "POST /api/v1/repos/testowner/testrepo/issues": (_url, init) => {
          posted = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.createIssue({
        title: "Unlabelled",
        projectId: "testrepo",
        labels: ["gone"],
      });

      expect(posted).not.toHaveProperty("labels");
    });

    it("does not read the labels when none are given", async () => {
      const calls = routeFetch({
        "POST /api/v1/repos/testowner/testrepo/issues": () =>
          ok(mockGiteaIssue),
      });

      await adapter.createIssue({ title: "Plain", projectId: "testrepo" });

      expect(calls).toEqual(["POST /api/v1/repos/testowner/testrepo/issues"]);
    });

    it("sends every assignee and the milestone id", async () => {
      let posted: any;
      routeFetch({
        "POST /api/v1/repos/testowner/testrepo/issues": (_url, init) => {
          posted = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.createIssue({
        title: "Planned",
        projectId: "testrepo",
        assigneeId: "ignored",
        assigneeIds: ["alice", "bob"],
        milestone: "42",
      });

      expect(posted.assignees).toEqual(["alice", "bob"]);
      expect(posted.milestone).toBe(42);
    });

    it("falls back to the single assignee and leaves out a milestone that is not an id", async () => {
      let posted: any;
      routeFetch({
        "POST /api/v1/repos/testowner/testrepo/issues": (_url, init) => {
          posted = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.createIssue({
        title: "Planned",
        projectId: "testrepo",
        assigneeId: "alice",
        milestone: "v1.0",
      });

      expect(posted.assignees).toEqual(["alice"]);
      expect(posted).not.toHaveProperty("milestone");
    });

    it("renders a TipTap document description as markdown", async () => {
      let posted: any;
      routeFetch({
        "POST /api/v1/repos/testowner/testrepo/issues": (_url, init) => {
          posted = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.createIssue({
        title: "From a document",
        projectId: "testrepo",
        description: tiptapDoc,
      });

      expect(posted.body).toBe("## Failed iteration\n\nStep 2 **failed**");
    });
  });

  describe("updateIssue with labels, milestone, assignees and rich text", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    it("replaces the labels by id before the edit", async () => {
      let labelsBody: any;
      let patched: any;
      const calls = routeFetch({
        "GET /api/v1/repos/testowner/testrepo/labels": () =>
          ok([
            { id: 11, name: "bug" },
            { id: 12, name: "feature" },
          ]),
        "PUT /api/v1/repos/testowner/testrepo/issues/7/labels": (
          _url,
          init
        ) => {
          labelsBody = JSON.parse(init!.body as string);
          return ok([]);
        },
        "PATCH /api/v1/repos/testowner/testrepo/issues/7": (_url, init) => {
          patched = JSON.parse(init!.body as string);
          return ok({ ...mockGiteaIssue, labels: [{ name: "feature" }] });
        },
      });

      const result = await adapter.updateIssue("testowner/testrepo#7", {
        labels: ["feature"],
      });

      expect(labelsBody).toEqual({ labels: [12] });
      expect(patched).toEqual({});
      expect(result.labels).toEqual(["feature"]);
      expect(calls.at(-1)).toBe(
        "PATCH /api/v1/repos/testowner/testrepo/issues/7"
      );
    });

    it("removes every label for an empty list without reading the labels", async () => {
      let labelsBody: any;
      const calls = routeFetch({
        "PUT /api/v1/repos/testowner/testrepo/issues/7/labels": (
          _url,
          init
        ) => {
          labelsBody = JSON.parse(init!.body as string);
          return ok([]);
        },
        "PATCH /api/v1/repos/testowner/testrepo/issues/7": () =>
          ok({ ...mockGiteaIssue, labels: [] }),
      });

      await adapter.updateIssue("testowner/testrepo#7", { labels: [] });

      expect(labelsBody).toEqual({ labels: [] });
      expect(calls.some((call) => call.startsWith("GET "))).toBe(false);
    });

    it("sets the milestone and every assignee, and clears them", async () => {
      const patches: any[] = [];
      routeFetch({
        "PATCH /api/v1/repos/testowner/testrepo/issues/7": (_url, init) => {
          patches.push(JSON.parse(init!.body as string));
          return ok(mockGiteaIssue);
        },
      });

      await adapter.updateIssue("testowner/testrepo#7", {
        milestone: "42",
        assigneeIds: ["alice", "bob"],
      });
      await adapter.updateIssue("testowner/testrepo#7", {
        milestone: "",
        assigneeIds: [],
      });

      expect(patches[0]).toEqual({
        milestone: 42,
        assignees: ["alice", "bob"],
      });
      expect(patches[1]).toEqual({ milestone: 0, assignees: [] });
    });

    it("renders a TipTap document description as markdown", async () => {
      let patched: any;
      routeFetch({
        "PATCH /api/v1/repos/testowner/testrepo/issues/7": (_url, init) => {
          patched = JSON.parse(init!.body as string);
          return ok(mockGiteaIssue);
        },
      });

      await adapter.updateIssue("testowner/testrepo#7", {
        description: tiptapDoc,
      });

      expect(patched.body).toBe("## Failed iteration\n\nStep 2 **failed**");
    });
  });

  describe("getLinkedIssues (dependencies)", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    it("returns the issues this one depends on and the issues it blocks", async () => {
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/dependencies": () =>
          ok([
            { number: 3, repository: { full_name: "testowner/testrepo" } },
            { number: 12, repository: { full_name: "otherowner/shared" } },
          ]),
        "GET /api/v1/repos/testowner/testrepo/issues/7/blocks": () =>
          ok([{ number: 9, repository: { full_name: "testowner/testrepo" } }]),
      });

      const refs = await adapter.getLinkedIssues("testowner/testrepo#7");

      expect(refs).toEqual([
        {
          id: "testowner/testrepo#3",
          key: "testowner/testrepo#3",
          linkType: "depends on",
          direction: "outward",
        },
        {
          id: "otherowner/shared#12",
          key: "otherowner/shared#12",
          linkType: "depends on",
          direction: "outward",
        },
        {
          id: "testowner/testrepo#9",
          key: "testowner/testrepo#9",
          linkType: "blocks",
          direction: "inward",
        },
      ]);
    });

    it("falls back to the issue's own repository when a dependency names none", async () => {
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/dependencies": () =>
          ok([{ number: 3 }]),
        "GET /api/v1/repos/testowner/testrepo/issues/7/blocks": () => ok([]),
      });

      const refs = await adapter.getLinkedIssues("7");

      expect(refs.map((ref) => ref.key)).toEqual(["testowner/testrepo#3"]);
    });

    it("keeps one direction when the other cannot be read", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/blocks": () =>
          ok([{ number: 9, repository: { full_name: "testowner/testrepo" } }]),
      });

      const refs = await adapter.getLinkedIssues("testowner/testrepo#7");

      expect(refs.map((ref) => ref.key)).toEqual(["testowner/testrepo#9"]);
      warn.mockRestore();
    });

    it("returns nothing on a server without the endpoints", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      routeFetch({});

      await expect(
        adapter.getLinkedIssues("testowner/testrepo#7")
      ).resolves.toEqual([]);
      warn.mockRestore();
    });

    it("returns nothing for a reference it cannot resolve", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const bare = new GiteaAdapter({
        provider: "GITEA",
        baseUrl: "https://gitea.example.com",
      });

      await expect(bare.getLinkedIssues("7")).resolves.toEqual([]);
      warn.mockRestore();
    });
  });

  describe("getCreateIssueMetadata", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    it("returns labels by name, open milestones by id and assignable users by login", async () => {
      const calls = routeFetch({
        "GET /api/v1/repos/testowner/testrepo/labels": () =>
          ok([
            { id: 11, name: "bug", color: "d73a4a" },
            { id: 12, name: "old", color: "cccccc", is_archived: true },
          ]),
        "GET /api/v1/orgs/testowner/labels": () =>
          ok([
            { id: 90, name: "org-wide", color: "0e8a16" },
            { id: 91, name: "bug", color: "000000" },
          ]),
        "GET /api/v1/repos/testowner/testrepo/milestones": () =>
          ok([
            {
              id: 5,
              title: "1.0",
              state: "open",
              due_on: "2026-12-31T00:00:00Z",
            },
            { id: 6, title: "Later", state: "open", due_on: null },
          ]),
        "GET /api/v1/repos/testowner/testrepo/assignees": () =>
          ok([
            {
              login: "alice",
              full_name: "Alice A",
              avatar_url: "https://gitea.example.com/avatars/a",
            },
            { login: "bob", full_name: "" },
          ]),
      });

      const metadata = await adapter.getCreateIssueMetadata("testrepo");

      expect(metadata).toEqual({
        labels: [
          { id: "bug", name: "bug", color: "d73a4a" },
          { id: "org-wide", name: "org-wide", color: "0e8a16" },
        ],
        milestones: [
          {
            id: "5",
            title: "1.0",
            state: "open",
            dueOn: "2026-12-31T00:00:00Z",
            externalId: "testowner/testrepo#5",
          },
          {
            id: "6",
            title: "Later",
            state: "open",
            dueOn: null,
            externalId: "testowner/testrepo#6",
          },
        ],
        assignees: [
          {
            id: "alice",
            name: "Alice A",
            avatarUrl: "https://gitea.example.com/avatars/a",
          },
          { id: "bob", name: "bob", avatarUrl: undefined },
        ],
        issueTypes: [],
      });
      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/milestones?state=open&limit=50&page=1"
      );
    });

    it("returns an empty list for whatever cannot be read", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/assignees": () =>
          ok([{ login: "alice" }]),
      });

      const metadata = await adapter.getCreateIssueMetadata("testrepo");

      expect(metadata).toEqual({
        labels: [],
        milestones: [],
        assignees: [{ id: "alice", name: "alice", avatarUrl: undefined }],
        issueTypes: [],
      });
      error.mockRestore();
    });
  });

  describe("getExternalMilestones", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    const milestones = [
      {
        id: 3,
        title: "Backlog",
        description: "",
        state: "open",
        due_on: null,
        closed_at: null,
      },
      {
        id: 2,
        title: "0.9",
        description: "Shipped",
        state: "closed",
        due_on: "2026-11-01T00:00:00Z",
        closed_at: "2026-11-03T09:30:00Z",
      },
      {
        id: 1,
        title: "1.0",
        description: "Next release",
        state: "open",
        due_on: "2026-12-31T00:00:00Z",
        closed_at: null,
      },
    ];

    it("maps repository milestones onto RELEASE", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": () => ok(milestones),
      });

      const result = await adapter.getExternalMilestones({
        projectKey: "testrepo",
        includeClosed: true,
      });

      expect(result.hasMore).toBe(false);
      expect(result.items).toEqual([
        {
          id: "testowner/testrepo#3",
          kind: "RELEASE",
          name: "Backlog",
          description: undefined,
          endDate: undefined,
          state: "ACTIVE",
          rawState: "open",
          url: "https://gitea.example.com/testowner/testrepo/milestone/3",
        },
        {
          id: "testowner/testrepo#2",
          kind: "RELEASE",
          name: "0.9",
          description: "Shipped",
          endDate: new Date("2026-11-03T09:30:00Z"),
          state: "CLOSED",
          rawState: "closed",
          url: "https://gitea.example.com/testowner/testrepo/milestone/2",
        },
        {
          id: "testowner/testrepo#1",
          kind: "RELEASE",
          name: "1.0",
          description: "Next release",
          endDate: new Date("2026-12-31T00:00:00Z"),
          state: "ACTIVE",
          rawState: "open",
          url: "https://gitea.example.com/testowner/testrepo/milestone/1",
        },
      ]);
      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/milestones?state=all&limit=50&page=1"
      );
    });

    it("lists open milestones only unless closed ones are asked for", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": () => ok([]),
      });

      await adapter.getExternalMilestones({ projectKey: "testrepo" });

      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/milestones?state=open&limit=50&page=1"
      );
    });

    it("falls back to the due date for a closed milestone without a close date, and ignores placeholder dates", async () => {
      routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": () =>
          ok([
            {
              id: 4,
              title: "Closed",
              state: "closed",
              due_on: "2026-10-01T00:00:00Z",
              closed_at: "0001-01-01T00:00:00Z",
            },
            {
              id: 5,
              title: "Open ended",
              state: "open",
              due_on: "9999-12-31T23:59:59Z",
            },
          ]),
      });

      const { items } = await adapter.getExternalMilestones({
        projectKey: "testrepo",
        includeClosed: true,
      });

      expect(items[0].endDate).toEqual(new Date("2026-10-01T00:00:00Z"));
      expect(items[1].endDate).toBeUndefined();
    });

    it("pages at the instance's own page size when it is below the default", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 2 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": (url) =>
          ok(
            url.searchParams.get("page") === "1"
              ? milestones.slice(0, 2)
              : milestones.slice(2)
          ),
      });

      const { items } = await adapter.getExternalMilestones({
        projectKey: "testrepo",
        includeClosed: true,
      });

      expect(items).toHaveLength(3);
      expect(calls.filter((call) => call.includes("/milestones?"))).toEqual([
        "GET /api/v1/repos/testowner/testrepo/milestones?state=all&limit=2&page=1",
        "GET /api/v1/repos/testowner/testrepo/milestones?state=all&limit=2&page=2",
      ]);
    });

    it("uses the default page size on a server that does not report its limit, and asks only once", async () => {
      const calls = routeFetch({
        "GET /api/v1/repos/testowner/testrepo/milestones": () => ok(milestones),
      });

      const { items } = await adapter.getExternalMilestones({
        projectKey: "testrepo",
        includeClosed: true,
      });
      await adapter.getExternalMilestones({ projectKey: "testrepo" });

      expect(items).toHaveLength(3);
      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/milestones?state=all&limit=50&page=1"
      );
      expect(
        calls.filter((call) => call === "GET /api/v1/settings/api")
      ).toHaveLength(1);
    });

    it("asks for the page size again after a request that merely failed", async () => {
      let settingsCalls = 0;
      (adapter as any).maxRetries = 0;
      routeFetch({
        "GET /api/v1/settings/api": () => {
          settingsCalls += 1;
          return settingsCalls === 1
            ? failure(503, "unavailable")
            : ok({ max_response_items: 2 });
        },
        "GET /api/v1/repos/testowner/testrepo/milestones": () => ok([]),
      });

      await adapter.getExternalMilestones({ projectKey: "testrepo" });
      await adapter.getExternalMilestones({ projectKey: "testrepo" });

      expect(settingsCalls).toBe(2);
    });

    it("has no iterations", async () => {
      const calls = routeFetch({});

      await expect(
        adapter.getExternalMilestones({
          projectKey: "testrepo",
          kind: "ITERATION",
        })
      ).resolves.toEqual({ items: [], hasMore: false });
      expect(calls).toEqual([]);
    });

    it("lets a failed listing reach the caller", async () => {
      routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": () =>
          failure(403, "forbidden"),
      });

      await expect(
        adapter.getExternalMilestones({ projectKey: "testrepo" })
      ).rejects.toThrow("HTTP 403");
    });
  });

  describe("getMilestoneIssues", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    const member = (number: number, milestoneId: number, extra = {}) => ({
      ...mockGiteaIssue,
      number,
      milestone: { id: milestoneId },
      ...extra,
    });

    it("filters on the milestone's name and keeps only issues carrying its id", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones/5": () =>
          ok({ id: 5, title: "Sprint 12" }),
        "GET /api/v1/repos/testowner/testrepo/issues": () =>
          ok([
            member(1, 5),
            member(2, 8),
            member(3, 5, { pull_request: { merged: false } }),
            { ...mockGiteaIssue, number: 4, milestone: null },
          ]),
      });

      const result = await adapter.getMilestoneIssues({
        id: "testowner/testrepo#5",
        kind: "RELEASE",
      });

      expect(result.issues.map((issue) => issue.key)).toEqual([
        "testowner/testrepo#1",
      ]);
      expect(result.issues[0].id).toBe("1");
      expect(result.hasMore).toBe(false);
      expect(result.nextPageToken).toBeUndefined();
      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/issues?type=issues&state=all&milestones=Sprint+12&limit=50&page=1"
      );
    });

    it("filters on the id when the name has a comma", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones/5": () =>
          ok({ id: 5, title: "Phase A, part 2" }),
        "GET /api/v1/repos/testowner/testrepo/issues": () => ok([member(1, 5)]),
      });

      await adapter.getMilestoneIssues({
        id: "testowner/testrepo#5",
        kind: "RELEASE",
      });

      expect(calls).toContain(
        "GET /api/v1/repos/testowner/testrepo/issues?type=issues&state=all&milestones=5&limit=50&page=1"
      );
    });

    it("reports more pages from the raw page, not the filtered one", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 2 }),
        "GET /api/v1/repos/testowner/testrepo/milestones/5": () =>
          ok({ id: 5, title: "Sprint 12" }),
        "GET /api/v1/repos/testowner/testrepo/issues": (url) =>
          ok(
            url.searchParams.get("page") === "1"
              ? [member(1, 8), member(2, 8)]
              : [member(3, 5)]
          ),
      });

      const first = await adapter.getMilestoneIssues(
        { id: "testowner/testrepo#5", kind: "RELEASE" },
        { limit: 100 }
      );
      const second = await adapter.getMilestoneIssues(
        { id: "testowner/testrepo#5", kind: "RELEASE" },
        { pageToken: first.nextPageToken, limit: 100 }
      );

      expect(first).toEqual({ issues: [], hasMore: true, nextPageToken: "2" });
      expect(second.issues.map((issue) => issue.id)).toEqual(["3"]);
      expect(second.hasMore).toBe(false);
      expect(calls.filter((call) => call.includes("/issues?"))).toEqual([
        "GET /api/v1/repos/testowner/testrepo/issues?type=issues&state=all&milestones=Sprint+12&limit=2&page=1",
        "GET /api/v1/repos/testowner/testrepo/issues?type=issues&state=all&milestones=Sprint+12&limit=2&page=2",
      ]);
      expect(
        calls.filter((call) => call.endsWith("/milestones/5"))
      ).toHaveLength(1);
    });

    it("reuses the name a milestone listing just returned", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/milestones": () =>
          ok([{ id: 5, title: "Sprint 12", state: "open" }]),
        "GET /api/v1/repos/testowner/testrepo/issues": () => ok([member(1, 5)]),
      });

      await adapter.getExternalMilestones({ projectKey: "testrepo" });
      const result = await adapter.getMilestoneIssues({
        id: "testowner/testrepo#5",
        kind: "RELEASE",
      });

      expect(result.issues).toHaveLength(1);
      expect(calls.some((call) => call.endsWith("/milestones/5"))).toBe(false);
    });

    it("fails for a milestone that no longer exists, without listing issues", async () => {
      const calls = routeFetch({
        "GET /api/v1/settings/api": () => ok({ max_response_items: 50 }),
        "GET /api/v1/repos/testowner/testrepo/issues": () => ok([member(1, 8)]),
      });

      await expect(
        adapter.getMilestoneIssues({
          id: "testowner/testrepo#5",
          kind: "RELEASE",
        })
      ).rejects.toThrow("HTTP 404");
      expect(calls.some((call) => call.includes("/issues?"))).toBe(false);
    });

    it("fails when the lookup answers with a different milestone", async () => {
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/milestones/5": () =>
          ok({ id: 9, title: "5" }),
      });

      await expect(
        adapter.getMilestoneIssues({
          id: "testowner/testrepo#5",
          kind: "RELEASE",
        })
      ).rejects.toThrow("was not found");
    });

    it("returns nothing for an iteration or an id it does not recognise", async () => {
      const calls = routeFetch({});

      await expect(
        adapter.getMilestoneIssues({
          id: "testowner/testrepo#5",
          kind: "ITERATION",
        })
      ).resolves.toEqual({ issues: [], hasMore: false });
      await expect(
        adapter.getMilestoneIssues({ id: "12345", kind: "RELEASE" })
      ).resolves.toEqual({ issues: [], hasMore: false });
      expect(calls).toEqual([]);
    });
  });

  describe("attachments", () => {
    beforeEach(async () => {
      adapter = await authenticated();
    });

    it("uploadAttachment posts multipart form data under the attachment field", async () => {
      mockFetch.mockResolvedValueOnce(
        ok({
          id: 3,
          name: "shot.png",
          uuid: "df473fbc",
          browser_download_url:
            "https://gitea.example.com/attachments/df473fbc",
        })
      );

      const result = await adapter.uploadAttachment(
        "testowner/testrepo#7",
        Buffer.from("png-bytes"),
        "shot.png"
      );

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe(`${REPO}/issues/7/assets`);
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);
      const part = (options.body as FormData).get("attachment") as File;
      expect(part.name).toBe("shot.png");
      expect(options.headers["Content-Type"]).toBeUndefined();
      expect(result).toEqual({
        id: "3",
        url: "https://gitea.example.com/attachments/df473fbc",
      });
    });

    it("listAttachments returns the issue's files and its comments' files once each", async () => {
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/assets": () =>
          ok([
            {
              id: 3,
              name: "shot.png",
              size: 70,
              created_at: "2026-11-27T14:31:26Z",
              uuid: "aaa-111",
              browser_download_url: "https://elsewhere.example/attachments/x",
            },
            { id: 5, name: "run.log", size: 15, uuid: "bbb-222" },
            { id: 6, name: "no uuid" },
          ]),
        "GET /api/v1/repos/testowner/testrepo/issues/7/comments": () =>
          ok([
            { id: 1, body: "no files" },
            {
              id: 2,
              assets: [
                { id: 4, name: "comment shot.jpg", size: 134, uuid: "ccc-333" },
                { id: 3, name: "shot.png", size: 70, uuid: "aaa-111" },
              ],
            },
          ]),
      });

      const listed = await adapter.listAttachments("testowner/testrepo#7");

      expect(listed).toEqual([
        {
          id: "3",
          filename: "shot.png",
          byteSize: 70,
          createdAt: new Date("2026-11-27T14:31:26Z"),
          contentUrl: "https://gitea.example.com/attachments/aaa-111",
        },
        {
          id: "5",
          filename: "run.log",
          byteSize: 15,
          createdAt: undefined,
          contentUrl: "https://gitea.example.com/attachments/bbb-222",
        },
        {
          id: "4",
          filename: "comment shot.jpg",
          byteSize: 134,
          createdAt: undefined,
          contentUrl: "https://gitea.example.com/attachments/ccc-333",
        },
      ]);
    });

    it("listAttachments returns nothing on a server without the endpoint", async () => {
      const calls = routeFetch({});

      await expect(
        adapter.listAttachments("testowner/testrepo#7")
      ).resolves.toEqual([]);
      expect(calls).toEqual([
        "GET /api/v1/repos/testowner/testrepo/issues/7/assets",
      ]);
    });

    it("listAttachments keeps the issue's files when the comments cannot be read", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/assets": () =>
          ok([{ id: 3, name: "shot.png", size: 70, uuid: "aaa-111" }]),
        "GET /api/v1/repos/testowner/testrepo/issues/7/comments": () =>
          failure(403, "forbidden"),
      });

      const listed = await adapter.listAttachments("testowner/testrepo#7");

      expect(listed.map((meta) => meta.filename)).toEqual(["shot.png"]);
      warn.mockRestore();
    });

    it("listAttachments lets a failure other than a missing endpoint reach the caller", async () => {
      routeFetch({
        "GET /api/v1/repos/testowner/testrepo/issues/7/assets": () =>
          failure(403, "forbidden"),
      });

      await expect(
        adapter.listAttachments("testowner/testrepo#7")
      ).rejects.toThrow("HTTP 403");
    });

    it("downloadAttachment fetches the content URL with the token and keeps a real content type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "image/png",
          "content-length": "3",
        }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      });

      const result = await adapter.downloadAttachment({
        id: "3",
        filename: "shot.png",
        contentUrl: "https://gitea.example.com/attachments/aaa-111",
      });

      const [calledUrl, options] =
        mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(calledUrl).toBe("https://gitea.example.com/attachments/aaa-111");
      expect(options.headers.Authorization).toBe("token gitea-token");
      expect(result.mimeType).toBe("image/png");
      expect([...result.buffer]).toEqual([1, 2, 3]);
    });

    it("downloadAttachment refuses metadata without a content URL", async () => {
      await expect(
        adapter.downloadAttachment({ id: "3", filename: "x" })
      ).rejects.toThrow("no download URL");
    });
  });
});
