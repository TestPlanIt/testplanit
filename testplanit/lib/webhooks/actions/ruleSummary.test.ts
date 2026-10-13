import { describe, expect, it, vi } from "vitest";
import {
  describeCreateRunRule,
  describeDraftCasesRule,
  draftFolderNote,
} from "./ruleSummary";

const db = {
  executionTarget: {
    findUnique: vi.fn().mockResolvedValue({ name: "Nightly CI" }),
  },
};

describe("describeCreateRunRule", () => {
  it("names the trigger, the action, the score and the target", async () => {
    expect(
      await describeCreateRunRule(db, {
        trigger: "CODE_PULL_REQUEST",
        minScore: 90,
        autoExecute: { targetId: 4 },
      })
    ).toBe(
      "Pull requests → Create Test Run · Minimum score: 90 · Target: Nightly CI"
    );
  });

  it("names the pushed branch, or the default branch when it isn't known", async () => {
    expect(
      await describeCreateRunRule(db, { trigger: "CODE_PUSH", branch: "main" })
    ).toBe("Pushes to main → Create Test Run");
    expect(await describeCreateRunRule(db, { trigger: "CODE_PUSH" })).toBe(
      "Pushes to the default branch → Create Test Run"
    );
  });

  it("falls back to the target id when the target is gone", async () => {
    db.executionTarget.findUnique.mockResolvedValueOnce(null);
    expect(
      await describeCreateRunRule(db, {
        trigger: "CODE_BRANCH_PUSH",
        autoExecute: { targetId: 9 },
      })
    ).toBe("Pushes to other branches → Create Test Run · Target: 9");
  });

  it("names a tracker rule's trigger and the statuses the issue entered", async () => {
    expect(
      await describeCreateRunRule(db, {
        trigger: "ISSUE_STATUS_ENTERED",
        statuses: ["Ready for QA"],
      })
    ).toBe("Issue status changes → Create Test Run · Ready for QA");
    expect(
      await describeCreateRunRule(db, {
        trigger: "ISSUE_STATUS_ENTERED",
        statuses: ["Ready", "In Review"],
        autoExecute: { targetId: 4 },
      })
    ).toBe(
      "Issue status changes → Create Test Run · Ready, In Review · Target: Nightly CI"
    );
  });

  it("names the other tracker triggers, leaving out an empty status list", async () => {
    expect(await describeCreateRunRule(db, { trigger: "ISSUE_CREATED" })).toBe(
      "Issue created → Create Test Run"
    );
    expect(
      await describeCreateRunRule(db, { trigger: "ISSUE_EVENT", statuses: [] })
    ).toBe("Any issue event → Create Test Run");
  });

  it("says nothing for a job queued before rules carried their trigger", async () => {
    expect(await describeCreateRunRule(db, {})).toBeNull();
  });
});

describe("describeDraftCasesRule", () => {
  it("names the trigger, the action and the statuses", async () => {
    expect(
      await describeDraftCasesRule({
        trigger: "ISSUE_STATUS_ENTERED",
        statuses: ["Ready", "In Test"],
      })
    ).toBe(
      "Issue status changes → Generate Test Cases with AI · Ready, In Test"
    );
    expect(await describeDraftCasesRule({ trigger: "ISSUE_CREATED" })).toBe(
      "Issue created → Generate Test Cases with AI"
    );
    expect(await describeDraftCasesRule({ trigger: null })).toBeNull();
  });
});

describe("draftFolderNote", () => {
  it("says which webhook and rule fill the folder, what it filters on, and what the drafts take", async () => {
    const note = await draftFolderNote({
      webhook: { name: null, adapterType: "JIRA" },
      ruleLine: "Issue status changes → Generate Test Cases with AI · Ready",
      filter: {
        statuses: ["Ready"],
        issueTypeIds: ["1", "2"],
        issueTypeNames: { "1": "Bug", "2": "Bug" },
        labels: ["qa"],
        requirementsOnly: true,
      },
      templateName: "Functional",
      stateName: "Review",
    });
    expect(
      note.content?.map((p) => p.content?.map((n) => n.text).join(""))
    ).toEqual([
      "Test cases drafted automatically by the Jira inbound webhook webhook.",
      "Action: Issue status changes → Generate Test Cases with AI · Ready",
      "Statuses: Ready",
      "Issue types: Bug",
      "Labels: qa",
      "Requirements only",
      "Template: Functional · State: Review",
      "Drafted by the System user; each case is linked to the issue it was drafted from.",
    ]);
  });

  it("uses the webhook's own name when it has one", async () => {
    const note = await draftFolderNote({
      webhook: { name: "Tracker hook", adapterType: "GITHUB" },
      ruleLine: "Issue created → Generate Test Cases with AI",
      filter: {},
      templateName: "Functional",
      stateName: "Active",
    });
    expect(note.content?.[0]?.content?.[0]?.text).toBe(
      "Test cases drafted automatically by the Tracker hook webhook."
    );
    expect(note.content).toHaveLength(4);
  });
});
