// Live-DB integration proof for cooperative typed-import cancellation
// (#501/28-05). Converts 28-01's it.todo scaffold into real tests, plus a
// fourth (late-cancel) case the plan adds on top of the original three.
//
// The adapter is mocked (this proves cancellation, not tracker behaviour),
// but the database is real: the claim "rows already imported stay imported"
// is a claim about committed data, and a mocked client cannot falsify it.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/typed-import-cancellation.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

// Mock only what actually needs mocking -- same posture as
// issue-sync-parentid.integration.test.ts: publishIssueUpdate is already
// internally guarded (no-ops when valkeyConnection is null) and
// syncIssueToElasticsearch is `.catch()`-wrapped at its call site, but the
// module-level `~/lib/valkey` import opens a real connection as a side
// effect of import alone (the worktree .env sets VALKEY_URL), and
// syncIssueToElasticsearch would hit the shared Elasticsearch node. Both are
// mocked to keep this suite's writes isolated to tpi_req20 and its process
// exit clean of open handles.
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
const STAMP = `tic-${Date.now()}`;

function makeIssueData(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id,
    key: overrides.key ?? `${STAMP}-${overrides.id}`,
    title: `${STAMP} ${overrides.id}`,
    status: "open",
    priority: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
    customFields: {},
    labels: [],
    components: [],
    ...overrides,
  };
}

/**
 * Wraps a real db client so the SECOND call to `integrationProject.update`
 * -- always the run's own terminal write (the first is the mark-syncing
 * write at the top of performProjectImport) -- first runs `hook`, then
 * proceeds with the real write. This is how the late-cancel test races a
 * cancel-request write into the exact window between the loop's own
 * decision (already made -- `cancelled` stayed false) and the terminal
 * write actually committing, without any wall-clock guessing.
 *
 * Every ZenStack CRUD closure this client returns was confirmed
 * this-independent directly against tpi_req20 before writing this suite
 * (`findFirst.call(undefined, {})` resolves normally), so forwarding them
 * through a Proxy without rebinding is safe -- these are plain closures over
 * the client's internal state, not methods that read `this`.
 */
function wrapDbForLateCancelHook(realDb: any, hook: () => Promise<void>) {
  let updateCallCount = 0;
  return new Proxy(realDb, {
    get(target, prop) {
      if (prop === "integrationProject") {
        const model = target.integrationProject;
        return new Proxy(model, {
          get(modelTarget, modelProp) {
            if (modelProp === "update") {
              return async (args: any) => {
                updateCallCount++;
                if (updateCallCount === 2) {
                  await hook();
                }
                return modelTarget.update(args);
              };
            }
            return modelTarget[modelProp as keyof typeof modelTarget];
          },
        });
      }
      return target[prop as keyof typeof target];
    },
  });
}

