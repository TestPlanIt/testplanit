import { describe, expect, it } from "vitest";

import { buildSyncedIssueData } from "./SyncService";

// buildSyncedIssueData is the contract for what SyncService writes into
// Issue.data on create/update. Keep its shape stable: downstream consumers
// (auto-tag's content-extractor) read `labels` and `components` arrays by
// key. Drift here breaks those reads silently.

describe("buildSyncedIssueData", () => {
  it("captures labels, components, and the tracker creation instant from a fully-populated IssueData", () => {
    const trackerCreatedAt = new Date("2024-03-05T10:00:00.000Z");
    expect(
      buildSyncedIssueData({
        id: "10001",
        title: "Login flow broken",
        status: "Open",
        createdAt: trackerCreatedAt,
        updatedAt: new Date(),
        labels: ["regression", "ui"],
        components: ["Auth", "Frontend"],
      })
    ).toEqual({
      labels: ["regression", "ui"],
      components: ["Auth", "Frontend"],
      // The TRACKER's own creation date — the local row's createdAt is
      // import time, the wrong answer for "uncovered since".
      createdAt: "2024-03-05T10:00:00.000Z",
    });
  });

  it("omits createdAt when the adapter supplied none or an invalid date", () => {
    const base = {
      id: "10001",
      title: "No creation date",
      status: "Open",
      updatedAt: new Date(),
    } as any;
    expect(buildSyncedIssueData(base)).toEqual({
      labels: [],
      components: [],
    });
    expect(
      buildSyncedIssueData({ ...base, createdAt: new Date("nonsense") })
    ).toEqual({ labels: [], components: [] });
  });

  it("defaults labels and components to empty arrays when missing", () => {
    expect(
      buildSyncedIssueData({
        id: "10001",
        title: "No taxonomy assigned",
        status: "Open",
        createdAt: new Date("2024-03-05T10:00:00.000Z"),
        updatedAt: new Date(),
      })
    ).toEqual({
      labels: [],
      components: [],
      createdAt: "2024-03-05T10:00:00.000Z",
    });
  });

  it("defaults to empty arrays when labels/components are non-array values", () => {
    // Defensive: a malformed adapter response shouldn't write a
    // non-array into Issue.data and crash the extractor's
    // Array.isArray(...) guard downstream.
    expect(
      buildSyncedIssueData({
        id: "10001",
        title: "Defensive",
        status: "Open",
        createdAt: new Date("2024-03-05T10:00:00.000Z"),
        updatedAt: new Date(),
        labels: "not-an-array" as any,
        components: { name: "Auth" } as any,
      })
    ).toEqual({
      labels: [],
      components: [],
      createdAt: "2024-03-05T10:00:00.000Z",
    });
  });

  it("does not leak unrelated IssueData fields into the persisted payload", () => {
    // Issue.data is the non-customfield tracker metadata; customFields
    // belong in externalData. priority/type/status are scalar columns.
    // Anything else IssueData carries (assignee, reporter, description,
    // etc.) is not part of this contract.
    expect(
      buildSyncedIssueData({
        id: "10001",
        title: "Leakage check",
        status: "Open",
        priority: "High",
        description: "Long body...",
        createdAt: new Date("2024-03-05T10:00:00.000Z"),
        updatedAt: new Date(),
        labels: ["a"],
        components: ["B"],
        customFields: { customfield_10001: "x" },
        assignee: { id: "u1", name: "U", email: "u@x" },
      })
    ).toEqual({
      labels: ["a"],
      components: ["B"],
      createdAt: "2024-03-05T10:00:00.000Z",
    });
  });
});
