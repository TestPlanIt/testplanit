import { beforeEach, describe, expect, it, vi } from "vitest";
import { MantisBTAdapter } from "./MantisBTAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const BASE_URL = "https://mantis.example.com";
const API = `${BASE_URL}/api/rest`;

function okJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function noContent() {
  return { ok: true, status: 204 };
}

function httpError(status: number, body = "error") {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

describe("MantisBTAdapter", () => {
  let adapter: MantisBTAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    adapter = new MantisBTAdapter({ provider: "MANTISBT", baseUrl: BASE_URL });
    // Strip the inter-request throttle/backoff so multi-request methods don't sleep.
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).maxRetries = 0;
  });

  /** Authenticate the adapter, consuming one mocked /users/me call. */
  async function authenticate() {
    mockFetch.mockResolvedValueOnce(okJson({ id: 1, name: "admin" }));
    await adapter.authenticate({ type: "api_key", apiKey: "test-key" });
    mockFetch.mockClear();
  }

  describe("getCapabilities", () => {
    it("reports the supported capabilities", () => {
      expect(adapter.getCapabilities()).toEqual({
        createIssue: true,
        updateIssue: true,
        linkIssue: true,
        syncIssue: true,
        searchIssues: true,
        webhooks: true,
        customFields: true,
        attachments: false,
        linkedIssues: true,
        comments: true,
        milestones: false,
      });
    });
  });

  describe("authenticate", () => {
    it("validates the token against /users/me and sends the raw Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "abc123" })
      ).resolves.not.toThrow();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/users/me`);
      // Raw token, no "Bearer"/"token" prefix.
      expect(opts.headers["Authorization"]).toBe("abc123");
    });

    it("accepts the token supplied as apiToken", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await adapter.authenticate({ type: "api_key", apiToken: "tok-456" });

      expect(mockFetch.mock.calls[0][1].headers["Authorization"]).toBe(
        "tok-456"
      );
    });

    it("uses baseUrl from authData when not configured", async () => {
      const noUrlAdapter = new MantisBTAdapter({ provider: "MANTISBT" });
      (noUrlAdapter as any).maxRetries = 0;
      mockFetch.mockResolvedValueOnce(okJson({ id: 1 }));

      await noUrlAdapter.authenticate({
        type: "api_key",
        apiKey: "k",
        baseUrl: "https://mantis.internal/",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://mantis.internal/api/rest/users/me"
      );
    });

    it("throws a friendly error on a rejected token", async () => {
      mockFetch.mockResolvedValueOnce(httpError(401, "Unauthorized"));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad" })
      ).rejects.toThrow("Invalid MantisBT API token or instance URL");
    });

    it("rejects non-api_key auth types", async () => {
      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "x" })
      ).rejects.toThrow("only supports API token authentication");
    });

    it("requires an API token", async () => {
      await expect(adapter.authenticate({ type: "api_key" })).rejects.toThrow(
        "MantisBT API token is required"
      );
    });
  });

  describe("getIssue", () => {
    it("unwraps the single-element issues array and maps the fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 42,
              summary: "Login fails",
              description: "Steps to reproduce",
              status: { id: 50, name: "assigned" },
              priority: { id: 30, name: "high" },
              category: { id: 9, name: "Authentication" },
              handler: { id: 7, name: "dev1", real_name: "Dev One" },
              reporter: { id: 3, name: "qa", real_name: "QA Person" },
              tags: [{ id: 1, name: "regression" }],
              custom_fields: [
                { field: { id: 11, name: "Severity" }, value: "Critical" },
              ],
              created_at: "2024-01-15T10:00:00Z",
              updated_at: "2024-01-16T12:00:00Z",
            },
          ],
        })
      );

      const issue = await adapter.getIssue("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/issues/42`);
      expect(issue).toMatchObject({
        id: "42",
        key: "#42",
        title: "Login fails",
        status: "assigned",
        priority: "high",
        issueType: { id: "9", name: "Authentication" },
        assignee: { id: "7", name: "Dev One" },
        reporter: { id: "3", name: "QA Person" },
        labels: ["regression"],
        customFields: { Severity: "Critical" },
        url: `${BASE_URL}/view.php?id=42`,
      });
      expect(issue.createdAt).toBeInstanceOf(Date);
    });

    it("throws when the issue is not present in the response", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issues: [] }));

      await expect(adapter.getIssue("99")).rejects.toThrow("not found");
    });
  });

  describe("searchIssues", () => {
    it("fetches directly by id for a numeric query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issues: [{ id: 7, summary: "Found" }] })
      );

      const res = await adapter.searchIssues({ query: "7" });

      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/issues/7`);
      expect(res).toMatchObject({ total: 1, hasMore: false });
      expect(res.issues[0].key).toBe("#7");
    });

    it("returns empty when a direct id lookup 404s", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(404, "Not Found"));

      const res = await adapter.searchIssues({ query: "#999" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
    });

    it("returns empty for a text query with no project scope (no REST text search)", async () => {
      await authenticate();

      const res = await adapter.searchIssues({ query: "login" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("lists a project page and filters by summary substring for a text query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            { id: 1, summary: "login bug" },
            { id: 2, summary: "logout works" },
          ],
        })
      );

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe("/api/rest/issues");
      expect(url.searchParams.get("project_id")).toBe("3");
      expect(url.searchParams.get("page_size")).toBe("100");
      expect(res.issues).toHaveLength(1);
      expect(res.issues[0].id).toBe("1");
    });

    it("reports hasMore when the tracker returned a full page", async () => {
      await authenticate();
      const fullPage = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        summary: `issue ${i + 1}`,
      }));
      mockFetch.mockResolvedValueOnce(okJson({ issues: fullPage }));

      const res = await adapter.searchIssues({ projectId: "3", limit: 5 });

      expect(res.issues).toHaveLength(5);
      expect(res.hasMore).toBe(true);
    });

    it("reports hasMore from the raw page even when the text filter empties it", async () => {
      await authenticate();
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        summary: "unrelated issue",
      }));
      mockFetch.mockResolvedValueOnce(okJson({ issues: fullPage }));

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      expect(res.issues).toEqual([]);
      expect(res.hasMore).toBe(true);
    });
  });

  describe("createIssue", () => {
    it("POSTs an issue with summary, project, category, priority and handler", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 100, summary: "New bug" } })
      );

      const result = await adapter.createIssue({
        title: "New bug",
        description: "details",
        projectId: "5",
        issueType: "9", // category id
        priority: "high",
        assigneeId: "8",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/issues`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        summary: "New bug",
        description: "details",
        project: { id: 5 },
        category: { id: 9 },
        priority: { name: "high" },
        handler: { id: 8 },
      });
      expect(result.id).toBe("100");
    });

    it("sends a category name when the type value is non-numeric", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 101 } }));

      await adapter.createIssue({
        title: "x",
        projectId: "5",
        issueType: "Authentication",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.category).toEqual({ name: "Authentication" });
      expect(body.description).toBe(""); // Mantis requires a description
    });
  });

  describe("updateIssue", () => {
    it("PATCHes changed fields by name then re-fetches the issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent()); // PATCH
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            { id: 42, summary: "Updated", status: { name: "resolved" } },
          ],
        })
      ); // GET

      const result = await adapter.updateIssue("#42", {
        title: "Updated",
        status: "resolved",
      });

      const [patchUrl, patchOpts] = mockFetch.mock.calls[0];
      expect(patchUrl).toBe(`${API}/issues/42`);
      expect(patchOpts.method).toBe("PATCH");
      expect(JSON.parse(patchOpts.body)).toEqual({
        summary: "Updated",
        status: { name: "resolved" },
      });
      expect(result.title).toBe("Updated");
      expect(mockFetch.mock.calls[1][0]).toBe(`${API}/issues/42`);
    });
  });

  describe("getIssueComments", () => {
    it("returns notes, skipping empty entries", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 5,
              notes: [
                {
                  id: 1,
                  text: "first note",
                  reporter: { id: 2, real_name: "Bob" },
                  created_at: "2024-01-01",
                },
                { id: 2, text: "  ", reporter: { id: 3, name: "Quiet" } },
              ],
            },
          ],
        })
      );

      const comments = await adapter.getIssueComments("5");

      expect(comments).toEqual([
        { id: "1", author: "Bob", body: "first note", created: "2024-01-01" },
      ]);
    });

    it("fails soft to an empty array on error", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(500, "boom"));

      await expect(adapter.getIssueComments("5")).resolves.toEqual([]);
    });
  });

  describe("getLinkedIssues", () => {
    it("maps relationships to the related issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [
            {
              id: 10,
              relationships: [
                {
                  id: 1,
                  type: { id: 2, name: "related to" },
                  issue: { id: 20 },
                },
                {
                  id: 2,
                  type: { id: 4, name: "duplicate of" },
                  issue: { id: 5 },
                },
              ],
            },
          ],
        })
      );

      const links = await adapter.getLinkedIssues("10");

      expect(links).toEqual([
        { id: "20", key: "#20", linkType: "related to", direction: "outward" },
        { id: "5", key: "#5", linkType: "duplicate of", direction: "outward" },
      ]);
    });
  });

  describe("metadata lookups", () => {
    it("getProjects maps id/name with the id as the key", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ projects: [{ id: 1, name: "Website" }] })
      );

      expect(await adapter.getProjects()).toEqual([
        { id: "1", key: "1", name: "Website" },
      ]);
    });

    it("getIssueTypes returns the project's categories", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          projects: [
            {
              id: 3,
              name: "Website",
              categories: [
                { id: 9, name: "Authentication" },
                { id: 10, name: "UI" },
              ],
            },
          ],
        })
      );

      expect(await adapter.getIssueTypes("3")).toEqual([
        { id: "9", name: "Authentication" },
        { id: "10", name: "UI" },
      ]);
      expect(mockFetch.mock.calls[0][0]).toBe(`${API}/projects/3`);
    });
  });

  describe("getCurrentUser", () => {
    it("returns the authenticated user from /users/me", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          id: 1,
          name: "ada",
          real_name: "Ada Lovelace",
          email: "ada@x.io",
        })
      );

      expect(await adapter.getCurrentUser()).toEqual({
        accountId: "1",
        displayName: "Ada Lovelace",
        emailAddress: "ada@x.io",
      });
    });
  });

  describe("linkToTestCase", () => {
    it("adds a note via POST and swallows failures", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(okJson({ note: { id: 1 } }));

      await adapter.linkToTestCase("#42", "TC-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API}/issues/42/notes`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body).text).toContain("TC-1");
    });
  });
});
