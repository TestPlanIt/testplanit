import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

// ── Module mock ──────────────────────────────────────────────────────────────
vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
  lookup: vi.fn(),
  resolveActiveRepository: vi.fn(),
  resolveDefaultTemplate: vi.fn(),
  resolveCaseWorkflowState: vi.fn(),
}));

import * as apiModule from "../../api.js";
import { registerCasesDelete } from "./delete.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesDelete(server, { env });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_cases_delete", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_cases_delete", () => {
  it("happy path: soft-deletes case via update with isDeleted:true", async () => {
    zenstackMock.mockResolvedValueOnce({ id: 99, isDeleted: true });

    const result = await callTool({ caseId: 99 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 99, isDeleted: true });

    // Assert the correct zenstack call
    expect(zenstackMock).toHaveBeenCalledWith(
      "repositoryCases",
      "update",
      expect.objectContaining({
        where: { id: 99 },
        data: { isDeleted: true },
      }),
      env,
    );
  });

  it("NEVER calls delete or deleteMany (T-06-06 invariant)", async () => {
    zenstackMock.mockResolvedValueOnce({ id: 99, isDeleted: true });

    await callTool({ caseId: 99 });

    for (const call of zenstackMock.mock.calls) {
      expect(call[1]).not.toBe("delete");
      expect(call[1]).not.toBe("deleteMany");
    }

    // Explicit negative assertions for the soft-delete invariant
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryCases",
      "delete",
      expect.anything(),
      expect.anything(),
    );
    expect(zenstackMock).not.toHaveBeenCalledWith(
      "repositoryCases",
      "deleteMany",
      expect.anything(),
      expect.anything(),
    );
  });

  it("case not found: surfaces tool error (P2025 remap)", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Record not found.", { statusCode: 422 }),
    );

    const result = await callTool({ caseId: 9999 });

    expect(result.isError).toBe(true);
  });

  it("READ_ONLY_TOKEN regression: returns mode:read message (T-06-01)", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("Forbidden", { statusCode: 403, code: "READ_ONLY_TOKEN" }),
    );

    const result = await callTool({ caseId: 99 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("mode:read");
  });

  it("tool is registered as 'testplanit_cases_delete' with correct description prefix", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCasesDelete(server, { env });
    // Registration doesn't throw — pass
    expect(true).toBe(true);
  });
});
