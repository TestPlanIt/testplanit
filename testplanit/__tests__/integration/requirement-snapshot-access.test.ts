// Live-DB proof of the requirement-traceability snapshot access rules
// (schema.zmodel: RequirementTraceabilitySnapshot ~6121,
// RequirementTraceabilitySnapshotEntry ~6211).
//
// The header row is a Reporting-gated artifact with an immutable body: capture
// and rename ride the Reporting add/edit ladder, deletion needs Reporting
// delete, and every counted/scoped column carries a field-level
// `@deny('update', true)` so the numbers can never be edited after the fact —
// not even by an ADMIN, whose `@@allow('all', …)` a field-level deny outranks.
// A soft-deleted snapshot drops out of every read via `@@deny('read',
// isDeleted)`. The entry rows are read-only for everyone, ADMIN included: the
// model declares no create/update/delete rule at all, because the capture
// service writes them on the raw client.
//
// Field-level denies compile into the generated policy and only bite through
// the real policy client, so a mocked-db unit test cannot catch a regression.
//
// Run via (scratch DB only — never the .env DATABASE_URL):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-snapshot-access.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `rsa-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
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

interface Fixture {
  projectId: number;
  snapshotId: number; // readable, used for read/update attempts
  entryId: number; // one entry of `snapshotId`
  deletedSnapshotId: number; // isDeleted = true
  deletedEntryId: number;
  ownerId: string;
  viewer: AuthUser; // Reporting read-only member
  editor: AuthUser; // Reporting canAddEdit, NOT canDelete
  deleter: AuthUser; // Reporting canAddEdit + canDelete
  admin: AuthUser;
  outsider: AuthUser;
}

let fixture: Fixture | null = null;

const COUNTS = {
  requirementCount: 7,
  passedCount: 3,
  failedCount: 1,
  notRunCount: 2,
  uncoveredCount: 1,
  caseLinkCount: 5,
};

