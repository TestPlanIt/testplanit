/**
 * Live-DB proof of the requirement content-versioning trigger
 * (tpl_issue_version_capture, scripts/apply-triggers.ts): every
 * title/description/note change to an isRequirement row must capture a
 * version and bump currentVersion; everything else must leave the table
 * alone. Runs only against the scratch database (same guard as the other
 * integration suites) because it writes and tears down fixture rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { createRawDbClient } from "~/lib/rawDbClient";
import { ISSUE_VERSION_CAPTURE_TRIGGER_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `ivc-${Date.now()}`;

describeIntegration("issue version capture trigger (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let requirementId: number;
  let defectId: number;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    // The suite proves the trigger AS SHIPPED: apply the exact SQL the
    // deploy path applies, idempotently, so a scratch DB that predates the
    // trigger still runs the real thing. A raw pg client, because the DDL
    // is multi-statement (function + drop + create) and the extended
    // protocol the ORM speaks refuses multi-statement strings.
    const ddl = new Client({ connectionString: process.env.DATABASE_URL });
    await ddl.connect();
    try {
      await ddl.query(ISSUE_VERSION_CAPTURE_TRIGGER_SQL);
    } finally {
      await ddl.end();
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Version Capture Admin ${STAMP}`,
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

    const requirement = await db.issue.create({
      data: {
        name: `${STAMP}-req`,
        title: `${STAMP}-title-v1`,
        description: "original description",
        createdById: adminUserId,
        projectId,
        isRequirement: true,
      },
      select: { id: true },
    });
    requirementId = requirement.id;

    const defect = await db.issue.create({
      data: {
        name: `${STAMP}-defect`,
        title: `${STAMP}-defect-title`,
        createdById: adminUserId,
        projectId,
        isRequirement: false,
      },
      select: { id: true },
    });
    defectId = defect.id;
  });

  afterAll(async () => {
    await db.issueVersions.deleteMany({
      where: { issueId: { in: [requirementId, defectId] } },
    });
    await db.issue.deleteMany({
      where: { id: { in: [requirementId, defectId] } },
    });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("captures v1 (the pre-change text) and v2 on the first title change, bumping currentVersion", async () => {
    await db.issue.update({
      where: { id: requirementId },
      data: { title: `${STAMP}-title-v2` },
    });

    const row = await db.issue.findUnique({
      where: { id: requirementId },
      select: { currentVersion: true },
    });
    expect(row?.currentVersion).toBe(2);

    const versions = await db.issueVersions.findMany({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].title).toBe(`${STAMP}-title-v1`);
    expect(versions[0].changedById).toBeNull();
    expect(versions[1].title).toBe(`${STAMP}-title-v2`);
  });

  it("captures a further version on a description change, without re-backfilling", async () => {
    await db.issue.update({
      where: { id: requirementId },
      data: { description: "revised description" },
    });

    const versions = await db.issueVersions.findMany({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[2].description).toBe("revised description");
    expect(versions[2].title).toBe(`${STAMP}-title-v2`);
  });

  it("ignores a write that changes none of the three content columns", async () => {
    await db.issue.update({
      where: { id: requirementId },
      data: { title: `${STAMP}-title-v2`, priority: "High" },
    });

    const row = await db.issue.findUnique({
      where: { id: requirementId },
      select: { currentVersion: true },
    });
    expect(row?.currentVersion).toBe(3);
    const count = await db.issueVersions.count({
      where: { issueId: requirementId },
    });
    expect(count).toBe(3);
  });

  it("never versions a non-requirement issue", async () => {
    await db.issue.update({
      where: { id: defectId },
      data: { title: `${STAMP}-defect-title-changed` },
    });

    const row = await db.issue.findUnique({
      where: { id: defectId },
      select: { currentVersion: true },
    });
    expect(row?.currentVersion).toBe(1);
    const count = await db.issueVersions.count({
      where: { issueId: defectId },
    });
    expect(count).toBe(0);
  });

  it("attributes the change to the audit GUC's actor when one is set", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${JSON.stringify(
        { userId: adminUserId }
      )}, true)`;
      await tx.issue.update({
        where: { id: requirementId },
        data: { title: `${STAMP}-title-v4` },
      });
    });

    const latest = await db.issueVersions.findFirst({
      where: { issueId: requirementId },
      orderBy: { version: "desc" },
    });
    expect(latest?.version).toBe(4);
    expect(latest?.changedById).toBe(adminUserId);
  });
});
