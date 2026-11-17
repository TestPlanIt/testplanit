import { describe, expect, it } from "vitest";

import type { IssueData } from "./adapters/IssueAdapter";
import { toExternalIssueDetails } from "./issueDetails";

const jiraIssue: IssueData = {
  id: "10012",
  key: "PROJ-12",
  title: "Login throws on empty password",
  description: "<p>Steps</p>",
  status: "In Progress",
  priority: "High",
  issueType: { id: "10001", name: "Bug", iconUrl: "https://j/bug.svg" },
  assignee: { id: "u1", name: "Ada" },
  reporter: { id: "u2", name: "Grace" },
  labels: ["auth"],
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  url: "https://example.atlassian.net/browse/PROJ-12",
};

const githubIssue: IssueData = {
  id: "7",
  key: "#7",
  title: "Crash on upload",
  description: "Steps to reproduce",
  status: "open",
  assignee: { id: "ada", name: "ada", avatarUrl: "https://gh/ada.png" },
  assignees: [
    { id: "ada", name: "ada", avatarUrl: "https://gh/ada.png" },
    { id: "grace", name: "grace" },
  ],
  labels: ["bug", "P1"],
  labelColors: { bug: "d73a4a" },
  milestone: { id: "3", name: "v1.2", state: "open", dueDate: "2026-11-17" },
  commentCount: 4,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  url: "https://github.com/acme/app/issues/7",
};

describe("toExternalIssueDetails", () => {
  it("keeps the fields the Jira popover has always shown", () => {
    const details = toExternalIssueDetails(jiraIssue, "JIRA");

    expect(details).toMatchObject({
      key: "PROJ-12",
      summary: "Login throws on empty password",
      description: "<p>Steps</p>",
      status: { name: "In Progress", color: "blue" },
      priority: { name: "High" },
      assignee: { displayName: "Ada" },
      reporter: { displayName: "Grace" },
      issueType: { name: "Bug", iconUrl: "https://j/bug.svg" },
      updated: "2026-10-02T00:00:00.000Z",
    });
    expect(details.assignees).toEqual([{ displayName: "Ada" }]);
    expect(details.milestone).toBeNull();
    expect(details.commentCount).toBeNull();
  });

  it.each([
    ["Done", "green"],
    ["To Do", "yellow"],
    ["Blocked", "gray"],
  ])("colours the Jira status %s as before", (status, color) => {
    expect(
      toExternalIssueDetails({ ...jiraIssue, status }, "JIRA").status.color
    ).toBe(color);
  });

  it("carries labels, milestone, every assignee and the comment count", () => {
    const details = toExternalIssueDetails(githubIssue, "GITHUB");

    expect(details.labels).toEqual(["bug", "P1"]);
    expect(details.labelColors).toEqual({ bug: "d73a4a" });
    expect(details.milestone).toEqual({
      name: "v1.2",
      state: "open",
      dueDate: "2026-11-17",
    });
    expect(details.assignees).toEqual([
      { displayName: "ada", avatarUrl: "https://gh/ada.png" },
      { displayName: "grace", avatarUrl: undefined },
    ]);
    expect(details.commentCount).toBe(4);
    expect(details.priority).toBeNull();
    expect(details.issueType).toEqual({ name: "Issue" });
    expect(details.status).toEqual({ name: "open", color: "blue" });
    expect(
      toExternalIssueDetails({ ...githubIssue, status: "closed" }, "GITHUB")
        .status.color
    ).toBe("green");
  });

  it("falls back to the id when the tracker has no key and nulls what it lacks", () => {
    const details = toExternalIssueDetails(
      {
        id: "42",
        title: "Bare",
        status: "new",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      },
      "REDMINE"
    );

    expect(details.key).toBe("42");
    expect(details.url).toBeNull();
    expect(details.assignee).toBeNull();
    expect(details.assignees).toEqual([]);
    expect(details.labels).toEqual([]);
    expect(details.status.color).toBe("gray");
  });
});
