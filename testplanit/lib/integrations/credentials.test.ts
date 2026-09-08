import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "@/utils/encryption";
import { resolveStoredCredentials } from "./credentials";
import { isIntegrationApiError } from "./errors";

describe("resolveStoredCredentials", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  const expectCorrupt = async (raw: unknown) => {
    const error = await resolveStoredCredentials(raw, "JIRA").then(
      () => null,
      (e) => e
    );
    expect(isIntegrationApiError(error)).toBe(true);
    expect(error.kind).toBe("credentials_corrupt");
    return error;
  };

  it("returns an empty map for absent credentials", async () => {
    expect(await resolveStoredCredentials(null, "JIRA")).toEqual({});
    expect(await resolveStoredCredentials(undefined, "JIRA")).toEqual({});
  });

  it("decrypts the single-blob shape written by the admin routes", async () => {
    const encrypted = await encrypt(
      JSON.stringify({ email: "a@b.com", apiToken: "secret-token" })
    );

    expect(await resolveStoredCredentials({ encrypted }, "JIRA")).toEqual({
      email: "a@b.com",
      apiToken: "secret-token",
    });
  });

  it("decrypts the legacy per-field shape", async () => {
    const stored = {
      email: "a@b.com",
      apiToken: await encrypt("secret-token"),
    };

    expect(await resolveStoredCredentials(stored, "JIRA")).toEqual({
      email: "a@b.com",
      apiToken: "secret-token",
    });
  });

  it("uses a secret stored in cleartext — it is readable, just badly stored", async () => {
    // OAuth2 client credentials predate the encrypting write path, so these
    // rows exist in the wild. Refusing them fails every adapter build for the
    // integration, and no user action short of re-entering the secret fixes it.
    expect(
      await resolveStoredCredentials(
        { email: "a@b.com", apiToken: "plaintext-token" },
        "JIRA"
      )
    ).toEqual({ email: "a@b.com", apiToken: "plaintext-token" });
  });

  it("uses a cleartext password on the Data Center credential shape", async () => {
    expect(
      await resolveStoredCredentials(
        { username: "svc", password: "hunter2" },
        "JIRA"
      )
    ).toEqual({ username: "svc", password: "hunter2" });
  });

  it("uses the cleartext OAuth2 client credentials that broke Jira OAuth", async () => {
    // A clientSecret containing "-" is not base64, so isEncrypted correctly
    // reports cleartext; the adapter still needs the value to build the
    // authorize URL and to exchange the code.
    expect(
      await resolveStoredCredentials(
        { clientId: "public-client-id", clientSecret: "ATOA-secret_value" },
        "JIRA"
      )
    ).toEqual({
      clientId: "public-client-id",
      clientSecret: "ATOA-secret_value",
    });
  });

  it("refuses an undecryptable blob rather than returning empty credentials", async () => {
    const encrypted = await encrypt(JSON.stringify({ apiToken: "x" }));
    await expectCorrupt({ encrypted: `${encrypted.slice(0, -5)}XXXXX` });
  });

  it("refuses an undecryptable per-field secret", async () => {
    const apiToken = await encrypt("secret-token");
    await expectCorrupt({ apiToken: `${apiToken.slice(0, -5)}XXXXX` });
  });

  it("refuses a blob that decrypts to something that is not JSON", async () => {
    await expectCorrupt({ encrypted: await encrypt("not json at all") });
  });

  it("reads the bare-ciphertext-string shape instead of silently returning {}", async () => {
    // Written by the since-removed storeApiKeyAuth. Returning {} here handed
    // callers an integration that authenticated with nothing.
    const raw = await encrypt(JSON.stringify({ apiToken: "secret-token" }));

    expect(await resolveStoredCredentials(raw, "JIRA")).toEqual({
      apiToken: "secret-token",
    });
  });

  it("refuses a bare ciphertext string that will not decrypt", async () => {
    const raw = await encrypt(JSON.stringify({ apiToken: "x" }));
    await expectCorrupt(`${raw.slice(0, -5)}XXXXX`);
  });

  it("returns an empty map for an empty-string credential column", async () => {
    expect(await resolveStoredCredentials("", "JIRA")).toEqual({});
  });

  it("passes non-secret identifiers through in the clear", async () => {
    const stored = {
      email: "a@b.com",
      username: "svc",
      clientId: "public-client-id",
      apiToken: await encrypt("secret-token"),
    };

    const resolved = await resolveStoredCredentials(stored, "JIRA");
    expect(resolved.email).toBe("a@b.com");
    expect(resolved.username).toBe("svc");
    expect(resolved.clientId).toBe("public-client-id");
  });

  it("skips empty values without treating them as corrupt", async () => {
    expect(
      await resolveStoredCredentials({ email: "a@b.com", apiToken: "" }, "JIRA")
    ).toEqual({ email: "a@b.com" });
  });

  it("round-trips every secret key it recognizes", async () => {
    const stored = {
      apiToken: await encrypt("t1"),
      password: await encrypt("t2"),
      personalAccessToken: await encrypt("t3"),
      clientSecret: await encrypt("t4"),
    };

    expect(await resolveStoredCredentials(stored, "JIRA")).toEqual({
      apiToken: "t1",
      password: "t2",
      personalAccessToken: "t3",
      clientSecret: "t4",
    });
  });
});
