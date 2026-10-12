import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockCanManage, db, tx } = vi.hoisted(() => {
  const tx = { webhookAction: { updateMany: vi.fn() } };
  return {
    mockSession: vi.fn(),
    mockCanManage: vi.fn(),
    tx,
    db: {
      webhookConfig: { findFirst: vi.fn() },
      executionTarget: { findFirst: vi.fn() },
      projects: { findUnique: vi.fn() },
      projectIntegration: { findMany: vi.fn() },
      webhookAction: {
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockSession(),
}));
vi.mock("~/lib/webhooks/auth", () => ({
  canManageWebhookConfig: (...a: unknown[]) => mockCanManage(...a),
}));
vi.mock("~/lib/db", () => ({ baseDb: db }));
vi.mock("~/lib/auditContext", () => ({
  runWithAuditContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import {
  deleteWebhookAction,
  reorderWebhookActions,
  saveWebhookAction,
  setWebhookActionEnabled,
} from "./webhook-actions";

const repositoryHook = { id: "whc-1", codeRepositoryConfigId: 9 };
const trackerHook = { id: "whc-2", codeRepositoryConfigId: null };

const base = {
  projectId: 42,
  webhookConfigId: "whc-1",
  trigger: "CODE_PULL_REQUEST" as const,
  action: "CREATE_RUN" as const,
};

describe("saveWebhookAction — requirements only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({
      user: { id: "u1", name: "Admin", email: "a@x" },
    });
    mockCanManage.mockResolvedValue(true);
    db.webhookConfig.findFirst.mockResolvedValue(trackerHook);
    db.webhookAction.findFirst.mockResolvedValue(null);
    db.webhookAction.create.mockResolvedValue({ id: "act-new" });
  });

  const save = () =>
    saveWebhookAction({
      projectId: 42,
      webhookConfigId: "whc-2",
      trigger: "ISSUE_EVENT",
      action: "IMPORT_ISSUE",
      filter: { requirementsOnly: true },
    });
  const refused = {
    success: false,
    error: "This project doesn't classify issues as requirements",
  };

  it("refuses it when the project has requirements off", async () => {
    db.projects.findUnique.mockResolvedValue({ requirementsEnabled: false });
    expect(await save()).toEqual(refused);
    expect(db.webhookAction.create).not.toHaveBeenCalled();
  });

  it("refuses it when no integration names requirement types", async () => {
    db.projects.findUnique.mockResolvedValue({ requirementsEnabled: true });
    db.projectIntegration.findMany.mockResolvedValue([
      { config: { requirements: { enabled: false } } },
    ]);
    expect(await save()).toEqual(refused);
  });

  it("saves it when the project classifies requirements", async () => {
    db.projects.findUnique.mockResolvedValue({ requirementsEnabled: true });
    db.projectIntegration.findMany.mockResolvedValue([
      { config: { requirements: { enabled: true, issueTypeIds: ["1"] } } },
    ]);
    expect(await save()).toEqual({ success: true, id: "act-new" });
  });
});

