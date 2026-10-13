import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────
// These refs persist across vi.resetModules() calls

const { mockRedisGet, mockRedisDel, mockUpdateProgress } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockUpdateProgress: vi.fn(),
}));

const mockRedisClient = {
  get: (...args: any[]) => mockRedisGet(...args),
  del: (...args: any[]) => mockRedisDel(...args),
};

// ─── Mock bullmq Worker to provide a mock Redis client ───────────────────────

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      client = Promise.resolve(mockRedisClient);
      on = vi.fn();
      close = vi.fn();
      constructor() {}
    },
  };
});

// Provide a truthy valkey connection so startWorker() creates the Worker instance
vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock queue name ──────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  COPY_MOVE_QUEUE_NAME: "test-copy-move-queue",
}));

// ─── Mock db ──────────────────────────────────────────────────────────────

const mockTx = {
  // Phase 13 CTX-02 — the worker stamps app.audit_context via tx.$executeRaw
  // as the first statement inside the per-case transaction; stub it so the
  // copy/move flow runs without a real connection.
  $executeRaw: vi.fn().mockResolvedValue(0),
  repositoryCases: {
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  steps: { create: vi.fn() },
  caseFieldValues: { create: vi.fn() },
  attachments: { create: vi.fn() },
  // Tags/issues are now EXPLICIT join models — the worker writes to them
  // via createMany({ data: [{ caseId, tagId }] }) instead of the old
  // repositoryCases.update({ data: { tags: { connect } } }) implicit m2m.
  repositoryCaseTag: {
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  repositoryCaseIssue: {
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  sharedStepGroup: { findFirst: vi.fn(), create: vi.fn() },
  // Same-project relocation reparents/merges folders inside its transaction.
  repositoryFolders: { update: vi.fn(), updateMany: vi.fn() },
  repositoryCaseVersions: { create: vi.fn(), findMany: vi.fn() },
  comment: { create: vi.fn() },
  repositoryCaseLink: { create: vi.fn() },
  // resolveCreateStateRemap short-circuit: feature disabled returns candidate unchanged.
  appConfig: { findUnique: vi.fn().mockResolvedValue({ value: false }) },
  projects: { findUnique: vi.fn() },
  workflows: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
};

const mockDb = {
  repositoryCases: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  repositoryCaseVersions: { findMany: vi.fn() },
  repositoryFolders: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  templateCaseAssignment: { findMany: vi.fn() },
  caseFieldAssignment: { findMany: vi.fn() },
  // Worker pre-fetches target project's assigned templates so source
  // templates can be preserved per case when still assigned. Default to
  // empty so existing tests fall through to job.data.targetTemplateId.
  templateProjectAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  // Worker pre-fetches the target project's CASES workflow states to keep
  // each case's status. Default to empty so existing tests fall through to
  // job.data.targetDefaultWorkflowStateId.
  projectWorkflowAssignment: { findMany: vi.fn().mockResolvedValue([]) },
  workflows: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
  // resolveCreateStateRemap short-circuit: feature disabled returns candidate unchanged.
  appConfig: { findUnique: vi.fn().mockResolvedValue({ value: false }) },
  projects: { findUnique: vi.fn() },
  $transaction: vi.fn((fn: Function) => fn(mockTx)),
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  getCurrentTenantId: vi.fn(() => undefined),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock ES sync ─────────────────────────────────────────────────────────────

const mockSyncToES = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: (...args: any[]) => mockSyncToES(...args),
}));

// ─── Mock version service ─────────────────────────────────────────────────────

const mockCreateVersion = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: (...args: any[]) =>
    mockCreateVersion(...args),
}));

// ─── Mock audit log ───────────────────────────────────────────────────────────

const mockCaptureAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));

// ─── Mock review cancellation ─────────────────────────────────────────────────
// A move soft-deletes its source cases on the raw (plugin-free) client, so
// sideEffectsPlugin's cancel hook never fires — the worker calls these
// directly instead. Default to "nothing was in flight".

const mockCancelReviewsForDeletedEntities = vi.fn().mockResolvedValue([]);
const mockAnnounceDeletionCancelledReviews = vi
  .fn()
  .mockResolvedValue(undefined);