async function setupFixture(): Promise<Fixture> {
  const mkRole = async (
    label: string,
    perms: { canAddEdit: boolean; canDelete: boolean } | null
  ) =>
    db.roles.create({
      data: {
        name: `${TAG}-${label}`,
        ...(perms
          ? {
              rolePermissions: {
                create: [
                  {
                    area: "Reporting",
                    canAddEdit: perms.canAddEdit,
                    canDelete: perms.canDelete,
                  },
                ],
              },
            }
          : {}),
      },
      select: { id: true },
    });

  // Global roles carry nothing: every grant under test comes from the ROLE ON
  // THE PROJECT PERMISSION, which is what the Reporting ladder reads.
  const neutralRole = await mkRole("neutral", null);
  const viewRole = await mkRole("report-view", {
    canAddEdit: false,
    canDelete: false,
  });
  const editRole = await mkRole("report-edit", {
    canAddEdit: true,
    canDelete: false,
  });
  const deleteRole = await mkRole("report-delete", {
    canAddEdit: true,
    canDelete: true,
  });

  const mkUser = async (label: string, access: "USER" | "ADMIN" = "USER") =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        authMethod: "INTERNAL",
        access,
        roleId: neutralRole.id,
      },
      select: { id: true },
    });

  // `project.creator.id == auth().id` is itself a full grant, so the owner is
  // never an acting user below.
  const owner = await mkUser("owner");
  const viewer = await mkUser("viewer");
  const editor = await mkUser("editor");
  const deleter = await mkUser("deleter");
  const admin = await mkUser("admin", "ADMIN");
  const outsider = await mkUser("outsider");

  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: owner.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
    select: { id: true },
  });

  await db.userProjectPermission.createMany({
    data: [
      {
        userId: viewer.id,
        projectId: project.id,
        accessType: "SPECIFIC_ROLE",
        roleId: viewRole.id,
      },
      {
        userId: editor.id,
        projectId: project.id,
        accessType: "SPECIFIC_ROLE",
        roleId: editRole.id,
      },
      {
        userId: deleter.id,
        projectId: project.id,
        accessType: "SPECIFIC_ROLE",
        roleId: deleteRole.id,
      },
    ],
  });

  const mkSnapshot = async (label: string, isDeleted = false) =>
    db.requirementTraceabilitySnapshot.create({
      data: {
        projectId: project.id,
        name: `${TAG}-${label}`,
        capturedById: owner.id,
        scopeRequirementIds: [],
        scopeMilestoneIds: [],
        scopeConfigIds: [],
        ...COUNTS,
        isDeleted,
        ...(isDeleted ? { deletedAt: new Date() } : {}),
      },
      select: { id: true },
    });

  const mkEntry = async (snapshotId: number, key: string) =>
    db.requirementTraceabilitySnapshotEntry.create({
      data: {
        snapshotId,
        requirementId: 987654,
        requirementKey: key,
        requirementTitle: `${TAG} ${key}`,
        requirementPath: key,
        requirementParentPath: "",
        requirementRootId: 987654,
        coverageStatus: "UNCOVERED",
        linkedCaseCount: 0,
        cases: [],
      },
      select: { id: true },
    });

  const snapshot = await mkSnapshot("snapshot");
  const entry = await mkEntry(snapshot.id, `${TAG}-REQ-1`);
  const deletedSnapshot = await mkSnapshot("deleted-snapshot", true);
  const deletedEntry = await mkEntry(deletedSnapshot.id, `${TAG}-REQ-2`);

  return {
    projectId: project.id,
    snapshotId: snapshot.id,
    entryId: entry.id,
    deletedSnapshotId: deletedSnapshot.id,
    deletedEntryId: deletedEntry.id,
    ownerId: owner.id,
    viewer: await fetchAuthUser(viewer.id),
    editor: await fetchAuthUser(editor.id),
    deleter: await fetchAuthUser(deleter.id),
    admin: await fetchAuthUser(admin.id),
    outsider: await fetchAuthUser(outsider.id),
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  // Entries cascade with their snapshot.
  await safe(() =>
    db.requirementTraceabilitySnapshot.deleteMany({
      where: { projectId: f.projectId },
    })
  );
  await safe(() =>
    db.userProjectPermission.deleteMany({ where: { projectId: f.projectId } })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { id: f.projectId },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.rolePermission.deleteMany({
      where: { role: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.roles.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.user.updateMany({
      where: { email: { startsWith: TAG } },
      data: { isDeleted: true, isActive: false },
    })
  );
}

beforeAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  fixture = await setupFixture();
}, 60_000);

afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanupFixture(fixture);
  await db.$disconnect();
}, 60_000);

const newSnapshotData = (user: AuthUser, label: string) => ({
  projectId: fixture!.projectId,
  name: `${TAG}-${label}`,
  capturedById: user.id,
  ...COUNTS,
});

describeIntegration(
  "RequirementTraceabilitySnapshot — capture (create)",
  () => {
    it("a Reporting read-only member reads snapshots but CANNOT capture one", async () => {
      const edb = await getAuthDb(fixture!.viewer);
      const row = await edb.requirementTraceabilitySnapshot.findUnique({
        where: { id: fixture!.snapshotId },
      });
      expect(row).not.toBeNull();
      expect(row!.requirementCount).toBe(COUNTS.requirementCount);

      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshot.create({
            data: newSnapshotData(fixture!.viewer, "viewer-capture"),
          })
        )
      ).toBe(true);
      const leaked = await db.requirementTraceabilitySnapshot.findFirst({
        where: { name: `${TAG}-viewer-capture` },
      });
      expect(leaked).toBeNull();
    });

    it("a Reporting add/edit member CAN capture a snapshot", async () => {
      const edb = await getAuthDb(fixture!.editor);
      const created = await edb.requirementTraceabilitySnapshot.create({
        data: newSnapshotData(fixture!.editor, "editor-capture"),
      });
      expect(created.id).toBeGreaterThan(0);
      expect(created.passedCount).toBe(COUNTS.passedCount);
    });

    it("a non-member cannot see or capture anything", async () => {
      const edb = await getAuthDb(fixture!.outsider);
      expect(
        await edb.requirementTraceabilitySnapshot.findUnique({
          where: { id: fixture!.snapshotId },
        })
      ).toBeNull();
      expect(
        await edb.requirementTraceabilitySnapshot.findMany({
          where: { projectId: fixture!.projectId },
        })
      ).toHaveLength(0);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshot.create({
            data: newSnapshotData(fixture!.outsider, "outsider-capture"),
          })
        )
      ).toBe(true);
    });
  }
);

