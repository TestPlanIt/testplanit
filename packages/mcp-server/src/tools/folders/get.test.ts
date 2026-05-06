import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

vi.mock("../cases/shared.js", () => ({
  buildFolderBreadcrumb: vi.fn(),
  extractProseMirrorText: vi.fn((v: unknown) => String(v ?? "")),
  denormalizeCustomFields: vi.fn(() => ({})),
  fullPathFromBreadcrumb: vi.fn((bc: Array<{ name: string }>) => bc.map((b) => b.name).join(" / ")),
  mapCaseRow: vi.fn(),
  mapCaseDetail: vi.fn(),
}));

import * as apiModule from "../../api.js";
import * as casesSharedModule from "../cases/shared.js";
import { registerFoldersGet } from "./get.js";

const zenstackMock = vi.mocked(apiModule.zenstack);
const buildFolderBreadcrumbMock = vi.mocked(casesSharedModule.buildFolderBreadcrumb);

const env: EnvConfig = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function makeRawFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "Auth",
    parentId: 5,
    children: [{ id: 50, name: "SubAuth", _count: { cases: 3 } }],
    cases: [
      { id: 100, name: "Login test", source: "MANUAL" },
      { id: 101, name: "Logout test", source: "MANUAL" },
    ],
    _count: { cases: 2 },
    ...overrides,
  };
}

function makeClientServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerFoldersGet(server, { env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client, clientTransport, serverTransport };
}

async function callTool(args: Record<string, unknown>) {
  const { server, client, clientTransport, serverTransport } = makeClientServer();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "testplanit_folders_get", arguments: args });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testplanit_folders_get", () => {
  it("happy path with breadcrumb: returns breadcrumb, fullPath, children, cases summary, _count.cases", async () => {
    const raw = makeRawFolder();
    zenstackMock.mockResolvedValueOnce(raw);
    buildFolderBreadcrumbMock.mockResolvedValueOnce([
      { id: 5, name: "Root" },
      { id: 42, name: "Auth" },
    ]);

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBeFalsy();
    const detail = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(detail).toMatchObject({
      id: 42,
      name: "Auth",
      parentId: 5,
      caseCount: 2,
    });
    expect((detail as { breadcrumb: unknown[] }).breadcrumb).toHaveLength(2);
    expect((detail as { fullPath: string }).fullPath).toBe("Root / Auth");
    expect((detail as { children: unknown[] }).children).toHaveLength(1);
    expect((detail as { cases: unknown[] }).cases).toHaveLength(2);
  });

  it("root folder, no parent walk: parentId===null, breadcrumb is just itself", async () => {
    const raw = makeRawFolder({ parentId: null });
    zenstackMock.mockResolvedValueOnce(raw);
    buildFolderBreadcrumbMock.mockResolvedValueOnce([{ id: 42, name: "Auth" }]);

    const result = await callTool({ folderId: 42 });

    expect(result.isError).toBeFalsy();
    const detail = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
    // buildFolderBreadcrumb was called once (for fetchFolderDetail)
    expect(buildFolderBreadcrumbMock).toHaveBeenCalledTimes(1);
    expect((detail as { breadcrumb: Array<{ id: number }> }).breadcrumb).toHaveLength(1);
    expect((detail as { fullPath: string }).fullPath).toBe("Auth");
  });

  it("cases summary capped at 100: assert take: 100 in cases include", async () => {
    const raw = makeRawFolder();
    zenstackMock.mockResolvedValueOnce(raw);
    buildFolderBreadcrumbMock.mockResolvedValueOnce([{ id: 42, name: "Auth" }]);

    await callTool({ folderId: 42 });

    const body = zenstackMock.mock.calls[0]![2] as Record<string, unknown>;
    const include = body["include"] as Record<string, unknown>;
    const casesInclude = include["cases"] as Record<string, unknown>;
    expect(casesInclude["take"]).toBe(100);
  });

  it("folder not found: returns tool error", async () => {
    zenstackMock.mockResolvedValueOnce(null);

    const result = await callTool({ folderId: 9999 });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("9999");
  });

  it("tool registration: description starts with 'Fetch a single folder'", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerFoldersGet(server, { env })).not.toThrow();
  });
});
