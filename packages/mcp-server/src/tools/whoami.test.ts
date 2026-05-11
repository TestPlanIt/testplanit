import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock ../http.js BEFORE importing the SUT so registerWhoami captures the
// mocked validateToken and TestPlanItHttpError class.
vi.mock("../http.js", () => {
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

import { validateToken } from "../http.js";
import { registerWhoami } from "./whoami.js";
import { registerAll } from "./index.js";

const mockValidateToken = vi.mocked(validateToken);

const fakeUser = {
  id: "u_1",
  name: "Alice",
  email: "a@example.com",
  scopes: ["mode:read"],
  readOnly: true,
  isAgent: false,
};

const fakeEnv = { apiUrl: "https://example.invalid", apiToken: "tpi_fake" };

async function setupServerAndClient(
  register: (server: McpServer) => void,
): Promise<{ client: Client; server: McpServer; cleanup: () => Promise<void> }> {
  const server = new McpServer({
    name: "@testplanit/mcp-server",
    version: "0.0.0",
  });
  register(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    server,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("registerWhoami", () => {
  beforeEach(() => {
    mockValidateToken.mockReset();
  });

  it("returns structured content matching WhoamiUser on a 200 response", async () => {
    mockValidateToken.mockResolvedValueOnce({ ok: true, user: fakeUser });
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as typeof fakeUser | undefined;
      expect(sc?.id).toBe("u_1");
      expect(sc?.email).toBe("a@example.com");
      expect(sc?.readOnly).toBe(true);
      expect(sc?.isAgent).toBe(false);
      expect(sc?.scopes).toEqual(["mode:read"]);
    } finally {
      await cleanup();
    }
  });

  it("re-fetches validateToken on every call (no caching)", async () => {
    mockValidateToken.mockResolvedValue({ ok: true, user: fakeUser });
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      await client.callTool({ name: "whoami", arguments: {} });
      await client.callTool({ name: "whoami", arguments: {} });
      await client.callTool({ name: "whoami", arguments: {} });
      expect(mockValidateToken).toHaveBeenCalledTimes(3);
    } finally {
      await cleanup();
    }
  });

  it("translates ok:false with code=READ_ONLY_TOKEN into a tool error naming mode:read", async () => {
    mockValidateToken.mockResolvedValueOnce({
      ok: false,
      message: "HTTP 403 (READ_ONLY_TOKEN): token tpi_fake... rejected",
      code: "READ_ONLY_TOKEN",
      statusCode: 403,
    });
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe("text");
      expect(content[0].text).toContain("mode:read");
      expect(content[0].text).toContain("READ_ONLY_TOKEN");
    } finally {
      await cleanup();
    }
  });

  it("translates ok:false with code=INVALID_TOKEN into the friendly INVALID_TOKEN message", async () => {
    mockValidateToken.mockResolvedValueOnce({
      ok: false,
      message: "HTTP 401 (INVALID_TOKEN): token tpi_fake... rejected",
      code: "INVALID_TOKEN",
      statusCode: 401,
    });
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("INVALID_TOKEN");
      expect(content[0].text.toLowerCase()).toContain("not recognized");
    } finally {
      await cleanup();
    }
  });

  it("falls through to the generic error path when ok:false has no code (transport failure)", async () => {
    mockValidateToken.mockResolvedValueOnce({
      ok: false,
      message: "Network error contacting https://example.invalid",
    });
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      // Generic Request-failed branch (no friendly template, no known code).
      expect(content[0].text.toLowerCase()).toMatch(/request failed|network/);
      expect(content[0].text).toContain("Network error contacting");
    } finally {
      await cleanup();
    }
  });

  it("returns isError when validateToken throws (network failure surfaced as exception)", async () => {
    mockValidateToken.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text.toLowerCase()).toMatch(/network|runtime/);
      expect(content[0].text).toContain("ECONNREFUSED");
    } finally {
      await cleanup();
    }
  });

  it("registers the whoami tool with description starting with 'Debug:'", async () => {
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerWhoami(s, { env: fakeEnv }),
    );
    try {
      const tools = await client.listTools();
      const whoami = tools.tools.find((t) => t.name === "whoami");
      expect(whoami).toBeDefined();
      expect(whoami?.description).toMatch(/^Debug:/);
    } finally {
      await cleanup();
    }
  });
});

describe("registerAll", () => {
  beforeEach(() => {
    mockValidateToken.mockReset();
  });

  it("registers whoami via the central registry", async () => {
    const { client, cleanup } = await setupServerAndClient((s) =>
      registerAll(s, { env: fakeEnv }),
    );
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("whoami");
      const whoami = tools.tools.find((t) => t.name === "whoami");
      expect(whoami?.description).toMatch(/^Debug:/);
    } finally {
      await cleanup();
    }
  });
});
