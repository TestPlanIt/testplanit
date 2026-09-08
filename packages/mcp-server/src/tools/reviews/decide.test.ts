import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReviewsDecide } from "./decide.js";

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};
const deps = { env: mockEnv };

function decidedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rr1",
    status: "APPROVED",
    entityType: "CASE",
    entityId: 11,
    projectId: 1,
    decisionComment: null,
    decidedByUserId: "user-me",
    decidedAt: "2026-02-02T00:00:00.000Z",
    toStateId: 6,
    ...overrides,
  };
}

function stubFetch(response: {
  ok: boolean;
  status?: number;
  body: unknown | string;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    text: async () =>
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerReviewsDecide(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function callTool(client: Client, args: Record<string, unknown>) {
  return client.callTool({
    name: "testplanit_reviews_decide",
    arguments: args,
  }) as Promise<{
    isError?: boolean;
    content: Array<{ text: string }>;
    structuredContent?: Record<string, any>;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testplanit_reviews_decide", () => {
  it("posts the decision to the host route with the bearer token", async () => {
    const fetchMock = stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
      comment: "Looks right",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://testplanit.example.com/api/reviews/rr1/decide",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tpi_testtoken");
    expect(JSON.parse(init.body)).toEqual({
      decision: "APPROVED",
      comment: "Looks right",
    });
  });

  it("reports that an approval applied the workflow transition", async () => {
    stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.structuredContent).toMatchObject({
      id: "rr1",
      status: "APPROVED",
      transitionApplied: true,
      appliedStateId: 6,
      decidedAt: "2026-02-02T00:00:00.000Z",
    });
  });

  it("reports no transition for a non-approval", async () => {
    stubFetch({
      ok: true,
      body: decidedRow({
        status: "CHANGES_REQUESTED",
        decisionComment: "Add a negative case",
      }),
    });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "CHANGES_REQUESTED",
      comment: "Add a negative case",
    });

    expect(result.structuredContent).toMatchObject({
      status: "CHANGES_REQUESTED",
      transitionApplied: false,
      appliedStateId: null,
    });
  });

  it("refuses a comment-less CHANGES_REQUESTED before spending a round trip", async () => {
    const fetchMock = stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "CHANGES_REQUESTED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("comment is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only comment on a rejection", async () => {
    const fetchMock = stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "REJECTED",
      comment: "   ",
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an approval with no comment", async () => {
    const fetchMock = stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      decision: "APPROVED",
    });
  });

  it.each([
    ["INELIGIBLE_REVIEWER", 403, "eligible reviewer"],
    ["ALREADY_DECIDED", 409, "already been decided"],
    ["NOT_FOUND", 404, "testplanit_reviews_list"],
    ["FEATURE_DISABLED", 403, "turned off"],
    ["INVALID_BODY", 400, "malformed"],
  ])("explains the %s failure", async (code, status, expected) => {
    stubFetch({ ok: false, status, body: { error: { code } } });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(expected);
    expect(result.content[0]?.text).toContain(code);
  });

  it("explains that a read-only token cannot decide", async () => {
    stubFetch({
      ok: false,
      status: 401,
      body: {
        error: {
          code: "READ_ONLY_TOKEN",
          message: "Token is read-only; write operations are not permitted.",
        },
      },
    });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("read-only");
    expect(result.content[0]?.text).toContain("READ_ONLY_TOKEN");
  });

  it("names the real cause when the host predates the token-decide path", async () => {
    // Session-only route: 401 with no errorCode, which no token can fix.
    stubFetch({ ok: false, status: 401, body: { error: "Unauthorized" } });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("predates");
    expect(result.content[0]?.text).toContain("testplanit_reviews_list");
  });

  it("never echoes the token in an error", async () => {
    stubFetch({
      ok: false,
      status: 500,
      body: { error: "boom tpi_testtoken leaked" },
    });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).not.toContain("tpi_testtoken");
  });

  it("surfaces a non-JSON failure body without crashing", async () => {
    stubFetch({ ok: false, status: 502, body: "<html>bad gateway</html>" });
    const client = await setupClient();

    const result = await callTool(client, {
      reviewRequestId: "rr1",
      decision: "APPROVED",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("502");
  });

  it("url-encodes the review request id", async () => {
    const fetchMock = stubFetch({ ok: true, body: decidedRow() });
    const client = await setupClient();

    await callTool(client, {
      reviewRequestId: "rr/1 2",
      decision: "APPROVED",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://testplanit.example.com/api/reviews/rr%2F1%202/decide",
    );
  });
});
