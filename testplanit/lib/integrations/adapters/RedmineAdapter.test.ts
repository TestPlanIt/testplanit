import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedmineAdapter } from "./RedmineAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const BASE_URL = "https://redmine.example.com";

function okJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function noContent() {
  return { ok: true, status: 204 };
}

function httpError(status: number, body = "error") {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

describe("RedmineAdapter", () => {
  let adapter: RedmineAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    adapter = new RedmineAdapter({ provider: "REDMINE", baseUrl: BASE_URL });
    // Strip the inter-request throttle/backoff so multi-request methods don't sleep.
    (adapter as any).rateLimitDelay = 0;
    (adapter as any).maxRetries = 0;
  });

  /** Authenticate the adapter, consuming one mocked /users/current.json call. */
  async function authenticate() {
    mockFetch.mockResolvedValueOnce(
      okJson({ user: { id: 1, login: "admin" } })
    );
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
    it("validates the key against /users/current.json and sends X-Redmine-API-Key", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "abc123" })
      ).resolves.not.toThrow();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/users/current.json`);
      expect(opts.headers["X-Redmine-API-Key"]).toBe("abc123");
    });

    it("accepts the key supplied as apiToken", async () => {
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await adapter.authenticate({ type: "api_key", apiToken: "tok-456" });

      expect(mockFetch.mock.calls[0][1].headers["X-Redmine-API-Key"]).toBe(
        "tok-456"
      );
    });

    it("uses baseUrl from authData when not configured", async () => {
      const noUrlAdapter = new RedmineAdapter({ provider: "REDMINE" });
      (noUrlAdapter as any).maxRetries = 0;
      mockFetch.mockResolvedValueOnce(okJson({ user: { id: 1 } }));

      await noUrlAdapter.authenticate({
        type: "api_key",
        apiKey: "k",
        baseUrl: "https://rm.internal/",
      });

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://rm.internal/users/current.json"
      );
    });

    it("throws a friendly error on a rejected key", async () => {
      mockFetch.mockResolvedValueOnce(httpError(401, "Unauthorized"));

      await expect(
        adapter.authenticate({ type: "api_key", apiKey: "bad" })
      ).rejects.toThrow("Invalid Redmine API key or instance URL");
    });

    it("rejects non-api_key auth types", async () => {
      await expect(
        adapter.authenticate({ type: "oauth", accessToken: "x" })
      ).rejects.toThrow("only supports API key authentication");
    });

    it("requires an API key", async () => {
      await expect(adapter.authenticate({ type: "api_key" })).rejects.toThrow(
        "Redmine API key is required"
      );
    });
  });

  describe("getIssue", () => {
    it("fetches an issue with journals + relations and maps the fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 42,
            subject: "Login fails",
            description: "Steps to reproduce",
            status: { id: 2, name: "In Progress" },
            priority: { id: 4, name: "High" },
            tracker: { id: 1, name: "Bug" },
            category: { id: 9, name: "Auth" },
            assigned_to: { id: 7, name: "Dev One" },
            author: { id: 3, name: "Reporter" },
            custom_fields: [{ id: 11, name: "Severity", value: "Critical" }],
            created_on: "2024-01-15T10:00:00Z",
            updated_on: "2024-01-16T12:00:00Z",
          },
        })
      );

      const issue = await adapter.getIssue("#42");

      expect(mockFetch.mock.calls[0][0]).toBe(
        `${BASE_URL}/issues/42.json?include=journals,relations`
      );
      expect(issue).toMatchObject({
        id: "42",
        key: "#42",
        title: "Login fails",
        status: "In Progress",
        priority: "High",
        issueType: { id: "1", name: "Bug" },
        assignee: { id: "7", name: "Dev One" },
        reporter: { id: "3", name: "Reporter" },
        labels: ["Auth"],
        customFields: { Severity: "Critical" },
        url: `${BASE_URL}/issues/42`,
      });
      expect(issue.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("searchIssues", () => {
    it("fetches directly by id for a numeric query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 7, subject: "Found" } })
      );

      const res = await adapter.searchIssues({ query: "7" });

      expect(mockFetch.mock.calls[0][0]).toContain("/issues/7.json");
      expect(res).toMatchObject({ total: 1, hasMore: false });
      expect(res.issues[0].key).toBe("#7");
    });

    it("returns empty when a direct id lookup 404s", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(404, "Not Found"));

      const res = await adapter.searchIssues({ query: "#999" });

      expect(res).toEqual({ issues: [], total: 0, hasMore: false });
    });

    it("uses a subject contains filter for a text query", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [{ id: 1, subject: "login bug" }],
          total_count: 1,
        })
      );

      const res = await adapter.searchIssues({
        query: "login",
        projectId: "3",
        limit: 10,
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.pathname).toBe("/issues.json");
      expect(url.searchParams.get("subject")).toBe("~login");
      expect(url.searchParams.get("project_id")).toBe("3");
      expect(url.searchParams.get("status_id")).toBe("*");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(res.total).toBe(1);
      expect(res.issues[0].id).toBe("1");
    });

    it("computes hasMore from total_count and offset", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issues: [{ id: 1 }, { id: 2 }],
          total_count: 10,
        })
      );

      const res = await adapter.searchIssues({ limit: 2, offset: 0 });

      expect(res.hasMore).toBe(true);
      expect(res.total).toBe(10);
    });
  });

  describe("createIssue", () => {
    it("POSTs an issue with mapped fields", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 100, subject: "New bug" } })
      );

      const result = await adapter.createIssue({
        title: "New bug",
        description: "details",
        projectId: "5",
        issueType: "2",
        priority: "4",
        assigneeId: "8",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/issues.json`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        issue: {
          project_id: "5",
          subject: "New bug",
          description: "details",
          tracker_id: 2,
          priority_id: 4,
          assigned_to_id: 8,
        },
      });
      expect(result.id).toBe("100");
    });
  });

  describe("updateIssue", () => {
    it("PUTs changed fields then re-fetches the issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent()); // PUT
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 42, subject: "Updated" } })
      ); // GET

      const result = await adapter.updateIssue("#42", { title: "Updated" });

      const [putUrl, putOpts] = mockFetch.mock.calls[0];
      expect(putUrl).toBe(`${BASE_URL}/issues/42.json`);
      expect(putOpts.method).toBe("PUT");
      expect(JSON.parse(putOpts.body)).toEqual({
        issue: { subject: "Updated" },
      });
      expect(result.title).toBe("Updated");
    });

    it("resolves a status name to a status id", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue_statuses: [
            { id: 1, name: "New" },
            { id: 3, name: "Closed" },
          ],
        })
      ); // getStatuses
      mockFetch.mockResolvedValueOnce(noContent()); // PUT
      mockFetch.mockResolvedValueOnce(
        okJson({ issue: { id: 42, status: { id: 3, name: "Closed" } } })
      ); // GET

      await adapter.updateIssue("42", { status: "Closed" });

      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        issue: { status_id: 3 },
      });
    });
  });

  describe("getIssueComments", () => {
    it("returns journal notes, skipping empty entries", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 5,
            journals: [
              {
                id: 1,
                notes: "first note",
                user: { id: 2, name: "Bob" },
                created_on: "2024-01-01",
              },
              { id: 2, notes: "", user: { id: 3, name: "Quiet" } },
            ],
          },
        })
      );

      const comments = await adapter.getIssueComments("5");

      expect(mockFetch.mock.calls[0][0]).toContain("include=journals");
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
    it("maps relations with direction relative to the source issue", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          issue: {
            id: 10,
            relations: [
              {
                id: 1,
                issue_id: 10,
                issue_to_id: 20,
                relation_type: "relates",
              },
              { id: 2, issue_id: 5, issue_to_id: 10, relation_type: "blocks" },
            ],
          },
        })
      );

      const links = await adapter.getLinkedIssues("10");

      expect(links).toEqual([
        { id: "20", key: "#20", linkType: "relates", direction: "outward" },
        { id: "5", key: "#5", linkType: "blocks", direction: "inward" },
      ]);
    });
  });

  describe("metadata lookups", () => {
    it("getProjects maps id/identifier/name", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          projects: [{ id: 1, identifier: "web", name: "Website" }],
        })
      );

      expect(await adapter.getProjects()).toEqual([
        { id: "1", key: "web", name: "Website" },
      ]);
    });

    it("getIssueTypes maps trackers", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          trackers: [
            { id: 1, name: "Bug" },
            { id: 2, name: "Feature" },
          ],
        })
      );

      expect(await adapter.getIssueTypes("any")).toEqual([
        { id: "1", name: "Bug" },
        { id: "2", name: "Feature" },
      ]);
    });

    it("getStatuses maps issue_statuses", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue_statuses: [{ id: 1, name: "New" }] })
      );

      expect(await adapter.getStatuses()).toEqual([{ id: "1", name: "New" }]);
    });

    it("getPriorities maps issue_priorities", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({ issue_priorities: [{ id: 4, name: "High" }] })
      );

      expect(await adapter.getPriorities()).toEqual([
        { id: "4", name: "High" },
      ]);
    });
  });

  describe("user lookups", () => {
    it("searchUsers fails soft on 403 (non-admin key)", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(httpError(403, "Forbidden"));

      await expect(adapter.searchUsers("bob")).resolves.toEqual([]);
    });

    it("getCurrentUser returns the authenticated user", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(
        okJson({
          user: {
            id: 1,
            firstname: "Ada",
            lastname: "Lovelace",
            mail: "ada@x.io",
          },
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
    it("adds a note via PUT and swallows failures", async () => {
      await authenticate();
      mockFetch.mockResolvedValueOnce(noContent());

      await adapter.linkToTestCase("#42", "TC-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/issues/42.json`);
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body).issue.notes).toContain("TC-1");
    });
  });
});
