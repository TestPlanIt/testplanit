// Access-policy contract for CaseDraft (issue #601 auto-save).
//
// A draft is a user's half-written work. The schema rule is deliberately
// narrower than every other repository model:
//
//   @@allow('all', auth().id == userId && projectId in auth().accessibleProjectIds)
//
// Note what is absent: there is NO `@@allow('all', auth().access == 'ADMIN')`
// override, and no project-level read. Two people editing the same case must
// not see each other's drafts, and an administrator must not be able to read
// someone's unfinished writing either. Those are the properties this file
// pins — they are invisible in a unit test, because they are enforced by the
// policy layer against a real database.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test case-draft-isolation --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `cdi-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True when the operation was refused, or silently filtered to nothing. */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await fn();
    if (result === null || result === undefined) return true;
    if (Array.isArray(result)) return result.length === 0;
    if (typeof result === "object" && "count" in (result as object))
      return (result as { count: number }).count === 0;
    return false;
  } catch {
    return true;
  }
}

const payload = (name: string) => ({
  version: 1,
  values: { name },
  dateFields: [],
  extras: {},
  savedAt: new Date().toISOString(),
});

interface Fixture {
  projectId: number;
  caseId: number;
  folderId: number;
  owner: AuthUser;
  coworker: AuthUser; // same project, same write access as the owner
  admin: AuthUser; // system ADMIN — still must not see the draft
  outsider: AuthUser; // no access to the project at all
}

let fixture: Fixture | undefined;

async function setupFixture(): Promise<Fixture> {
  const template = await db.templates.findFirstOrThrow({
    where: { isDeleted: false },
  });
  const state = await db.workflows.findFirstOrThrow({
    where: { scope: "CASES", isDeleted: false, isEnabled: true },
  });

  const writerRole = await db.roles.create({
    data: {
      name: `${TAG}-writer`,
      rolePermissions: {
        create: [
          { area: "TestCaseRepository", canAddEdit: true, canDelete: true },
        ],
      },
    },
  });

  const mkUser = async (label: string, access: "USER" | "ADMIN") =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access,
        roleId: writerRole.id,
      },
    });

  const owner = await mkUser("owner", "USER");
  const coworker = await mkUser("coworker", "USER");
  const admin = await mkUser("admin", "ADMIN");
  const outsider = await mkUser("outsider", "USER");

  // Default GLOBAL_ROLE access, so owner/coworker/admin all reach the project
  // through their writer role. The outsider is carved out below.
  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: owner.id,
      defaultAccessType: "GLOBAL_ROLE",
      defaultRoleId: null,
    },
  });
  await db.userProjectPermission.create({
    data: {
      userId: outsider.id,
      projectId: project.id,
      accessType: "NO_ACCESS",
      roleId: null,
    },
  });

  const repository = await db.repositories.create({
    data: { projectId: project.id },
  });
  const folder = await db.repositoryFolders.create({
    data: {
      projectId: project.id,
      repositoryId: repository.id,
      name: `${TAG}-folder`,
      creatorId: owner.id,
    },
  });
  const testCase = await db.repositoryCases.create({
    data: {
      projectId: project.id,
      repositoryId: repository.id,
      folderId: folder.id,
      templateId: template.id,
      name: `${TAG}-case`,
      stateId: state.id,
      creatorId: owner.id,
    },
    select: { id: true },
  });

  return {
    projectId: project.id,
    caseId: testCase.id,
    folderId: folder.id,
    owner: await fetchAuthUser(owner.id),
    coworker: await fetchAuthUser(coworker.id),
    admin: await fetchAuthUser(admin.id),
    outsider: await fetchAuthUser(outsider.id),
  };
}