describeIntegration(
  "RequirementTraceabilitySnapshot — rename vs delete",
  () => {
    it("a Reporting add/edit member CAN rename a snapshot", async () => {
      const edb = await getAuthDb(fixture!.editor);
      const renamed = await edb.requirementTraceabilitySnapshot.update({
        where: { id: fixture!.snapshotId },
        data: { name: `${TAG}-renamed`, note: "renamed by the editor" },
      });
      expect(renamed.name).toBe(`${TAG}-renamed`);
      expect(renamed.note).toBe("renamed by the editor");
    });

    it("a Reporting add/edit member WITHOUT canDelete cannot delete a snapshot", async () => {
      const edb = await getAuthDb(fixture!.editor);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshot.delete({
            where: { id: fixture!.snapshotId },
          })
        )
      ).toBe(true);
      const row = await db.requirementTraceabilitySnapshot.findUnique({
        where: { id: fixture!.snapshotId },
        select: { id: true },
      });
      expect(row).not.toBeNull();
    });

    it("a Reporting read-only member cannot rename a snapshot", async () => {
      const edb = await getAuthDb(fixture!.viewer);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshot.update({
            where: { id: fixture!.snapshotId },
            data: { name: `${TAG}-viewer-renamed` },
          })
        )
      ).toBe(true);
    });

    it("Reporting canDelete CAN delete a snapshot", async () => {
      const victim = await db.requirementTraceabilitySnapshot.create({
        data: {
          projectId: fixture!.projectId,
          name: `${TAG}-victim`,
          capturedById: fixture!.ownerId,
          ...COUNTS,
        },
        select: { id: true },
      });
      const edb = await getAuthDb(fixture!.deleter);
      await edb.requirementTraceabilitySnapshot.delete({
        where: { id: victim.id },
      });
      const row = await db.requirementTraceabilitySnapshot.findUnique({
        where: { id: victim.id },
      });
      expect(row).toBeNull();
    });
  }
);

describeIntegration(
  "RequirementTraceabilitySnapshot — immutable counts and scope",
  () => {
    // Every value below is otherwise legal — `capturedById` points at a real
    // user row — so a rejection can only come from the field-level deny. The
    // payloads are built lazily because `fixture` is only populated in
    // beforeAll, after collection has already walked this list.
    const immutableWrites: Array<[string, () => Record<string, unknown>]> = [
      ["requirementCount", () => ({ requirementCount: 999 })],
      ["passedCount", () => ({ passedCount: 999 })],
      ["uncoveredCount", () => ({ uncoveredCount: 999 })],
      ["caseLinkCount", () => ({ caseLinkCount: 999 })],
      ["scopeRequirementIds", () => ({ scopeRequirementIds: [1, 2, 3] })],
      ["scopeMilestoneIds", () => ({ scopeMilestoneIds: [4] })],
      ["capturedById", () => ({ capturedById: fixture!.editor.id })],
    ];

    for (const [column, payload] of immutableWrites) {
      it(`rejects an update to ${column} from a Reporting add/edit member`, async () => {
        const edb = await getAuthDb(fixture!.editor);
        expect(
          await isDenied(() =>
            edb.requirementTraceabilitySnapshot.update({
              where: { id: fixture!.snapshotId },
              data: payload(),
            })
          )
        ).toBe(true);
      });
    }

    it("rejects the same updates from an ADMIN (field-level deny outranks @@allow('all'))", async () => {
      const edb = await getAuthDb(fixture!.admin);
      for (const [, payload] of immutableWrites) {
        expect(
          await isDenied(() =>
            edb.requirementTraceabilitySnapshot.update({
              where: { id: fixture!.snapshotId },
              data: payload(),
            })
          )
        ).toBe(true);
      }
    });

    it("leaves the captured numbers untouched after every rejected write", async () => {
      const row = await db.requirementTraceabilitySnapshot.findUnique({
        where: { id: fixture!.snapshotId },
      });
      expect(row?.requirementCount).toBe(COUNTS.requirementCount);
      expect(row?.passedCount).toBe(COUNTS.passedCount);
      expect(row?.uncoveredCount).toBe(COUNTS.uncoveredCount);
      expect(row?.caseLinkCount).toBe(COUNTS.caseLinkCount);
      expect(row?.scopeRequirementIds).toEqual([]);
      expect(row?.capturedById).toBe(fixture!.ownerId);
    });
  }
);

