import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("~/lib/prisma", () => ({
  prisma: {
    scimToken: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn(async (s: string) => `enc(${s})`),
  decrypt: vi.fn(async (s: string) =>
    s.replace(/^enc\((.*)\)$/, "$1")
  ),
}));

import { prisma } from "~/lib/prisma";
import { encrypt, decrypt } from "~/utils/encryption";
import {
  decryptScimSecret,
  getScimTokenById,
  listScimTokens,
  mintScimToken,
  revokeScimToken,
} from "./tokens";
import { SCIM_SYSTEM_USER_ID, SCIM_TOKEN_PREFIX } from "./constants";

describe("SCIM tokens service", () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-scim-token-hashing";
  });

  afterAll(() => {
    if (originalSecret) {
      process.env.NEXTAUTH_SECRET = originalSecret;
    } else {
      delete process.env.NEXTAUTH_SECRET;
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("mintScimToken", () => {
    it("generates a plaintext that starts with the tps_ prefix and writes the encrypted secret + hashed token", async () => {
      const fakeRow = { id: "tk_1" } as any;
      vi.mocked(prisma.scimToken.create).mockResolvedValue(fakeRow);

      const result = await mintScimToken({
        name: "Okta production",
        idpName: "OKTA",
        expiresAt: null,
        createdById: "user_admin_1",
      });

      // Show-once invariant: plaintext returned to caller starts with tps_
      expect(result.plaintext.startsWith(SCIM_TOKEN_PREFIX)).toBe(true);
      expect(result.plaintext.length).toBeGreaterThan(12);
      expect(result.token).toBe(fakeRow);

      // encrypt() was called with the plaintext
      expect(encrypt).toHaveBeenCalledWith(result.plaintext);

      // create() was called with the right shape
      expect(prisma.scimToken.create).toHaveBeenCalledTimes(1);
      const args = vi.mocked(prisma.scimToken.create).mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data.name).toBe("Okta production");
      expect(args.data.idpName).toBe("OKTA");
      expect(args.data.systemUserId).toBe(SCIM_SYSTEM_USER_ID);
      expect(args.data.createdById).toBe("user_admin_1");
      expect(args.data.expiresAt).toBeNull();
      expect(args.data.isActive).toBe(true);
      // secret is the encrypted plaintext, not the plaintext itself
      expect(args.data.secret).toBe(`enc(${result.plaintext})`);
      expect(args.data.secret).not.toBe(result.plaintext);
      // tokenPrefix is the first 12 chars of plaintext
      expect(args.data.tokenPrefix).toBe(result.plaintext.substring(0, 12));
      expect((args.data.tokenPrefix as string).length).toBe(12);
      // token column is the SHA-256 HMAC of plaintext — definitely not the plaintext
      expect(args.data.token).not.toBe(result.plaintext);
      expect(typeof args.data.token).toBe("string");
      expect((args.data.token as string).length).toBe(64); // sha256 hex
    });

    it("passes through expiresAt when set", async () => {
      vi.mocked(prisma.scimToken.create).mockResolvedValue({ id: "tk_2" } as any);
      const expiresAt = new Date("2027-01-01T00:00:00Z");

      await mintScimToken({
        name: "Entra 90-day",
        idpName: "ENTRA",
        expiresAt,
        createdById: "user_admin_2",
      });

      const args = vi.mocked(prisma.scimToken.create).mock.calls[0][0] as {
        data: { expiresAt: Date | null };
      };
      expect(args.data.expiresAt).toBe(expiresAt);
    });

    it("generates a fresh plaintext on each call", async () => {
      vi.mocked(prisma.scimToken.create).mockResolvedValue({ id: "tk_x" } as any);

      const a = await mintScimToken({
        name: "a",
        idpName: "OKTA",
        expiresAt: null,
        createdById: "u",
      });
      const b = await mintScimToken({
        name: "b",
        idpName: "OKTA",
        expiresAt: null,
        createdById: "u",
      });

      expect(a.plaintext).not.toBe(b.plaintext);
    });
  });

  describe("revokeScimToken", () => {
    it("sets isActive: false, revokedAt: Date, revokedById", async () => {
      const fakeRow = { id: "tk_1", isActive: false } as any;
      vi.mocked(prisma.scimToken.update).mockResolvedValue(fakeRow);

      const result = await revokeScimToken("tk_1", "user_admin_1");
      expect(result).toBe(fakeRow);

      expect(prisma.scimToken.update).toHaveBeenCalledTimes(1);
      const args = vi.mocked(prisma.scimToken.update).mock.calls[0][0] as {
        where: { id: string };
        data: { isActive: boolean; revokedAt: Date; revokedById: string };
      };
      expect(args.where).toEqual({ id: "tk_1" });
      expect(args.data.isActive).toBe(false);
      expect(args.data.revokedAt).toBeInstanceOf(Date);
      expect(args.data.revokedById).toBe("user_admin_1");
    });
  });

  describe("getScimTokenById", () => {
    it("calls findUnique with { id } and returns the row", async () => {
      const fakeRow = { id: "tk_1", name: "thing" } as any;
      vi.mocked(prisma.scimToken.findUnique).mockResolvedValue(fakeRow);

      const result = await getScimTokenById("tk_1");
      expect(result).toBe(fakeRow);
      expect(prisma.scimToken.findUnique).toHaveBeenCalledWith({
        where: { id: "tk_1" },
      });
    });

    it("returns null when the row does not exist", async () => {
      vi.mocked(prisma.scimToken.findUnique).mockResolvedValue(null);
      expect(await getScimTokenById("nope")).toBeNull();
    });
  });

  describe("listScimTokens", () => {
    it("filters by isActive: true when showRevoked is false", async () => {
      vi.mocked(prisma.scimToken.findMany).mockResolvedValue([]);

      await listScimTokens({ showRevoked: false });

      const args = vi.mocked(prisma.scimToken.findMany).mock.calls[0][0] as {
        where: { AND: Array<Record<string, unknown>> };
        orderBy: { createdAt: "asc" | "desc" };
      };
      expect(args.where.AND[0]).toEqual({ isActive: true });
      expect(args.orderBy).toEqual({ createdAt: "desc" });
    });

    it("does NOT filter by isActive when showRevoked is true", async () => {
      vi.mocked(prisma.scimToken.findMany).mockResolvedValue([]);

      await listScimTokens({ showRevoked: true });

      const args = vi.mocked(prisma.scimToken.findMany).mock.calls[0][0] as {
        where: { AND: Array<Record<string, unknown>> };
      };
      // First AND clause should NOT contain an isActive filter
      expect(args.where.AND[0]).toEqual({});
    });

    it("adds a case-insensitive name contains filter when search is set", async () => {
      vi.mocked(prisma.scimToken.findMany).mockResolvedValue([]);

      await listScimTokens({ showRevoked: false, search: "foo" });

      const args = vi.mocked(prisma.scimToken.findMany).mock.calls[0][0] as {
        where: { AND: Array<Record<string, unknown>> };
      };
      expect(args.where.AND[1]).toEqual({
        name: { contains: "foo", mode: "insensitive" },
      });
    });

    it("treats missing opts as showRevoked: false", async () => {
      vi.mocked(prisma.scimToken.findMany).mockResolvedValue([]);

      await listScimTokens({});

      const args = vi.mocked(prisma.scimToken.findMany).mock.calls[0][0] as {
        where: { AND: Array<Record<string, unknown>> };
      };
      expect(args.where.AND[0]).toEqual({ isActive: true });
    });
  });

  describe("decryptScimSecret", () => {
    it("delegates to decrypt() and returns the plaintext", async () => {
      const out = await decryptScimSecret("enc(tps_abc123)");
      expect(out).toBe("tps_abc123");
      expect(decrypt).toHaveBeenCalledWith("enc(tps_abc123)");
    });

    it("round-trips with mintScimToken", async () => {
      vi.mocked(prisma.scimToken.create).mockResolvedValue({ id: "tk_rt" } as any);

      const { plaintext } = await mintScimToken({
        name: "rt",
        idpName: "OTHER",
        expiresAt: null,
        createdById: "u",
      });

      const args = vi.mocked(prisma.scimToken.create).mock.calls[0][0] as {
        data: { secret: string };
      };
      const decrypted = await decryptScimSecret(args.data.secret);
      expect(decrypted).toBe(plaintext);
    });
  });
});
