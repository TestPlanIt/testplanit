import { beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/utils/encryption";
import {
  type CredentialRewriter,
  encryptLegacyCodeRepositoryCredentials,
} from "./ensureCodeRepositoryCredentialsEncrypted";

describe("encryptLegacyCodeRepositoryCredentials", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  function db(
    rows: Array<{
      id: number;
      name: string;
      provider: string;
      credentials: unknown;
    }>
  ) {
    const update = vi.fn().mockResolvedValue({});
    const client: CredentialRewriter = {
      codeRepository: { findMany: vi.fn().mockResolvedValue(rows), update },
    };
    return { client, update };
  }

  it("re-saves plain rows with their resolved fields and skips encrypted ones", async () => {
    const sealed = { encrypted: await encrypt(JSON.stringify({ token: "t" })) };
    const { client, update } = db([
      { id: 1, name: "done", provider: "GITHUB", credentials: sealed },
      {
        id: 2,
        name: "plain",
        provider: "BITBUCKET",
        credentials: { email: "a@b.c", apiToken: "x" },
      },
      {
        id: 3,
        name: "legacy-field",
        provider: "GITHUB",
        credentials: { personalAccessToken: await encrypt("ghp") },
      },
    ]);
    const log = vi.fn();

    const result = await encryptLegacyCodeRepositoryCredentials(client, log);

    expect(result).toEqual({ rewritten: 2, unreadable: 0, total: 3 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { credentials: { email: "a@b.c", apiToken: "x" } },
    });
    // A per-field encrypted legacy row is decrypted so the write re-encrypts it whole.
    expect(update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { credentials: { personalAccessToken: "ghp" } },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("#2 plain"));
  });

  it("leaves an unreadable row alone and reports it", async () => {
    const { client, update } = db([
      {
        id: 4,
        name: "corrupt",
        provider: "GITLAB",
        credentials: "not-real-ciphertext",
      },
    ]);
    const log = vi.fn();

    const result = await encryptLegacyCodeRepositoryCredentials(client, log);

    expect(result).toEqual({ rewritten: 0, unreadable: 1, total: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("could not be read")
    );
  });

  it("does nothing when every row is already encrypted", async () => {
    const sealed = { encrypted: await encrypt("{}") };
    const { client, update } = db([
      { id: 5, name: "r", provider: "GITHUB", credentials: sealed },
    ]);

    expect(await encryptLegacyCodeRepositoryCredentials(client)).toEqual({
      rewritten: 0,
      unreadable: 0,
      total: 1,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
