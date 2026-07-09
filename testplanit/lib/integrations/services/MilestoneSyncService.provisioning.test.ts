import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * MilestoneType provisioning (MAP-03) + import entry point
 * (`performMilestoneImport`). Two suites:
 *   1. Mocked unit assertions (fast, always runs) — provisioning + import
 *      call shape, attribution threading.
 *   2. Live-DB integration test (gated on RUN_DB_INTEGRATION=1) — proves
 *      the raw-db upserts against real Postgres columns, per the project's
 *      "raw-db helpers need >=1 live-DB integration test" rule, since
 *      MilestoneTypes/MilestoneTypesAssignment are admin-only-ACL models
 *      that only rawDb can write.
 *
 * Live-DB invocation (vitest does not auto-load .env — pass DATABASE_URL
 * explicitly, per 17-02's documented gotcha):
 *   cd testplanit && RUN_DB_INTEGRATION=1 DATABASE_URL=... pnpm test run \
 *     lib/integrations/services/MilestoneSyncService.provisioning.test.ts
 */

// ─────────────────────────── Mocked unit suite ───────────────────────────

const mockMilestoneTypesUpsert = vi.fn();
const mockMilestoneTypesAssignmentUpsert = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockIntegrationProjectFindMany = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestoneTypes: {
      upsert: (...args: any[]) => mockMilestoneTypesUpsert(...args),
    },
    milestoneTypesAssignment: {
      upsert: (...args: any[]) => mockMilestoneTypesAssignmentUpsert(...args),
    },
    milestones: {
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
  },
}));

const mockGetExternalMilestones = vi.fn();
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({
        milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: false },
      }),
      getExternalMilestones: (...args: any[]) =>
        mockGetExternalMilestones(...args),
    }),
  },
}));

vi.mock("../../valkey", () => ({ default: null }));

import { milestoneSyncService } from "./MilestoneSyncService";

beforeEach(() => {
  vi.clearAllMocks();
  mockMilestoneTypesUpsert.mockImplementation(
    async ({ where }: { where: { name: string } }) => ({
      id: where.name === "Release" ? 1001 : 1002,
    })
  );
  mockMilestoneTypesAssignmentUpsert.mockResolvedValue({});
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockImplementation(async ({ create }: any) => ({
    id: 5000,
    ...create,
  }));
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "TEST" },
  ]);
});

describe("MilestoneType provisioning (mocked)", () => {
  it("upserts Release and Sprint types by name and assigns both to the project", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "v1",
          kind: "RELEASE",
          name: "v1.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneImport("admin-1", 1, 100, {
      externalIds: ["v1"],
      kinds: ["RELEASE"],
    });

    expect(mockMilestoneTypesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Release" } })
    );
    expect(mockMilestoneTypesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Sprint" } })
    );
    expect(mockMilestoneTypesAssignmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_milestoneTypeId: { projectId: 100, milestoneTypeId: 1001 },
        },
      })
    );
    expect(mockMilestoneTypesAssignmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_milestoneTypeId: { projectId: 100, milestoneTypeId: 1002 },
        },
      })
    );
  });

  it("assigns the Release type id to a RELEASE milestone (MAP-03)", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "v2",
          kind: "RELEASE",
          name: "v2.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneImport("admin-1", 1, 100, {
      externalIds: ["v2"],
      kinds: ["RELEASE"],
    });

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.milestoneTypesId).toBe(1001); // Release type id
  });

  it("explicit import attribution: createdById defaults to the acting userId", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "v3",
          kind: "RELEASE",
          name: "v3.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneImport(
      "acting-admin-42",
      1,
      100,
      { externalIds: ["v3"], kinds: ["RELEASE"] }
    );

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.createdBy).toBe("acting-admin-42");
  });

  it("threads an explicit createdById override distinct from userId (Task 3 auto-track caller)", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "v4",
          kind: "RELEASE",
          name: "v4.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneImport(
      "triggering-user",
      1,
      100,
      { externalIds: ["v4"], kinds: ["RELEASE"] },
      "auto-track-admin-99"
    );

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.createdBy).toBe("auto-track-admin-99");
  });

  it("re-import of the same externalIds does not duplicate (idempotent) — counted as updated", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "v5",
          kind: "RELEASE",
          name: "v5.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    const first = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      1,
      100,
      { externalIds: ["v5"], kinds: ["RELEASE"] }
    );
    expect(first.imported).toBe(1);
    expect(first.updated).toBe(0);

    // Second import: findUnique now returns the existing row.
    mockMilestonesFindUnique.mockResolvedValue({ id: 5000 });
    const second = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      1,
      100,
      { externalIds: ["v5"], kinds: ["RELEASE"] }
    );
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(1);
  });
});

