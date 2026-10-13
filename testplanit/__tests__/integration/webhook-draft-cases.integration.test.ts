/**
 * Live-DB proof of the Draft test cases action's persist path: with the
 * model stubbed, the drafted cases land in the rule's folder and state,
 * linked to the issue and created by the System user, and the rule's log
 * names the folder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("~/app/api/llm/generate-test-cases/core", () => ({
  generateTestCasesForProject: mocks.generate,
}));
vi.mock("~/lib/services/jira-panel-generation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/services/jira-panel-generation")
  >()),
  // The project has no model on a scratch database; the generator is stubbed.
  getProjectReadiness: async () => ({
    hasRepository: true,
    hasDefaultWorkflow: true,
    hasActiveLlm: true,
  }),
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const STAMP = `dc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeIntegration("Webhook actions: drafted cases (live DB)", () => {
  let db: any;
  let runDraftCases: typeof import("~/lib/webhooks/actions/draftCases").runDraftCases;

  const fx = {
    creatorId: "",
    projectId: 0,
    templateId: 0,
    stateId: 0,
    webhookConfigId: "",
    actionId: "",
    deliveryId: "",
    issueId: 0,
  };

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
    ({ rawDb: db } = await import("~/lib/rawDb"));
    ({ runDraftCases } = await import("~/lib/webhooks/actions/draftCases"));

    const system = await db.user.findUnique({
      where: { id: SYSTEM_AUTOMATION_USER_ID },
      select: { id: true },
    });
    if (!system) throw new Error("Seed the database first (System user)");
    const creator = await db.user.findFirst({
      where: { access: "ADMIN", id: { not: SYSTEM_AUTOMATION_USER_ID } },
      select: { id: true },
    });
    fx.creatorId = creator.id;

    const project = await db.projects.create({
      data: { name: `Draft cases ${STAMP}`, createdBy: fx.creatorId },
      select: { id: true },
    });
    fx.projectId = project.id;
    await db.repositories.create({ data: { projectId: fx.projectId } });
    const workflows = await db.workflows.findMany({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      select: { id: true, isDefault: true },
    });
    for (const w of workflows) {
      await db.projectWorkflowAssignment.create({
        data: { workflowId: w.id, projectId: fx.projectId },
      });
    }
    // A state that isn't the default, so the rule's choice shows.
    fx.stateId = workflows.find((w: any) => !w.isDefault)!.id;
    const template = await db.templates.findFirst({
      where: { isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    fx.templateId = template.id;
    await db.templateProjectAssignment
      .create({ data: { templateId: fx.templateId, projectId: fx.projectId } })
      .catch(() => {});

    const issue = await db.issue.create({
      data: {
        name: `DC-1-${STAMP}`,
        title: `Drafting issue ${STAMP}`,
        description: "Totals are wrong",
        status: "To Do",
        projectId: fx.projectId,
        createdById: fx.creatorId,
      },
      select: { id: true },
    });
    fx.issueId = issue.id;

    const webhook = await db.webhookConfig.create({
      data: {
        projectId: fx.projectId,
        adapterType: "JIRA",
        direction: "INBOUND",
        token: `tok-${STAMP}`,
        secret: "unused",
      },
      select: { id: true },
    });
    fx.webhookConfigId = webhook.id;
    const action = await db.webhookAction.create({
      data: {
        webhookConfigId: webhook.id,
        projectId: fx.projectId,
        order: 0,
        trigger: "ISSUE_CREATED",
        action: "DRAFT_CASES",
        options: {
          templateId: fx.templateId,
          stateId: fx.stateId,
          quantity: "couple",
          notifyUserIds: [fx.creatorId],
        },
      },
      select: { id: true },
    });
    fx.actionId = action.id;
    const delivery = await db.webhookDelivery.create({
      data: {
        webhookConfigId: webhook.id,
        direction: "INBOUND",
        adapterType: "JIRA",
        eventType: "jira:issue_created",
        payloadDigest: `digest-${STAMP}`,
      },
      select: { id: true },
    });
    fx.deliveryId = delivery.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.notification
      .deleteMany({ where: { type: "CASES_DRAFTED", userId: fx.creatorId } })
      .catch(() => {});
    if (fx.projectId) {
      await db.projects
        .delete({ where: { id: fx.projectId } })
        .catch((e: unknown) => console.warn("cleanup project", e));
    }
  });

  it("persists the drafts in the rule's folder and state, linked to the issue, as the System user", async () => {
    mocks.generate.mockResolvedValue({
      ok: true,
      testCases: [
        { id: "a", name: `Totals add up ${STAMP}`, fieldValues: {} },
        { id: "b", name: `Discount applies ${STAMP}`, fieldValues: {} },
      ],
      metadata: {},
    });

    const result = await runDraftCases(db, {
      deliveryId: fx.deliveryId,
      webhookConfigId: fx.webhookConfigId,
      webhookActionId: fx.actionId,
      projectId: fx.projectId,
      issueId: fx.issueId,
    });
    expect(result).toMatchObject({ outcome: "cases_drafted", caseCount: 2 });
    if (result.outcome !== "cases_drafted") return;

    // The folder is named after the rule and carries a note about it.
    const folder = await db.repositoryFolders.findUnique({
      where: { id: result.folderId },
      select: { name: true, projectId: true, parentId: true, docs: true },
    });
    expect(folder).toMatchObject({
      name: "Issue created → Generate Test Cases with AI",
      projectId: fx.projectId,
      parentId: null,
    });
    const note = JSON.stringify(folder.docs);
    expect(note).toContain("Jira inbound webhook");
    expect(note).toContain("Issue created → Generate Test Cases with AI");
    expect(note).toContain("System user");

    const cases = await db.repositoryCases.findMany({
      where: { folderId: result.folderId },
      orderBy: { order: "asc" },
      select: {
        name: true,
        stateId: true,
        templateId: true,
        creatorId: true,
        caseIssues: { select: { issueId: true } },
      },
    });
    expect(cases.map((c: any) => c.name)).toEqual([
      `Totals add up ${STAMP}`,
      `Discount applies ${STAMP}`,
    ]);
    for (const c of cases) {
      expect(c.stateId).toBe(fx.stateId);
      expect(c.templateId).toBe(fx.templateId);
      expect(c.creatorId).toBe(SYSTEM_AUTOMATION_USER_ID);
      expect(c.caseIssues).toEqual([{ issueId: fx.issueId }]);
    }

    const log = await db.webhookActionLog.findFirst({
      where: { webhookActionId: fx.actionId },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toMatchObject({
      outcome: "cases_drafted",
      caseCount: 2,
      folderId: result.folderId,
      issueId: fx.issueId,
      deliveryId: fx.deliveryId,
    });

    // A second firing finds the linked cases and leaves them alone.
    expect(
      await runDraftCases(db, {
        deliveryId: fx.deliveryId,
        webhookConfigId: fx.webhookConfigId,
        webhookActionId: fx.actionId,
        projectId: fx.projectId,
        issueId: fx.issueId,
      })
    ).toEqual({ outcome: "has_cases" });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
