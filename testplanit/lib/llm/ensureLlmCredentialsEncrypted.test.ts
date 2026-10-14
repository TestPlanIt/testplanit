import { beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/utils/encryption";
import {
  encryptLegacyLlmCredentials,
  type LlmCredentialRewriter,
} from "./ensureLlmCredentialsEncrypted";

type Row = { id: number; name: string; provider: string; credentials: unknown };

function db(rows: Row[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const update = vi.fn().mockResolvedValue({});
  const client: LlmCredentialRewriter = {
    llmIntegration: { findMany, update },
  };
  return { client, findMany, update };
}

describe("encryptLegacyLlmCredentials", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("seals keys stored in the clear and leaves sealed and empty rows alone", async () => {
    const sealed = {
      encrypted: await encrypt(JSON.stringify({ apiKey: "s" })),
    };
    const { client, update, findMany } = db([
      {
        id: 1,
        name: "Claude",
        provider: "ANTHROPIC",
        credentials: { apiKey: "sk-ant", endpoint: "" },
      },
      { id: 2, name: "Sealed", provider: "OPENAI", credentials: sealed },
      { id: 3, name: "Ollama", provider: "OLLAMA", credentials: {} },
    ]);
    const log = vi.fn();

    expect(await encryptLegacyLlmCredentials(client, log)).toEqual({
      rewritten: 1,
      unreadable: 0,
      total: 3,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { isDeleted: false },
      select: { id: true, name: true, provider: true, credentials: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0];
    expect(written.where).toEqual({ id: 1 });
    expect(
      JSON.parse(await decrypt(written.data.credentials.encrypted))
    ).toEqual({ apiKey: "sk-ant" });
    expect(log).toHaveBeenCalledWith(
      "encrypted credentials for AI model #1 Claude"
    );
  });

  it("counts a row it cannot read and moves on", async () => {
    const { client, update } = db([
      {
        id: 9,
        name: "Broken",
        provider: "OPENAI",
        credentials: "not-ciphertext",
      },
    ]);
    expect(await encryptLegacyLlmCredentials(client)).toEqual({
      rewritten: 0,
      unreadable: 1,
      total: 1,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
