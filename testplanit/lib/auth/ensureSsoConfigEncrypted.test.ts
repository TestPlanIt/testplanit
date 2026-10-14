import { beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/utils/encryption";
import {
  clearStoredOAuthTokens,
  encryptLegacySsoConfigs,
  type OAuthTokenEraser,
  type SsoConfigRewriter,
} from "./ensureSsoConfigEncrypted";

type Row = { id: string; name: string; type: string; config: unknown };

function db(rows: Row[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const update = vi.fn().mockResolvedValue({});
  const client: SsoConfigRewriter = { ssoProvider: { findMany, update } };
  return { client, findMany, update };
}

describe("encryptLegacySsoConfigs", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("seals cleartext configs and leaves sealed and empty ones alone", async () => {
    const sealed = { encrypted: await encrypt(JSON.stringify({ a: "b" })) };
    const { client, findMany, update } = db([
      {
        id: "g",
        name: "Google OAuth",
        type: "GOOGLE",
        config: { clientId: "gid", clientSecret: "gsecret" },
      },
      { id: "m", name: "Microsoft", type: "MICROSOFT", config: sealed },
      { id: "l", name: "Magic Link", type: "MAGIC_LINK", config: null },
    ]);
    const log = vi.fn();

    expect(await encryptLegacySsoConfigs(client, log)).toEqual({
      rewritten: 1,
      unreadable: 0,
      total: 3,
    });
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, type: true, config: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0];
    expect(written.where).toEqual({ id: "g" });
    expect(JSON.parse(await decrypt(written.data.config.encrypted))).toEqual({
      clientId: "gid",
      clientSecret: "gsecret",
    });
    expect(log).toHaveBeenCalledWith("encrypted SSO config for Google OAuth");
  });

  it("counts a config it cannot read and moves on", async () => {
    const { client, update } = db([
      { id: "x", name: "Broken", type: "GOOGLE", config: "not-ciphertext" },
    ]);
    expect(await encryptLegacySsoConfigs(client)).toEqual({
      rewritten: 0,
      unreadable: 1,
      total: 1,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("clearStoredOAuthTokens", () => {
  it("clears every linked account still holding a provider token", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const db: OAuthTokenEraser = { account: { updateMany } };
    expect(await clearStoredOAuthTokens(db)).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { access_token: { not: null } },
          { refresh_token: { not: null } },
          { id_token: { not: null } },
        ],
      },
      data: { access_token: null, refresh_token: null, id_token: null },
    });
  });
});
