import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  load: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ baseDb: { tag: "db" } }));
vi.mock("@/lib/llm/credentials", () => ({ loadLlmCredentials: mocks.load }));

import { GET } from "./route";

const call = (id: string) =>
  GET({} as never, { params: Promise.resolve({ id }) });

describe("GET /api/admin/llm/integrations/[id]/credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { access: "ADMIN" } });
  });

  it("returns the endpoint and whether a key is set, never the key", async () => {
    mocks.load.mockResolvedValue({
      apiKey: "sk-secret",
      baseUrl: "https://e/v1",
    });
    const response = await call("4");
    const body = await response.json();
    expect(body).toEqual({ endpoint: "https://e/v1", hasApiKey: true });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(mocks.load).toHaveBeenCalledWith({ tag: "db" }, 4);
  });

  it("answers no key and no endpoint for an integration without them", async () => {
    mocks.load.mockResolvedValue({});
    expect(await (await call("4")).json()).toEqual({
      endpoint: null,
      hasApiKey: false,
    });
  });

  it("refuses non-admins and anonymous callers, and 404s an unknown id", async () => {
    mocks.session.mockResolvedValueOnce({ user: { access: "USER" } });
    expect((await call("4")).status).toBe(403);
    mocks.session.mockResolvedValueOnce(null);
    expect((await call("4")).status).toBe(401);
    mocks.load.mockResolvedValue(null);
    expect((await call("4")).status).toBe(404);
    expect((await call("abc")).status).toBe(404);
  });
});
