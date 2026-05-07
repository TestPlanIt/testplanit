import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { registerMilestones, type MilestonesDeps } from "./index.js";

const mockEnv = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

describe("registerMilestones barrel", () => {
  it("registers exactly three tools — milestones_list, milestones_get, milestone_types_list", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerMilestones(server, { env: mockEnv });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("testplanit_milestones_list");
    expect(names).toContain("testplanit_milestones_get");
    expect(names).toContain("testplanit_milestone_types_list");
    // Exactly three milestones tools — no accidental sibling registrations.
    const milestoneToolCount = names.filter((n) =>
      n.startsWith("testplanit_milestone"),
    ).length;
    expect(milestoneToolCount).toBe(3);
  });

  it("MilestonesDeps shape resolves to {env: EnvConfig} and accepts the standard deps object", () => {
    // Compile-time assertion via assignment; if the intersection drifts the
    // build fails before vitest runs.
    const deps: MilestonesDeps = { env: mockEnv };
    expect(deps.env.apiUrl).toBe("https://testplanit.example.com");
    expect(deps.env.apiToken).toBe("tpi_testtoken");
  });
});
