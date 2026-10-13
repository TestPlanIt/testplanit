// Live-DB proof of the `tpl_stamp_deleted_at_*` BEFORE UPDATE triggers
// (scripts/apply-triggers.ts, driven by SOFT_DELETE_REGISTRY in
// scripts/trigger-registry.ts).
//
// `isDeleted` stays the queryable liveness flag; `deletedAt` is retention
// metadata the DATABASE stamps, never the application — which is exactly why
// this can only be proven live. The writes below go through the app's own ORM
// client and never mention `deletedAt`, so every timestamp asserted here was
// produced by the trigger.
//
// Three behaviours, each on THREE different tables (a project-scoped case row,
// a project-scoped milestone, and a global tag) — the trigger is attached
// per-table from one registry, so a single-table proof would not show that the
// registry actually reached the other tables:
//   * false → true stamps `deletedAt` at the database's own clock;
//   * true → false (restore) clears it back to NULL;
//   * an unrelated column update on an already-deleted row leaves it alone —
//     the attaching trigger is gated `WHEN (NEW."isDeleted" IS DISTINCT FROM
//     OLD."isDeleted")`, so a re-save must never re-stamp the deletion moment
//     and silently extend the retention window.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`):
//   DATABASE_URL="<scratch tpi_* url>" RUN_DB_INTEGRATION=1 pnpm exec vitest \
//     run __tests__/integration/deleted-at-trigger.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `dat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Tolerance between the stamped `deletedAt` and the database clock read
 * immediately after the flip. Generous enough for a loaded scratch server,
 * tight enough that a wrong-source timestamp (an app clock, a default, a
 * carried-over value) fails. */
const CLOCK_TOLERANCE_MS = 5_000;

/** The three registry tables under test, and the ORM delegate for each. */
const SUBJECTS = [
  { table: "RepositoryCases", delegate: "repositoryCases" },
  { table: "Milestones", delegate: "milestones" },
  { table: "Tags", delegate: "tags" },
] as const;

type SoftDeleteRow = {
  isDeleted: boolean;
  deletedAt: Date | null;
  name: string | null;
};

type SoftDeleteDelegate = {
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  findUniqueOrThrow: (args: {
    where: { id: number };
    select: { isDeleted: true; deletedAt: true; name: true };
  }) => Promise<SoftDeleteRow>;
  deleteMany: (args: { where: { id: number } }) => Promise<unknown>;
};

const delegateFor = (name: string) =>
  (db as unknown as Record<string, SoftDeleteDelegate>)[name];

/** Row ids created in beforeAll, keyed by table — describe.each below is
 * collected before the fixture exists, so it reads through this map. */
const subjectIds = new Map<string, number>();

const dbNow = async () => {
  const [{ now }] = await db.$queryRaw<Array<{ now: Date }>>`SELECT now()`;
  return new Date(now).getTime();
};

const read = (table: string) =>
  delegateFor(
    SUBJECTS.find((s) => s.table === table)!.delegate
  ).findUniqueOrThrow({
    where: { id: subjectIds.get(table)! },
    select: { isDeleted: true, deletedAt: true, name: true },
  });

const write = (table: string, data: Record<string, unknown>) =>
  delegateFor(SUBJECTS.find((s) => s.table === table)!.delegate).update({
    where: { id: subjectIds.get(table)! },
    data,
  });

