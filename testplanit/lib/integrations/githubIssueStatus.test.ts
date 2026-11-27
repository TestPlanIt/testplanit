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
    expect(githubIssueStatus({ state: "closed", state_reason: null })).toBe(
      "closed"
    );
  });

  it("distinguishes issues closed as not planned", () => {
    expect(
      githubIssueStatus({ state: "closed", state_reason: "not_planned" })
    ).toBe("not_planned");
  });

  it("distinguishes issues closed as a duplicate", () => {
    expect(
      githubIssueStatus({ state: "closed", state_reason: "duplicate" })
    ).toBe("duplicate");
  });

  it("ignores a close reason left on a reopened issue or one it does not know", () => {
    expect(
      githubIssueStatus({ state: "open", state_reason: "duplicate" })
    ).toBe("open");
    expect(
      githubIssueStatus({ state: "closed", state_reason: "something_new" })
    ).toBe("closed");
  });

  it("returns null without a string state", () => {
    expect(githubIssueStatus({})).toBeNull();
    expect(githubIssueStatus({ state: 123 })).toBeNull();
  });
});
