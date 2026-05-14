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
    created: "2024-01-15T10:00:00.000Z",
    updated: "2024-01-15T12:00:00.000Z",
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

    it("should throw for non-api_key auth type", async () => {
      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "tok" })
      ).rejects.toThrow("Personal Access Token");
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
});
