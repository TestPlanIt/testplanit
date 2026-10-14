import { beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/utils/encryption";
import { loadLlmCredentials, resolveLlmCredentials } from "./credentials";

describe("AI model credentials", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("decrypts a sealed blob", async () => {
    const sealed = {
      encrypted: await encrypt(
        JSON.stringify({ apiKey: "sk-x", endpoint: "https://e/v1" })
      ),
    };
    expect(await resolveLlmCredentials(sealed, "OPENAI")).toEqual({
      apiKey: "sk-x",
      endpoint: "https://e/v1",
    });
  });

  it("still reads a row stored in the clear, leaving out empty values", async () => {
    expect(
      await resolveLlmCredentials(
        { apiKey: "sk-plain", endpoint: "", baseUrl: "" },
        "ANTHROPIC"
      )
    ).toEqual({ apiKey: "sk-plain" });
    expect(await resolveLlmCredentials(null, "OLLAMA")).toEqual({});
  });

  it("loads an integration's credentials by id with an explicit select", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        credentials: { apiKey: "k" },
        provider: "GEMINI",
      })
      .mockResolvedValueOnce(null);
    const db = { llmIntegration: { findUnique } };
    expect(await loadLlmCredentials(db, 3)).toEqual({ apiKey: "k" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 3 },
      select: { credentials: true, provider: true },
    });
    expect(await loadLlmCredentials(db, 4)).toBeNull();
  });
});
