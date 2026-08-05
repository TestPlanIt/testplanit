import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

vi.mock("../../http.js", async () => {
  // TestPlanItHttpError must stay the real class — errors.ts branches on
  // `instanceof`, so a stubbed constructor would silently reroute every
  // upstream failure into the generic runtime-error message.
  const actual =
    await vi.importActual<typeof import("../../http.js")>("../../http.js");
  return { ...actual, validateToken: vi.fn() };
});

import { zenstack } from "../../api.js";
import { validateToken, TestPlanItHttpError } from "../../http.js";
import { registerReviewsList } from "./list.js";

const mockZenstack = vi.mocked(zenstack);
const mockValidateToken = vi.mocked(validateToken);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};
const deps = { env: mockEnv };

const VIEWER_ID = "user-me";

interface RawRow {
  id: string;
  status: string;
  entityType: "CASE" | "RUN" | "SESSION";
  entityId: number;
  projectId: number;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
  project: { id: number; name: string } | null;
  requestedBy: { id: string; name: string | null; email: string } | null;
  assigneeUser: { id: string; name: string | null; email: string } | null;
  assigneeRole: { id: number; name: string } | null;
  decidedBy: { id: string; name: string | null; email: string } | null;
  fromState: { id: number; name: string } | null;
  toState: { id: number; name: string } | null;
}

function makeRow(id: string, overrides: Partial<RawRow> = {}): RawRow {
  return {
    id,
    status: "PENDING",
    entityType: "CASE",
    entityId: 11,
    projectId: 1,
    decisionComment: null,
    decidedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    project: { id: 1, name: "Checkout" },
    requestedBy: { id: "user-req", name: "Rita", email: "rita@example.com" },
    assigneeUser: { id: VIEWER_ID, name: "Me", email: "me@example.com" },
    assigneeRole: null,
    decidedBy: null,
    fromState: { id: 5, name: "Draft" },
    toState: { id: 6, name: "Approved" },
    ...overrides,
  };
}

/**
 * Route each mocked zenstack call by model so tests can stay order-agnostic
 * about the hydration calls (which fire only for entity types present on
 * the page).
 */
function mockCalls(opts: {
  roleIds?: number[];
  globalRoleId?: number | null;
  rows?: RawRow[];
  cases?: Array<{ id: number; name: string | null; isDeleted: boolean }>;
  runs?: Array<{ id: number; name: string | null; isDeleted: boolean }>;
  sessions?: Array<{ id: number; name: string | null; isDeleted: boolean }>;
  comments?: Array<{ reviewRequestId: string | null; content: unknown }>;
}) {
  mockZenstack.mockImplementation(((model: string) => {
    switch (model) {
      case "user":
        return Promise.resolve({
          roleId: opts.globalRoleId === undefined ? 3 : opts.globalRoleId,
          projectPermissions: (opts.roleIds ?? []).map((roleId) => ({
            roleId,
            accessType: "SPECIFIC_ROLE",
          })),
        });
      case "reviewRequest":
        return Promise.resolve(opts.rows ?? []);
      case "repositoryCases":
        return Promise.resolve(opts.cases ?? []);
      case "testRuns":
        return Promise.resolve(opts.runs ?? []);
      case "sessions":
        return Promise.resolve(opts.sessions ?? []);
      case "comment":
        return Promise.resolve(opts.comments ?? []);
      default:
        return Promise.resolve([]);
    }
  }) as unknown as typeof zenstack);
}

function callFor(model: string) {
  return mockZenstack.mock.calls.find((c) => c[0] === model);
}

function bodyFor(model: string): Record<string, unknown> | undefined {
  return callFor(model)?.[2] as Record<string, unknown> | undefined;
}

