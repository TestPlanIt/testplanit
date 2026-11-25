/**
 * Live-DB proof of keeping AI-drafted test cases current: with the model
 * stubbed, drafts land in the AI-draft state; a changed issue rewrites the
 * untouched drafts in place (same step rows, a new version), deletes the one
 * the issue no longer asks for, adds a new draft and raises a suggestion for
 * the reviewed case; the suggestion can then be applied or dismissed.
 *
 * Run against a seeded scratch database, never the default .env one:
 *   cd testplanit && DATABASE_URL=<scratch tpi_case_upkeep URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/case-upkeep.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), review: vi.fn() }));
vi.mock("~/app/api/llm/generate-test-cases/core", () => ({
  generateTestCasesForProject: mocks.generate,
}));
vi.mock("~/lib/services/caseUpkeep/review", () => ({
  reviewCasesAgainstIssue: mocks.review,
}));
vi.mock("~/lib/services/jira-panel-generation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/services/jira-panel-generation")
  >()),
  getProjectReadiness: async () => ({
    hasRepository: true,
    hasDefaultWorkflow: true,
    hasActiveLlm: true,
  }),
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const describeIntegration =
  RUN_INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const STAMP = `cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (doc: unknown) => JSON.stringify(doc);

describeIntegration("Keeping AI-drafted cases current (live DB)", () => {
  let db: any;
  let runDraftCases: typeof import("~/lib/webhooks/actions/draftCases").runDraftCases;
  let runUpdateCases: typeof import("~/lib/webhooks/actions/updateCases").runUpdateCases;
  let decideSuggestion: typeof import("~/lib/services/caseUpkeep/decide").decideSuggestion;
  let auditedTransaction: typeof import("~/lib/audit/auditedTransaction").auditedTransaction;

  const fx = {
    personId: "",
    projectId: 0,
    templateId: 0,
    stepsField: "",
    aiStateId: 0,
    activeStateId: 0,
    webhookConfigId: "",
    draftRuleId: "",
    updateRuleId: "",
    deliveryId: "",
    issueId: 0,
  };
  const ids = { a: 0, b: 0, c: 0, d: 0 };

  const job = (webhookActionId: string) => ({
    deliveryId: fx.deliveryId,
    webhookConfigId: fx.webhookConfigId,
    webhookActionId,
    projectId: fx.projectId,
    issueId: fx.issueId,
  });
  const readCase = (id: number) =>
    db.repositoryCases.findUnique({
      where: { id },
      select: {
        name: true,
        stateId: true,
        isDeleted: true,
        currentVersion: true,
        aiWrittenVersion: true,
        reviewedById: true,
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          select: { id: true, step: true, expectedResult: true },
        },
      },
    });
  const link = (caseId: number) =>
    db.repositoryCaseIssue.findUnique({
      where: { caseId_issueId: { caseId, issueId: fx.issueId } },
      select: { alignedAt: true },
    });
  const issueChangedAt = async (): Promise<Date> =>
    (
      await db.issue.findUnique({
        where: { id: fx.issueId },
        select: { contentUpdatedAt: true },
      })
    ).contentUpdatedAt;
  const changeIssue = async (description: string) => {
    await pause(20);
    await db.issue.update({
      where: { id: fx.issueId },
      data: { description },
    });
    await pause(20);
  };
  const answer = (decisions: unknown[], newCases: unknown[] = []) =>
    mocks.review.mockResolvedValueOnce({
      ok: true,
      decisions,
      newCases,
      problems: [],
    });

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
    ({ rawDb: db } = await import("~/lib/rawDb"));
    const rows: { name: string }[] =
      await db.$queryRaw`select current_database() as name`;
    const dbName = rows[0]?.name;
    if (dbName !== "tpi_case_upkeep" && dbName !== "tpi_test") {
      throw new Error(
        `Refusing to run against database "${dbName}": this suite only runs against tpi_case_upkeep or tpi_test.`
      );
    }
    ({ runDraftCases } = await import("~/lib/webhooks/actions/draftCases"));
    ({ runUpdateCases } = await import("~/lib/webhooks/actions/updateCases"));
    ({ decideSuggestion } = await import("~/lib/services/caseUpkeep/decide"));
    ({ auditedTransaction } = await import("~/lib/audit/auditedTransaction"));
    const system = await db.user.findUnique({
      where: { id: SYSTEM_AUTOMATION_USER_ID },
      select: { id: true },
    });
    if (!system) throw new Error("Seed the database first (System user)");
    const person = await db.user.findFirst({
      where: { access: "ADMIN", id: { not: SYSTEM_AUTOMATION_USER_ID } },
      select: { id: true },
    });
    fx.personId = person.id;

    const project = await db.projects.create({
      data: { name: `Case upkeep ${STAMP}`, createdBy: fx.personId },
      select: { id: true },
    });
    fx.projectId = project.id;
    await db.repositories.create({ data: { projectId: fx.projectId } });

    const iconAndColor = await db.workflows.findFirst({
      select: { iconId: true, colorId: true },
    });
    // The suite brings its own AI-draft state, so it also runs on a database
    // seeded before the state existed.
    const aiState = await db.workflows.create({
      data: {
        name: `AI drafts ${STAMP}`,
        scope: "CASES",
        isAiDraft: true,
        order: -1,
        ...iconAndColor,
      },
      select: { id: true },
    });
    fx.aiStateId = aiState.id;
    const states = await db.workflows.findMany({
      where: {
        scope: "CASES",
        isEnabled: true,
        isDeleted: false,
        OR: [{ isAiDraft: false }, { id: aiState.id }],
      },
      select: { id: true, isDefault: true, isAiDraft: true },
    });
    for (const state of states) {
      await db.projectWorkflowAssignment.create({
        data: { workflowId: state.id, projectId: fx.projectId },
      });
    }
    fx.activeStateId = states.find(
      (state: any) => !state.isDefault && !state.isAiDraft
    )!.id;

    const { loadTemplateData } =
      await import("~/lib/services/jira-panel-generation");
    const templates = await db.templates.findMany({
      where: { isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    for (const candidate of templates) {
      const loaded = await loadTemplateData(candidate.id, db);
      const steps = loaded?.template.fields.find(
        (field) => field.type === "Steps"
      );
      if (steps) {
        fx.templateId = candidate.id;
        fx.stepsField = steps.name;
        break;
      }
    }
    if (!fx.templateId) throw new Error("No seeded template has a Steps field");
    await db.templateProjectAssignment
      .create({ data: { templateId: fx.templateId, projectId: fx.projectId } })
      .catch(() => {});

    const issue = await db.issue.create({
      data: {
        name: `CU-1-${STAMP}`,
        title: `Checkout totals ${STAMP}`,
        description: "Totals are shown without tax",
        status: "To Do",
        projectId: fx.projectId,
        createdById: fx.personId,
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
    const rule = (trigger: string, action: string) =>
      db.webhookAction.create({
        data: {
          webhookConfigId: webhook.id,
          projectId: fx.projectId,
          order: 0,
          trigger,
          action,
          options:
            action === "DRAFT_CASES" ? { templateId: fx.templateId } : {},
        },
        select: { id: true },
      });
    fx.draftRuleId = (await rule("ISSUE_CREATED", "DRAFT_CASES")).id;
    fx.updateRuleId = (await rule("ISSUE_CONTENT_CHANGED", "UPDATE_CASES")).id;
    const delivery = await db.webhookDelivery.create({
      data: {
        webhookConfigId: webhook.id,
        direction: "INBOUND",
        adapterType: "JIRA",
        eventType: "jira:issue_updated",
        payloadDigest: `digest-${STAMP}`,
      },
      select: { id: true },
    });
    fx.deliveryId = delivery.id;
  });

  afterAll(async () => {
    if (!db) return;
    if (fx.projectId) {
      await db.projects
        .delete({ where: { id: fx.projectId } })
        .catch((e: unknown) => console.warn("cleanup project", e));
    }
    if (fx.aiStateId) {
      await db.workflows
        .delete({ where: { id: fx.aiStateId } })
        .catch((e: unknown) => console.warn("cleanup state", e));
    }
  });

  it("drafts into the project's AI-draft state and records the AI as the writer", async () => {
    const drafted = (name: string, step: string) => ({
      id: name,
      name: `${name} ${STAMP}`,
      fieldValues: {
        [fx.stepsField]: [
          { step, expectedResult: "Total is shown" },
          { step: "Close the cart", expectedResult: "Cart closes" },
        ],
      },
    });
    mocks.generate.mockResolvedValue({
      ok: true,
      testCases: [
        drafted("Totals add up", "Open the cart"),
        drafted("Remember me", "Tick Remember me"),
        drafted("Discount applies", "Apply a code"),
      ],
      metadata: {},
    });

    const result = await runDraftCases(db, job(fx.draftRuleId));
    expect(result).toMatchObject({ outcome: "cases_drafted", caseCount: 3 });

    const cases = await db.repositoryCases.findMany({
      where: { projectId: fx.projectId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        stateId: true,
        currentVersion: true,
        aiWrittenVersion: true,
        creatorId: true,
      },
    });
    expect(cases).toHaveLength(3);
    [ids.a, ids.b, ids.c] = cases.map((c: { id: number }) => c.id);
    for (const drafted of cases) {
      expect(drafted).toMatchObject({
        stateId: fx.aiStateId,
        currentVersion: 1,
        aiWrittenVersion: 1,
        creatorId: SYSTEM_AUTOMATION_USER_ID,
      });
      expect((await link(drafted.id)).alignedAt).toBeInstanceOf(Date);
    }
  });

  it("records the person who moves a draft out of the AI-draft state as its reviewer", async () => {
    await db.$transaction(async (tx: any) => {
      await tx.$executeRaw`select set_config('app.audit_context', ${JSON.stringify(
        { userId: fx.personId }
      )}, true)`;
      await tx.repositoryCases.update({
        where: { id: ids.c },
        data: { stateId: fx.activeStateId },
      });
    });
    expect((await readCase(ids.c)).reviewedById).toBe(fx.personId);
    expect((await readCase(ids.a)).reviewedById).toBeNull();
  });

  it("does nothing while the cases are aligned with the issue", async () => {
    expect(await runUpdateCases(db, job(fx.updateRuleId))).toEqual({
      outcome: "up_to_date",
    });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("rewrites, deletes, adds and suggests when the issue changes", async () => {
    const before = await readCase(ids.a);
    await changeIssue("Totals must include tax. Remember me is dropped.");

    const withTax = {
      name: `Totals include tax ${STAMP}`,
      fieldValues: {},
      steps: [
        { step: "Open the cart", expectedResult: "Total with tax is shown" },
        { step: "Close the cart", expectedResult: "Cart closes" },
        { step: "Open the receipt", expectedResult: "Tax is itemized" },
      ],
    };
    answer(
      [
        { caseId: ids.a, action: "update", reason: "Tax", proposed: withTax },
        { caseId: ids.b, action: "retire", reason: "Remember me was dropped" },
        {
          caseId: ids.c,
          action: "update",
          reason: "Tax",
          proposed: {
            name: `Discount applies before tax ${STAMP}`,
            fieldValues: {},
            steps: [{ step: "Apply a code", expectedResult: "Total drops" }],
          },
        },
      ],
      [
        {
          name: `Tax is itemized ${STAMP}`,
          fieldValues: {},
          steps: [
            { step: "Open the receipt", expectedResult: "Tax line shown" },
          ],
        },
      ]
    );

    expect(await runUpdateCases(db, job(fx.updateRuleId))).toEqual({
      outcome: "cases_updated",
      checked: 3,
      rewritten: 1,
      added: 1,
      deleted: 1,
      suggested: 1,
    });
    const changedAt = await issueChangedAt();

    // A: rewritten in place. The first two steps keep their rows.
    const a = await readCase(ids.a);
    expect(a).toMatchObject({
      name: withTax.name,
      stateId: fx.aiStateId,
      currentVersion: 2,
      aiWrittenVersion: 2,
    });
    expect(a.steps).toHaveLength(3);
    expect(a.steps[0].id).toBe(before.steps[0].id);
    expect(a.steps[1].id).toBe(before.steps[1].id);
    expect(text(a.steps[0].expectedResult)).toContain(
      "Total with tax is shown"
    );
    // The untouched step was not rewritten at all.
    expect(text(a.steps[1])).toBe(text(before.steps[1]));
    expect(text(a.steps[2].step)).toContain("Open the receipt");
    const version = await db.repositoryCaseVersions.findFirst({
      where: { repositoryCaseId: ids.a, version: 2 },
      select: { name: true, steps: true },
    });
    expect(version.name).toBe(withTax.name);
    expect(version.steps).toHaveLength(3);
    expect((await link(ids.a)).alignedAt.getTime()).toBeGreaterThanOrEqual(
      changedAt.getTime()
    );

    // B: an untouched draft the issue no longer asks for is deleted.
    expect((await readCase(ids.b)).isDeleted).toBe(true);

    // C: reviewed, so untouched, with a suggestion and still behind the issue.
    const c = await readCase(ids.c);
    expect(c).toMatchObject({ currentVersion: 1, stateId: fx.activeStateId });
    const suggestions = await db.caseChangeSuggestion.findMany({
      where: { caseId: ids.c },
      select: {
        status: true,
        kind: true,
        baseCaseVersion: true,
        proposed: true,
        rationale: true,
        webhookActionId: true,
      },
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      status: "PENDING",
      kind: "UPDATE",
      baseCaseVersion: 1,
      rationale: "Tax",
      webhookActionId: fx.updateRuleId,
    });
    expect(suggestions[0].proposed).toMatchObject({
      templateId: fx.templateId,
      name: `Discount applies before tax ${STAMP}`,
      base: { name: `Discount applies ${STAMP}` },
    });
    expect((await link(ids.c)).alignedAt.getTime()).toBeLessThan(
      changedAt.getTime()
    );

    // D: the new criterion's case, drafted like a first draft.
    const added = await db.repositoryCases.findFirst({
      where: { projectId: fx.projectId, name: `Tax is itemized ${STAMP}` },
      select: { id: true, stateId: true, aiWrittenVersion: true },
    });
    expect(added).toMatchObject({ stateId: fx.aiStateId, aiWrittenVersion: 1 });
    ids.d = added.id;
    expect((await link(ids.d)).alignedAt).toBeInstanceOf(Date);

    const log = await db.webhookActionLog.findFirst({
      where: { webhookActionId: fx.updateRuleId, outcome: "cases_updated" },
      select: { caseCount: true, detail: true },
    });
    expect(log).toMatchObject({
      caseCount: 4,
      detail: "checked 3: 1 rewritten, 1 added, 1 deleted, 1 suggested",
    });
  });

  it("applies a suggestion as a normal edit and makes the user the reviewer", async () => {
    const suggestion = await db.caseChangeSuggestion.findFirst({
      where: { caseId: ids.c, status: "PENDING" },
      select: { id: true },
    });
    const result = await auditedTransaction((tx) =>
      decideSuggestion(tx, {
        suggestionId: suggestion.id,
        caseId: ids.c,
        action: "apply",
        userId: fx.personId,
      })
    );
    expect(result).toEqual({ ok: true, status: "APPLIED" });

    const c = await readCase(ids.c);
    expect(c).toMatchObject({
      name: `Discount applies before tax ${STAMP}`,
      currentVersion: 2,
      // The AI did not write this version, so it may not rewrite the case.
      aiWrittenVersion: 1,
      reviewedById: fx.personId,
      stateId: fx.activeStateId,
    });
    expect(c.steps).toHaveLength(1);
    expect(
      await db.repositoryCaseVersions.count({
        where: { repositoryCaseId: ids.c, version: 2 },
      })
    ).toBe(1);
    expect(
      await db.caseChangeSuggestion.findUnique({
        where: { id: suggestion.id },
        select: { status: true, decidedById: true },
      })
    ).toEqual({ status: "APPLIED", decidedById: fx.personId });
    expect((await link(ids.c)).alignedAt.getTime()).toBeGreaterThanOrEqual(
      (await issueChangedAt()).getTime()
    );
  });

  it("suggests for a draft someone saved, supersedes an older suggestion, and can be dismissed", async () => {
    // A person saves draft D without moving it: the AI may no longer rewrite it.
    await db.repositoryCases.update({
      where: { id: ids.d },
      data: { currentVersion: 2 },
    });
    const proposal = (name: string) => ({
      name: `${name} ${STAMP}`,
      fieldValues: {},
      steps: [{ step: "Open the receipt", expectedResult: "Tax line shown" }],
    });

    await changeIssue("Totals must include tax and shipping.");
    answer([
      { caseId: ids.a, action: "unchanged" },
      { caseId: ids.c, action: "unchanged" },
      {
        caseId: ids.d,
        action: "update",
        reason: "Shipping",
        proposed: proposal("Tax and shipping are itemized"),
      },
    ]);
    expect(await runUpdateCases(db, job(fx.updateRuleId))).toMatchObject({
      outcome: "cases_updated",
      rewritten: 0,
      suggested: 1,
    });
    expect((await readCase(ids.d)).name).toBe(`Tax is itemized ${STAMP}`);

    await changeIssue("Totals must include tax, shipping and duties.");
    answer([
      { caseId: ids.a, action: "unchanged" },
      { caseId: ids.c, action: "unchanged" },
      {
        caseId: ids.d,
        action: "update",
        reason: "Duties",
        proposed: proposal("Tax, shipping and duties are itemized"),
      },
    ]);
    await runUpdateCases(db, job(fx.updateRuleId));
    const forD = await db.caseChangeSuggestion.findMany({
      where: { caseId: ids.d },
      orderBy: { id: "asc" },
      select: { id: true, status: true, rationale: true },
    });
    expect(forD.map((s: any) => [s.status, s.rationale])).toEqual([
      ["SUPERSEDED", "Shipping"],
      ["PENDING", "Duties"],
    ]);

    const dismissed = await auditedTransaction((tx) =>
      decideSuggestion(tx, {
        suggestionId: forD[1].id,
        caseId: ids.d,
        action: "dismiss",
        userId: fx.personId,
      })
    );
    expect(dismissed).toEqual({ ok: true, status: "DISMISSED" });
    expect((await readCase(ids.d)).name).toBe(`Tax is itemized ${STAMP}`);
    // Dismissing aligns the case, so the same change is not suggested again.
    expect(await runUpdateCases(db, job(fx.updateRuleId))).toEqual({
      outcome: "up_to_date",
    });
  });

  it("refuses to apply a suggestion once the case has been edited", async () => {
    await changeIssue("Totals must include every charge.");
    answer([
      { caseId: ids.a, action: "unchanged" },
      {
        caseId: ids.c,
        action: "retire",
        reason: "Discounts were dropped",
      },
      { caseId: ids.d, action: "unchanged" },
    ]);
    await runUpdateCases(db, job(fx.updateRuleId));
    const suggestion = await db.caseChangeSuggestion.findFirst({
      where: { caseId: ids.c, status: "PENDING" },
      select: { id: true, kind: true },
    });
    expect(suggestion.kind).toBe("RETIRE");

    await db.repositoryCases.update({
      where: { id: ids.c },
      data: { currentVersion: { increment: 1 } },
    });
    const stale = await auditedTransaction((tx) =>
      decideSuggestion(tx, {
        suggestionId: suggestion.id,
        caseId: ids.c,
        action: "apply",
        userId: fx.personId,
      })
    );
    expect(stale).toEqual({ ok: false, code: "stale" });
    expect((await readCase(ids.c)).isDeleted).toBe(false);
  });
});
