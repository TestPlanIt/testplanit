// Live-DB proof of the RepositoryCaseCodePin access rules (schema.zmodel
// ~4070). A pin is Impact-analysis metadata hanging off a repository case, and
// its write rule is the TestCaseRepository add/edit ladder — the same ladder
// the case itself uses — reached through `case.project`. Three distinct grant
// paths have to admit a writer:
//
//   1. an explicit per-user SPECIFIC_ROLE grant whose ROLE carries
//      TestCaseRepository.canAddEdit,
//   2. the project's GLOBAL_ROLE default plus the user's own global role
//      carrying it,
//   3. a group grant (SPECIFIC_ROLE) whose role carries it.
//
// …while a project member whose role lacks the permission reads pins but
// cannot write any, and a user with no path to the project sees nothing. The
// whole ladder is compiled into the policy, so only the real policy client can
// prove it.
//
// Run via (scratch DB only — never the .env DATABASE_URL):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/repository-case-code-pin-access.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";
import { WorkflowScope } from "~/zenstack/models";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `rccp-${Date.now().toString(36)}-${Math.random()
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

interface Scope {
  projectId: number;
  caseId: number;
  configId: number;
  pinId: number; // pre-seeded pin, used for read / update / delete attempts
}

interface Fixture {
  closed: Scope; // NO_ACCESS default — only explicit grants reach it
  openDefault: Scope; // GLOBAL_ROLE default — the project-default grant path
  userGrantWriter: AuthUser; // path 1: per-user SPECIFIC_ROLE grant w/ writer role
  globalDefaultWriter: AuthUser; // path 2: project GLOBAL_ROLE default + global writer role
  groupGrantWriter: AuthUser; // path 3: group SPECIFIC_ROLE grant w/ writer role
  readOnlyMember: AuthUser; // member whose role lacks TestCaseRepository add/edit
  outsider: AuthUser; // no path to the closed project at all
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const caseWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDeleted: false, isEnabled: true },
  });
  if (!caseWorkflow)
    throw new Error("Test prerequisite: no CASES-scoped Workflows row");
  const template = await db.templates.findFirst({
    where: { isDeleted: false },
    select: { id: true },
  });
  if (!template) throw new Error("Test prerequisite: no Templates row");

  const writerRole = await db.roles.create({
    data: {
      name: `${TAG}-writer`,
      rolePermissions: {
        create: [
          { area: "TestCaseRepository", canAddEdit: true, canDelete: true },
        ],
      },
    },
    select: { id: true },
  });
  // A valid global role that grants NO TestCaseRepository write permission.
  const viewerRole = await db.roles.create({
    data: {
      name: `${TAG}-viewer`,
      rolePermissions: {
        create: [
          { area: "TestCaseRepository", canAddEdit: false, canDelete: false },
        ],
      },
    },
    select: { id: true },
  });

  const mkUser = async (label: string, roleId: number) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        authMethod: "INTERNAL",
        access: "USER",
        roleId,
      },
      select: { id: true },
    });

  // The owner exists only to own the fixture rows: `project.creator.id ==
  // auth().id` is itself a write grant, so no acting user below may be it.
  const owner = await mkUser("owner", viewerRole.id);
  const userGrantWriter = await mkUser("userGrantWriter", viewerRole.id);
  const globalDefaultWriter = await mkUser(
    "globalDefaultWriter",
    writerRole.id
  );
  const groupGrantWriter = await mkUser("groupGrantWriter", viewerRole.id);
  const readOnly = await mkUser("readOnly", viewerRole.id);
  // Carries a write-capable GLOBAL role on purpose: without a grant on a
  // NO_ACCESS project that role must buy nothing.
  const outsider = await mkUser("outsider", writerRole.id);

  const mkScope = async (
    label: string,
    defaultAccessType: "NO_ACCESS" | "GLOBAL_ROLE"
  ): Promise<Scope> => {
    const project = await db.projects.create({
      data: {
        name: `${TAG}-${label}`,
        createdBy: owner.id,
        defaultAccessType,
        defaultRoleId: null,
      },
      select: { id: true },
    });
    const repository = await db.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await db.repositoryFolders.create({
      data: {
        name: `${TAG}-${label}-folder`,
        projectId: project.id,
        repositoryId: repository.id,
        creatorId: owner.id,
      },
      select: { id: true },
    });
    const testCase = await db.repositoryCases.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        folderId: folder.id,
        templateId: template.id,
        name: `${TAG}-${label}-case`,
        stateId: caseWorkflow.id,
        creatorId: owner.id,
      },
      select: { id: true },
    });
    const codeRepository = await db.codeRepository.create({
      data: {
        name: `${TAG}-${label}-repo`,
        provider: "GITHUB",
        credentials: {},
      },
      select: { id: true },
    });
    const config = await db.projectCodeRepositoryConfig.create({
      data: {
        projectId: project.id,
        purpose: "IMPACT",
        repositoryId: codeRepository.id,
        pathPatterns: [],
      },
      select: { id: true },
    });
    const pin = await db.repositoryCaseCodePin.create({
      data: {
        caseId: testCase.id,
        configId: config.id,
        kind: "FILE",
        filePath: `src/${label}/seeded.ts`,
        createdById: owner.id,
      },
      select: { id: true },
    });
    return {
      projectId: project.id,
      caseId: testCase.id,
      configId: config.id,
      pinId: pin.id,
    };
  };

  const closed = await mkScope("closed", "NO_ACCESS");
  const openDefault = await mkScope("open", "GLOBAL_ROLE");

  await db.userProjectPermission.createMany({
    data: [
      // Path 1: the GRANT carries the writer role (the acting user's own
      // global role does not).
      {
        userId: userGrantWriter.id,
        projectId: closed.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: writerRole.id,
      },
      // A member of the same closed project whose grant role has no
      // TestCaseRepository add/edit: read yes, write no.
      {
        userId: readOnly.id,
        projectId: closed.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: viewerRole.id,
      },
    ],
  });

  // Path 3: a group grant carrying the writer role.
  const group = await db.groups.create({
    data: {
      name: `${TAG}-group`,
      assignedUsers: { create: [{ userId: groupGrantWriter.id }] },
    },
    select: { id: true },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: group.id,
      projectId: closed.projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: writerRole.id,
    },
  });

  return {
    closed,
    openDefault,
    userGrantWriter: await fetchAuthUser(userGrantWriter.id),
    globalDefaultWriter: await fetchAuthUser(globalDefaultWriter.id),
    groupGrantWriter: await fetchAuthUser(groupGrantWriter.id),
    readOnlyMember: await fetchAuthUser(readOnly.id),
    outsider: await fetchAuthUser(outsider.id),
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const projectIds = [f.closed.projectId, f.openDefault.projectId];
  const caseIds = [f.closed.caseId, f.openDefault.caseId];
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.repositoryCaseCodePin.deleteMany({ where: { caseId: { in: caseIds } } })
  );
  await safe(() =>
    db.projectCodeRepositoryConfig.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.codeRepository.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.repositoryCases.deleteMany({ where: { id: { in: caseIds } } })
  );
  await safe(() =>
    db.repositoryFolders.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.repositories.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.userProjectPermission.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.groupProjectPermission.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.groupAssignment.deleteMany({
      where: { group: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.groups.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { id: { in: projectIds } },
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

/** Create → update → delete one pin of the acting user's own, end to end. */
async function fullWriteCycle(user: AuthUser, scope: Scope, label: string) {
  const edb = await getAuthDb(user);
  const created = await edb.repositoryCaseCodePin.create({
    data: {
      caseId: scope.caseId,
      configId: scope.configId,
      kind: "RANGE",
      filePath: `src/${label}.ts`,
      startLine: 10,
      endLine: 20,
      createdById: user.id,
    },
  });
  const updated = await edb.repositoryCaseCodePin.update({
    where: { id: created.id },
    data: { note: `${label}-note` },
  });
  const deleted = await edb.repositoryCaseCodePin.delete({
    where: { id: created.id },
  });
  const gone = await db.repositoryCaseCodePin.findUnique({
    where: { id: created.id },
  });
  return { created, updated, deleted, gone };
}

describeIntegration("RepositoryCaseCodePin write grants (three paths)", () => {
  it("path 1 — a per-user SPECIFIC_ROLE grant with TestCaseRepository add/edit can create, update and delete", async () => {
    const { created, updated, gone } = await fullWriteCycle(
      fixture!.userGrantWriter,
      fixture!.closed,
      "user-grant"
    );
    expect(created.id).toBeGreaterThan(0);
    expect(updated.note).toBe("user-grant-note");
    expect(gone).toBeNull();
  });

  it("path 2 — a GLOBAL_ROLE project default plus a write-capable global role can create, update and delete", async () => {
    const { created, updated, gone } = await fullWriteCycle(
      fixture!.globalDefaultWriter,
      fixture!.openDefault,
      "global-default"
    );
    expect(created.id).toBeGreaterThan(0);
    expect(updated.note).toBe("global-default-note");
    expect(gone).toBeNull();
  });

  it("path 3 — a group SPECIFIC_ROLE grant with TestCaseRepository add/edit can create, update and delete", async () => {
    const { created, updated, gone } = await fullWriteCycle(
      fixture!.groupGrantWriter,
      fixture!.closed,
      "group-grant"
    );
    expect(created.id).toBeGreaterThan(0);
    expect(updated.note).toBe("group-grant-note");
    expect(gone).toBeNull();
  });

  it("the same global writer role buys nothing on the NO_ACCESS project (path 2 is the project default, not the role alone)", async () => {
    const edb = await getAuthDb(fixture!.globalDefaultWriter);
    expect(
      await isDenied(() =>
        edb.repositoryCaseCodePin.create({
          data: {
            caseId: fixture!.closed.caseId,
            configId: fixture!.closed.configId,
            kind: "FILE",
            filePath: "src/should-not-exist.ts",
            createdById: fixture!.globalDefaultWriter.id,
          },
        })
      )
    ).toBe(true);
  });
});

describeIntegration("RepositoryCaseCodePin read-only member", () => {
  it("reads the project's pins", async () => {
    const edb = await getAuthDb(fixture!.readOnlyMember);
    const row = await edb.repositoryCaseCodePin.findUnique({
      where: { id: fixture!.closed.pinId },
    });
    expect(row).not.toBeNull();
    const many = await edb.repositoryCaseCodePin.findMany({
      where: { caseId: fixture!.closed.caseId },
    });
    expect(many.map((p) => p.id)).toContain(fixture!.closed.pinId);
  });

  it("CANNOT create a pin", async () => {
    const edb = await getAuthDb(fixture!.readOnlyMember);
    expect(
      await isDenied(() =>
        edb.repositoryCaseCodePin.create({
          data: {
            caseId: fixture!.closed.caseId,
            configId: fixture!.closed.configId,
            kind: "FILE",
            filePath: "src/read-only.ts",
            createdById: fixture!.readOnlyMember.id,
          },
        })
      )
    ).toBe(true);
    const leaked = await db.repositoryCaseCodePin.findFirst({
      where: { filePath: "src/read-only.ts" },
    });
    expect(leaked).toBeNull();
  });

  it("CANNOT update or delete an existing pin", async () => {
    const edb = await getAuthDb(fixture!.readOnlyMember);
    expect(
      await isDenied(() =>
        edb.repositoryCaseCodePin.update({
          where: { id: fixture!.closed.pinId },
          data: { note: "read-only-touched" },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.repositoryCaseCodePin.delete({
          where: { id: fixture!.closed.pinId },
        })
      )
    ).toBe(true);

    const row = await db.repositoryCaseCodePin.findUnique({
      where: { id: fixture!.closed.pinId },
      select: { note: true },
    });
    expect(row).not.toBeNull();
    expect(row?.note).toBeNull();
  });
});

describeIntegration("RepositoryCaseCodePin non-member", () => {
  it("sees nothing in the NO_ACCESS project", async () => {
    const edb = await getAuthDb(fixture!.outsider);
    expect(
      await edb.repositoryCaseCodePin.findUnique({
        where: { id: fixture!.closed.pinId },
      })
    ).toBeNull();
    const many = await edb.repositoryCaseCodePin.findMany({
      where: { caseId: fixture!.closed.caseId },
    });
    expect(many).toHaveLength(0);
  });

  it("CANNOT create a pin there despite a write-capable global role", async () => {
    const edb = await getAuthDb(fixture!.outsider);
    expect(
      await isDenied(() =>
        edb.repositoryCaseCodePin.create({
          data: {
            caseId: fixture!.closed.caseId,
            configId: fixture!.closed.configId,
            kind: "FILE",
            filePath: "src/outsider.ts",
            createdById: fixture!.outsider.id,
          },
        })
      )
    ).toBe(true);
    const leaked = await db.repositoryCaseCodePin.findFirst({
      where: { filePath: "src/outsider.ts" },
    });
    expect(leaked).toBeNull();
  });
});