vi.mock("../lib/services/reviewCancellation", () => ({
  cancelReviewsForDeletedEntities: (...args: any[]) =>
    mockCancelReviewsForDeletedEntities(...args),
  announceDeletionCancelledReviews: (...args: any[]) =>
    mockAnnounceDeletionCancelledReviews(...args),
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

const baseCopyJobData = {
  operation: "copy" as const,
  caseIds: [1],
  sourceProjectId: 10,
  targetProjectId: 20,
  targetRepositoryId: 200,
  targetFolderId: 2000,
  conflictResolution: "skip" as const,
  sharedStepGroupResolution: "reuse" as const,
  userId: "user-1",
  targetTemplateId: 50,
  targetDefaultWorkflowStateId: 100,
};

const mockSourceCase = {
  id: 1,
  name: "Test Case 1",
  templateId: 30,
  className: null,
  source: null,
  folderId: 1000,
  automated: false,
  estimate: null,
  creatorId: "user-1",
  steps: [
    {
      id: 10,
      step: "Step 1 text",
      expectedResult: "Expected 1",
      order: 0,
      isDeleted: false,
      sharedStepGroupId: null,
      sharedStepGroup: null,
    },
  ],
  caseFieldValues: [
    {
      id: 100,
      fieldId: 5,
      value: 500,
      repositoryCaseId: 1,
    },
  ],
  caseTags: [{ tag: { id: 50 } }],
  caseIssues: [{ issue: { id: 60 } }],
  attachments: [
    {
      id: 70,
      url: "https://s3.example.com/file.png",
      name: "file.png",
      note: null,
      size: 1024,
      mimeType: "image/png",
      isDeleted: false,
      createdById: "user-1",
    },
  ],
  comments: [],
};

const mockSourceCaseWithSharedSteps = {
  ...mockSourceCase,
  steps: [
    {
      id: 11,
      step: "Open login",
      expectedResult: "Page loads",
      order: 0,
      isDeleted: false,
      sharedStepGroupId: 99,
      sharedStepGroup: {
        id: 99,
        name: "Login Steps",
        items: [
          {
            step: "Open login",
            expectedResult: "Page loads",
            order: 0,
          },
        ],
      },
    },
  ],
};

// Source template fields with Dropdown type
const _mockSourceTemplateFields = [
  {
    caseFieldId: 5,
    fieldType: "Dropdown",
    systemName: "priority",
    fieldOptions: [{ optionId: 500, optionName: "High" }],
  },
];

// Target template fields with same systemName but different option IDs
const _mockTargetTemplateFields = [
  {
    caseFieldId: 7,
    fieldType: "Dropdown",
    systemName: "priority",
    fieldOptions: [{ optionId: 600, optionName: "High" }],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadWorker() {
  const mod = await import("./copyMoveWorker");
  await mod.startWorker();
  return mod;
}

type JobData = Omit<
  typeof baseCopyJobData,
  "operation" | "sharedStepGroupResolution" | "conflictResolution"
> & {
  operation: "copy" | "move";
  sharedStepGroupResolution: "reuse" | "create_new";
  conflictResolution: "skip" | "rename";
  folderTree?: Array<{
    localKey: string;
    sourceFolderId: number;
    name: string;
    parentLocalKey: string | null;
    caseIds: number[];
  }>;
};

function makeMockJob(
  overrides: Partial<{
    id: string;
    data: JobData;
  }> = {}
): unknown {
  return {
    id: "job-1",
    name: "copy-move",
    data: baseCopyJobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopyMoveWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: no cancellation
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockUpdateProgress.mockResolvedValue(undefined);

    // No existing cases in target folder (maxOrder = null)
    mockDb.repositoryCases.findFirst.mockResolvedValue(null);
    mockDb.repositoryCases.update.mockResolvedValue({});

    // Source cases default
    mockDb.repositoryCases.findMany.mockResolvedValue([mockSourceCase]);

    // No template field assignments by default (override in tests that need them)
    mockDb.templateCaseAssignment.findMany.mockResolvedValue([]);
    mockDb.caseFieldAssignment.findMany.mockResolvedValue([]);

    // Reset $transaction so it uses the default fn(mockTx) behavior after rollback tests
    mockDb.$transaction.mockReset();
    mockDb.$transaction.mockImplementation((fn: Function) => fn(mockTx));

    // Folder mocks: no existing folders by default
    mockDb.repositoryFolders.findFirst.mockResolvedValue(null);
    mockDb.repositoryFolders.create.mockResolvedValue({ id: 5000 });
    mockDb.repositoryFolders.updateMany.mockResolvedValue({ count: 0 });

    // Transaction: create returns a new case with id 1001. The copy/move
    // flow always creates a fresh case (it never resurrects a tombstone).
    mockTx.repositoryCases.create.mockResolvedValue({ id: 1001 });
    mockTx.repositoryCases.update.mockResolvedValue({});

    // Explicit-join tag/issue writes resolve successfully by default
    mockTx.repositoryCaseTag.createMany.mockResolvedValue({ count: 1 });
    mockTx.repositoryCaseIssue.createMany.mockResolvedValue({ count: 1 });

    // Shared step group: no existing group by default
    mockTx.sharedStepGroup.findFirst.mockResolvedValue(null);
    mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

    // Version history: empty by default
    mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

    // Audit + provenance link mock resets
    mockCaptureAuditEvent.mockClear();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
    mockTx.repositoryCaseLink.create.mockClear();
    mockTx.repositoryCaseLink.create.mockResolvedValue({ id: 9001 });
  });

  // ─── Helper: set up template field mocks for field value resolution ───────

  function setupTemplateFieldMocks() {
    // templateCaseAssignment.findMany returns assignments for source template (id 30)
    // and for target template (id 50)
    mockDb.templateCaseAssignment.findMany.mockImplementation((args: any) => {
      const templateId = args?.where?.templateId;
      if (templateId === 30) {
        // source template
        return Promise.resolve([
          {
            caseField: {
              id: 5,
              systemName: "priority",
              type: { type: "Dropdown" },
            },
          },
        ]);
      } else if (templateId === 50) {
        // target template
        return Promise.resolve([
          {
            caseField: {
              id: 7,
              systemName: "priority",
              type: { type: "Dropdown" },
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    // caseFieldAssignment.findMany returns option assignments
    mockDb.caseFieldAssignment.findMany.mockImplementation((args: any) => {
      const caseFieldId = args?.where?.caseFieldId;
      if (caseFieldId === 5) {
        // source field options
        return Promise.resolve([
          {
            fieldOption: { id: 500, name: "High", isDeleted: false },
          },
        ]);
      } else if (caseFieldId === 7) {
        // target field options
        return Promise.resolve([
          {
            fieldOption: { id: 600, name: "High", isDeleted: false },
          },
        ]);
      }
      return Promise.resolve([]);
    });
  }

  // ─── Copy operation ───────────────────────────────────────────────────────

  describe("copy operation", () => {
    it("DATA-01: should create steps in target case", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.steps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testCaseId: 1001,
            step: "Step 1 text",
            expectedResult: "Expected 1",
            order: 0,
          }),
        })
      );
    });

    it("DATA-02: should create field values with resolved option IDs", async () => {
      setupTemplateFieldMocks();

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      // Should create with the TARGET option ID (600), not source (500)
      expect(mockTx.caseFieldValues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testCaseId: 1001,
            fieldId: 5,
            value: 600,
          }),
        })
      );
    });

    it("DATA-02: should drop field value when option cannot be resolved in target", async () => {
      // Target template has no matching option name
      mockDb.templateCaseAssignment.findMany.mockImplementation((args: any) => {
        const templateId = args?.where?.templateId;
        if (templateId === 30) {
          return Promise.resolve([
            {
              caseField: {
                id: 5,
                systemName: "priority",
                type: { type: "Dropdown" },
              },
            },
          ]);
        } else if (templateId === 50) {
          return Promise.resolve([
            {
              caseField: {
                id: 7,
                systemName: "priority",
                type: { type: "Dropdown" },
              },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      mockDb.caseFieldAssignment.findMany.mockImplementation((args: any) => {
        const caseFieldId = args?.where?.caseFieldId;
        if (caseFieldId === 5) {
          return Promise.resolve([
            { fieldOption: { id: 500, name: "High", isDeleted: false } },
          ]);
        } else if (caseFieldId === 7) {
          // Target has different option name — no match for "High"
          return Promise.resolve([
            { fieldOption: { id: 700, name: "Critical", isDeleted: false } },
          ]);
        }
        return Promise.resolve([]);
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      // caseFieldValues.create should NOT be called since there's no match
      expect(mockTx.caseFieldValues.create).not.toHaveBeenCalled();
    });

    it("DATA-03: should connect tags by ID", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCaseTag.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ caseId: 1001, tagId: 50 }],
        })
      );
    });

    it("DATA-04: should connect issues by ID", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCaseIssue.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ caseId: 1001, issueId: 60 }],
        })
      );
    });

    it("DATA-05: should create attachment rows with same S3 URL", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.attachments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testCaseId: 1001,
            url: "https://s3.example.com/file.png",
          }),
        })
      );
    });

    it("DATA-07: should create version 1 for copied case", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockCreateVersion).toHaveBeenCalledWith(
        mockTx,
        1001,
        expect.objectContaining({ version: 1 })
      );

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1001 },
          data: expect.objectContaining({ currentVersion: 1 }),
        })
      );
    });

    it("REPEAT-COPY-01: same case copied twice with rename creates distinct cases, no version collision", async () => {
      // Faithful reproduction of the production failure: copy a case into the
      // same project/folder, delete the resulting "(copy)", then copy again.
      // The name search must skip the tombstoned "(copy)" name and create a
      // brand-new "(copy 2)" case — never reusing the tombstone (whose
      // version-1 row still exists), which would 23505 on
      // RepositoryCaseVersions_repositoryCaseId_version_key.
      const store: { id: number; name: string; isDeleted: boolean }[] = [
        { id: 1, name: "Test Case 1", isDeleted: false },
      ];
      let nextId = 8613;

      // db.repositoryCases.findFirst serves three probes:
      //  - folderMaxOrder (where.folderId) → null
      //  - existingCase live-conflict probe (where.isDeleted === false)
      //  - nameIsTaken probe (no isDeleted key → live OR tombstoned both block)
      mockDb.repositoryCases.findFirst.mockImplementation(async (args: any) => {
        const where = args?.where ?? {};
        if (where.folderId !== undefined) return null;
        const match = store.find((c) => {
          if (c.name !== where.name) return false;
          if (where.isDeleted === false) return c.isDeleted === false;
          return true; // nameIsTaken: any live OR tombstoned row blocks
        });
        return match ? { id: match.id } : null;
      });

      mockTx.repositoryCases.create.mockImplementation(async (args: any) => {
        const row = { id: nextId++, name: args.data.name, isDeleted: false };
        store.push(row);
        return { id: row.id };
      });

      const renameJob = makeMockJob({
        data: { ...baseCopyJobData, conflictResolution: "rename" as const },
      });

      const { processor } = await loadWorker();

      // First copy → fresh "Test Case 1 (copy)".
      await processor(renameJob as Job);
      const firstCopy = store.find((c) => c.name === "Test Case 1 (copy)");
      expect(firstCopy).toBeDefined();
      expect(mockCreateVersion).toHaveBeenCalledWith(
        mockTx,
        firstCopy!.id,
        expect.objectContaining({ version: 1 })
      );

      // User soft-deletes the first copy; its version-1 row remains.
      firstCopy!.isDeleted = true;
      mockCreateVersion.mockClear();
      mockTx.repositoryCases.update.mockClear();

      // Second copy → must skip the tombstoned "(copy)" → fresh "(copy 2)".
      await processor(renameJob as Job);

      const secondCopy = store.find((c) => c.name === "Test Case 1 (copy 2)");
      expect(secondCopy).toBeDefined();
      expect(secondCopy!.id).not.toBe(firstCopy!.id);

      // The tombstone must NOT be touched (no update reviving its id).
      expect(mockTx.repositoryCases.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: firstCopy!.id } })
      );

      // Fresh case → version 1, no (repositoryCaseId, version) collision.
      expect(mockCreateVersion).toHaveBeenCalledWith(
        mockTx,
        secondCopy!.id,
        expect.objectContaining({ version: 1 })
      );
    });

    it("REPEAT-COPY-02: copy whose name matches only a tombstone creates a fresh, distinct case (never resurrects)", async () => {
      // A copy (here with the default "skip" resolution) whose name collides
      // ONLY with a soft-deleted case — no live duplicate — must still create
      // a brand-new case under a disambiguated name, NOT reuse the tombstone's
      // id. The tombstone's stale version-1 row stays untouched, so version 1
      // is free on the new case.
      mockDb.repositoryCases.findFirst.mockImplementation(async (args: any) => {
        const where = args?.where ?? {};
        if (where.folderId !== undefined) return null; // folderMaxOrder
        // Live-conflict probe (isDeleted:false): no live duplicate exists.
        if (where.isDeleted === false) return null;
        // nameIsTaken probe: the original name is held by a tombstone (id
        // 8613); the disambiguated "(copy)" name is free.
        if (where.name === "Test Case 1") return { id: 8613 };
        return null;
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job); // baseCopyJobData = copy + skip

      // Created fresh (id 1001 from the default create mock), under the
      // disambiguated name — the tombstone id 8613 is never reused.
      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Test Case 1 (copy)" }),
        })
      );
      expect(mockTx.repositoryCases.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8613 } })
      );
      expect(mockCreateVersion).toHaveBeenCalledWith(
        mockTx,
        1001,
        expect.objectContaining({ version: 1 })
      );
    });

    it("should report progress via job.updateProgress", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockUpdateProgress).toHaveBeenCalledWith(
        expect.objectContaining({ processed: 1, total: 1 })
      );
    });

    it("should call ES sync after case loop", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockSyncToES).toHaveBeenCalledWith(1001, undefined, mockDb);
    });

    it("should NOT copy comments on copy operation", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.comment.create).not.toHaveBeenCalled();
    });

    it("should carry non-dropdown field values as-is", async () => {
      const textFieldCase = {
        ...mockSourceCase,
        caseFieldValues: [
          {
            id: 101,
            fieldId: 8,
            value: "hello",
            repositoryCaseId: 1,
          },
        ],
      };

      mockDb.repositoryCases.findMany.mockResolvedValue([textFieldCase]);

      // Source template has a text field
      mockDb.templateCaseAssignment.findMany.mockImplementation((args: any) => {
        const templateId = args?.where?.templateId;
        if (templateId === 30) {
          return Promise.resolve([
            {
              caseField: {
                id: 8,
                systemName: "notes",
                type: { type: "Text" },
              },
            },
          ]);
        } else if (templateId === 50) {
          return Promise.resolve([
            {
              caseField: {
                id: 9,
                systemName: "notes",
                type: { type: "Text" },
              },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      // Value "hello" should be carried as-is
      expect(mockTx.caseFieldValues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testCaseId: 1001,
            fieldId: 8,
            value: "hello",
          }),
        })
      );
    });
  });

  // ─── Move operation ───────────────────────────────────────────────────────

  describe("move operation", () => {
    const baseMoveJobData = {
      ...baseCopyJobData,
      operation: "move" as const,
    };

    const mockSourceVersions = [
      {
        id: 1,
        version: 1,
        repositoryCaseId: 1,
        projectId: 10,
        repositoryId: 100,
        folderId: 1000,
        staticProjectId: 10,
        staticProjectName: "Source Project",
        folderName: "Root",
        templateId: 30,
        templateName: "Default",
        name: "Test Case 1",
        stateId: 5,
        stateName: "Draft",
        estimate: null,
        forecastManual: null,
        forecastAutomated: null,
        order: 0,
        createdAt: new Date("2024-01-01"),
        creatorId: "user-1",
        creatorName: "User One",
        automated: false,
        isArchived: false,
        isDeleted: false,
        steps: [],
        tags: [],
        issues: [],
        links: [],
        attachments: [],
      },
      {
        id: 2,
        version: 2,
        repositoryCaseId: 1,
        projectId: 10,
        repositoryId: 100,
        folderId: 1000,
        staticProjectId: 10,
        staticProjectName: "Source Project",
        folderName: "Root",
        templateId: 30,
        templateName: "Default",
        name: "Test Case 1 v2",
        stateId: 5,
        stateName: "Active",
        estimate: null,
        forecastManual: null,
        forecastAutomated: null,
        order: 0,
        createdAt: new Date("2024-02-01"),
        creatorId: "user-1",
        creatorName: "User One",
        automated: false,
        isArchived: false,
        isDeleted: false,
        steps: [],
        tags: [],
        issues: [],
        links: [],
        attachments: [],
      },
      {
        id: 3,
        version: 3,
        repositoryCaseId: 1,
        projectId: 10,
        repositoryId: 100,
        folderId: 1000,
        staticProjectId: 10,
        staticProjectName: "Source Project",
        folderName: "Root",
        templateId: 30,
        templateName: "Default",
        name: "Test Case 1 v3",
        stateId: 5,
        stateName: "Active",
        estimate: null,
        forecastManual: null,
        forecastAutomated: null,
        order: 0,
        createdAt: new Date("2024-03-01"),
        creatorId: "user-1",
        creatorName: "User One",
        automated: false,
        isArchived: false,
        isDeleted: false,
        steps: [],
        tags: [],
        issues: [],
        links: [],
        attachments: [],
      },
    ];

    beforeEach(() => {
      mockDb.repositoryCaseVersions.findMany.mockResolvedValue(
        mockSourceVersions
      );
    });

    it("DATA-06: should recreate all version rows with target projectId", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-1", data: baseMoveJobData }) as Job
      );

      // Should have created 3 version rows
      expect(mockTx.repositoryCaseVersions.create).toHaveBeenCalledTimes(3);

      // All should have repositoryCaseId = 1001 and projectId = 20 (target)
      const calls = mockTx.repositoryCaseVersions.create.mock.calls;
      for (const call of calls) {
        expect(call[0].data.repositoryCaseId).toBe(1001);
        expect(call[0].data.projectId).toBe(20);
      }

      // currentVersion should be set to 3 (last version)
      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1001 },
          data: expect.objectContaining({ currentVersion: 3 }),
        })
      );
    });

    it("DATA-06: should preserve staticProjectId and staticProjectName in moved versions", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-2", data: baseMoveJobData }) as Job
      );

      const calls = mockTx.repositoryCaseVersions.create.mock.calls;
      // All versions should preserve original staticProjectId and staticProjectName
      for (const call of calls) {
        expect(call[0].data.staticProjectId).toBe(10);
        expect(call[0].data.staticProjectName).toBe("Source Project");
      }
    });

    it("should copy comments on move operation", async () => {
      const sourceCaseWithComments = {
        ...mockSourceCase,
        comments: [
          {
            id: 1,
            content: "This is a comment",
            creatorId: "user-2",
            createdAt: new Date("2024-01-15"),
            isEdited: false,
            projectId: 10,
          },
        ],
      };
      mockDb.repositoryCases.findMany.mockResolvedValue([
        sourceCaseWithComments,
      ]);

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-3", data: baseMoveJobData }) as Job
      );

      expect(mockTx.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "This is a comment",
            repositoryCaseId: 1001,
            projectId: 20,
            creatorId: "user-2",
          }),
        })
      );
    });

    it("should soft-delete source cases only after all copies succeed", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockDb.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      // Return different IDs for each transaction call
      let callCount = 0;
      mockTx.repositoryCases.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: callCount === 1 ? 1001 : 1002 });
      });

      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const moveJobData = {
        ...baseMoveJobData,
        caseIds: [1, 2],
      };

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-4", data: moveJobData }) as Job
      );

      // Source soft-delete should be called AFTER all transactions complete
      expect(mockDb.repositoryCases.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { isDeleted: true },
      });

      // Ensure it's called only once (after all copies, not per case)
      expect(mockDb.repositoryCases.updateMany).toHaveBeenCalledTimes(1);
    });

    it("DATA-LOSS-01: should NOT soft-delete source cases when all are skipped (real collision + skip)", async () => {
      // Regression guard: when every case is skipped, the unconditional
      // updateMany used to fire and silently soft-delete the originals.
      // The fix gates soft-delete on createdTargetIds. Note: a same-project
      // move no longer self-collides (see SELF-COLLISION-01), so to actually
      // exercise the "all skipped" branch the collision has to be a real
      // non-source case with the same name.
      const skipMoveJobData = {
        ...baseMoveJobData,
        caseIds: [1],
        conflictResolution: "skip" as const,
      };

      // First findFirst = max-order pre-fetch → null.
      // Second findFirst = collision check → unrelated case with same name.
      mockDb.repositoryCases.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 9999 });

      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ data: skipMoveJobData }) as Job
      );

      // Every case was skipped — source should NOT be soft-deleted
      expect(mockDb.repositoryCases.updateMany).not.toHaveBeenCalled();
      expect(result.skippedCount).toBe(1);
      expect(result.copiedCount).toBe(0);
      expect(result.movedCount).toBe(0);
    });

    it("cancels reviews left in flight on the moved-away source cases", async () => {
      // The move soft-deletes the sources through the raw, plugin-free client
      // (getDbClientForJob -> rawDb), so sideEffectsPlugin's soft-delete hook
      // never runs. Without this explicit call the reviews stay PENDING
      // against rows the inbox hides and the assignee is reminded daily for
      // work they cannot open.
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-rev", data: baseMoveJobData }) as Job
      );

      expect(mockCancelReviewsForDeletedEntities).toHaveBeenCalledTimes(1);
      const [, entityType, ids] =
        mockCancelReviewsForDeletedEntities.mock.calls[0];
      expect(entityType).toBe("CASE");
      expect(ids).toEqual([1]);
    });

    it("announces cancelled reviews with the source case names", async () => {
      mockCancelReviewsForDeletedEntities.mockResolvedValueOnce([
        { id: "rr-1", entityId: 1, projectId: 10 },
      ]);

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-rev2", data: baseMoveJobData }) as Job
      );

      expect(mockAnnounceDeletionCancelledReviews).toHaveBeenCalledTimes(1);
      const [cancelled, names] =
        mockAnnounceDeletionCancelledReviews.mock.calls[0];
      expect(cancelled).toHaveLength(1);
      // Names come off the pre-fetched source rows — by announcement time the
      // subjects are already soft-deleted.
      expect(names.get(1)).toBe("Test Case 1");
    });

    it("does not cancel reviews when nothing was actually moved", async () => {
      const skipMoveJobData = {
        ...baseMoveJobData,
        caseIds: [1],
        conflictResolution: "skip" as const,
      };
      mockDb.repositoryCases.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 9999 });
      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ data: skipMoveJobData }) as Job);

      expect(mockCancelReviewsForDeletedEntities).not.toHaveBeenCalled();
    });

    it("completes the move when review cancellation fails", async () => {
      // Best-effort: a failure here must not strand a half-finished move.
      mockCancelReviewsForDeletedEntities.mockRejectedValueOnce(
        new Error("reviewRequest table unavailable")
      );

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-move-rev3", data: baseMoveJobData }) as Job
      );

      expect(result.movedCount).toBe(1);
      expect(result.copiedCount).toBe(0);
      // The sources are still soft-deleted — the move itself is unaffected.
      expect(mockDb.repositoryCases.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { isDeleted: true },
      });
    });

    it("should set movedCount equal to copiedCount on successful move", async () => {
      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ id: "job-move-5", data: baseMoveJobData }) as Job
      );

      expect(result.movedCount).toBe(1);
      expect(result.copiedCount).toBe(0);
    });
  });

  // ─── Same-project move: relocation ────────────────────────────────────────

  describe("same-project move (relocation)", () => {
    const relocateJobData = {
      ...baseCopyJobData,
      operation: "move" as const,
      sourceProjectId: 20,
      targetProjectId: 20,
      caseIds: [1],
    };

    beforeEach(() => {
      // Target folder lookup — the folder, not the job payload, is the
      // authority on the repository the moved rows land in.
      mockDb.repositoryFolders.findFirst.mockResolvedValue({
        id: 2000,
        repositoryId: 200,
      });
      mockDb.repositoryFolders.findMany.mockResolvedValue([]);
    });

    it("RELOCATE-01: updates only the row's location — no create, no collision check, no soft-delete", async () => {
      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ data: relocateJobData }) as Job
      );

      // No collision lookup at all — a case cannot conflict with itself.
      const collisionCalls = mockDb.repositoryCases.findFirst.mock.calls.filter(
        (c: any[]) => c[0]?.where?.name !== undefined
      );
      expect(collisionCalls).toHaveLength(0);

      expect(mockTx.repositoryCases.create).not.toHaveBeenCalled();
      const relocateCall = mockTx.repositoryCases.update.mock.calls.find(
        (c: any[]) => c[0]?.where?.id === 1
      );
      // Only the location moves — the case keeps its state, template, name
      // and everything else it was authored with, and the repository comes
      // from the target folder row.
      expect(Object.keys(relocateCall![0].data).sort()).toEqual([
        "folderId",
        "order",
        "repositoryId",
      ]);
      expect(relocateCall![0].data.repositoryId).toBe(200);

      // The row is still live under the same id — nothing to soft-delete.
      expect(mockDb.repositoryCases.updateMany).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
    });

    it("RELOCATE-02: rename conflict resolution never renames a relocation", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: { ...relocateJobData, conflictResolution: "rename" as const },
        }) as Job
      );

      const relocateCall = mockTx.repositoryCases.update.mock.calls.find(
        (c: any[]) => c[0]?.where?.id === 1
      );
      expect(relocateCall).toBeDefined();
      expect(relocateCall?.[0]?.data?.name).toBeUndefined();
      expect(mockTx.repositoryCases.create).not.toHaveBeenCalled();
    });

    it("RELOCATE-03: a case already in the target folder is a no-op", async () => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        { ...mockSourceCase, folderId: 2000 },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ data: relocateJobData }) as Job
      );

      expect(mockTx.repositoryCases.update).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(1);
    });

    it("RELOCATE-04: folder-tree move reparents the folder; its cases ride along untouched", async () => {
      mockDb.repositoryFolders.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: 2000, repositoryId: 200 }) // target folder
        .mockResolvedValueOnce(null) // same-named sibling under target
        .mockResolvedValueOnce(null); // max folder order under target
      mockDb.repositoryFolders.findMany.mockResolvedValue([
        { id: 3000, parentId: 999, name: "Sub" },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({
          data: {
            ...relocateJobData,
            folderTree: [
              {
                localKey: "3000",
                sourceFolderId: 3000,
                name: "Sub",
                parentLocalKey: null,
                caseIds: [1],
              },
            ],
          },
        }) as Job
      );

      expect(mockTx.repositoryFolders.update).toHaveBeenCalledWith({
        where: { id: 3000 },
        data: { parentId: 2000, repositoryId: 200, order: 0 },
      });
      // The subtree and its cases ride along with the reparented folder.
      expect(mockTx.repositoryCases.update).not.toHaveBeenCalled();
      // The folder survives — nothing was recreated, so nothing is deleted.
      expect(mockTx.repositoryFolders.updateMany).not.toHaveBeenCalled();
      expect(mockDb.repositoryFolders.updateMany).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(1);
    });

    it("RELOCATE-05: folder-tree move merges into an existing same-named folder and soft-deletes the emptied source", async () => {
      mockDb.repositoryFolders.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: 2000, repositoryId: 200 }) // target folder
        .mockResolvedValueOnce({ id: 4000 }); // same-named sibling -> merge
      mockDb.repositoryFolders.findMany.mockResolvedValue([
        { id: 3000, parentId: 999, name: "Sub" },
      ]);

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...relocateJobData,
            folderTree: [
              {
                localKey: "3000",
                sourceFolderId: 3000,
                name: "Sub",
                parentLocalKey: null,
                caseIds: [1],
              },
            ],
          },
        }) as Job
      );

      // Direct cases move into the surviving sibling...
      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { folderId: 4000, repositoryId: 200, order: 0 },
      });
      // ...and the emptied source folder is soft-deleted; the sibling stays.
      expect(mockTx.repositoryFolders.update).not.toHaveBeenCalled();
      expect(mockTx.repositoryFolders.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [3000] } },
        data: { isDeleted: true },
      });
    });

    it("RELOCATE-06: moving a folder that already lives under the target parent changes nothing", async () => {
      // Regression guard: the old recreate-and-delete flow "merged" the
      // folder with itself and then soft-deleted it, orphaning its live
      // cases from the tree.
      mockDb.repositoryFolders.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: 2000, repositoryId: 200 }); // target folder
      mockDb.repositoryFolders.findMany.mockResolvedValue([
        { id: 3000, parentId: 2000, name: "Sub" },
      ]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({
          data: {
            ...relocateJobData,
            folderTree: [
              {
                localKey: "3000",
                sourceFolderId: 3000,
                name: "Sub",
                parentLocalKey: null,
                caseIds: [1],
              },
            ],
          },
        }) as Job
      );

      expect(mockTx.repositoryCases.update).not.toHaveBeenCalled();
      expect(mockTx.repositoryFolders.update).not.toHaveBeenCalled();
      expect(mockTx.repositoryFolders.updateMany).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(1);
    });

    it("RELOCATE-07: rejects moving a folder into its own subtree", async () => {
      const { processor } = await loadWorker();
      await expect(
        processor(
          makeMockJob({
            data: {
              ...relocateJobData,
              folderTree: [
                {
                  localKey: "2000",
                  sourceFolderId: 2000,
                  name: "Self",
                  parentLocalKey: null,
                  caseIds: [1],
                },
              ],
            },
          }) as Job
        )
      ).rejects.toThrow("Cannot move a folder into itself or its own subtree");
    });

    it("RELOCATE-08: a failed relocation is atomic — no partial state, no rollback deletes", async () => {
      mockDb.$transaction.mockRejectedValue(new Error("relocation failed"));

      const { processor } = await loadWorker();
      await expect(
        processor(makeMockJob({ data: relocateJobData }) as Job)
      ).rejects.toThrow("relocation failed");

      expect(mockDb.repositoryCases.deleteMany).not.toHaveBeenCalled();
      expect(mockDb.repositoryCases.updateMany).not.toHaveBeenCalled();
    });

    it("RELOCATE-09: re-syncs every moved case to ES after the transaction commits", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob({ data: relocateJobData }) as Job);

      expect(mockSyncToES).toHaveBeenCalledWith(1, undefined, mockDb);
    });
  });

  // ─── Per-case template preservation ───────────────────────────────────────

  describe("target template selection", () => {
    it("TEMPLATE-01: preserves the source case's template when it is assigned to the target project", async () => {
      // Customer-reported: moving a "Case (steps)" case landed in the
      // target as "Case (exploratory)" because the worker overwrote
      // templateId with job.data.targetTemplateId (the target's first
      // assignment) regardless of what was assigned. Now we preserve the
      // source template when it is still assigned to the target.
      mockDb.templateProjectAssignment.findMany.mockResolvedValue([
        { templateId: 30 }, // source case uses templateId 30
        { templateId: 50 }, // job.data.targetTemplateId — would have been used previously
      ]);

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: 30 }),
        })
      );
    });

    it("TEMPLATE-02: falls back to job.data.targetTemplateId when the source template is not assigned to the target project", async () => {
      mockDb.templateProjectAssignment.findMany.mockResolvedValue([
        { templateId: 50 }, // only job.data.targetTemplateId is assigned
      ]);

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: 50 }),
        })
      );
    });
  });

  // ─── Shared step group handling ───────────────────────────────────────────

  describe("shared step group handling", () => {
    it("DATA-08: should recreate shared step group in target project", async () => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        mockSourceCaseWithSharedSteps,
      ]);

      // No existing group with this name in target
      mockTx.sharedStepGroup.findFirst.mockResolvedValue(null);
      mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.sharedStepGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Login Steps",
            projectId: 20,
          }),
        })
      );

      // Step should be created with the new group's ID
      expect(mockTx.steps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            testCaseId: 1001,
            sharedStepGroupId: 999,
          }),
        })
      );
    });

    it("DATA-08: should deduplicate when multiple cases share the same group", async () => {
      const case1 = { ...mockSourceCaseWithSharedSteps, id: 1 };
      const case2 = {
        ...mockSourceCaseWithSharedSteps,
        id: 2,
        caseFieldValues: [],
        caseTags: [],
        caseIssues: [],
        attachments: [],
        comments: [],
      };
      mockDb.repositoryCases.findMany.mockResolvedValue([case1, case2]);

      // No existing groups
      mockTx.sharedStepGroup.findFirst.mockResolvedValue(null);
      mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

      mockDb.$transaction.mockImplementation(async (fn: Function) => {
        return fn(mockTx);
      });

      const jobData = {
        ...baseCopyJobData,
        caseIds: [1, 2],
      };

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-dedup", data: jobData }) as Job);

      // sharedStepGroup.create should be called exactly ONCE despite two cases sharing the group
      expect(mockTx.sharedStepGroup.create).toHaveBeenCalledTimes(1);
    });

    it("DATA-09: should reuse existing group when resolution is reuse", async () => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        mockSourceCaseWithSharedSteps,
      ]);

      // Existing group found in target
      mockTx.sharedStepGroup.findFirst.mockResolvedValue({ id: 888 });

      const reuseJobData = {
        ...baseCopyJobData,
        sharedStepGroupResolution: "reuse" as const,
      };

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-reuse", data: reuseJobData }) as Job
      );

      // Should NOT create a new group
      expect(mockTx.sharedStepGroup.create).not.toHaveBeenCalled();

      // Step should reference the existing group
      expect(mockTx.steps.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sharedStepGroupId: 888,
          }),
        })
      );
    });

    it("DATA-09: should create new group with (copy) suffix when resolution is create_new", async () => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        mockSourceCaseWithSharedSteps,
      ]);

      // Existing group found in target
      mockTx.sharedStepGroup.findFirst.mockResolvedValue({ id: 888 });
      mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

      const createNewJobData = {
        ...baseCopyJobData,
        sharedStepGroupResolution: "create_new" as const,
      };

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-create-new", data: createNewJobData }) as Job
      );

      expect(mockTx.sharedStepGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Login Steps (copy)",
          }),
        })
      );
    });
  });

  // ─── Rollback on failure ──────────────────────────────────────────────────

  describe("rollback on failure", () => {
    it("should delete all created target cases when a case fails", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockDb.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const jobData = {
        ...baseCopyJobData,
        caseIds: [1, 2],
      };

      // First transaction succeeds, second fails
      let txCallCount = 0;
      mockDb.$transaction.mockImplementation(async (fn: Function) => {
        txCallCount++;
        if (txCallCount === 1) {
          mockTx.repositoryCases.create.mockResolvedValue({ id: 1001 });
          return fn(mockTx);
        }
        throw new Error("Database error on second case");
      });

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-rollback", data: jobData }) as Job)
      ).rejects.toThrow("Database error on second case");

      // Should rollback the first case that was successfully created
      expect(mockDb.repositoryCases.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1001] } },
      });
    });

    it("should not soft-delete source cases on move if any case fails", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockDb.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const moveJobData = {
        ...baseCopyJobData,
        operation: "move" as const,
        caseIds: [1, 2],
      };

      // Second transaction fails
      let txCallCount = 0;
      mockDb.$transaction.mockImplementation(async (fn: Function) => {
        txCallCount++;
        if (txCallCount === 1) {
          mockTx.repositoryCases.create.mockResolvedValue({ id: 1001 });
          return fn(mockTx);
        }
        throw new Error("Move failure");
      });

      const { processor } = await loadWorker();

      await expect(
        processor(
          makeMockJob({ id: "job-move-rollback", data: moveJobData }) as Job
        )
      ).rejects.toThrow("Move failure");

      // Source cases should NOT be soft-deleted since operation failed
      expect(mockDb.repositoryCases.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── Cancellation ─────────────────────────────────────────────────────────

  describe("cancellation", () => {
    it("should throw when pre-start cancellation key exists", async () => {
      mockRedisGet.mockResolvedValue("1"); // Cancel key exists

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-cancel-1" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      // No Prisma calls should have been made (aside from the max order check before start)
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it("should stop processing between cases when cancellation detected", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockDb.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const jobData = {
        ...baseCopyJobData,
        caseIds: [1, 2],
      };

      // Pre-start: not cancelled; after case 1: not cancelled; before case 2: cancelled
      mockRedisGet
        .mockResolvedValueOnce(null) // pre-start check
        .mockResolvedValueOnce(null) // between-case check before case 1
        .mockResolvedValueOnce("1"); // between-case check before case 2

      mockTx.repositoryCases.create.mockResolvedValue({ id: 1001 });

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-cancel-2", data: jobData }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      // Only 1 transaction should have completed (the first case)
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

      // Rollback should delete the first created case
      expect(mockDb.repositoryCases.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1001] } },
      });
    });

    it("should delete cancellation key after detecting it", async () => {
      mockRedisGet.mockResolvedValue("1");

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-cancel-3" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      expect(mockRedisDel).toHaveBeenCalledWith(
        "copy-move:cancel:job-cancel-3"
      );
    });
  });

  // ─── Field option resolution edge cases ──────────────────────────────────

  describe("field option resolution edge cases", () => {
    it("should drop field value when target template has no matching field", async () => {
      // Source has a field with systemName "custom_field"
      // Target template has no field with matching systemName
      mockDb.templateCaseAssignment.findMany.mockImplementation((args: any) => {
        const templateId = args?.where?.templateId;
        if (templateId === 30) {
          // source template has "custom_field"
          return Promise.resolve([
            {
              caseField: {
                id: 5,
                systemName: "custom_field",
                type: { type: "Dropdown" },
              },
            },
          ]);
        }
        // target template has NO "custom_field"
        return Promise.resolve([]);
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.caseFieldValues.create).not.toHaveBeenCalled();
    });
  });

  // ─── Elasticsearch sync ───────────────────────────────────────────────────

  describe("elasticsearch sync", () => {
    it("should sync all created cases to ES after loop completes", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockDb.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const jobData = {
        ...baseCopyJobData,
        caseIds: [1, 2],
      };

      let createCallCount = 0;
      mockTx.repositoryCases.create.mockImplementation(() => {
        createCallCount++;
        return Promise.resolve({ id: createCallCount === 1 ? 1001 : 1002 });
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-es-1", data: jobData }) as Job);

      // ES sync called for both created target case IDs
      expect(mockSyncToES).toHaveBeenCalledWith(1001, undefined, mockDb);
      expect(mockSyncToES).toHaveBeenCalledWith(1002, undefined, mockDb);
      expect(mockSyncToES).toHaveBeenCalledTimes(2);
    });

    it("should not fail job if ES sync fails", async () => {
      // ES sync throws
      mockSyncToES.mockRejectedValue(new Error("ES connection failed"));

      const { processor } = await loadWorker();

      // The processor should NOT throw — ES failures are non-fatal
      await expect(processor(makeMockJob() as Job)).resolves.toBeDefined();
    });
  });

  // ─── Folder tree operations ───────────────────────────────────────────────

  describe("folder tree operations", () => {
    // Sample folder tree: root folder (100) with one child (101)
    // case 1 is in folder 100, case 2 is in folder 101
    const sampleFolderTree = [
      {
        localKey: "100",
        sourceFolderId: 100,
        name: "Root Folder",
        parentLocalKey: null,
        caseIds: [1],
      },
      {
        localKey: "101",
        sourceFolderId: 101,
        name: "Child Folder",
        parentLocalKey: "100",
        caseIds: [2],
      },
    ];

    const sourceCase1 = { ...mockSourceCase, id: 1, folderId: 100 };
    const sourceCase2 = {
      ...mockSourceCase,
      id: 2,
      folderId: 101,
      caseTags: [],
      caseIssues: [],
      attachments: [],
      caseFieldValues: [],
      steps: [],
      comments: [],
    };

    const folderTreeJobData = {
      ...baseCopyJobData,
      caseIds: [1, 2],
      folderTree: sampleFolderTree,
    };

    beforeEach(() => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        sourceCase1,
        sourceCase2,
      ]);

      // Folder creation: root → id 5001, child → id 5002
      let folderCreateCount = 0;
      mockDb.repositoryFolders.create.mockImplementation(() => {
        folderCreateCount++;
        return Promise.resolve({ id: folderCreateCount === 1 ? 5001 : 5002 });
      });

      // Case creation: case 1 → 1001, case 2 → 1002
      let caseCreateCount = 0;
      mockTx.repositoryCases.create.mockImplementation(() => {
        caseCreateCount++;
        return Promise.resolve({ id: caseCreateCount === 1 ? 1001 : 1002 });
      });
    });

    it("recreates folders in target project in BFS order and places cases in corresponding folders", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-tree-1", data: folderTreeJobData }) as Job
      );

      // Root folder created with parentId = targetFolderId (2000)
      expect(mockDb.repositoryFolders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Root Folder",
            parentId: 2000,
            projectId: 20,
            repositoryId: 200,
          }),
        })
      );

      // Child folder created with parentId = 5001 (the newly created root folder ID)
      expect(mockDb.repositoryFolders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Child Folder",
            parentId: 5001,
            projectId: 20,
            repositoryId: 200,
          }),
        })
      );

      // Case 1 (folderId 100) goes into root target folder 5001
      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            folderId: 5001,
          }),
        })
      );

      // Case 2 (folderId 101) goes into child target folder 5002
      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            folderId: 5002,
          }),
        })
      );
    });

    it("merges into existing folder when a folder with the same name exists under the same parent", async () => {
      // Simulate root folder already existing in target
      mockDb.repositoryFolders.findFirst.mockImplementation((args: any) => {
        if (
          args?.where?.name === "Root Folder" &&
          args?.where?.parentId === 2000
        ) {
          return Promise.resolve({ id: 9999 }); // existing folder
        }
        return Promise.resolve(null);
      });

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-tree-merge", data: folderTreeJobData }) as Job
      );

      // Only child folder should be created; root was merged (reused existing id 9999)
      const createCalls = mockDb.repositoryFolders.create.mock.calls;
      const rootCreateCall = createCalls.find(
        (call: any[]) => call[0]?.data?.name === "Root Folder"
      );
      expect(rootCreateCall).toBeUndefined();

      // Child folder created with parentId = 9999 (the merged root folder)
      expect(mockDb.repositoryFolders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Child Folder",
            parentId: 9999,
          }),
        })
      );
    });

    it("soft-deletes source folders after all cases processed on move", async () => {
      const moveTreeJobData = {
        ...folderTreeJobData,
        operation: "move" as const,
      };

      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-tree-move", data: moveTreeJobData }) as Job
      );

      // Source folders should be soft-deleted
      expect(mockDb.repositoryFolders.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [100, 101] } },
        data: { isDeleted: true },
      });
    });

    it("version history folderId references point to the recreated target folder", async () => {
      const moveTreeJobData = {
        ...folderTreeJobData,
        operation: "move" as const,
      };

      const mockVersionForCase1 = {
        id: 10,
        version: 1,
        repositoryCaseId: 1,
        projectId: 10,
        repositoryId: 100,
        folderId: 100,
        staticProjectId: 10,
        staticProjectName: "Source",
        folderName: "Root Folder",
        templateId: 30,
        templateName: "Default",
        name: "Test Case 1",
        stateId: 5,
        stateName: "Draft",
        estimate: null,
        forecastManual: null,
        forecastAutomated: null,
        order: 0,
        createdAt: new Date("2024-01-01"),
        creatorId: "user-1",
        creatorName: "User One",
        automated: false,
        isArchived: false,
        isDeleted: false,
        steps: [],
        tags: [],
        issues: [],
        links: [],
        attachments: [],
      };

      mockDb.repositoryCaseVersions.findMany.mockImplementation((args: any) => {
        if (args?.where?.repositoryCaseId === 1)
          return Promise.resolve([mockVersionForCase1]);
        return Promise.resolve([]);
      });

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-tree-ver", data: moveTreeJobData }) as Job
      );

      // Version row for case 1 should have folderId = 5001 (target root folder), not 2000 (flat targetFolderId)
      expect(mockTx.repositoryCaseVersions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            folderId: 5001,
          }),
        })
      );
    });

    it("when folderTree is undefined, existing flat behavior is unchanged (regression guard)", async () => {
      // Use default single source case with no folderTree
      mockDb.repositoryCases.findMany.mockResolvedValue([mockSourceCase]);

      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      // No folder creation calls should have been made
      expect(mockDb.repositoryFolders.create).not.toHaveBeenCalled();
      expect(mockDb.repositoryFolders.updateMany).not.toHaveBeenCalled();

      // Case should be created with the flat targetFolderId (2000)
      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            folderId: 2000,
          }),
        })
      );
    });
  });

  // ─── Provenance link write ────────────────────────────────────────────────

  describe("provenance link write (DUP-04)", () => {
    it("writes RepositoryCaseLink(DUPLICATED_FROM) for within-project copy", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...baseCopyJobData,
            sourceProjectId: 20,
            targetProjectId: 20,
          },
        }) as Job
      );

      expect(mockTx.repositoryCaseLink.create).toHaveBeenCalledWith({
        data: {
          caseAId: 1001,
          caseBId: 1,
          type: "DUPLICATED_FROM",
          createdById: "user-1",
        },
      });
    });

    it("does NOT write link for cross-project copy", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCaseLink.create).not.toHaveBeenCalled();
    });

    it("does NOT write link for move operation (even within-project)", async () => {
      // Same-project move takes the relocation path, which needs the target
      // folder row.
      mockDb.repositoryFolders.findFirst.mockResolvedValue({
        id: 2000,
        repositoryId: 200,
      });

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...baseCopyJobData,
            operation: "move",
            sourceProjectId: 20,
            targetProjectId: 20,
          },
        }) as Job
      );

      expect(mockTx.repositoryCaseLink.create).not.toHaveBeenCalled();
    });
  });

  // ─── DUPLICATED audit emission ────────────────────────────────────────────

  describe("DUPLICATED audit emission (DUP-10)", () => {
    it("emits captureAuditEvent({action: 'DUPLICATED'}) for within-project copy", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...baseCopyJobData,
            sourceProjectId: 20,
            targetProjectId: 20,
          },
        }) as Job
      );

      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DUPLICATED",
          entityType: "RepositoryCases",
          entityId: "1001",
          projectId: 20,
          userId: "user-1",
          metadata: expect.objectContaining({
            duplicatedFromCaseId: 1,
            sourceProjectId: 20,
            targetFolderId: 2000,
          }),
        })
      );
    });

    it("emits both CREATE and DUPLICATED audits for within-project copy (D-07)", async () => {
      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...baseCopyJobData,
            sourceProjectId: 20,
            targetProjectId: 20,
          },
        }) as Job
      );

      const actions = mockCaptureAuditEvent.mock.calls.map(
        (c: any[]) => c[0].action
      );
      expect(actions).toEqual(expect.arrayContaining(["CREATE", "DUPLICATED"]));
    });

    it("emits ONLY CREATE (no DUPLICATED) for cross-project copy", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      const actions = mockCaptureAuditEvent.mock.calls.map(
        (c: any[]) => c[0].action
      );
      expect(actions).toContain("CREATE");
      expect(actions).not.toContain("DUPLICATED");
    });
  });

  // ─── Multi-source duplication ─────────────────────────────────────────────

  describe("multi-source duplication (DUP-07)", () => {
    it("writes one link + one DUPLICATED audit per source case", async () => {
      mockDb.repositoryCases.findMany.mockResolvedValue([
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2, name: "Test Case 2" },
        { ...mockSourceCase, id: 3, name: "Test Case 3" },
      ]);

      mockTx.repositoryCases.create
        .mockResolvedValueOnce({ id: 1001 })
        .mockResolvedValueOnce({ id: 1002 })
        .mockResolvedValueOnce({ id: 1003 });

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({
          data: {
            ...baseCopyJobData,
            caseIds: [1, 2, 3],
            sourceProjectId: 20,
            targetProjectId: 20,
          },
        }) as Job
      );

      expect(mockTx.repositoryCaseLink.create).toHaveBeenCalledTimes(3);
      expect(
        mockCaptureAuditEvent.mock.calls.filter(
          (c: any[]) => c[0].action === "DUPLICATED"
        )
      ).toHaveLength(3);
    });
  });

  // ─── Transaction rollback on link-write failure ───────────────────────────

  describe("transaction rollback on link-write failure (TST-03)", () => {
    it("rolls back created cases when a subsequent link write throws", async () => {
      // Two sources: first link write succeeds; second throws — outer catch
      // then deletes the first successfully-committed target case.
      mockDb.repositoryCases.findMany.mockResolvedValue([
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2, name: "Test Case 2" },
      ]);
      mockTx.repositoryCases.create
        .mockResolvedValueOnce({ id: 1001 })
        .mockResolvedValueOnce({ id: 1002 });
      mockTx.repositoryCaseLink.create
        .mockResolvedValueOnce({ id: 9001 })
        .mockRejectedValueOnce(
          new Error("simulated unique-constraint violation")
        );

      const { processor } = await loadWorker();

      await expect(
        processor(
          makeMockJob({
            data: {
              ...baseCopyJobData,
              caseIds: [1, 2],
              sourceProjectId: 20,
              targetProjectId: 20,
            },
          }) as Job
        )
      ).rejects.toThrow();

      expect(mockDb.repositoryCases.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1001] } },
      });
    });

    it("propagates the link-write error so the per-case transaction is rejected", async () => {
      mockTx.repositoryCaseLink.create.mockRejectedValueOnce(
        new Error("simulated unique-constraint violation")
      );

      const { processor } = await loadWorker();

      await expect(
        processor(
          makeMockJob({
            data: {
              ...baseCopyJobData,
              sourceProjectId: 20,
              targetProjectId: 20,
            },
          }) as Job
        )
      ).rejects.toThrow(/simulated unique-constraint violation/);
    });
  });
});
