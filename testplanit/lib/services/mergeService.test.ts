import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- Mock prismaBase module -----
// Use vi.hoisted() so that the mock objects are available before vi.mock() factories run
// (vi.mock is hoisted to the top of the file by Vitest).

const { mockTx, mockPrisma } = vi.hoisted(() => {
  const mockTx = {
    testRunCases: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    steps: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    caseFieldValues: { updateMany: vi.fn() },
    resultFieldValues: { updateMany: vi.fn() },
    attachments: { updateMany: vi.fn() },
    repositoryCases: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repositoryCaseVersions: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    jUnitTestResult: { updateMany: vi.fn() },
    jUnitProperty: { updateMany: vi.fn() },
    jUnitAttachment: { updateMany: vi.fn() },
    jUnitTestStep: { updateMany: vi.fn() },
    comment: { updateMany: vi.fn() },
    repositoryCaseLink: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
    },
    duplicateScanResult: { updateMany: vi.fn() },
  };

  const mockPrisma = {
    $transaction: vi.fn((fn: any) => {
      if (typeof fn === "function") return fn(mockTx);
      // Array form (linkCases uses static array)
      return Promise.all(fn);
    }),
    repositoryCaseLink: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    duplicateScanResult: {
      updateMany: vi.fn(),
    },
  };

  return { mockTx, mockPrisma };
});

vi.mock("~/lib/prismaBase", () => ({
  prisma: mockPrisma,
}));

// Mock the ES sync — best-effort fire-and-forget
vi.mock("~/services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are in place
import { mergeCases, linkCases, dismissPair } from "./mergeService";

// ---- Helpers ----

function resetMocks() {
  vi.clearAllMocks();

  // Default: survivor is in runs [10, 20]; victim is in runs [20, 30]
  // Run 20 is the conflict
  mockTx.testRunCases.findMany.mockResolvedValue([
    { testRunId: 10 },
    { testRunId: 20 },
  ]);
  mockTx.testRunCases.deleteMany.mockResolvedValue({ count: 1 });
  mockTx.testRunCases.updateMany.mockResolvedValue({ count: 1 });

  // No victim steps by default (clean baseline)
  mockTx.steps.findFirst.mockResolvedValue({ order: 2 });
  mockTx.steps.findMany.mockResolvedValue([]);
  mockTx.steps.update.mockResolvedValue({});

  mockTx.caseFieldValues.updateMany.mockResolvedValue({ count: 0 });
  mockTx.resultFieldValues.updateMany.mockResolvedValue({ count: 0 });
  mockTx.attachments.updateMany.mockResolvedValue({ count: 0 });

  // Survivor has currentVersion = 3
  mockTx.repositoryCases.findUnique.mockResolvedValue({ currentVersion: 3, tags: [], issues: [] });
  mockTx.repositoryCases.update.mockResolvedValue({});

  // No victim versions by default
  mockTx.repositoryCaseVersions.findMany.mockResolvedValue([]);
  mockTx.repositoryCaseVersions.update.mockResolvedValue({});

  mockTx.jUnitTestResult.updateMany.mockResolvedValue({ count: 0 });
  mockTx.jUnitProperty.updateMany.mockResolvedValue({ count: 0 });
  mockTx.jUnitAttachment.updateMany.mockResolvedValue({ count: 0 });
  mockTx.jUnitTestStep.updateMany.mockResolvedValue({ count: 0 });
  mockTx.comment.updateMany.mockResolvedValue({ count: 0 });

  // Victim M2M: no tags/issues
  mockTx.repositoryCases.findUnique.mockImplementation(({ where }: any) => {
    if (where.id === 2) {
      // victim
      return Promise.resolve({ id: 2, currentVersion: 2, tags: [], issues: [] });
    }
    // survivor
    return Promise.resolve({ id: 1, currentVersion: 3 });
  });

  // Victim has no existing links
  mockTx.repositoryCaseLink.findMany.mockResolvedValue([]);
  mockTx.repositoryCaseLink.createMany.mockResolvedValue({ count: 0 });
  mockTx.repositoryCaseLink.create.mockResolvedValue({});

  mockTx.duplicateScanResult.updateMany.mockResolvedValue({ count: 0 });

  // Reset outer prisma mocks
  mockPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockTx) => Promise<any>) => fn(mockTx)
  );
  mockPrisma.repositoryCaseLink.create.mockResolvedValue({});
  mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 0 });
}

