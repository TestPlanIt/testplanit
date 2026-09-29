import { beforeEach, describe, expect, it, vi } from "vitest";

const { txCreate, findUnique } = vi.hoisted(() => ({
  txCreate: vi.fn(async ({ data }: { data: unknown }) => ({
    id: 1,
    ...(data as object),
  })),
  findUnique: vi.fn(async () => ({ projectId: 7 })),
}));

vi.mock("./access-manifest", () => ({
  getAccessManifest: vi.fn(async () => ({})),
  hasWriteAccess: vi.fn(() => true),
  invalidateAccessManifest: vi.fn(),
}));

vi.mock("./db", () => ({
  baseDb: {
    repositoryCases: { findUnique },
    steps: { create: vi.fn() },
    sessions: { create: vi.fn() },
  },
}));

vi.mock("./rawDb", () => ({
  rawDb: {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        $executeRaw: vi.fn(),
        steps: { create: txCreate },
        sessions: { create: txCreate },
      }),
  },
}));

vi.mock("./audit/gucContext", () => ({
  buildGucPayload: vi.fn(() => ({})),
}));

import { tryFastPathCreate } from "./access-fast-path";

const writtenData = () =>
  (txCreate.mock.calls[0]?.[0] as { data: Record<string, any> }).data;

describe("tryFastPathCreate rich-text normalization", () => {
  beforeEach(() => {
    txCreate.mockClear();
  });

  // The MCP server sends step text as written (#658); this path writes
  // through a client with no plugins, so it must convert it itself.
  it("converts Markdown step text written through a testCase connect", async () => {
    const res = await tryFastPathCreate({
      parsedPath: { model: "steps", operation: "create" },
      requestBody: {
        data: {
          testCase: { connect: { id: 3 } },
          order: 0,
          step: "Open the **New leads** board",
          expectedResult: null,
        },
      },
      userId: "user-1",
    });

    expect(res?.status).toBe(201);
    const data = writtenData();
    expect(data.step.type).toBe("doc");
    const bold = data.step.content[0].content.find(
      (n: any) => n.text === "New leads"
    );
    expect(bold.marks).toEqual([{ type: "bold" }]);
    expect(data.expectedResult).toBeNull();
  });

  it("parses a document the web UI serialized", async () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    };
    await tryFastPathCreate({
      parsedPath: { model: "sessions", operation: "create" },
      requestBody: {
        data: { project: { connect: { id: 7 } }, mission: JSON.stringify(doc) },
      },
      userId: "user-1",
    });

    expect(writtenData().mission).toEqual(doc);
  });
});
