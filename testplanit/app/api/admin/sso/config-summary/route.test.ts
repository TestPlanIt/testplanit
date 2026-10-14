import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/utils/encryption";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ getServerAuthSession: mocks.session }));
vi.mock("~/lib/db", () => ({
  baseDb: { ssoProvider: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

describe("GET /api/admin/sso/config-summary", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { access: "ADMIN" } });
  });

  it("returns each provider's identifiers and which secrets are set, never the secrets", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "g",
        type: "GOOGLE",
        config: {
          encrypted: await encrypt(
            JSON.stringify({ clientId: "gid", clientSecret: "gsecret" })
          ),
        },
      },
      {
        id: "a",
        type: "APPLE",
        config: { clientId: "aid", teamId: "t", keyId: "k", privateKey: "pem" },
      },
      { id: "m", type: "MAGIC_LINK", config: null },
    ]);
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({
      providers: {
        g: { clientId: "gid", hasClientSecret: true, hasPrivateKey: false },
        a: {
          clientId: "aid",
          teamId: "t",
          keyId: "k",
          hasClientSecret: false,
          hasPrivateKey: true,
        },
        m: { hasClientSecret: false, hasPrivateKey: false },
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/gsecret|pem/);
    expect(mocks.findMany).toHaveBeenCalledWith({
      select: { id: true, type: true, config: true },
    });
  });

  it("refuses anyone but an admin", async () => {
    mocks.session.mockResolvedValue({ user: { access: "USER" } });
    expect((await GET()).status).toBe(401);
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
