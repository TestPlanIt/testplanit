import { describe, expect, it } from "vitest";
import {
  issueMatchesFilter,
  statusChanged,
  trackerRuleFires,
  type IssueChange,
  type IssueFacts,
} from "./trackerRules";

const issue = (overrides: Partial<IssueFacts> = {}): IssueFacts => ({
  status: "Ready for QA",
  issueTypeId: "10001",
  labels: ["Backend", "qa"],
  isRequirement: false,
  ...overrides,
});

const created: IssueChange = { created: true, statusChanged: false };
const moved: IssueChange = { created: false, statusChanged: true };
const edited: IssueChange = { created: false, statusChanged: false };

describe("issueMatchesFilter", () => {
  it("matches every issue when the filter is empty or unreadable", () => {
    expect(issueMatchesFilter({}, issue())).toBe(true);
    expect(issueMatchesFilter(null, issue())).toBe(true);
    expect(issueMatchesFilter(undefined, issue({ status: null }))).toBe(true);
    expect(
      issueMatchesFilter(
        { statuses: [], issueTypeIds: [], labels: [] },
        issue()
      )
    ).toBe(true);
    // An unparseable stored filter acts as no filter.
    expect(issueMatchesFilter({ statuses: "Ready" }, issue())).toBe(true);
  });

  it("matches statuses ignoring case and surrounding space", () => {
    expect(issueMatchesFilter({ statuses: ["ready for qa"] }, issue())).toBe(
      true
    );
    expect(
      issueMatchesFilter({ statuses: ["Done", "Ready For QA"] }, issue())
    ).toBe(true);
    expect(
      issueMatchesFilter({ statuses: ["Ready"] }, issue({ status: " READY " }))
    ).toBe(true);
    expect(issueMatchesFilter({ statuses: ["Done"] }, issue())).toBe(false);
    expect(
      issueMatchesFilter({ statuses: ["Done"] }, issue({ status: null }))
    ).toBe(false);
  });

  it("matches issue types by id", () => {
    expect(issueMatchesFilter({ issueTypeIds: ["10001"] }, issue())).toBe(true);
    expect(issueMatchesFilter({ issueTypeIds: ["10002"] }, issue())).toBe(
      false
    );
    expect(
      issueMatchesFilter(
        { issueTypeIds: ["10001"] },
        issue({ issueTypeId: null })
      )
    ).toBe(false);
    expect(
      issueMatchesFilter(
        { issueTypeIds: ["Story"] },
        issue({ issueTypeId: "story" })
      )
    ).toBe(true);
  });

  it("matches when any one label is listed, ignoring case", () => {
    expect(issueMatchesFilter({ labels: ["QA"] }, issue())).toBe(true);
    expect(
      issueMatchesFilter({ labels: ["frontend", "backend"] }, issue())
    ).toBe(true);
    expect(issueMatchesFilter({ labels: ["frontend"] }, issue())).toBe(false);
    expect(issueMatchesFilter({ labels: ["qa"] }, issue({ labels: [] }))).toBe(
      false
    );
  });

  it("takes only requirements when requirementsOnly is set", () => {
    expect(issueMatchesFilter({ requirementsOnly: true }, issue())).toBe(false);
    expect(
      issueMatchesFilter(
        { requirementsOnly: true },
        issue({ isRequirement: true })
      )
    ).toBe(true);
    expect(issueMatchesFilter({ requirementsOnly: false }, issue())).toBe(true);
  });

  it("requires every list that has values to match", () => {
    const filter = {
      statuses: ["Ready for QA"],
      issueTypeIds: ["10001"],
      labels: ["qa"],
    };
    expect(issueMatchesFilter(filter, issue())).toBe(true);
    expect(issueMatchesFilter(filter, issue({ labels: ["ops"] }))).toBe(false);
    expect(issueMatchesFilter(filter, issue({ issueTypeId: "1" }))).toBe(false);
    expect(issueMatchesFilter(filter, issue({ status: "Done" }))).toBe(false);
  });
});

describe("trackerRuleFires", () => {
  it("ISSUE_EVENT fires on any event that passes the filter", () => {
    const rule = { trigger: "ISSUE_EVENT" as const, filter: {} };
    expect(trackerRuleFires(rule, created, issue())).toBe(true);
    expect(trackerRuleFires(rule, moved, issue())).toBe(true);
    expect(trackerRuleFires(rule, edited, issue())).toBe(true);
    expect(
      trackerRuleFires(
        { trigger: "ISSUE_EVENT", filter: { labels: ["none"] } },
        edited,
        issue()
      )
    ).toBe(false);
  });

  it("ISSUE_CREATED fires only for an issue new to TestPlanIt", () => {
    const rule = { trigger: "ISSUE_CREATED" as const, filter: {} };
    expect(trackerRuleFires(rule, created, issue())).toBe(true);
    expect(trackerRuleFires(rule, moved, issue())).toBe(false);
    expect(trackerRuleFires(rule, edited, issue())).toBe(false);
    expect(
      trackerRuleFires(
        { trigger: "ISSUE_CREATED", filter: { requirementsOnly: true } },
        created,
        issue()
      )
    ).toBe(false);
  });

  it("ISSUE_STATUS_ENTERED fires when the issue moves into a listed status", () => {
    const rule = {
      trigger: "ISSUE_STATUS_ENTERED" as const,
      filter: { statuses: ["ready for qa"] },
    };
    expect(trackerRuleFires(rule, moved, issue())).toBe(true);
    expect(trackerRuleFires(rule, moved, issue({ status: "Done" }))).toBe(
      false
    );
    // An edit that didn't change the status doesn't re-enter it.
    expect(trackerRuleFires(rule, edited, issue())).toBe(false);
  });

  it("ISSUE_STATUS_ENTERED fires for an issue created directly in a listed status", () => {
    const rule = {
      trigger: "ISSUE_STATUS_ENTERED" as const,
      filter: { statuses: ["Ready for QA"] },
    };
    expect(trackerRuleFires(rule, created, issue())).toBe(true);
    expect(trackerRuleFires(rule, created, issue({ status: "To Do" }))).toBe(
      false
    );
  });

  it("a status rule without statuses never fires", () => {
    for (const filter of [{}, { statuses: [] }, null]) {
      const rule = { trigger: "ISSUE_STATUS_ENTERED" as const, filter };
      expect(trackerRuleFires(rule, moved, issue())).toBe(false);
      expect(trackerRuleFires(rule, created, issue())).toBe(false);
    }
  });

  it("a repository trigger never fires for a tracker event", () => {
    expect(
      trackerRuleFires({ trigger: "CODE_PUSH", filter: {} }, created, issue())
    ).toBe(false);
  });
});

describe("statusChanged", () => {
  it("compares statuses ignoring case and surrounding space", () => {
    expect(statusChanged("To Do", "In Progress")).toBe(true);
    expect(statusChanged("Ready", " ready ")).toBe(false);
    expect(statusChanged("Ready", "Ready")).toBe(false);
  });

  it("treats a missing status as empty", () => {
    expect(statusChanged(null, null)).toBe(false);
    expect(statusChanged(null, "")).toBe(false);
    expect(statusChanged(null, "Ready")).toBe(true);
    expect(statusChanged("Ready", null)).toBe(true);
  });
});
