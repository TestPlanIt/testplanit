// Live-DB proof that one tracker ticket is shared by every project on the
// integration that imports it — the milestone-import scenario that used to
// fail with "Refusing to reassign Issue N from project X to Y" when a second
// project's milestone contained a ticket the first project had already
// imported and linked.
//
// Drives the real `performMilestoneImport` entry point twice (project A,
// then project B) against a stubbed tracker adapter that answers the same
// fix version and the same member ticket for both, and checks:
//   - the second import succeeds with no membership errors
//   - there is still ONE Issue row for the ticket, homed in project A
//   - both projects hold an IssueProjectMembership row
//   - project A's milestone link survives project B's import
//   - `issueInProjectWhere` finds the row for A and B but not for a third
//     project that never touched it
//
// Run (never against the default .env DATABASE_URL — that resolves to `ew`):
//   cd testplanit && DATABASE_URL=<scratch tpi_* URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-shared-across-projects.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ISSUE_PROJECT_IDS_SELECT,
  collectIssueProjectIds,
  issueInProjectWhere,
} from "~/lib/issues/projectMembershipWhere";
import { createRawDbClient } from "~/lib/rawDbClient";

vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/valkey", () => ({
  default: null,
  createSubscriberClient: () => null,
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `isv-${Date.now()}`;
const TICKET_EXTERNAL_ID = `${STAMP}-ticket`;
const FIX_VERSION_ID = `${STAMP}-fixversion`;

function makeIssueData(id: string) {
  return {
    id,
    key: `${STAMP}-${id}`,
    title: `${STAMP} ${id}`,
    status: "open",
    priority: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
    customFields: {},
    labels: [],
    components: [],
  };
}

describeIntegration("issues shared across projects (live DB)", () => {
  let adminUserId: string;
  let integrationId: number;
  let projectAId: number;
  let projectBId: number;
  let projectCId: number;
  const integrationProjectIds: string[] = [];

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against a tpi_* scratch database`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Shared Issues Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const [projectA, projectB, projectC] = await Promise.all(
      ["a", "b", "c"].map((suffix) =>
        db.projects.create({
          data: { name: `${STAMP}-project-${suffix}`, createdBy: adminUserId },
          select: { id: true },
        })
      )
    );
    projectAId = projectA.id;
    projectBId = projectB.id;
    projectCId = projectC.id;

    const integration = await db.integration.create({
      data: {
        name: `${STAMP}-integration`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    // Projects A and B both map to the same tracker project on the one
    // integration — the configuration that produced the customer failure.
    for (const projectId of [projectAId, projectBId]) {
      const projectIntegration = await db.projectIntegration.create({
        data: { projectId, integrationId, isActive: true, config: {} },
        select: { id: true },
      });
      const mapping = await db.integrationProject.create({
        data: {
          projectIntegrationId: projectIntegration.id,
          externalProjectId: `${STAMP}-shared`,
          externalProjectKey: `${STAMP}-shared`,
          externalProjectName: `${STAMP} shared tracker project`,
          isActive: true,
        },
        select: { id: true },
      });
      integrationProjectIds.push(mapping.id);
    }

    const { integrationManager } =
      await import("~/lib/integrations/IntegrationManager");
    vi.spyOn(integrationManager, "getAdapter").mockResolvedValue({
      getCapabilities: vi.fn().mockReturnValue({}),
      getExternalMilestones: vi.fn(
        async ({ kind }: { kind?: "RELEASE" | "ITERATION" }) => ({
          items:
            kind === "ITERATION"
              ? []
              : [
                  {
                    id: FIX_VERSION_ID,
                    kind: "RELEASE" as const,
                    name: `${STAMP} fix version`,
                    state: "ACTIVE" as const,
                  },
                ],
          hasMore: false,
        })
      ),
      getMilestoneIssues: vi.fn(async () => ({
        issues: [makeIssueData(TICKET_EXTERNAL_ID)],
        hasMore: false,
      })),
    } as any);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.issue.deleteMany({
      where: { integrationId, externalId: TICKET_EXTERNAL_ID },
    });
    await db.integrationProject.deleteMany({
      where: { id: { in: integrationProjectIds } },
    });
    await db.projectIntegration.deleteMany({ where: { integrationId } });
    await db.integration.delete({ where: { id: integrationId } });
    // Milestones and type assignments cascade from the project rows.
    await db.projects.deleteMany({
      where: { id: { in: [projectAId, projectBId, projectCId] } },
    });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  async function importReleaseInto(projectId: number) {
    const { milestoneSyncService } =
      await import("~/lib/integrations/services/MilestoneSyncService");
    return milestoneSyncService.performMilestoneImport(
      adminUserId,
      integrationId,
      projectId,
      { kinds: ["RELEASE"] },
      adminUserId,
      { dbClient: db as any }
    );
  }

  async function ticketRows() {
    return db.issue.findMany({
      where: { integrationId, externalId: TICKET_EXTERNAL_ID },
      select: {
        id: true,
        projectId: true,
        projectMemberships: {
          select: { projectId: true },
          orderBy: { projectId: "asc" },
        },
        milestoneIssues: {
          select: { source: true, milestone: { select: { projectId: true } } },
        },
      },
    });
  }

  it("imports the ticket into project A's milestone and homes it there", async () => {
    const result = await importReleaseInto(projectAId);

    expect(result.errors).toEqual([]);
    expect(result.membershipErrors).toEqual([]);
    expect(result.imported).toBe(1);

    const rows = await ticketRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe(projectAId);
    expect(rows[0].projectMemberships.map((m) => m.projectId)).toEqual([
      projectAId,
    ]);
    expect(rows[0].milestoneIssues).toEqual([
      { source: "SYNCED", milestone: { projectId: projectAId } },
    ]);
  });

  it("lets project B import the same ticket into its own milestone without taking the row over", async () => {
    const result = await importReleaseInto(projectBId);

    expect(result.errors).toEqual([]);
    expect(result.membershipErrors).toEqual([]);
    expect(result.imported).toBe(1);

    const rows = await ticketRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe(projectAId);
    expect(rows[0].projectMemberships.map((m) => m.projectId)).toEqual(
      [projectAId, projectBId].sort((a, b) => a - b)
    );
    expect(
      rows[0].milestoneIssues
        .map((link) => link.milestone.projectId)
        .sort((a, b) => a - b)
    ).toEqual([projectAId, projectBId].sort((a, b) => a - b));
    expect(rows[0].milestoneIssues.every((l) => l.source === "SYNCED")).toBe(
      true
    );
  });

  it("is visible to both importing projects and to no other", async () => {
    const [row] = await ticketRows();

    for (const [projectId, expected] of [
      [projectAId, 1],
      [projectBId, 1],
      [projectCId, 0],
    ] as const) {
      const visible = await db.issue.count({
        where: { AND: [{ id: row.id }, issueInProjectWhere(projectId)] },
      });
      expect(visible).toBe(expected);
    }

    const selected = await db.issue.findUniqueOrThrow({
      where: { id: row.id },
      select: ISSUE_PROJECT_IDS_SELECT,
    });
    expect([...collectIssueProjectIds(selected)].sort((a, b) => a - b)).toEqual(
      [projectAId, projectBId].sort((a, b) => a - b)
    );
  });

  it("re-importing into project A is idempotent", async () => {
    const result = await importReleaseInto(projectAId);

    expect(result.errors).toEqual([]);
    expect(result.membershipErrors).toEqual([]);
    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);

    const rows = await ticketRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].projectMemberships).toHaveLength(2);
    expect(rows[0].milestoneIssues).toHaveLength(2);
  });
});
