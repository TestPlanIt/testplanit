import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRIAL_CONTACT,
  isContactWebLink,
  resolveTrialContact,
  trialContactHref,
} from "./trialContact";

describe("resolveTrialContact", () => {
  it("falls back to the default address when unset or blank", () => {
    expect(resolveTrialContact({})).toBe(DEFAULT_TRIAL_CONTACT);
    expect(resolveTrialContact({ NEXT_PUBLIC_CONTACT_EMAIL: "  " })).toBe(
      DEFAULT_TRIAL_CONTACT
    );
  });

  it("returns the configured value trimmed", () => {
    expect(
      resolveTrialContact({
        NEXT_PUBLIC_CONTACT_EMAIL: " https://example.com/contact ",
      })
    ).toBe("https://example.com/contact");
  });
});

describe("trialContactHref", () => {
  it("turns a bare email into a mailto link with the subject", () => {
    expect(trialContactHref("sales@example.com", "Trial - Expired")).toBe(
      "mailto:sales@example.com?subject=Trial%20-%20Expired"
    );
  });

  it("turns a bare email into a mailto link without a subject", () => {
    expect(trialContactHref("sales@example.com")).toBe(
      "mailto:sales@example.com"
    );
  });

  it("keeps a web link as given and ignores the subject", () => {
    expect(
      trialContactHref("https://example.com/contact?src=trial", "Subject")
    ).toBe("https://example.com/contact?src=trial");
  });

  it("appends the subject to a mailto link that has no query", () => {
    expect(trialContactHref("mailto:sales@example.com", "Hi")).toBe(
      "mailto:sales@example.com?subject=Hi"
    );
  });

  it("leaves a mailto link with its own query untouched", () => {
    expect(trialContactHref("mailto:sales@example.com?subject=X", "Hi")).toBe(
      "mailto:sales@example.com?subject=X"
    );
  });
});

describe("isContactWebLink", () => {
  it("is true only for http and https links", () => {
    expect(isContactWebLink("https://example.com")).toBe(true);
    expect(isContactWebLink("http://example.com")).toBe(true);
    expect(isContactWebLink("mailto:sales@example.com")).toBe(false);
    expect(isContactWebLink("sales@example.com")).toBe(false);
  });
});
