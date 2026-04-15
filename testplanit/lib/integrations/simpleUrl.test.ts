import { describe, expect, it } from "vitest";
import { buildSimpleUrlLink } from "./simpleUrl";

describe("buildSimpleUrlLink", () => {
  it("returns null when baseUrl is missing", () => {
    expect(buildSimpleUrlLink(undefined, "ISSUE-1")).toBeNull();
    expect(buildSimpleUrlLink(null, "ISSUE-1")).toBeNull();
    expect(buildSimpleUrlLink("", "ISSUE-1")).toBeNull();
  });

  it("returns null when externalId is missing", () => {
    expect(
      buildSimpleUrlLink("https://tracker.com/{issueId}", undefined)
    ).toBeNull();
    expect(
      buildSimpleUrlLink("https://tracker.com/{issueId}", null)
    ).toBeNull();
    expect(buildSimpleUrlLink("https://tracker.com/{issueId}", "")).toBeNull();
  });

  it("replaces the {issueId} token with the externalId", () => {
    expect(
      buildSimpleUrlLink("https://tracker.com/issues/{issueId}", "ISSUE-123")
    ).toBe("https://tracker.com/issues/ISSUE-123");
  });

  it("returns the template unchanged when it has no {issueId} token", () => {
    // Degenerate input — admin misconfigured the Base URL. We don't invent a
    // placeholder; we just hand back whatever baseUrl they set.
    expect(buildSimpleUrlLink("https://tracker.com/issues", "ISSUE-1")).toBe(
      "https://tracker.com/issues"
    );
  });
});
