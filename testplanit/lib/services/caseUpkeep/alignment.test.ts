import { describe, expect, it } from "vitest";
import { isIssueTextNewerThanCase } from "./alignment";

const earlier = "2026-11-20T10:00:00.000Z";
const later = "2026-11-24T10:00:00.000Z";

describe("isIssueTextNewerThanCase", () => {
  it("is true when the issue changed after the case was aligned", () => {
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: later, alignedAt: earlier })
    ).toBe(true);
    expect(
      isIssueTextNewerThanCase({
        contentUpdatedAt: new Date(later),
        alignedAt: new Date(earlier),
      })
    ).toBe(true);
  });

  it("is false when the case was aligned at or after the change", () => {
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: earlier, alignedAt: later })
    ).toBe(false);
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: later, alignedAt: later })
    ).toBe(false);
  });

  it("never flags a link that was never aligned, or an issue never stamped", () => {
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: later, alignedAt: null })
    ).toBe(false);
    expect(
      isIssueTextNewerThanCase({
        contentUpdatedAt: later,
        alignedAt: undefined,
      })
    ).toBe(false);
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: null, alignedAt: earlier })
    ).toBe(false);
  });

  it("is false for a timestamp it cannot read", () => {
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: "soon", alignedAt: earlier })
    ).toBe(false);
    expect(
      isIssueTextNewerThanCase({ contentUpdatedAt: later, alignedAt: "never" })
    ).toBe(false);
  });
});
