import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { completeMilestoneCascade } from "./milestoneActions";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";

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
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

describe("milestoneActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
        vi.mocked(getServerAuthSession).mockResolvedValue({ user: null } as any);

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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as any);

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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // First call returns children, second call returns no more children
        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }] as any) // Children of milestone 1
          .mockResolvedValueOnce([]) // No children of 2 or 3
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }] as any); // Incomplete descendants

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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }] as any)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 2 }] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([{ id: 10 }] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([{ id: 20 }, { id: 21 }] as any);

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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
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
          });
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date("2024-06-15"),
        });

        expect(result.status).toBe("success");
        expect(result.message).toBe("Milestone and dependencies completed successfully.");
      });

      it("should complete milestone with force flag despite dependencies", async () => {
        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }] as any)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 2 }] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([{ id: 10 }] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([{ id: 20 }] as any);

        const mockUpdate = vi.fn();
        const mockUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: mockUpdate, updateMany: mockUpdateMany },
            testRuns: { updateMany: mockUpdateMany },
            sessions: { updateMany: mockUpdateMany },
          });
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
          });
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
          });
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
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
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
          });
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
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
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
          });
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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // Simulate 3 levels of hierarchy
        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }] as any) // Level 1: children of 1
          .mockResolvedValueOnce([{ id: 4 }] as any) // Level 2: children of 2,3
          .mockResolvedValueOnce([]) // Level 3: no more children
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }, { id: 4 }] as any); // All incomplete descendants

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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        // The findMany query includes isDeleted: false filter
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
          });
        });

        const result = await completeMilestoneCascade({
          milestoneId: 1,
          completionDate: new Date(),
        });

        expect(result.status).toBe("success");
        // Verify findMany was called with isDeleted: false
        expect(prisma.milestones.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
            }),
          })
        );
      });
    });

    describe("error handling", () => {
      it("should handle database error during transaction", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$transaction).mockRejectedValue(new Error("Database connection failed"));

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
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as any);
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([{ id: 10 }, { id: 11 }] as any);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockTestRunsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: mockTestRunsUpdateMany },
            sessions: { updateMany: vi.fn() },
          });
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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);
        vi.mocked(prisma.milestones.findMany).mockResolvedValue([]);
        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([{ id: 20 }, { id: 21 }] as any);

        const mockSessionsUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: vi.fn() },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: mockSessionsUpdateMany },
          });
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
        vi.mocked(prisma.milestones.findUnique).mockResolvedValue(mockMilestone as any);
        vi.mocked(prisma.workflows.findFirst)
          .mockResolvedValueOnce(mockDoneRunWorkflow as any)
          .mockResolvedValueOnce(mockDoneSessionWorkflow as any);

        vi.mocked(prisma.milestones.findMany)
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }] as any)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 2 }, { id: 3 }] as any);

        vi.mocked(prisma.testRuns.findMany).mockResolvedValue([]);
        vi.mocked(prisma.sessions.findMany).mockResolvedValue([]);

        const mockMilestonesUpdateMany = vi.fn();
        vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
          return callback({
            milestones: { update: vi.fn(), updateMany: mockMilestonesUpdateMany },
            testRuns: { updateMany: vi.fn() },
            sessions: { updateMany: vi.fn() },
          });
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
  });
});