describeIntegration("tpl_stamp_deleted_at_* triggers (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against a tpi_* scratch DB, never \`ew\``
      );
    }

    // All three triggers must be attached, or a NULL deletedAt below would
    // read as a trigger bug rather than as an unprepared database.
    const expectedTriggers = SUBJECTS.map(
      (subject) =>
        `tpl_stamp_deleted_at_${subject.table.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
    );
    const attached = await db.$queryRaw<Array<{ trigger_name: string }>>`
      SELECT DISTINCT trigger_name
        FROM information_schema.triggers
       WHERE trigger_name = ANY(${expectedTriggers}::text[])
    `;
    const missing = expectedTriggers.filter(
      (name) => !attached.some((row) => row.trigger_name === name)
    );
    if (missing.length > 0) {
      throw new Error(
        `Test prerequisite: missing triggers ${missing.join(", ")} — run scripts/apply-triggers.ts against this database`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    const template = await db.templates.findFirst({ select: { id: true } });
    const caseWorkflow = await db.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const milestoneType = await db.milestoneTypes.findFirst({
      select: { id: true },
    });
    if (!role || !template || !caseWorkflow || !milestoneType) {
      throw new Error(
        "Test prerequisite rows missing (role/template/workflow/milestoneType)"
      );
    }

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Deleted-At Admin ${STAMP}`,
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
    const repository = await db.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    repositoryId = repository.id;
    const folder = await db.repositoryFolders.create({
      data: {
        name: `${STAMP}-folder`,
        repositoryId,
        projectId,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    folderId = folder.id;

    const testCase = await db.repositoryCases.create({
      data: {
        projectId,
        repositoryId,
        folderId,
        templateId: template.id,
        name: `${STAMP}-case`,
        stateId: caseWorkflow.id,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    subjectIds.set("RepositoryCases", testCase.id);

    const milestone = await db.milestones.create({
      data: {
        name: `${STAMP}-milestone`,
        projectId,
        milestoneTypesId: milestoneType.id,
        createdBy: adminUserId,
      },
      select: { id: true },
    });
    subjectIds.set("Milestones", milestone.id);

    const tag = await db.tags.create({
      data: { name: `${STAMP}-tag` },
      select: { id: true },
    });
    subjectIds.set("Tags", tag.id);
  });

  afterAll(async () => {
    const tagId = subjectIds.get("Tags");
    if (tagId) await db.tags.deleteMany({ where: { id: tagId } });
    const milestoneId = subjectIds.get("Milestones");
    if (milestoneId) {
      await db.milestones.deleteMany({ where: { id: milestoneId } });
    }
    const caseId = subjectIds.get("RepositoryCases");
    if (caseId) await db.repositoryCases.deleteMany({ where: { id: caseId } });
    if (folderId) {
      await db.repositoryFolders.deleteMany({ where: { id: folderId } });
    }
    if (repositoryId) {
      await db.repositories.deleteMany({ where: { id: repositoryId } });
    }
    if (projectId) await db.projects.deleteMany({ where: { id: projectId } });
    if (adminUserId) await db.user.deleteMany({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  describe.each(SUBJECTS)("$table", ({ table }) => {
    it("stamps deletedAt from the database clock on the soft delete, clears it on restore, and leaves it alone on an unrelated edit", async () => {
      // A live row carries no tombstone.
      const initial = await read(table);
      expect(initial.isDeleted).toBe(false);
      expect(initial.deletedAt).toBeNull();

      // ── false → true ────────────────────────────────────────────────
      // The write names only `isDeleted`; the timestamp can only come from
      // the trigger.
      const beforeFlip = await dbNow();
      await write(table, { isDeleted: true });
      const afterFlip = await dbNow();

      const deleted = await read(table);
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).not.toBeNull();
      const stampedAt = deleted.deletedAt!.getTime();
      // Inside the window the flip happened in, and within a few seconds of
      // the database's own clock (not the test runner's).
      expect(stampedAt).toBeGreaterThanOrEqual(beforeFlip - CLOCK_TOLERANCE_MS);
      expect(stampedAt).toBeLessThanOrEqual(afterFlip + CLOCK_TOLERANCE_MS);
      expect(Math.abs(afterFlip - stampedAt)).toBeLessThan(CLOCK_TOLERANCE_MS);

      // ── true → false (restore) ──────────────────────────────────────
      await write(table, { isDeleted: false });
      const restored = await read(table);
      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeNull();

      // ── an unrelated edit on an already-deleted row ─────────────────
      await write(table, { isDeleted: true });
      const reDeleted = await read(table);
      expect(reDeleted.deletedAt).not.toBeNull();
      const originalDeletionMoment = reDeleted.deletedAt!.getTime();

      const renamed = `${STAMP}-${table}-renamed`;
      await write(table, { name: renamed });
      const afterRename = await read(table);
      // The edit landed...
      expect(afterRename.name).toBe(renamed);
      expect(afterRename.isDeleted).toBe(true);
      // ...and the deletion moment is untouched, so the retention window
      // never restarts on an unrelated write.
      expect(afterRename.deletedAt!.getTime()).toBe(originalDeletionMoment);
    });
  });
});
