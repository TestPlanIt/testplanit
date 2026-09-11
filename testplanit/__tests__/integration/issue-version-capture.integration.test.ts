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
import { getAuthDb } from "~/lib/zenstack";
import { ISSUE_VERSION_CAPTURE_TRIGGER_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `ivc-${Date.now()}`;

/** The disposable databases this suite is allowed to write to. */
const SCRATCH_DATABASES = ["tpi_req20", "tpi_rc_test", "tpi_test"];

/**
 * Resolve the policy-plugin auth() context exactly the way a request does
 * (role + rolePermissions preloaded), mirroring issue-requirement-lock.test.ts.
 */
async function authDbFor(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) throw new Error(`Test setup: user ${userId} not found`);
  return getAuthDb(user as never);
}

/** True if the operation was blocked by policy (threw, or changed nothing). */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await fn();
    if (Array.isArray(result) && result.length === 0) return true;
    if (
      result &&
      typeof result === "object" &&
      "count" in result &&
      (result as { count: number }).count === 0
    )
      return true;
    return false;
  } catch {
    return true;
  }
}

describeIntegration("issue version capture trigger (live DB)", () => {
  let adminUserId: string;
  let memberUserId: string;
  let projectId: number;
  let requirementId: number;
  let defectId: number;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!SCRATCH_DATABASES.includes(dbName)) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against a scratch DB (${SCRATCH_DATABASES.join(
          ", "
        )})`
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

    // A plain USER with an explicit grant on the project — the ordinary
    // reader of a requirement's history.
    const member = await db.user.create({
      data: {
        email: `${STAMP}-member@example.com`,
        name: `Version Capture Member ${STAMP}`,
        authMethod: "INTERNAL",
        access: "USER",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    memberUserId = member.id;

    // NO_ACCESS default, so the member's access comes from the explicit grant
    // below and never from a permissive project default.
    const project = await db.projects.create({
      data: {
        name: `${STAMP}-project`,
        createdBy: adminUserId,
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
      select: { id: true },
    });
    projectId = project.id;

    await db.userProjectPermission.create({
      data: {
        userId: memberUserId,
        projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: role.id,
      },
    });

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
    await db.userProjectPermission.deleteMany({ where: { projectId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.deleteMany({
      where: { id: { in: [adminUserId, memberUserId] } },
    });
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

  // The rows above are trigger-written history. The model backs that with
  // `@@deny('create, update, delete', true)` (schema.zmodel, IssueVersions):
  // no app writer may forge, rewrite or erase a version — ADMIN included —
  // while reading stays open to any authenticated caller.

  it("REJECTS an IssueVersions create through an ADMIN policy client", async () => {
    const edb = await authDbFor(adminUserId);
    const before = await db.issueVersions.count({
      where: { issueId: requirementId },
    });

    expect(
      await isDenied(() =>
        edb.issueVersions.create({
          data: {
            issueId: requirementId,
            version: 99,
            title: `${STAMP}-forged`,
          },
        })
      )
    ).toBe(true);

    expect(
      await db.issueVersions.count({ where: { issueId: requirementId } })
    ).toBe(before);
    expect(
      await db.issueVersions.findFirst({ where: { title: `${STAMP}-forged` } })
    ).toBeNull();
  });

  it("REJECTS an IssueVersions update through an ADMIN policy client", async () => {
    const edb = await authDbFor(adminUserId);
    const target = await db.issueVersions.findFirstOrThrow({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });

    expect(
      await isDenied(() =>
        edb.issueVersions.update({
          where: { id: target.id },
          data: { title: `${STAMP}-rewritten` },
        })
      )
    ).toBe(true);

    const row = await db.issueVersions.findUnique({
      where: { id: target.id },
      select: { title: true },
    });
    expect(row?.title).toBe(target.title);
  });

  it("REJECTS an IssueVersions delete through an ADMIN policy client", async () => {
    const edb = await authDbFor(adminUserId);
    const target = await db.issueVersions.findFirstOrThrow({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });

    expect(
      await isDenied(() =>
        edb.issueVersions.delete({ where: { id: target.id } })
      )
    ).toBe(true);

    expect(
      await db.issueVersions.findUnique({ where: { id: target.id } })
    ).not.toBeNull();
  });

  it("lets a non-ADMIN project member READ the versions of a requirement they can see", async () => {
    const edb = await authDbFor(memberUserId);

    // The member reaches the requirement itself …
    const issue = await edb.issue.findUnique({ where: { id: requirementId } });
    expect(issue).not.toBeNull();

    // … and its history, ordered, with the captured text intact.
    const versions = await edb.issueVersions.findMany({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect(versions[0].title).toBe(`${STAMP}-title-v1`);
    expect(versions[3].title).toBe(`${STAMP}-title-v4`);
  });

  it("denies that same member every write to the history", async () => {
    const edb = await authDbFor(memberUserId);
    const target = await db.issueVersions.findFirstOrThrow({
      where: { issueId: requirementId },
      orderBy: { version: "asc" },
    });

    expect(
      await isDenied(() =>
        edb.issueVersions.create({
          data: {
            issueId: requirementId,
            version: 98,
            title: `${STAMP}-member-forged`,
          },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.issueVersions.update({
          where: { id: target.id },
          data: { title: `${STAMP}-member-rewritten` },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.issueVersions.delete({ where: { id: target.id } })
      )
    ).toBe(true);

    expect(
      await db.issueVersions.count({ where: { issueId: requirementId } })
    ).toBe(4);
  });
});