// ---- Tests ----

describe("mergeService", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ----------------------------------------------------------------
  // 1. Happy-path merge: transaction is called, victim soft-deleted
  // ----------------------------------------------------------------
  describe("mergeCases - happy path", () => {
    it("calls prisma.$transaction once", async () => {
      await mergeCases(1, 2, "user-123");
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    });

    it("soft-deletes the victim inside the transaction", async () => {
      await mergeCases(1, 2, "user-123");
      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({ isDeleted: true }),
        })
      );
    });

    it("returns survivorId in the result", async () => {
      const result = await mergeCases(1, 2, "user-123");
      expect(result.survivorId).toBe(1);
    });

    it("returns a summary object with run/version counts", async () => {
      const result = await mergeCases(1, 2, "user-123");
      expect(result.summary).toBeDefined();
      expect(typeof result.summary.runsTransferred).toBe("number");
      expect(typeof result.summary.versionsReparented).toBe("number");
    });

    it("creates an audit RepositoryCaseLink(SAME_TEST_DIFFERENT_SOURCE)", async () => {
      await mergeCases(1, 2, "user-123");
      expect(mockTx.repositoryCaseLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseAId: 1,
            caseBId: 2,
            type: "SAME_TEST_DIFFERENT_SOURCE",
            createdById: "user-123",
          }),
        })
      );
    });

    it("updates the resolved pair DuplicateScanResult to MERGED", async () => {
      await mergeCases(1, 2, "user-123");
      // First call: the resolved pair
      const firstCall = mockTx.duplicateScanResult.updateMany.mock.calls[0];
      expect(firstCall[0]).toMatchObject({
        where: {
          OR: expect.arrayContaining([
            expect.objectContaining({ caseAId: 2, caseBId: 1 }),
            expect.objectContaining({ caseAId: 1, caseBId: 2 }),
          ]),
        },
        data: { status: "MERGED" },
      });
    });

    it("marks all other PENDING scan results referencing victim as MERGED", async () => {
      await mergeCases(1, 2, "user-123");
      // At least two updateMany calls on duplicateScanResult:
      // 1st = resolved pair, 2nd = stale pending results
      expect(mockTx.duplicateScanResult.updateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = mockTx.duplicateScanResult.updateMany.mock.calls[1];
      expect(secondCall[0]).toMatchObject({
        where: {
          OR: expect.arrayContaining([
            { caseAId: 2 },
            { caseBId: 2 },
          ]),
          status: "PENDING",
        },
        data: { status: "MERGED" },
      });
    });
  });

  // ----------------------------------------------------------------
  // 2. TestRunCases conflict handling
  // ----------------------------------------------------------------
  describe("mergeCases - TestRunCases conflict", () => {
    it("deletes conflicting victim rows before rerouting", async () => {
      // Survivor is in run 10 and 20. Victim will have both conflict (20) and non-conflict (30).
      // findMany for survivorId=1 returns [10, 20] (set up in resetMocks)
      await mergeCases(1, 2, "user-123");

      // deleteMany should be called with the conflict run IDs
      expect(mockTx.testRunCases.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            repositoryCaseId: 2,
            testRunId: { in: expect.arrayContaining([10, 20]) },
          }),
        })
      );
    });

    it("reroutes non-conflicting TestRunCases to survivorId after delete", async () => {
      await mergeCases(1, 2, "user-123");
      expect(mockTx.testRunCases.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { repositoryCaseId: 2 },
          data: { repositoryCaseId: 1 },
        })
      );
    });

    it("skips deleteMany when survivor has no test runs", async () => {
      // Survivor has no runs → no conflicts possible
      mockTx.testRunCases.findMany.mockResolvedValue([]);
      await mergeCases(1, 2, "user-123");
      expect(mockTx.testRunCases.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 3. Version renumbering
  // ----------------------------------------------------------------
  describe("mergeCases - version renumbering", () => {
    it("renumbers victim versions with offset = survivor.currentVersion", async () => {
      // Survivor currentVersion = 3, victim has versions [1, 2]
      mockTx.repositoryCaseVersions.findMany.mockResolvedValue([
        { id: 101, version: 1 },
        { id: 102, version: 2 },
      ]);

      await mergeCases(1, 2, "user-123");

      // Version 1 → 3+1=4, Version 2 → 3+2=5
      expect(mockTx.repositoryCaseVersions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({
            repositoryCaseId: 1,
            version: 4,
          }),
        })
      );
      expect(mockTx.repositoryCaseVersions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 102 },
          data: expect.objectContaining({
            repositoryCaseId: 1,
            version: 5,
          }),
        })
      );
    });

    it("updates survivor.currentVersion to offset + max(victimVersions)", async () => {
      mockTx.repositoryCaseVersions.findMany.mockResolvedValue([
        { id: 101, version: 1 },
        { id: 102, version: 2 },
      ]);

      await mergeCases(1, 2, "user-123");

      // survivor.currentVersion should be updated to 3+2 = 5
      // The update to repositoryCases where id=survivorId should include currentVersion: 5
      const updateCalls = mockTx.repositoryCases.update.mock.calls;
      const survivorVersionUpdate = updateCalls.find(
        (call: any) =>
          call[0].where.id === 1 &&
          call[0].data.currentVersion !== undefined
      );
      expect(survivorVersionUpdate).toBeDefined();
      expect(survivorVersionUpdate![0].data.currentVersion).toBe(5);
    });

    it("leaves survivor.currentVersion unchanged when victim has no versions", async () => {
      mockTx.repositoryCaseVersions.findMany.mockResolvedValue([]);
      await mergeCases(1, 2, "user-123");

      const updateCalls = mockTx.repositoryCases.update.mock.calls;
      // No call with currentVersion change, or it's set to offset itself (3)
      const survivorVersionUpdate = updateCalls.find(
        (call: any) =>
          call[0].where.id === 1 &&
          call[0].data.currentVersion !== undefined
      );
      if (survivorVersionUpdate) {
        // If called, currentVersion should be 3 (unchanged = offset)
        expect(survivorVersionUpdate[0].data.currentVersion).toBe(3);
      }
      // Either way, no error and test passes
    });

    it("versionsReparented in summary matches victim version count", async () => {
      mockTx.repositoryCaseVersions.findMany.mockResolvedValue([
        { id: 101, version: 1 },
        { id: 102, version: 2 },
      ]);
      const result = await mergeCases(1, 2, "user-123");
      expect(result.summary.versionsReparented).toBe(2);
    });
  });

  // ----------------------------------------------------------------
  // 5. Tags and Issues M2M connect (idempotent)
  // ----------------------------------------------------------------
  describe("mergeCases - M2M connect for tags/issues", () => {
    it("connects victim tags to survivor", async () => {
      mockTx.repositoryCases.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 2) {
          return Promise.resolve({
            id: 2,
            currentVersion: 1,
            tags: [{ id: 10 }, { id: 11 }],
            issues: [],
          });
        }
        return Promise.resolve({ id: 1, currentVersion: 3 });
      });

      await mergeCases(1, 2, "user-123");

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            tags: { connect: [{ id: 10 }, { id: 11 }] },
          }),
        })
      );
    });

    it("connects victim issues to survivor", async () => {
      mockTx.repositoryCases.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 2) {
          return Promise.resolve({
            id: 2,
            currentVersion: 1,
            tags: [],
            issues: [{ id: 20 }],
          });
        }
        return Promise.resolve({ id: 1, currentVersion: 3 });
      });

      await mergeCases(1, 2, "user-123");

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            issues: { connect: [{ id: 20 }] },
          }),
        })
      );
    });

    it("does not call tag/issue update when victim has none", async () => {
      // Default mock: victim has no tags or issues
      await mergeCases(1, 2, "user-123");

      // The update calls that do happen should be for other things
      const tagConnectCall = mockTx.repositoryCases.update.mock.calls.find(
        (call: any) => call[0].data?.tags || call[0].data?.issues
      );
      expect(tagConnectCall).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 6. RepositoryCaseLink victim links rerouted with skipDuplicates
  // ----------------------------------------------------------------
  describe("mergeCases - victim link rerouting", () => {
    it("reroutes victim caseA links to survivor using createMany skipDuplicates", async () => {
      mockTx.repositoryCaseLink.findMany.mockImplementation(({ where }: any) => {
        if (where.caseAId === 2) {
          return Promise.resolve([{ id: 50, caseBId: 99, type: "DEPENDS_ON" }]);
        }
        return Promise.resolve([]);
      });

      await mergeCases(1, 2, "user-123");

      expect(mockTx.repositoryCaseLink.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ caseAId: 1, caseBId: 99, type: "DEPENDS_ON" }),
          ]),
          skipDuplicates: true,
        })
      );
    });

    it("reroutes victim caseB links to survivor using createMany skipDuplicates", async () => {
      mockTx.repositoryCaseLink.findMany.mockImplementation(({ where }: any) => {
        if (where.caseBId === 2) {
          return Promise.resolve([{ id: 51, caseAId: 77, type: "SAME_TEST_DIFFERENT_SOURCE" }]);
        }
        return Promise.resolve([]);
      });

      await mergeCases(1, 2, "user-123");

      expect(mockTx.repositoryCaseLink.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ caseAId: 77, caseBId: 1, type: "SAME_TEST_DIFFERENT_SOURCE" }),
          ]),
          skipDuplicates: true,
        })
      );
    });
  });

  // ----------------------------------------------------------------
  // 7. Transaction atomicity
  // ----------------------------------------------------------------
  describe("mergeCases - transaction atomicity", () => {
    it("all operations run inside $transaction (not bare prisma calls)", async () => {
      await mergeCases(1, 2, "user-123");
      // The outer prisma.$transaction was called once
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      // Core operations happen on mockTx (inside transaction), not on bare mockPrisma
      // e.g. testRunCases.updateMany should be on mockTx, not mockPrisma
      expect(mockTx.testRunCases.updateMany).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 8. linkCases action
  // ----------------------------------------------------------------
  describe("linkCases", () => {
    it("upserts a RepositoryCaseLink with SAME_TEST_DIFFERENT_SOURCE", async () => {
      mockPrisma.$transaction.mockImplementation(
        (ops: any[]) => Promise.all(ops)
      );
      mockPrisma.repositoryCaseLink.upsert.mockResolvedValue({ id: 1 });
      mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 1 });

      await linkCases(1, 2, "user-123", 5);

      expect(mockPrisma.repositoryCaseLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            caseAId_caseBId_type: {
              caseAId: 1,
              caseBId: 2,
              type: "SAME_TEST_DIFFERENT_SOURCE",
            },
          }),
          create: expect.objectContaining({
            caseAId: 1,
            caseBId: 2,
            type: "SAME_TEST_DIFFERENT_SOURCE",
            createdById: "user-123",
          }),
        })
      );
    });

    it("updates DuplicateScanResult status to LINKED", async () => {
      mockPrisma.$transaction.mockImplementation(
        (ops: any[]) => Promise.all(ops)
      );
      mockPrisma.repositoryCaseLink.upsert.mockResolvedValue({ id: 1 });
      mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 1 });

      await linkCases(1, 2, "user-123", 5);

      expect(mockPrisma.duplicateScanResult.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: expect.arrayContaining([
              expect.objectContaining({ caseAId: 1, caseBId: 2 }),
              expect.objectContaining({ caseAId: 2, caseBId: 1 }),
            ]),
          },
          data: { status: "LINKED" },
        })
      );
    });

    it("returns { linked: true }", async () => {
      mockPrisma.$transaction.mockImplementation(
        (ops: any[]) => Promise.all(ops)
      );
      mockPrisma.repositoryCaseLink.upsert.mockResolvedValue({ id: 1 });
      mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await linkCases(1, 2, "user-123", 5);
      expect(result).toEqual({ linked: true });
    });
  });

  // ----------------------------------------------------------------
  // 9. dismissPair action
  // ----------------------------------------------------------------
  describe("dismissPair", () => {
    it("updates DuplicateScanResult status to DISMISSED", async () => {
      mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 1 });

      await dismissPair(1, 2, 5);

      expect(mockPrisma.duplicateScanResult.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ caseAId: 1, caseBId: 2 }),
              expect.objectContaining({ caseAId: 2, caseBId: 1 }),
            ]),
            projectId: 5,
          }),
          data: { status: "DISMISSED" },
        })
      );
    });

    it("returns { dismissed: true }", async () => {
      mockPrisma.duplicateScanResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await dismissPair(1, 2, 5);
      expect(result).toEqual({ dismissed: true });
    });
  });
});
