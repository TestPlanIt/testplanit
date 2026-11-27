import { describe, expect, it } from "vitest";
import { eventLabelKey } from "./webhook-event-labels";

describe("eventLabelKey", () => {
  it("labels GitHub's own event names on a GitHub delivery", () => {
    expect(eventLabelKey("issues", "GITHUB")).toBe("events.githubIssues");
    expect(eventLabelKey("issue_comment", "GITHUB")).toBe(
      "events.githubIssueComment"
    );
  });

  it.each(["GITEA", "GITLAB", "BITBUCKET"])(
    "shows the same event names as received on a %s delivery",
    (adapterType) => {
      for (const eventType of [
        "issues",
        "issue_comment",
        "push",
        "pull_request",
      ]) {
        expect(eventLabelKey(eventType, adapterType)).toBeNull();
      }
    }
  );

  it("keeps the GitHub label when the adapter is not known", () => {
    expect(eventLabelKey("issues")).toBe("events.githubIssues");
    expect(eventLabelKey("issues", null)).toBe("events.githubIssues");
  });

  it("labels events that belong to one sender whatever adapter is passed", () => {
    expect(eventLabelKey("jira:issue_updated", "JIRA")).toBe(
      "events.jiraIssueUpdated"
    );
    expect(eventLabelKey("test_run.completed", "GENERIC_HMAC")).toBe(
      "events.testRunCompleted"
    );
    expect(eventLabelKey("webhook.test", "GITEA")).toBe("events.webhookTest");
  });

  it("returns nothing for an unknown or missing event type", () => {
    expect(eventLabelKey("milestone_milestoned", "GITEA")).toBeNull();
    expect(eventLabelKey(null, "GITHUB")).toBeNull();
    expect(eventLabelKey(undefined)).toBeNull();
  });
});
