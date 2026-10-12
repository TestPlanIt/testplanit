import { describe, expect, it } from "vitest";
import {
  ACTIONS_BY_TRIGGER,
  AVAILABLE_ACTIONS,
  DEFAULT_REPOSITORY_TRIGGERS,
  REPOSITORY_TRIGGERS,
  TRACKER_TRIGGERS,
  availableActionsFor,
  isRepositoryTrigger,
  parseWebhookAction,
  readCreateRunOptions,
  readDraftCasesOptions,
  readWebhookActionFilter,
  triggersFor,
} from "./schemas";

describe("webhook action triggers", () => {
  it("splits triggers by webhook source", () => {
    expect(triggersFor("repository")).toBe(REPOSITORY_TRIGGERS);
    expect(triggersFor("tracker")).toBe(TRACKER_TRIGGERS);
    expect(isRepositoryTrigger("CODE_PUSH")).toBe(true);
    expect(isRepositoryTrigger("ISSUE_CREATED")).toBe(false);
  });

  it("defaults new repository webhooks to pull requests and base-branch pushes", () => {
    expect([...DEFAULT_REPOSITORY_TRIGGERS]).toEqual([
      "CODE_PULL_REQUEST",
      "CODE_PUSH",
    ]);
  });

  it("lets repository triggers only create runs and issue events only import", () => {
    for (const trigger of REPOSITORY_TRIGGERS) {
      expect(ACTIONS_BY_TRIGGER[trigger]).toEqual(["CREATE_RUN"]);
    }
    expect(ACTIONS_BY_TRIGGER.ISSUE_EVENT).toEqual(["IMPORT_ISSUE"]);
  });
});

describe("availableActionsFor", () => {
  it("offers only the actions this version performs", () => {
    expect([...AVAILABLE_ACTIONS]).toEqual(["IMPORT_ISSUE", "CREATE_RUN"]);
    expect(availableActionsFor("ISSUE_EVENT")).toEqual(["IMPORT_ISSUE"]);
    expect(availableActionsFor("ISSUE_CREATED")).toEqual([
      "IMPORT_ISSUE",
      "CREATE_RUN",
    ]);
    expect(availableActionsFor("ISSUE_STATUS_ENTERED")).toEqual([
      "IMPORT_ISSUE",
      "CREATE_RUN",
    ]);
    for (const trigger of REPOSITORY_TRIGGERS) {
      expect(availableActionsFor(trigger)).toEqual(["CREATE_RUN"]);
    }
    // Drafting cases is a trigger's action, just not available yet.
    expect(ACTIONS_BY_TRIGGER.ISSUE_CREATED).toContain("DRAFT_CASES");
  });
});

