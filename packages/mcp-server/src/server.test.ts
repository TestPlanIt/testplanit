import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Mock ../http.js BEFORE importing createServer so the whoami tool's
// validateToken call resolves to fakeUser without hitting the network.
vi.mock("./http.js", () => {
  class TestPlanItHttpError extends Error {
    statusCode?: number;
    code?: string;
    constructor(
      message: string,
      opts?: { statusCode?: number; code?: string },
    ) {
      super(message);
      this.name = "TestPlanItHttpError";
      this.statusCode = opts?.statusCode;
      this.code = opts?.code;
    }
  }
  return {
    validateToken: vi.fn(),
    redactToken: (t: string) => t.slice(0, 8) + "...",
    TestPlanItHttpError,
  };
});

import { createServer } from "./server.js";
import { validateToken } from "./http.js";
import type { WhoamiUser } from "./http.js";

const mockValidateToken = vi.mocked(validateToken);

const fakeUser: WhoamiUser = {
  id: "u_1",
  name: "Alice",
  email: "a@example.com",
  scopes: ["mode:read"],
  readOnly: true,
  isAgent: false,
};

describe("createServer", () => {
  beforeEach(() => {
    mockValidateToken.mockReset();
  });

  it("completes initialization handshake and announces tools", async () => {
    const server = createServer({
      env: { apiUrl: "https://example.invalid", apiToken: "tpi_fake" },
      user: fakeUser,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.map((t) => t.name)).toContain("whoami");
    await client.close();
    await server.close();
  });

  it("registers the production whoami tool callable end-to-end", async () => {
    mockValidateToken.mockResolvedValueOnce({ ok: true, user: fakeUser });
    const server = createServer({
      env: { apiUrl: "https://example.invalid", apiToken: "tpi_fake" },
      user: fakeUser,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const result = await client.callTool({
      name: "whoami",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as { email?: string } | undefined)?.email,
    ).toBe("a@example.com");
    expect(
      (result.structuredContent as { readOnly?: boolean } | undefined)
        ?.readOnly,
    ).toBe(true);
    await client.close();
    await server.close();
  });
});
