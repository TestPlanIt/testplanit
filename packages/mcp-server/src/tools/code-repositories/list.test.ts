import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TestPlanItHttpError } from "../../http.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import { registerCodeRepositoriesList } from "./list.js";

const mockZenstack = vi.mocked(zenstack);

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

const deps = { env: mockEnv };

interface RawRepoConfigRow {
  id: number;
  projectId: number;
  branch: string | null;
  pathPatterns: unknown;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  cacheStatus: string | null;
  cacheLastFetchedAt: Date | string | null;
  cacheFileCount: number | null;
  cacheTotalSize: bigint | number | null;
  cacheError: string | null;
  repository: {
    id: number;
    name: string;
    provider: string;
    status: string;
    lastTestedAt: Date | string | null;
    settings: unknown;
  };
}

function makeRawRow(
  id = 1,
  overrides: Partial<RawRepoConfigRow> = {},
): RawRepoConfigRow {
  return {
    id,
    projectId: 7,
    branch: "main",
    pathPatterns: ["**/*.spec.ts"],
    cacheEnabled: true,
    cacheTtlDays: 7,
    cacheStatus: "READY",
    cacheLastFetchedAt: "2026-05-07T00:00:00.000Z",
    cacheFileCount: 42,
    cacheTotalSize: null,
    cacheError: null,
    repository: {
      id: 200 + id,
      name: `Repo ${id}`,
      provider: "GITHUB",
      status: "ACTIVE",
      lastTestedAt: "2026-05-07T00:00:00.000Z",
      settings: { owner: "acme", repo: "tools" },
    },
    ...overrides,
  };
}

async function setupClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCodeRepositoriesList(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function getCallBody(index: number) {
  return mockZenstack.mock.calls[index]?.[2] as
    | Record<string, unknown>
    | undefined;
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })
    .structuredContent as Record<string, unknown>;
}

describe("registerCodeRepositoriesList", () => {
  beforeEach(() => {
    mockZenstack.mockReset();
  });

  it("returns mapped items with denormalized repository fields and derived url", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawRow(1, {
        repository: {
          id: 201,
          name: "tools",
          provider: "GITHUB",
          status: "ACTIVE",
          lastTestedAt: "2026-05-07T00:00:00.000Z",
          settings: {
            owner: "acme",
            repo: "tools",
            // sensitive — must be stripped
            personalAccessToken: "pat_secret_xxxx",
          },
        },
      }),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBeFalsy();
    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
    const repo = items[0].repository as Record<string, unknown>;
    expect(repo.url).toBe("https://github.com/acme/tools");
    expect(repo.settings).toEqual({ owner: "acme", repo: "tools" });
    // sensitive key MUST NOT survive
    expect((repo.settings as Record<string, unknown>).personalAccessToken).toBeUndefined();
  });

  it("never returns credentials field", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawRow(1, {
        repository: {
          id: 201,
          name: "tools",
          provider: "GITHUB",
          status: "ACTIVE",
          lastTestedAt: null,
          settings: { owner: "acme", repo: "tools" },
          // include simulates a leak attempt — even if the upstream sent it,
          // the mapper enumerates output fields explicitly so it cannot survive.
          ...{ credentials: { token: "leak" } },
        } as unknown as RawRepoConfigRow["repository"],
      }),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });
    const text = JSON.stringify(structured(result));
    expect(text).not.toMatch(/credentials/i);
  });

  it("strips settings to allow-list per provider (AZURE_DEVOPS)", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawRow(1, {
        repository: {
          id: 201,
          name: "ado",
          provider: "AZURE_DEVOPS",
          status: "ACTIVE",
          lastTestedAt: null,
          settings: {
            organizationUrl: "https://dev.azure.com/contoso",
            project: "ProjectX",
            repositoryId: "Repo123",
            // sensitive / unknown — must be stripped
            patToken: "pat_secret_xxxx",
            extraNoise: "should not appear",
          },
        },
      }),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });

    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    const repo = items[0].repository as Record<string, unknown>;
    expect(repo.settings).toEqual({
      organizationUrl: "https://dev.azure.com/contoso",
      project: "ProjectX",
      repositoryId: "Repo123",
    });
    expect(repo.url).toBe(
      "https://dev.azure.com/contoso/ProjectX/_git/Repo123",
    );
  });

  it("coerces BigInt cacheTotalSize to Number (Pitfall 6)", async () => {
    mockZenstack.mockResolvedValueOnce([
      makeRawRow(1, { cacheTotalSize: 12345n }),
    ]);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });

    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items[0].cacheTotalSize).toBe(12345);
    expect(typeof items[0].cacheTotalSize).toBe("number");
  });

  it("emits cursor pagination shape — take=limit+1, hasNextPage true when overflow", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => makeRawRow(i + 1));
    mockZenstack.mockResolvedValueOnce(rows);

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7, limit: 25 },
    });

    const data = structured(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(25);
    expect(data.hasNextPage).toBe(true);
    // last id of first 25 is the 25th row (id=25)
    expect(data.nextCursor).toBe(25);

    const body = getCallBody(0);
    expect(body?.take).toBe(26);
    expect(body?.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("clamps limit at MAX_LIMIT=100 in input schema", async () => {
    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7, limit: 101 },
    });

    expect(result.isError).toBe(true);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("NEVER calls delete or deleteMany (T-08-SOFT-DELETE invariant)", async () => {
    mockZenstack.mockResolvedValueOnce([makeRawRow(1)]);

    const { client } = await setupClient();
    await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });

    for (const call of mockZenstack.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }

    expect(mockZenstack).not.toHaveBeenCalledWith(
      "projectCodeRepositoryConfig",
      "delete",
      expect.anything(),
      expect.anything(),
    );
    expect(mockZenstack).not.toHaveBeenCalledWith(
      "projectCodeRepositoryConfig",
      "deleteMany",
      expect.anything(),
      expect.anything(),
    );
  });

  it("redacts tpi_*** tokens at the error boundary (T-08-TOKEN-REDACT)", async () => {
    mockZenstack.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "upstream failure tpi_secret_xyz123 leaked",
        { statusCode: 500 },
      ),
    );

    const { client } = await setupClient();
    const result = await client.callTool({
      name: "testplanit_code_repositories_list",
      arguments: { projectId: 7 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("tpi_secret_xyz123");
    expect(text).toContain("tpi_***");
  });
});
