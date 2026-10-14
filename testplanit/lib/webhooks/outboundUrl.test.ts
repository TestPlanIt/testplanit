import { beforeAll, describe, expect, it } from "vitest";
import {
  openOutboundUrl,
  outboundUrlHint,
  sealOutboundUrl,
} from "./outboundUrl";

const SLACK = "https://hooks.slack.com/services/T000/B000/abcdefXYZ1";

describe("outbound webhook URLs", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("seals a URL so the stored value does not contain it, and opens it again", async () => {
    const sealed = await sealOutboundUrl(SLACK);
    expect(sealed).not.toContain("hooks.slack.com");
    expect(await openOutboundUrl(sealed)).toBe(SLACK);
  });

  it("reads a URL saved before encryption as it is", async () => {
    expect(await openOutboundUrl(SLACK)).toBe(SLACK);
    expect(await openOutboundUrl(null)).toBeNull();
  });

  it("hints at a URL with its origin and last four characters only", () => {
    expect(outboundUrlHint(SLACK)).toBe("https://hooks.slack.com/…XYZ1");
    expect(outboundUrlHint("not a url 12345")).toBe("…2345");
  });
});
