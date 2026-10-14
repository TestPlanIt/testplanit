import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  load: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ baseDb: { tag: "db" } }));
vi.mock("@/lib/llm/credentials", () => ({ loadLlmCredentials: mocks.load }));
vi.mock("./pricing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pricing")>()),
  fetchLiteLlmPricing: vi.fn().mockResolvedValue({}),
}));

import { POST } from "./route";

const post = (body: Record<string, unknown>) =>
  POST({ json: async () => body } as never);

describe("POST /api/admin/llm/available-models", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { access: "ADMIN" } });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "claude-x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sentKey = () =>
    (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;

  it("lists models with the stored key when an edit leaves the key blank", async () => {
    mocks.load.mockResolvedValue({ apiKey: "sk-stored" });
    const response = await post({
      provider: "ANTHROPIC",
      apiKey: "",
      llmIntegrationId: 5,
    });
    expect(mocks.load).toHaveBeenCalledWith({ tag: "db" }, 5);
    expect(response.status).toBe(200);
    expect(JSON.stringify(sentKey())).toContain("sk-stored");
  });

  it("uses a typed key over the stored one, without reading it", async () => {
    await post({
      provider: "ANTHROPIC",
      apiKey: "sk-typed",
      llmIntegrationId: 5,
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(JSON.stringify(sentKey())).toContain("sk-typed");
  });
});
