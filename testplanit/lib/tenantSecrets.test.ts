import { describe, expect, it } from "vitest";
import { __internals } from "./tenantSecrets";

const { extractEncryptionKey, resolveSecretName } = __internals;

describe("extractEncryptionKey", () => {
  it("parses a bare value", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY=abc123")).toBe("abc123");
  });

  it("parses a double-quoted value", () => {
    expect(extractEncryptionKey('ENCRYPTION_KEY="abc 123"')).toBe("abc 123");
  });

  it("parses a single-quoted value", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY='abc 123'")).toBe("abc 123");
  });

  it("skips comments and blank lines, picks the real line", () => {
    const env = [
      "# header",
      "",
      "OTHER=val",
      "# ENCRYPTION_KEY=fakecomment",
      "ENCRYPTION_KEY=real-value",
    ].join("\n");
    expect(extractEncryptionKey(env)).toBe("real-value");
  });

  it("returns null when no key is present", () => {
    expect(extractEncryptionKey("FOO=bar\nBAZ=qux")).toBeNull();
  });

  it("returns null when key is present but empty", () => {
    expect(extractEncryptionKey("ENCRYPTION_KEY=")).toBeNull();
  });
});

describe("resolveSecretName", () => {
  it("uses the default tpi-<tenant>-env template", () => {
    delete process.env.TENANT_SECRET_NAME_TEMPLATE;
    expect(resolveSecretName("allego")).toBe("tpi-allego-env");
  });

  it("honors TENANT_SECRET_NAME_TEMPLATE override", () => {
    process.env.TENANT_SECRET_NAME_TEMPLATE = "custom-{tenant}-secret";
    try {
      expect(resolveSecretName("demo")).toBe("custom-demo-secret");
    } finally {
      delete process.env.TENANT_SECRET_NAME_TEMPLATE;
    }
  });
});
