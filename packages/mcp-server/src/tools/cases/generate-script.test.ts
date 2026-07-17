import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  generateQuickScript: vi.fn(),
}));

import * as apiModule from "../../api.js";
import { registerCasesGenerateScript } from "./generate-script.js";

const generateQuickScriptMock = vi.mocked(apiModule.generateQuickScript);

const env: EnvConfig = {
  apiUrl: "https://host.example.com",
  apiToken: "tpi_testtoken",
};

const RESULT = {
  projectId: 7,
  templateId: 3,
  templateName: "Playwright",
  framework: "Playwright",
  language: "TypeScript",
  fileExtension: ".spec.ts",
  outputMode: "combined" as const,
  hasCodeContext: true,
  results: [
    {
      code: "test('login', async () => {});",
      generatedBy: "ai" as const,
      caseId: 456,
      caseName: "Login",
      contextFiles: ["pages/login.ts"],
    },
  ],
};

async function callTool(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCasesGenerateScript(server, { env });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({
    name: "testplanit_cases_generate_script",
    arguments: args,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  generateQuickScriptMock.mockResolvedValue(RESULT);
});

describe("testplanit_cases_generate_script", () => {
  it("happy path: returns generated files as structured content", async () => {
    const result = await callTool({ projectId: 7, caseIds: [456] });

    expect(result.isError).toBeFalsy();
    expect(generateQuickScriptMock).toHaveBeenCalledWith(
      { projectId: 7, caseIds: [456] },
      env
    );
    expect(result.structuredContent).toEqual(RESULT);
  });

  it("forwards templateId and outputMode when provided", async () => {
    await callTool({
      projectId: 7,
      caseIds: [456, 457],
      templateId: 3,
      outputMode: "perCase",
    });

    expect(generateQuickScriptMock).toHaveBeenCalledWith(
      {
        projectId: 7,
        caseIds: [456, 457],
        templateId: 3,
        outputMode: "perCase",
      },
      env
    );
  });

  it("maps a host error (feature disabled) to a tool error result", async () => {
    generateQuickScriptMock.mockRejectedValueOnce(
      new TestPlanItHttpError(
        "HTTP 403 from /api/export/quickscript: QuickScript is not enabled for this project",
        { statusCode: 403 }
      )
    );

    const result = await callTool({ projectId: 7, caseIds: [456] });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("QuickScript is not enabled");
  });

  it("rejects an empty caseIds array via the input schema", async () => {
    const result = await callTool({ projectId: 7, caseIds: [] });
    expect(result.isError).toBe(true);
    expect(generateQuickScriptMock).not.toHaveBeenCalled();
  });
});
