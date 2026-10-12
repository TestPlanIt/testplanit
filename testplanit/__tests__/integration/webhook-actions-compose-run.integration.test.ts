/**
 * Live-DB proof for the run a webhook action composes:
 *
 *   - composeRunFromCases (lib/webhooks/actions/composeRun.ts) on the worker's
 *     raw client: who the run is created as, its workflow state, note, issue
 *     links and case order; which cases it refuses; the test_run.created
 *     outbox row and the TestRuns CDC row, both attributed to the System user
 *     and written in the run's own transaction.
 *   - runAnalysisActions (lib/services/impact/autoRun.ts) over real
 *     ImpactAnalysis / ImpactAnalysisCase rows: one run per rule, the rule's
 *     log rows, repeat deliveries, a hand-linked analysis, the legacy single
 *     run, the rule line in the run's note and a failed auto-execute.
 *
 * Skipped by default; opt in with RUN_DB_INTEGRATION=1 + DATABASE_URL (a
 * seeded scratch database — never ew).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const STAMP = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeIntegration("Webhook actions: composed runs (live DB)", () => {
  let db: any;
  let composeRunFromCases: typeof import("~/lib/webhooks/actions/composeRun").composeRunFromCases;
  let runAnalysisActions: typeof import("~/lib/services/impact/autoRun").runAnalysisActions;

  const fx = {
    creatorId: "",
    projectId: 0,
    otherProjectId: 0,
    bareProjectId: 0,
    repoId: 0,
    folderId: 0,
    templateId: 0,
    activeStateId: 0,
    draftStateId: 0,
    defaultRunStateId: 0,
    codeRepositoryId: 0,
    codeConfigId: 0,
    webhookConfigId: "",
    issueId: 0,
  };

  async function makeProject(name: string, assignWorkflows: boolean) {
    const project = await db.projects.create({
      data: { name: `${name}-${STAMP}`, createdBy: fx.creatorId },
      select: { id: true },
    });
    if (assignWorkflows) {
      const workflows = await db.workflows.findMany({ select: { id: true } });
      for (const w of workflows) {
        await db.projectWorkflowAssignment.create({
          data: { workflowId: w.id, projectId: project.id },
        });
      }
    }
    return project.id as number;
  }

  async function makeCase(
    projectId: number,
    name: string,
    opts: {
      stateId?: number;
      isDeleted?: boolean;
      isArchived?: boolean;
      repositoryId?: number;
      folderId?: number;
    } = {}
  ): Promise<number> {
    const row = await db.repositoryCases.create({
      data: {
        projectId,
        repositoryId: opts.repositoryId ?? fx.repoId,
        folderId: opts.folderId ?? fx.folderId,
        templateId: fx.templateId,
        name: `${name} ${STAMP}`,
        stateId: opts.stateId ?? fx.activeStateId,
        creatorId: fx.creatorId,
        isDeleted: opts.isDeleted ?? false,
        isArchived: opts.isArchived ?? false,
      },
      select: { id: true },
    });
    return row.id;
  }

  async function runCaseIds(testRunId: number): Promise<number[]> {
    const rows = await db.testRunCases.findMany({
      where: { testRunId },
      orderBy: { order: "asc" },
      select: { repositoryCaseId: true },
    });
    return rows.map((r: { repositoryCaseId: number }) => r.repositoryCaseId);
  }

  function noteTexts(note: any): string[] {
    return (note?.content ?? []).map((p: any) =>
      (p.content ?? []).map((n: any) => n.text).join("")
    );
  }

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
    ({ rawDb: db } = await import("~/lib/rawDb"));
    ({ composeRunFromCases } =
      await import("~/lib/webhooks/actions/composeRun"));
    ({ runAnalysisActions } = await import("~/lib/services/impact/autoRun"));

    const system = await db.user.findUnique({
      where: { id: SYSTEM_AUTOMATION_USER_ID },
      select: { id: true },
    });
    if (!system) throw new Error("Seed the database first (System user)");
    const creator = await db.user.findFirst({
      where: { access: "ADMIN", id: { not: SYSTEM_AUTOMATION_USER_ID } },
      select: { id: true },
    });
    const template = await db.templates.findFirst({ select: { id: true } });
    const active = await db.workflows.findFirst({
      where: { scope: "CASES", workflowType: { not: "NOT_STARTED" } },
      select: { id: true },
    });
    const draft = await db.workflows.findFirst({
      where: { scope: "CASES", workflowType: "NOT_STARTED" },
      select: { id: true },
    });
    const runState = await db.workflows.findFirst({
      where: { scope: "RUNS", isDefault: true, isEnabled: true },
      select: { id: true },
    });
    if (!creator || !template || !active || !draft || !runState) {
      throw new Error("Seed the database first");
    }
    fx.creatorId = creator.id;
    fx.templateId = template.id;
    fx.activeStateId = active.id;
    fx.draftStateId = draft.id;
    fx.defaultRunStateId = runState.id;

    fx.projectId = await makeProject("wa-main", true);
    fx.otherProjectId = await makeProject("wa-other", true);
    fx.bareProjectId = await makeProject("wa-bare", false);

    const repo = await db.repositories.create({
      data: { projectId: fx.projectId },
      select: { id: true },
    });
    fx.repoId = repo.id;
    const folder = await db.repositoryFolders.create({
      data: {
        name: `f-${STAMP}`,
        repositoryId: repo.id,
        projectId: fx.projectId,
        creatorId: fx.creatorId,
      },
      select: { id: true },
    });
    fx.folderId = folder.id;

    const issue = await db.issue.create({
      data: {
        name: `WA-1-${STAMP}`,
        title: `Webhook action issue ${STAMP}`,
        projectId: fx.projectId,
        createdById: fx.creatorId,
      },
      select: { id: true },
    });
    fx.issueId = issue.id;

    const codeRepo = await db.codeRepository.create({
      data: { name: `wa-repo-${STAMP}`, provider: "GITHUB", credentials: {} },
      select: { id: true },
    });
    fx.codeRepositoryId = codeRepo.id;
    const codeConfig = await db.projectCodeRepositoryConfig.create({
      data: {
        projectId: fx.projectId,
        repositoryId: codeRepo.id,
        purpose: "IMPACT",
        pathPatterns: [],
      },
      select: { id: true },
    });
    fx.codeConfigId = codeConfig.id;
    const webhook = await db.webhookConfig.create({
      data: {
        projectId: fx.projectId,
        adapterType: "GITHUB",
        direction: "INBOUND",
        token: `tok-${STAMP}`,
        secret: "unused",
        codeRepositoryConfigId: codeConfig.id,
      },
      select: { id: true },
    });
    fx.webhookConfigId = webhook.id;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of [fx.projectId, fx.otherProjectId, fx.bareProjectId]) {
      if (!id) continue;
      await db.projects
        .delete({ where: { id } })
        .catch((e: unknown) => console.warn("cleanup project", id, e));
    }
    if (fx.codeRepositoryId) {
      await db.codeRepository
        .delete({ where: { id: fx.codeRepositoryId } })
        .catch(() => {});
    }
  });

  describe("composeRunFromCases", () => {
    it("creates the run as the System user under the default run state, with the note, issues and case order", async () => {
      const a = await makeCase(fx.projectId, "order-a");
      const b = await makeCase(fx.projectId, "order-b");
      const c = await makeCase(fx.projectId, "order-c");

      const result = await composeRunFromCases(db, {
        projectId: fx.projectId,
        name: `PR #12: Fix checkout ${STAMP}`,
        caseIds: [c, a, b, a],
        links: [
          { label: "PR #12: Fix checkout", url: "https://git.example/pr/12" },
          { label: "Pull requests → Create Test Run", url: null },
        ],
        issueIds: [fx.issueId],
        createdById: SYSTEM_AUTOMATION_USER_ID,
      });

      expect(result).toMatchObject({ created: true, caseCount: 3 });
      if (!result.created) throw new Error("not created");
      const run = await db.testRuns.findUnique({
        where: { id: result.testRunId },
        select: {
          name: true,
          projectId: true,
          createdById: true,
          stateId: true,
          testRunType: true,
          note: true,
          issues: { select: { id: true } },
        },
      });
      expect(run).toMatchObject({
        name: `PR #12: Fix checkout ${STAMP}`,
        projectId: fx.projectId,
        createdById: SYSTEM_AUTOMATION_USER_ID,
        stateId: fx.defaultRunStateId,
        testRunType: "REGULAR",
      });
      expect(run.issues.map((i: { id: number }) => i.id)).toEqual([fx.issueId]);
      expect(noteTexts(run.note)).toEqual([
        "PR #12: Fix checkout — https://git.example/pr/12",
        "Pull requests → Create Test Run",
      ]);
      const link = run.note.content[0].content[1];
      expect(link.marks).toEqual([
        { type: "link", attrs: { href: "https://git.example/pr/12" } },
      ]);
      expect(await runCaseIds(result.testRunId)).toEqual([c, a, b]);
    });

    it("drops deleted, archived and other-project cases and keeps the order of the rest", async () => {
      const keep1 = await makeCase(fx.projectId, "keep-1");
      const deleted = await makeCase(fx.projectId, "deleted", {
        isDeleted: true,
      });
      const archived = await makeCase(fx.projectId, "archived", {
        isArchived: true,
      });
      const keep2 = await makeCase(fx.projectId, "keep-2");
      const otherRepo = await db.repositories.create({
        data: { projectId: fx.otherProjectId },
        select: { id: true },
      });
      const otherFolder = await db.repositoryFolders.create({
        data: {
          name: `of-${STAMP}`,
          repositoryId: otherRepo.id,
          projectId: fx.otherProjectId,
          creatorId: fx.creatorId,
        },
        select: { id: true },
      });
      const foreign = await makeCase(fx.otherProjectId, "foreign", {
        repositoryId: otherRepo.id,
        folderId: otherFolder.id,
      });

      const result = await composeRunFromCases(db, {
        projectId: fx.projectId,
        name: `filter ${STAMP}`,
        caseIds: [keep2, deleted, foreign, archived, keep1],
        links: [{ label: "push", url: null }],
        createdById: SYSTEM_AUTOMATION_USER_ID,
      });

      expect(result).toMatchObject({ created: true, caseCount: 2 });
      if (!result.created) throw new Error("not created");
      expect(await runCaseIds(result.testRunId)).toEqual([keep2, keep1]);
    });

    it("leaves NOT_STARTED cases out when the project excludes them from runs", async () => {
      const ready = await makeCase(fx.projectId, "ready");
      const draft = await makeCase(fx.projectId, "draft", {
        stateId: fx.draftStateId,
      });

      await db.projects.update({
        where: { id: fx.projectId },
        data: { excludeNotStartedFromRuns: true },
      });
      try {
        const result = await composeRunFromCases(db, {
          projectId: fx.projectId,
          name: `drafts ${STAMP}`,
          caseIds: [draft, ready],
          links: [{ label: "x", url: null }],
          createdById: SYSTEM_AUTOMATION_USER_ID,
        });
        expect(result).toMatchObject({ created: true, caseCount: 1 });
        if (!result.created) throw new Error("not created");
        expect(await runCaseIds(result.testRunId)).toEqual([ready]);

        const onlyDraft = await composeRunFromCases(db, {
          projectId: fx.projectId,
          name: `only drafts ${STAMP}`,
          caseIds: [draft],
          links: [{ label: "x", url: null }],
          createdById: SYSTEM_AUTOMATION_USER_ID,
        });
        expect(onlyDraft).toEqual({ created: false, reason: "no_cases" });
      } finally {
        await db.projects.update({
          where: { id: fx.projectId },
          data: { excludeNotStartedFromRuns: false },
        });
      }

      // With the flag off the draft goes in.
      const result = await composeRunFromCases(db, {
        projectId: fx.projectId,
        name: `drafts allowed ${STAMP}`,
        caseIds: [draft, ready],
        links: [{ label: "x", url: null }],
        createdById: SYSTEM_AUTOMATION_USER_ID,
      });
      if (!result.created) throw new Error("not created");
      expect(await runCaseIds(result.testRunId)).toEqual([draft, ready]);
    });

    it("writes the test_run.created outbox row and the TestRuns CDC row as the System user, in the run's transaction", async () => {
      const a = await makeCase(fx.projectId, "outbox");
      const result = await composeRunFromCases(db, {
        projectId: fx.projectId,
        name: `outbox ${STAMP}`,
        caseIds: [a],
        links: [{ label: "x", url: null }],
        createdById: SYSTEM_AUTOMATION_USER_ID,
      });
      if (!result.created) throw new Error("not created");

      const outbox = await db.$queryRawUnsafe(
        `SELECT "eventName", "actorUserId", "projectId", payload, "createdAt"
           FROM "WebhookOutboxEvent"
          WHERE "eventName" = 'test_run.created'
            AND (payload->>'runId')::int = $1`,
        result.testRunId
      );
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        eventName: "test_run.created",
        actorUserId: SYSTEM_AUTOMATION_USER_ID,
        projectId: fx.projectId,
      });
      expect(outbox[0].payload).toMatchObject({
        runId: result.testRunId,
        runTitle: `outbox ${STAMP}`,
        stateId: fx.defaultRunStateId,
      });

      const cdc = await db.$queryRawUnsafe(
        `SELECT "table", op, pk, actor, ts
           FROM "DataChangeLog"
          WHERE "table" = 'TestRuns' AND op = 'I' AND pk = $1`,
        String(result.testRunId)
      );
      expect(cdc).toHaveLength(1);
      expect(cdc[0]).toMatchObject({
        table: "TestRuns",
        op: "I",
        pk: String(result.testRunId),
        actor: SYSTEM_AUTOMATION_USER_ID,
      });
      // now() is the transaction's start time: equal stamps = one transaction.
      expect(new Date(outbox[0].createdAt).getTime()).toBe(
        new Date(cdc[0].ts).getTime()
      );
    });

    it("reports no_cases for an empty or fully filtered list, and no_workflow for a project without run states", async () => {
      expect(
        await composeRunFromCases(db, {
          projectId: fx.projectId,
          name: "empty",
          caseIds: [],
          links: [],
          createdById: SYSTEM_AUTOMATION_USER_ID,
        })
      ).toEqual({ created: false, reason: "no_cases" });

      const deleted = await makeCase(fx.projectId, "gone", {
        isDeleted: true,
      });
      expect(
        await composeRunFromCases(db, {
          projectId: fx.projectId,
          name: "filtered",
          caseIds: [deleted],
          links: [],
          createdById: SYSTEM_AUTOMATION_USER_ID,
        })
      ).toEqual({ created: false, reason: "no_cases" });

      const bareRepo = await db.repositories.create({
        data: { projectId: fx.bareProjectId },
        select: { id: true },
      });
      const bareFolder = await db.repositoryFolders.create({
        data: {
          name: `bf-${STAMP}`,
          repositoryId: bareRepo.id,
          projectId: fx.bareProjectId,
          creatorId: fx.creatorId,
        },
        select: { id: true },
      });
      const bareCase = await makeCase(fx.bareProjectId, "bare", {
        repositoryId: bareRepo.id,
        folderId: bareFolder.id,
      });
      const before = await db.testRuns.count({
        where: { projectId: fx.bareProjectId },
      });
      expect(
        await composeRunFromCases(db, {
          projectId: fx.bareProjectId,
          name: "no workflow",
          caseIds: [bareCase],
          links: [],
          createdById: SYSTEM_AUTOMATION_USER_ID,
        })
      ).toEqual({ created: false, reason: "no_workflow" });
      expect(
        await db.testRuns.count({ where: { projectId: fx.bareProjectId } })
      ).toBe(before);
    });
  });

  describe("runAnalysisActions", () => {
    /** c95 pinned, c80 affected, c50 related, c45 related but not suggested. */
    async function makeAnalysis(opts: { testRunId?: number } = {}) {
      const c95 = await makeCase(fx.projectId, "s95");
      const c80 = await makeCase(fx.projectId, "s80");
      const c50 = await makeCase(fx.projectId, "s50");
      const c45 = await makeCase(fx.projectId, "s45");
      const analysis = await db.impactAnalysis.create({
        data: {
          projectId: fx.projectId,
          configId: fx.codeConfigId,
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          status: "COMPLETED",
          trigger: "pull_request",
          triggerLabel: "PR #7",
          createdById: fx.creatorId,
          testRunId: opts.testRunId ?? null,
          cases: {
            create: [
              { caseId: c80, score: 80, tier: "affected" },
              { caseId: c50, score: 50, tier: "related" },
              { caseId: c95, score: 95, tier: "pinned" },
              { caseId: c45, score: 45, tier: "related", suggested: false },
            ],
          },
        },
        select: { id: true },
      });
      return { analysisId: analysis.id as number, c95, c80, c50, c45 };
    }

    async function makeAction(options: Record<string, unknown> = {}) {
      const row = await db.webhookAction.create({
        data: {
          webhookConfigId: fx.webhookConfigId,
          projectId: fx.projectId,
          trigger: "CODE_PULL_REQUEST",
          action: "CREATE_RUN",
          options,
        },
        select: { id: true },
      });
      return row.id as string;
    }

    async function makeDelivery() {
      const row = await db.webhookDelivery.create({
        data: {
          webhookConfigId: fx.webhookConfigId,
          direction: "INBOUND",
          adapterType: "GITHUB",
          payloadDigest: `d-${STAMP}-${Math.random()}`,
        },
        select: { id: true },
      });
      return row.id as string;
    }

    async function logsFor(analysisId: number) {
      return db.webhookActionLog.findMany({
        where: { analysisId },
        orderBy: { createdAt: "asc" },
      });
    }

    it("composes one run per rule from its minimum score, logs each, and links the first run to the analysis", async () => {
      const { analysisId, c95, c80, c50, c45 } = await makeAnalysis();
      const strict = await makeAction({ minScore: 90 });
      const loose = await makeAction({ minScore: 40 });
      const deliveryId = await makeDelivery();
      const autoRun = {
        trigger: "pull_request",
        label: `PR #7: Rules ${STAMP}`,
        url: "https://git.example/pr/7",
        deliveryId,
        webhookConfigId: fx.webhookConfigId,
        actions: [
          {
            actionId: strict,
            trigger: "CODE_PULL_REQUEST" as const,
            minScore: 90,
          },
          {
            actionId: loose,
            trigger: "CODE_PULL_REQUEST" as const,
            minScore: 40,
          },
        ],
      };

      await runAnalysisActions(db, analysisId, fx.projectId, autoRun);

      const logs = await logsFor(analysisId);
      expect(logs.map((l: any) => [l.webhookActionId, l.outcome])).toEqual([
        [strict, "run_created"],
        [loose, "run_created"],
      ]);
      expect(logs.every((l: any) => l.deliveryId === deliveryId)).toBe(true);
      const [strictLog, looseLog] = logs;
      expect(strictLog.caseCount).toBe(1);
      expect(looseLog.caseCount).toBe(3);
      expect(strictLog.testRunId).not.toBe(looseLog.testRunId);
      expect(await runCaseIds(strictLog.testRunId)).toEqual([c95]);
      expect(await runCaseIds(looseLog.testRunId)).toEqual([c95, c80, c50]);

      const strictRun = await db.testRuns.findUnique({
        where: { id: strictLog.testRunId },
        select: { createdById: true, note: true, name: true },
      });
      expect(strictRun.createdById).toBe(SYSTEM_AUTOMATION_USER_ID);
      expect(strictRun.name).toBe(`PR #7: Rules ${STAMP}`);
      const texts = noteTexts(strictRun.note);
      expect(texts[0]).toBe(`PR #7: Rules ${STAMP} — https://git.example/pr/7`);
      expect(texts[texts.length - 1]).toBe(
        "Pull requests → Create Test Run · Minimum score: 90"
      );

      const analysis = await db.impactAnalysis.findUnique({
        where: { id: analysisId },
        select: {
          testRunId: true,
          cases: {
            select: {
              caseId: true,
              accepted: true,
              reviewedById: true,
            },
          },
        },
      });
      expect(analysis.testRunId).toBe(strictLog.testRunId);
      const byCase = new Map(
        analysis.cases.map((c: any) => [c.caseId, c] as const)
      );
      expect(byCase.get(c95)).toMatchObject({
        accepted: true,
        reviewedById: SYSTEM_AUTOMATION_USER_ID,
      });
      expect(byCase.get(c80)).toMatchObject({ accepted: false });
      expect(byCase.get(c50)).toMatchObject({ accepted: false });
      // Not suggested: the acceptance pass leaves it untouched.
      expect(byCase.get(c45)).toMatchObject({
        accepted: null,
        reviewedById: null,
      });

      const delivery = await db.webhookDelivery.findUnique({
        where: { id: deliveryId },
        select: { subjectRef: true, error: true },
      });
      expect(delivery).toEqual({
        subjectRef: `run:${strictLog.testRunId}`,
        error: null,
      });

      // A repeat of the same change reports the runs already made.
      const runsBefore = await db.testRuns.count({
        where: { projectId: fx.projectId },
      });
      await runAnalysisActions(db, analysisId, fx.projectId, autoRun);
      expect(
        await db.testRuns.count({ where: { projectId: fx.projectId } })
      ).toBe(runsBefore);
      const repeat = (await logsFor(analysisId)).slice(2);
      expect(
        repeat.map((l: any) => [l.webhookActionId, l.outcome, l.testRunId])
      ).toEqual([
        [strict, "already_composed", strictLog.testRunId],
        [loose, "already_composed", looseLog.testRunId],
      ]);
    });

    it("treats a run linked to the analysis by hand as every rule's run", async () => {
      const seedCase = await makeCase(fx.projectId, "manual-run-case");
      const manual = await composeRunFromCases(db, {
        projectId: fx.projectId,
        name: `manual ${STAMP}`,
        caseIds: [seedCase],
        links: [],
        createdById: fx.creatorId,
      });
      if (!manual.created) throw new Error("not created");
      const { analysisId } = await makeAnalysis({
        testRunId: manual.testRunId,
      });
      const a1 = await makeAction({ minScore: 90 });
      const a2 = await makeAction({});
      const runsBefore = await db.testRuns.count({
        where: { projectId: fx.projectId },
      });

      await runAnalysisActions(db, analysisId, fx.projectId, {
        trigger: "pull_request",
        label: `hand ${STAMP}`,
        webhookConfigId: fx.webhookConfigId,
        actions: [{ actionId: a1, minScore: 90 }, { actionId: a2 }],
      });

      expect(
        await db.testRuns.count({ where: { projectId: fx.projectId } })
      ).toBe(runsBefore);
      const logs = await logsFor(analysisId);
      expect(
        logs.map((l: any) => [l.webhookActionId, l.outcome, l.testRunId])
      ).toEqual([
        [a1, "already_composed", manual.testRunId],
        [a2, "already_composed", manual.testRunId],
      ]);
    });

    it("composes the single legacy run from the pinned and affected tiers when the job carries no rules", async () => {
      const { analysisId, c95, c80 } = await makeAnalysis();

      await runAnalysisActions(db, analysisId, fx.projectId, {
        trigger: "pull_request",
        label: `legacy ${STAMP}`,
        url: null,
        webhookConfigId: fx.webhookConfigId,
      });

      const analysis = await db.impactAnalysis.findUnique({
        where: { id: analysisId },
        select: { testRunId: true },
      });
      expect(analysis.testRunId).toEqual(expect.any(Number));
      expect(await runCaseIds(analysis.testRunId)).toEqual([c95, c80]);
      const run = await db.testRuns.findUnique({
        where: { id: analysis.testRunId },
        select: { note: true, createdById: true },
      });
      expect(run.createdById).toBe(SYSTEM_AUTOMATION_USER_ID);
      // No trigger on the job: no rule line, just the label.
      expect(noteTexts(run.note)).toEqual([`legacy ${STAMP}`]);
      const logs = await logsFor(analysisId);
      expect(logs.map((l: any) => [l.webhookActionId, l.outcome])).toEqual([
        [null, "run_created"],
      ]);

      // Run again: the analysis already has its run.
      await runAnalysisActions(db, analysisId, fx.projectId, {
        trigger: "pull_request",
        label: `legacy ${STAMP}`,
        webhookConfigId: fx.webhookConfigId,
      });
      const after = await logsFor(analysisId);
      expect(after.map((l: any) => l.outcome)).toEqual([
        "run_created",
        "already_composed",
      ]);
    });

    it("logs execute_failed when the rule's execution target does not exist, and keeps the run", async () => {
      const { analysisId, c95 } = await makeAnalysis();
      const missingTargetId = 2_000_000_000;
      const action = await makeAction({
        minScore: 90,
        autoExecute: { targetId: missingTargetId },
      });
      const deliveryId = await makeDelivery();

      await runAnalysisActions(db, analysisId, fx.projectId, {
        trigger: "pull_request",
        label: `exec ${STAMP}`,
        deliveryId,
        webhookConfigId: fx.webhookConfigId,
        actions: [
          {
            actionId: action,
            trigger: "CODE_PUSH",
            branch: "main",
            minScore: 90,
            autoExecute: { targetId: missingTargetId },
          },
        ],
      });

      const logs = await logsFor(analysisId);
      expect(logs.map((l: any) => [l.outcome, l.detail])).toEqual([
        ["run_created", null],
        ["execute_failed", "TARGET_NOT_FOUND"],
      ]);
      expect(logs[1].testRunId).toBe(logs[0].testRunId);
      expect(await runCaseIds(logs[0].testRunId)).toEqual([c95]);
      const run = await db.testRuns.findUnique({
        where: { id: logs[0].testRunId },
        select: { note: true },
      });
      const texts = noteTexts(run.note);
      expect(texts[texts.length - 1]).toBe(
        `Pushes to main → Create Test Run · Minimum score: 90 · Target: ${missingTargetId}`
      );
      const delivery = await db.webhookDelivery.findUnique({
        where: { id: deliveryId },
        select: { subjectRef: true, error: true },
      });
      expect(delivery).toEqual({
        subjectRef: `run:${logs[0].testRunId}`,
        error: "execute:target_not_found",
      });
    });

    it("logs no_cases and marks the delivery when no suggestion clears the rule's score", async () => {
      const { analysisId } = await makeAnalysis();
      const action = await makeAction({ minScore: 99 });
      const deliveryId = await makeDelivery();

      await runAnalysisActions(db, analysisId, fx.projectId, {
        trigger: "pull_request",
        label: `none ${STAMP}`,
        deliveryId,
        webhookConfigId: fx.webhookConfigId,
        actions: [{ actionId: action, minScore: 99 }],
      });

      const logs = await logsFor(analysisId);
      expect(logs.map((l: any) => [l.webhookActionId, l.outcome])).toEqual([
        [action, "no_cases"],
      ]);
      const analysis = await db.impactAnalysis.findUnique({
        where: { id: analysisId },
        select: { testRunId: true },
      });
      expect(analysis.testRunId).toBeNull();
      const delivery = await db.webhookDelivery.findUnique({
        where: { id: deliveryId },
        select: { subjectRef: true, error: true },
      });
      expect(delivery).toEqual({
        subjectRef: `analysis:${analysisId}`,
        error: "run:no_affected_cases",
      });
    });
  });
});
