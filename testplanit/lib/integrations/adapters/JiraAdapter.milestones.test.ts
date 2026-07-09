import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraAdapter } from "./JiraAdapter";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * mockFetch's ok:true default response for every non-authenticate call in
 * this suite. authenticate() itself resolves `{ accountId: "test-user" }`.
 */
function jsonResponse(body: any) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}

describe("JiraAdapter.getExternalMilestones", () => {
  let adapter: JiraAdapter;

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so any unconsumed queued
    // mockResolvedValueOnce from a prior test can't leak into this test's
    // authenticate() call or its own fetch sequence.
    mockFetch.mockReset();
    adapter = new JiraAdapter({
      provider: "JIRA",
      baseUrl: "https://test.atlassian.net",
    });

    // Authenticate with Cloud API-key creds so buildUrl/makeRequest route
    // through the api-key path instead of OAuth.
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

  describe("RELEASE mapping", () => {
    it("maps a released version to CLOSED with rawState 'released'", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              id: "10000",
              name: "v1.0",
              released: true,
              archived: false,
              releaseDate: "2026-01-15",
              self: "https://test.atlassian.net/rest/api/3/version/10000",
            },
          ],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "10000",
        kind: "RELEASE",
        name: "v1.0",
        state: "CLOSED",
        rawState: "released",
      });
    });

    it("maps an archived version to CLOSED with rawState 'archived'", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              id: "10001",
              name: "v0.9-old",
              released: false,
              archived: true,
            },
          ],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        state: "CLOSED",
        rawState: "archived",
      });
    });

    it("maps an unreleased version with a past start date to ACTIVE", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              id: "10002",
              name: "v1.1",
              released: false,
              archived: false,
              startDate: "2020-01-01",
            },
          ],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        state: "ACTIVE",
        rawState: "active",
      });
    });

    it("maps an unreleased version with no start date (or future) to FUTURE", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            {
              id: "10003",
              name: "v2.0",
              released: false,
              archived: false,
            },
          ],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        state: "FUTURE",
        rawState: "future",
      });
    });

    it("uses the v3 version path on Cloud", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [], isLast: true })
      );

      await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/rest/api/3/project/TEST/version"),
        expect.anything()
      );
    });
  });

  describe("ITERATION mapping + board discovery + dedupe", () => {
    it("maps sprint states to normalized state + rawState", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "1", name: "Board 1" }],
          isLast: true,
        })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "100", name: "Sprint 1", state: "closed" },
            { id: "101", name: "Sprint 2", state: "active" },
            { id: "102", name: "Sprint 3", state: "future" },
          ],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(3);
      const byId = Object.fromEntries(
        result.items.map((item) => [item.id, item])
      );
      expect(byId["100"]).toMatchObject({
        state: "CLOSED",
        rawState: "closed",
      });
      expect(byId["101"]).toMatchObject({
        state: "ACTIVE",
        rawState: "active",
      });
      expect(byId["102"]).toMatchObject({
        state: "FUTURE",
        rawState: "future",
      });
    });

    it("dedupes a sprint id shared across two boards into a single item", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "1", name: "Board 1" },
            { id: "2", name: "Board 2" },
          ],
          isLast: true,
        })
      );
      // Board 1 sprints
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "200", name: "Shared Sprint", state: "active" }],
          isLast: true,
        })
      );
      // Board 2 sprints — same sprint id 200
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "200", name: "Shared Sprint", state: "active" }],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("200");
    });

    it("discovers boards via /rest/agile/1.0/board with projectKeyOrId", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [], isLast: true })
      );

      await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/rest/agile/1.0/board"),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("projectKeyOrId=TEST"),
        expect.anything()
      );
    });
  });

  describe("includeClosed filter", () => {
    it("drops CLOSED items by default (includeClosed: false)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "1", name: "v1.0", released: true, archived: false },
            { id: "2", name: "v1.1", released: false, archived: false },
          ],
          isLast: true,
        })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [], isLast: true })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        includeClosed: false,
      });

      expect(result.items.every((item) => item.state !== "CLOSED")).toBe(true);
      expect(result.items.map((item) => item.id)).not.toContain("1");
      expect(result.items.map((item) => item.id)).toContain("2");
    });
  });

  describe("no kind filter", () => {
    it("returns both RELEASE and ITERATION items when kind is omitted", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "1", name: "v1.0", released: false, archived: false }],
          isLast: true,
        })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [{ id: "10", name: "Board 1" }], isLast: true })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "100", name: "Sprint 1", state: "active" }],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
      });

      const kinds = result.items.map((item) => item.kind).sort();
      expect(kinds).toEqual(["ITERATION", "RELEASE"]);
    });
  });

  describe("Data Center / Server deployment", () => {
    it("uses the v2 version path when the deployment is server", async () => {
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

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [], isLast: true })
      );

      await serverAdapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/rest/api/2/project/TEST/version"),
        expect.anything()
      );
    });

    it("still uses the deployment-agnostic /rest/agile/1.0/ path for sprints on Server", async () => {
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

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [], isLast: true })
      );

      await serverAdapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/rest/agile/1.0/board"),
        expect.anything()
      );
    });
  });

  describe("bare-array responses (older Server/DC, no pagination envelope)", () => {
    it("maps versions from a bare-array response as a single complete page", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { id: "10000", name: "v1.0", released: false, archived: false },
          { id: "10001", name: "v1.1", released: false, archived: false },
        ])
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "RELEASE",
        includeClosed: true,
      });

      expect(result.items.map((item) => item.id)).toEqual(["10000", "10001"]);
      // A bare array has no envelope to page through — exactly one request.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("maps sprints from a bare-array response as a single complete page", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ values: [{ id: "1", name: "Board 1" }], isLast: true })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { id: "100", name: "Sprint 1", state: "active" },
          { id: "101", name: "Sprint 2", state: "future" },
        ])
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items.map((item) => item.id).sort()).toEqual([
        "100",
        "101",
      ]);
      // Board discovery + one sprint page — no second sprint request.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("hard-failure propagation vs partial degradation", () => {
    it("propagates a server failure from the versions endpoint instead of returning empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(
        adapter.getExternalMilestones({
          projectKey: "TEST",
          kind: "RELEASE",
        })
      ).rejects.toThrow("HTTP 500");
    });

    it("propagates an auth failure (401) from the versions endpoint so bad credentials are surfaced", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      await expect(
        adapter.getExternalMilestones({
          projectKey: "TEST",
          kind: "RELEASE",
        })
      ).rejects.toThrow("HTTP 401");
    });

    it("propagates an auth failure from board discovery instead of returning zero sprints", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(
        adapter.getExternalMilestones({
          projectKey: "TEST",
          kind: "ITERATION",
        })
      ).rejects.toThrow("HTTP 403");
    });

    it("treats a 404 from board discovery as no agile support (empty, not a throw)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
      });

      expect(result.items).toEqual([]);
    });

    it("propagates when every board's sprint fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "1", name: "Board 1" },
            { id: "2", name: "Board 2" },
          ],
          isLast: true,
        })
      );
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      await expect(
        adapter.getExternalMilestones({
          projectKey: "TEST",
          kind: "ITERATION",
        })
      ).rejects.toThrow("HTTP 401");
    });

    it("still returns sprints from a healthy board when one board's sprint fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "1", name: "Board 1" },
            { id: "2", name: "Board 2" },
          ],
          isLast: true,
        })
      );
      // Board 1 fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      // Board 2 succeeds
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "300", name: "Sprint X", state: "active" }],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("300");
    });

    it("treats a 400 'board does not support sprints' as a skip — a Kanban-only project previews cleanly instead of throwing", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "7", name: "Kanban Board" }],
          isLast: true,
        })
      );
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            '{"errorMessages":["The board does not support sprints"],"errors":{}}'
          ),
      });

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items).toEqual([]);
    });

    it("skips a 400 Kanban board but still returns sprints from the project's Scrum board", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [
            { id: "7", name: "Kanban Board" },
            { id: "8", name: "Scrum Board" },
          ],
          isLast: true,
        })
      );
      // Kanban board: 400 does-not-support-sprints
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            '{"errorMessages":["The board does not support sprints"],"errors":{}}'
          ),
      });
      // Scrum board succeeds
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          values: [{ id: "301", name: "Sprint Y", state: "future" }],
          isLast: true,
        })
      );

      const result = await adapter.getExternalMilestones({
        projectKey: "TEST",
        kind: "ITERATION",
        includeClosed: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("301");
    });
  });
});