async function assertScratchDatabase(client: any, caller: string) {
  const [{ current_database: dbName }] = await client.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;
  if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
    throw new Error(
      `${caller}: refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
    );
  }
}

describeIntegration("typed import cooperative cancellation (live DB)", () => {
  let adminUserId: string;
  let integrationId: number;
  let projectId: number;
  let projectIntegrationId: string;
  const mappingIds: string[] = [];
  const allIssueIds: number[] = [];

  beforeAll(async () => {
    await assertScratchDatabase(db, "typed-import-cancellation beforeAll");

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Typed Import Cancellation Admin ${STAMP}`,
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

    const projectIntegration = await db.projectIntegration.create({
      data: { projectId, integrationId, isActive: true, config: {} },
      select: { id: true },
    });
    projectIntegrationId = projectIntegration.id;
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.integrationProject.deleteMany({
      where: { id: { in: mappingIds } },
    });
    await db.projectIntegration.deleteMany({ where: { integrationId } });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });

    // Zero rows left behind under this run's stamp, asserted rather than
    // assumed -- mirrors requirementScaleFixture's tearDown discipline.
    const remainingIssues = await db.issue.count({
      where: { externalId: { startsWith: STAMP } },
    });
    if (remainingIssues !== 0) {
      throw new Error(
        `typed-import-cancellation teardown: ${remainingIssues} Issue row(s) left behind under stamp "${STAMP}"`
      );
    }
    const remainingUsers = await db.user.count({
      where: { email: { startsWith: STAMP } },
    });
    if (remainingUsers !== 0) {
      throw new Error(
        `typed-import-cancellation teardown: ${remainingUsers} User row(s) left behind under stamp "${STAMP}"`
      );
    }

    await db.$disconnect();
  });

  async function createMapping(externalProjectId: string) {
    const mapping = await db.integrationProject.create({
      data: {
        projectIntegrationId,
        externalProjectId,
        externalProjectKey: externalProjectId,
        externalProjectName: `${externalProjectId} project`,
        isActive: true,
      },
      select: { id: true },
    });
    mappingIds.push(mapping.id);
    return mapping.id;
  }

  describe("a cancel request written between pages of a running import", () => {
    let mappingId: string;
    let searchIssues: ReturnType<typeof vi.fn>;
    let result: { imported: number; cancelled: boolean };
    const importedExternalIds = [
      `${STAMP}-inflight-1`,
      `${STAMP}-inflight-2`,
      `${STAMP}-inflight-3`,
    ];
    const shouldNotImportExternalId = `${STAMP}-inflight-should-not-import`;

    beforeAll(async () => {
      mappingId = await createMapping(`${STAMP}-inflight`);

      const { syncService, SYNC_STATUS } =
        await import("~/lib/integrations/services/SyncService");
      const { integrationManager } =
        await import("~/lib/integrations/IntegrationManager");

      const page1 = {
        issues: importedExternalIds.map((id) => makeIssueData({ id })),
        total: importedExternalIds.length,
        hasMore: true,
      };
      const page2 = {
        issues: [makeIssueData({ id: shouldNotImportExternalId })],
        total: 1,
        hasMore: false,
      };

      // Page 1's fetch is deliberately slow -- ample real time for a
      // genuinely separate connection to write the cancel request while
      // performProjectImport is still awaiting this very call, so the value
      // is already committed well before the run's own per-page check reads
      // it. No wall-clock race against the run itself, only against this
      // artificial delay.
      searchIssues = vi
        .fn()
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return page1;
        })
        .mockResolvedValueOnce(page2);

      vi.spyOn(integrationManager, "getAdapter").mockResolvedValueOnce({
        searchIssues,
        getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
      } as any);

      const importPromise = syncService.performProjectImport(
        integrationId,
        mappingId,
        { pagedToCompletion: true },
        undefined,
        { dbClient: db }
      );

      // A genuinely separate connection -- not the service's own db
      // reference -- so the write crosses a connection the way the future
      // cancel route (28-06) will.
      const db2 = createRawDbClient();
      await assertScratchDatabase(db2, "in-flight cancel write");
      await db2.integrationProject.update({
        where: { id: mappingId },
        data: { syncStatus: SYNC_STATUS.cancelRequested },
      });
      await db2.$disconnect();

      result = await importPromise;

      const importedRows = await db.issue.findMany({
        where: { externalId: { in: importedExternalIds }, integrationId },
        select: { id: true },
      });
      importedRows.forEach((row) => allIssueIds.push(row.id));
    });

    it("stops a paged-to-completion import within one page of a cancel request", () => {
      expect(searchIssues).toHaveBeenCalledTimes(1);
      expect(result.cancelled).toBe(true);
      expect(result.imported).toBe(importedExternalIds.length);
    });

    it("leaves the rows already imported in place after a cancellation", async () => {
      // Read back through a FRESH query, not the service's own result
      // object -- the claim under test is about committed rows.
      const rows = await db.issue.findMany({
        where: { externalId: { in: importedExternalIds }, integrationId },
        select: { id: true, externalId: true, isDeleted: true },
      });
      expect(rows).toHaveLength(importedExternalIds.length);
      rows.forEach((row) => expect(row.isDeleted).toBe(false));

      const shouldNotExist = await db.issue.findFirst({
        where: { externalId: shouldNotImportExternalId, integrationId },
        select: { id: true },
      });
      expect(shouldNotExist).toBeNull();
    });

    it("records a terminal cancelled syncStatus, not an error", async () => {
      const { SYNC_STATUS } =
        await import("~/lib/integrations/services/SyncService");
      const mappingRow = await db.integrationProject.findUnique({
        where: { id: mappingId },
        select: { syncStatus: true, syncError: true },
      });
      expect(mappingRow?.syncStatus).toBe(SYNC_STATUS.cancelled);
      expect(mappingRow?.syncStatus).not.toBe(SYNC_STATUS.error);
      expect(mappingRow?.syncError).toBeNull();
    });
  });

  describe("a cancel request written after the run already finished", () => {
    it("does not overwrite the completed run's terminal state", async () => {
      const mappingId = await createMapping(`${STAMP}-late`);

      const { syncService, SYNC_STATUS } =
        await import("~/lib/integrations/services/SyncService");
      const { integrationManager } =
        await import("~/lib/integrations/IntegrationManager");

      const externalId = `${STAMP}-late-1`;
      const searchIssues = vi.fn().mockResolvedValueOnce({
        issues: [makeIssueData({ id: externalId })],
        total: 1,
        hasMore: false,
      });
      vi.spyOn(integrationManager, "getAdapter").mockResolvedValueOnce({
        searchIssues,
        getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
      } as any);

      const db2 = createRawDbClient();
      await assertScratchDatabase(db2, "late cancel write");

      // Races a late cancel request in right before the run's OWN terminal
      // write executes -- a deterministic injection point, not a
      // wall-clock guess (see wrapDbForLateCancelHook) -- proving the run's
      // terminal write always reflects what its own loop already decided,
      // never a value that landed in the row after that decision was made.
      const wrappedDb = wrapDbForLateCancelHook(db, async () => {
        await db2.integrationProject.update({
          where: { id: mappingId },
          data: { syncStatus: SYNC_STATUS.cancelRequested },
        });
      });

      const result = await syncService.performProjectImport(
        integrationId,
        mappingId,
        { pagedToCompletion: true },
        undefined,
        { dbClient: wrappedDb }
      );
      await db2.$disconnect();

      expect(result.cancelled).toBe(false);

      // Fresh read through the un-wrapped client -- confirms the row's
      // final state, not merely what the wrapped client's own calls saw.
      const mappingRow = await db.integrationProject.findUnique({
        where: { id: mappingId },
        select: { syncStatus: true },
      });
      expect(mappingRow?.syncStatus).toBe(SYNC_STATUS.completed);
      expect(mappingRow?.syncStatus).not.toBe(SYNC_STATUS.cancelled);

      const importedRow = await db.issue.findFirst({
        where: { externalId, integrationId },
        select: { id: true },
      });
      expect(importedRow).not.toBeNull();
      if (importedRow) allIssueIds.push(importedRow.id);
    });
  });
});
