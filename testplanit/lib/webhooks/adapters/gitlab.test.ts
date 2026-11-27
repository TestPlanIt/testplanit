import { describe, expect, it } from "vitest";
import { gitlabAdapter } from "./gitlab";
import type { ParsedWebhookPayload } from "./types";

const SECRET = "shared-token";

const project = { path_with_namespace: "testplanit/sample-app" };

function verify(event: string, body: unknown, token: string | null = SECRET) {
  const headers = new Headers({ "x-gitlab-event": event });
  if (token !== null) headers.set("x-gitlab-token", token);
  return gitlabAdapter.verify(
    Buffer.from(JSON.stringify(body), "utf8"),
    headers,
    SECRET
  );
}

function parsed(event: string, body: unknown): ParsedWebhookPayload {
  const result = verify(event, body);
  if (!result.valid) throw new Error(`expected valid, got ${result.reason}`);
  return result.payload;
}

function milestoneEvent(action: string) {
  return {
    object_kind: "milestone",
    event_type: "milestone",
    project,
    group: null,
    object_attributes: {
      id: 4,
      iid: 3,
      title: "Hook check",
      state: action === "close" ? "closed" : "active",
      due_date: "2027-02-01",
      start_date: null,
      project_id: 1,
    },
    action,
  };
}

function issueUpdate(changes: Record<string, unknown>) {
  return {
    object_kind: "issue",
    event_type: "issue",
    project,
    object_attributes: {
      id: 55,
      iid: 5,
      state: "opened",
      action: "update",
      milestone_id: 4,
    },
    changes,
  };
}

describe("gitlabAdapter.verify", () => {
  it("rejects a delivery without the token header", () => {
    expect(verify("Issue Hook", issueUpdate({}), null)).toEqual({
      valid: false,
      reason: "missing-signature",
    });
  });

  it("rejects a delivery whose token differs", () => {
    expect(verify("Issue Hook", issueUpdate({}), "other-token")).toEqual({
      valid: false,
      reason: "signature-mismatch",
    });
  });

  it("keeps the header value as the event type for an issue edit", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({ title: { previous: "a", current: "b" } })
    );

    expect(payload.eventType).toBe("Issue Hook");
    expect(payload.issueKey).toBe("testplanit/sample-app#5");
    expect(payload.externalStatus).toBe("opened");
  });

  it.each([
    ["create", "milestone_created"],
    ["close", "milestone_closed"],
    ["reopen", "milestone_opened"],
    ["delete", "milestone_deleted"],
  ])("names a milestone %s event %s", (action, eventType) => {
    const payload = parsed("Milestone Hook", milestoneEvent(action));

    expect(payload.eventType).toBe(eventType);
    expect(payload.issueKey).toBe("");
  });

  it("leaves a milestone action it does not know under the header value", () => {
    expect(parsed("Milestone Hook", milestoneEvent("archive")).eventType).toBe(
      "Milestone Hook"
    );
  });

  it("treats an issue update that only sets the milestone as joining it", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({
        milestone_id: { previous: null, current: 4 },
        updated_at: { previous: "x", current: "y" },
        updated_by_id: { previous: null, current: 1 },
      })
    );

    expect(payload.eventType).toBe("milestone_milestoned");
  });

  it("treats an issue update that only clears the milestone as leaving it", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({
        milestone_id: { previous: 4, current: null },
        updated_at: { previous: "x", current: "y" },
      })
    );

    expect(payload.eventType).toBe("milestone_demilestoned");
  });

  it("keeps an update that also edits the issue as an issue event", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({
        milestone_id: { previous: null, current: 4 },
        title: { previous: "a", current: "b" },
      })
    );

    expect(payload.eventType).toBe("Issue Hook");
  });
});

describe("gitlabAdapter.extractMilestoneEventRef", () => {
  it("identifies the milestone of a milestone event by its id", () => {
    const payload = parsed("Milestone Hook", milestoneEvent("close"));

    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toEqual({
      kind: "RELEASE",
      externalId: "testplanit/sample-app#4",
      externalProjectId: "testplanit/sample-app",
      merge: false,
    });
  });

  it("identifies the milestone an issue joined", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({ milestone_id: { previous: null, current: 4 } })
    );

    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toEqual({
      kind: "RELEASE",
      externalId: "testplanit/sample-app#4",
      externalProjectId: "testplanit/sample-app",
      merge: false,
    });
  });

  it("names both milestones when an issue moves from one to another", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({ milestone_id: { previous: 2, current: 4 } })
    );

    expect(payload.eventType).toBe("milestone_milestoned");
    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toEqual({
      kind: "RELEASE",
      externalId: "testplanit/sample-app#4",
      externalProjectId: "testplanit/sample-app",
      merge: false,
      movedFromExternalId: "testplanit/sample-app#2",
    });
  });

  it("identifies the milestone an issue left", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({ milestone_id: { previous: 4, current: null } })
    );

    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toEqual({
      kind: "RELEASE",
      externalId: "testplanit/sample-app#4",
      externalProjectId: "testplanit/sample-app",
      merge: false,
    });
  });

  it("returns nothing for an issue event", () => {
    const payload = parsed(
      "Issue Hook",
      issueUpdate({ title: { previous: "a", current: "b" } })
    );

    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toBeNull();
  });

  it("returns nothing when the event names no project", () => {
    const payload = parsed("Milestone Hook", {
      ...milestoneEvent("close"),
      project: null,
    });

    expect(
      gitlabAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toBeNull();
  });
});

describe("gitlabAdapter.extractExternalStatus", () => {
  it("reads the issue state from an issue event only", () => {
    const issue = parsed(
      "Issue Hook",
      issueUpdate({ title: { previous: "a", current: "b" } })
    );
    const milestone = parsed("Milestone Hook", milestoneEvent("close"));

    expect(gitlabAdapter.extractExternalStatus(issue, issue.eventType)).toBe(
      "opened"
    );
    expect(
      gitlabAdapter.extractExternalStatus(milestone, milestone.eventType)
    ).toBeNull();
  });
});
