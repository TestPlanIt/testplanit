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
    // findFirst: the copy/move flow now probes for a soft-deleted row at
    // the target's (projectId, name, className, source) tuple before
    // creating, so it can resurrect instead of 23505ing. Default to null
    // (no soft-deleted match) so existing tests hit the create path.
    findFirst: vi.fn().mockResolvedValue(null),
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
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  repositoryCaseVersions: { findMany: vi.fn() },
  repositoryFolders: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  templateCaseAssignment: { findMany: vi.fn() },
  caseFieldAssignment: { findMany: vi.fn() },
  // Worker pre-fetches target project's assigned templates so source
  // templates can be preserved per case when still assigned. Default to
  // empty so existing tests fall through to job.data.targetTemplateId.
  templateProjectAssignment: { findMany: vi.fn().mockResolvedValue([]) },
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

    // Transaction: findFirst returns null (no soft-deleted), create
    // returns new case with id 1001.
    mockTx.repositoryCases.findFirst.mockResolvedValue(null);
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

    it("SELF-COLLISION-01: same-project move does NOT treat source as its own collision", async () => {
      // Customer-reported: moving a case within the same project showed a
      // Skip/Rename conflict because the (name, className, source) tuple
      // matched the case being moved. Fix excludes the move source IDs
      // from the collision lookup.
      const sameProjMoveJobData = {
        ...baseMoveJobData,
        sourceProjectId: 20,
        targetProjectId: 20,
        caseIds: [1],
        conflictResolution: "skip" as const,
      };

      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const { processor } = await loadWorker();
      const result = await processor(
        makeMockJob({ data: sameProjMoveJobData }) as Job
      );

      // The collision query must scope out the source case
      const collisionCall = mockDb.repositoryCases.findFirst.mock.calls[1]?.[0];
      expect(collisionCall?.where?.id).toEqual({ notIn: [1] });

      // Case is actually moved, not skipped
      expect(mockTx.repositoryCases.create).toHaveBeenCalledTimes(1);
      expect(result.movedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(mockDb.repositoryCases.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { isDeleted: true },
      });
    });

    it("SELF-COLLISION-02: same-project move + rename does NOT append (copy) suffix when no real collision exists", async () => {
      // Companion to SELF-COLLISION-01: Rename used to land "Foo (copy)"
      // because the source matched itself. Post-fix the name is preserved.
      const sameProjRenameMoveJobData = {
        ...baseMoveJobData,
        sourceProjectId: 20,
        targetProjectId: 20,
        caseIds: [1],
        conflictResolution: "rename" as const,
      };

      mockDb.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const { processor } = await loadWorker();
      await processor(makeMockJob({ data: sameProjRenameMoveJobData }) as Job);

      expect(mockTx.repositoryCases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Test Case 1" }),
        })
      );
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
