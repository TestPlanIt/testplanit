/**
 * Live-DB proof for the webhook Actions server actions
 * (app/actions/webhook-actions.ts) on the real hooked client: rule
 * validation against the webhook it belongs to, append order, scoping of
 * update / enable / delete / reorder to the webhook and project, log rows
 * surviving their rule's deletion, and the DataChangeLog actor for
 * WebhookAction writes (WebhookAction is a GUC model, and the audit ALS frame
 * must reach the plugin).
 *
 * Only the session and the manage-webhooks check are mocked.
 *
 * Skipped by default; opt in with RUN_DB_INTEGRATION=1 + DATABASE_URL (a
 * seeded scratch database — never ew).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const auth = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; name?: string; email?: string };
  },
  canManage: true,
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(async () => auth.session),
}));
vi.mock("~/lib/webhooks/auth", () => ({
  canManageWebhookConfig: vi.fn(async () => auth.canManage),
}));
vi.mock("~/utils/encryption", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/encryption")>()),
  encrypt: vi.fn(async (text: string) => `enc:${text}`),
}));

const STAMP = `wasa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeIntegration("Webhook action server actions (live DB)", () => {
  let baseDb: any;
  let actions: typeof import("~/app/actions/webhook-actions");
  let runWithAuditContext: typeof import("~/lib/auditContext").runWithAuditContext;
  let webhookConfig: typeof import("~/app/actions/webhook-config");

  const fx = {
    userId: "",
    projectId: 0,
    otherProjectId: 0,
    freshProjectIds: [] as number[],
    codeRepositoryId: 0,
    repoWebhookId: "",
    repoWebhook2Id: "",
    trackerWebhookId: "",
    outboundWebhookId: "",
    otherProjectWebhookId: "",
    targetId: 0,
    disabledTargetId: 0,
  };

  async function cdcRows(table: string, pk: string) {
    return baseDb.$queryRawUnsafe(
      `SELECT "table", op, pk, actor FROM "DataChangeLog"
        WHERE "table" = $1 AND pk = $2 ORDER BY seq`,
      table,
      pk
    );
  }

  async function makeWebhook(
    projectId: number,
    opts: {
      codeRepositoryConfigId?: number | null;
      direction?: "INBOUND" | "OUTBOUND";
      adapterType?: string;
    }
  ): Promise<string> {
    const row = await baseDb.webhookConfig.create({
      data: {
        projectId,
        adapterType: opts.adapterType ?? "GITHUB",
        direction: opts.direction ?? "INBOUND",
        token: `tok-${STAMP}-${Math.random().toString(36).slice(2)}`,
        secret: "unused",
        codeRepositoryConfigId: opts.codeRepositoryConfigId ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }

  const pr = (overrides: Record<string, unknown> = {}) => ({
    projectId: fx.projectId,
    webhookConfigId: fx.repoWebhookId,
    trigger: "CODE_PULL_REQUEST" as const,
    action: "CREATE_RUN" as const,
    ...overrides,
  });

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
    ({ baseDb } = await import("~/lib/db"));
    actions = await import("~/app/actions/webhook-actions");
    webhookConfig = await import("~/app/actions/webhook-config");
    ({ runWithAuditContext } = await import("~/lib/auditContext"));

    const user = await baseDb.user.findFirst({
      where: { access: "ADMIN", id: { not: "system-automation-user" } },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new Error("Seed the database first");
    fx.userId = user.id;
    auth.session = {
      user: { id: user.id, name: user.name, email: user.email },
    };

    const project = await baseDb.projects.create({
      data: { name: `wasa-${STAMP}`, createdBy: user.id },
      select: { id: true },
    });
    fx.projectId = project.id;
    const other = await baseDb.projects.create({
      data: { name: `wasa-other-${STAMP}`, createdBy: user.id },
      select: { id: true },
    });
    fx.otherProjectId = other.id;

    const codeRepo = await baseDb.codeRepository.create({
      data: { name: `wasa-repo-${STAMP}`, provider: "GITHUB", credentials: {} },
      select: { id: true },
    });
    fx.codeRepositoryId = codeRepo.id;
    const codeConfig = await baseDb.projectCodeRepositoryConfig.create({
      data: {
        projectId: fx.projectId,
        repositoryId: codeRepo.id,
        purpose: "IMPACT",
        pathPatterns: [],
      },
      select: { id: true },
    });
    const otherCodeConfig = await baseDb.projectCodeRepositoryConfig.create({
      data: {
        projectId: fx.otherProjectId,
        repositoryId: codeRepo.id,
        purpose: "IMPACT",
        pathPatterns: [],
      },
      select: { id: true },
    });

    fx.repoWebhookId = await makeWebhook(fx.projectId, {
      codeRepositoryConfigId: codeConfig.id,
    });
    fx.repoWebhook2Id = await makeWebhook(fx.projectId, {
      codeRepositoryConfigId: codeConfig.id,
    });
    fx.trackerWebhookId = await makeWebhook(fx.projectId, {
      adapterType: "JIRA",
    });
    fx.outboundWebhookId = await makeWebhook(fx.projectId, {
      direction: "OUTBOUND",
    });
    fx.otherProjectWebhookId = await makeWebhook(fx.otherProjectId, {
      codeRepositoryConfigId: otherCodeConfig.id,
    });

    const target = await baseDb.executionTarget.create({
      data: {
        projectId: fx.projectId,
        name: `CI ${STAMP}`,
        provider: "GENERIC_WEBHOOK",
        url: "https://ci.example.com/hook",
        createdById: user.id,
      },
      select: { id: true },
    });
    fx.targetId = target.id;
    const disabled = await baseDb.executionTarget.create({
      data: {
        projectId: fx.projectId,
        name: `Off ${STAMP}`,
        provider: "GENERIC_WEBHOOK",
        url: "https://ci.example.com/off",
        isEnabled: false,
        createdById: user.id,
      },
      select: { id: true },
    });
    fx.disabledTargetId = disabled.id;
  });

  afterAll(async () => {
    if (!baseDb) return;
    for (const id of [fx.projectId, fx.otherProjectId, ...fx.freshProjectIds]) {
      if (!id) continue;
      await baseDb.projects
        .delete({ where: { id } })
        .catch((e: unknown) => console.warn("cleanup project", id, e));
    }
    if (fx.codeRepositoryId) {
      await baseDb.codeRepository
        .delete({ where: { id: fx.codeRepositoryId } })
        .catch(() => {});
    }
  });

  it("refuses without a session or without the right to manage webhooks", async () => {
    const saved = auth.session;
    auth.session = null;
    try {
      expect(await actions.saveWebhookAction(pr())).toEqual({
        success: false,
        error: "Unauthorized",
      });
    } finally {
      auth.session = saved;
    }
    auth.canManage = false;
    try {
      expect(await actions.saveWebhookAction(pr())).toEqual({
        success: false,
        error: "Forbidden",
      });
    } finally {
      auth.canManage = true;
    }
    expect(
      await baseDb.webhookAction.count({
        where: { webhookConfigId: fx.repoWebhookId },
      })
    ).toBe(0);
  });

  it("creates repository rules in append order, storing the options in their stored form", async () => {
    const first = await actions.saveWebhookAction(
      pr({ webhookConfigId: fx.repoWebhook2Id, options: { minScore: 80 } })
    );
    const second = await actions.saveWebhookAction(
      pr({
        webhookConfigId: fx.repoWebhook2Id,
        trigger: "CODE_PUSH",
        options: { minScore: 50, includeChildIssues: true },
        isEnabled: false,
      })
    );
    expect(first).toMatchObject({ success: true, id: expect.any(String) });
    expect(second).toMatchObject({ success: true, id: expect.any(String) });
    if (!first.success || !second.success) throw new Error("save failed");

    const rows = await baseDb.webhookAction.findMany({
      where: { webhookConfigId: fx.repoWebhook2Id },
      orderBy: { order: "asc" },
    });
    expect(
      rows.map((r: any) => [
        r.id,
        r.order,
        r.trigger,
        r.action,
        r.isEnabled,
        r.projectId,
        r.options,
        r.filter,
      ])
    ).toEqual([
      [
        first.id,
        0,
        "CODE_PULL_REQUEST",
        "CREATE_RUN",
        true,
        fx.projectId,
        { minScore: 80 },
        {},
      ],
      [
        second.id,
        1,
        "CODE_PUSH",
        "CREATE_RUN",
        false,
        fx.projectId,
        // Repository rules don't take child issues.
        { minScore: 50 },
        {},
      ],
    ]);
  });

  it("validates the trigger, action and options against the webhook", async () => {
    expect(
      await actions.saveWebhookAction(pr({ trigger: "ISSUE_CREATED" }))
    ).toEqual({
      success: false,
      error: "This webhook can't use that trigger",
    });
    expect(
      await actions.saveWebhookAction(pr({ action: "IMPORT_ISSUE" }))
    ).toEqual({
      success: false,
      error: "That action isn't available for this trigger",
    });
    expect(
      await actions.saveWebhookAction(pr({ options: { minScore: 150 } }))
    ).toEqual({ success: false, error: "The action's options are not valid" });
    expect(
      await actions.saveWebhookAction({
        projectId: fx.projectId,
        webhookConfigId: fx.trackerWebhookId,
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
      })
    ).toEqual({
      success: false,
      error: "This webhook can't use that trigger",
    });
    expect(
      await actions.saveWebhookAction({
        projectId: fx.projectId,
        webhookConfigId: fx.trackerWebhookId,
        trigger: "ISSUE_CREATED",
        action: "CREATE_RUN",
        filter: { statuses: "Done" },
      })
    ).toEqual({ success: false, error: "The filter is not valid" });
    // A webhook of another project, or an outbound one, is not found.
    expect(
      await actions.saveWebhookAction(
        pr({ webhookConfigId: fx.otherProjectWebhookId })
      )
    ).toEqual({ success: false, error: "Webhook not found" });
    expect(
      await actions.saveWebhookAction(
        pr({ webhookConfigId: fx.outboundWebhookId })
      )
    ).toEqual({ success: false, error: "Webhook not found" });
    expect(
      await baseDb.webhookAction.count({
        where: {
          webhookConfigId: {
            in: [
              fx.repoWebhookId,
              fx.trackerWebhookId,
              fx.otherProjectWebhookId,
              fx.outboundWebhookId,
            ],
          },
        },
      })
    ).toBe(0);
  });

  it("stores a tracker rule's compacted filter and drops a minimum score", async () => {
    const saved = await actions.saveWebhookAction({
      projectId: fx.projectId,
      webhookConfigId: fx.trackerWebhookId,
      trigger: "ISSUE_STATUS_ENTERED",
      action: "CREATE_RUN",
      filter: { statuses: ["Ready", "Ready", "QA"], labels: [] },
      options: { minScore: 50, includeChildIssues: true },
    });
    if (!saved.success) throw new Error(saved.error);
    const row = await baseDb.webhookAction.findUnique({
      where: { id: saved.id },
    });
    expect(row.filter).toEqual({ statuses: ["Ready", "QA"] });
    expect(row.options).toEqual({ includeChildIssues: true });
  });

  it("checks the auto-execute target is a live, enabled target of the project", async () => {
    expect(
      await actions.saveWebhookAction(
        pr({ options: { autoExecute: { targetId: 2_000_000_000 } } })
      )
    ).toEqual({ success: false, error: "Execution target not found" });
    expect(
      await actions.saveWebhookAction(
        pr({ options: { autoExecute: { targetId: fx.disabledTargetId } } })
      )
    ).toEqual({ success: false, error: "Execution target is disabled" });
    const ok = await actions.saveWebhookAction(
      pr({ options: { autoExecute: { targetId: fx.targetId, ref: "" } } })
    );
    if (!ok.success) throw new Error(ok.error);
    const row = await baseDb.webhookAction.findUnique({ where: { id: ok.id } });
    expect(row.options).toEqual({ autoExecute: { targetId: fx.targetId } });
  });

  it("updates a rule only through the webhook it belongs to", async () => {
    const created = await actions.saveWebhookAction(
      pr({ options: { minScore: 10 } })
    );
    if (!created.success) throw new Error(created.error);

    expect(
      await actions.saveWebhookAction(
        pr({
          id: created.id,
          webhookConfigId: fx.repoWebhook2Id,
          options: { minScore: 99 },
        })
      )
    ).toEqual({ success: false, error: "Webhook action not found" });
    let row = await baseDb.webhookAction.findUnique({
      where: { id: created.id },
    });
    expect(row.options).toEqual({ minScore: 10 });

    expect(
      await actions.saveWebhookAction(
        pr({
          id: created.id,
          trigger: "CODE_BRANCH_PUSH",
          options: { minScore: 70 },
        })
      )
    ).toEqual({ success: true, id: created.id });
    row = await baseDb.webhookAction.findUnique({ where: { id: created.id } });
    expect(row).toMatchObject({
      trigger: "CODE_BRANCH_PUSH",
      options: { minScore: 70 },
      webhookConfigId: fx.repoWebhookId,
    });
  });

  it("turns a rule on and off within its project only", async () => {
    const created = await actions.saveWebhookAction(pr());
    if (!created.success) throw new Error(created.error);

    expect(
      await actions.setWebhookActionEnabled({
        projectId: fx.projectId,
        id: created.id!,
        isEnabled: false,
      })
    ).toEqual({ success: true, id: created.id });
    expect(
      (await baseDb.webhookAction.findUnique({ where: { id: created.id } }))
        .isEnabled
    ).toBe(false);

    expect(
      await actions.setWebhookActionEnabled({
        projectId: fx.otherProjectId,
        id: created.id!,
        isEnabled: true,
      })
    ).toEqual({ success: false, error: "Webhook action not found" });
    expect(
      (await baseDb.webhookAction.findUnique({ where: { id: created.id } }))
        .isEnabled
    ).toBe(false);
  });

  it("reorders a webhook's rules and ignores ids it doesn't own", async () => {
    const webhookConfigId = await makeWebhook(fx.projectId, {
      codeRepositoryConfigId: (
        await baseDb.webhookConfig.findUnique({
          where: { id: fx.repoWebhookId },
          select: { codeRepositoryConfigId: true },
        })
      ).codeRepositoryConfigId,
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const saved = await actions.saveWebhookAction(pr({ webhookConfigId }));
      if (!saved.success) throw new Error(saved.error);
      ids.push(saved.id!);
    }
    const foreign = await actions.saveWebhookAction(
      pr({ webhookConfigId: fx.repoWebhook2Id })
    );
    if (!foreign.success) throw new Error(foreign.error);
    const foreignOrder = (
      await baseDb.webhookAction.findUnique({ where: { id: foreign.id } })
    ).order;

    expect(
      await actions.reorderWebhookActions({
        projectId: fx.projectId,
        webhookConfigId,
        orderedIds: [ids[2], foreign.id!, ids[0], ids[1]],
      })
    ).toEqual({ success: true });

    const rows = await baseDb.webhookAction.findMany({
      where: { webhookConfigId },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    expect(rows).toEqual([
      { id: ids[2], order: 0 },
      { id: ids[0], order: 2 },
      { id: ids[1], order: 3 },
    ]);
    expect(
      (await baseDb.webhookAction.findUnique({ where: { id: foreign.id } }))
        .order
    ).toBe(foreignOrder);

    expect(
      await actions.reorderWebhookActions({
        projectId: fx.otherProjectId,
        webhookConfigId,
        orderedIds: [ids[0]],
      })
    ).toEqual({ success: false, error: "Webhook not found" });
  });

  it("deletes a rule but keeps its log rows, detached", async () => {
    const created = await actions.saveWebhookAction(pr());
    if (!created.success) throw new Error(created.error);
    const log = await baseDb.webhookActionLog.create({
      data: {
        webhookActionId: created.id,
        webhookConfigId: fx.repoWebhookId,
        projectId: fx.projectId,
        outcome: "run_created",
        caseCount: 3,
      },
      select: { id: true },
    });

    expect(
      await actions.deleteWebhookAction({
        projectId: fx.otherProjectId,
        id: created.id!,
      })
    ).toEqual({ success: false, error: "Webhook action not found" });
    expect(
      await baseDb.webhookAction.findUnique({ where: { id: created.id } })
    ).not.toBeNull();

    expect(
      await actions.deleteWebhookAction({
        projectId: fx.projectId,
        id: created.id!,
      })
    ).toEqual({ success: true });
    expect(
      await baseDb.webhookAction.findUnique({ where: { id: created.id } })
    ).toBeNull();
    const kept = await baseDb.webhookActionLog.findUnique({
      where: { id: log.id },
    });
    expect(kept).toMatchObject({
      webhookActionId: null,
      webhookConfigId: fx.repoWebhookId,
      outcome: "run_created",
      caseCount: 3,
    });
  });

  it("attributes WebhookAction CDC rows to the acting user", async () => {
    const created = await actions.saveWebhookAction(
      pr({ options: { minScore: 5 } })
    );
    if (!created.success) throw new Error(created.error);
    await actions.setWebhookActionEnabled({
      projectId: fx.projectId,
      id: created.id!,
      isEnabled: false,
    });
    await actions.deleteWebhookAction({
      projectId: fx.projectId,
      id: created.id!,
    });
    const rows = await cdcRows("WebhookAction", created.id!);
    expect(rows.map((r: any) => [r.op, r.actor])).toEqual([
      ["I", fx.userId],
      ["U", fx.userId],
      ["D", fx.userId],
    ]);

    // A direct write on the hooked client inside an audit frame.
    const actor = await baseDb.user.findFirst({
      where: {
        access: "USER",
        id: { notIn: [fx.userId, "system-automation-user"] },
      },
      select: { id: true },
    });
    const actorId = actor?.id ?? fx.userId;
    // Awaited inside the frame: a ZenStack query is lazy and runs when awaited.
    const direct = await runWithAuditContext(
      { userId: actorId },
      async () =>
        await baseDb.webhookAction.create({
          data: {
            webhookConfigId: fx.repoWebhookId,
            projectId: fx.projectId,
            trigger: "CODE_PUSH",
            action: "CREATE_RUN",
          },
          select: { id: true },
        })
    );
    const directRows = await cdcRows("WebhookAction", direct.id);
    expect(directRows.map((r: any) => [r.op, r.actor])).toEqual([
      ["I", actorId],
    ]);
  });
  describe("creating an inbound webhook seeds its rules", () => {
    async function freshProject() {
      const project = await baseDb.projects.create({
        data: {
          name: `wasa-fresh-${STAMP}-${fx.freshProjectIds.length}`,
          createdBy: fx.userId,
        },
        select: { id: true },
      });
      fx.freshProjectIds.push(project.id);
      const config = await baseDb.projectCodeRepositoryConfig.create({
        data: {
          projectId: project.id,
          repositoryId: fx.codeRepositoryId,
          purpose: "IMPACT",
          pathPatterns: [],
        },
        select: { id: true },
      });
      return {
        projectId: project.id as number,
        codeConfigId: config.id as number,
      };
    }

    async function rulesOf(webhookConfigId: string) {
      return baseDb.webhookAction.findMany({
        where: { webhookConfigId },
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          trigger: true,
          action: true,
          projectId: true,
          isEnabled: true,
        },
      });
    }

    it("a repository webhook gets one Create test run rule per chosen event, in trigger order, kept on rotation", async () => {
      const { projectId, codeConfigId } = await freshProject();
      const created = await webhookConfig.createOrRotateCodeRepositoryWebhook({
        projectId,
        codeRepositoryConfigId: codeConfigId,
        triggers: ["CODE_BRANCH_PUSH", "CODE_PULL_REQUEST", "ISSUE_CREATED"],
        baseBranch: "develop",
      });
      expect(created).toMatchObject({ success: true });
      if (!created.success) throw new Error(created.error);
      const configId = (created as { configId: string }).configId;

      const config = await baseDb.webhookConfig.findUnique({
        where: { id: configId },
        select: {
          adapterType: true,
          direction: true,
          baseBranch: true,
          codeRepositoryConfigId: true,
          secret: true,
        },
      });
      expect(config).toMatchObject({
        adapterType: "GITHUB",
        direction: "INBOUND",
        baseBranch: "develop",
        codeRepositoryConfigId: codeConfigId,
      });
      expect(config.secret).toMatch(/^enc:/);

      const rules = await rulesOf(configId);
      expect(
        rules.map((r: any) => [
          r.order,
          r.trigger,
          r.action,
          r.projectId,
          r.isEnabled,
        ])
      ).toEqual([
        [0, "CODE_PULL_REQUEST", "CREATE_RUN", projectId, true],
        [1, "CODE_BRANCH_PUSH", "CREATE_RUN", projectId, true],
      ]);
      // Nested creates are attributed to the admin who made the webhook.
      for (const rule of rules) {
        const cdc = await cdcRows("WebhookAction", rule.id);
        expect(cdc.map((r: any) => [r.op, r.actor])).toEqual([
          ["I", fx.userId],
        ]);
      }

      const rotated = await webhookConfig.createOrRotateCodeRepositoryWebhook({
        projectId,
        codeRepositoryConfigId: codeConfigId,
        triggers: ["CODE_PUSH"],
      });
      expect(rotated).toMatchObject({ success: true, configId });
      expect((await rulesOf(configId)).map((r: any) => r.id)).toEqual(
        rules.map((r: any) => r.id)
      );
    });

    it("a repository webhook without chosen events gets the default pull request and push rules", async () => {
      const { projectId, codeConfigId } = await freshProject();
      const created = await webhookConfig.createOrRotateCodeRepositoryWebhook({
        projectId,
        codeRepositoryConfigId: codeConfigId,
      });
      if (!created.success) throw new Error(created.error);
      const rules = await rulesOf((created as { configId: string }).configId);
      expect(rules.map((r: any) => [r.order, r.trigger, r.action])).toEqual([
        [0, "CODE_PULL_REQUEST", "CREATE_RUN"],
        [1, "CODE_PUSH", "CREATE_RUN"],
      ]);
    });

    it("a tracker webhook gets the Import issue rule, once", async () => {
      const { projectId } = await freshProject();
      const created = await webhookConfig.createOrRotateInboundWebhook({
        projectId,
        adapterType: "JIRA",
      });
      expect(created).toMatchObject({ success: true });
      if (!created.success) throw new Error(created.error);
      const configId = (created as { configId: string }).configId;
      const rules = await rulesOf(configId);
      expect(
        rules.map((r: any) => [r.order, r.trigger, r.action, r.projectId])
      ).toEqual([[0, "ISSUE_EVENT", "IMPORT_ISSUE", projectId]]);

      const rotated = await webhookConfig.createOrRotateInboundWebhook({
        projectId,
        adapterType: "JIRA",
      });
      expect(rotated).toMatchObject({ success: true, configId });
      expect((await rulesOf(configId)).map((r: any) => r.id)).toEqual([
        rules[0].id,
      ]);
    });
  });
});
