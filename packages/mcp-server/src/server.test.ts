import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import type { WhoamiUser } from "./http.js";

const fakeUser: WhoamiUser = {
  id: "u_1",
  name: "Alice",
  email: "a@example.com",
  scopes: ["mode:read"],
  readOnly: true,
  isAgent: false,
};

describe("createServer", () => {
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
    await client.close();
    await server.close();
  });

  it("registers the smoke __server_info tool callable end-to-end", async () => {
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
      name: "__server_info",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as { packageName?: string } | undefined)
        ?.packageName,
    ).toBe("@testplanit/mcp-server");
    expect(
      (result.structuredContent as { userEmail?: string } | undefined)
        ?.userEmail,
    ).toBe("a@example.com");
    await client.close();
    await server.close();
  });
});