// ────────────────────────── Live-DB integration suite ─────────────────────
// Uses the REAL rawDb client — must run outside the `vi.mock("@/lib/rawDb")`
// shadow above, so this suite dynamically imports a fresh, unmocked module
// graph via vi.doUnmock + resetModules is unnecessary here: Vitest hoists
// vi.mock calls per-file, so a *separate* file would normally be required.
// Instead we gate this suite behind RUN_DB_INTEGRATION and use
// `vi.importActual` to bypass the top-of-file mock for just this block.

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("MilestoneType provisioning + import (live DB)", () => {
  let realDb: any;
  let realMilestoneSyncService: any;
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;
  const createdMilestoneIds: number[] = [];
  let releaseTypeId: number;
  let sprintTypeId: number;
  const STAMP = `mspit-prov-${Date.now()}`;

  beforeAll(async () => {
    // The file-level vi.mock() calls above (rawDb, IntegrationManager,
    // valkey) apply module-wide for this test file — importActual alone
    // is NOT enough, because MilestoneSyncService.ts's own internal
    // `import { integrationManager } from "../IntegrationManager"` still
    // resolves through Vitest's per-file mock registry regardless of how
    // the *test* imports MilestoneSyncService. vi.doUnmock + resetModules
    // clears the registry for this suite so every transitive import
    // (rawDb, IntegrationManager, MilestoneSyncService) resolves to the
    // REAL module — proving the raw-db writes against real Postgres.
    vi.doUnmock("@/lib/rawDb");
    vi.doUnmock("../IntegrationManager");
    vi.doUnmock("../../valkey");
    vi.resetModules();

    const rawDbModule = await import("@/lib/rawDb");
    realDb = rawDbModule.rawDb;

    const serviceModule = await import("./MilestoneSyncService");
    realMilestoneSyncService = serviceModule.milestoneSyncService;

    const role = await realDb.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await realDb.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `MS Provisioning Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await realDb.projects.create({
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const integration = await realDb.integration.create({
      data: {
        name: `${STAMP}-jira`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    const projectIntegration = await realDb.projectIntegration.create({
      data: { projectId, integrationId, isActive: true },
      select: { id: true },
    });

    await realDb.integrationProject.create({
      data: {
        projectIntegrationId: projectIntegration.id,
        externalProjectId: "10000",
        externalProjectKey: "TEST",
        externalProjectName: "Test Project",
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    if (createdMilestoneIds.length > 0) {
      await realDb.milestones.deleteMany({
        where: { id: { in: createdMilestoneIds } },
      });
    }
    await realDb.integrationProject.deleteMany({
      where: { projectIntegration: { integrationId, projectId } },
    });
    await realDb.projectIntegration.deleteMany({
      where: { integrationId, projectId },
    });
    await realDb.integration.delete({ where: { id: integrationId } });
    if (releaseTypeId) {
      await realDb.milestoneTypesAssignment
        .delete({
          where: {
            projectId_milestoneTypeId: {
              projectId,
              milestoneTypeId: releaseTypeId,
            },
          },
        })
        .catch(() => {});
    }
    if (sprintTypeId) {
      await realDb.milestoneTypesAssignment
        .delete({
          where: {
            projectId_milestoneTypeId: {
              projectId,
              milestoneTypeId: sprintTypeId,
            },
          },
        })
        .catch(() => {});
    }
    // Only delete the type rows themselves if this run created fresh
    // "Release"/"Sprint" rows exclusively for this test DB — in a shared
    // dev DB they're likely to be reused across runs/other fixtures, so
    // we leave the globally-named type rows in place (idempotent
    // provisioning is the point) and only clean up the project's
    // assignment + our own fixture rows.
    await realDb.projects.delete({ where: { id: projectId } });
    await realDb.user.delete({ where: { id: adminUserId } });
    await realDb.$disconnect();
  });

  it("provisions Release/Sprint types assigned to the project and imports idempotently with correct attribution", async () => {
    // Mock the adapter layer only — IntegrationManager.getAdapter would
    // otherwise try a real Jira credential handshake. This live-DB test
    // proves the raw-db upsert paths (MilestoneTypes/MilestoneTypesAssignment/
    // Milestones), not the adapter fetch itself (covered by
    // JiraAdapter.milestones.test.ts in 17-03).
    const realIntegrationManagerModule = await import("../IntegrationManager");
    const getAdapterSpy = vi
      .spyOn(realIntegrationManagerModule.integrationManager, "getAdapter")
      .mockResolvedValue({
        getCapabilities: () => ({
          milestones: { kinds: ["RELEASE"], webhooks: false },
        }),
        getExternalMilestones: async () => ({
          items: [
            {
              id: `${STAMP}-v1`,
              kind: "RELEASE" as const,
              name: `${STAMP} v1.0`,
              state: "ACTIVE" as const,
              rawState: "unreleased",
            },
          ],
          hasMore: false,
        }),
      } as any);

    const first = await realMilestoneSyncService.performMilestoneImport(
      adminUserId,
      integrationId,
      projectId,
      { externalIds: [`${STAMP}-v1`], kinds: ["RELEASE"] }
    );
    expect(first.success).toBe(true);
    expect(first.imported).toBe(1);
    expect(first.updated).toBe(0);

    const created = await realDb.milestones.findUnique({
      where: {
        externalId_integrationId: {
          externalId: `${STAMP}-v1`,
          integrationId,
        },
      },
      select: { id: true, createdBy: true, milestoneTypesId: true },
    });
    expect(created).toBeTruthy();
    createdMilestoneIds.push(created!.id);
    expect(created!.createdBy).toBe(adminUserId);
    releaseTypeId = created!.milestoneTypesId;

    const releaseType = await realDb.milestoneTypes.findUnique({
      where: { id: releaseTypeId },
      select: { name: true },
    });
    expect(releaseType?.name).toBe("Release");

    const sprintType = await realDb.milestoneTypes.findUnique({
      where: { name: "Sprint" },
      select: { id: true },
    });
    sprintTypeId = sprintType!.id;

    const assignment = await realDb.milestoneTypesAssignment.findUnique({
      where: {
        projectId_milestoneTypeId: {
          projectId,
          milestoneTypeId: releaseTypeId,
        },
      },
    });
    expect(assignment).toBeTruthy();

    // Re-import the same externalId — must not duplicate.
    const second = await realMilestoneSyncService.performMilestoneImport(
      adminUserId,
      integrationId,
      projectId,
      { externalIds: [`${STAMP}-v1`], kinds: ["RELEASE"] }
    );
    expect(second.success).toBe(true);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(1);

    const countAfterReimport = await realDb.milestones.count({
      where: { externalId: `${STAMP}-v1`, integrationId },
    });
    expect(countAfterReimport).toBe(1);

    getAdapterSpy.mockRestore();
  });
});
