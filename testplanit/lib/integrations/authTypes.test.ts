import { describe, expect, it } from "vitest";
import { usesIntegrationCredentials } from "./authTypes";

describe("usesIntegrationCredentials", () => {
  it.each(["API_KEY", "PERSONAL_ACCESS_TOKEN", "GITHUB_APP"])(
    "is true for %s, whose credentials belong to the integration",
    (authType) => {
      expect(usesIntegrationCredentials(authType)).toBe(true);
    }
  );

  it.each(["OAUTH2", "NONE", "", null, undefined])(
    "is false for %s",
    (authType) => {
      expect(usesIntegrationCredentials(authType)).toBe(false);
    }
  );
});
