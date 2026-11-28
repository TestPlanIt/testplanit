import { describe, expect, it } from "vitest";
import { isLocalCredentialProvider, PASSKEY_PROVIDER_ID } from "./providers";

describe("isLocalCredentialProvider", () => {
  it("is true for the password form and for passkeys", () => {
    expect(isLocalCredentialProvider("credentials")).toBe(true);
    expect(isLocalCredentialProvider(PASSKEY_PROVIDER_ID)).toBe(true);
  });

  it("is false for identity providers and emailed links", () => {
    for (const provider of [
      "google",
      "apple",
      "azure-ad",
      "saml",
      "email",
      "passwordless-complete",
    ]) {
      expect(isLocalCredentialProvider(provider)).toBe(false);
    }
  });

  it("is false when the provider is missing", () => {
    expect(isLocalCredentialProvider(undefined)).toBe(false);
    expect(isLocalCredentialProvider(null)).toBe(false);
  });
});