describeIntegration("RequirementTraceabilitySnapshot — soft delete", () => {
  it("a soft-deleted snapshot is unreadable by a member", async () => {
    const edb = await getAuthDb(fixture!.viewer);
    expect(
      await edb.requirementTraceabilitySnapshot.findUnique({
        where: { id: fixture!.deletedSnapshotId },
      })
    ).toBeNull();
    const many = await edb.requirementTraceabilitySnapshot.findMany({
      where: { projectId: fixture!.projectId },
    });
    expect(many.map((s) => s.id)).not.toContain(fixture!.deletedSnapshotId);
  });

  it("a soft-deleted snapshot is unreadable by an ADMIN too (the deny outranks the ADMIN allow)", async () => {
    const edb = await getAuthDb(fixture!.admin);
    expect(
      await edb.requirementTraceabilitySnapshot.findUnique({
        where: { id: fixture!.deletedSnapshotId },
      })
    ).toBeNull();
  });
});

describeIntegration("RequirementTraceabilitySnapshotEntry — read-only", () => {
  it("a member reads the entries of a snapshot they can read", async () => {
    const edb = await getAuthDb(fixture!.viewer);
    const rows = await edb.requirementTraceabilitySnapshotEntry.findMany({
      where: { snapshotId: fixture!.snapshotId },
    });
    expect(rows.map((e) => e.id)).toEqual([fixture!.entryId]);
  });

  it("entries of a soft-deleted snapshot are unreadable", async () => {
    const edb = await getAuthDb(fixture!.viewer);
    expect(
      await edb.requirementTraceabilitySnapshotEntry.findUnique({
        where: { id: fixture!.deletedEntryId },
      })
    ).toBeNull();
  });

  it("a non-member reads no entries", async () => {
    const edb = await getAuthDb(fixture!.outsider);
    expect(
      await edb.requirementTraceabilitySnapshotEntry.findUnique({
        where: { id: fixture!.entryId },
      })
    ).toBeNull();
  });

  it("nobody writes entries through the policy client — not even an ADMIN", async () => {
    for (const user of [fixture!.editor, fixture!.deleter, fixture!.admin]) {
      const edb = await getAuthDb(user);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshotEntry.create({
            data: {
              snapshotId: fixture!.snapshotId,
              requirementId: 1,
              requirementKey: `${TAG}-RPC`,
              requirementPath: `${TAG}-RPC`,
              requirementParentPath: "",
              requirementRootId: 1,
              coverageStatus: "UNCOVERED",
              linkedCaseCount: 0,
              cases: [],
            },
          })
        )
      ).toBe(true);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshotEntry.update({
            where: { id: fixture!.entryId },
            data: { coverageStatus: "COVERED_PASSED" },
          })
        )
      ).toBe(true);
      expect(
        await isDenied(() =>
          edb.requirementTraceabilitySnapshotEntry.delete({
            where: { id: fixture!.entryId },
          })
        )
      ).toBe(true);
    }

    const row = await db.requirementTraceabilitySnapshotEntry.findUnique({
      where: { id: fixture!.entryId },
      select: { coverageStatus: true },
    });
    expect(row?.coverageStatus).toBe("UNCOVERED");
  });
});
