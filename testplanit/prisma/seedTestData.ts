import { PrismaClient, TestRunType } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds test data for E2E tests including:
 * - Projects with test cases
 * - Test runs with results
 * - Sessions with results
 * - Comprehensive coverage of different statuses and scenarios
 */
export async function seedTestData() {
  console.log("Seeding test data for E2E tests...");

  // Get admin user to assign as creator
  const adminUser = await prisma.user.findFirst({
    where: { access: "ADMIN", isDeleted: false },
  });

  if (!adminUser) {
    console.error("No admin user found - cannot seed test data");
    return;
  }

  // Get default template
  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
  });

  if (!defaultTemplate) {
    console.error("No default template found - cannot seed test data");
    return;
  }

  // Get statuses
  const passedStatus = await prisma.status.findFirst({
    where: { systemName: "passed" },
  });
  const failedStatus = await prisma.status.findFirst({
    where: { systemName: "failed" },
  });
  const untestedStatus = await prisma.status.findFirst({
    where: { systemName: "untested" },
  });
  const blockedStatus = await prisma.status.findFirst({
    where: { systemName: "blocked" },
  });
  const skippedStatus = await prisma.status.findFirst({
    where: { systemName: "skipped" },
  });

  if (
    !passedStatus ||
    !failedStatus ||
    !untestedStatus ||
    !blockedStatus ||
    !skippedStatus
  ) {
    console.error("Missing required statuses - cannot seed test data");
    return;
  }

  // Get default workflow states
  const sessionNewWorkflow = await prisma.workflows.findFirst({
    where: { scope: "SESSIONS", isDefault: true },
  });
  const runNewWorkflow = await prisma.workflows.findFirst({
    where: { scope: "RUNS", isDefault: true },
  });

  if (!sessionNewWorkflow || !runNewWorkflow) {
    console.error("Missing default workflows - cannot seed test data");
    return;
  }

  // Create E2E Test Project
  const e2eProject = await prisma.projects.upsert({
    where: { name: "E2E Test Project" },
    update: {},
    create: {
      name: "E2E Test Project",
      createdBy: adminUser.id,
      defaultAccessType: "GLOBAL_ROLE",
    },
  });

  console.log(`Created/updated E2E Test Project (ID: ${e2eProject.id})`);

  // Get or create repository for the project
  let repository = await prisma.repositories.findFirst({
    where: { projectId: e2eProject.id },
  });

  if (!repository) {
    repository = await prisma.repositories.create({
      data: { projectId: e2eProject.id },
    });
  }

  // Get or create root folder
  let rootFolder = await prisma.repositoryFolders.findFirst({
    where: { projectId: e2eProject.id, parentId: null },
  });

  if (!rootFolder) {
    rootFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Root",
        projectId: e2eProject.id,
        repositoryId: repository.id,
        order: 0,
        creatorId: adminUser.id,
        docs: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      },
    });
  }

  // Get a workflow state for test cases
  const caseWorkflow = await prisma.workflows.findFirst({
    where: { scope: "CASES", isDefault: true },
  });

  if (!caseWorkflow) {
    console.error("No default CASES workflow found - cannot seed test data");
    return;
  }

  // Create test cases for the project
  const testCase1 = await prisma.repositoryCases.create({
    data: {
      name: "Login with valid credentials",
      projectId: e2eProject.id,
      repositoryId: repository.id,
      folderId: rootFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseWorkflow.id,
      currentVersion: 1,
    },
  });

  const testCase2 = await prisma.repositoryCases.create({
    data: {
      name: "User profile update",
      projectId: e2eProject.id,
      repositoryId: repository.id,
      folderId: rootFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseWorkflow.id,
      currentVersion: 1,
    },
  });

  const testCase3 = await prisma.repositoryCases.create({
    data: {
      name: "Password reset flow",
      projectId: e2eProject.id,
      repositoryId: repository.id,
      folderId: rootFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseWorkflow.id,
      currentVersion: 1,
    },
  });

  const testCase4 = await prisma.repositoryCases.create({
    data: {
      name: "Checkout process",
      projectId: e2eProject.id,
      repositoryId: repository.id,
      folderId: rootFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseWorkflow.id,
      currentVersion: 1,
    },
  });

  const testCase5 = await prisma.repositoryCases.create({
    data: {
      name: "Search functionality",
      projectId: e2eProject.id,
      repositoryId: repository.id,
      folderId: rootFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseWorkflow.id,
      currentVersion: 1,
    },
  });

  console.log("Created 5 test cases");

  // Create Test Run #1 - Regular with mixed results
  const testRun1 = await prisma.testRuns.create({
    data: {
      name: "Smoke Test - Build 1.2.3",
      projectId: e2eProject.id,
      createdById: adminUser.id,
      stateId: runNewWorkflow.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: true,
      completedAt: new Date(Date.now() - 86400000), // 1 day ago
      elapsed: 3600, // 1 hour in seconds
    },
  });

  // Add test cases to run
  await prisma.testRunCases.createMany({
    data: [
      {
        testRunId: testRun1.id,
        repositoryCaseId: testCase1.id,
        order: 1,
      },
      {
        testRunId: testRun1.id,
        repositoryCaseId: testCase2.id,
        order: 2,
      },
      {
        testRunId: testRun1.id,
        repositoryCaseId: testCase3.id,
        order: 3,
      },
      {
        testRunId: testRun1.id,
        repositoryCaseId: testCase4.id,
        order: 4,
      },
      {
        testRunId: testRun1.id,
        repositoryCaseId: testCase5.id,
        order: 5,
      },
    ],
  });

  // Create results for test run 1
  const testRunCases1 = await prisma.testRunCases.findMany({
    where: { testRunId: testRun1.id },
    orderBy: { order: "asc" },
  });

  await prisma.testRunResults.createMany({
    data: [
      {
        testRunId: testRun1.id,
        testRunCaseId: testRunCases1[0].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 120, // 2 minutes
      },
      {
        testRunId: testRun1.id,
        testRunCaseId: testRunCases1[1].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 180, // 3 minutes
      },
      {
        testRunId: testRun1.id,
        testRunCaseId: testRunCases1[2].id,
        statusId: failedStatus.id,
        executedById: adminUser.id,
        elapsed: 240, // 4 minutes
      },
      {
        testRunId: testRun1.id,
        testRunCaseId: testRunCases1[3].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 300, // 5 minutes
      },
      // testCase5 left untested
    ],
  });

  // Update TestRunCases with status from results
  await prisma.testRunCases.update({
    where: { id: testRunCases1[0].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases1[1].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases1[2].id },
    data: { statusId: failedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases1[3].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });

  console.log(
    `Created Test Run #1 "${testRun1.name}" with 4 results (3 passed, 1 failed, 1 untested)`
  );

  // Create Test Run #2 - Regular (all passed)
  const testRun2 = await prisma.testRuns.create({
    data: {
      name: "Regression Suite - Automated",
      projectId: e2eProject.id,
      createdById: adminUser.id,
      stateId: runNewWorkflow.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: true,
      completedAt: new Date(Date.now() - 43200000), // 12 hours ago
      elapsed: 1200, // 20 minutes
    },
  });

  await prisma.testRunCases.createMany({
    data: [
      {
        testRunId: testRun2.id,
        repositoryCaseId: testCase1.id,
        order: 1,
      },
      {
        testRunId: testRun2.id,
        repositoryCaseId: testCase2.id,
        order: 2,
      },
      {
        testRunId: testRun2.id,
        repositoryCaseId: testCase3.id,
        order: 3,
      },
    ],
  });

  const testRunCases2 = await prisma.testRunCases.findMany({
    where: { testRunId: testRun2.id },
    orderBy: { order: "asc" },
  });

  await prisma.testRunResults.createMany({
    data: [
      {
        testRunId: testRun2.id,
        testRunCaseId: testRunCases2[0].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 45,
      },
      {
        testRunId: testRun2.id,
        testRunCaseId: testRunCases2[1].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 60,
      },
      {
        testRunId: testRun2.id,
        testRunCaseId: testRunCases2[2].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 55,
      },
    ],
  });

  // Update TestRunCases with status from results
  await prisma.testRunCases.update({
    where: { id: testRunCases2[0].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases2[1].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases2[2].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });

  console.log(
    `Created Test Run #2 "${testRun2.name}" with 3 results (all passed)`
  );

  // Create Test Run #3 - In progress
  const testRun3 = await prisma.testRuns.create({
    data: {
      name: "Sprint 5 Acceptance Tests",
      projectId: e2eProject.id,
      createdById: adminUser.id,
      stateId: runNewWorkflow.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: false,
    },
  });

  await prisma.testRunCases.createMany({
    data: [
      {
        testRunId: testRun3.id,
        repositoryCaseId: testCase1.id,
        order: 1,
      },
      {
        testRunId: testRun3.id,
        repositoryCaseId: testCase4.id,
        order: 2,
      },
      {
        testRunId: testRun3.id,
        repositoryCaseId: testCase5.id,
        order: 3,
      },
    ],
  });

  const testRunCases3 = await prisma.testRunCases.findMany({
    where: { testRunId: testRun3.id },
    orderBy: { order: "asc" },
  });

  // Partially completed
  await prisma.testRunResults.createMany({
    data: [
      {
        testRunId: testRun3.id,
        testRunCaseId: testRunCases3[0].id,
        statusId: passedStatus.id,
        executedById: adminUser.id,
        elapsed: 90,
      },
      {
        testRunId: testRun3.id,
        testRunCaseId: testRunCases3[1].id,
        statusId: blockedStatus.id,
        executedById: adminUser.id,
        elapsed: 30,
      },
      // testCase5 not yet tested
    ],
  });

  // Update TestRunCases with status from results (blocked is not completed)
  await prisma.testRunCases.update({
    where: { id: testRunCases3[0].id },
    data: { statusId: passedStatus.id, isCompleted: true },
  });
  await prisma.testRunCases.update({
    where: { id: testRunCases3[1].id },
    data: { statusId: blockedStatus.id, isCompleted: false },
  });

  console.log(
    `Created Test Run #3 "${testRun3.name}" with 2 results (1 passed, 1 blocked, 1 untested)`
  );

  // Create Session #1 - Exploratory with varied results
  const session1 = await prisma.sessions.create({
    data: {
      name: "Exploratory Testing - User Management",
      projectId: e2eProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: sessionNewWorkflow.id,
      isCompleted: true,
      completedAt: new Date(Date.now() - 172800000), // 2 days ago
      elapsed: 7200, // 2 hours
    },
  });

  // Create session results
  await prisma.sessionResults.createMany({
    data: [
      {
        sessionId: session1.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 600,
        resultData: {
          title: "User creation flow",
          notes: "Successfully created user with all required fields",
        },
      },
      {
        sessionId: session1.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 720,
        resultData: {
          title: "User edit flow",
          notes: "All fields can be edited and saved correctly",
        },
      },
      {
        sessionId: session1.id,
        statusId: failedStatus.id,
        createdById: adminUser.id,
        elapsed: 480,
        resultData: {
          title: "User deletion",
          notes: "Delete confirmation dialog not appearing consistently",
        },
      },
      {
        sessionId: session1.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 540,
        resultData: {
          title: "User search",
          notes: "Search works for name and email",
        },
      },
      {
        sessionId: session1.id,
        statusId: failedStatus.id,
        createdById: adminUser.id,
        elapsed: 660,
        resultData: {
          title: "Permission management",
          notes: "Cannot assign multiple roles to user - UI error",
        },
      },
    ],
  });

  console.log(
    `Created Session #1 "${session1.name}" with 5 results (3 passed, 2 failed)`
  );

  // Create Session #2 - All passed
  const session2 = await prisma.sessions.create({
    data: {
      name: "Security Testing - Authentication",
      projectId: e2eProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: sessionNewWorkflow.id,
      isCompleted: true,
      completedAt: new Date(Date.now() - 86400000), // 1 day ago
      elapsed: 5400, // 1.5 hours
    },
  });

  await prisma.sessionResults.createMany({
    data: [
      {
        sessionId: session2.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 900,
        resultData: {
          title: "SQL injection attempts",
          notes: "All input fields properly sanitized",
        },
      },
      {
        sessionId: session2.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 1200,
        resultData: {
          title: "Session timeout",
          notes: "Sessions expire correctly after inactivity",
        },
      },
      {
        sessionId: session2.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 800,
        resultData: {
          title: "Password complexity",
          notes: "Weak passwords rejected with helpful messages",
        },
      },
    ],
  });

  console.log(
    `Created Session #2 "${session2.name}" with 3 results (all passed)`
  );

  // Create Session #3 - In progress
  const session3 = await prisma.sessions.create({
    data: {
      name: "Performance Testing - Dashboard Load",
      projectId: e2eProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: sessionNewWorkflow.id,
      isCompleted: false,
    },
  });

  await prisma.sessionResults.createMany({
    data: [
      {
        sessionId: session3.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 300,
        resultData: {
          title: "Initial load time",
          notes: "Dashboard loads in under 2 seconds",
        },
      },
      {
        sessionId: session3.id,
        statusId: skippedStatus.id,
        createdById: adminUser.id,
        elapsed: 0,
        resultData: {
          title: "Large dataset performance",
          notes: "Skipped - need production data dump",
        },
      },
    ],
  });

  console.log(
    `Created Session #3 "${session3.name}" with 2 results (1 passed, 1 skipped)`
  );

  // Create an empty test run
  const emptyTestRun = await prisma.testRuns.create({
    data: {
      name: "Empty Test Run",
      projectId: e2eProject.id,
      createdById: adminUser.id,
      stateId: runNewWorkflow.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: false,
    },
  });

  console.log(`Created empty Test Run "${emptyTestRun.name}"`);

  // Create an empty session
  const emptySession = await prisma.sessions.create({
    data: {
      name: "Empty Session",
      projectId: e2eProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: sessionNewWorkflow.id,
      isCompleted: false,
    },
  });

  console.log(`Created empty Session "${emptySession.name}"`);

  console.log("\n✅ Test data seeding complete!");
  console.log("\nCreated:");
  console.log(`  - 1 E2E Test Project (ID: ${e2eProject.id})`);
  console.log(`  - 5 Test Cases`);
  console.log(`  - 4 Test Runs (3 with results, 1 empty)`);
  console.log(`  - 4 Sessions (3 with results, 1 empty)`);
  console.log(`  - Multiple test results and session results with varied statuses`);
}

// Allow running this file directly for testing
if (require.main === module) {
  seedTestData()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
