import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/services/sessionSearch", () => ({}));
vi.mock("~/services/testRunSearch", () => ({}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({}));
vi.mock("~/lib/execution/service", () => ({}));
vi.mock("~/lib/services/hybridRunProjection", () => ({}));

import { decrypt, encrypt } from "@/utils/encryption";
import {
  encryptCodeRepositoryCredentials,
  encryptCredentialsOnWrite,
} from "./sideEffectsPlugin";

async function open(blob: unknown): Promise<Record<string, string>> {
  return JSON.parse(await decrypt((blob as { encrypted: string }).encrypted));
}

describe("encryptCodeRepositoryCredentials", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  const client = (row: { credentials: unknown; provider: string } | null) => ({
    codeRepository: { findUnique: vi.fn().mockResolvedValue(row) },
  });

  it("encrypts the credentials of a create into the { encrypted } shape", async () => {
    const args = {
      data: {
        name: "r",
        provider: "GITHUB",
        credentials: { personalAccessToken: "ghp_x" },
      },
    };
    await encryptCodeRepositoryCredentials("create", args, client(null));

    expect(Object.keys(args.data.credentials)).toEqual(["encrypted"]);
    expect(await open(args.data.credentials)).toEqual({
      personalAccessToken: "ghp_x",
    });
  });

  it("merges an update over the stored, decrypted credentials", async () => {
    const stored = {
      encrypted: await encrypt(
        JSON.stringify({ email: "a@b.c", apiToken: "old" })
      ),
    };
    const reader = client({ credentials: stored, provider: "BITBUCKET" });
    const args = {
      where: { id: 9 },
      data: { credentials: { apiToken: "new" } },
    };

    await encryptCodeRepositoryCredentials("update", args, reader);

    expect(reader.codeRepository.findUnique).toHaveBeenCalledWith({
      where: { id: 9 },
      select: { credentials: true, provider: true },
    });
    expect(await open(args.data.credentials)).toEqual({
      email: "a@b.c",
      apiToken: "new",
    });
  });

  it("merges over legacy plaintext rows and re-encrypts them", async () => {
    const reader = client({
      credentials: { email: "a@b.c", apiToken: "plain" },
      provider: "BITBUCKET",
    });
    const args = {
      where: { id: 9 },
      data: { credentials: { apiToken: "new" } },
    };

    await encryptCodeRepositoryCredentials("update", args, reader);

    expect(await open(args.data.credentials)).toEqual({
      email: "a@b.c",
      apiToken: "new",
    });
  });

  it("seals both halves of an upsert", async () => {
    const reader = client(null);
    const args = {
      where: { name: "r" },
      create: { name: "r", credentials: { token: "t1" } },
      update: { credentials: { token: "t2" } },
    };

    await encryptCodeRepositoryCredentials("upsert", args, reader);

    expect(await open(args.create.credentials)).toEqual({ token: "t1" });
    expect(await open(args.update.credentials)).toEqual({ token: "t2" });
  });

  it("leaves an already encrypted blob, a null, and reads alone", async () => {
    const blob = { encrypted: await encrypt("{}") };
    const args = { data: { credentials: blob } };
    await encryptCodeRepositoryCredentials("update", args, client(null));
    expect(args.data.credentials).toBe(blob);

    const nulled = { data: { credentials: null } };
    await encryptCodeRepositoryCredentials("update", nulled, client(null));
    expect(nulled.data.credentials).toBeNull();

    const read = { where: { id: 1 } };
    await encryptCodeRepositoryCredentials("findUnique", read, client(null));
    expect(read).toEqual({ where: { id: 1 } });
  });
});