describe("webhook-actions server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    });
    mockCanManage.mockResolvedValue(true);
    db.webhookConfig.findFirst.mockResolvedValue(repositoryHook);
    db.executionTarget.findFirst.mockResolvedValue({ isEnabled: true });
    db.webhookAction.findFirst.mockResolvedValue({ order: 2 });
    db.webhookAction.create.mockResolvedValue({ id: "act-new" });
    db.webhookAction.updateMany.mockResolvedValue({ count: 1 });
    db.webhookAction.deleteMany.mockResolvedValue({ count: 1 });
    tx.webhookAction.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("authorization", () => {
    it("returns Unauthorized without a session and touches nothing", async () => {
      mockSession.mockResolvedValue(null);
      for (const call of [
        () => saveWebhookAction(base),
        () =>
          setWebhookActionEnabled({ projectId: 42, id: "a", isEnabled: true }),
        () => deleteWebhookAction({ projectId: 42, id: "a" }),
        () =>
          reorderWebhookActions({
            projectId: 42,
            webhookConfigId: "whc-1",
            orderedIds: ["a"],
          }),
      ]) {
        expect(await call()).toEqual({ success: false, error: "Unauthorized" });
      }
      expect(mockCanManage).not.toHaveBeenCalled();
      expect(db.webhookConfig.findFirst).not.toHaveBeenCalled();
    });

    it("returns Forbidden when the user cannot manage the project's webhooks", async () => {
      mockCanManage.mockResolvedValue(false);
      for (const call of [
        () => saveWebhookAction(base),
        () =>
          setWebhookActionEnabled({ projectId: 42, id: "a", isEnabled: true }),
        () => deleteWebhookAction({ projectId: 42, id: "a" }),
        () =>
          reorderWebhookActions({
            projectId: 42,
            webhookConfigId: "whc-1",
            orderedIds: ["a"],
          }),
      ]) {
        expect(await call()).toEqual({ success: false, error: "Forbidden" });
      }
      expect(mockCanManage).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ id: "user-1" }),
        }),
        42
      );
      expect(db.webhookAction.updateMany).not.toHaveBeenCalled();
      expect(db.webhookAction.deleteMany).not.toHaveBeenCalled();
    });

    it("reports a failed auth check as a failed save", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockCanManage.mockRejectedValue(new Error("db"));
      expect(await saveWebhookAction(base)).toEqual({
        success: false,
        error: "Failed to save webhook action",
      });
    });
  });

  describe("saveWebhookAction", () => {
    it("refuses a webhook that is not an inbound webhook of the project", async () => {
      db.webhookConfig.findFirst.mockResolvedValue(null);
      expect(await saveWebhookAction(base)).toEqual({
        success: false,
        error: "Webhook not found",
      });
      expect(db.webhookConfig.findFirst).toHaveBeenCalledWith({
        where: { id: "whc-1", projectId: 42, direction: "INBOUND" },
        select: { id: true, codeRepositoryConfigId: true },
      });
      expect(db.webhookAction.create).not.toHaveBeenCalled();
    });

    it("validates the rule against the kind of webhook", async () => {
      expect(
        await saveWebhookAction({ ...base, trigger: "ISSUE_CREATED" })
      ).toEqual({
        success: false,
        error: "This webhook can't use that trigger",
      });

      db.webhookConfig.findFirst.mockResolvedValue(trackerHook);
      expect(
        await saveWebhookAction({
          ...base,
          webhookConfigId: "whc-2",
          trigger: "ISSUE_EVENT",
          action: "CREATE_RUN",
        })
      ).toEqual({
        success: false,
        error: "That action isn't available for this trigger",
      });
      expect(
        await saveWebhookAction({
          ...base,
          webhookConfigId: "whc-2",
          trigger: "ISSUE_CREATED",
          action: "IMPORT_ISSUE",
          filter: { statuses: [""] },
        })
      ).toEqual({ success: false, error: "The filter is not valid" });
      expect(
        await saveWebhookAction({
          ...base,
          webhookConfigId: "whc-2",
          trigger: "ISSUE_CREATED",
          action: "CREATE_RUN",
          options: { autoExecute: { targetId: "x" } },
        })
      ).toEqual({
        success: false,
        error: "The action's options are not valid",
      });
      // Drafting cases arrives in a later version; it can't be saved yet.
      expect(
        await saveWebhookAction({
          ...base,
          webhookConfigId: "whc-2",
          trigger: "ISSUE_CREATED",
          action: "DRAFT_CASES",
          options: { quantity: 5 },
        })
      ).toEqual({
        success: false,
        error: "That action isn't available for this trigger",
      });
      // Nor can an existing rule be switched to it.
      expect(
        await saveWebhookAction({
          ...base,
          id: "act-1",
          webhookConfigId: "whc-2",
          trigger: "ISSUE_STATUS_ENTERED",
          action: "DRAFT_CASES",
          filter: { statuses: ["Ready"] },
        })
      ).toEqual({
        success: false,
        error: "That action isn't available for this trigger",
      });
      expect(db.webhookAction.create).not.toHaveBeenCalled();
      expect(db.webhookAction.updateMany).not.toHaveBeenCalled();
    });

    it("creates a rule at the end of the webhook's list", async () => {
      const result = await saveWebhookAction({
        ...base,
        options: { minScore: 70, includeChildIssues: true },
      });

      expect(result).toEqual({ success: true, id: "act-new" });
      expect(db.webhookAction.findFirst).toHaveBeenCalledWith({
        where: { webhookConfigId: "whc-1" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      expect(db.webhookAction.create).toHaveBeenCalledWith({
        data: {
          trigger: "CODE_PULL_REQUEST",
          action: "CREATE_RUN",
          filter: {},
          options: { minScore: 70 },
          webhookConfigId: "whc-1",
          projectId: 42,
          order: 3,
        },
        select: { id: true },
      });
    });

    it("creates the first rule at order 0 and keeps an explicit enabled flag", async () => {
      db.webhookAction.findFirst.mockResolvedValue(null);
      await saveWebhookAction({ ...base, isEnabled: false });
      expect(db.webhookAction.create.mock.calls[0][0].data).toMatchObject({
        order: 0,
        isEnabled: false,
      });
    });

    it("saves a tracker rule's compacted filter", async () => {
      db.webhookConfig.findFirst.mockResolvedValue(trackerHook);
      await saveWebhookAction({
        projectId: 42,
        webhookConfigId: "whc-2",
        trigger: "ISSUE_STATUS_ENTERED",
        action: "IMPORT_ISSUE",
        filter: { statuses: ["Ready", "Ready"], labels: [] },
      });
      expect(db.webhookAction.create.mock.calls[0][0].data.filter).toEqual({
        statuses: ["Ready"],
      });
    });

    it("checks the auto-execute target is a live, enabled target of the project", async () => {
      const options = {
        autoExecute: { targetId: 4, ref: "main", inputs: { env: "qa" } },
      };
      expect(await saveWebhookAction({ ...base, options })).toEqual({
        success: true,
        id: "act-new",
      });
      expect(db.executionTarget.findFirst).toHaveBeenCalledWith({
        where: { id: 4, projectId: 42, isDeleted: false },
        select: { isEnabled: true },
      });
      expect(db.webhookAction.create.mock.calls[0][0].data.options).toEqual(
        options
      );

      db.executionTarget.findFirst.mockResolvedValueOnce(null);
      expect(await saveWebhookAction({ ...base, options })).toEqual({
        success: false,
        error: "Execution target not found",
      });

      db.executionTarget.findFirst.mockResolvedValueOnce({ isEnabled: false });
      expect(await saveWebhookAction({ ...base, options })).toEqual({
        success: false,
        error: "Execution target is disabled",
      });
      expect(db.webhookAction.create).toHaveBeenCalledTimes(1);
    });

    it("refuses invalid auto-execute inputs before looking up the target", async () => {
      const result = await saveWebhookAction({
        ...base,
        options: { autoExecute: { targetId: 4, inputs: { "bad key": "x" } } },
      });
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBeTruthy();
      expect(db.executionTarget.findFirst).not.toHaveBeenCalled();
      expect(db.webhookAction.create).not.toHaveBeenCalled();
    });

    it("updates a rule scoped to its webhook and project", async () => {
      const result = await saveWebhookAction({
        ...base,
        id: "act-1",
        trigger: "CODE_PUSH",
        options: { minScore: 10 },
        isEnabled: true,
      });

      expect(result).toEqual({ success: true, id: "act-1" });
      expect(db.webhookAction.updateMany).toHaveBeenCalledWith({
        where: { id: "act-1", webhookConfigId: "whc-1", projectId: 42 },
        data: {
          trigger: "CODE_PUSH",
          action: "CREATE_RUN",
          filter: {},
          options: { minScore: 10 },
          isEnabled: true,
        },
      });
      expect(db.webhookAction.create).not.toHaveBeenCalled();
    });

    it("reports a rule that is not the webhook's", async () => {
      db.webhookAction.updateMany.mockResolvedValue({ count: 0 });
      expect(await saveWebhookAction({ ...base, id: "act-other" })).toEqual({
        success: false,
        error: "Webhook action not found",
      });
    });

    it("reports a failed write", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      db.webhookAction.create.mockRejectedValue(new Error("db"));
      expect(await saveWebhookAction(base)).toEqual({
        success: false,
        error: "Failed to save webhook action",
      });
    });
  });

  describe("setWebhookActionEnabled", () => {
    it("toggles a rule of the project", async () => {
      expect(
        await setWebhookActionEnabled({
          projectId: 42,
          id: "act-1",
          isEnabled: false,
        })
      ).toEqual({ success: true, id: "act-1" });
      expect(db.webhookAction.updateMany).toHaveBeenCalledWith({
        where: { id: "act-1", projectId: 42 },
        data: { isEnabled: false },
      });
    });

    it("reports a rule outside the project", async () => {
      db.webhookAction.updateMany.mockResolvedValue({ count: 0 });
      expect(
        await setWebhookActionEnabled({
          projectId: 42,
          id: "x",
          isEnabled: true,
        })
      ).toEqual({ success: false, error: "Webhook action not found" });
    });
  });

  describe("deleteWebhookAction", () => {
    it("deletes a rule of the project", async () => {
      expect(await deleteWebhookAction({ projectId: 42, id: "act-1" })).toEqual(
        {
          success: true,
        }
      );
      expect(db.webhookAction.deleteMany).toHaveBeenCalledWith({
        where: { id: "act-1", projectId: 42 },
      });
    });

    it("reports a rule outside the project", async () => {
      db.webhookAction.deleteMany.mockResolvedValue({ count: 0 });
      expect(await deleteWebhookAction({ projectId: 42, id: "x" })).toEqual({
        success: false,
        error: "Webhook action not found",
      });
    });
  });

  describe("reorderWebhookActions", () => {
    it("numbers the given ids in order, each scoped to the webhook so foreign ids change nothing", async () => {
      tx.webhookAction.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      expect(
        await reorderWebhookActions({
          projectId: 42,
          webhookConfigId: "whc-1",
          orderedIds: ["act-2", "foreign", "act-1"],
        })
      ).toEqual({ success: true });

      expect(tx.webhookAction.updateMany.mock.calls.map((c) => c[0])).toEqual([
        {
          where: { id: "act-2", webhookConfigId: "whc-1" },
          data: { order: 0 },
        },
        {
          where: { id: "foreign", webhookConfigId: "whc-1" },
          data: { order: 1 },
        },
        {
          where: { id: "act-1", webhookConfigId: "whc-1" },
          data: { order: 2 },
        },
      ]);
    });

    it("refuses a webhook that is not the project's", async () => {
      db.webhookConfig.findFirst.mockResolvedValue(null);
      expect(
        await reorderWebhookActions({
          projectId: 42,
          webhookConfigId: "whc-other",
          orderedIds: ["act-1"],
        })
      ).toEqual({ success: false, error: "Webhook not found" });
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });
});
