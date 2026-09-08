import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraAdapter } from "./JiraAdapter";

/**
 * RED scaffold (18-01) for the not-yet-implemented `getMilestoneIssues` on
 * JiraAdapter. Interface already locked on IssueAdapter.ts:271-279:
 *
 *   getMilestoneIssues?(
 *     ref: { id: string; kind: "RELEASE" | "ITERATION" },
 *     options?: { pageToken?: string; limit?: number }
 *   ): Promise<{ issues: IssueData[]; total?: number; hasMore: boolean; nextPageToken?: string }>
 *
 * These tests pin: JQL construction (fixVersion = / sprint =), the `parent`
 * field addition to the fields param, nextPageToken pagination mirroring
 * `searchIssues`, mapped `parent` ref extraction, and the Server/Data Center
 * v2 `/search` dialect (classic endpoint, startAt pagination).
 */

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(body: any) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}

describe("JiraAdapter.getMilestoneIssues", () => {
  let adapter: JiraAdapter;

  beforeEach(async () => {
    mockFetch.mockReset();
    adapter = new JiraAdapter({
      provider: "JIRA",
      baseUrl: "https://test.atlassian.net",
    });

    mockFetch.mockResolvedValueOnce(jsonResponse({ accountId: "test-user" }));
    await adapter.authenticate({
      type: "api_key",
      email: "test@example.com",
      apiToken: "test-token",
      baseUrl: "https://test.atlassian.net",
    });
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("JQL construction", () => {
    it("builds a fixVersion = <id> clause for a RELEASE ref (numeric id, not name)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], isLast: true })
      );

      await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      const params = new URL(calledUrl).searchParams;
      expect(params.get("jql")).toContain("fixVersion = 10000");
      expect(params.get("jql")).not.toContain('fixVersion = "');
    });

    it("builds a sprint = <id> clause for an ITERATION ref (numeric id, not name)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], isLast: true })
      );

      await (adapter as any).getMilestoneIssues({
        id: "200",
        kind: "ITERATION",
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      const params = new URL(calledUrl).searchParams;
      expect(params.get("jql")).toContain("sprint = 200");
    });
  });

  describe("fields param includes parent (D-14)", () => {
    it("requests the parent field alongside the standard field set", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], isLast: true })
      );

      await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      const params = new URL(calledUrl).searchParams;
      const fields = params.get("fields") || "";
      expect(fields).toContain("parent");
      expect(fields).toContain("summary");
      expect(fields).toContain("description");
      expect(fields).toContain("status");
      expect(fields).toContain("priority");
      expect(fields).toContain("issuetype");
      expect(fields).toContain("assignee");
      expect(fields).toContain("reporter");
      expect(fields).toContain("labels");
      expect(fields).toContain("created");
      expect(fields).toContain("updated");
    });
  });

  describe("pagination mirrors searchIssues", () => {
    it("echoes options.pageToken back as the nextPageToken URLSearchParam on the request", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], isLast: true })
      );

      await (adapter as any).getMilestoneIssues(
        { id: "10000", kind: "RELEASE" },
        { pageToken: "cursor-abc" }
      );

      const [calledUrl] = mockFetch.mock.calls[0];
      const params = new URL(calledUrl).searchParams;
      expect(params.get("nextPageToken")).toBe("cursor-abc");
    });

    it("returns the response's nextPageToken and hasMore derived from isLast, like searchIssues", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "1",
              key: "TPI-1",
              self: "https://test.atlassian.net/rest/api/3/issue/1",
              fields: {
                summary: "Issue 1",
                status: { name: "Open" },
                created: "2026-01-01T00:00:00.000Z",
                updated: "2026-01-02T00:00:00.000Z",
              },
            },
          ],
          isLast: false,
          nextPageToken: "cursor-next",
        })
      );

      const result = await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.hasMore).toBe(true);
      expect(result.nextPageToken).toBe("cursor-next");
    });

    it("derives hasMore=false when isLast is true and no nextPageToken is present", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], isLast: true })
      );

      const result = await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.hasMore).toBe(false);
      expect(result.nextPageToken).toBeUndefined();
    });
  });

  describe("mapped parent ref (D-14, mirrors mapLinkedIssues guard)", () => {
    it("surfaces parent: { id, key } when fields.parent is present", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "1",
              key: "TPI-1",
              self: "https://test.atlassian.net/rest/api/3/issue/1",
              fields: {
                summary: "Child issue",
                status: { name: "Open" },
                created: "2026-01-01T00:00:00.000Z",
                updated: "2026-01-02T00:00:00.000Z",
                parent: { id: "999", key: "TPI-999" },
              },
            },
          ],
          isLast: true,
        })
      );

      const result = await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.issues).toHaveLength(1);
      expect((result.issues[0] as any).parent).toEqual({
        id: "999",
        key: "TPI-999",
      });
    });

    it("omits parent when fields.parent is absent (same fields.parent && fields.parent.id guard)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          issues: [
            {
              id: "2",
              key: "TPI-2",
              self: "https://test.atlassian.net/rest/api/3/issue/2",
              fields: {
                summary: "Top-level issue",
                status: { name: "Open" },
                created: "2026-01-01T00:00:00.000Z",
                updated: "2026-01-02T00:00:00.000Z",
              },
            },
          ],
          isLast: true,
        })
      );

      const result = await (adapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.issues).toHaveLength(1);
      expect((result.issues[0] as any).parent).toBeUndefined();
    });
  });

  describe("Data Center / Server deployment — v2 /search dialect", () => {
    // A live DC v2 /search member row: name/key user refs, plain-string
    // description, self on /rest/api/2. Mirrors the dcIssue shape used by the
    // Data Center search tests in JiraAdapter.test.ts.
    const dcMember = {
      id: "20001",
      key: "DC-1",
      self: "https://jira.internal.example.com/rest/api/2/issue/20001",
      fields: {
        summary: "DC member",
        description: "DC body",
        status: { name: "Open" },
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-02T00:00:00.000Z",
      },
    };

    async function makeServerAdapter() {
      const serverAdapter = new JiraAdapter({
        provider: "JIRA",
        baseUrl: "https://jira.internal.example.com",
        deploymentType: "server",
      });
      mockFetch.mockResolvedValueOnce(jsonResponse({ name: "test-user" }));
      await serverAdapter.authenticate({
        type: "api_key",
        apiToken: "server-pat",
        baseUrl: "https://jira.internal.example.com",
      });
      mockFetch.mockClear();
      return serverAdapter;
    }

    it("queries the classic /rest/api/2/search endpoint (not search/jql) with the fixVersion clause", async () => {
      const serverAdapter = await makeServerAdapter();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [], total: 0, startAt: 0 })
      );

      await (serverAdapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain("/rest/api/2/search?");
      expect(calledUrl).not.toContain("search/jql");
      const params = new URL(calledUrl).searchParams;
      expect(params.get("jql")).toContain("fixVersion = 10000");
    });

    it("maps returned members and synthesizes a startAt-based nextPageToken when more pages exist", async () => {
      const serverAdapter = await makeServerAdapter();
      // Page 1: one member back, total=3 → two more exist.
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [dcMember], total: 3, startAt: 0 })
      );

      const result = await (serverAdapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe("20001");
      expect(result.hasMore).toBe(true);
      expect(result.nextPageToken).toBe("1");
    });

    it("sends an incoming pageToken back as startAt (not nextPageToken) on DC", async () => {
      const serverAdapter = await makeServerAdapter();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [dcMember], total: 3, startAt: 1 })
      );

      await (serverAdapter as any).getMilestoneIssues(
        { id: "200", kind: "ITERATION" },
        { pageToken: "1" }
      );

      const [calledUrl] = mockFetch.mock.calls[0];
      const params = new URL(calledUrl).searchParams;
      expect(params.get("startAt")).toBe("1");
      expect(params.get("nextPageToken")).toBeNull();
      expect(params.get("jql")).toContain("sprint = 200");
    });

    it("omits nextPageToken once the last page is reached", async () => {
      const serverAdapter = await makeServerAdapter();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ issues: [dcMember], total: 1, startAt: 0 })
      );

      const result = await (serverAdapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.hasMore).toBe(false);
      expect(result.nextPageToken).toBeUndefined();
    });
  });
});
