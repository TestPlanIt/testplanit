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
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
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
