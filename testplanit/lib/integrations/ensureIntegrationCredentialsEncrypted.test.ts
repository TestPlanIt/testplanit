import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/utils/encryption";
import {
  encryptLegacyIntegrationCredentials,
  type IntegrationCredentialRewriter,
} from "./ensureIntegrationCredentialsEncrypted";

const zenstack = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("~/lib/zenstack", () => ({
  baseClient: {
    integration: { findMany: zenstack.findMany, update: zenstack.update },
  },
}));

type Row = {
  id: number;
  name: string;
  provider: string;
  credentials: unknown;
};

function db(rows: Row[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const update = vi.fn().mockResolvedValue({});
  const client: IntegrationCredentialRewriter = {
    integration: { findMany, update },
  };
  return { client, findMany, update };
}

async function writtenPlain(update: ReturnType<typeof vi.fn>, id: number) {
  const call = update.mock.calls.find(([args]) => args.where.id === id);
  expect(call).toBeDefined();
  const blob = call![0].data.credentials;
  expect(Object.keys(blob)).toEqual(["encrypted"]);
  return JSON.parse(await decrypt(blob.encrypted));
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
});

describe("encryptLegacyIntegrationCredentials", () => {
  beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("queries non-deleted integrations with only the needed fields", async () => {
    const { client, findMany } = db([]);
    expect(await encryptLegacyIntegrationCredentials(client)).toEqual({
      rewritten: 0,
      unreadable: 0,
      total: 0,
    });
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, provider: true, credentials: true },
    });
  });

  it("skips empty and already-encrypted rows", async () => {
    const sealed = { encrypted: await encrypt(JSON.stringify({ a: "b" })) };
    const { client, update } = db([
      { id: 1, name: "null", provider: "JIRA", credentials: null },
      { id: 2, name: "empty", provider: "JIRA", credentials: {} },
      { id: 3, name: "sealed", provider: "JIRA", credentials: sealed },
    ]);
    const log = vi.fn();

    expect(await encryptLegacyIntegrationCredentials(client, log)).toEqual({
      rewritten: 0,
      unreadable: 0,
      total: 3,
    });
    expect(update).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("rewrites cleartext and per-key-encrypted rows as one encrypted blob", async () => {
    const { client, update } = db([
      {
        id: 4,
        name: "cleartext",
        provider: "JIRA",
        credentials: { email: "a@b.c", apiToken: "plain-token" },
      },
      {
        id: 5,
        name: "per-key",
        provider: "GITHUB",
        credentials: { personalAccessToken: await encrypt("ghp_secret") },
      },
    ]);
    const log = vi.fn();

    const result = await encryptLegacyIntegrationCredentials(client, log);

    expect(result).toEqual({ rewritten: 2, unreadable: 0, total: 2 });
    expect(update).toHaveBeenCalledTimes(2);
    expect(await writtenPlain(update, 4)).toEqual({
      email: "a@b.c",
      apiToken: "plain-token",
    });
    expect(await writtenPlain(update, 5)).toEqual({
      personalAccessToken: "ghp_secret",
    });
    expect(log).toHaveBeenCalledWith(
      "encrypted credentials for integration #4 cleartext"
    );
    expect(log).toHaveBeenCalledWith(
      "encrypted credentials for integration #5 per-key"
    );
  });

  it("counts unreadable rows, logs them, and leaves them alone", async () => {
    const { client, update } = db([
      {
        id: 6,
        name: "corrupt",
        provider: "JIRA",
        credentials: "not-real-ciphertext",
      },
      {
        id: 7,
        name: "ok",
        provider: "JIRA",
        credentials: { apiToken: "t" },
      },
    ]);
    const log = vi.fn();

    const result = await encryptLegacyIntegrationCredentials(client, log);

    expect(result).toEqual({ rewritten: 1, unreadable: 1, total: 2 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 7 });
    expect(log).toHaveBeenCalledWith(
      "credentials for integration #6 corrupt could not be read; re-enter them"
    );
  });

  it("works without a log callback", async () => {
    const { client } = db([
      { id: 8, name: "x", provider: "JIRA", credentials: { apiToken: "t" } },
    ]);
    await expect(encryptLegacyIntegrationCredentials(client)).resolves.toEqual({
      rewritten: 1,
      unreadable: 0,
      total: 1,
    });
  });
});

describe("ensureIntegrationCredentialsEncrypted", () => {
  const originalFlag = process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP;

  async function load() {
    vi.resetModules();
    return (await import("./ensureIntegrationCredentialsEncrypted"))
      .ensureIntegrationCredentialsEncrypted;
  }

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP = originalFlag;
    }
    zenstack.findMany.mockReset();
    zenstack.update.mockReset();
    vi.restoreAllMocks();
  });

  it("does nothing when CREDENTIAL_ENCRYPTION_BOOTSTRAP=off", async () => {
    process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP = "off";
    const ensure = await load();
    await ensure();
    expect(zenstack.findMany).not.toHaveBeenCalled();
  });

  it("runs at most once per process", async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    zenstack.findMany.mockResolvedValue([]);
    const ensure = await load();

    const first = ensure();
    const second = ensure();
    expect(second).toBe(first);
    await first;
    await ensure();

    expect(zenstack.findMany).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "[startup] integration credentials encrypted ✓"
    );
  });

  it("logs a summary when it rewrites rows", async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    zenstack.findMany.mockResolvedValue([
      { id: 1, name: "a", provider: "JIRA", credentials: { apiToken: "t" } },
      { id: 2, name: "b", provider: "JIRA", credentials: "garbage" },
    ]);
    zenstack.update.mockResolvedValue({});
    const ensure = await load();

    await ensure();

    expect(zenstack.update).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "[startup] integration credentials: 1 encrypted, 1 unreadable, 2 checked"
    );
    expect(info).toHaveBeenCalledWith(
      "[startup] encrypted credentials for integration #1 a"
    );
  });

  it("fails open and clears the memo so a later call retries", async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP;
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    zenstack.findMany
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([]);
    const ensure = await load();

    await expect(ensure()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);

    await ensure();
    expect(zenstack.findMany).toHaveBeenCalledTimes(2);
  });
});
