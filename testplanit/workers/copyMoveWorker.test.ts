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

// ─── Mock prisma ──────────────────────────────────────────────────────────────

const mockTx = {
  repositoryCases: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  steps: { create: vi.fn() },
  caseFieldValues: { create: vi.fn() },
  attachments: { create: vi.fn() },
  sharedStepGroup: { findFirst: vi.fn(), create: vi.fn() },
  repositoryCaseVersions: { create: vi.fn(), findMany: vi.fn() },
  comment: { create: vi.fn() },
};

const mockPrisma = {
  repositoryCases: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  repositoryCaseVersions: { findMany: vi.fn() },
  templateCaseAssignment: { findMany: vi.fn() },
  caseFieldAssignment: { findMany: vi.fn() },
  $transaction: vi.fn((fn: Function) => fn(mockTx)),
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
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
  tags: [{ id: 50 }],
  issues: [{ id: 60 }],
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
const mockSourceTemplateFields = [
  {
    caseFieldId: 5,
    fieldType: "Dropdown",
    systemName: "priority",
    fieldOptions: [{ optionId: 500, optionName: "High" }],
  },
];

// Target template fields with same systemName but different option IDs
const mockTargetTemplateFields = [
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

type JobData = Omit<typeof baseCopyJobData, "operation" | "sharedStepGroupResolution"> & {
  operation: "copy" | "move";
  sharedStepGroupResolution: "reuse" | "create_new";
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
    mockPrisma.repositoryCases.findFirst.mockResolvedValue(null);

    // Source cases default
    mockPrisma.repositoryCases.findMany.mockResolvedValue([mockSourceCase]);

    // No template field assignments by default (override in tests that need them)
    mockPrisma.templateCaseAssignment.findMany.mockResolvedValue([]);
    mockPrisma.caseFieldAssignment.findMany.mockResolvedValue([]);

    // Reset $transaction so it uses the default fn(mockTx) behavior after rollback tests
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn: Function) => fn(mockTx));

    // Transaction: create returns new case with id 1001
    mockTx.repositoryCases.create.mockResolvedValue({ id: 1001 });
    mockTx.repositoryCases.update.mockResolvedValue({});

    // Shared step group: no existing group by default
    mockTx.sharedStepGroup.findFirst.mockResolvedValue(null);
    mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

    // Version history: empty by default
    mockPrisma.repositoryCaseVersions.findMany.mockResolvedValue([]);
  });

  // ─── Helper: set up template field mocks for field value resolution ───────

  function setupTemplateFieldMocks() {
    // templateCaseAssignment.findMany returns assignments for source template (id 30)
    // and for target template (id 50)
    mockPrisma.templateCaseAssignment.findMany.mockImplementation(
      (args: any) => {
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
      }
    );

    // caseFieldAssignment.findMany returns option assignments
    mockPrisma.caseFieldAssignment.findMany.mockImplementation((args: any) => {
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
      mockPrisma.templateCaseAssignment.findMany.mockImplementation(
        (args: any) => {
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
        }
      );

      mockPrisma.caseFieldAssignment.findMany.mockImplementation((args: any) => {
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

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1001 },
          data: expect.objectContaining({
            tags: { connect: [{ id: 50 }] },
          }),
        })
      );
    });

    it("DATA-04: should connect issues by ID", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob() as Job);

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1001 },
          data: expect.objectContaining({
            issues: { connect: [{ id: 60 }] },
          }),
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

      expect(mockSyncToES).toHaveBeenCalledWith(1001);
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

      mockPrisma.repositoryCases.findMany.mockResolvedValue([textFieldCase]);

      // Source template has a text field
      mockPrisma.templateCaseAssignment.findMany.mockImplementation(
        (args: any) => {
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
        }
      );

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
      mockPrisma.repositoryCaseVersions.findMany.mockResolvedValue(
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
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
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
      mockPrisma.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      // Return different IDs for each transaction call
      let callCount = 0;
      mockTx.repositoryCases.create.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ id: callCount === 1 ? 1001 : 1002 });
      });

      mockPrisma.repositoryCaseVersions.findMany.mockResolvedValue([]);

      const moveJobData = {
        ...baseMoveJobData,
        caseIds: [1, 2],
      };

      const { processor } = await loadWorker();
      await processor(
        makeMockJob({ id: "job-move-4", data: moveJobData }) as Job
      );

      // Source soft-delete should be called AFTER all transactions complete
      expect(mockPrisma.repositoryCases.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { isDeleted: true },
      });

      // Ensure it's called only once (after all copies, not per case)
      expect(mockPrisma.repositoryCases.updateMany).toHaveBeenCalledTimes(1);
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

  // ─── Shared step group handling ───────────────────────────────────────────

  describe("shared step group handling", () => {
    it("DATA-08: should recreate shared step group in target project", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
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
        tags: [],
        issues: [],
        attachments: [],
        comments: [],
      };
      mockPrisma.repositoryCases.findMany.mockResolvedValue([case1, case2]);

      // No existing groups
      mockTx.sharedStepGroup.findFirst.mockResolvedValue(null);
      mockTx.sharedStepGroup.create.mockResolvedValue({ id: 999 });

      let txCallCount = 0;
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        txCallCount++;
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
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
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
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
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
      mockPrisma.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const jobData = {
        ...baseCopyJobData,
        caseIds: [1, 2],
      };

      // First transaction succeeds, second fails
      let txCallCount = 0;
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
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
      expect(mockPrisma.repositoryCases.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1001] } },
      });
    });

    it("should not soft-delete source cases on move if any case fails", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockPrisma.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

      const moveJobData = {
        ...baseCopyJobData,
        operation: "move" as const,
        caseIds: [1, 2],
      };

      // Second transaction fails
      let txCallCount = 0;
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
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
      expect(mockPrisma.repositoryCases.updateMany).not.toHaveBeenCalled();
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
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should stop processing between cases when cancellation detected", async () => {
      const twoSourceCases = [
        { ...mockSourceCase, id: 1 },
        { ...mockSourceCase, id: 2 },
      ];
      mockPrisma.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

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
        processor(
          makeMockJob({ id: "job-cancel-2", data: jobData }) as Job
        )
      ).rejects.toThrow("Job cancelled by user");

      // Only 1 transaction should have completed (the first case)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // Rollback should delete the first created case
      expect(mockPrisma.repositoryCases.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1001] } },
      });
    });

    it("should delete cancellation key after detecting it", async () => {
      mockRedisGet.mockResolvedValue("1");

      const { processor } = await loadWorker();

      await expect(
        processor(makeMockJob({ id: "job-cancel-3" }) as Job)
      ).rejects.toThrow("Job cancelled by user");

      expect(mockRedisDel).toHaveBeenCalledWith("copy-move:cancel:job-cancel-3");
    });
  });

  // ─── Field option resolution edge cases ──────────────────────────────────

  describe("field option resolution edge cases", () => {
    it("should drop field value when target template has no matching field", async () => {
      // Source has a field with systemName "custom_field"
      // Target template has no field with matching systemName
      mockPrisma.templateCaseAssignment.findMany.mockImplementation(
        (args: any) => {
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
        }
      );

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
      mockPrisma.repositoryCases.findMany.mockResolvedValue(twoSourceCases);

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
      expect(mockSyncToES).toHaveBeenCalledWith(1001);
      expect(mockSyncToES).toHaveBeenCalledWith(1002);
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
});
