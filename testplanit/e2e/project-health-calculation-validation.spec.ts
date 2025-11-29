import { test, expect } from "@playwright/test";

test.describe
  .serial("Project Health Calculation Validation @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;

  test("should prevent 200% milestone progress bug", async ({ request }) => {
    // Create a test scenario that would have caused 200% before the fix
    // We'll use the seed data that includes milestones with both isStarted and isCompleted = true

    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: [],
        metrics: [
          "milestoneProgress",
          "completionRate",
          "totalMilestones",
          "activeMilestones",
        ],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    if (data.results.length > 0) {
      const result = data.results[0];

      // Critical assertion: Milestone Progress should NEVER exceed 100%
      expect(result["Milestone Progress (%)"]).toBeLessThanOrEqual(100);
      expect(result["Milestone Progress (%)"]).toBeGreaterThanOrEqual(0);

      // Completion Rate should also never exceed 100%
      expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(100);
      expect(result["Completion Rate (%)"]).toBeGreaterThanOrEqual(0);

      // Active milestones should never exceed total milestones
      expect(result["Active Milestones"]).toBeLessThanOrEqual(
        result["Total Milestones"]
      );
    }
  });

  test("should correctly calculate metrics when grouped by milestone", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: ["milestoneProgress", "completionRate", "totalMilestones"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Each individual milestone should have logical calculations
    for (const result of data.results) {
      const milestone = result.milestone;

      // For a single milestone grouped by itself:
      // - Total should always be 1
      expect(result["Total Milestones"]).toBe(1);

      // - Progress should be 0% or 100% (either has progress or doesn't)
      const expectedProgress =
        milestone.isStarted || milestone.isCompleted ? 100 : 0;
      expect(result["Milestone Progress (%)"]).toBe(expectedProgress);

      // - Completion should be 0% or 100% (either completed or not)
      const expectedCompletion = milestone.isCompleted ? 100 : 0;
      expect(result["Completion Rate (%)"]).toBe(expectedCompletion);

      // Verify no double-counting: if both started and completed, progress should still be 100%, not 200%
      if (milestone.isStarted && milestone.isCompleted) {
        expect(result["Milestone Progress (%)"]).toBe(100);
      }
    }
  });

  test("should validate calculation logic relationships", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: [],
        metrics: [
          "milestoneProgress",
          "completionRate",
          "totalMilestones",
          "activeMilestones",
        ],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    if (data.results.length > 0) {
      const result = data.results[0];

      // Logical relationships that must always be true:

      // 1. Completion Rate should never exceed Milestone Progress
      // (You can't complete more than you've started)
      expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(
        result["Milestone Progress (%)"]
      );

      // 2. Active Milestones + Completed milestones should equal milestones with progress
      // This validates our counting logic
      const totalMilestones = result["Total Milestones"];
      const progressPercent = result["Milestone Progress (%)"];
      const completionPercent = result["Completion Rate (%)"];
      const activeMilestones = result["Active Milestones"];

      if (totalMilestones > 0) {
        const milestonesWithProgress = Math.round(
          (progressPercent / 100) * totalMilestones
        );
        const completedMilestones = Math.round(
          (completionPercent / 100) * totalMilestones
        );

        // Active + Completed should equal total with progress (within rounding error)
        expect(
          Math.abs(
            activeMilestones + completedMilestones - milestonesWithProgress
          )
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("should handle edge cases correctly", async ({ request }) => {
    // Test with different dimension combinations to ensure calculations are consistent
    const dimensionSets = [
      [],
      ["milestone"],
      ["creator"],
      ["date"],
      ["milestone", "creator"],
    ];

    for (const dimensions of dimensionSets) {
      const response = await request.post(
        "/api/report-builder/project-health",
        {
          data: {
            projectId: TEST_PROJECT_ID,
            dimensions,
            metrics: ["milestoneProgress", "completionRate"],
          },
        }
      );

      expect(response.status()).toBe(200);
      const data = await response.json();

      // Every result should have valid percentages
      for (const result of data.results) {
        expect(result["Milestone Progress (%)"]).toBeGreaterThanOrEqual(0);
        expect(result["Milestone Progress (%)"]).toBeLessThanOrEqual(100);
        expect(result["Completion Rate (%)"]).toBeGreaterThanOrEqual(0);
        expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(100);

        // Completion should not exceed progress
        expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(
          result["Milestone Progress (%)"]
        );
      }
    }
  });
});
