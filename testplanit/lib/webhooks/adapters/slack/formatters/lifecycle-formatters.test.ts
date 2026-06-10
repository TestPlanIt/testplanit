import { describe, expect, it } from "vitest";

import type { OutboundEnvelope } from "../../types";
import { formatTestRunCreatedBlocks } from "./test-run-created";
import { formatSessionCreatedBlocks } from "./session-created";
import { formatSessionDuplicatedBlocks } from "./session-duplicated";
import { formatSessionStateChangedBlocks } from "./session-state-changed";
import { formatSessionResultAddedBlocks } from "./session-result-added";
import { formatIterationResultRecordedBlocks } from "./iteration-result-recorded";
import { formatIssueDeletedBlocks } from "./issue-deleted";

/**
 * Lifecycle / informational formatters that previously fell through to the
 * raw-JSON generic fallback. Each consumes the resolved-name payload its
 * emitter produces.
 */

function env(data: Record<string, unknown>): OutboundEnvelope {
  return {
    eventId: "evt_test",
    eventName: "x",
    eventTimestamp: "2026-06-10T12:00:00.000Z",
    tenantId: null,
    projectId: 1,
    projectName: "Demo Project",
    actorUserId: null,
    data,
  };
}

describe("test_run.created", () => {
  it("links the run and shows the resolved state", () => {
    const { body } = formatTestRunCreatedBlocks(
      env({
        runId: 9,
        runTitle: "Smoke",
        projectId: 1,
        stateName: "In Progress",
      })
    );
    expect(JSON.parse(body).text).toBe("Test run created: Smoke");
    expect(body).toContain("/projects/runs/1/9");
    expect(body).toContain("*State:* In Progress");
  });
});

describe("session.created", () => {
  it("links the session and shows the resolved state", () => {
    const { body } = formatSessionCreatedBlocks(
      env({
        sessionId: 7,
        sessionName: "Explore",
        projectId: 1,
        stateName: "New",
      })
    );
    expect(JSON.parse(body).text).toBe("Session created: Explore");
    expect(body).toContain("/projects/sessions/1/7");
    expect(body).toContain("*State:* New");
  });
});

describe("session.duplicated", () => {
  it("links the new session and references the source", () => {
    const { body } = formatSessionDuplicatedBlocks(
      env({
        newSessionId: 8,
        sourceSessionId: 7,
        sessionName: "Explore (copy)",
        projectId: 1,
      })
    );
    expect(JSON.parse(body).text).toBe("Session duplicated: Explore (copy)");
    expect(body).toContain("/projects/sessions/1/8");
    expect(body).toContain("Duplicated from <");
  });
});

describe("session.state_changed", () => {
  it("renders from → to using resolved state names", () => {
    const { body } = formatSessionStateChangedBlocks(
      env({
        sessionId: 7,
        sessionName: "Explore",
        projectId: 1,
        from: { stateName: "In Progress" },
        to: { stateName: "Done" },
      })
    );
    expect(body).toContain("*In Progress*  →  *Done*");
  });
});

describe("session.result_added", () => {
  it("shows the resolved status and links via the envelope projectId", () => {
    const { body } = formatSessionResultAddedBlocks(
      env({ sessionId: 7, sessionName: "Explore", statusName: "Failed" })
    );
    expect(JSON.parse(body).text).toBe("Session result added: Failed");
    expect(body).toContain("/projects/sessions/1/7");
    expect(body).toContain("*Status:* Failed");
  });
});

describe("iteration.result.recorded", () => {
  it("shows status, 1-based row, and parameter values", () => {
    const { body } = formatIterationResultRecordedBlocks(
      env({
        testRunId: 5,
        projectId: 1,
        statusName: "Passed",
        runTitle: "Regression",
        rowIndex: 2,
        redactedValues: { currency: "EUR", region: "[REDACTED]" },
      })
    );
    expect(body).toContain("/projects/runs/1/5");
    expect(body).toContain("*Status:* Passed · Row 3");
    expect(body).toContain("currency=EUR");
    expect(body).toContain("region=[REDACTED]");
  });
});

describe("issue.deleted", () => {
  it("renders a red card with the title", () => {
    const { body } = formatIssueDeletedBlocks(
      env({ id: 4, title: "Checkout bug", projectId: 1 })
    );
    const payload = JSON.parse(body);
    expect(payload.text).toBe("Issue deleted: Checkout bug");
    expect(payload.attachments[0].color).toBe("#ef4444");
  });

  it("falls back to name then id when no title", () => {
    expect(
      JSON.parse(formatIssueDeletedBlocks(env({ id: 4, projectId: 1 })).body)
        .text
    ).toBe("Issue deleted: Issue #4");
  });
});
