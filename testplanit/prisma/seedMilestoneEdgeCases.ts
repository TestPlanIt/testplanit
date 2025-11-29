import { PrismaClient } from "@prisma/client";

export async function seedMilestoneEdgeCases(prisma: PrismaClient, projectId: number, adminUserId: string, milestoneTypeId: number) {
  console.log("Seeding milestone edge cases for comprehensive testing...");

  // Edge Case 1: Milestone that is completed but not started (data inconsistency)
  const edgeCase1 = await prisma.milestones.create({
    data: {
      name: "Edge Case 1: Completed but not Started",
      projectId: projectId,
      milestoneTypesId: milestoneTypeId,
      createdBy: adminUserId,
      isStarted: false,
      isCompleted: true, // This should still count as progress
      completedAt: new Date("2025-06-20T10:00:00Z"),
      createdAt: new Date("2025-06-01T10:00:00Z"),
    },
  });

  // Edge Case 2: Milestone that is started but not completed (normal in-progress)
  const edgeCase2 = await prisma.milestones.create({
    data: {
      name: "Edge Case 2: Started but not Completed",
      projectId: projectId,
      milestoneTypesId: milestoneTypeId,
      createdBy: adminUserId,
      isStarted: true,
      isCompleted: false,
      startedAt: new Date("2025-06-10T10:00:00Z"),
      createdAt: new Date("2025-06-05T10:00:00Z"),
    },
  });

  // Edge Case 3: Milestone that is both started and completed (normal completed)
  const edgeCase3 = await prisma.milestones.create({
    data: {
      name: "Edge Case 3: Started and Completed",
      projectId: projectId,
      milestoneTypesId: milestoneTypeId,
      createdBy: adminUserId,
      isStarted: true,
      isCompleted: true,
      startedAt: new Date("2025-06-15T10:00:00Z"),
      completedAt: new Date("2025-06-25T10:00:00Z"),
      createdAt: new Date("2025-06-10T10:00:00Z"),
    },
  });

  // Edge Case 4: Milestone that is neither started nor completed (not started)
  const edgeCase4 = await prisma.milestones.create({
    data: {
      name: "Edge Case 4: Not Started",
      projectId: projectId,
      milestoneTypesId: milestoneTypeId,
      createdBy: adminUserId,
      isStarted: false,
      isCompleted: false,
      createdAt: new Date("2025-06-12T10:00:00Z"),
    },
  });

  // Edge Case 5: Deleted milestone (should not be counted)
  const edgeCase5 = await prisma.milestones.create({
    data: {
      name: "Edge Case 5: Deleted Milestone",
      projectId: projectId,
      milestoneTypesId: milestoneTypeId,
      createdBy: adminUserId,
      isStarted: true,
      isCompleted: true,
      isDeleted: true, // Should be excluded from calculations
      startedAt: new Date("2025-06-01T10:00:00Z"),
      completedAt: new Date("2025-06-05T10:00:00Z"),
      createdAt: new Date("2025-05-20T10:00:00Z"),
    },
  });

  // Create a set of milestones to test the 200% bug scenario
  // 5 milestones all started and completed = should be 100% progress, not 200%
  for (let i = 1; i <= 5; i++) {
    await prisma.milestones.create({
      data: {
        name: `Test 200% Bug - Milestone ${i}`,
        projectId: projectId,
        milestoneTypesId: milestoneTypeId,
        createdBy: adminUserId,
        isStarted: true,
        isCompleted: true,
        startedAt: new Date(`2025-07-0${i}T10:00:00Z`),
        completedAt: new Date(`2025-07-${10 + i}T10:00:00Z`),
        createdAt: new Date(`2025-06-${25 + i}T10:00:00Z`),
      },
    });
  }

  console.log("Milestone edge cases seeded successfully!");
  console.log("Expected calculations for edge cases:");
  console.log("- Total non-deleted milestones: 9");
  console.log("- Milestones with progress (started OR completed): 8");
  console.log("- Completed milestones: 7");
  console.log("- Active milestones (started but not completed): 1");
  console.log("- Expected Milestone Progress: 88.89% (8/9)");
  console.log("- Expected Completion Rate: 77.78% (7/9)");
}