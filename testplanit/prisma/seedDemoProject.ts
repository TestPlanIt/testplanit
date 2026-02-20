import { PrismaClient, TestRunType } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS);

/** Simple TipTap paragraph node */
function tiptapText(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { class: null, textAlign: "left" },
        content: [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Seeds a "Demo Project" with sample data showcasing all major features:
 * Documentation, Milestones, Repository Cases, Test Runs, Sessions, and Tags.
 *
 * Uses only existing seeded entities (admin user, default template, workflows, statuses).
 * Idempotent: skips creation if Demo Project already has data.
 */
export async function seedDemoProject() {
  console.log("\n--- Seeding Demo Project ---");

  // --- Look up prerequisite entities ---

  const adminUser = await prisma.user.findFirst({
    where: { access: "ADMIN", isDeleted: false },
  });
  if (!adminUser) {
    console.error("No admin user found - cannot seed demo project");
    return;
  }

  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
  });
  if (!defaultTemplate) {
    console.error("No default template found - cannot seed demo project");
    return;
  }

  // Statuses
  const [
    passedStatus,
    failedStatus,
    untestedStatus,
    blockedStatus,
    skippedStatus,
    retestStatus,
  ] = await Promise.all([
    prisma.status.findFirst({ where: { systemName: "passed" } }),
    prisma.status.findFirst({ where: { systemName: "failed" } }),
    prisma.status.findFirst({ where: { systemName: "untested" } }),
    prisma.status.findFirst({ where: { systemName: "blocked" } }),
    prisma.status.findFirst({ where: { systemName: "skipped" } }),
    prisma.status.findFirst({ where: { systemName: "retest" } }),
  ]);
  if (
    !passedStatus ||
    !failedStatus ||
    !untestedStatus ||
    !blockedStatus ||
    !skippedStatus ||
    !retestStatus
  ) {
    console.error("Missing required statuses - cannot seed demo project");
    return;
  }

  // Workflows
  const [
    caseDefaultWorkflow,
    caseActiveWorkflow,
    runDefaultWorkflow,
    sessionDefaultWorkflow,
  ] = await Promise.all([
    prisma.workflows.findFirst({ where: { scope: "CASES", isDefault: true } }),
    prisma.workflows.findFirst({ where: { scope: "CASES", name: "Active" } }),
    prisma.workflows.findFirst({ where: { scope: "RUNS", isDefault: true } }),
    prisma.workflows.findFirst({
      where: { scope: "SESSIONS", isDefault: true },
    }),
  ]);
  if (
    !caseDefaultWorkflow ||
    !caseActiveWorkflow ||
    !runDefaultWorkflow ||
    !sessionDefaultWorkflow
  ) {
    console.error("Missing required workflows - cannot seed demo project");
    return;
  }

  // Run workflow states for completed runs
  const runDoneWorkflow = await prisma.workflows.findFirst({
    where: { scope: "RUNS", name: "Done" },
  });
  const sessionDoneWorkflow = await prisma.workflows.findFirst({
    where: { scope: "SESSIONS", name: "Done" },
  });
  const runInProgressWorkflow = await prisma.workflows.findFirst({
    where: { scope: "RUNS", name: "In Progress" },
  });
  const sessionInProgressWorkflow = await prisma.workflows.findFirst({
    where: { scope: "SESSIONS", name: "In Progress" },
  });

  // Milestone types
  const sprintType = await prisma.milestoneTypes.findFirst({
    where: { name: "Sprint" },
  });
  const releaseType = await prisma.milestoneTypes.findFirst({
    where: { name: "Release" },
  });
  if (!sprintType || !releaseType) {
    console.error("Missing milestone types - cannot seed demo project");
    return;
  }

  // Case fields for field values
  const priorityField = await prisma.caseFields.findUnique({
    where: { systemName: "priority" },
  });
  const descriptionField = await prisma.caseFields.findUnique({
    where: { systemName: "description" },
  });
  if (!priorityField || !descriptionField) {
    console.error("Missing case fields - cannot seed demo project");
    return;
  }

  // Priority field options
  const [priorityHigh, priorityMedium, priorityLow] = await Promise.all([
    prisma.fieldOptions.findFirst({ where: { name: "High" } }),
    prisma.fieldOptions.findFirst({ where: { name: "Medium" } }),
    prisma.fieldOptions.findFirst({ where: { name: "Low" } }),
  ]);

  // --- 1. Tags (global, upsert) ---

  const [tagSmoke, tagRegression, tagUI] = await Promise.all([
    prisma.tags.upsert({
      where: { name: "Smoke" },
      update: {},
      create: { name: "Smoke" },
    }),
    prisma.tags.upsert({
      where: { name: "Regression" },
      update: {},
      create: { name: "Regression" },
    }),
    prisma.tags.upsert({
      where: { name: "UI" },
      update: {},
      create: { name: "UI" },
    }),
  ]);
  console.log("Seeded tags: Smoke, Regression, UI");

  // --- 2. Project ---

  const docsContent = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { textAlign: "left", level: 2 },
        content: [{ type: "text", text: "Demo Project Documentation" }],
      },
      {
        type: "paragraph",
        attrs: { class: null, textAlign: "left" },
        content: [
          {
            type: "text",
            text: "Welcome to the Demo Project! This project is pre-populated with sample data to help you explore TestPlanIt's core features. Feel free to modify, add, or delete any of the data here.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { textAlign: "left", level: 3 },
        content: [{ type: "text", text: "Getting Started" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { class: null, textAlign: "left" },
                content: [
                  {
                    type: "text",
                    marks: [{ type: "bold" }],
                    text: "Repository",
                  },
                  {
                    type: "text",
                    text: " — Browse test cases organized in folders with steps, priorities, and descriptions",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { class: null, textAlign: "left" },
                content: [
                  {
                    type: "text",
                    marks: [{ type: "bold" }],
                    text: "Test Runs",
                  },
                  {
                    type: "text",
                    text: " — Execute test cases and record pass/fail results with notes",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { class: null, textAlign: "left" },
                content: [
                  { type: "text", marks: [{ type: "bold" }], text: "Sessions" },
                  {
                    type: "text",
                    text: " — Conduct exploratory testing sessions and capture findings",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { class: null, textAlign: "left" },
                content: [
                  {
                    type: "text",
                    marks: [{ type: "bold" }],
                    text: "Milestones",
                  },
                  {
                    type: "text",
                    text: " — Track progress against sprints, releases, and other goals",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { class: null, textAlign: "left" },
                content: [
                  { type: "text", marks: [{ type: "bold" }], text: "Tags" },
                  {
                    type: "text",
                    text: " — Organize and filter test cases, runs, and sessions by category",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { textAlign: "left", level: 3 },
        content: [{ type: "text", text: "Cleanup" }],
      },
      {
        type: "paragraph",
        attrs: { class: null, textAlign: "left" },
        content: [
          {
            type: "text",
            text: "When you're done exploring, you can remove this demo data by deleting the project from Admin > Projects. All associated test cases, runs, sessions, and milestones will be cleaned up automatically.",
          },
        ],
      },
    ],
  });

  const demoProject = await prisma.projects.upsert({
    where: { name: "Demo Project" },
    update: { docs: docsContent },
    create: {
      name: "Demo Project",
      docs: docsContent,
      createdBy: adminUser.id,
      defaultAccessType: "GLOBAL_ROLE",
    },
  });
  console.log(`Created/updated Demo Project (ID: ${demoProject.id})`);

  // Assign all enabled statuses to the project (required for status dropdowns)
  const allStatuses = await prisma.status.findMany({
    where: { isEnabled: true },
  });
  for (const status of allStatuses) {
    await prisma.projectStatusAssignment.upsert({
      where: {
        statusId_projectId: { statusId: status.id, projectId: demoProject.id },
      },
      update: {},
      create: { statusId: status.id, projectId: demoProject.id },
    });
  }
  console.log(`Assigned ${allStatuses.length} statuses to Demo Project`);

  // Assign the default template to the project
  await prisma.templateProjectAssignment.upsert({
    where: {
      templateId_projectId: {
        templateId: defaultTemplate.id,
        projectId: demoProject.id,
      },
    },
    update: {},
    create: { templateId: defaultTemplate.id, projectId: demoProject.id },
  });
  console.log("Assigned Default Template to Demo Project");

  // Check if demo project already has data (idempotency)
  const existingCases = await prisma.repositoryCases.count({
    where: { projectId: demoProject.id, isDeleted: false },
  });
  if (existingCases > 0) {
    console.log("Demo Project already has data - skipping child data creation");
    return;
  }

  // --- 3. Milestones ---

  const sprint1 = await prisma.milestones.create({
    data: {
      name: "Sprint 1",
      projectId: demoProject.id,
      milestoneTypesId: sprintType.id,
      createdBy: adminUser.id,
      isStarted: true,
      isCompleted: true,
      startedAt: daysAgo(28),
      completedAt: daysAgo(14),
      createdAt: daysAgo(28),
    },
  });

  const sprint2 = await prisma.milestones.create({
    data: {
      name: "Sprint 2",
      projectId: demoProject.id,
      milestoneTypesId: sprintType.id,
      createdBy: adminUser.id,
      isStarted: true,
      isCompleted: false,
      startedAt: daysAgo(7),
      createdAt: daysAgo(7),
    },
  });

  const releaseV1 = await prisma.milestones.create({
    data: {
      name: "v1.0 Release",
      projectId: demoProject.id,
      milestoneTypesId: releaseType.id,
      createdBy: adminUser.id,
      isStarted: false,
      isCompleted: false,
      completedAt: daysFromNow(21),
      createdAt: daysAgo(28),
    },
  });

  console.log("Created 3 milestones: Sprint 1, Sprint 2, v1.0 Release");

  // --- 4. Repository & Folders ---

  const repository = await prisma.repositories.create({
    data: { projectId: demoProject.id },
  });

  const authFolder = await prisma.repositoryFolders.create({
    data: {
      name: "Authentication",
      projectId: demoProject.id,
      repositoryId: repository.id,
      order: 0,
      creatorId: adminUser.id,
      docs: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    },
  });

  const dashFolder = await prisma.repositoryFolders.create({
    data: {
      name: "Dashboard",
      projectId: demoProject.id,
      repositoryId: repository.id,
      order: 1,
      creatorId: adminUser.id,
      docs: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    },
  });

  console.log("Created repository with folders: Authentication, Dashboard");

  // --- 4b. Shared Steps ---

  const sharedStepGroup = await prisma.sharedStepGroup.create({
    data: {
      name: "Login Prerequisites",
      projectId: demoProject.id,
      createdById: adminUser.id,
    },
  });

  await prisma.sharedStepItem.createMany({
    data: [
      {
        sharedStepGroupId: sharedStepGroup.id,
        order: 1,
        step: JSON.stringify(
          tiptapText("Open the application URL in a supported browser")
        ),
        expectedResult: JSON.stringify(
          tiptapText("Application home page loads successfully")
        ),
      },
      {
        sharedStepGroupId: sharedStepGroup.id,
        order: 2,
        step: JSON.stringify(tiptapText("Verify the login page is accessible")),
        expectedResult: JSON.stringify(
          tiptapText("Login form is displayed with email and password fields")
        ),
      },
    ],
  });

  console.log('Created shared step group: "Login Prerequisites" (2 items)');

  // --- 5. Repository Cases ---

  // Case 1: User login with valid credentials
  const case1 = await prisma.repositoryCases.create({
    data: {
      name: "User login with valid credentials",
      projectId: demoProject.id,
      repositoryId: repository.id,
      folderId: authFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseActiveWorkflow.id,
      order: 1,
      currentVersion: 1,
      tags: { connect: [{ id: tagSmoke.id }, { id: tagRegression.id }] },
    },
  });
  await createCaseFieldValues(
    case1.id,
    priorityField.id,
    descriptionField.id,
    priorityHigh?.id,
    "Verify that users can log in with valid email and password"
  );
  await createSharedStepPlaceholder(case1.id, sharedStepGroup.id, 1);
  await createSteps(
    case1.id,
    [
      {
        step: "Enter valid email and password",
        expected: "Credentials are accepted",
      },
      {
        step: "Click the Sign In button",
        expected: "User is redirected to the dashboard",
      },
    ],
    2
  );

  // Case 2: User registration
  const case2 = await prisma.repositoryCases.create({
    data: {
      name: "User registration",
      projectId: demoProject.id,
      repositoryId: repository.id,
      folderId: authFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseActiveWorkflow.id,
      order: 2,
      currentVersion: 1,
      tags: { connect: [{ id: tagRegression.id }] },
    },
  });
  await createCaseFieldValues(
    case2.id,
    priorityField.id,
    descriptionField.id,
    priorityMedium?.id,
    "Verify new user registration flow with required fields"
  );
  await createSharedStepPlaceholder(case2.id, sharedStepGroup.id, 1);
  await createSteps(
    case2.id,
    [
      {
        step: "Navigate to the registration page",
        expected: "Registration form is displayed",
      },
      {
        step: "Fill in name, email, and password",
        expected: "Form validates input in real time",
      },
      {
        step: "Submit the registration form",
        expected: "Account is created and confirmation message shown",
      },
    ],
    2
  );

  // Case 3: Password reset flow
  const case3 = await prisma.repositoryCases.create({
    data: {
      name: "Password reset flow",
      projectId: demoProject.id,
      repositoryId: repository.id,
      folderId: authFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseActiveWorkflow.id,
      order: 3,
      currentVersion: 1,
      tags: { connect: [{ id: tagRegression.id }] },
    },
  });
  await createCaseFieldValues(
    case3.id,
    priorityField.id,
    descriptionField.id,
    priorityMedium?.id,
    "Verify password reset via email link"
  );
  await createSharedStepPlaceholder(case3.id, sharedStepGroup.id, 1);
  await createSteps(
    case3.id,
    [
      {
        step: "Click Forgot Password on the login page",
        expected: "Password reset form appears",
      },
      {
        step: "Enter registered email address",
        expected: "Success message displayed",
      },
      {
        step: "Open the reset link from email",
        expected: "New password form is shown",
      },
      {
        step: "Enter and confirm new password",
        expected: "Password is updated and user can log in",
      },
    ],
    2
  );

  // Case 4: Dashboard widgets load correctly
  const case4 = await prisma.repositoryCases.create({
    data: {
      name: "Dashboard widgets load correctly",
      projectId: demoProject.id,
      repositoryId: repository.id,
      folderId: dashFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseActiveWorkflow.id,
      order: 1,
      currentVersion: 1,
      tags: { connect: [{ id: tagSmoke.id }, { id: tagUI.id }] },
    },
  });
  await createCaseFieldValues(
    case4.id,
    priorityField.id,
    descriptionField.id,
    priorityHigh?.id,
    "Verify all dashboard widgets render with correct data"
  );
  await createSteps(case4.id, [
    {
      step: "Navigate to the project dashboard",
      expected: "Dashboard page loads without errors",
    },
    {
      step: "Verify all widgets display data",
      expected: "Charts, counters, and tables show correct information",
    },
  ]);

  // Case 5: Export dashboard data
  const case5 = await prisma.repositoryCases.create({
    data: {
      name: "Export dashboard data",
      projectId: demoProject.id,
      repositoryId: repository.id,
      folderId: dashFolder.id,
      templateId: defaultTemplate.id,
      creatorId: adminUser.id,
      stateId: caseDefaultWorkflow.id, // Draft
      order: 2,
      currentVersion: 1,
      tags: { connect: [{ id: tagUI.id }] },
    },
  });
  await createCaseFieldValues(
    case5.id,
    priorityField.id,
    descriptionField.id,
    priorityLow?.id,
    "Verify dashboard data can be exported in supported formats"
  );
  await createSteps(case5.id, [
    {
      step: "Navigate to the dashboard page",
      expected: "Dashboard is displayed",
    },
    {
      step: "Click the Export button",
      expected: "Export format options are shown",
    },
    {
      step: "Select CSV format and confirm",
      expected: "File downloads with correct data",
    },
  ]);

  console.log("Created 5 repository cases with steps, field values, and tags");

  // --- 6. Test Runs ---

  // Test Run 1: Sprint 1 - Smoke Test (completed)
  const testRun1 = await prisma.testRuns.create({
    data: {
      name: "Sprint 1 - Smoke Test",
      projectId: demoProject.id,
      createdById: adminUser.id,
      stateId: (runDoneWorkflow ?? runDefaultWorkflow).id,
      milestoneId: sprint1.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: true,
      completedAt: daysAgo(15),
      createdAt: daysAgo(16),
      elapsed: 2700,
      tags: { connect: [{ id: tagSmoke.id }] },
    },
  });

  await prisma.testRunCases.createMany({
    data: [
      { testRunId: testRun1.id, repositoryCaseId: case1.id, order: 1 },
      { testRunId: testRun1.id, repositoryCaseId: case2.id, order: 2 },
      { testRunId: testRun1.id, repositoryCaseId: case3.id, order: 3 },
      { testRunId: testRun1.id, repositoryCaseId: case4.id, order: 4 },
      { testRunId: testRun1.id, repositoryCaseId: case5.id, order: 5 },
    ],
  });

  const run1Cases = await prisma.testRunCases.findMany({
    where: { testRunId: testRun1.id },
    orderBy: { order: "asc" },
  });

  // Results: Passed, Passed, Failed, Passed, Blocked
  const run1Statuses = [
    passedStatus,
    passedStatus,
    failedStatus,
    passedStatus,
    blockedStatus,
  ];
  const run1Elapsed = [120, 180, 240, 150, 30];
  for (let i = 0; i < run1Cases.length; i++) {
    await prisma.testRunResults.create({
      data: {
        testRunId: testRun1.id,
        testRunCaseId: run1Cases[i].id,
        statusId: run1Statuses[i].id,
        executedById: adminUser.id,
        elapsed: run1Elapsed[i],
        executedAt: daysAgo(15),
      },
    });
    await prisma.testRunCases.update({
      where: { id: run1Cases[i].id },
      data: {
        statusId: run1Statuses[i].id,
        isCompleted: run1Statuses[i].isCompleted,
      },
    });
  }

  console.log(
    'Created Test Run 1: "Sprint 1 - Smoke Test" (3 passed, 1 failed, 1 blocked)'
  );

  // Test Run 2: Sprint 2 - Regression (in progress)
  const testRun2 = await prisma.testRuns.create({
    data: {
      name: "Sprint 2 - Regression",
      projectId: demoProject.id,
      createdById: adminUser.id,
      stateId: (runInProgressWorkflow ?? runDefaultWorkflow).id,
      milestoneId: sprint2.id,
      testRunType: TestRunType.REGULAR,
      isCompleted: false,
      createdAt: daysAgo(5),
      tags: { connect: [{ id: tagRegression.id }] },
    },
  });

  await prisma.testRunCases.createMany({
    data: [
      { testRunId: testRun2.id, repositoryCaseId: case1.id, order: 1 },
      { testRunId: testRun2.id, repositoryCaseId: case2.id, order: 2 },
      { testRunId: testRun2.id, repositoryCaseId: case3.id, order: 3 },
      { testRunId: testRun2.id, repositoryCaseId: case4.id, order: 4 },
    ],
  });

  const run2Cases = await prisma.testRunCases.findMany({
    where: { testRunId: testRun2.id },
    orderBy: { order: "asc" },
  });

  // Results: Passed, Retest, untested (no result), Passed
  const run2Results = [
    { statusId: passedStatus.id, elapsed: 90 },
    { statusId: retestStatus.id, elapsed: 200 },
    null, // untested — no result row
    { statusId: passedStatus.id, elapsed: 110 },
  ];
  for (let i = 0; i < run2Cases.length; i++) {
    if (run2Results[i]) {
      await prisma.testRunResults.create({
        data: {
          testRunId: testRun2.id,
          testRunCaseId: run2Cases[i].id,
          statusId: run2Results[i]!.statusId,
          executedById: adminUser.id,
          elapsed: run2Results[i]!.elapsed,
          executedAt: daysAgo(3),
        },
      });
      await prisma.testRunCases.update({
        where: { id: run2Cases[i].id },
        data: {
          statusId: run2Results[i]!.statusId,
          isCompleted: run2Results[i]!.statusId === passedStatus.id,
        },
      });
    }
  }

  console.log(
    'Created Test Run 2: "Sprint 2 - Regression" (2 passed, 1 retest, 1 untested)'
  );

  // --- 7. Sessions ---

  // Session 1: Exploratory - Login Flows (completed)
  const session1 = await prisma.sessions.create({
    data: {
      name: "Exploratory - Login Flows",
      projectId: demoProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: (sessionDoneWorkflow ?? sessionDefaultWorkflow).id,
      milestoneId: sprint1.id,
      isCompleted: true,
      completedAt: daysAgo(17),
      createdAt: daysAgo(18),
      elapsed: 3600,
      mission: JSON.stringify(
        tiptapText(
          "Explore the login and authentication flows end-to-end. Focus on edge cases around " +
            "form validation, error messaging, and session persistence. Try to break the login " +
            "with unusual inputs and verify that users get clear, actionable feedback."
        )
      ),
      note: JSON.stringify(
        tiptapText(
          "Tested on Chrome 120 and Firefox 121. Used a mix of valid accounts, locked accounts, " +
            "and brand-new registrations. Spent extra time on the error handling paths since those " +
            "were rewritten in Sprint 1."
        )
      ),
      tags: { connect: [{ id: tagSmoke.id }] },
    },
  });

  await prisma.sessionResults.createMany({
    data: [
      {
        sessionId: session1.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 900,
        resultData: tiptapText(
          "Tested the standard login flow with three different accounts. Entered valid email " +
            "and password, confirmed the form submits correctly each time. Also tried leaving " +
            "fields empty — the inline validation messages appear immediately and are clear. " +
            "Marking as passed because the happy path and basic validation both work as expected."
        ),
      },
      {
        sessionId: session1.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 720,
        resultData: tiptapText(
          "Checked the 'Remember me' checkbox during login and closed the browser. Reopened " +
            "and confirmed the session was still active without needing to re-enter credentials. " +
            "Also verified that unchecking it correctly ends the session on browser close. " +
            "Behavior matches requirements — passed."
        ),
      },
      {
        sessionId: session1.id,
        statusId: failedStatus.id,
        createdById: adminUser.id,
        elapsed: 480,
        resultData: tiptapText(
          "Tried logging in with a correct email but wrong password. The error message just " +
            "says 'Login failed' with no additional context. Users can't tell if they mistyped " +
            "their password, if the account is locked, or if the email doesn't exist. Compared " +
            "to competitors that say 'Invalid email or password' — our message is less helpful. " +
            "Marking as failed because this will generate support tickets."
        ),
      },
    ],
  });

  console.log(
    'Created Session 1: "Exploratory - Login Flows" (2 passed, 1 failed)'
  );

  // Session 2: Exploratory - Dashboard UX (in progress)
  const session2 = await prisma.sessions.create({
    data: {
      name: "Exploratory - Dashboard UX",
      projectId: demoProject.id,
      templateId: defaultTemplate.id,
      createdById: adminUser.id,
      stateId: (sessionInProgressWorkflow ?? sessionDefaultWorkflow).id,
      milestoneId: sprint2.id,
      isCompleted: false,
      createdAt: daysAgo(3),
      mission: JSON.stringify(
        tiptapText(
          "Evaluate the dashboard experience across different screen sizes and data states. " +
            "Check widget rendering, data accuracy, and how the UI handles empty or loading " +
            "states. Look for any visual regressions introduced in Sprint 2."
        )
      ),
      note: JSON.stringify(
        tiptapText(
          "Started testing on a 1080p monitor and a 13-inch laptop. Still need to check " +
            "tablet and mobile breakpoints. Will resume after the latest widget changes are merged."
        )
      ),
      tags: { connect: [{ id: tagUI.id }] },
    },
  });

  await prisma.sessionResults.createMany({
    data: [
      {
        sessionId: session2.id,
        statusId: passedStatus.id,
        createdById: adminUser.id,
        elapsed: 600,
        resultData: tiptapText(
          "Resized the browser window from 1920px down to 768px and watched the dashboard " +
            "reflow. All widgets stacked cleanly into a single column on narrow viewports. " +
            "Charts re-rendered at the new size without clipping or overflow. The summary " +
            "cards maintained readable font sizes throughout. No visual issues — passed."
        ),
      },
      {
        sessionId: session2.id,
        statusId: skippedStatus.id,
        createdById: adminUser.id,
        elapsed: 0,
        resultData: tiptapText(
          "Intended to test dashboard load times with 10k+ test cases in the project, but " +
            "we don't have a dataset that large in this environment yet. Need to either import " +
            "a production snapshot or generate synthetic data before this can be meaningfully " +
            "tested. Skipping for now — will revisit once the test data generator is ready."
        ),
      },
    ],
  });

  console.log(
    'Created Session 2: "Exploratory - Dashboard UX" (1 passed, 1 skipped)'
  );

  // --- 8. Issues ---

  // Find the failed test run result (case3 - password reset in run1)
  const failedRunResult = await prisma.testRunResults.findFirst({
    where: { testRunId: testRun1.id, statusId: failedStatus.id },
  });

  // Find the failed session result (session1 - error message quality)
  const failedSessionResult = await prisma.sessionResults.findFirst({
    where: { sessionId: session1.id, statusId: failedStatus.id },
  });

  // Issue 1: Password reset email not sent (linked to failed test run result)
  const issue1 = await prisma.issue.create({
    data: {
      name: "BUG-1",
      title: "Password reset email not sent for some domains",
      description:
        "During Sprint 1 smoke testing, the password reset flow failed because the " +
        "reset email was never delivered for accounts using custom domains. The SMTP " +
        "relay appears to reject non-standard TLDs. Affects all users on custom email domains.",
      status: "Open",
      priority: "high",
      projectId: demoProject.id,
      createdById: adminUser.id,
      createdAt: daysAgo(15),
      ...(failedRunResult
        ? { testRunResults: { connect: [{ id: failedRunResult.id }] } }
        : {}),
    },
  });

  // Issue 2: Login error message lacks detail (linked to failed session result)
  const issue2 = await prisma.issue.create({
    data: {
      name: "BUG-2",
      title: "Login error message is too vague",
      description:
        "The login failure message just says 'Login failed' with no additional context. " +
        "Users cannot tell whether they mistyped their password, the account is locked, " +
        "or the email doesn't exist. Should display a more helpful message like " +
        "'Invalid email or password' to reduce support tickets.",
      status: "Open",
      priority: "medium",
      projectId: demoProject.id,
      createdById: adminUser.id,
      createdAt: daysAgo(17),
      ...(failedSessionResult
        ? { sessionResults: { connect: [{ id: failedSessionResult.id }] } }
        : {}),
    },
  });

  // Issue 3: A resolved issue linked to a test case
  await prisma.issue.create({
    data: {
      name: "BUG-3",
      title: "Remember me checkbox has no effect",
      description:
        "Initially reported during exploratory testing. The 'Remember me' checkbox " +
        "was not persisting the session cookie. Fixed in Sprint 1 patch 1.0.2.",
      status: "Closed",
      priority: "low",
      projectId: demoProject.id,
      createdById: adminUser.id,
      createdAt: daysAgo(20),
      repositoryCases: { connect: [{ id: case1.id }] },
    },
  });

  console.log(
    "Created 3 issues: BUG-1 (open, high), BUG-2 (open, medium), BUG-3 (closed, low)"
  );

  // --- Summary ---

  console.log("\n--- Demo Project seeding complete! ---");
  console.log("\nCreated:");
  console.log(`  - 1 Demo Project (ID: ${demoProject.id})`);
  console.log("  - 3 Tags (Smoke, Regression, UI)");
  console.log("  - 3 Milestones (Sprint 1, Sprint 2, v1.0 Release)");
  console.log("  - 2 Folders (Authentication, Dashboard)");
  console.log("  - 1 Shared Step Group (Login Prerequisites, 2 items)");
  console.log(
    "  - 5 Repository Cases with steps, shared steps, and field values"
  );
  console.log("  - 2 Test Runs with results");
  console.log("  - 2 Sessions with results");
  console.log("  - 3 Issues (2 open, 1 closed)");
  console.log("  - Rich project documentation");
}

// --- Helper Functions ---

async function createCaseFieldValues(
  caseId: number,
  priorityFieldId: number,
  descriptionFieldId: number,
  priorityOptionId: number | undefined,
  description: string
) {
  const values = [];

  if (priorityOptionId) {
    values.push({
      testCaseId: caseId,
      fieldId: priorityFieldId,
      value: priorityOptionId,
    });
  }

  values.push({
    testCaseId: caseId,
    fieldId: descriptionFieldId,
    value: JSON.stringify(tiptapText(description)),
  });

  await prisma.caseFieldValues.createMany({ data: values });
}

async function createSteps(
  caseId: number,
  steps: { step: string; expected: string }[],
  startOrder: number = 1
) {
  await prisma.steps.createMany({
    data: steps.map((s, i) => ({
      testCaseId: caseId,
      order: startOrder + i,
      step: JSON.stringify(tiptapText(s.step)),
      expectedResult: JSON.stringify(tiptapText(s.expected)),
    })),
  });
}

async function createSharedStepPlaceholder(
  caseId: number,
  sharedStepGroupId: number,
  order: number
) {
  await prisma.steps.create({
    data: {
      testCaseId: caseId,
      sharedStepGroupId,
      order,
      step: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      expectedResult: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
    },
  });
}

// Allow running this file directly for testing
if (require.main === module) {
  seedDemoProject()
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
