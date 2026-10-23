// Live-DB proof of the risk scoring pipeline (lib/services/risk): the batched
// signal collection reads real verdict history, manual+automated latest
// execution, requirement/defect links with the suspect predicate, the
// project's chosen criticality field (order-weighted options), the priority
// mapping and quarantine state; the service persists scores only
// for live cases of projects with risk scoring on, resolves per-project
// weights, and skips the write when nothing material changed.
//
// Run via (scratch DB only — never the .env DATABASE_URL):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/risk-scoring.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getProjectPriorityUsage } from "~/lib/services/risk/priorities";
import { getRecentlyExecutedRunCaseIds } from "~/lib/services/risk/signals";
import {
  updateProjectRiskScores,
  updateRiskScoresForCases,
} from "~/lib/services/risk/service";
import type { RiskReasons } from "~/lib/services/risk/types";
import { WorkflowScope } from "~/zenstack/models";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `risk-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const NOW = new Date();

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

interface Fixture {
  projectId: number;
  disabledProjectId: number;
  ownerId: string;
  casePass: number;
  caseFail: number;
  caseFlaky: number;
  caseManual: number;
  caseReq: number;
  caseSyncedReq: number;
  caseDefect: number;
  casePriorityField: number;
  caseQuarantined: number;
  caseArchived: number;
  caseDisabledProject: number;
  manualExecutedAt: Date;
  junitRunId: number;
  manualRunId: number;
}

let fixture: Fixture | null = null;

async function readCase(id: number) {
  const row = await db.repositoryCases.findUniqueOrThrow({
    where: { id },
    select: { riskScore: true, riskReasons: true, riskComputedAt: true },
  });
  return {
    ...row,
    reasons: row.riskReasons as RiskReasons | null,
  };
}

async function setupFixture(): Promise<Fixture> {
  const caseWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDeleted: false, isEnabled: true },
  });
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!caseWorkflow || !runWorkflow)
    throw new Error("Test prerequisite: CASES and RUNS workflows");
  const template = await db.templates.findFirst({
    where: { isDeleted: false },
    select: { id: true },
  });
  if (!template) throw new Error("Test prerequisite: no Templates row");
  const passStatus = await db.status.findFirst({
    where: { isSuccess: true },
    select: { id: true },
  });
  if (!passStatus) throw new Error("Test prerequisite: no passing Status");

  const role = await db.roles.create({
    data: { name: `${TAG}-role` },
    select: { id: true },
  });
  const owner = await db.user.create({
    data: {
      email: `${TAG}-owner@example.test`,
      name: `${TAG} owner`,
      authMethod: "INTERNAL",
      access: "USER",
      roleId: role.id,
    },
    select: { id: true },
  });

  const mkProject = (label: string, riskScoringEnabled: boolean) =>
    db.projects.create({
      data: {
        name: `${TAG}-${label}`,
        createdBy: owner.id,
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        riskScoringEnabled,
        // The tests' own vocabulary; nothing is built into the product.
        riskPriorityWeights: { critical: 100, high: 75, low: 25 },
      },
      select: { id: true },
    });

  const project = await mkProject("main", true);
  const disabledProject = await mkProject("disabled", false);

  const mkRepoScope = async (projectId: number) => {
    const repository = await db.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    const folder = await db.repositoryFolders.create({
      data: {
        name: `${TAG}-folder-${projectId}`,
        projectId,
        repositoryId: repository.id,
        creatorId: owner.id,
      },
      select: { id: true },
    });
    return { repositoryId: repository.id, folderId: folder.id };
  };

  const main = await mkRepoScope(project.id);
  const disabled = await mkRepoScope(disabledProject.id);

  const mkCase = (
    label: string,
    scope: { repositoryId: number; folderId: number },
    projectId: number,
    extra: { isArchived?: boolean; createdAt?: Date } = {}
  ) =>
    db.repositoryCases
      .create({
        data: {
          projectId,
          repositoryId: scope.repositoryId,
          folderId: scope.folderId,
          templateId: template.id,
          name: `${TAG}-${label}`,
          stateId: caseWorkflow.id,
          creatorId: owner.id,
          ...extra,
        },
        select: { id: true },
      })
      .then((row) => row.id);

  const casePass = await mkCase("pass", main, project.id);
  const caseFail = await mkCase("fail", main, project.id);
  const caseFlaky = await mkCase("flaky", main, project.id);
  const caseManual = await mkCase("manual", main, project.id);
  const caseReq = await mkCase("req", main, project.id);
  const caseSyncedReq = await mkCase("synced-req", main, project.id);
  const caseDefect = await mkCase("defect", main, project.id);
  const casePriorityField = await mkCase("priority-field", main, project.id);
  const caseQuarantined = await mkCase("quarantined", main, project.id);
  const caseArchived = await mkCase("archived", main, project.id, {
    isArchived: true,
  });
  const caseDisabledProject = await mkCase(
    "disabled-project",
    disabled,
    disabledProject.id
  );

  const junitRun = await db.testRuns.create({
    data: {
      projectId: project.id,
      name: `${TAG}-junit-run`,
      stateId: runWorkflow.id,
      createdById: owner.id,
      testRunType: "JUNIT",
    },
    select: { id: true },
  });
  const suite = await db.jUnitTestSuite.create({
    data: {
      name: `${TAG}-suite`,
      testRunId: junitRun.id,
      createdById: owner.id,
    },
    select: { id: true },
  });

  const mkJunit = (
    repositoryCaseId: number,
    type: "PASSED" | "FAILURE",
    executedAt: Date
  ) =>
    db.jUnitTestResult.create({
      data: {
        type,
        repositoryCaseId,
        testSuiteId: suite.id,
        createdById: owner.id,
        executedAt,
      },
      select: { id: true },
    });

  await mkJunit(casePass, "PASSED", daysBefore(2));
  await mkJunit(casePass, "PASSED", daysBefore(3));
  await mkJunit(caseFail, "FAILURE", daysBefore(1));
  await mkJunit(caseFail, "PASSED", daysBefore(2));
  await mkJunit(caseFlaky, "PASSED", daysBefore(1));
  await mkJunit(caseFlaky, "FAILURE", daysBefore(2));
  await mkJunit(caseFlaky, "PASSED", daysBefore(3));
  await mkJunit(caseFlaky, "FAILURE", daysBefore(4));
  await mkJunit(caseReq, "PASSED", daysBefore(10));
  await mkJunit(caseQuarantined, "FAILURE", daysBefore(1));

  // Manual execution: latest-executed must fuse TestRunResults in.
  const manualRun = await db.testRuns.create({
    data: {
      projectId: project.id,
      name: `${TAG}-manual-run`,
      stateId: runWorkflow.id,
      createdById: owner.id,
      testRunType: "REGULAR",
    },
    select: { id: true },
  });
  const manualRunCase = await db.testRunCases.create({
    data: { testRunId: manualRun.id, repositoryCaseId: caseManual },
    select: { id: true },
  });
  const manualExecutedAt = daysBefore(1);
  await db.testRunResults.create({
    data: {
      testRunId: manualRun.id,
      testRunCaseId: manualRunCase.id,
      statusId: passStatus.id,
      executedById: owner.id,
      executedAt: manualExecutedAt,
    },
    select: { id: true },
  });

  // A critical requirement whose content changed AFTER the case's last
  // execution (suspect), plus two defects on another case.
  const requirement = await db.issue.create({
    data: {
      name: `${TAG}-req`,
      title: `${TAG} requirement`,
      projectId: project.id,
      createdById: owner.id,
      isRequirement: true,
      priority: "critical",
      contentUpdatedAt: daysBefore(9),
    },
    select: { id: true },
  });
  // Tracker-linked, non-detached requirement: the tracker's priority wins.
  const integration = await db.integration.create({
    data: {
      name: `${TAG}-tracker`,
      provider: "JIRA",
      authType: "API_KEY",
      credentials: {},
    },
    select: { id: true },
  });
  const syncedRequirement = await db.issue.create({
    data: {
      name: `${TAG}-synced-req`,
      title: `${TAG} synced requirement`,
      projectId: project.id,
      createdById: owner.id,
      isRequirement: true,
      integrationId: integration.id,
      priority: "low",
      externalPriority: "high",
    },
    select: { id: true },
  });
  // Defects resolve the LOCAL priority first even when a tracker mirror
  // exists (the lock predicate is requirement-only).
  const mirroredDefect = await db.issue.create({
    data: {
      name: `${TAG}-defect-mirrored`,
      title: `${TAG} mirrored defect`,
      projectId: project.id,
      createdById: owner.id,
      integrationId: integration.id,
      priority: "low",
      externalPriority: "critical",
    },
    select: { id: true },
  });
  const highDefect = await db.issue.create({
    data: {
      name: `${TAG}-defect-high`,
      title: `${TAG} high defect`,
      projectId: project.id,
      createdById: owner.id,
      priority: "high",
    },
    select: { id: true },
  });
  await db.repositoryCaseIssue.createMany({
    data: [
      { caseId: caseReq, issueId: requirement.id },
      { caseId: caseSyncedReq, issueId: syncedRequirement.id },
      { caseId: caseDefect, issueId: mirroredDefect.id },
      { caseId: caseDefect, issueId: highDefect.id },
    ],
  });

  // An explicitly chosen criticality dropdown of the project's own: options
  // weight by their order, never their names.
  const dropdownType = await db.caseFieldTypes.findFirst({
    where: { type: "Dropdown" },
    select: { id: true },
  });
  if (!dropdownType) throw new Error("Test prerequisite: Dropdown field type");
  const criticalityField = await db.caseFields.create({
    data: {
      displayName: `${TAG}-criticality`,
      systemName: `${TAG}-criticality`,
      typeId: dropdownType.id,
    },
    select: { id: true },
  });
  const mkOption = (name: string, order: number) =>
    db.fieldOptions
      .create({ data: { name, order }, select: { id: true } })
      .then(async (option) => {
        await db.caseFieldAssignment.create({
          data: {
            fieldOptionId: option.id,
            caseFieldId: criticalityField.id,
          },
        });
        return option;
      });
  const topOption = await mkOption(`${TAG}-sev1`, 1);
  await mkOption(`${TAG}-sev2`, 2);
  await mkOption(`${TAG}-sev3`, 3);
  await db.projects.update({
    where: { id: project.id },
    data: { riskCriticalityFieldId: criticalityField.id },
  });
  await db.caseFieldValues.create({
    data: {
      testCaseId: casePriorityField,
      fieldId: criticalityField.id,
      value: String(topOption.id),
    },
    select: { id: true },
  });

  await db.caseQuarantine.create({
    data: {
      caseId: caseQuarantined,
      projectId: project.id,
      reason: `${TAG} quarantine`,
      createdById: owner.id,
    },
    select: { id: true },
  });

  return {
    projectId: project.id,
    disabledProjectId: disabledProject.id,
    ownerId: owner.id,
    casePass,
    caseFail,
    caseFlaky,
    caseManual,
    caseReq,
    caseSyncedReq,
    caseDefect,
    casePriorityField,
    caseQuarantined,
    caseArchived,
    caseDisabledProject,
    manualExecutedAt,
    junitRunId: junitRun.id,
    manualRunId: manualRun.id,
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const projectIds = [f.projectId, f.disabledProjectId];
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.jUnitTestResult.deleteMany({
      where: { testSuite: { testRun: { projectId: { in: projectIds } } } },
    })
  );
  await safe(() =>
    db.testRunResults.deleteMany({
      where: { testRun: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.caseQuarantine.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.repositoryCaseIssue.deleteMany({
      where: { case: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.caseFieldValues.deleteMany({
      where: { testCase: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.issue.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.integration.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.projects.deleteMany({ where: { id: { in: projectIds } } })
  );
  await safe(() =>
    db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  );
  await safe(() =>
    db.caseFields.deleteMany({ where: { systemName: { startsWith: TAG } } })
  );
  await safe(() =>
    db.fieldOptions.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.roles.deleteMany({ where: { name: { startsWith: TAG } } })
  );
}

describeIntegration("risk scoring (live DB)", () => {
  beforeAll(async () => {
    fixture = await setupFixture();
  }, 120_000);

  afterAll(async () => {
    if (!RUN_INTEGRATION || !HAS_DB_URL) return;
    await cleanupFixture(fixture);
    await db.$disconnect();
  }, 120_000);

  it("scores every live case of an enabled project, writing no audit rows", async () => {
    const f = fixture!;
    // Risk columns are denylisted in the audit trigger registry: a recompute
    // must not append DataChangeLog rows (the empty-diff short-circuit).
    const dclBefore = await db.dataChangeLog.count({
      where: { tableName: "RepositoryCases" },
    });
    const result = await updateProjectRiskScores(db, f.projectId, {
      now: NOW,
    });
    expect(result.scanned).toBe(9);
    expect(result.updated).toBe(9);
    expect(
      await db.dataChangeLog.count({ where: { tableName: "RepositoryCases" } })
    ).toBe(dclBefore);
    for (const caseId of [
      f.casePass,
      f.caseFail,
      f.caseFlaky,
      f.caseManual,
      f.caseReq,
      f.caseSyncedReq,
      f.caseDefect,
      f.casePriorityField,
      f.caseQuarantined,
    ]) {
      const row = await readCase(caseId);
      expect(row.riskScore).not.toBeNull();
      expect(row.riskComputedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row.reasons?.version).toBe(1);
    }
  });

  it("leaves archived cases and disabled projects untouched", async () => {
    const f = fixture!;
    expect((await readCase(f.caseArchived)).riskScore).toBeNull();

    const result = await updateProjectRiskScores(db, f.disabledProjectId, {
      now: NOW,
    });
    expect(result).toEqual({ scanned: 0, updated: 0 });
    expect((await readCase(f.caseDisabledProject)).riskScore).toBeNull();

    const direct = await updateRiskScoresForCases(
      db,
      f.disabledProjectId,
      [f.caseDisabledProject],
      { now: NOW }
    );
    expect(direct).toEqual({ scanned: 0, updated: 0 });
  });

  it("reads verdict history: failing scores above passing, flips counted", async () => {
    const f = fixture!;
    const fail = await readCase(f.caseFail);
    const pass = await readCase(f.casePass);
    expect(fail.riskScore!).toBeGreaterThan(pass.riskScore!);
    expect(fail.reasons?.facts.verdictsSampled).toBe(2);
    expect(fail.reasons?.facts.failCount).toBe(1);

    const flaky = await readCase(f.caseFlaky);
    expect(flaky.reasons?.facts.verdictsSampled).toBe(4);
    expect(flaky.reasons?.facts.flips).toBe(3);
  });

  it("fuses manual executions into the latest-executed signal", async () => {
    const f = fixture!;
    const row = await readCase(f.caseManual);
    expect(row.reasons?.facts.lastExecutedAt).toBe(
      f.manualExecutedAt.toISOString()
    );
  });

  it("reads requirement criticality and the suspect predicate", async () => {
    const f = fixture!;
    const row = await readCase(f.caseReq);
    expect(row.reasons?.facts.requirementCount).toBe(1);
    expect(row.reasons?.facts.topRequirementPriority).toBe("critical");
    expect(row.reasons?.facts.suspectLinkCount).toBe(1);
    expect(row.reasons?.facts.defectCount).toBe(0);
  });

  it("prefers the tracker priority only for synced requirements", async () => {
    const f = fixture!;
    const row = await readCase(f.caseSyncedReq);
    expect(row.reasons?.facts.topRequirementPriority).toBe("high");
    expect(row.reasons?.facts.suspectLinkCount).toBe(0);
  });

  it("reads linked defects with their priorities", async () => {
    const f = fixture!;
    const row = await readCase(f.caseDefect);
    expect(row.reasons?.facts.defectCount).toBe(2);
    // The mirrored defect counts its LOCAL "low", not the tracker "critical".
    expect(row.reasons?.facts.topDefectPriority).toBe("high");
    expect(row.reasons?.facts.requirementCount).toBe(0);
  });

  it("reads the chosen criticality field's option, weighted by order", async () => {
    const f = fixture!;
    const row = await readCase(f.casePriorityField);
    expect(row.reasons?.facts.caseCriticality).toBe(`${TAG}-sev1`);
    // Top option of three: full weight drives the criticality component.
    const criticality = row.reasons?.components.find(
      (c) => c.key === "criticality"
    );
    expect(criticality?.raw).toBe(1);
  });

  it("stops reading a criticality field the admin deleted", async () => {
    const f = fixture!;
    const field = await db.projects.findUniqueOrThrow({
      where: { id: f.projectId },
      select: { riskCriticalityFieldId: true },
    });
    await db.caseFields.update({
      where: { id: field.riskCriticalityFieldId! },
      data: { isDeleted: true },
    });
    try {
      await updateRiskScoresForCases(db, f.projectId, [f.casePriorityField], {
        now: new Date(NOW.getTime() + 30_000),
        force: true,
      });
      const row = await readCase(f.casePriorityField);
      expect(row.reasons?.facts.caseCriticality).toBeNull();
    } finally {
      await db.caseFields.update({
        where: { id: field.riskCriticalityFieldId! },
        data: { isDeleted: false },
      });
      await updateRiskScoresForCases(db, f.projectId, [f.casePriorityField], {
        now: new Date(NOW.getTime() + 45_000),
        force: true,
      });
    }
  });

  it("lists the project's priority vocabulary with usage counts", async () => {
    const f = fixture!;
    const usage = await getProjectPriorityUsage(db, f.projectId);
    const byValue = new Map(usage.map((row) => [row.value, row.count]));
    expect(byValue.get("critical")).toBe(1);
    expect(byValue.get("high")).toBe(2);
    expect(byValue.get("low")).toBe(1);
  });

  it("flags quarantined cases in the facts", async () => {
    const f = fixture!;
    const row = await readCase(f.caseQuarantined);
    expect(row.reasons?.facts.quarantined).toBe(true);
  });

  it("collects only recently executed run cases, members or not", async () => {
    const f = fixture!;
    const junitRecent = await getRecentlyExecutedRunCaseIds(
      db,
      f.junitRunId,
      daysBefore(1.5)
    );
    // d1 results only: fail, flaky, quarantined — the run has NO TestRunCases
    // rows at all, so the union's JUnit arm is what finds these.
    expect([...junitRecent].sort((a, b) => a - b)).toEqual(
      [f.caseFail, f.caseFlaky, f.caseQuarantined].sort((a, b) => a - b)
    );
    expect(junitRecent).not.toContain(f.casePass);
    expect(junitRecent).not.toContain(f.caseReq);

    const manualRecent = await getRecentlyExecutedRunCaseIds(
      db,
      f.manualRunId,
      daysBefore(2)
    );
    expect(manualRecent).toEqual([f.caseManual]);

    expect(
      await getRecentlyExecutedRunCaseIds(db, f.junitRunId, new Date())
    ).toEqual([]);
  });

  it("applies per-project weights and skips unchanged recomputes", async () => {
    const f = fixture!;
    await db.projects.update({
      where: { id: f.projectId },
      data: {
        riskWeights: {
          failureHistory: 100,
          flakiness: 0,
          staleness: 0,
          criticality: 0,
          defects: 0,
        },
      },
    });
    const secondNow = new Date(NOW.getTime() + 60_000);
    await updateProjectRiskScores(db, f.projectId, { now: secondNow });

    // One FAILURE over one PASSED: 1 / (1 + 0.75) → 57.
    const fail = await readCase(f.caseFail);
    expect(fail.riskScore).toBe(57);
    expect(fail.riskComputedAt?.toISOString()).toBe(secondNow.toISOString());
    const pass = await readCase(f.casePass);
    expect(pass.riskScore).toBe(0);
    // Score-identical rows still rewrite on a weight change, so the stored
    // breakdown never describes a stale configuration.
    expect(pass.riskComputedAt?.toISOString()).toBe(secondNow.toISOString());
    expect(
      pass.reasons?.components.find((c) => c.key === "failureHistory")?.weight
    ).toBe(100);

    // Same weights, nothing changed: the write (and timestamp) is skipped.
    const thirdNow = new Date(NOW.getTime() + 120_000);
    const result = await updateProjectRiskScores(db, f.projectId, {
      now: thirdNow,
    });
    expect(result.updated).toBe(0);
    const unchanged = await readCase(f.caseFail);
    expect(unchanged.riskComputedAt?.toISOString()).toBe(
      secondNow.toISOString()
    );

    // Invalid stored weights fall back to defaults rather than failing.
    await db.projects.update({
      where: { id: f.projectId },
      data: { riskWeights: { failureHistory: -5 } },
    });
    const fourthNow = new Date(NOW.getTime() + 180_000);
    const fallback = await updateProjectRiskScores(db, f.projectId, {
      now: fourthNow,
    });
    expect(fallback.scanned).toBe(9);
  });
});