describe("parseWebhookAction", () => {
  it("refuses a trigger from the other kind of webhook", () => {
    expect(
      parseWebhookAction("repository", {
        trigger: "ISSUE_CREATED",
        action: "CREATE_RUN",
      })
    ).toEqual({ ok: false, error: "trigger_not_allowed" });
    expect(
      parseWebhookAction("tracker", {
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
      })
    ).toEqual({ ok: false, error: "trigger_not_allowed" });
  });

  it("refuses an action the trigger cannot perform", () => {
    expect(
      parseWebhookAction("repository", {
        trigger: "CODE_PUSH",
        action: "DRAFT_CASES",
      })
    ).toEqual({ ok: false, error: "action_not_allowed" });
    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_EVENT",
        action: "CREATE_RUN",
      })
    ).toEqual({ ok: false, error: "action_not_allowed" });
  });

  it("compacts a tracker filter: trimmed, deduplicated, empty lists and false flags dropped", () => {
    const result = parseWebhookAction("tracker", {
      trigger: "ISSUE_STATUS_ENTERED",
      action: "IMPORT_ISSUE",
      filter: {
        statuses: [" Ready ", "Ready", "Done"],
        issueTypeIds: [],
        labels: ["qa", "qa"],
        requirementsOnly: false,
      },
    });
    expect(result).toEqual({
      ok: true,
      filter: { statuses: ["Ready", "Done"], labels: ["qa"] },
      options: {},
    });

    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_CREATED",
        action: "IMPORT_ISSUE",
        filter: { requirementsOnly: true },
      })
    ).toMatchObject({ ok: true, filter: { requirementsOnly: true } });
  });

  it("keeps issue type names only for the chosen issue types", () => {
    const result = parseWebhookAction("tracker", {
      trigger: "ISSUE_CREATED",
      action: "CREATE_RUN",
      filter: {
        issueTypeIds: ["10001", "10001", "10002"],
        issueTypeNames: { "10001": "Story", "10003": "Bug" },
      },
    });
    expect(result).toEqual({
      ok: true,
      filter: {
        issueTypeIds: ["10001", "10002"],
        issueTypeNames: { "10001": "Story" },
      },
      options: {},
    });

    // Names without any chosen type are dropped.
    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_CREATED",
        action: "IMPORT_ISSUE",
        filter: { issueTypeIds: [], issueTypeNames: { "10001": "Story" } },
      })
    ).toEqual({ ok: true, filter: {}, options: {} });
    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_CREATED",
        action: "IMPORT_ISSUE",
        filter: { issueTypeIds: ["9"], issueTypeNames: { "10001": "Story" } },
      })
    ).toEqual({ ok: true, filter: { issueTypeIds: ["9"] }, options: {} });
  });

  it("refuses an invalid tracker filter", () => {
    for (const filter of [
      { statuses: [""] },
      { labels: "qa" },
      { statuses: Array.from({ length: 51 }, (_, i) => `s${i}`) },
      { labels: ["x".repeat(256)] },
    ]) {
      expect(
        parseWebhookAction("tracker", {
          trigger: "ISSUE_CREATED",
          action: "IMPORT_ISSUE",
          filter,
        })
      ).toEqual({ ok: false, error: "invalid_filter" });
    }
  });

  it("ignores any filter on a repository rule", () => {
    expect(
      parseWebhookAction("repository", {
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
        filter: { statuses: ["Ready"], labels: 42 },
      })
    ).toEqual({ ok: true, filter: {}, options: {} });
  });

  it("keeps a repository rule's minimum score and drops child issues", () => {
    expect(
      parseWebhookAction("repository", {
        trigger: "CODE_PULL_REQUEST",
        action: "CREATE_RUN",
        options: { minScore: 70, includeChildIssues: true },
      })
    ).toEqual({ ok: true, filter: {}, options: { minScore: 70 } });
  });

  it("keeps a tracker rule's child issues and drops the minimum score", () => {
    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_CREATED",
        action: "CREATE_RUN",
        options: { minScore: 70, includeChildIssues: true },
      })
    ).toEqual({ ok: true, filter: {}, options: { includeChildIssues: true } });
  });

  it("keeps auto-execute with its ref and inputs, dropping an empty ref", () => {
    expect(
      parseWebhookAction("repository", {
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
        options: {
          autoExecute: { targetId: 4, ref: " release ", inputs: { env: "qa" } },
        },
      })
    ).toEqual({
      ok: true,
      filter: {},
      options: {
        autoExecute: { targetId: 4, ref: "release", inputs: { env: "qa" } },
      },
    });

    const blank = parseWebhookAction("repository", {
      trigger: "CODE_PUSH",
      action: "CREATE_RUN",
      options: { autoExecute: { targetId: 4, ref: "   " } },
    });
    expect(blank).toEqual({
      ok: true,
      filter: {},
      options: { autoExecute: { targetId: 4 } },
    });
  });

  it("refuses invalid options", () => {
    for (const options of [
      { minScore: 101 },
      { minScore: -1 },
      { minScore: 12.5 },
      { autoExecute: { targetId: 0 } },
      { autoExecute: { targetId: 4, inputs: { a: 1 } } },
      { autoExecute: { ref: "main" } },
    ]) {
      expect(
        parseWebhookAction("repository", {
          trigger: "CODE_PUSH",
          action: "CREATE_RUN",
          options,
        })
      ).toEqual({ ok: false, error: "invalid_options" });
    }
    for (const options of [
      { quantity: 0 },
      { quantity: 21 },
      { folderName: "" },
      { templateId: -1 },
      { notifyUserIds: [""] },
    ]) {
      expect(
        parseWebhookAction("tracker", {
          trigger: "ISSUE_CREATED",
          action: "DRAFT_CASES",
          options,
        })
      ).toEqual({ ok: false, error: "invalid_options" });
    }
  });

  it("accepts Draft cases options and strips unknown keys", () => {
    expect(
      parseWebhookAction("tracker", {
        trigger: "ISSUE_STATUS_ENTERED",
        action: "DRAFT_CASES",
        options: {
          templateId: 2,
          folderName: " Drafts ",
          quantity: 5,
          autoGenerateTags: true,
          notifyUserIds: ["u1"],
          notifyGroupIds: [3],
          unexpected: "x",
        },
      })
    ).toEqual({
      ok: true,
      filter: {},
      options: {
        templateId: 2,
        folderName: "Drafts",
        quantity: 5,
        autoGenerateTags: true,
        notifyUserIds: ["u1"],
        notifyGroupIds: [3],
      },
    });
  });
});

describe("read* helpers", () => {
  it("read stored options and filters back leniently", () => {
    expect(readCreateRunOptions({ minScore: 50 })).toEqual({ minScore: 50 });
    expect(readCreateRunOptions(null)).toEqual({});
    expect(readCreateRunOptions({ minScore: "high" })).toEqual({});
    expect(readCreateRunOptions("garbage")).toEqual({});

    expect(readDraftCasesOptions({ quantity: 3 })).toEqual({ quantity: 3 });
    expect(readDraftCasesOptions({ quantity: 99 })).toEqual({});
    expect(readDraftCasesOptions(undefined)).toEqual({});

    expect(readWebhookActionFilter({ labels: ["qa"] })).toEqual({
      labels: ["qa"],
    });
    expect(readWebhookActionFilter({ labels: 3 })).toEqual({});
    expect(readWebhookActionFilter(null)).toEqual({});
  });
});
