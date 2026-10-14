import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@/utils/encryption";
import { resolveSsoConfig, summarizeSsoConfig } from "./ssoConfig";

describe("SSO config", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("reads a sealed config and an older cleartext one alike", async () => {
    const plain = { clientId: "gid", clientSecret: "gsecret" };
    expect(
      await resolveSsoConfig(
        { encrypted: await encrypt(JSON.stringify(plain)) },
        "GOOGLE"
      )
    ).toEqual(plain);
    expect(await resolveSsoConfig(plain, "GOOGLE")).toEqual(plain);
  });

  it("summarizes a config without its secrets", () => {
    const summary = summarizeSsoConfig({
      clientId: "mid",
      clientSecret: "msecret",
      tenantId: "tenant",
    });
    expect(summary).toEqual({
      clientId: "mid",
      tenantId: "tenant",
      hasClientSecret: true,
      hasPrivateKey: false,
    });
    expect(JSON.stringify(summary)).not.toContain("msecret");
    expect(
      summarizeSsoConfig({
        clientId: "a",
        teamId: "t",
        keyId: "k",
        privateKey: "pem",
      })
    ).toEqual({
      clientId: "a",
      teamId: "t",
      keyId: "k",
      hasClientSecret: false,
      hasPrivateKey: true,
    });
  });
});
