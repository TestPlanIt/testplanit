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
 * `searchIssues`, mapped `parent` ref extraction, and the DC/Server no-op.
 * All MUST fail at authoring time — `getMilestoneIssues` does not exist yet.
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
      expect(params.get("jql")).not.toContain("fixVersion = \"");
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

  describe("Data Center / Server deployment — Cloud-only no-op", () => {
    it("returns an empty membership result without throwing on a DC/Server-shaped adapter", async () => {
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

      const result = await (serverAdapter as any).getMilestoneIssues({
        id: "10000",
        kind: "RELEASE",
      });

      expect(result.issues).toEqual([]);
      expect(result.hasMore).toBe(false);
      // Clean skip — no upstream request attempted for the Cloud-only endpoint.
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