function structured(result: unknown): Record<string, any> {
  return (result as { structuredContent?: Record<string, any> })
    .structuredContent as Record<string, any>;
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerReviewsList(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function callTool(client: Client, args: Record<string, unknown> = {}) {
  return client.callTool({ name: "testplanit_reviews_list", arguments: args });
}

function stubFeatureFlag(enabled: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateToken.mockResolvedValue({
    ok: true,
    user: {
      id: VIEWER_ID,
      name: "Me",
      email: "me@example.com",
      scopes: [],
      readOnly: false,
      isAgent: true,
    },
  });
  stubFeatureFlag(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testplanit_reviews_list", () => {
  it("scopes the pending queue to the token owner and the roles they hold", async () => {
    mockCalls({ globalRoleId: 3, roleIds: [7, 9], rows: [makeRow("r1")] });
    const client = await setupClient();

    await callTool(client);

    const where = bodyFor("reviewRequest")?.where as { AND: any[] };
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { status: "PENDING" },
        { isDeleted: false },
        { project: { reviewWorkflowEnabled: true } },
        {
          OR: [
            { assigneeUserId: VIEWER_ID },
            { assigneeRoleId: { in: [3, 7, 9] } },
          ],
        },
      ]),
    );
    // Oldest-first — the most overdue review is the one to act on next.
    expect(bodyFor("reviewRequest")?.orderBy).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("drops the role branch entirely when the caller holds no roles", async () => {
    mockCalls({ globalRoleId: null, roleIds: [], rows: [] });
    const client = await setupClient();

    await callTool(client);

    const where = bodyFor("reviewRequest")?.where as { AND: any[] };
    const orClause = where.AND.find((c) => "OR" in c);
    expect(orClause.OR).toEqual([{ assigneeUserId: VIEWER_ID }]);
  });

  it("exposes no way to query another user's queue", async () => {
    const client = await setupClient();
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "testplanit_reviews_list");
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
      "view",
      "projectId",
      "entityType",
      "cursor",
      "limit",
    ]);
  });

  it("switches the decided view to the caller's own decisions, newest first", async () => {
    mockCalls({ rows: [] });
    const client = await setupClient();

    await callTool(client, { view: "decided" });

    const where = bodyFor("reviewRequest")?.where as { AND: any[] };
    expect(where.AND).toEqual([
      { decidedByUserId: VIEWER_ID },
      { status: { in: ["APPROVED", "CHANGES_REQUESTED", "REJECTED"] } },
      { isDeleted: false },
      { project: { reviewWorkflowEnabled: true } },
    ]);
    expect(bodyFor("reviewRequest")?.orderBy).toEqual([
      { decidedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("narrows by projectId and entityType", async () => {
    mockCalls({ rows: [] });
    const client = await setupClient();

    await callTool(client, { projectId: 4, entityType: "RUN" });

    const where = bodyFor("reviewRequest")?.where as { AND: any[] };
    expect(where.AND).toEqual(
      expect.arrayContaining([{ projectId: 4 }, { entityType: "RUN" }]),
    );
  });

  it("returns an empty queue without querying when the feature is off system-wide", async () => {
    stubFeatureFlag(false);
    mockCalls({ rows: [makeRow("r1")] });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result)).toMatchObject({
      items: [],
      hasNextPage: false,
      nextCursor: null,
      reviewFeatureEnabled: false,
    });
    expect(mockZenstack).not.toHaveBeenCalled();
    expect(mockValidateToken).not.toHaveBeenCalled();
  });

  it("treats an unreachable feature-flag endpoint as enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    mockCalls({ rows: [makeRow("r1")], cases: [] });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result).reviewFeatureEnabled).toBe(true);
    expect(structured(result).items).toHaveLength(1);
  });

  it("resolves entity names per type and surfaces deleted subjects", async () => {
    mockCalls({
      rows: [
        makeRow("r1", { entityType: "CASE", entityId: 11 }),
        makeRow("r2", { entityType: "RUN", entityId: 22 }),
        makeRow("r3", { entityType: "CASE", entityId: 12 }),
      ],
      cases: [
        { id: 11, name: "Login works", isDeleted: false },
        { id: 12, name: "Deleted case", isDeleted: true },
      ],
      runs: [{ id: 22, name: "Regression 3.1", isDeleted: false }],
    });
    const client = await setupClient();

    const result = await callTool(client);
    const items = structured(result).items;

    expect(items.map((i: any) => [i.entityName, i.entityDeleted])).toEqual([
      ["Login works", false],
      ["Regression 3.1", false],
      ["Deleted case", true],
    ]);
    // One call per entity type present — never one per row, and SESSION is
    // not queried at all here.
    expect(bodyFor("repositoryCases")?.where).toEqual({ id: { in: [11, 12] } });
    expect(bodyFor("testRuns")?.where).toEqual({ id: { in: [22] } });
    expect(callFor("sessions")).toBeUndefined();
  });

  it("leaves entityName null when the subject is not readable", async () => {
    mockCalls({ rows: [makeRow("r1", { entityId: 99 })], cases: [] });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result).items[0]).toMatchObject({
      entityId: 99,
      entityName: null,
      entityDeleted: false,
    });
  });

  it("extracts the requester's submit-time prose as plain text", async () => {
    mockCalls({
      rows: [makeRow("r1")],
      cases: [{ id: 11, name: "Login works", isDeleted: false }],
      comments: [
        {
          reviewRequestId: "r1",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Please check the edge case." }],
              },
            ],
          },
        },
      ],
    });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result).items[0].requestNote).toBe(
      "Please check the edge case.",
    );
    expect(bodyFor("comment")?.where).toMatchObject({
      reviewRequestId: { in: ["r1"] },
      type: "REVIEW_REQUEST",
      isDeleted: false,
    });
  });

  it("flattens the transition, requester, and role-based assignment", async () => {
    mockCalls({
      rows: [
        makeRow("r1", {
          assigneeUser: null,
          assigneeRole: { id: 7, name: "QA Lead" },
        }),
      ],
      cases: [{ id: 11, name: "Login works", isDeleted: false }],
    });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result).items[0]).toMatchObject({
      id: "r1",
      status: "PENDING",
      project: { id: 1, name: "Checkout" },
      requestedBy: { id: "user-req", name: "Rita" },
      assignedTo: { via: "ROLE", roleId: 7, name: "QA Lead", userId: null },
      transition: {
        from: { id: 5, name: "Draft" },
        to: { id: 6, name: "Approved" },
      },
      requestedAt: "2026-01-01T00:00:00.000Z",
      decision: null,
    });
  });

  it("carries the decision block on decided rows", async () => {
    mockCalls({
      rows: [
        makeRow("r1", {
          status: "CHANGES_REQUESTED",
          decisionComment: "Needs a negative case",
          decidedAt: "2026-02-02T00:00:00.000Z",
          decidedBy: { id: VIEWER_ID, name: "Me", email: "me@example.com" },
        }),
      ],
      cases: [{ id: 11, name: "Login works", isDeleted: false }],
    });
    const client = await setupClient();

    const result = await callTool(client, { view: "decided" });

    expect(structured(result).items[0].decision).toEqual({
      status: "CHANGES_REQUESTED",
      comment: "Needs a negative case",
      decidedBy: { id: VIEWER_ID, name: "Me", email: "me@example.com" },
      decidedAt: "2026-02-02T00:00:00.000Z",
    });
  });

  it("paginates with a cuid cursor", async () => {
    mockCalls({
      rows: [makeRow("r1"), makeRow("r2"), makeRow("r3")],
      cases: [{ id: 11, name: "Login works", isDeleted: false }],
    });
    const client = await setupClient();

    const result = await callTool(client, { limit: 2, cursor: "r0" });

    expect(bodyFor("reviewRequest")).toMatchObject({
      take: 3,
      cursor: { id: "r0" },
      skip: 1,
    });
    expect(structured(result)).toMatchObject({
      hasNextPage: true,
      nextCursor: "r2",
    });
    expect(structured(result).items).toHaveLength(2);
  });

  it("reports nextCursor null on the last page", async () => {
    mockCalls({
      rows: [makeRow("r1")],
      cases: [{ id: 11, name: "Login works", isDeleted: false }],
    });
    const client = await setupClient();

    const result = await callTool(client);

    expect(structured(result)).toMatchObject({
      hasNextPage: false,
      nextCursor: null,
    });
  });

  it("surfaces a token failure through the friendly error mapping", async () => {
    mockValidateToken.mockResolvedValue({
      ok: false,
      message: "HTTP 401: token tpi_test... rejected",
      code: "EXPIRED_TOKEN",
      statusCode: 401,
    });
    mockCalls({ rows: [] });
    const client = await setupClient();

    const result = (await callTool(client)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("EXPIRED_TOKEN");
    expect(result.content[0]?.text).not.toContain("tpi_testtoken");
  });

  it("maps an upstream query failure to a tool error", async () => {
    mockZenstack.mockRejectedValue(
      new TestPlanItHttpError("HTTP 403 from /api/model/reviewRequest/findMany", {
        statusCode: 403,
      }),
    );
    const client = await setupClient();

    const result = (await callTool(client)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("HTTP 403");
  });
});
