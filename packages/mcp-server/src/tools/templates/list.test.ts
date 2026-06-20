import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import * as apiModule from "../../api.js";
import { registerTemplatesList } from "./list.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env: EnvConfig = {
  apiUrl: "https://host.example.com",
  apiToken: "tpi_testtoken",
};

async function callTool(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTemplatesList(server, { env });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({
    name: "testplanit_templates_list",
    arguments: args,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_templates_list", () => {
  it("returns each template with its case fields (displayName, systemName, type, required)", async () => {
    zenstackMock.mockResolvedValueOnce([
      {
        id: 1,
        templateName: "Default",
        isDefault: true,
        caseFields: [
          {
            order: 0,
            caseField: {
              displayName: "Priority",
              systemName: "priority",
              isRequired: true,
              type: { type: "Dropdown" },
            },
          },
          {
            order: 1,
            caseField: {
              displayName: "Notes",
              systemName: "notes",
              isRequired: false,
              type: { type: "Text Long" },
            },
          },
        ],
      },
      {
        id: 2,
        templateName: "Exploratory",
        isDefault: false,
        caseFields: [],
      },
    ]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      templates: [
        {
          id: 1,
          templateName: "Default",
          isDefault: true,
          fields: [
            {
              displayName: "Priority",
              systemName: "priority",
              type: "Dropdown",
              required: true,
            },
            {
              displayName: "Notes",
              systemName: "notes",
              type: "Text Long",
              required: false,
            },
          ],
        },
        {
          id: 2,
          templateName: "Exploratory",
          isDefault: false,
          fields: [],
        },
      ],
    });
  });

  it("scopes the query to enabled, non-deleted, project-assigned templates", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    await callTool({ projectId: 42 });

    expect(zenstackMock).toHaveBeenCalledTimes(1);
    const [model, op, body] = zenstackMock.mock.calls[0];
    expect(model).toBe("templates");
    expect(op).toBe("findMany");
    expect((body as { where: Record<string, unknown> }).where).toMatchObject({
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: 42 } },
    });
  });

  it("returns an empty templates array when the project has none", async () => {
    zenstackMock.mockResolvedValueOnce([]);

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ templates: [] });
  });

  it("tolerates a null field type (maps to null)", async () => {
    zenstackMock.mockResolvedValueOnce([
      {
        id: 3,
        templateName: "Weird",
        isDefault: false,
        caseFields: [
          {
            order: 0,
            caseField: {
              displayName: "Mystery",
              systemName: "mystery",
              isRequired: false,
              type: null,
            },
          },
        ],
      },
    ]);

    const result = await callTool({ projectId: 7 });
    const sc = result.structuredContent as {
      templates: Array<{ fields: Array<{ type: string | null }> }>;
    };
    expect(sc.templates[0].fields[0].type).toBeNull();
  });

  it("surfaces an upstream error through the tool-result error envelope", async () => {
    zenstackMock.mockRejectedValueOnce(
      new TestPlanItHttpError("HTTP 403 from /api/model/templates/findMany", {
        statusCode: 403,
      }),
    );

    const result = await callTool({ projectId: 7 });

    expect(result.isError).toBe(true);
  });
});
