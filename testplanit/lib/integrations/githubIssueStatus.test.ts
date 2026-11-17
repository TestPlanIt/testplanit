import { describe, expect, it } from "vitest";
import { githubIssueStatus } from "./githubIssueStatus";

describe("githubIssueStatus", () => {
  it("keeps open issues as 'open'", () => {
    expect(githubIssueStatus({ state: "open", state_reason: null })).toBe(
      "open"
    );
    expect(githubIssueStatus({ state: "open", state_reason: "reopened" })).toBe(
      "open"
    );
  });

  it("keeps issues closed as completed as 'closed'", () => {
    expect(
      githubIssueStatus({ state: "closed", state_reason: "completed" })
    ).toBe("closed");
    expect(githubIssueStatus({ state: "closed" })).toBe("closed");
    expect(
      githubIssueStatus({ state: "closed", state_reason: "duplicate" })
    ).toBe("closed");
  });

  it("distinguishes issues closed as not planned", () => {
    expect(
      githubIssueStatus({ state: "closed", state_reason: "not_planned" })
    ).toBe("not_planned");
  });

  it("returns null without a string state", () => {
    expect(githubIssueStatus({})).toBeNull();
    expect(githubIssueStatus({ state: 123 })).toBeNull();
  });
});