describe("encryptCredentialsOnWrite for AI model integrations", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  const llm = (row: { credentials: unknown; provider: string } | null) => ({
    llmIntegration: { findUnique: vi.fn().mockResolvedValue(row) },
  });

  it("seals a new integration's key", async () => {
    const args = {
      data: {
        name: "Claude",
        provider: "ANTHROPIC",
        credentials: { apiKey: "sk-ant-x", endpoint: "", baseUrl: "" },
      },
    };
    await encryptCredentialsOnWrite(
      "llmIntegration",
      "create",
      args,
      llm(null)
    );
    expect(Object.keys(args.data.credentials)).toEqual(["encrypted"]);
    expect(await open(args.data.credentials)).toMatchObject({
      apiKey: "sk-ant-x",
    });
  });

  it("keeps the stored key when an edit sends only a new endpoint", async () => {
    const stored = {
      encrypted: await encrypt(
        JSON.stringify({ apiKey: "sk-old", endpoint: "https://a/v1" })
      ),
    };
    const reader = llm({ credentials: stored, provider: "CUSTOM_LLM" });
    const args = {
      where: { id: 5 },
      data: {
        credentials: { endpoint: "https://b/v1", baseUrl: "https://b/v1" },
      },
    };
    await encryptCredentialsOnWrite("llmIntegration", "update", args, reader);
    expect(reader.llmIntegration.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { credentials: true, provider: true },
    });
    expect(await open(args.data.credentials)).toEqual({
      apiKey: "sk-old",
      endpoint: "https://b/v1",
      baseUrl: "https://b/v1",
    });
  });

  it("seals an upsert's create and merges its update, as the Add dialog's restore writes", async () => {
    const stored = {
      encrypted: await encrypt(JSON.stringify({ apiKey: "sk-old" })),
    };
    const args = {
      where: { name: "Claude" },
      create: { credentials: { apiKey: "sk-new" } },
      update: { credentials: { apiKey: "sk-new" } },
    };
    await encryptCredentialsOnWrite(
      "llmIntegration",
      "upsert",
      args,
      llm({ credentials: stored, provider: "ANTHROPIC" })
    );
    expect(await open(args.create.credentials)).toEqual({ apiKey: "sk-new" });
    expect(await open(args.update.credentials)).toEqual({ apiKey: "sk-new" });
  });

  it("leaves an already sealed blob alone", async () => {
    const sealed = {
      encrypted: await encrypt(JSON.stringify({ apiKey: "k" })),
    };
    const args = { data: { credentials: sealed } };
    await encryptCredentialsOnWrite(
      "llmIntegration",
      "create",
      args,
      llm(null)
    );
    expect(args.data.credentials).toBe(sealed);
  });
});

describe("encryptCredentialsOnWrite for issue integrations", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  const integration = (
    row: { credentials: unknown; provider: string } | null
  ) => ({
    integration: { findUnique: vi.fn().mockResolvedValue(row) },
  });

  it("seals a model-API write instead of storing the token in the clear", async () => {
    const args = {
      data: {
        name: "Jira",
        provider: "JIRA",
        credentials: { email: "a@b.c", apiToken: "jira-token" },
      },
    };
    await encryptCredentialsOnWrite(
      "integration",
      "create",
      args,
      integration(null)
    );
    expect(Object.keys(args.data.credentials)).toEqual(["encrypted"]);
    expect(await open(args.data.credentials)).toEqual({
      email: "a@b.c",
      apiToken: "jira-token",
    });
  });

  it("opens secrets a writer encrypted one by one before sealing them", async () => {
    const args = {
      where: { id: 3 },
      data: {
        credentials: {
          clientId: "id",
          clientSecret: await encrypt("oauth-secret"),
        },
      },
    };
    await encryptCredentialsOnWrite(
      "integration",
      "update",
      args,
      integration({ credentials: {}, provider: "GITHUB" })
    );
    expect(await open(args.data.credentials)).toEqual({
      clientId: "id",
      clientSecret: "oauth-secret",
    });
  });
});

describe("encryptCredentialsOnWrite for SSO providers", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  const sso = (row: { config: unknown; type: string } | null) => ({
    ssoProvider: { findUnique: vi.fn().mockResolvedValue(row) },
  });

  it("seals a new provider's client secret", async () => {
    const args = {
      data: {
        name: "Google OAuth",
        type: "GOOGLE",
        config: { clientId: "gid", clientSecret: "gsecret" },
      },
    };
    await encryptCredentialsOnWrite("ssoProvider", "create", args, sso(null));
    expect(Object.keys(args.data.config)).toEqual(["encrypted"]);
    expect(await open(args.data.config)).toEqual({
      clientId: "gid",
      clientSecret: "gsecret",
    });
  });

  it("keeps the stored private key when an edit leaves it blank", async () => {
    const stored = {
      encrypted: await encrypt(
        JSON.stringify({
          clientId: "a",
          teamId: "t",
          keyId: "k",
          privateKey: "-----BEGIN PRIVATE KEY-----",
        })
      ),
    };
    const reader = sso({ config: stored, type: "APPLE" });
    const args = {
      where: { id: "apple" },
      data: { config: { clientId: "b", teamId: "t", keyId: "k2" } },
    };
    await encryptCredentialsOnWrite("ssoProvider", "update", args, reader);
    expect(reader.ssoProvider.findUnique).toHaveBeenCalledWith({
      where: { id: "apple" },
      select: { config: true, type: true },
    });
    expect(await open(args.data.config)).toEqual({
      clientId: "b",
      teamId: "t",
      keyId: "k2",
      privateKey: "-----BEGIN PRIVATE KEY-----",
    });
  });
});