async function teardown() {
  await db.caseDraft.deleteMany({ where: { projectId: fixture?.projectId } });
  if (fixture) {
    await db.repositoryCases.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.repositoryFolders.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.repositories.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.userProjectPermission.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.projects.deleteMany({ where: { id: fixture.projectId } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.roles.deleteMany({ where: { name: { startsWith: TAG } } });
}

describeIntegration("CaseDraft access policy", () => {
  beforeAll(async () => {
    fixture = await setupFixture();
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 60_000);

  it("lets the author create, read, update and delete their own draft", async () => {
    const f = fixture!;
    const ownerDb = await getAuthDb(f.owner);
    const draftKey = `case:${f.caseId}`;

    const created = await (ownerDb as any).caseDraft.create({
      data: {
        draftKey,
        project: { connect: { id: f.projectId } },
        user: { connect: { id: f.owner.id } },
        case: { connect: { id: f.caseId } },
        payload: payload("owner's half-written case"),
        baseVersion: 1,
      },
    });
    expect(created.id).toBeTruthy();

    const read = await (ownerDb as any).caseDraft.findFirst({
      where: { userId: f.owner.id, draftKey },
    });
    expect(read?.payload?.values?.name).toBe("owner's half-written case");

    await (ownerDb as any).caseDraft.update({
      where: { id: created.id },
      data: { payload: payload("edited further") },
    });
    const updated = await (ownerDb as any).caseDraft.findFirst({
      where: { id: created.id },
    });
    expect(updated?.payload?.values?.name).toBe("edited further");
  });

  it("hides the draft from a coworker with equal access to the same case", async () => {
    const f = fixture!;
    const coworkerDb = await getAuthDb(f.coworker);

    // Sanity: the coworker really can reach the case itself...
    const theCase = await (coworkerDb as any).repositoryCases.findFirst({
      where: { id: f.caseId },
    });
    expect(theCase?.id).toBe(f.caseId);

    // ...but not the draft attached to it.
    expect(await (coworkerDb as any).caseDraft.findMany({})).toEqual([]);
    expect(
      await isDenied(() =>
        (coworkerDb as any).caseDraft.findFirst({
          where: { userId: f.owner.id },
        })
      )
    ).toBe(true);
  });

  it("hides the draft from a system ADMIN — there is no admin override", async () => {
    const f = fixture!;
    const adminDb = await getAuthDb(f.admin);

    expect(await (adminDb as any).caseDraft.findMany({})).toEqual([]);
    expect(
      await isDenied(() =>
        (adminDb as any).caseDraft.findFirst({ where: { userId: f.owner.id } })
      )
    ).toBe(true);
  });

  it("refuses a coworker's attempt to delete someone else's draft", async () => {
    const f = fixture!;
    const coworkerDb = await getAuthDb(f.coworker);

    await (coworkerDb as any).caseDraft
      .deleteMany({ where: { userId: f.owner.id } })
      .catch(() => undefined);

    // The owner's draft is still there.
    const stillThere = await db.caseDraft.findFirst({
      where: { userId: f.owner.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it("refuses a draft created under another user's id", async () => {
    const f = fixture!;
    const coworkerDb = await getAuthDb(f.coworker);

    // Spoofing `userId` is what the `auth().id == userId` half of the rule
    // exists to stop — otherwise anyone could plant or overwrite a draft.
    expect(
      await isDenied(() =>
        (coworkerDb as any).caseDraft.create({
          data: {
            draftKey: `case:${f.caseId}-spoof`,
            project: { connect: { id: f.projectId } },
            user: { connect: { id: f.owner.id } },
            case: { connect: { id: f.caseId } },
            payload: payload("planted"),
          },
        })
      )
    ).toBe(true);
  });

  it("refuses a draft in a project the user cannot reach", async () => {
    const f = fixture!;
    const outsiderDb = await getAuthDb(f.outsider);

    expect(
      await isDenied(() =>
        (outsiderDb as any).caseDraft.create({
          data: {
            draftKey: `case:${f.caseId}`,
            project: { connect: { id: f.projectId } },
            user: { connect: { id: f.outsider.id } },
            case: { connect: { id: f.caseId } },
            payload: payload("from outside the project"),
          },
        })
      )
    ).toBe(true);
  });

  it("allows only one draft per user per scope", async () => {
    const f = fixture!;
    // The unique index is what stops a user accumulating a draft per keystroke
    // burst; `draftKey` is non-null precisely so NULLs cannot slip past it.
    await expect(
      db.caseDraft.create({
        data: {
          projectId: f.projectId,
          userId: f.owner.id,
          draftKey: `case:${f.caseId}`,
          caseId: f.caseId,
          payload: payload("duplicate"),
        },
      })
    ).rejects.toThrow();
  });

  it("keeps a case draft and a new-case draft in the same numbered slot apart", async () => {
    const f = fixture!;
    const ownerDb = await getAuthDb(f.owner);

    // caseId and folderId are independent sequences, so both scopes can carry
    // the same number. The "case:"/"folder:" prefix is what keeps them from
    // colliding on (userId, draftKey).
    const folderDraft = await (ownerDb as any).caseDraft.create({
      data: {
        draftKey: `folder:${f.folderId}`,
        project: { connect: { id: f.projectId } },
        user: { connect: { id: f.owner.id } },
        folder: { connect: { id: f.folderId } },
        payload: payload("a brand new case"),
      },
    });
    expect(folderDraft.caseId).toBeNull();

    const mine = await (ownerDb as any).caseDraft.findMany({});
    expect(mine).toHaveLength(2);
    expect(mine.map((d: any) => d.draftKey).sort()).toEqual(
      [`case:${f.caseId}`, `folder:${f.folderId}`].sort()
    );
  });

  it("cascades away with the case it belongs to", async () => {
    const f = fixture!;
    const before = await db.caseDraft.count({ where: { caseId: f.caseId } });
    expect(before).toBe(1);

    // Hard-deleting the case is not something the product does — the app
    // always soft-deletes — but the FK is the backstop that stops a draft
    // outliving its case as an orphaned copy of customer data.
    await db.repositoryCases.delete({ where: { id: f.caseId } });

    expect(await db.caseDraft.count({ where: { caseId: f.caseId } })).toBe(0);
    // The folder-scoped draft is untouched by that cascade.
    expect(await db.caseDraft.count({ where: { folderId: f.folderId } })).toBe(
      1
    );
  });
});
