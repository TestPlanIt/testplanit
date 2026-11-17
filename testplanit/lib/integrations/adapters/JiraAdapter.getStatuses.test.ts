import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraAdapter } from "./JiraAdapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(body: any) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}

function errorResponse(status = 404) {
  return {
    ok: false,
    status,
    statusText: "Not Found",
    text: () => Promise.resolve("not found"),
    json: () => Promise.resolve({ errorMessages: ["not found"] }),
  };
}

const calledUrls = () => mockFetch.mock.calls.map((call) => String(call[0]));

describe("JiraAdapter.getStatuses", () => {
  let adapter: JiraAdapter;

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("flattens a project's statuses across issue types, deduping by name case-insensitively", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          name: "Bug",
          statuses: [
            { id: "1", name: "To Do" },
            { id: "3", name: "Done" },
          ],
        },
        {
          name: "Story",
          statuses: [
            { id: "99", name: "to do" },
            { id: "2", name: "In Progress" },
            { name: "Blocked" },
            { id: "5" },
          ],
        },
        { name: "Epic" },
      ])
    );

    const statuses = await adapter.getStatuses("PROJ");

    expect(statuses).toEqual([
      { id: "1", name: "To Do" },
      { id: "3", name: "Done" },
      { id: "2", name: "In Progress" },
      { id: "Blocked", name: "Blocked" },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(calledUrls()[0]).toBe(
      "https://test.atlassian.net/rest/api/3/project/PROJ/statuses"
    );
  });

  it("URI-encodes the project key", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ statuses: [{ id: "1", name: "Open" }] }])
    );

    await adapter.getStatuses("A B/C");

    expect(calledUrls()[0]).toBe(
      "https://test.atlassian.net/rest/api/3/project/A%20B%2FC/statuses"
    );
  });

  it("falls back to the global list when the project returns no statuses", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ name: "Bug", statuses: [] }]))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "10", name: "Open" },
          { id: "11", name: "OPEN" },
          { id: "12", name: "Closed" },
        ])
      );

    const statuses = await adapter.getStatuses("PROJ");

    expect(statuses).toEqual([
      { id: "10", name: "Open" },
      { id: "12", name: "Closed" },
    ]);
    expect(calledUrls()).toEqual([
      "https://test.atlassian.net/rest/api/3/project/PROJ/statuses",
      "https://test.atlassian.net/rest/api/3/status",
    ]);
  });

  it("falls back to the global list when the project call fails", async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(jsonResponse([{ id: "10", name: "Open" }]));

    const statuses = await adapter.getStatuses("NOPE");

    expect(statuses).toEqual([{ id: "10", name: "Open" }]);
    expect(calledUrls()[1]).toBe(
      "https://test.atlassian.net/rest/api/3/status"
    );
  });

  it("falls back to the global list when the project call rejects", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(jsonResponse([{ id: "10", name: "Open" }]));

    expect(await adapter.getStatuses("PROJ")).toEqual([
      { id: "10", name: "Open" },
    ]);
  });

  it("calls only the global list without a project key", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, name: "Open" },
        { id: 2, name: "Closed" },
      ])
    );

    const statuses = await adapter.getStatuses();

    expect(statuses).toEqual([
      { id: "1", name: "Open" },
      { id: "2", name: "Closed" },
    ]);
    expect(calledUrls()).toEqual([
      "https://test.atlassian.net/rest/api/3/status",
    ]);
  });

  it("propagates a failure of the global list", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    await expect(adapter.getStatuses()).rejects.toBeDefined();
  });
});
