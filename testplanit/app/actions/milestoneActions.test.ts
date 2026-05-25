import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/prisma";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { getServerAuthSession } from "~/server/auth";
import { completeMilestoneCascade } from "./milestoneActions";
import { checkUserPermission } from "./permissions";

// Mock dependencies
vi.mock("~/lib/prisma", () => ({
  prisma: {
    milestones: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    testRuns: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    sessions: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    workflows: {
      findFirst: vi.fn(),
      // Used by the catch block to resolve the BLOCKING gate's display name
      // for the user-facing error toast.
      findUnique: vi.fn(),
    },
    // WR-04: completeMilestoneCascade pre-fetches the project's
    // reviewWorkflowEnabled flag once outside the transaction.
    projects: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("./permissions", () => ({
  checkUserPermission: vi.fn(),
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn().mockResolvedValue([]),
}));

describe("milestoneActions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("completeMilestoneCascade", () => {
    const mockSession = {
      user: {
        id: "user-123",
        name: "Test User",
      },
      expires: new Date().toISOString(),
    };

    const mockMilestone = {
      id: 1,
      startedAt: new Date("2024-01-01"),
      projectId: 100,
    };

    const mockDoneRunWorkflow = { id: 10 };
    const mockDoneSessionWorkflow = { id: 20 };

    beforeEach(() => {
      // Default: allow permission for most tests
      vi.mocked(checkUserPermission).mockResolvedValue(true);
      // Default: no descendants
      vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([]);
      // Default: project has review feature enabled (matches schema default).
      // Tests that exercise the disabled-flag short-circuit override this.
      vi.mocked(prisma.projects.findUnique).mockResolvedValue({
        reviewWorkflowEnabled: true,
      } as any);
    });

    describe("authentication", () => {
      it("should return error when user is not authenticated", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(null);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("User not authenticated");
      });

      it("should return error when session has no user", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue({
          user: null,
        } as any);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("User not authenticated");
      });
    });

    describe("input validation", () => {
      it("should return error for invalid input (missing milestoneId)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);

        const result = await completeMilestoneCascade({
          milestoneId: undefined as any,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("Invalid input.");
      });

      it("should return error for invalid input (missing completionDate)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: undefined as any,
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("Invalid input.");
      });

      it("should return error for invalid milestoneId type", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);

        const result = await completeMilestoneCascade({
          milestoneId: "not-a-number" as any,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("Invalid input.");
      });
    });

    describe("milestone not found", () => {
      it("should return error when milestone does not exist", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(null);

        const result = await completeMilestoneCascade({
          milestoneId: 999,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("Milestone not found.");
      });
    });

    describe("confirmation required", () => {
      it("should require confirmation when there are active test runs", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 1 },
          { id: 2 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("confirmation_required");
        expect(result.impact).toEqual({
          activeTestRuns: 2,
          activeSessions: 0,
          descendantMilestonesToComplete: 0,
        });
      });

      it("should require confirmation when there are active sessions", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 1 },
          { id: 2 },
          { id: 3 },
        ] as any);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("confirmation_required");
        expect(result.impact).toEqual({
          activeTestRuns: 0,
          activeSessions: 3,
          descendantMilestonesToComplete: 0,
        });
      });

      it("should require confirmation when there are descendant milestones to complete", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // Shared utility returns descendant IDs
        vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([2, 3]);
        // Incomplete descendants query
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([
          { id: 2 },
          { id: 3 },
        ] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("confirmation_required");
        expect(result.impact?.descendantMilestonesToComplete).toBe(2);
      });

      it("should require confirmation when there are multiple types of dependencies", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // Shared utility returns descendant IDs
        vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([2]);
        // Incomplete descendants query
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([
          { id: 2 },
        ] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
          { id: 21 },
        ] as any);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("confirmation_required");
        expect(result.impact).toEqual({
          activeTestRuns: 1,
          activeSessions: 2,
          descendantMilestonesToComplete: 1,
        });
      });
    });

    describe("successful completion", () => {
      it("should complete milestone without dependencies", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
        });

        expect(result.status).toBe("success");
        expect(result.message).toBeUndefined();
      });

      it("should complete milestone with force flag despite dependencies", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }] as any)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 2 }] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
        ] as any);

        const mockUpdate = vi.fn();
        const mockUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: mockUpdate, updateMany: mockUpdateMany },
            testRuns: { updateMany: mockUpdateMany },
            sessions: { updateMany: mockUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
        });

        expect(result.status).toBe("success");
        expect(mockUpdate).toHaveBeenCalled();
      });

      it("should use existing startedAt when milestone was already started", async () => {
        const existingStartDate = new Date("2024-01-15");
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue({
          ...mockMilestone,
          startedAt: existingStartDate,
        } as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockUpdate = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: mockUpdate, updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
        });

        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              startedAt: existingStartDate,
            }),
          })
        );
      });

      it("should set startedAt to completionDate when milestone was not started", async () => {
        const completionDate = new Date("2024-06-15");
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue({
          ...mockMilestone,
          startedAt: null,
        } as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockUpdate = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: mockUpdate, updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate,
        });

        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              startedAt: completionDate,
            }),
          })
        );
      });
    });

    describe("workflow state handling", () => {
      it("should handle missing DONE workflow for test runs gracefully", async () => {
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(null) // No DONE workflow for runs
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("success");
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("No 'DONE' workflow found for RUNS")
        );

        consoleSpy.mockRestore();
      });

      it("should handle missing DONE workflow for sessions gracefully", async () => {
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(null); // No DONE workflow for sessions
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("success");
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("No 'DONE' workflow found for SESSIONS")
        );

        consoleSpy.mockRestore();
      });
    });

    describe("descendant milestone traversal", () => {
      it("should find all levels of descendant milestones", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // Shared utility returns all descendant IDs (3 levels deep)
        vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([2, 3, 4]);
        // Incomplete descendants query
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([
          { id: 2 },
          { id: 3 },
          { id: 4 },
        ] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("confirmation_required");
        expect(result.impact?.descendantMilestonesToComplete).toBe(3);
      });

      it("should exclude deleted milestones from descendants", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // Shared utility handles isDeleted filtering internally
        vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([]);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("success");
        // Verify shared utility was called with the milestone ID
        expect(getAllDescendantMilestoneIds).toHaveBeenCalledWith(1);
      });
    });

    describe("error handling", () => {
      it("should handle database error during transaction", async () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockRejectedValue(
          new Error("Database connection failed")
        );

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toContain("Failed to complete milestone");
        expect(result.message).toContain("Database connection failed");

        consoleSpy.mockRestore();
      });

      it("should handle non-Error exceptions during transaction", async () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockRejectedValue("String error");

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("error");
        expect(result.message).toBe("Failed to complete milestone.");

        consoleSpy.mockRestore();
      });
    });

    describe("transaction updates", () => {
      it("should update test runs with stateId when workflow exists", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
          { id: 11 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
        });

        expect(mockTestRunsUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: [10, 11] } },
            data: expect.objectContaining({
              isCompleted: true,
              stateId: 10, // mockDoneRunWorkflow.id
            }),
          })
        );
      });

      it("should update sessions with stateId when workflow exists", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
          { id: 21 },
        ] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
        });

        expect(mockSessionsUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: [20, 21] } },
            data: expect.objectContaining({
              isCompleted: true,
              stateId: 20, // mockDoneSessionWorkflow.id
            }),
          })
        );
      });

      it("should update descendant milestones", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        vi.mocked(getAllDescendantMilestoneIds).mockResolvedValue([2, 3]);
        // Incomplete descendants query
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([
          { id: 2 },
          { id: 3 },
        ] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockMilestonesUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: {
              update: vi.fn(),
              updateMany: mockMilestonesUpdateMany,
            },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const completionDate = new Date("2024-06-15");
        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate,
          forceCompleteDependencies: true,
        });

        expect(mockMilestonesUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: [2, 3] } },
            data: expect.objectContaining({
              isCompleted: true,
              completedAt: completionDate,
              isStarted: true,
              startedAt: completionDate,
            }),
          })
        );
      });
    });

    describe("optional test run completion", () => {
      it("should NOT complete test runs when completeTestRuns is false", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
          { id: 11 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeTestRuns: false, // NEW: Don't complete test runs
        });

        // Test runs should NOT be updated
        expect(mockTestRunsUpdateMany).not.toHaveBeenCalled();
      });

      it("should complete test runs when completeTestRuns is true (default)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
          { id: 11 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeTestRuns: true, // Explicitly true
        });

        // Test runs should be updated
        expect(mockTestRunsUpdateMany).toHaveBeenCalled();
      });

      it("should complete test runs by default when flag is not provided", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          // completeTestRuns not provided - should default to true
        });

        // Test runs should be updated by default
        expect(mockTestRunsUpdateMany).toHaveBeenCalled();
      });
    });

    describe("optional session completion", () => {
      it("should NOT complete sessions when completeSessions is false", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
          { id: 21 },
        ] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeSessions: false, // NEW: Don't complete sessions
        });

        // Sessions should NOT be updated
        expect(mockSessionsUpdateMany).not.toHaveBeenCalled();
      });

      it("should complete sessions when completeSessions is true (default)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
          { id: 21 },
        ] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeSessions: true, // Explicitly true
        });

        // Sessions should be updated
        expect(mockSessionsUpdateMany).toHaveBeenCalled();
      });

      it("should complete sessions by default when flag is not provided", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
        ] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          // completeSessions not provided - should default to true
        });

        // Sessions should be updated by default
        expect(mockSessionsUpdateMany).toHaveBeenCalled();
      });
    });

    describe("custom workflow state IDs", () => {
      it("should use provided testRunStateId instead of default workflow", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const customStateId = 99;
        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          testRunStateId: customStateId, // Custom state ID
        });

        // Should use custom state ID, not default workflow ID
        expect(mockTestRunsUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              stateId: customStateId, // Should be 99, not mockDoneRunWorkflow.id (10)
            }),
          })
        );
      });

      it("should use provided sessionStateId instead of default workflow", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
        ] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        const customStateId = 88;
        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          sessionStateId: customStateId, // Custom state ID
        });

        // Should use custom state ID, not default workflow ID
        expect(mockSessionsUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              stateId: customStateId, // Should be 88, not mockDoneSessionWorkflow.id (20)
            }),
          })
        );
      });

      it("should not set stateId when completeTestRuns is false even if testRunStateId is provided", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeTestRuns: false, // Don't complete test runs
          testRunStateId: 99, // Provided but should be ignored
        });

        // Test runs should NOT be updated at all
        expect(mockTestRunsUpdateMany).not.toHaveBeenCalled();
      });
    });

    describe("combined optional completion scenarios", () => {
      it("should complete only milestone when both test runs and sessions are disabled", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
        ] as any);

        const mockMilestoneUpdate = vi.fn();
        const mockTestRunsUpdateMany = vi.fn();
        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: mockMilestoneUpdate, updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: mockSessionsUpdateMany },
            workflows: { findUnique: vi.fn().mockResolvedValue(null) },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
          } as any);
        });

        await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
          forceCompleteDependencies: true,
          completeTestRuns: false, // Don't complete test runs
          completeSessions: false, // Don't complete sessions
        });

        // Milestone should be updated
        expect(mockMilestoneUpdate).toHaveBeenCalled();
        // But test runs and sessions should NOT be updated
        expect(mockTestRunsUpdateMany).not.toHaveBeenCalled();
        expect(mockSessionsUpdateMany).not.toHaveBeenCalled();
      });

      it("should return impact data even when completion flags are false", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 10 },
          { id: 11 },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([
          { id: 20 },
        ] as any);

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
          isPreview: true, // Preview mode
          completeTestRuns: false,
          completeSessions: false,
        });

        // Should still return impact data showing what would remain active
        expect(result.status).toBe("confirmation_required");
        expect(result.impact).toEqual({
          activeTestRuns: 2,
          activeSessions: 1,
          descendantMilestonesToComplete: 0,
        });
      });
    });

    describe("review gate (strict transitive bulk)", () => {
      it("skips approval lookup when no gated states exist in the scope (target ungated AND no upstream gates)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 1, state: { order: 1 } },
          { id: 2, state: { order: 1 } },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([] as any);

        // Target state resolves with order 5; no gates in scope.
        const txWorkflowsFindUnique = vi.fn().mockResolvedValue({ order: 5 });
        const txWorkflowsFindMany = vi.fn().mockResolvedValue([]);
        const txReviewRequestFindMany = vi.fn();

        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: {
              findUnique: txWorkflowsFindUnique,
              findMany: txWorkflowsFindMany,
            },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
            reviewRequest: { findMany: txReviewRequestFindMany },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
          forceCompleteDependencies: true,
        });

        expect(result.status).toBe("success");
        // No approvals roundtrip when there are zero reachable gates.
        expect(txReviewRequestFindMany).not.toHaveBeenCalled();
      });

      it("runs a single batched preflight findMany when a gated state lies in the path (strict transitive bulk)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        // Both runs sit at order 1; target (DONE) is at order 5; one gate at
        // order 4 lies in the transitive path.
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 1, state: { order: 1 } },
          { id: 2, state: { order: 1 } },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([] as any);

        const txReviewRequestFindMany = vi.fn().mockResolvedValue([
          { id: "approval-1", entityId: 1, toStateId: 40 },
          { id: "approval-2", entityId: 2, toStateId: 40 },
        ]);
        const txReviewRequestUpdateMany = vi
          .fn()
          .mockResolvedValue({ count: 2 });
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: {
              findUnique: vi.fn().mockResolvedValue({ order: 5 }),
              findMany: vi.fn().mockResolvedValue([{ id: 40, order: 4 }]),
            },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
            reviewRequest: {
              findMany: txReviewRequestFindMany,
              updateMany: txReviewRequestUpdateMany,
            },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
          forceCompleteDependencies: true,
        });

        expect(result.status).toBe("success");
        // Single batched preflight call — covers every entity × every gate.
        expect(txReviewRequestFindMany).toHaveBeenCalledTimes(1);
        expect(txReviewRequestFindMany).toHaveBeenCalledWith({
          where: {
            entityType: "RUN",
            entityId: { in: [1, 2] },
            toStateId: { in: [40] },
            status: "APPROVED",
            consumedAt: null,
            isDeleted: false,
          },
          select: { id: true, entityId: true, toStateId: true },
        });
        // Bulk stamp fires once after the entity update succeeds.
        expect(txReviewRequestUpdateMany).toHaveBeenCalledTimes(1);
        expect(txReviewRequestUpdateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["approval-1", "approval-2"] },
            consumedAt: null,
          },
          data: { consumedAt: expect.any(Date) },
        });
      });

      it("returns structured error naming entity + blocking gate when an entity is missing an approval (strict)", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        // The catch block looks up the BLOCKING gate's display name from
        // the top-level prisma client (outside the rolled-back tx).
        vi.mocked(prisma.workflows.findUnique).mockResolvedValue({
          name: "Active",
        } as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 42, name: "Sprint 2 - Regression", state: { order: 1 } },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([] as any);

        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: {
              findUnique: vi.fn().mockResolvedValue({ order: 5 }),
              findMany: vi.fn().mockResolvedValue([{ id: 40, order: 4 }]),
            },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
            // Empty result → entityId 42 is missing approval for gate 40.
            reviewRequest: { findMany: vi.fn().mockResolvedValue([]) },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
          forceCompleteDependencies: true,
        });

        expect(result.status).toBe("error");
        expect(result.message).toMatch(/Review required/i);
        // Names — NOT IDs — so the toast tells the user which run + which
        // gate need attention.
        expect(result.message).toContain('"Sprint 2 - Regression"');
        expect(result.message).toContain('"Active"');
        // Sanity: shouldn't expose raw numeric ids in the friendly message.
        expect(result.message).not.toMatch(/run 42/);
      });

      it("short-circuits the batched preflight when the project disabled reviewWorkflowEnabled", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(
          mockMilestone as any
        );
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([
          { id: 1, state: { order: 1 } },
        ] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([] as any);
        vi.mocked(prisma.projects.findUnique).mockResolvedValue({
          reviewWorkflowEnabled: false,
        } as any);

        const txReviewRequestFindMany = vi.fn();
        const txWorkflowsFindUnique = vi.fn();
        const txWorkflowsFindMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
            workflows: {
              findUnique: txWorkflowsFindUnique,
              findMany: txWorkflowsFindMany,
            },
            appConfig: {
              findUnique: vi.fn().mockResolvedValue({ value: true }),
            },
            reviewRequest: { findMany: txReviewRequestFindMany },
          } as any);
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
          forceCompleteDependencies: true,
        });

        expect(result.status).toBe("success");
        // Helper never invoked when project flag is off.
        expect(txWorkflowsFindUnique).not.toHaveBeenCalled();
        expect(txWorkflowsFindMany).not.toHaveBeenCalled();
        expect(txReviewRequestFindMany).not.toHaveBeenCalled();
      });
    });
  });
});
