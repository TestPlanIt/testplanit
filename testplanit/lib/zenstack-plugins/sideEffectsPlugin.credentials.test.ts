import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/services/sessionSearch", () => ({}));
vi.mock("~/services/testRunSearch", () => ({}));
vi.mock("~/lib/webhooks/event-emitters/testRunEvents", () => ({}));
vi.mock("~/lib/execution/service", () => ({}));
vi.mock("~/lib/services/hybridRunProjection", () => ({}));

import { decrypt, encrypt } from "@/utils/encryption";
import { encryptCodeRepositoryCredentials } from "./sideEffectsPlugin";

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
