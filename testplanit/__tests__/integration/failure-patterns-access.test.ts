// Live-DB proof of the Failure Patterns access rules (schema.zmodel:
// FailureSignature, FailureSignatureIssue, CaseQuarantine, the Projects triage
// settings columns and JUnitTestResult.failureSignatureId).
//
// Failure Patterns add/edit, not Test Runs add/edit, decides who may change a
// pattern, link issues to it and quarantine its cases. The grant is reached
// through a per-user SPECIFIC_ROLE grant, a group grant or a GLOBAL_ROLE
// project default, and project admins always pass. A quarantine's case and
// pattern must belong to its own project, attribution columns name the acting
// user, the triage settings columns are project-admin only, and only the worker
// assigns a result to a pattern. Every denied write is checked against the
// row itself, never only the thrown error, because a policy client can land a
// write and then fail to read it back.
//
// Run via (scratch DB only — never the .env DATABASE_URL):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/failure-patterns-access.test.ts

import {
  ORMError,
  ORMErrorReason,
  RejectedByPolicyReason,
} from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";
import { WorkflowScope } from "~/zenstack/models";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `fpacc-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/**
 * True if the policy blocked the operation: it was rejected, the row was out
 * of reach, or nothing changed. Any other error is rethrown so a broken
 * payload can't pass as a denial, and a write that landed but couldn't be
 * read back doesn't count as one.
 */
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
  } catch (error) {
    if (
      error instanceof ORMError &&
      ((error.reason === ORMErrorReason.REJECTED_BY_POLICY &&
        error.rejectedByPolicyReason !==
          RejectedByPolicyReason.CANNOT_READ_BACK) ||
        error.reason === ORMErrorReason.NOT_FOUND)
    )
      return true;
    throw error;
  }
}

interface Scope {
  projectId: number;
  /** Cases nobody quarantines up front; each test takes its own. */
  caseIds: number[];
  signatureId: number;
  issueId: number;
  testRunId: number;
  suiteId: number;
}

interface Fixture {
  a: Scope; // NO_ACCESS default; explicit grants only
  b: Scope; // NO_ACCESS default; the "other project" for cross-project checks
  c: Scope; // GLOBAL_ROLE default; reached through the user's global role
  rootCauseId: number;
  otherRootCauseId: number;
  owner: AuthUser;
  runsMember: AuthUser; // Test Runs add/edit, no Failure Patterns
  patternsMember: AuthUser; // Failure Patterns add/edit via a user grant
  groupPatterns: AuthUser; // Failure Patterns add/edit via a group grant
  globalPatterns: AuthUser; // Failure Patterns add/edit via C's GLOBAL_ROLE default
  docsMember: AuthUser; // Documentation add/edit (may update the project), not admin
  settingsMember: AuthUser; // Settings add/edit: a project admin
  assignedProjectAdmin: AuthUser; // system PROJECTADMIN assigned to project A
  sysAdmin: AuthUser;
}

let fixture: Fixture | null = null;
let caseCursor = 0;

/** A fresh, never-quarantined case in the scope. */
function takeCase(scope: Scope): number {
  const id = scope.caseIds[caseCursor % scope.caseIds.length];
  caseCursor++;
  return id;
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

  const mkRole = (
    label: string,
    perms: Array<{ area: string; canAddEdit: boolean }>
  ) =>
    db.roles.create({
      data: {
        name: `${TAG}-${label}`,
        rolePermissions: {
          create: perms.map((p) => ({
            area: p.area as never,
            canAddEdit: p.canAddEdit,
            canDelete: false,
          })),
        },
      },
      select: { id: true },
    });

  const viewer = await mkRole("viewer", [
    { area: "TestCaseRepository", canAddEdit: false },
  ]);
  const runsOnly = await mkRole("runsOnly", [
    { area: "TestRuns", canAddEdit: true },
    { area: "TestRunResults", canAddEdit: true },
    { area: "FailurePatterns", canAddEdit: false },
  ]);
  const patternsOnly = await mkRole("patternsOnly", [
    { area: "FailurePatterns", canAddEdit: true },
    { area: "TestRuns", canAddEdit: false },
  ]);
  const docsOnly = await mkRole("docsOnly", [
    { area: "Documentation", canAddEdit: true },
    { area: "Settings", canAddEdit: false },
  ]);
  const settingsRole = await mkRole("settings", [
    { area: "Settings", canAddEdit: true },
  ]);

  const mkUser = async (
    label: string,
    roleId: number,
    access: "USER" | "ADMIN" | "PROJECTADMIN" = "USER"
  ) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        authMethod: "INTERNAL",
        access,
        roleId,
      },
      select: { id: true },
    });

  // The owner only owns fixture rows: being a project's creator is itself an
  // admin grant, so no acting user below may be it.
  const owner = await mkUser("owner", viewer.id);
  const runsMember = await mkUser("runsMember", viewer.id);
  const patternsMember = await mkUser("patternsMember", viewer.id);
  const groupPatterns = await mkUser("groupPatterns", viewer.id);
  const globalPatterns = await mkUser("globalPatterns", patternsOnly.id);
  const docsMember = await mkUser("docsMember", viewer.id);
  const settingsMember = await mkUser("settingsMember", viewer.id);
  const assignedProjectAdmin = await mkUser(
    "assignedProjectAdmin",
    viewer.id,
    "PROJECTADMIN"
  );
  const sysAdmin = await mkUser("sysAdmin", viewer.id, "ADMIN");

  const now = new Date();
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
    const caseIds: number[] = [];
    for (let i = 0; i < 8; i++) {
      const testCase = await db.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repository.id,
          folderId: folder.id,
          templateId: template.id,
          name: `${TAG}-${label}-case-${i}`,
          stateId: caseWorkflow.id,
          creatorId: owner.id,
        },
        select: { id: true },
      });
      caseIds.push(testCase.id);
    }
    const signature = await db.failureSignature.create({
      data: {
        projectId: project.id,
        fingerprint: `${TAG}-${label}`,
        kind: "MESSAGE",
        title: `${TAG} ${label} pattern`,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    const issue = await db.issue.create({
      data: {
        name: `${TAG}-${label}-issue`,
        title: `${TAG} ${label} issue`,
        projectId: project.id,
        createdById: owner.id,
      },
      select: { id: true },
    });
    const run = await db.testRuns.create({
      data: {
        projectId: project.id,
        name: `${TAG}-${label}-run`,
        stateId: runWorkflow.id,
        createdById: owner.id,
        testRunType: "JUNIT",
      },
      select: { id: true },
    });
    const suite = await db.jUnitTestSuite.create({
      data: {
        name: `${TAG}-${label}-suite`,
        testRunId: run.id,
        createdById: owner.id,
      },
      select: { id: true },
    });
    return {
      projectId: project.id,
      caseIds,
      signatureId: signature.id,
      issueId: issue.id,
      testRunId: run.id,
      suiteId: suite.id,
    };
  };

  const a = await mkScope("a", "NO_ACCESS");
  const b = await mkScope("b", "NO_ACCESS");
  const c = await mkScope("c", "GLOBAL_ROLE");

  await db.userProjectPermission.createMany({
    data: [
      {
        userId: runsMember.id,
        projectId: a.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: runsOnly.id,
      },
      {
        userId: patternsMember.id,
        projectId: a.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: patternsOnly.id,
      },
      {
        userId: docsMember.id,
        projectId: a.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: docsOnly.id,
      },
      {
        userId: settingsMember.id,
        projectId: a.projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: settingsRole.id,
      },
    ],
  });
  await db.projectAssignment.create({
    data: { userId: assignedProjectAdmin.id, projectId: a.projectId },
  });
  const group = await db.groups.create({
    data: {
      name: `${TAG}-group`,
      assignedUsers: { create: [{ userId: groupPatterns.id }] },
    },
    select: { id: true },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: group.id,
      projectId: a.projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: patternsOnly.id,
    },
  });

  const rootCauses = await db.failureClassification.findMany({
    where: { isDeleted: false },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  while (rootCauses.length < 2) {
    rootCauses.push(
      await db.failureClassification.create({
        data: { name: `${TAG}-root-cause-${rootCauses.length}` },
        select: { id: true },
      })
    );
  }

  return {
    a,
    b,
    c,
    rootCauseId: rootCauses[0].id,
    otherRootCauseId: rootCauses[1].id,
    owner: await fetchAuthUser(owner.id),
    runsMember: await fetchAuthUser(runsMember.id),
    patternsMember: await fetchAuthUser(patternsMember.id),
    groupPatterns: await fetchAuthUser(groupPatterns.id),
    globalPatterns: await fetchAuthUser(globalPatterns.id),
    docsMember: await fetchAuthUser(docsMember.id),
    settingsMember: await fetchAuthUser(settingsMember.id),
    assignedProjectAdmin: await fetchAuthUser(assignedProjectAdmin.id),
    sysAdmin: await fetchAuthUser(sysAdmin.id),
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const projectIds = [f.a.projectId, f.b.projectId, f.c.projectId];
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.caseQuarantine.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.caseQuarantine.deleteMany({
      where: { case: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.failureSignatureIssue.deleteMany({
      where: { signature: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.jUnitTestResult.deleteMany({
      where: { testSuite: { testRun: { projectId: { in: projectIds } } } },
    })
  );
  await safe(() =>
    db.jUnitTestSuite.deleteMany({
      where: { testRun: { projectId: { in: projectIds } } },
    })
  );
  await safe(() =>
    db.testRuns.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.failureSignature.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.issue.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.failureClassification.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.repositoryCases.deleteMany({
      where: { projectId: { in: projectIds } },
    })
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
}, 120_000);

afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanupFixture(fixture);
  await db.$disconnect();
}, 120_000);

async function readSignature(id: number) {
  return db.failureSignature.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      notes: true,
      classificationId: true,
      classificationSource: true,
      classifiedById: true,
      resolvedById: true,
    },
  });
}

async function resetSignature(id: number) {
  await db.failureSignature.update({
    where: { id },
    data: {
      status: "OPEN",
      notes: null as never,
      resolvedAt: null,
      resolvedById: null,
      classificationId: null,
      classificationSource: null,
      classifiedAt: null,
      classifiedById: null,
      aiClassificationId: null,
    },
  });
}

/** The state the triage worker leaves after the AI picks a root cause. */
async function setAiClassification(id: number, classificationId: number) {
  await resetSignature(id);
  await db.failureSignature.update({
    where: { id },
    data: {
      aiClassificationId: classificationId,
      classificationId,
      classificationSource: "AI",
      classifiedAt: new Date(),
    },
  });
}

/**
 * Every write Failure Patterns add/edit unlocks, end to end: root cause,
 * status and notes on the pattern, an issue link created and removed, and a
 * quarantine created, updated and released.
 */
async function fullTriageCycle(user: AuthUser, scope: Scope, label: string) {
  const edb = await getAuthDb(user);
  await resetSignature(scope.signatureId);

  await edb.failureSignature.update({
    where: { id: scope.signatureId },
    data: {
      classificationId: fixture!.rootCauseId,
      classificationSource: "MANUAL",
      classifiedAt: new Date(),
      classifiedById: user.id,
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedById: user.id,
      notes: { type: "doc", content: [{ type: "paragraph" }] } as never,
    },
  });
  const pattern = await readSignature(scope.signatureId);

  await edb.failureSignatureIssue.create({
    data: { signatureId: scope.signatureId, issueId: scope.issueId },
  });
  const linked = await db.failureSignatureIssue.findUnique({
    where: {
      signatureId_issueId: {
        signatureId: scope.signatureId,
        issueId: scope.issueId,
      },
    },
  });
  await edb.failureSignatureIssue.delete({
    where: {
      signatureId_issueId: {
        signatureId: scope.signatureId,
        issueId: scope.issueId,
      },
    },
  });
  const unlinked = await db.failureSignatureIssue.findUnique({
    where: {
      signatureId_issueId: {
        signatureId: scope.signatureId,
        issueId: scope.issueId,
      },
    },
  });

  const caseId = takeCase(scope);
  const quarantine = await edb.caseQuarantine.create({
    data: {
      caseId,
      projectId: scope.projectId,
      signatureId: scope.signatureId,
      reason: `${label} reason`,
      createdById: user.id,
    },
  });
  await edb.caseQuarantine.update({
    where: { id: quarantine.id },
    data: { keepUntilReleased: true, reason: `${label} updated` },
  });
  const updated = await db.caseQuarantine.findUnique({
    where: { id: quarantine.id },
  });
  await edb.caseQuarantine.delete({ where: { id: quarantine.id } });
  const released = await db.caseQuarantine.findUnique({
    where: { id: quarantine.id },
  });

  return { pattern, linked, unlinked, updated, released };
}

describeIntegration(
  "Failure Patterns add/edit decides, not Test Runs add/edit",
  () => {
    it("a member with Test Runs add/edit but not Failure Patterns reads the pattern and changes nothing", async () => {
      const f = fixture!;
      await resetSignature(f.a.signatureId);
      const edb = await getAuthDb(f.runsMember);

      const visible = await edb.failureSignature.findUnique({
        where: { id: f.a.signatureId },
      });
      expect(visible).not.toBeNull();

      expect(
        await isDenied(() =>
          edb.failureSignature.update({
            where: { id: f.a.signatureId },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(),
              resolvedById: f.runsMember.id,
            },
          })
        )
      ).toBe(true);
      expect((await readSignature(f.a.signatureId)).status).toBe("OPEN");

      expect(
        await isDenied(() =>
          edb.failureSignatureIssue.create({
            data: { signatureId: f.a.signatureId, issueId: f.a.issueId },
          })
        )
      ).toBe(true);
      expect(
        await db.failureSignatureIssue.count({
          where: { signatureId: f.a.signatureId },
        })
      ).toBe(0);

      const caseId = takeCase(f.a);
      expect(
        await isDenied(() =>
          edb.caseQuarantine.create({
            data: {
              caseId,
              projectId: f.a.projectId,
              createdById: f.runsMember.id,
            },
          })
        )
      ).toBe(true);
      expect(await db.caseQuarantine.count({ where: { caseId } })).toBe(0);
    });

    it("a per-user Failure Patterns grant can set the root cause and status, link issues and quarantine", async () => {
      const r = await fullTriageCycle(
        fixture!.patternsMember,
        fixture!.a,
        "user-grant"
      );
      expect(r.pattern.status).toBe("RESOLVED");
      expect(r.pattern.classificationId).toBe(fixture!.rootCauseId);
      expect(r.linked).not.toBeNull();
      expect(r.unlinked).toBeNull();
      expect(r.updated?.keepUntilReleased).toBe(true);
      expect(r.released).toBeNull();
    });

    it("a group Failure Patterns grant can do the same", async () => {
      const r = await fullTriageCycle(
        fixture!.groupPatterns,
        fixture!.a,
        "group-grant"
      );
      expect(r.pattern.status).toBe("RESOLVED");
      expect(r.linked).not.toBeNull();
      expect(r.released).toBeNull();
    });

    it("a GLOBAL_ROLE project default plus a Failure Patterns global role can do the same", async () => {
      const r = await fullTriageCycle(
        fixture!.globalPatterns,
        fixture!.c,
        "global-default"
      );
      expect(r.pattern.status).toBe("RESOLVED");
      expect(r.linked).not.toBeNull();
      expect(r.released).toBeNull();
    });

    it("a project admin (Settings add/edit) can do the same without the Failure Patterns area", async () => {
      const r = await fullTriageCycle(
        fixture!.settingsMember,
        fixture!.a,
        "project-admin"
      );
      expect(r.pattern.status).toBe("RESOLVED");
      expect(r.linked).not.toBeNull();
      expect(r.released).toBeNull();
    });

    it("the Failure Patterns global role buys nothing on a NO_ACCESS project", async () => {
      const f = fixture!;
      await resetSignature(f.b.signatureId);
      const edb = await getAuthDb(f.globalPatterns);
      expect(
        await isDenied(() =>
          edb.failureSignature.update({
            where: { id: f.b.signatureId },
            data: { status: "IGNORED" },
          })
        )
      ).toBe(true);
      expect((await readSignature(f.b.signatureId)).status).toBe("OPEN");
    });
  }
);

describeIntegration("Quarantines stay inside their project", () => {
  it("rejects quarantining another project's case under this project", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.patternsMember);
    const foreignCase = takeCase(f.b);
    expect(
      await isDenied(() =>
        edb.caseQuarantine.create({
          data: {
            caseId: foreignCase,
            projectId: f.a.projectId,
            createdById: f.patternsMember.id,
          },
        })
      )
    ).toBe(true);
    expect(
      await db.caseQuarantine.count({ where: { caseId: foreignCase } })
    ).toBe(0);
  });

  it("rejects pointing a quarantine at another project's pattern", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.patternsMember);
    const caseId = takeCase(f.a);
    expect(
      await isDenied(() =>
        edb.caseQuarantine.create({
          data: {
            caseId,
            projectId: f.a.projectId,
            signatureId: f.b.signatureId,
            createdById: f.patternsMember.id,
          },
        })
      )
    ).toBe(true);
    expect(await db.caseQuarantine.count({ where: { caseId } })).toBe(0);
  });

  it("rejects quarantining in someone else's name", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.patternsMember);
    const caseId = takeCase(f.a);
    expect(
      await isDenied(() =>
        edb.caseQuarantine.create({
          data: {
            caseId,
            projectId: f.a.projectId,
            createdById: f.groupPatterns.id,
          },
        })
      )
    ).toBe(true);
    expect(await db.caseQuarantine.count({ where: { caseId } })).toBe(0);
  });

  it("keeps a quarantine's pattern link fixed after creation", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.patternsMember);
    const caseId = takeCase(f.a);
    const quarantine = await edb.caseQuarantine.create({
      data: {
        caseId,
        projectId: f.a.projectId,
        signatureId: f.a.signatureId,
        createdById: f.patternsMember.id,
      },
    });
    expect(
      await isDenied(() =>
        edb.caseQuarantine.update({
          where: { id: quarantine.id },
          data: { signatureId: f.b.signatureId },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.caseQuarantine.update({
          where: { id: quarantine.id },
          data: { signature: { connect: { id: f.b.signatureId } } },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.caseQuarantine.update({
          where: { id: quarantine.id },
          data: { signature: { disconnect: true } },
        })
      )
    ).toBe(true);
    const row = await db.caseQuarantine.findUniqueOrThrow({
      where: { id: quarantine.id },
    });
    expect(row.signatureId).toBe(f.a.signatureId);
    await db.caseQuarantine.delete({ where: { id: quarantine.id } });
  });
});

describeIntegration("Pattern attribution names the acting user", () => {
  it("rejects setting the root cause or resolution in someone else's name", async () => {
    const f = fixture!;
    await resetSignature(f.a.signatureId);
    const edb = await getAuthDb(f.patternsMember);
    expect(
      await isDenied(() =>
        edb.failureSignature.update({
          where: { id: f.a.signatureId },
          data: {
            classificationId: f.rootCauseId,
            classificationSource: "MANUAL",
            classifiedAt: new Date(),
            classifiedById: f.groupPatterns.id,
          },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.failureSignature.update({
          where: { id: f.a.signatureId },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedById: f.groupPatterns.id,
          },
        })
      )
    ).toBe(true);
    const row = await readSignature(f.a.signatureId);
    expect(row.classifiedById).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(row.status).toBe("OPEN");
  });

  it("lets anyone allowed edit notes or clear the root cause on a pattern someone else classified", async () => {
    const f = fixture!;
    await resetSignature(f.a.signatureId);
    const first = await getAuthDb(f.groupPatterns);
    await first.failureSignature.update({
      where: { id: f.a.signatureId },
      data: {
        classificationId: f.rootCauseId,
        classificationSource: "MANUAL",
        classifiedAt: new Date(),
        classifiedById: f.groupPatterns.id,
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: f.groupPatterns.id,
      },
    });

    const second = await getAuthDb(f.patternsMember);
    await second.failureSignature.update({
      where: { id: f.a.signatureId },
      data: {
        notes: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "x" }] },
          ],
        } as never,
      },
    });
    let row = await readSignature(f.a.signatureId);
    expect(row.notes).not.toBeNull();
    expect(row.classifiedById).toBe(f.groupPatterns.id);

    await second.failureSignature.update({
      where: { id: f.a.signatureId },
      data: {
        classificationId: null,
        classificationSource: null,
        classifiedAt: null,
        classifiedById: null,
        status: "OPEN",
        resolvedAt: null,
        resolvedById: null,
      },
    });
    row = await readSignature(f.a.signatureId);
    expect(row.classifiedById).toBeNull();
    expect(row.resolvedById).toBeNull();
    expect(row.status).toBe("OPEN");
  });
});

describeIntegration(
  "Only the triage worker attributes a root cause to the AI",
  () => {
    it("rejects labelling a person's root cause as the AI's", async () => {
      const f = fixture!;
      const edb = await getAuthDb(f.patternsMember);

      await resetSignature(f.a.signatureId);
      expect(
        await isDenied(() =>
          edb.failureSignature.update({
            where: { id: f.a.signatureId },
            data: {
              classificationId: f.rootCauseId,
              classificationSource: "AI",
              classifiedAt: new Date(),
            },
          })
        )
      ).toBe(true);
      let row = await readSignature(f.a.signatureId);
      expect(row.classificationId).toBeNull();
      expect(row.classificationSource).toBeNull();

      await setAiClassification(f.a.signatureId, f.rootCauseId);
      expect(
        await isDenied(() =>
          edb.failureSignature.update({
            where: { id: f.a.signatureId },
            data: { classificationId: f.otherRootCauseId },
          })
        )
      ).toBe(true);
      row = await readSignature(f.a.signatureId);
      expect(row.classificationId).toBe(f.rootCauseId);

      await resetSignature(f.a.signatureId);
      await db.failureSignature.update({
        where: { id: f.a.signatureId },
        data: {
          classificationId: f.rootCauseId,
          classificationSource: "MANUAL",
          classifiedAt: new Date(),
          classifiedById: f.patternsMember.id,
        },
      });
      expect(
        await isDenied(() =>
          edb.failureSignature.update({
            where: { id: f.a.signatureId },
            data: { classificationSource: "AI", classifiedById: null },
          })
        )
      ).toBe(true);
      row = await readSignature(f.a.signatureId);
      expect(row.classificationSource).toBe("MANUAL");
      expect(row.classifiedById).toBe(f.patternsMember.id);
    });

    it("still lets people edit, override or clear a root cause the AI picked", async () => {
      const f = fixture!;
      const edb = await getAuthDb(f.patternsMember);

      await setAiClassification(f.a.signatureId, f.rootCauseId);
      await edb.failureSignature.update({
        where: { id: f.a.signatureId },
        data: {
          status: "IGNORED",
          notes: { type: "doc", content: [{ type: "paragraph" }] } as never,
        },
      });
      let row = await readSignature(f.a.signatureId);
      expect(row.status).toBe("IGNORED");
      expect(row.classificationSource).toBe("AI");
      expect(row.classificationId).toBe(f.rootCauseId);

      await edb.failureSignature.update({
        where: { id: f.a.signatureId },
        data: {
          classificationId: f.otherRootCauseId,
          classificationSource: "MANUAL",
          classifiedAt: new Date(),
          classifiedById: f.patternsMember.id,
        },
      });
      row = await readSignature(f.a.signatureId);
      expect(row.classificationId).toBe(f.otherRootCauseId);
      expect(row.classificationSource).toBe("MANUAL");

      await setAiClassification(f.a.signatureId, f.rootCauseId);
      await edb.failureSignature.update({
        where: { id: f.a.signatureId },
        data: {
          classificationId: null,
          classificationSource: null,
          classifiedAt: null,
          classifiedById: null,
        },
      });
      row = await readSignature(f.a.signatureId);
      expect(row.classificationId).toBeNull();
      expect(row.classificationSource).toBeNull();
    });
  }
);

describeIntegration("Failure Patterns settings are project-admin only", () => {
  it("a member who may update the project (Documentation add/edit) cannot change the triage settings", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.docsMember);
    await edb.projects.update({
      where: { id: f.a.projectId },
      data: { docs: `${TAG} docs` },
    });
    const before = await db.projects.findUniqueOrThrow({
      where: { id: f.a.projectId },
      select: {
        docs: true,
        failureTriageEnabled: true,
        failureTriageAutoClassify: true,
        quarantineAutoRelease: true,
        quarantineAutoReleasePasses: true,
      },
    });
    expect(before.docs).toBe(`${TAG} docs`);

    for (const data of [
      { failureTriageEnabled: !before.failureTriageEnabled },
      { failureTriageAutoClassify: !before.failureTriageAutoClassify },
      { quarantineAutoRelease: !before.quarantineAutoRelease },
      { quarantineAutoReleasePasses: before.quarantineAutoReleasePasses + 1 },
    ]) {
      expect(
        await isDenied(() =>
          edb.projects.update({ where: { id: f.a.projectId }, data })
        )
      ).toBe(true);
    }
    const after = await db.projects.findUniqueOrThrow({
      where: { id: f.a.projectId },
      select: {
        failureTriageEnabled: true,
        failureTriageAutoClassify: true,
        quarantineAutoRelease: true,
        quarantineAutoReleasePasses: true,
      },
    });
    expect(after).toEqual({
      failureTriageEnabled: before.failureTriageEnabled,
      failureTriageAutoClassify: before.failureTriageAutoClassify,
      quarantineAutoRelease: before.quarantineAutoRelease,
      quarantineAutoReleasePasses: before.quarantineAutoReleasePasses,
    });
  });

  it("the creator, an assigned PROJECTADMIN, a role admin and a system admin can change them", async () => {
    const f = fixture!;
    for (const user of [
      f.owner,
      f.settingsMember,
      f.assignedProjectAdmin,
      f.sysAdmin,
    ]) {
      const edb = await getAuthDb(user);
      const current = await db.projects.findUniqueOrThrow({
        where: { id: f.a.projectId },
        select: { quarantineAutoReleasePasses: true },
      });
      await edb.projects.update({
        where: { id: f.a.projectId },
        data: {
          quarantineAutoReleasePasses: current.quarantineAutoReleasePasses + 1,
        },
      });
      const row = await db.projects.findUniqueOrThrow({
        where: { id: f.a.projectId },
        select: { quarantineAutoReleasePasses: true },
      });
      expect(row.quarantineAutoReleasePasses).toBe(
        current.quarantineAutoReleasePasses + 1
      );
    }
  });
});

describeIntegration("Only the worker assigns a result to a pattern", () => {
  it("a result's creator cannot create it already linked to a pattern", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.runsMember);
    const caseId = takeCase(f.a);
    expect(
      await isDenied(() =>
        edb.jUnitTestResult.create({
          data: {
            type: "FAILURE",
            repositoryCaseId: caseId,
            testSuiteId: f.a.suiteId,
            createdById: f.runsMember.id,
            failureSignatureId: f.b.signatureId,
          },
        })
      )
    ).toBe(true);
    expect(
      await db.jUnitTestResult.count({
        where: { repositoryCaseId: caseId, testSuiteId: f.a.suiteId },
      })
    ).toBe(0);
  });

  it("a result's creator cannot move it to a pattern afterwards", async () => {
    const f = fixture!;
    const edb = await getAuthDb(f.runsMember);
    const caseId = takeCase(f.a);
    const result = await edb.jUnitTestResult.create({
      data: {
        type: "FAILURE",
        repositoryCaseId: caseId,
        testSuiteId: f.a.suiteId,
        createdById: f.runsMember.id,
      },
    });
    expect(
      await isDenied(() =>
        edb.jUnitTestResult.update({
          where: { id: result.id },
          data: { failureSignatureId: f.b.signatureId },
        })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        edb.jUnitTestResult.update({
          where: { id: result.id },
          data: { failureSignature: { connect: { id: f.a.signatureId } } },
        })
      )
    ).toBe(true);
    const row = await db.jUnitTestResult.findUniqueOrThrow({
      where: { id: result.id },
      select: { failureSignatureId: true },
    });
    expect(row.failureSignatureId).toBeNull();
  });
});
