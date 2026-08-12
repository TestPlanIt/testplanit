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

  it("refuses a secret stored in cleartext rather than using it as-is", async () => {
    // The production incident: a cleartext apiToken was forwarded to Jira as
    // a bearer credential.
    await expectCorrupt({ email: "a@b.com", apiToken: "plaintext-token" });
  });

  it("refuses a cleartext password on the Data Center credential shape", async () => {
    await expectCorrupt({ username: "svc", password: "hunter2" });
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
