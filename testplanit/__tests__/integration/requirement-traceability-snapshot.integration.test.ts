// Live-DB integration proof for requirement traceability snapshots: the
// capture writes a header plus one entry per requirement in one
// transaction, the load unfolds them back into EXACTLY the rows the live
// loader produces for the same tree, the project pin refuses a foreign
// project's id, and a soft-deleted snapshot stops resolving.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-traceability-snapshot.integration.test.ts
//
// The fixture is deliberately small — a root requirement with one child,
// both uncovered — because the FOLD/UNFOLD of covered rows is proven by
// the pure module's round-trip test on a richer in-memory forest; what
// only a live database can prove is the transaction, the JSON column
// round trip, the timestamp precision, the project pin, and the
// soft-delete gate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { sameExecutionScope } from "~/lib/services/executionScopeParam";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";
import {
  captureRequirementTraceabilitySnapshot,
  loadRequirementTraceabilitySnapshot,
  toSnapshotTraceabilityData,
} from "~/lib/services/requirementTraceabilitySnapshot";
import {
  diffSnapshotEntries,
  groupTraceabilityRows,
} from "~/lib/services/requirementTraceabilitySnapshotShape";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rts-${Date.now()}`;

describeIntegration("requirement traceability snapshots (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let otherProjectId: number;
  let rootId: number;
  let childId: number;
  const snapshotIds: number[] = [];

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against a tpi_* scratch DB (tpi_req20 locally, tpi_test in CI), never \`ew\``
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Snapshot Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await db.projects.create({
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;
    const otherProject = await db.projects.create({
      data: { name: `${STAMP}-other`, createdBy: adminUserId },
      select: { id: true },
    });
    otherProjectId = otherProject.id;

    const root = await db.issue.create({
      data: {
        name: `${STAMP}-ROOT`,
        title: `${STAMP}-ROOT title`,
        createdById: adminUserId,
        projectId,
        isRequirement: true,
      },
      select: { id: true },
    });
    rootId = root.id;
    const child = await db.issue.create({
      data: {
        name: `${STAMP}-CHILD`,
        title: `${STAMP}-CHILD title`,
        createdById: adminUserId,
        projectId,
        parentId: rootId,
        isRequirement: true,
      },
      select: { id: true },
    });
    childId = child.id;
  });

  afterAll(async () => {
    if (snapshotIds.length > 0) {
      // Hard delete through the raw client; entries cascade.
      await db.requirementTraceabilitySnapshot.deleteMany({
        where: { id: { in: snapshotIds } },
      });
    }
    if (childId) await db.issue.deleteMany({ where: { id: childId } });
    if (rootId) await db.issue.deleteMany({ where: { id: rootId } });
    if (otherProjectId) {
      await db.projects.deleteMany({ where: { id: otherProjectId } });
    }
    if (projectId) await db.projects.deleteMany({ where: { id: projectId } });
    if (adminUserId) await db.user.deleteMany({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("captures the whole project: header counts, one entry per requirement, frozen parent ids", async () => {
    const header = await captureRequirementTraceabilitySnapshot(
      {
        projectId,
        name: `${STAMP} whole`,
        note: "evidence",
        capturedById: adminUserId,
      },
      { accessibleProjectIds: null },
      db
    );
    snapshotIds.push(header.id);

    expect(header).toMatchObject({
      projectId,
      name: `${STAMP} whole`,
      note: "evidence",
      capturedById: adminUserId,
      scopeRequirementIds: [],
      requirementCount: 2,
      passedCount: 0,
      failedCount: 0,
      notRunCount: 0,
      uncoveredCount: 2,
      caseLinkCount: 0,
    });

    const entries = await db.requirementTraceabilitySnapshotEntry.findMany({
      where: { snapshotId: header.id },
      orderBy: { id: "asc" },
    });
    expect(entries).toHaveLength(2);
    const byRequirement = new Map(entries.map((e) => [e.requirementId, e]));
    expect(byRequirement.get(rootId)).toMatchObject({
      requirementKey: `${STAMP}-ROOT`,
      requirementParentId: null,
      requirementRootId: rootId,
      coverageStatus: "UNCOVERED",
      linkedCaseCount: 0,
      cases: [],
    });
    expect(byRequirement.get(childId)).toMatchObject({
      requirementParentId: rootId,
      requirementRootId: rootId,
      requirementParentPath: `${STAMP}-ROOT`,
    });
  });

  it("unfolds to exactly the live loader's rows, and diffs against live as all-unchanged", async () => {
    const loaded = await loadRequirementTraceabilitySnapshot(
      snapshotIds[0],
      projectId,
      db
    );
    expect(loaded).not.toBeNull();
    const live = await loadRequirementTraceability(
      projectId,
      { accessibleProjectIds: null },
      db
    );

    const data = toSnapshotTraceabilityData(loaded!);
    expect(data.snapshot).toMatchObject({
      id: snapshotIds[0],
      name: `${STAMP} whole`,
    });
    expect(data.projectName).toBe(`${STAMP}-project`);
    expect(data.rows).toEqual(live.rows);

    const changes = diffSnapshotEntries(
      loaded!.entries,
      groupTraceabilityRows(live.rows)
    );
    expect(changes.map((row) => row.changeKind)).toEqual([
      "UNCHANGED",
      "UNCHANGED",
    ]);
  });

  it("refuses a snapshot id under a different project", async () => {
    expect(
      await loadRequirementTraceabilitySnapshot(
        snapshotIds[0],
        otherProjectId,
        db
      )
    ).toBeNull();
  });

  it("captures a scoped subtree and records the scope", async () => {
    const header = await captureRequirementTraceabilitySnapshot(
      {
        projectId,
        name: `${STAMP} scoped`,
        rootIds: [childId],
        capturedById: adminUserId,
      },
      { accessibleProjectIds: null },
      db
    );
    snapshotIds.push(header.id);

    expect(header.scopeRequirementIds).toEqual([childId]);
    expect(header.requirementCount).toBe(1);
    const loaded = await loadRequirementTraceabilitySnapshot(
      header.id,
      projectId,
      db
    );
    expect(loaded!.entries.map((entry) => entry.requirementId)).toEqual([
      childId,
    ]);
    // Paths are relative to the scoped root, as the live scoped report's are.
    expect(loaded!.entries[0].requirementParentPath).toBe("");
  });

  it("stops resolving once soft-deleted", async () => {
    await db.requirementTraceabilitySnapshot.update({
      where: { id: snapshotIds[1] },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    expect(
      await loadRequirementTraceabilitySnapshot(snapshotIds[1], projectId, db)
    ).toBeNull();
    // The entries are still there for the audit trail — only the header
    // is hidden.
    expect(
      await db.requirementTraceabilitySnapshotEntry.count({
        where: { snapshotId: snapshotIds[1] },
      })
    ).toBe(1);
  });
});

// Its own client + connection pool: the block above disconnects `db` in its
// afterAll, and vitest runs the two describes back to back in one file.
const scopeDb = createRawDbClient();

/**
 * Execution-scope (milestone/configuration) snapshots.
 *
 * A capture may be frozen inside an execution frame — "how did coverage
 * look counting only the runs in milestone M" — and that frame is
 * persisted onto the header (`scopeMilestoneIds` / `scopeConfigIds`) so a
 * scoped baseline can only ever be compared within the same frame.
 *
 * Three things only a live database can prove:
 *  1. the two Json columns round-trip and come back out of the reader
 *     parsed as `number[]`;
 *  2. the frame actually reaches `loadRequirementTraceability`'s
 *     latest-result CTE, so a scoped capture of the SAME requirements
 *     summarises to DIFFERENT counts than an unscoped one;
 *  3. `sameExecutionScope` — the lowest layer the changes report's refusal
 *     lives in (`lib/services/executionScopeParam.ts`, applied by
 *     `handleRequirementCoverageChangesPOST` in
 *     `utils/requirementCoverageReportUtils.ts`) — reads those persisted
 *     headers as different frames and so refuses the diff.
 *
 * The fixture makes the scoped and unscoped answers DISAGREE rather than
 * merely differ in volume: the in-milestone execution is the OLDER one, so
 * a capture that dropped the frame would report the newer out-of-milestone
 * result and land on the opposite status.
 */
describeIntegration(
  "requirement traceability snapshots — execution scope (live DB)",
  () => {
    let adminUserId: string;
    let projectId: number;
    let repositoryId: number;
    let folderId: number;
    let milestoneId: number;
    let configId: number;
    let reqSwingId: number;
    let reqNotRunId: number;
    let reqUncoveredId: number;
    let caseSwingId: number;
    let caseNeverRunId: number;
    const runIds: number[] = [];
    const snapshotIds: number[] = [];

    beforeAll(async () => {
      const [{ current_database: dbName }] = await scopeDb.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (!dbName.startsWith("tpi_")) {
        throw new Error(
          `refusing to run against database "${dbName}" — this suite only runs against a tpi_* scratch DB (tpi_req20 locally, tpi_test in CI), never \`ew\``
        );
      }

      const role = await scopeDb.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
      });
      const template = await scopeDb.templates.findFirst({
        select: { id: true },
      });
      const caseWorkflow = await scopeDb.workflows.findFirst({
        where: { scope: "CASES", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      const runWorkflow = await scopeDb.workflows.findFirst({
        where: { scope: "RUNS", isDeleted: false, isEnabled: true },
        select: { id: true },
      });
      // Status semantics come from the flags, never the names.
      const passingStatus = await scopeDb.status.findFirst({
        where: { isSuccess: true, isCompleted: true, isDeleted: false },
        select: { id: true },
      });
      const failingStatus = await scopeDb.status.findFirst({
        where: { isFailure: true, isCompleted: true, isDeleted: false },
        select: { id: true },
      });
      const milestoneType = await scopeDb.milestoneTypes.findFirst({
        select: { id: true },
      });
      if (
        !role ||
        !template ||
        !caseWorkflow ||
        !runWorkflow ||
        !passingStatus ||
        !failingStatus ||
        !milestoneType
      ) {
        throw new Error(
          "Test prerequisite rows missing (role/template/workflow/status/milestoneType)"
        );
      }

      const admin = await scopeDb.user.create({
        data: {
          email: `${STAMP}-scope-admin@example.com`,
          name: `Snapshot Scope Admin ${STAMP}`,
          authMethod: "INTERNAL",
          access: "ADMIN",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      adminUserId = admin.id;

      const project = await scopeDb.projects.create({
        data: { name: `${STAMP}-scope-project`, createdBy: adminUserId },
        select: { id: true },
      });
      projectId = project.id;
      const repository = await scopeDb.repositories.create({
        data: { projectId },
        select: { id: true },
      });
      repositoryId = repository.id;
      const folder = await scopeDb.repositoryFolders.create({
        data: {
          name: `${STAMP}-scope-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      });
      folderId = folder.id;

      const createRequirement = async (tag: string) =>
        (
          await scopeDb.issue.create({
            data: {
              name: `${STAMP}-${tag}`,
              title: `${STAMP}-${tag} title`,
              createdById: adminUserId,
              projectId,
              isRequirement: true,
            },
            select: { id: true },
          })
        ).id;
      // Named for what each one proves, not for its eventual status: the
      // swing requirement is the one whose answer FLIPS with the frame.
      reqSwingId = await createRequirement("SCOPE-SWING");
      reqNotRunId = await createRequirement("SCOPE-NOTRUN");
      reqUncoveredId = await createRequirement("SCOPE-UNCOVERED");

      const createCase = async (tag: string) =>
        (
          await scopeDb.repositoryCases.create({
            data: {
              projectId,
              repositoryId,
              folderId,
              templateId: template.id,
              name: `${STAMP}-${tag}`,
              stateId: caseWorkflow.id,
              creatorId: adminUserId,
            },
            select: { id: true },
          })
        ).id;
      caseSwingId = await createCase("case-swing");
      caseNeverRunId = await createCase("case-never-run");
      await scopeDb.repositoryCaseIssue.create({
        data: { caseId: caseSwingId, issueId: reqSwingId },
      });
      await scopeDb.repositoryCaseIssue.create({
        data: { caseId: caseNeverRunId, issueId: reqNotRunId },
      });

      const milestone = await scopeDb.milestones.create({
        data: {
          name: `${STAMP}-scope-milestone`,
          projectId,
          milestoneTypesId: milestoneType.id,
          createdBy: adminUserId,
        },
        select: { id: true },
      });
      milestoneId = milestone.id;
      const config = await scopeDb.configurations.create({
        data: { name: `${STAMP}-scope-config` },
        select: { id: true },
      });
      configId = config.id;

      const createRun = async (
        tag: string,
        runMilestoneId: number | null,
        runConfigId: number | null
      ) => {
        const run = await scopeDb.testRuns.create({
          data: {
            projectId,
            name: `${STAMP}-${tag}`,
            stateId: runWorkflow.id,
            createdById: adminUserId,
            milestoneId: runMilestoneId,
            configId: runConfigId,
          },
          select: { id: true },
        });
        runIds.push(run.id);
        return run.id;
      };
      const recordExecution = async (
        runId: number,
        statusId: number,
        executedAt: Date
      ) => {
        const runCase = await scopeDb.testRunCases.create({
          data: { testRunId: runId, repositoryCaseId: caseSwingId },
          select: { id: true },
        });
        await scopeDb.testRunResults.create({
          data: {
            testRunId: runId,
            testRunCaseId: runCase.id,
            statusId,
            executedById: adminUserId,
            executedAt,
          },
        });
      };

      // Timeline (oldest -> newest) for the swing case:
      //   t1  PASSED  in the milestone (+ configuration) run
      //   t2  FAILED  in a run attached to neither axis
      // Unscoped latest = the FAILED run. Scoped to the milestone = the
      // PASSED one. Opposite answers over the same requirements.
      const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const t2 = new Date(Date.now() - 1 * 60 * 60 * 1000);
      const inFrameRunId = await createRun(
        "scope-run-in-frame",
        milestoneId,
        configId
      );
      await recordExecution(inFrameRunId, passingStatus.id, t1);
      const outOfFrameRunId = await createRun(
        "scope-run-out-of-frame",
        null,
        null
      );
      await recordExecution(outOfFrameRunId, failingStatus.id, t2);
    });

    afterAll(async () => {
      if (snapshotIds.length > 0) {
        await scopeDb.requirementTraceabilitySnapshot.deleteMany({
          where: { id: { in: snapshotIds } },
        });
      }
      if (runIds.length > 0) {
        await scopeDb.testRunResults.deleteMany({
          where: { testRunId: { in: runIds } },
        });
        await scopeDb.testRunCases.deleteMany({
          where: { testRunId: { in: runIds } },
        });
        await scopeDb.testRuns.deleteMany({ where: { id: { in: runIds } } });
      }
      if (milestoneId) {
        await scopeDb.milestones.deleteMany({ where: { id: milestoneId } });
      }
      if (configId) {
        await scopeDb.configurations.deleteMany({ where: { id: configId } });
      }
      const caseIds = [caseSwingId, caseNeverRunId].filter(
        (id): id is number => typeof id === "number"
      );
      if (caseIds.length > 0) {
        await scopeDb.repositoryCaseIssue.deleteMany({
          where: { caseId: { in: caseIds } },
        });
        await scopeDb.repositoryCases.deleteMany({
          where: { id: { in: caseIds } },
        });
      }
      const requirementIds = [reqSwingId, reqNotRunId, reqUncoveredId].filter(
        (id): id is number => typeof id === "number"
      );
      if (requirementIds.length > 0) {
        await scopeDb.issue.deleteMany({
          where: { id: { in: requirementIds } },
        });
      }
      if (folderId) {
        await scopeDb.repositoryFolders.deleteMany({ where: { id: folderId } });
      }
      if (repositoryId) {
        await scopeDb.repositories.deleteMany({ where: { id: repositoryId } });
      }
      if (projectId)
        await scopeDb.projects.deleteMany({ where: { id: projectId } });
      if (adminUserId)
        await scopeDb.user.deleteMany({ where: { id: adminUserId } });
      await scopeDb.$disconnect();
    });

    it("persists input.executionScope onto the header and returns it parsed from the reader", async () => {
      const header = await captureRequirementTraceabilitySnapshot(
        {
          projectId,
          name: `${STAMP} both axes`,
          capturedById: adminUserId,
          executionScope: {
            milestoneIds: [milestoneId],
            configIds: [configId],
          },
        },
        { accessibleProjectIds: null },
        scopeDb
      );
      snapshotIds.push(header.id);

      expect(header.scopeMilestoneIds).toEqual([milestoneId]);
      expect(header.scopeConfigIds).toEqual([configId]);

      // The reader re-reads the Json columns off the row (not the value the
      // capture happened to hold in memory) and hands back real integers.
      const loaded = await loadRequirementTraceabilitySnapshot(
        header.id,
        projectId,
        scopeDb
      );
      expect(loaded).not.toBeNull();
      expect(loaded!.snapshot.scopeMilestoneIds).toEqual([milestoneId]);
      expect(loaded!.snapshot.scopeConfigIds).toEqual([configId]);
      expect(
        [
          ...loaded!.snapshot.scopeMilestoneIds,
          ...loaded!.snapshot.scopeConfigIds,
        ].every((id) => typeof id === "number" && Number.isInteger(id))
      ).toBe(true);

      // An unscoped capture stores the empty frame on both axes — "no
      // scope" is [] here, never null and never a missing key.
      const unscoped = await captureRequirementTraceabilitySnapshot(
        {
          projectId,
          name: `${STAMP} unscoped`,
          capturedById: adminUserId,
        },
        { accessibleProjectIds: null },
        scopeDb
      );
      snapshotIds.push(unscoped.id);
      expect(unscoped.scopeMilestoneIds).toEqual([]);
      expect(unscoped.scopeConfigIds).toEqual([]);
      const loadedUnscoped = await loadRequirementTraceabilitySnapshot(
        unscoped.id,
        projectId,
        scopeDb
      );
      expect(loadedUnscoped!.snapshot.scopeMilestoneIds).toEqual([]);
      expect(loadedUnscoped!.snapshot.scopeConfigIds).toEqual([]);
    });

    it("a milestone-scoped capture counts the same requirements differently from an unscoped one", async () => {
      const scoped = await captureRequirementTraceabilitySnapshot(
        {
          projectId,
          name: `${STAMP} milestone scoped`,
          capturedById: adminUserId,
          executionScope: { milestoneIds: [milestoneId] },
        },
        { accessibleProjectIds: null },
        scopeDb
      );
      snapshotIds.push(scoped.id);
      const unscoped = await captureRequirementTraceabilitySnapshot(
        {
          projectId,
          name: `${STAMP} global`,
          capturedById: adminUserId,
        },
        { accessibleProjectIds: null },
        scopeDb
      );
      snapshotIds.push(unscoped.id);

      // Same requirements and the same case links on both sides — the
      // frame changes WHICH execution counts, never the membership.
      expect(scoped.requirementCount).toBe(3);
      expect(unscoped.requirementCount).toBe(3);
      expect(scoped.caseLinkCount).toBe(unscoped.caseLinkCount);

      // Inside the milestone the swing requirement's only execution is the
      // older PASS.
      expect(scoped).toMatchObject({
        scopeMilestoneIds: [milestoneId],
        scopeConfigIds: [],
        passedCount: 1,
        failedCount: 0,
        notRunCount: 1,
        uncoveredCount: 1,
      });
      // Globally the newer, out-of-frame FAIL wins instead.
      expect(unscoped).toMatchObject({
        scopeMilestoneIds: [],
        scopeConfigIds: [],
        passedCount: 0,
        failedCount: 1,
        notRunCount: 1,
        uncoveredCount: 1,
      });

      const scopedEntries = (await loadRequirementTraceabilitySnapshot(
        scoped.id,
        projectId,
        scopeDb
      ))!.entries;
      const unscopedEntries = (await loadRequirementTraceabilitySnapshot(
        unscoped.id,
        projectId,
        scopeDb
      ))!.entries;
      const statusOf = (entries: typeof scopedEntries, requirementId: number) =>
        entries.find((entry) => entry.requirementId === requirementId)
          ?.coverageStatus;
      expect(statusOf(scopedEntries, reqSwingId)).toBe("PASSED");
      expect(statusOf(unscopedEntries, reqSwingId)).toBe("FAILED");
      // The two controls are frame-independent: a linked-but-never-executed
      // case is NOT_RUN either way, and an unlinked requirement is
      // UNCOVERED either way.
      expect(statusOf(scopedEntries, reqNotRunId)).toBe("NOT_RUN");
      expect(statusOf(unscopedEntries, reqNotRunId)).toBe("NOT_RUN");
      expect(statusOf(scopedEntries, reqUncoveredId)).toBe("UNCOVERED");
      expect(statusOf(unscopedEntries, reqUncoveredId)).toBe("UNCOVERED");
    });

    it("refuses to diff a scoped snapshot against an unscoped one (sameExecutionScope, the lowest layer the guard lives in)", async () => {
      const capture = async (
        name: string,
        executionScope?: { milestoneIds: number[] }
      ) => {
        const header = await captureRequirementTraceabilitySnapshot(
          {
            projectId,
            name: `${STAMP} ${name}`,
            capturedById: adminUserId,
            executionScope,
          },
          { accessibleProjectIds: null },
          scopeDb
        );
        snapshotIds.push(header.id);
        return header.id;
      };
      const scopedId = await capture("guard scoped", {
        milestoneIds: [milestoneId],
      });
      const unscopedId = await capture("guard unscoped");
      const scopedAgainId = await capture("guard scoped again", {
        milestoneIds: [milestoneId],
      });

      const load = async (id: number) =>
        (await loadRequirementTraceabilitySnapshot(id, projectId, scopeDb))!;
      const scoped = await load(scopedId);
      const unscoped = await load(unscopedId);
      const scopedAgain = await load(scopedAgainId);

      // This is the exact call `handleRequirementCoverageChangesPOST` makes
      // on the two loaded headers before it will diff them; false is its
      // 400 "Snapshots were captured under different execution scopes".
      expect(sameExecutionScope(scoped.snapshot, unscoped.snapshot)).toBe(
        false
      );
      expect(sameExecutionScope(unscoped.snapshot, scoped.snapshot)).toBe(
        false
      );
      // Two captures inside the SAME frame are comparable, so the guard is
      // refusing the frame mismatch and not simply every pair.
      expect(sameExecutionScope(scoped.snapshot, scopedAgain.snapshot)).toBe(
        true
      );
      // ...and those same-frame entries diff cleanly, so the refusal above
      // is the guard's doing rather than an empty or broken comparison.
      expect(
        diffSnapshotEntries(scoped.entries, scopedAgain.entries).map(
          (row) => row.changeKind
        )
      ).toEqual(["UNCHANGED", "UNCHANGED", "UNCHANGED"]);
      // The cross-frame pair the guard refuses would NOT have been a no-op:
      // the swing requirement's status differs between the two frames, so
      // an unguarded diff would have reported a coverage change that never
      // happened.
      expect(
        diffSnapshotEntries(scoped.entries, unscoped.entries).filter(
          (row) => row.changeKind === "COVERAGE_CHANGED"
        )
      ).toHaveLength(1);
    });
  }
);
