// Write authorization for project DEFAULT (implicit) access.
//
// Reads resolve default access into auth().accessibleProjectIds, but a set of
// write rules only admitted explicit membership rows — so a user whose only
// path to a project was its defaultAccessType could read but not write, even
// as a PROJECTADMIN with an all-permissions global role. The fix copies the
// three "project default" branches from RepositoryCases into those rules.
//
// Every acting user here has ZERO explicit rows (UserProjectPermission /
// GroupProjectPermission / ProjectAssignment) on the fixture projects; their
// only access path is the project's defaultAccessType. The differential pair
// is RepositoryFolders (was denied) vs RepositoryCases (was allowed).
//
// The SPECIFIC_ROLE + read-only-default project is the guard against fixing
// this into an over-grant: implicit users there are read-only BY CONFIGURATION
// and must stay denied.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test project-default-access-write --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { WorkflowScope } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `pdaw-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True if the operation was blocked by policy (threw, or updated/returned nothing). */
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

interface ProjectFixture {
  projectId: number;
  repositoryId: number;
  folderId: number; // pre-existing folder (created by the project creator)
}

interface Fixture {
  globalDefault: ProjectFixture; // defaultAccessType GLOBAL_ROLE, no default role
  specificReadOnly: ProjectFixture; // SPECIFIC_ROLE default, read-only default role
  specificCapable: ProjectFixture; // SPECIFIC_ROLE default, capable default role
  projectIntegrationId: string; // on globalDefault — Settings.canAddEdit target
  deletableIntegrationId: string; // on globalDefault — Settings.canDelete target
  templateId: number;
  caseWorkflowId: number;
  runWorkflowId: number;
  sessionWorkflowId: number;
  milestoneTypeId: number;
  // Parent rows on globalDefault for relation-path child models
  milestoneId: number; // MilestoneIssue traverses milestone.project
  issueId: number;
  sharedStepGroupId: number; // SharedStepItem traverses sharedStepGroup.project
  dataSetId: number; // DataSetRow/DataSetVersion traverse dataSet.project
  implicitProjectAdmin: AuthUser; // PROJECTADMIN + all-permissions global role
  implicitUser: AuthUser; // plain USER + all-permissions global role
  implicitViewer: AuthUser; // plain USER + permissionless global role
  /** Permissionless global role, but an EXPLICIT SPECIFIC_ROLE grant on
   * globalDefault carrying the capable role — exercises the widened explicit
   * Settings branch on the integration models. */
  explicitSettingsMember: AuthUser;
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const caseWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDeleted: false, isEnabled: true },
  });
  if (!caseWorkflow)
    throw new Error("Dev DB missing CASES-scoped Workflows row.");
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow)
    throw new Error("Dev DB missing RUNS-scoped Workflows row.");
  const sessionWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.SESSIONS, isDeleted: false, isEnabled: true },
  });
  if (!sessionWorkflow)
    throw new Error("Dev DB missing SESSIONS-scoped Workflows row.");
  const template = await db.templates.findFirst({
    where: { isDeleted: false, isEnabled: true },
  });
  if (!template) throw new Error("Dev DB missing an enabled Templates row.");
  const milestoneType = await db.milestoneTypes.findFirst({
    where: { isDeleted: false },
  });
  if (!milestoneType) throw new Error("Dev DB missing a MilestoneTypes row.");

  const AREAS = [
    "TestCaseRepository",
    "Milestones",
    "SharedSteps",
    "Reporting",
    "Settings",
    "TestRuns",
    "Sessions",
  ] as const;
  const capableRole = await db.roles.create({
    data: {
      name: `${TAG}-capable`,
      rolePermissions: {
        create: AREAS.map((area) => ({
          area,
          canAddEdit: true,
          canDelete: true,
        })),
      },
    },
  });
  const readOnlyRole = await db.roles.create({
    data: { name: `${TAG}-readonly` },
  });

  const mkUser = async (
    label: string,
    access: "USER" | "PROJECTADMIN",
    roleId: number
  ) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access,
        roleId,
      },
    });

  const creatorRow = await mkUser("creator", "USER", readOnlyRole.id);
  const adminRow = await mkUser(
    "implicitAdmin",
    "PROJECTADMIN",
    capableRole.id
  );
  const userRow = await mkUser("implicitUser", "USER", capableRole.id);
  const viewerRow = await mkUser("implicitViewer", "USER", readOnlyRole.id);
  const explicitMemberRow = await mkUser(
    "explicitMember",
    "USER",
    readOnlyRole.id
  );

  const mkProject = async (
    label: string,
    defaultAccessType: "GLOBAL_ROLE" | "SPECIFIC_ROLE",
    defaultRoleId: number | null
  ): Promise<ProjectFixture> => {
    const project = await db.projects.create({
      data: {
        name: `${TAG}-${label}`,
        createdBy: creatorRow.id,
        defaultAccessType,
        defaultRoleId,
      },
    });
    const repository = await db.repositories.create({
      data: { projectId: project.id },
    });
    const folder = await db.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: `${TAG}-${label}-root`,
        creatorId: creatorRow.id,
      },
    });
    return {
      projectId: project.id,
      repositoryId: repository.id,
      folderId: folder.id,
    };
  };

  const globalDefault = await mkProject("global", "GLOBAL_ROLE", null);
  const specificReadOnly = await mkProject(
    "specificRO",
    "SPECIFIC_ROLE",
    readOnlyRole.id
  );
  const specificCapable = await mkProject(
    "specificRW",
    "SPECIFIC_ROLE",
    capableRole.id
  );

  const integration = await db.integration.create({
    data: {
      name: `${TAG}-integration`,
      provider: "SIMPLE_URL",
      authType: "NONE",
      credentials: {},
    },
  });
  const deletableIntegration = await db.integration.create({
    data: {
      name: `${TAG}-integration-deletable`,
      provider: "SIMPLE_URL",
      authType: "NONE",
      credentials: {},
    },
  });
  const projectIntegration = await db.projectIntegration.create({
    data: {
      projectId: globalDefault.projectId,
      integrationId: integration.id,
    },
  });
  const deletableProjectIntegration = await db.projectIntegration.create({
    data: {
      projectId: globalDefault.projectId,
      integrationId: deletableIntegration.id,
      isActive: false,
    },
  });

  // Explicit SPECIFIC_ROLE grant carrying the capable role — the member's own
  // global role is permissionless, so any write they pass comes from the grant.
  await db.userProjectPermission.create({
    data: {
      userId: explicitMemberRow.id,
      projectId: globalDefault.projectId,
      accessType: "SPECIFIC_ROLE",
      roleId: capableRole.id,
    },
  });

  // Parent rows for the relation-path child models (created by the creator).
  const milestone = await db.milestones.create({
    data: {
      projectId: globalDefault.projectId,
      milestoneTypesId: milestoneType.id,
      name: `${TAG}-parent-milestone`,
      createdBy: creatorRow.id,
    },
  });
  const issue = await db.issue.create({
    data: {
      name: `${TAG}-issue`,
      title: `${TAG}-issue`,
      projectId: globalDefault.projectId,
      createdById: creatorRow.id,
    },
  });
  const sharedStepGroup = await db.sharedStepGroup.create({
    data: {
      projectId: globalDefault.projectId,
      name: `${TAG}-ssg`,
      createdById: creatorRow.id,
    },
  });
  const dataSet = await db.dataSet.create({
    data: {
      projectId: globalDefault.projectId,
      name: `${TAG}-parent-dataset`,
      createdById: creatorRow.id,
    },
  });

  return {
    globalDefault,
    specificReadOnly,
    specificCapable,
    projectIntegrationId: projectIntegration.id,
    deletableIntegrationId: deletableProjectIntegration.id,
    templateId: template.id,
    caseWorkflowId: caseWorkflow.id,
    runWorkflowId: runWorkflow.id,
    sessionWorkflowId: sessionWorkflow.id,
    milestoneTypeId: milestoneType.id,
    milestoneId: milestone.id,
    issueId: issue.id,
    sharedStepGroupId: sharedStepGroup.id,
    dataSetId: dataSet.id,
    implicitProjectAdmin: await fetchAuthUser(adminRow.id),
    implicitUser: await fetchAuthUser(userRow.id),
    implicitViewer: await fetchAuthUser(viewerRow.id),
    explicitSettingsMember: await fetchAuthUser(explicitMemberRow.id),
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
  await safe(() =>
    db.projectIntegration.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.integration.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.llmReportSnapshot.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.stepSequenceMatch.deleteMany({
      where: { fingerprint: { startsWith: TAG } },
    })
  );
  await safe(() =>
    db.sharedStepGroup.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.dataSet.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.milestones.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.issue.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.userProjectPermission.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.testRuns.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.sessions.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.repositoryCases.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.repositoryFolders.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.repositories.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { name: { startsWith: TAG } },
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
}, 30_000);

afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanupFixture(fixture);
  await db.$disconnect();
}, 30_000);

describeIntegration("default-access (implicit) write authorization", () => {
  const createFolder = async (
    user: AuthUser,
    p: ProjectFixture,
    label: string
  ) => {
    const enhanced = await getAuthDb(user);
    return enhanced.repositoryFolders.create({
      data: {
        projectId: p.projectId,
        repositoryId: p.repositoryId,
        parentId: p.folderId,
        name: `${TAG}-created-${label}`,
        creatorId: user.id,
      },
    });
  };
  const createCase = async (
    user: AuthUser,
    p: ProjectFixture,
    label: string
  ) => {
    const enhanced = await getAuthDb(user);
    return enhanced.repositoryCases.create({
      data: {
        projectId: p.projectId,
        repositoryId: p.repositoryId,
        folderId: p.folderId,
        templateId: fixture!.templateId,
        stateId: fixture!.caseWorkflowId,
        name: `${TAG}-case-${label}`,
        creatorId: user.id,
      },
    });
  };

  // --- The reported bug: implicit access could read folders but not write them ---

  it("implicit PROJECTADMIN CAN create a folder on a GLOBAL_ROLE-default project (was denied)", async () => {
    expect(
      await isDenied(() =>
        createFolder(
          fixture!.implicitProjectAdmin,
          fixture!.globalDefault,
          "admin-global"
        )
      )
    ).toBe(false);
  });

  it("implicit PROJECTADMIN CAN update an existing folder (was denied)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitProjectAdmin);
    const updated = await enhanced.repositoryFolders.update({
      where: { id: fixture!.globalDefault.folderId },
      data: { name: `${TAG}-global-root-renamed` },
    });
    expect(updated.name).toContain("renamed");
  });

  it("implicit plain USER with a capable global role CAN create a folder (not PROJECTADMIN-specific)", async () => {
    expect(
      await isDenied(() =>
        createFolder(
          fixture!.implicitUser,
          fixture!.globalDefault,
          "user-global"
        )
      )
    ).toBe(false);
  });

  // --- Differential control: the sibling that already worked keeps working ---

  it("implicit PROJECTADMIN CAN create a case (RepositoryCases control)", async () => {
    expect(
      await isDenied(() =>
        createCase(
          fixture!.implicitProjectAdmin,
          fixture!.globalDefault,
          "admin-global"
        )
      )
    ).toBe(false);
  });

  // --- Run/session CREATE (their update/delete rules already had the branches) ---

  const createRun = async (
    user: AuthUser,
    p: ProjectFixture,
    label: string
  ) => {
    const enhanced = await getAuthDb(user);
    return enhanced.testRuns.create({
      data: {
        projectId: p.projectId,
        name: `${TAG}-run-${label}`,
        stateId: fixture!.runWorkflowId,
        createdById: user.id,
      },
    });
  };

  it("implicit plain USER CAN create a test run (was denied)", async () => {
    expect(
      await isDenied(() =>
        createRun(fixture!.implicitUser, fixture!.globalDefault, "user-global")
      )
    ).toBe(false);
  });

  it("implicit plain USER CAN create a session (was denied)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.sessions.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            templateId: fixture!.templateId,
            name: `${TAG}-session-user-global`,
            stateId: fixture!.sessionWorkflowId,
            createdById: fixture!.implicitUser.id,
          },
        })
      )
    ).toBe(false);
  });

  it("implicit PROJECTADMIN on the read-only-default project is DENIED run create", async () => {
    expect(
      await isDenied(() =>
        createRun(
          fixture!.implicitProjectAdmin,
          fixture!.specificReadOnly,
          "admin-ro"
        )
      )
    ).toBe(true);
  });

  // --- Representative fixed models beyond the repository pair ---

  it("implicit PROJECTADMIN CAN create a milestone", async () => {
    const enhanced = await getAuthDb(fixture!.implicitProjectAdmin);
    expect(
      await isDenied(() =>
        enhanced.milestones.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            milestoneTypesId: fixture!.milestoneTypeId,
            name: `${TAG}-milestone`,
            createdBy: fixture!.implicitProjectAdmin.id,
          },
        })
      )
    ).toBe(false);
  });

  it("implicit PROJECTADMIN CAN create a data set", async () => {
    const enhanced = await getAuthDb(fixture!.implicitProjectAdmin);
    expect(
      await isDenied(() =>
        enhanced.dataSet.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            name: `${TAG}-dataset`,
            createdById: fixture!.implicitProjectAdmin.id,
          },
        })
      )
    ).toBe(false);
  });

  // --- Every remaining rewritten model, including each relation-path shape ---

  it("implicit user CAN link an issue to a milestone (MilestoneIssue, milestone.project path)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.milestoneIssue.create({
          data: {
            milestoneId: fixture!.milestoneId,
            issueId: fixture!.issueId,
          },
        })
      )
    ).toBe(false);
  });

  it("implicit user CAN create a step-sequence match (StepSequenceMatch)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.stepSequenceMatch.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            fingerprint: `${TAG}-fp`,
            stepCount: 2,
          },
        })
      )
    ).toBe(false);
  });

  it("implicit user CAN create a shared step group and an item in it (sharedStepGroup.project path)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.sharedStepGroup.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            name: `${TAG}-ssg-user`,
            createdById: fixture!.implicitUser.id,
          },
        })
      )
    ).toBe(false);
    expect(
      await isDenied(() =>
        enhanced.sharedStepItem.create({
          data: {
            sharedStepGroupId: fixture!.sharedStepGroupId,
            order: 1,
            step: { text: "step" },
            expectedResult: { text: "result" },
          },
        })
      )
    ).toBe(false);
  });

  it("implicit user CAN create a data set row and version (dataSet.project path)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.dataSetRow.create({
          data: {
            dataSetId: fixture!.dataSetId,
            rowIndex: 1,
            valuesJson: { col: "value" },
          },
        })
      )
    ).toBe(false);
    expect(
      await isDenied(() =>
        enhanced.dataSetVersion.create({
          data: {
            dataSetId: fixture!.dataSetId,
            version: 1,
            rowsJson: [],
            createdById: fixture!.implicitUser.id,
          },
        })
      )
    ).toBe(false);
  });

  it("implicit user CAN create then delete an LLM report snapshot (Reporting canAddEdit/canDelete)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    const snapshot = await enhanced.llmReportSnapshot.create({
      data: {
        projectId: fixture!.globalDefault.projectId,
        reportType: "automation_candidates",
        status: "running",
        generatedById: fixture!.implicitUser.id,
      },
    });
    expect(snapshot.id).toBeGreaterThan(0);
    expect(
      await isDenied(() =>
        enhanced.llmReportSnapshot.delete({ where: { id: snapshot.id } })
      )
    ).toBe(false);
  });

  it("implicit viewer is DENIED LLM report snapshot create", async () => {
    const enhanced = await getAuthDb(fixture!.implicitViewer);
    expect(
      await isDenied(() =>
        enhanced.llmReportSnapshot.create({
          data: {
            projectId: fixture!.globalDefault.projectId,
            reportType: "automation_candidates",
            status: "running",
            generatedById: fixture!.implicitViewer.id,
          },
        })
      )
    ).toBe(true);
  });

  // --- Integrations follow the role's Settings permissions ---

  it("implicit user CAN create and update an external-project mapping (IntegrationProject, two-hop path)", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    const mapping = await enhanced.integrationProject.create({
      data: {
        projectIntegrationId: fixture!.projectIntegrationId,
        externalProjectId: `${TAG}-ext`,
        externalProjectKey: `${TAG}-KEY`,
        externalProjectName: `${TAG} external`,
      },
    });
    expect(mapping.id).toBeTruthy();
    expect(
      await isDenied(() =>
        enhanced.integrationProject.update({
          where: { id: mapping.id },
          data: { externalProjectName: `${TAG} renamed` },
        })
      )
    ).toBe(false);
  });

  it("implicit viewer is DENIED external-project mapping update", async () => {
    const enhanced = await getAuthDb(fixture!.implicitViewer);
    expect(
      await isDenied(() =>
        enhanced.integrationProject.updateMany({
          where: { projectIntegrationId: fixture!.projectIntegrationId },
          data: { externalProjectName: `${TAG} viewer` },
        })
      )
    ).toBe(true);
  });

  it("explicit SPECIFIC_ROLE member with Settings.canAddEdit CAN update the project integration (widened from 'Project Admin' role-name only)", async () => {
    const enhanced = await getAuthDb(fixture!.explicitSettingsMember);
    expect(
      await isDenied(() =>
        enhanced.projectIntegration.update({
          where: { id: fixture!.projectIntegrationId },
          data: { syncStatus: `${TAG}-explicit-member` },
        })
      )
    ).toBe(false);
  });

  it("implicit user with Settings.canAddEdit CAN update the project integration", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.projectIntegration.update({
          where: { id: fixture!.projectIntegrationId },
          data: { syncStatus: `${TAG}-touched` },
        })
      )
    ).toBe(false);
  });

  it("implicit user with Settings.canDelete CAN delete a project integration", async () => {
    const enhanced = await getAuthDb(fixture!.implicitUser);
    expect(
      await isDenied(() =>
        enhanced.projectIntegration.delete({
          where: { id: fixture!.deletableIntegrationId },
        })
      )
    ).toBe(false);
  });

  it("implicit viewer (permissionless role) is DENIED integration update", async () => {
    const enhanced = await getAuthDb(fixture!.implicitViewer);
    expect(
      await isDenied(() =>
        enhanced.projectIntegration.update({
          where: { id: fixture!.projectIntegrationId },
          data: { syncStatus: `${TAG}-viewer` },
        })
      )
    ).toBe(true);
  });

  // --- Role capability still gates the new branches ---

  it("implicit viewer (permissionless role) is DENIED folder create on the GLOBAL_ROLE-default project", async () => {
    expect(
      await isDenied(() =>
        createFolder(
          fixture!.implicitViewer,
          fixture!.globalDefault,
          "viewer-global"
        )
      )
    ).toBe(true);
  });

  // --- SPECIFIC_ROLE default: the project's default role governs, not the user's ---

  it("unassigned implicit USER CAN create a folder when the default role is capable", async () => {
    expect(
      await isDenied(() =>
        createFolder(
          fixture!.implicitUser,
          fixture!.specificCapable,
          "user-specific"
        )
      )
    ).toBe(false);
  });

  // --- The over-grant guard: read-only-by-configuration stays read-only ---

  it("implicit PROJECTADMIN on a read-only SPECIFIC_ROLE-default project can READ but NOT write", async () => {
    const enhanced = await getAuthDb(fixture!.implicitProjectAdmin);
    const seen = await enhanced.repositoryFolders.findUnique({
      where: { id: fixture!.specificReadOnly.folderId },
    });
    expect(seen).not.toBeNull();

    expect(
      await isDenied(() =>
        createFolder(
          fixture!.implicitProjectAdmin,
          fixture!.specificReadOnly,
          "admin-ro"
        )
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        createCase(
          fixture!.implicitProjectAdmin,
          fixture!.specificReadOnly,
          "admin-ro"
        )
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        enhanced.dataSet.create({
          data: {
            projectId: fixture!.specificReadOnly.projectId,
            name: `${TAG}-dataset-ro`,
            createdById: fixture!.implicitProjectAdmin.id,
          },
        })
      )
    ).toBe(true);
  });
});
