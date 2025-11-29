import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds comprehensive test execution data covering all dimension combinations
 * for thorough Test Execution Reports testing
 */
export async function seedComprehensiveTestExecutionData() {
  console.log("Seeding comprehensive test execution data...");

  // Get the test project
  const project = await prisma.projects.findFirst({
    where: { id: 331 },
  });

  if (!project) {
    throw new Error("Test project (ID: 331) not found");
  }

  // Get users
  const adminUser = await prisma.user.findFirst({
    where: { email: "admin@testplanit.com" },
  });
  const regularUser = await prisma.user.findFirst({
    where: { email: "testuser@example.com" },
  });

  if (!adminUser || !regularUser) {
    throw new Error("Test users not found");
  }

  // Get workflow states
  const workflowStates = await prisma.workflows.findMany({
    where: { isDeleted: false },
    orderBy: { order: "asc" },
  });

  const defaultState = workflowStates[0];
  const inProgressState = workflowStates[1] || defaultState;
  const doneState = workflowStates[2] || defaultState;

  // Get all test result statuses
  const statuses = await prisma.status.findMany({
    where: { isDeleted: false },
  });

  const statusMap = Object.fromEntries(
    statuses.map((s) => [s.name.toLowerCase(), s])
  );

  // Create or get milestones
  const milestones = await Promise.all([
    prisma.milestones.create({
      data: {
        projectId: project.id,
        name: "Release 1.0",
        milestoneTypesId: 1, // Version
        createdBy: adminUser.id,
        isStarted: true,
        isCompleted: true,
        startedAt: new Date("2025-01-01"),
        completedAt: new Date("2025-03-31"),
      },
    }),
    prisma.milestones.create({
      data: {
        projectId: project.id,
        name: "Sprint 23",
        milestoneTypesId: 2, // Iteration
        createdBy: adminUser.id,
        isStarted: true,
        startedAt: new Date("2025-06-01"),
      },
    }),
    prisma.milestones.create({
      data: {
        projectId: project.id,
        name: "Q2 Goals",
        milestoneTypesId: 1, // Version
        createdBy: adminUser.id,
      },
    }),
  ]);

  // Create test configurations
  const configs = await Promise.all([
    prisma.configurations.create({
      data: {
        name: "Windows Chrome",
      },
    }),
    prisma.configurations.create({
      data: {
        name: "MacOS Safari",
      },
    }),
    prisma.configurations.create({
      data: {
        name: "Linux Firefox",
      },
    }),
    prisma.configurations.create({
      data: {
        name: "Mobile Android",
      },
    }),
  ]);

  // Get repository for the project
  const repository = await prisma.repositories.findFirst({
    where: { projectId: project.id },
  });

  if (!repository) {
    throw new Error("Repository not found for project");
  }

  // Get or create test folders
  const folders = await Promise.all([
    prisma.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: "Smoke Tests",
        creatorId: adminUser.id,
        order: 1,
      },
    }),
    prisma.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: "Regression Tests",
        creatorId: adminUser.id,
        order: 2,
      },
    }),
    prisma.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: "Integration Tests",
        creatorId: adminUser.id,
        order: 3,
      },
    }),
  ]);

  // Create comprehensive repository cases
  const testCases = await Promise.all([
    // Smoke test cases
    ...Array.from({ length: 5 }, async (_, i) =>
      prisma.repositoryCases.create({
        data: {
          projectId: project.id,
          name: `Smoke Test ${i + 1}`,
          automated: i % 2 === 0,
          source: i % 2 === 0 ? "API" : "MANUAL",
          folderId: folders[0].id,
          repositoryId: repository.id,
          templateId: 1, // Assuming default template ID
          creatorId: i % 2 === 0 ? adminUser.id : regularUser.id,
          stateId: i === 0 ? defaultState.id : i === 1 ? inProgressState.id : doneState.id,
        },
      })
    ),
    // Regression test cases
    ...Array.from({ length: 5 }, async (_, i) =>
      prisma.repositoryCases.create({
        data: {
          projectId: project.id,
          name: `Regression Test ${i + 1}`,
          automated: true,
          source: "JUNIT",
          folderId: folders[1].id,
          repositoryId: repository.id,
          templateId: 1, // Assuming default template ID
          creatorId: adminUser.id,
          stateId: doneState.id,
        },
      })
    ),
    // Integration test cases
    ...Array.from({ length: 5 }, async (_, i) =>
      prisma.repositoryCases.create({
        data: {
          projectId: project.id,
          name: `Integration Test ${i + 1}`,
          automated: i < 3,
          source: i < 3 ? "API" : "MANUAL",
          folderId: folders[2].id,
          repositoryId: repository.id,
          templateId: 1, // Assuming default template ID
          creatorId: regularUser.id,
          stateId: inProgressState.id,
        },
      })
    ),
  ]);

  // Create test runs with all dimension combinations
  const testRuns = [];
  const testRunCases = [];
  const testResults = [];

  // Create test runs for each milestone and configuration combination
  let runIndex = 0;
  for (const milestone of milestones) {
    for (const config of configs) {
      for (const workflowState of [defaultState, inProgressState, doneState]) {
        const testRun = await prisma.testRuns.create({
          data: {
            projectId: project.id,
            name: `Test Run ${++runIndex} - ${milestone.name} - ${config.name}`,
            milestoneId: milestone.id,
            configId: config.id,
            stateId: workflowState.id,
            createdById: adminUser.id,
            isDeleted: false,
          },
        });
        testRuns.push(testRun);

        // Add test cases to this run (select a subset)
        const casesToAdd = testCases.slice((runIndex - 1) * 3, runIndex * 3 + 2);
        
        for (let i = 0; i < casesToAdd.length; i++) {
          const testCase = casesToAdd[i];
          const assignedUser = i % 2 === 0 ? adminUser : regularUser;
          
          const testRunCase = await prisma.testRunCases.create({
            data: {
              testRunId: testRun.id,
              repositoryCaseId: testCase.id,
              assignedToId: assignedUser.id,
              order: i + 1,
            },
          });
          testRunCases.push(testRunCase);

          // Create test results with various statuses
          const statusesToUse = [
            statusMap.passed,
            statusMap.failed,
            statusMap.blocked,
            statusMap.retest,
            statusMap.skipped,
            statusMap.untested,
          ];

          // Create results with different dates and users
          const baseDate = new Date("2025-06-01");
          
          for (let j = 0; j < 3; j++) {
            const status = statusesToUse[j % statusesToUse.length];
            const executor = j % 2 === 0 ? adminUser : regularUser;
            const executionDate = new Date(baseDate);
            executionDate.setDate(baseDate.getDate() + (runIndex + j) % 30);

            // Only create elapsed time for executed statuses
            const hasElapsedTime = ["Passed", "Failed", "Retest"].includes(status.name);
            
            const result = await prisma.testRunResults.create({
              data: {
                testRunId: testRun.id,
                testRunCaseId: testRunCase.id,
                executedById: executor.id,
                statusId: status.id,
                executedAt: executionDate,
                elapsed: hasElapsedTime ? Math.floor(Math.random() * 3600) + 300 : null, // 5-65 minutes
              },
            });
            testResults.push(result);
          }
        }
      }
    }
  }

  // Create some test runs without milestones or configs to test null handling
  const nullDimensionRun = await prisma.testRuns.create({
    data: {
      projectId: project.id,
      name: "Test Run - No Milestone/Config",
      milestoneId: null,
      configId: null,
      stateId: defaultState.id,
      createdById: adminUser.id,
      isDeleted: false,
    },
  });

  // Add cases and results to the null dimension run
  for (let i = 0; i < 3; i++) {
    const testCase = testCases[i];
    const testRunCase = await prisma.testRunCases.create({
      data: {
        testRunId: nullDimensionRun.id,
        repositoryCaseId: testCase.id,
        assignedToId: null, // Also test null assignee
        order: i + 1,
      },
    });

    // Add results
    await prisma.testRunResults.create({
      data: {
        testRunId: nullDimensionRun.id,
        testRunCaseId: testRunCase.id,
        executedById: adminUser.id,
        statusId: statusMap.passed.id,
        executedAt: new Date("2025-06-15"),
        elapsed: 1800, // 30 minutes
      },
    });
  }

  console.log(`Seeded comprehensive test execution data:
    - ${milestones.length} milestones
    - ${configs.length} configurations  
    - ${testCases.length} test cases
    - ${testRuns.length} test runs
    - ${testResults.length} test results
    - Covered all status types: ${Object.keys(statusMap).join(", ")}
    - Date range: June 2025 (various dates)
    - Users: Admin and Regular user
    - Workflow states: Default, In Progress, Done
  `);

  return {
    milestones,
    configs,
    testCases,
    testRuns,
    testResults,
  };
}