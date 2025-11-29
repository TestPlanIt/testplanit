import fs from "fs";
import path from "path";
import {
  PrismaClient,
  WorkflowScope,
  ApplicationArea,
  ProjectAccessType,
} from "@prisma/client";
import { seedFieldIcons } from "./seedFieldIcons";
import { seedMilestoneEdgeCases } from "./seedMilestoneEdgeCases";
import bcrypt from "bcrypt";

export const prisma = new PrismaClient();

// Define default permissions for roles
const adminPermissions = {
  canAddEdit: true,
  canDelete: true,
  canClose: true,
};

const userPermissions: {
  [key in ApplicationArea]?: Partial<typeof adminPermissions>;
} = {
  [ApplicationArea.Documentation]: { canAddEdit: true },
  [ApplicationArea.Milestones]: {},
  [ApplicationArea.TestCaseRepository]: { canAddEdit: true }, // Allow adding cases
  [ApplicationArea.TestCaseRestrictedFields]: { canAddEdit: false },
  [ApplicationArea.TestRuns]: {
    canAddEdit: true,
    canDelete: true,
    canClose: true,
  }, // Allow managing runs
  [ApplicationArea.ClosedTestRuns]: { canDelete: false }, // View only closed
  [ApplicationArea.TestRunResults]: { canAddEdit: true, canDelete: true }, // Add/edit/delete results
  [ApplicationArea.TestRunResultRestrictedFields]: { canAddEdit: true }, // Add restricted results
  [ApplicationArea.Sessions]: {
    canAddEdit: true,
    canDelete: true,
    canClose: true,
  }, // Allow managing sessions
  [ApplicationArea.SessionsRestrictedFields]: { canAddEdit: true }, // Add restricted session data
  [ApplicationArea.ClosedSessions]: { canDelete: false }, // View only closed
  [ApplicationArea.SessionResults]: { canAddEdit: true, canDelete: true }, // Add/edit/delete results
  [ApplicationArea.Tags]: { canAddEdit: true }, // Allow adding tags
};

// Helper function to get default user permission for an area
function getUserPermissionForArea(area: ApplicationArea) {
  return {
    canAddEdit: userPermissions[area]?.canAddEdit ?? false,
    canDelete: userPermissions[area]?.canDelete ?? false,
    canClose: userPermissions[area]?.canClose ?? false,
  };
}

// --- Core Seeding Logic ---
async function seedCoreData() {
  console.log("Seeding core data...");

  // --- Roles ---
  const adminRole = await prisma.roles.upsert({
    where: { name: "admin" },
    update: { isDefault: false }, // Ensure only one default later
    create: {
      name: "admin",
      isDefault: false,
    },
  });
  const userRole = await prisma.roles.upsert({
    where: { name: "user" },
    update: { isDefault: true }, // Make user the default
    create: {
      name: "user",
      isDefault: true,
    },
  });
  // Ensure admin role is NOT default if user role was just created/updated as default
  if (userRole.isDefault) {
    await prisma.roles.update({
      where: { id: adminRole.id },
      data: { isDefault: false },
    });
  }

  console.log(
    `Upserted roles: admin (ID: ${adminRole.id}), user (ID: ${userRole.id}) - Default: ${userRole.isDefault ? "user" : "admin"}`
  );

  // --- Seed Role Permissions ---
  console.log("Seeding role permissions...");
  const areas = Object.values(ApplicationArea);
  for (const area of areas) {
    // Admin permissions
    await prisma.rolePermission.upsert({
      where: { roleId_area: { roleId: adminRole.id, area: area } },
      update: adminPermissions,
      create: {
        roleId: adminRole.id,
        area: area,
        ...adminPermissions,
      },
    });

    // User permissions
    const specificUserPerms = getUserPermissionForArea(area);
    await prisma.rolePermission.upsert({
      where: { roleId_area: { roleId: userRole.id, area: area } },
      update: specificUserPerms,
      create: {
        roleId: userRole.id,
        area: area,
        ...specificUserPerms,
      },
    });
  }
  console.log(
    `Seeded permissions for ${areas.length} areas for admin and user roles.`
  );

  // --- Colors ---
  const colorFamilies = [
    {
      name: "Black",
      order: 1,
      shades: [
        "#333435",
        "#6C6D6E",
        "#838485",
        "#9A9B9C",
        "#B1B2B3",
        "#C8C9CA",
      ],
    },
    {
      name: "Red",
      order: 2,
      shades: [
        "#8D2007",
        "#BD2B0A",
        "#ED360C",
        "#F44B25",
        "#F66F51",
        "#F88F77",
      ],
    },
    {
      name: "Orange",
      order: 3,
      shades: [
        "#783702",
        "#A54C03",
        "#D76304",
        "#FA7C14",
        "#FB9846",
        "#FCB478",
      ],
    },
    {
      name: "Yellow",
      order: 4,
      shades: [
        "#664400",
        "#996600",
        "#CC8800",
        "#FFAA00",
        "#FFBB33",
        "#FFCC66",
      ],
    },
    {
      name: "Green",
      order: 5,
      shades: [
        "#164621",
        "#206530",
        "#2A843F",
        "#36AB51",
        "#51C86C",
        "#7BD590",
      ],
    },
    {
      name: "Blue",
      order: 6,
      shades: [
        "#0A4C57",
        "#0E6B7C",
        "#128BA1",
        "#16ABC5",
        "#27CAE7",
        "#55D5EC",
      ],
    },
    {
      name: "Indigo",
      order: 7,
      shades: [
        "#134664",
        "#195D84",
        "#1F74A4",
        "#258AC4",
        "#58A5D1",
        "#8CC1DF",
      ],
    },
    {
      name: "Violet",
      order: 8,
      shades: [
        "#372C77",
        "#493A9C",
        "#5D4CBD",
        "#786AC8",
        "#8C80D0",
        "#A79EDB",
      ],
    },
    {
      name: "Pink",
      order: 9,
      shades: [
        "#632243",
        "#7A2A53",
        "#983468",
        "#BE4182",
        "#CB679B",
        "#D88DB4",
      ],
    },
  ];
  interface Color {
    id: number;
    order: number;
    value: string;
  }
  type ColorMap = { [key: string]: Color[] };
  const colorMap: ColorMap = {};
  for (const { name, order, shades } of colorFamilies) {
    const colorFamily = await prisma.colorFamily.upsert({
      where: { name },
      update: {},
      create: { name, order },
    });
    const colors: Color[] = [];
    for (let index = 0; index < shades.length; index++) {
      const color = await prisma.color.upsert({
        where: {
          colorFamilyId_order: { colorFamilyId: colorFamily.id, order: index },
        },
        update: { value: shades[index] },
        create: {
          colorFamilyId: colorFamily.id,
          order: index,
          value: shades[index],
        },
      });
      colors.push({ id: color.id, order: index, value: shades[index] });
    }
    colorMap[name] = colors;
  }

  // --- Status Scopes ---
  const scopes = [
    { name: "Test Run", icon: "play-circle" },
    { name: "Session", icon: "compass" },
    { name: "Automation", icon: "bot" },
  ];
  const scopePromises = scopes.map((scope) =>
    prisma.statusScope.upsert({
      where: { name: scope.name },
      update: { icon: scope.icon },
      create: { name: scope.name, icon: scope.icon },
    })
  );
  await Promise.all(scopePromises);

  // --- Statuses & Assignments ---
  const statuses = [
    {
      name: "Untested",
      systemName: "untested",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Black"][5].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Passed",
      systemName: "passed",
      aliases: "ok,success",
      isEnabled: true,
      isSuccess: true,
      isFailure: false,
      isCompleted: true,
      colorId: colorMap["Green"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Failed",
      systemName: "failed",
      aliases: "failure",
      isEnabled: true,
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
      colorId: colorMap["Red"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Retest",
      systemName: "retest",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Yellow"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Blocked",
      systemName: "blocked",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Black"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Skipped",
      systemName: "skipped",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: true,
      colorId: colorMap["Violet"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Exception",
      systemName: "exception",
      aliases: "error",
      isEnabled: true,
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
      colorId: colorMap["Orange"][3].id,
      scopes: ["Automation"],
    },
  ];
  for (const status of statuses) {
    const createdStatus = await prisma.status.upsert({
      where: { systemName: status.systemName },
      update: {},
      create: {
        name: status.name,
        systemName: status.systemName,
        aliases: status.aliases,
        isEnabled: status.isEnabled,
        isSuccess: status.isSuccess,
        isFailure: status.isFailure,
        isCompleted: status.isCompleted,
        colorId: status.colorId,
      },
    });
    for (const scope of status.scopes) {
      const scopeRecord = await prisma.statusScope.findUnique({
        where: { name: scope },
      });
      if (scopeRecord) {
        const existingAssignment =
          await prisma.statusScopeAssignment.findUnique({
            where: {
              statusId_scopeId: {
                statusId: createdStatus.id,
                scopeId: scopeRecord.id,
              },
            },
          });
        if (!existingAssignment) {
          await prisma.statusScopeAssignment.create({
            data: {
              statusId: createdStatus.id,
              scopeId: scopeRecord.id,
            },
          });
        }
      }
    }
  }

  // --- Default Project Docs ---
  const initialContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: {
          textAlign: "left",
          level: 2,
        },
        content: [{ type: "text", text: "Project Documentation" }],
      },
      {
        type: "paragraph",
        attrs: { class: null, textAlign: "left" },
        content: [
          {
            type: "text",
            text: "Document this project and add links to resources such as your wiki, websites, and other files.",
          },
        ],
      },
    ],
  };
  await prisma.appConfig.upsert({
    where: { key: "project_docs_default" },
    update: {},
    create: {
      key: "project_docs_default",
      value: initialContent,
    },
  });
  console.log("Seeded default project documentation.");

  // --- Edit Results Duration ---
  await prisma.appConfig.upsert({
    where: { key: "edit_results_duration" },
    update: {},
    create: {
      key: "edit_results_duration",
      value: 0, // Default to 0 (no editing allowed)
    },
  });
  console.log("Seeded edit results duration config.");

  // --- Field Icons, Case Field Types, Case/Result Fields ---
  await seedFieldIcons();
  await seedCaseFieldTypes();
  const fieldTypeMap = await getFieldTypeIds();
  await seedCaseFields(fieldTypeMap);
  await seedResultFields(fieldTypeMap);

  // --- Workflows & Milestone Types ---
  await seedWorkflows();
  await seedMilestoneTypes();

  // --- Default Template ---
  await seedDefaultTemplate();

  // --- Essential Admin User (Credentials from ENV or Defaults) ---
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminName = process.env.ADMIN_NAME || "Administrator Account";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
  const hashedPassword = bcrypt.hashSync(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail }, // Use configured email
    update: {
      roleId: adminRole.id,
      emailVerified: new Date(),
      name: adminName,
    },
    create: {
      email: adminEmail,
      name: adminName,
      password: hashedPassword,
      isApi: true,
      roleId: adminRole.id,
      emailVerified: new Date(),
      access: "ADMIN",
      userPreferences: {
        create: {
          itemsPerPage: "P10",
          dateFormat: "MM_DD_YYYY_DASH",
          timeFormat: "HH_MM_A",
          theme: "Light",
          locale: "en_US",
          hasCompletedWelcomeTour: false,
          hasCompletedInitialPreferencesSetup: false,
        },
      },
    },
  });

  // --- Authentication Configuration ---
  console.log("Configuring internal authentication (no SSO providers)...");

  // --- Registration Settings ---
  // Create default registration settings (singleton record)
  await prisma.registrationSettings.upsert({
    where: { id: "default-registration-settings" },
    update: {},
    create: {
      id: "default-registration-settings",
      restrictEmailDomains: false,
      allowOpenRegistration: true,
      defaultAccess: "NONE",
    },
  });
  console.log("Ensured default registration settings exist.");

  console.log("Core data seeding complete.");
}

// --- Test-Specific Seeding Logic ---
async function seedTestData() {
  console.log("Seeding additional test-specific data...");

  // Seed test admin user if it doesn't exist
  const adminEmail = "admin@testplanit.com";
  const adminExists = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("admin", 10);
    const adminRole = await prisma.roles.findUnique({
      where: { name: "admin" },
    });
    if (adminRole) {
      const adminUser = await prisma.user.create({
        data: {
          name: "Test Admin",
          email: adminEmail,
          password: hashedPassword,
          roleId: adminRole.id,
          emailVerified: new Date().toISOString(),
          isActive: true,
          access: "ADMIN",
          userPreferences: {
            create: {
              itemsPerPage: "P10",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              theme: "Light",
              locale: "en_US",
              hasCompletedWelcomeTour: true,
              hasCompletedInitialPreferencesSetup: true,
            },
          },
        },
      });
      console.log(`Seeded test admin user (${adminEmail}).`);

      // Seed regular test user if it doesn't exist
      const userEmail = "testuser@example.com";
      const userExists = await prisma.user.findUnique({
        where: { email: userEmail },
      });
      if (!userExists) {
        const hashedPassword = await bcrypt.hash("password123", 10);
        const userRole = await prisma.roles.findUnique({
          where: { name: "user" },
        });
        if (userRole) {
          await prisma.user.create({
            data: {
              name: "Test User",
              email: userEmail,
              password: hashedPassword,
              roleId: userRole.id,
              emailVerified: new Date().toISOString(),
              isActive: true,
              access: "USER",
              userPreferences: {
                create: {
                  itemsPerPage: "P10",
                  dateFormat: "MM_DD_YYYY_DASH",
                  timeFormat: "HH_MM_A",
                  theme: "Light",
                  locale: "en_US",
                  hasCompletedWelcomeTour: true,
                  hasCompletedInitialPreferencesSetup: true,
                },
              },
            },
          });
          console.log(`Seeded regular test user (${userEmail}).`);
        }
      }
      // Seed user for email verification test
      const verifyEmailUser = "verify@test.com";
      const verifyToken = "123456789";
      const verifyUserExists = await prisma.user.findUnique({
        where: { email: verifyEmailUser },
      });

      if (!verifyUserExists) {
        const hashedPassword = await bcrypt.hash("password123", 10);
        const userRole = await prisma.roles.findUnique({
          where: { name: "user" },
        });
        if (userRole) {
          await prisma.user.create({
            data: {
              name: "Verify User",
              email: verifyEmailUser,
              password: hashedPassword,
              roleId: userRole.id,
              emailVerified: null,
              emailVerifToken: verifyToken,
              emailTokenExpires: new Date(
                new Date().getTime() + 24 * 60 * 60 * 1000
              ), // 24 hours from now
              isActive: true,
              access: "USER",
            },
          });
          console.log(
            `Seeded user for email verification (${verifyEmailUser}).`
          );
        }
      }

      // Seed project for e2e tests
      const emptyProjectExists = await prisma.projects.findUnique({
        where: { id: 332 },
      });

      if (!emptyProjectExists) {
        await prisma.projects.create({
          data: {
            id: 332,
            name: "Empty Project",
            createdBy: adminUser.id,
            repositories: {
              create: {},
            },
          },
        });
        console.log("Seeded empty project for tests (ID: 332).");
      } else {
        console.log("Empty project already exists.");
      }

      // Seed AppConfig entry for e2e edit test
      await seedAppConfig();

      // Seed test results for project 331
      const project331Exists = await prisma.projects.findUnique({
        where: { id: 331 },
      });
      if (!project331Exists) {
        const defaultTemplate = await prisma.templates.findFirst({
          where: { isDefault: true },
        });
        const defaultMilestoneType = await prisma.milestoneTypes.findFirst({
          where: { isDefault: true },
        });
        const defaultRunWorkflow = await prisma.workflows.findFirst({
          where: { scope: WorkflowScope.RUNS, isDefault: true },
        });
        const defaultCaseWorkflow = await prisma.workflows.findFirst({
          where: { scope: WorkflowScope.CASES, isDefault: true },
        });

        // Ensure we have a default integration for project 331
        let integration = await prisma.integration.findFirst({
          where: {
            provider: "SIMPLE_URL",
            isDeleted: false,
          },
        });

        if (!integration) {
          integration = await prisma.integration.create({
            data: {
              name: "Default Issue Tracker",
              provider: "SIMPLE_URL",
              authType: "API_KEY",
              status: "ACTIVE",
              credentials: { apiKey: "dummy-key" },
              settings: { baseUrl: "https://example.com/issues/{issueId}" },
            },
          });
          console.log("Created default integration for testing.");
        }

        const project331 = await prisma.projects.create({
          data: {
            id: 331,
            name: "E2E Test Project",
            createdBy: adminUser.id,
            repositories: {
              create: {},
            },
          },
          include: {
            repositories: true,
          },
        });

        const rootFolder = await prisma.repositoryFolders.create({
          data: {
            name: "root",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            creatorId: adminUser.id,
          },
        });

        // Create project integration
        await prisma.projectIntegration.create({
          data: {
            projectId: project331.id,
            integrationId: integration.id,
            isActive: true,
            config: { baseUrl: "https://example.com/issues/{issueId}" },
          },
        });

        const regularUser = await prisma.user.findUnique({
          where: { email: userEmail },
        });

        if (regularUser) {
          await prisma.projectAssignment.createMany({
            data: [
              { userId: adminUser.id, projectId: project331.id },
              { userId: regularUser.id, projectId: project331.id },
            ],
            skipDuplicates: true,
          });
        }

        const milestone1 = await prisma.milestones.create({
          data: {
            name: "Test Milestone",
            projectId: project331.id,
            createdBy: adminUser.id,
            milestoneTypesId: defaultMilestoneType!.id,
          },
        });

        const run1 = await prisma.testRuns.create({
          data: {
            name: "Test Run 1",
            projectId: project331.id,
            stateId: defaultRunWorkflow!.id,
            createdById: adminUser.id,
          },
        });

        const run2 = await prisma.testRuns.create({
          data: {
            name: "Test Run 2",
            projectId: project331.id,
            stateId: defaultRunWorkflow!.id,
            createdById: adminUser.id,
          },
        });

        const repoCase1 = await prisma.repositoryCases.create({
          data: {
            name: "Repo Case 1",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            creatorId: adminUser.id,
            folderId: rootFolder.id,
            templateId: defaultTemplate!.id,
            stateId: defaultCaseWorkflow!.id,
          },
        });
        const repoCase2 = await prisma.repositoryCases.create({
          data: {
            name: "Repo Case 2",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: defaultCaseWorkflow!.id,
            creatorId: adminUser.id,
            folderId: rootFolder.id,
          },
        });
        const repoCase3 = await prisma.repositoryCases.create({
          data: {
            name: "Repo Case 3",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: defaultCaseWorkflow!.id,
            creatorId: adminUser.id,
            folderId: rootFolder.id,
          },
        });

        // Add more comprehensive repository data for testing different report types
        // Create additional folders for folder-based reports
        const apiFolder = await prisma.repositoryFolders.create({
          data: {
            name: "API Tests",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            creatorId: adminUser.id,
          },
        });

        const uiFolder = await prisma.repositoryFolders.create({
          data: {
            name: "UI Tests",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            creatorId: regularUser!.id,
          },
        });

        // Create additional workflow states
        const activeWorkflow = await prisma.workflows.findFirst({
          where: { scope: WorkflowScope.CASES, name: "Active" },
        });
        const archivedWorkflow = await prisma.workflows.findFirst({
          where: { scope: WorkflowScope.CASES, name: "Archived" },
        });

        // Create repository cases with different characteristics for comprehensive testing
        const apiCase1 = await prisma.repositoryCases.create({
          data: {
            name: "API Login Test",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: activeWorkflow?.id || defaultCaseWorkflow!.id,
            creatorId: adminUser.id,
            folderId: apiFolder.id,
            automated: true,
            source: "JUNIT" as const,
            className: "com.example.LoginTest",
            estimate: 120, // 2 minutes
          },
        });

        const apiCase2 = await prisma.repositoryCases.create({
          data: {
            name: "API Data Validation",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: activeWorkflow?.id || defaultCaseWorkflow!.id,
            creatorId: regularUser!.id,
            folderId: apiFolder.id,
            automated: true,
            source: "API" as const,
            estimate: 180, // 3 minutes
          },
        });

        const uiCase1 = await prisma.repositoryCases.create({
          data: {
            name: "UI Navigation Test",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: defaultCaseWorkflow!.id, // Draft state
            creatorId: adminUser.id,
            folderId: uiFolder.id,
            automated: false,
            source: "MANUAL" as const,
            estimate: 300, // 5 minutes
          },
        });

        const uiCase2 = await prisma.repositoryCases.create({
          data: {
            name: "UI Form Validation",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: archivedWorkflow?.id || defaultCaseWorkflow!.id,
            creatorId: regularUser!.id,
            folderId: uiFolder.id,
            automated: false,
            source: "MANUAL" as const,
            estimate: 240, // 4 minutes
          },
        });

        // Create an edge case: Manual test case converted to automated
        // This represents a test case that was originally created manually but later automated
        const convertedCase = await prisma.repositoryCases.create({
          data: {
            name: "Converted Manual to Automated Test",
            projectId: project331.id,
            repositoryId: project331.repositories[0]!.id,
            templateId: defaultTemplate!.id,
            stateId: activeWorkflow?.id || defaultCaseWorkflow!.id,
            creatorId: adminUser.id,
            folderId: uiFolder.id,
            automated: true, // Now automated
            source: "MANUAL" as const, // But originally manual
            estimate: 180, // 3 minutes
          },
        });

        // Create additional milestones
        const milestone2 = await prisma.milestones.create({
          data: {
            name: "Sprint 1",
            projectId: project331.id,
            createdBy: adminUser.id,
            milestoneTypesId: defaultMilestoneType!.id,
          },
        });

        // Create configurations for comprehensive testing
        const config1 = await prisma.configurations.create({
          data: {
            name: "Chrome Desktop",
            isEnabled: true,
          },
        });

        const config2 = await prisma.configurations.create({
          data: {
            name: "Firefox Mobile",
            isEnabled: true,
          },
        });

        const config3 = await prisma.configurations.create({
          data: {
            name: "Safari Desktop",
            isEnabled: true,
          },
        });

        const config4 = await prisma.configurations.create({
          data: {
            name: "Edge Mobile",
            isEnabled: true,
          },
        });

        // Create sessions for session analysis testing with precise metric validation data
        //
        // METRIC VALIDATION TEST DATA:
        // ==========================
        // Test Group 1 (Admin + Milestone1 + Config1): 3 sessions
        //   - Session1: 120min, completed=true
        //   - Session2: 180min, completed=true
        //   - Session3: 60min, completed=false
        //   Expected: sessionCount=3, completionRate=67%, averageDuration=120min, totalDuration=6hr
        //
        // Test Group 2 (RegularUser + Milestone2 + Config2): 2 sessions
        //   - Session4: 180min, completed=true
        //   - Session5: 120min, completed=false
        //   Expected: sessionCount=2, completionRate=50%, averageDuration=150min, totalDuration=5hr
        //
        // Test Group 3 (By State):
        //   - New State: 1 session, 90min, completed=false → 0% completion, 1.5hr total
        //   - In Progress State: 1 session, 240min, completed=false → 0% completion, 4hr total
        //   - Done State: 1 session, 270min, completed=true → 100% completion, 4.5hr total
        //
        const sessionWorkflow = await prisma.workflows.findFirst({
          where: { scope: WorkflowScope.SESSIONS, isDefault: true },
        });

        // Test Group 1: Admin User + Milestone 1 + Config 1
        // Expected metrics: sessionCount=3, completionRate=67% (2/3), averageDuration=7200000ms (120min), totalDuration=21600000ms (6hr)
        const session1 = await prisma.sessions.create({
          data: {
            name: "Exploratory Testing Session",
            projectId: project331.id,
            templateId: defaultTemplate!.id,
            stateId: sessionWorkflow!.id,
            createdById: adminUser.id,
            assignedToId: adminUser.id,
            milestoneId: milestone1.id,
            configId: config1.id,
            estimate: 7200000, // 2 hours in milliseconds
            elapsed: 7200000, // Exactly 2 hours = 120 minutes
            isCompleted: true,
            createdAt: new Date("2025-06-09T09:00:00Z"),
          },
        });

        const session2 = await prisma.sessions.create({
          data: {
            name: "API Testing Session",
            projectId: project331.id,
            templateId: defaultTemplate!.id,
            stateId: sessionWorkflow!.id,
            createdById: adminUser.id,
            assignedToId: adminUser.id,
            milestoneId: milestone1.id,
            configId: config1.id,
            estimate: 10800000, // 3 hours in milliseconds
            elapsed: 10800000, // Exactly 3 hours = 180 minutes
            isCompleted: true,
            createdAt: new Date("2025-06-09T12:00:00Z"),
          },
        });

        const session3 = await prisma.sessions.create({
          data: {
            name: "Performance Testing Session",
            projectId: project331.id,
            templateId: defaultTemplate!.id,
            stateId: sessionWorkflow!.id,
            createdById: adminUser.id,
            assignedToId: adminUser.id,
            milestoneId: milestone1.id,
            configId: config1.id,
            estimate: 3600000, // 1 hour in milliseconds
            elapsed: 3600000, // Exactly 1 hour = 60 minutes
            isCompleted: false, // Not completed
            createdAt: new Date("2025-06-09T15:00:00Z"),
          },
        });

        // Test Group 2: Regular User + Milestone 2 + Config 2
        // Expected metrics: sessionCount=2, completionRate=50% (1/2), averageDuration=9000000ms (150min), totalDuration=18000000ms (5hr)
        const session4 = await prisma.sessions.create({
          data: {
            name: "Regression Testing Session",
            projectId: project331.id,
            templateId: defaultTemplate!.id,
            stateId: sessionWorkflow!.id,
            createdById: regularUser!.id,
            assignedToId: regularUser!.id,
            milestoneId: milestone2.id,
            configId: config2.id,
            estimate: 14400000, // 4 hours in milliseconds
            elapsed: 10800000, // 3 hours = 180 minutes
            isCompleted: true,
            createdAt: new Date("2025-06-10T09:00:00Z"),
          },
        });

        const session5 = await prisma.sessions.create({
          data: {
            name: "Security Testing Session",
            projectId: project331.id,
            templateId: defaultTemplate!.id,
            stateId: sessionWorkflow!.id,
            createdById: regularUser!.id,
            assignedToId: regularUser!.id,
            milestoneId: milestone2.id,
            configId: config2.id,
            estimate: 7200000, // 2 hours in milliseconds
            elapsed: 7200000, // 2 hours = 120 minutes
            isCompleted: false, // Not completed
            createdAt: new Date("2025-06-10T13:00:00Z"),
          },
        });

        const trc1 = await prisma.testRunCases.create({
          data: {
            testRunId: run1.id,
            repositoryCaseId: repoCase1.id,
            order: 1,
          },
        });

        const trc2 = await prisma.testRunCases.create({
          data: {
            testRunId: run1.id,
            repositoryCaseId: repoCase2.id,
            order: 2,
          },
        });

        const passedStatus = await prisma.status.findFirst({
          where: { name: "Passed" },
        });
        const failedStatus = await prisma.status.findFirst({
          where: { name: "Failed" },
        });

        if (passedStatus && failedStatus && regularUser) {
          // Create session results for metric validation testing
          await prisma.sessionResults.create({
            data: {
              sessionId: session1.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-09T10:00:00Z"),
              elapsed: 1800000, // 30 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session2.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-09T13:00:00Z"),
              elapsed: 2100000, // 35 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session4.id,
              statusId: failedStatus.id,
              createdById: regularUser.id,
              createdAt: new Date("2025-06-10T11:00:00Z"),
              elapsed: 900000, // 15 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session5.id,
              statusId: passedStatus.id,
              createdById: regularUser.id,
              createdAt: new Date("2025-06-10T15:00:00Z"),
              elapsed: 1200000, // 20 minutes
            },
          });

          // Create additional sessions for metric validation testing with precise values
          const sessionWorkflowInProgress = await prisma.workflows.findFirst({
            where: { scope: WorkflowScope.SESSIONS, name: "In Progress" },
          });
          const sessionWorkflowDone = await prisma.workflows.findFirst({
            where: { scope: WorkflowScope.SESSIONS, name: "Done" },
          });

          // Test Group 3: Different states for state-based analysis
          // New state: sessionCount=1, completionRate=0%, averageDuration=90min, totalDuration=1.5hr
          const session6 = await prisma.sessions.create({
            data: {
              name: "Mobile Testing Session",
              projectId: project331.id,
              templateId: defaultTemplate!.id,
              stateId: sessionWorkflow!.id, // New state (default)
              createdById: adminUser.id,
              assignedToId: adminUser.id,
              milestoneId: milestone2.id, // Use milestone2 to avoid conflicts with Test Group 1
              configId: config3.id,
              estimate: 5400000, // 1.5 hours in milliseconds
              elapsed: 5400000, // Exactly 1.5 hours = 90 minutes
              isCompleted: false,
              createdAt: new Date("2025-06-11T09:00:00Z"),
            },
          });

          // In Progress state: sessionCount=1, completionRate=0%, averageDuration=240min, totalDuration=4hr
          const session7 = await prisma.sessions.create({
            data: {
              name: "Integration Testing Session",
              projectId: project331.id,
              templateId: defaultTemplate!.id,
              stateId: sessionWorkflowInProgress?.id || sessionWorkflow!.id,
              createdById: regularUser!.id,
              assignedToId: regularUser!.id,
              milestoneId: milestone1.id, // Use milestone1 to avoid conflicts with Test Group 2
              configId: config2.id,
              estimate: 21600000, // 6 hours in milliseconds
              elapsed: 14400000, // Exactly 4 hours = 240 minutes
              isCompleted: false,
              createdAt: new Date("2025-06-11T14:00:00Z"),
            },
          });

          // Done state: sessionCount=1, completionRate=100%, averageDuration=270min, totalDuration=4.5hr
          const session8 = await prisma.sessions.create({
            data: {
              name: "User Acceptance Testing Session",
              projectId: project331.id,
              templateId: defaultTemplate!.id,
              stateId: sessionWorkflowDone?.id || sessionWorkflow!.id,
              createdById: adminUser.id,
              assignedToId: adminUser.id,
              milestoneId: milestone2.id, // Use milestone2 to avoid conflicts with Test Group 1
              configId: config1.id,
              estimate: 18000000, // 5 hours in milliseconds
              elapsed: 16200000, // Exactly 4.5 hours = 270 minutes
              isCompleted: true,
              completedAt: new Date("2025-06-12T16:30:00Z"),
              createdAt: new Date("2025-06-12T08:00:00Z"),
            },
          });

          // Create additional session results for comprehensive metric validation
          const blockedStatus = await prisma.status.findFirst({
            where: { name: "Blocked" },
          });
          const retestStatus = await prisma.status.findFirst({
            where: { name: "Retest" },
          });

          // Session results for state-based analysis
          await prisma.sessionResults.create({
            data: {
              sessionId: session6.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-11T10:30:00Z"),
              elapsed: 3600000, // 1 hour
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session7.id,
              statusId: failedStatus.id,
              createdById: regularUser.id,
              createdAt: new Date("2025-06-11T16:00:00Z"),
              elapsed: 2700000, // 45 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session8.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-12T10:00:00Z"),
              elapsed: 7200000, // 2 hours
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: session8.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-12T14:30:00Z"),
              elapsed: 9000000, // 2.5 hours
            },
          });

          // Create additional test sessions for date-based analysis validation
          // Test Group 4: Date dimension testing - sessions on different dates
          const sessionDateTest1 = await prisma.sessions.create({
            data: {
              name: "Accessibility Testing Session",
              projectId: project331.id,
              templateId: defaultTemplate!.id,
              stateId: sessionWorkflowDone?.id || sessionWorkflow!.id,
              createdById: adminUser.id,
              assignedToId: regularUser!.id,
              milestoneId: milestone1.id, // Use milestone1 to avoid conflicts with Test Group 2
              configId: config1.id,
              estimate: 7200000, // 2 hours in milliseconds
              elapsed: 6300000, // 1h 45m = 105 minutes
              isCompleted: true,
              completedAt: new Date("2025-06-15T12:45:00Z"),
              createdAt: new Date("2025-06-15T10:00:00Z"),
            },
          });

          const sessionDateTest2 = await prisma.sessions.create({
            data: {
              name: "Compatibility Testing Session",
              projectId: project331.id,
              templateId: defaultTemplate!.id,
              stateId: sessionWorkflow!.id,
              createdById: regularUser!.id,
              assignedToId: adminUser.id,
              milestoneId: milestone2.id, // Use milestone2 to avoid conflicts with Test Group 1
              configId: config4.id,
              estimate: 3600000, // 1 hour in milliseconds
              elapsed: 4200000, // 1h 10m = 70 minutes
              isCompleted: true,
              completedAt: new Date("2025-06-16T15:10:00Z"),
              createdAt: new Date("2025-06-16T14:00:00Z"),
            },
          });

          // Add session results for metric validation
          await prisma.sessionResults.create({
            data: {
              sessionId: sessionDateTest1.id,
              statusId: passedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-15T11:30:00Z"),
              elapsed: 3600000, // 1 hour
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: sessionDateTest1.id,
              statusId: passedStatus.id,
              createdById: regularUser.id,
              createdAt: new Date("2025-06-15T12:30:00Z"),
              elapsed: 2700000, // 45 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: sessionDateTest2.id,
              statusId: passedStatus.id,
              createdById: regularUser.id,
              createdAt: new Date("2025-06-16T14:30:00Z"),
              elapsed: 2100000, // 35 minutes
            },
          });

          await prisma.sessionResults.create({
            data: {
              sessionId: sessionDateTest2.id,
              statusId: failedStatus.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-16T15:00:00Z"),
              elapsed: 2100000, // 35 minutes
            },
          });

          console.log(
            "Seeded comprehensive session data for Session Analysis testing with metric validation."
          );

          console.log("Session Analysis Metric Validation Data Summary:");
          console.log(
            "- 10 sessions total with precise elapsed times for accurate calculations (8 main + 2 date testing)"
          );
          console.log(
            "- Test Group 1 (Admin+Milestone1): 3 sessions, 67% completion, 7200000ms (120min) avg, 21600000ms (6hr) total"
          );
          console.log(
            "- Test Group 2 (User+Milestone2): 2 sessions, 50% completion, 9000000ms (150min) avg, 18000000ms (5hr) total"
          );
          console.log(
            "- State-based testing: New (0%), In Progress (0%), Done (100%) completion rates"
          );
          console.log(
            "- All elapsed times in milliseconds for precise duration calculations"
          );

          // Test Run 1 Results with varied elapsed times
          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc1.id,
              testRunId: run1.id,
              statusId: passedStatus!.id,
              executedById: adminUser.id,
              executedAt: new Date("2025-06-09T12:00:00Z"),
              elapsed: 1200, // 20 minutes
            },
          });

          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc1.id,
              testRunId: run1.id,
              statusId: passedStatus!.id,
              executedById: regularUser.id,
              executedAt: new Date("2025-06-10T12:00:00Z"),
              elapsed: 1800, // 30 minutes
            },
          });

          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc2.id,
              testRunId: run1.id,
              statusId: failedStatus!.id,
              executedById: adminUser.id,
              executedAt: new Date("2025-06-09T13:00:00Z"),
              elapsed: 600, // 10 minutes
            },
          });

          // Add a third test run case for more data
          const trc3 = await prisma.testRunCases.create({
            data: {
              testRunId: run1.id,
              repositoryCaseId: repoCase3.id,
              order: 3,
            },
          });

          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc3.id,
              testRunId: run1.id,
              statusId: passedStatus!.id,
              executedById: regularUser.id,
              executedAt: new Date("2025-06-10T14:00:00Z"),
              elapsed: 900, // 15 minutes
            },
          });

          // Test Run 2 Results for more variety
          const trc4 = await prisma.testRunCases.create({
            data: {
              testRunId: run2.id,
              repositoryCaseId: repoCase1.id,
              order: 1,
            },
          });

          const trc5 = await prisma.testRunCases.create({
            data: {
              testRunId: run2.id,
              repositoryCaseId: repoCase2.id,
              order: 2,
            },
          });

          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc4.id,
              testRunId: run2.id,
              statusId: passedStatus!.id,
              executedById: adminUser.id,
              executedAt: new Date("2025-06-11T09:00:00Z"),
              elapsed: 2400, // 40 minutes
            },
          });

          await prisma.testRunResults.create({
            data: {
              testRunCaseId: trc5.id,
              testRunId: run2.id,
              statusId: failedStatus!.id,
              executedById: regularUser.id,
              executedAt: new Date("2025-06-11T10:00:00Z"),
              elapsed: 300, // 5 minutes
            },
          });
        }

        // Create additional milestones for project health testing
        const existingProjectMilestones = await prisma.milestones.findMany({
          where: {
            projectId: project331.id,
            name: {
              in: ["Sprint 1", "Sprint 2", "Release 1.0", "Bug Fix Sprint"],
            },
          },
        });

        if (existingProjectMilestones.length === 0) {
          // Get milestone types
          const milestoneTypes = await prisma.milestoneTypes.findMany({
            take: 3,
          });

          const firstMilestoneType = milestoneTypes[0] || defaultMilestoneType;
          const secondMilestoneType = milestoneTypes[1] || defaultMilestoneType;

          // Create milestones with different statuses
          const projectMilestone1 = await prisma.milestones.create({
            data: {
              name: "Sprint 1",
              projectId: project331.id,
              milestoneTypesId: firstMilestoneType!.id,
              createdBy: adminUser.id,
              isStarted: true,
              isCompleted: true,
              startedAt: new Date("2025-06-01T09:00:00Z"),
              completedAt: new Date("2025-06-15T17:00:00Z"),
              createdAt: new Date("2025-06-01T08:00:00Z"),
            },
          });

          const projectMilestone2 = await prisma.milestones.create({
            data: {
              name: "Sprint 2",
              projectId: project331.id,
              milestoneTypesId: secondMilestoneType!.id,
              createdBy: regularUser!.id,
              isStarted: true,
              isCompleted: false,
              startedAt: new Date("2025-06-16T09:00:00Z"),
              createdAt: new Date("2025-06-10T10:00:00Z"),
            },
          });

          const projectMilestone3 = await prisma.milestones.create({
            data: {
              name: "Release 1.0",
              projectId: project331.id,
              milestoneTypesId: firstMilestoneType!.id,
              createdBy: adminUser.id,
              isStarted: false,
              isCompleted: false,
              createdAt: new Date("2025-06-12T14:00:00Z"),
            },
          });

          const projectMilestone4 = await prisma.milestones.create({
            data: {
              name: "Bug Fix Sprint",
              projectId: project331.id,
              milestoneTypesId: secondMilestoneType!.id,
              createdBy: regularUser!.id,
              isStarted: true,
              isCompleted: true,
              startedAt: new Date("2025-06-20T09:00:00Z"),
              completedAt: new Date("2025-06-25T17:00:00Z"),
              createdAt: new Date("2025-06-15T11:00:00Z"),
            },
          });

          console.log("Seeded additional milestones for project 331.");
        }

        // Seed milestone edge cases for comprehensive testing
        await seedMilestoneEdgeCases(
          prisma,
          project331.id,
          adminUser.id,
          defaultMilestoneType!.id
        );

        // Create comprehensive issues for Issue Tracking metric validation testing
        const existingProjectIssues = await prisma.issue.findMany({
          where: {
            integrationId: integration.id,
            projectId: project331.id,
            externalId: {
              in: [
                "ISSUE-001",
                "ISSUE-002",
                "ISSUE-003",
                "ISSUE-004",
                "ISSUE-005",
                "ISSUE-006",
                "ISSUE-007",
                "ISSUE-008",
                "ISSUE-009",
                "ISSUE-010",
              ],
            },
          },
        });

        if (existingProjectIssues.length === 0) {
          // Create issues for comprehensive Issue Tracking metric validation
          //
          // METRIC VALIDATION TEST DATA:
          // ===========================
          // Test Group 1 (Admin Creator): 6 issues
          //   - 3 issues on 2025-06-05 (same day)
          //   - 2 issues on 2025-06-10 (same day)
          //   - 1 issue on 2025-06-15 (different day)
          //   Expected: creator=adminUser, issueCount=6
          //
          // Test Group 2 (Regular User Creator): 4 issues
          //   - 2 issues on 2025-06-08 (same day)
          //   - 1 issue on 2025-06-12 (different day)
          //   - 1 issue on 2025-06-20 (different day)
          //   Expected: creator=regularUser, issueCount=4
          //
          // Test Group 3 (Date dimension testing):
          //   - 2025-06-05: 3 issues (all admin)
          //   - 2025-06-08: 2 issues (all regular user)
          //   - 2025-06-10: 2 issues (all admin)
          //   - 2025-06-12: 1 issue (regular user)
          //   - 2025-06-15: 1 issue (admin)
          //   - 2025-06-20: 1 issue (regular user)
          //
          // Test Group 4 (Issue Type dimension):
          //   - All issues use the same issueConfig (project's config)
          //   - Expected: issueType=project331.issueConfig, issueCount=10
          //
          // All metrics (openIssues, resolvedIssues, averageResolutionTime):
          //   - openIssues = issueCount (no status tracking)
          //   - resolvedIssues = 0 (no resolution tracking)
          //   - averageResolutionTime = 0 (no resolution time tracking)

          // Test Group 1: Admin Creator (6 issues)
          const adminIssue1 = await prisma.issue.create({
            data: {
              name: "Critical login bug",
              title: "Critical login bug",
              externalId: "ISSUE-001",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-05T09:00:00Z"),
              repositoryCases: {
                connect: [{ id: repoCase1.id }],
              },
            },
          });

          const adminIssue2 = await prisma.issue.create({
            data: {
              name: "Database connection timeout",
              title: "Database connection timeout",
              externalId: "ISSUE-002",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-05T14:30:00Z"),
              repositoryCases: {
                connect: [{ id: apiCase1.id }],
              },
            },
          });

          const adminIssue3 = await prisma.issue.create({
            data: {
              name: "UI rendering issue",
              title: "UI rendering issue",
              externalId: "ISSUE-003",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-05T16:45:00Z"),
              repositoryCases: {
                connect: [{ id: uiCase1.id }],
              },
            },
          });

          const adminIssue4 = await prisma.issue.create({
            data: {
              name: "Performance regression",
              title: "Performance regression",
              externalId: "ISSUE-004",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-10T10:15:00Z"),
              testRuns: {
                connect: [{ id: run1.id }],
              },
            },
          });

          const adminIssue5 = await prisma.issue.create({
            data: {
              name: "Memory leak detected",
              title: "Memory leak detected",
              externalId: "ISSUE-005",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-10T15:20:00Z"),
              sessions: {
                connect: [{ id: session1.id }],
              },
            },
          });

          const adminIssue6 = await prisma.issue.create({
            data: {
              name: "Security vulnerability",
              title: "Security vulnerability",
              externalId: "ISSUE-006",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: adminUser.id,
              createdAt: new Date("2025-06-15T11:30:00Z"),
              repositoryCases: {
                connect: [{ id: repoCase2.id }],
              },
            },
          });

          // Test Group 2: Regular User Creator (4 issues)
          const userIssue1 = await prisma.issue.create({
            data: {
              name: "Form validation error",
              title: "Form validation error",
              externalId: "ISSUE-007",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: regularUser!.id,
              createdAt: new Date("2025-06-08T08:45:00Z"),
              repositoryCases: {
                connect: [{ id: apiCase2.id }],
              },
            },
          });

          const userIssue2 = await prisma.issue.create({
            data: {
              name: "Navigation broken",
              title: "Navigation broken",
              externalId: "ISSUE-008",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: regularUser!.id,
              createdAt: new Date("2025-06-08T13:20:00Z"),
              repositoryCases: {
                connect: [{ id: uiCase2.id }],
              },
            },
          });

          const userIssue3 = await prisma.issue.create({
            data: {
              name: "Data export fails",
              title: "Data export fails",
              externalId: "ISSUE-009",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: regularUser!.id,
              createdAt: new Date("2025-06-12T12:10:00Z"),
              testRuns: {
                connect: [{ id: run2.id }],
              },
            },
          });

          const userIssue4 = await prisma.issue.create({
            data: {
              name: "Session timeout issue",
              title: "Session timeout issue",
              externalId: "ISSUE-010",
              integrationId: integration.id,
              projectId: project331.id,
              createdById: regularUser!.id,
              createdAt: new Date("2025-06-20T14:55:00Z"),
              sessions: {
                connect: [{ id: session2.id }],
              },
            },
          });

          console.log(
            "Seeded comprehensive issues for Issue Tracking metric validation."
          );
          console.log("Issue Tracking Metric Validation Data Summary:");
          console.log(
            "- 10 issues total with precise creation dates for accurate calculations"
          );
          console.log(
            "- Test Group 1 (Admin): 6 issues across 3 different dates"
          );
          console.log(
            "- Test Group 2 (Regular User): 4 issues across 3 different dates"
          );
          console.log("- Date-based testing: 6 different creation dates");
          console.log(
            "- All issues use the same issue config (project's config)"
          );
          console.log(
            "- All metrics: openIssues=issueCount, resolvedIssues=0, averageResolutionTime=0"
          );
        }

        console.log("Seeded test results for project 331.");
      } else {
        console.log("Test results for project 331 already exist.");
      }
    }

    // --- Seed Comprehensive Test Execution Data ---
    // This provides complete coverage of all dimension combinations
    const { seedComprehensiveTestExecutionData } = await import(
      "./seed-test-execution-comprehensive"
    );
    await seedComprehensiveTestExecutionData();
  }

  // Assign all workflows to all projects
  await assignWorkflowsToAllProjects();

  // Seed JUnit test data for permission testing
  await seedJUnitTestData();

  console.log("Test data seeding complete.");
}

// --- Helper Functions (Keep existing ones like getFieldTypeIds, seedCaseFieldTypes etc.) ---
async function seedProjectDocsDefault() {
  const initialContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: {
          textAlign: "left",
          level: 2,
        },
        content: [{ type: "text", text: "Project Documentation" }],
      },
      {
        type: "paragraph",
        attrs: { class: null, textAlign: "left" },
        content: [
          {
            type: "text",
            text: "Document this project and add links to resources such as your wiki, websites, and other files.",
          },
        ],
      },
    ],
  };
  await prisma.appConfig.upsert({
    where: { key: "project_docs_default" },
    update: {},
    create: {
      key: "project_docs_default",
      value: initialContent,
    },
  });
  console.log("Seeded default project documentation.");
}

async function seedEditResultsDuration() {
  await prisma.appConfig.upsert({
    where: { key: "edit_results_duration" },
    update: {},
    create: {
      key: "edit_results_duration",
      value: 0, // Default to 0 (no editing allowed)
    },
  });
  console.log("Seeded edit results duration config.");
}

async function seedColors() {
  const colorFamilies = [
    {
      name: "Black",
      order: 1,
      shades: [
        "#333435",
        "#6C6D6E",
        "#838485",
        "#9A9B9C",
        "#B1B2B3",
        "#C8C9CA",
      ],
    },
    {
      name: "Red",
      order: 2,
      shades: [
        "#8D2007",
        "#BD2B0A",
        "#ED360C",
        "#F44B25",
        "#F66F51",
        "#F88F77",
      ],
    },
    {
      name: "Orange",
      order: 3,
      shades: [
        "#783702",
        "#A54C03",
        "#D76304",
        "#FA7C14",
        "#FB9846",
        "#FCB478",
      ],
    },
    {
      name: "Yellow",
      order: 4,
      shades: [
        "#664400",
        "#996600",
        "#CC8800",
        "#FFAA00",
        "#FFBB33",
        "#FFCC66",
      ],
    },
    {
      name: "Green",
      order: 5,
      shades: [
        "#164621",
        "#206530",
        "#2A843F",
        "#36AB51",
        "#51C86C",
        "#7BD590",
      ],
    },
    {
      name: "Blue",
      order: 6,
      shades: [
        "#0A4C57",
        "#0E6B7C",
        "#128BA1",
        "#16ABC5",
        "#27CAE7",
        "#55D5EC",
      ],
    },
    {
      name: "Indigo",
      order: 7,
      shades: [
        "#134664",
        "#195D84",
        "#1F74A4",
        "#258AC4",
        "#58A5D1",
        "#8CC1DF",
      ],
    },
    {
      name: "Violet",
      order: 8,
      shades: [
        "#372C77",
        "#493A9C",
        "#5D4CBD",
        "#786AC8",
        "#8C80D0",
        "#A79EDB",
      ],
    },
    {
      name: "Pink",
      order: 9,
      shades: [
        "#632243",
        "#7A2A53",
        "#983468",
        "#BE4182",
        "#CB679B",
        "#D88DB4",
      ],
    },
  ];

  interface Color {
    id: number;
    order: number;
    value: string;
  }
  type ColorMap = { [key: string]: Color[] };
  const colorMap: ColorMap = {};

  for (const { name, order, shades } of colorFamilies) {
    const colorFamily = await prisma.colorFamily.upsert({
      where: { name },
      update: {},
      create: { name, order },
    });

    const colors: Color[] = [];
    for (let index = 0; index < shades.length; index++) {
      const color = await prisma.color.upsert({
        where: {
          colorFamilyId_order: { colorFamilyId: colorFamily.id, order: index },
        },
        update: { value: shades[index] },
        create: {
          colorFamilyId: colorFamily.id,
          order: index,
          value: shades[index],
        },
      });
      colors.push({
        id: color.id,
        order: index,
        value: shades[index],
      });
    }
    colorMap[name] = colors;
  }
  return colorMap;
}

async function seedStatusScopes() {
  const scopes = [
    { name: "Test Run", icon: "play-circle" },
    { name: "Session", icon: "compass" },
    { name: "Automation", icon: "bot" },
  ];

  const scopePromises = scopes.map((scope) =>
    prisma.statusScope.upsert({
      where: { name: scope.name },
      update: { icon: scope.icon },
      create: { name: scope.name, icon: scope.icon },
    })
  );

  await Promise.all(scopePromises);
}

async function seedStatusesAndAssignments(colorMap: {
  [key: string]: { id: number }[];
}) {
  const statuses = [
    {
      name: "Untested",
      systemName: "untested",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Black"][5].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Passed",
      systemName: "passed",
      aliases: "ok,success",
      isEnabled: true,
      isSuccess: true,
      isFailure: false,
      isCompleted: true,
      colorId: colorMap["Green"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Failed",
      systemName: "failed",
      aliases: "failure",
      isEnabled: true,
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
      colorId: colorMap["Red"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Retest",
      systemName: "retest",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Yellow"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Blocked",
      systemName: "blocked",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
      colorId: colorMap["Black"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Skipped",
      systemName: "skipped",
      isEnabled: true,
      isSuccess: false,
      isFailure: false,
      isCompleted: true,
      colorId: colorMap["Violet"][3].id,
      scopes: ["Test Run", "Session", "Automation"],
    },
    {
      name: "Exception",
      systemName: "exception",
      aliases: "error",
      isEnabled: true,
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
      colorId: colorMap["Orange"][3].id,
      scopes: ["Automation"],
    },
  ];

  for (const status of statuses) {
    const createdStatus = await prisma.status.upsert({
      where: { systemName: status.systemName },
      update: {},
      create: {
        name: status.name,
        systemName: status.systemName,
        aliases: status.aliases,
        isEnabled: status.isEnabled,
        isSuccess: status.isSuccess,
        isFailure: status.isFailure,
        isCompleted: status.isCompleted,
        colorId: status.colorId,
      },
    });

    for (const scope of status.scopes) {
      const scopeRecord = await prisma.statusScope.findUnique({
        where: { name: scope },
      });
      if (scopeRecord) {
        const existingAssignment =
          await prisma.statusScopeAssignment.findUnique({
            where: {
              statusId_scopeId: {
                statusId: createdStatus.id,
                scopeId: scopeRecord.id,
              },
            },
          });

        if (!existingAssignment) {
          await prisma.statusScopeAssignment.create({
            data: {
              statusId: createdStatus.id,
              scopeId: scopeRecord.id,
            },
          });
        }
      }
    }
  }
}

async function seedCaseFieldTypes() {
  const fieldTypes = [
    {
      type: "Checkbox",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "isChecked", displayName: "Default Setting:" },
        ],
      },
    },
    {
      type: "Date",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [],
      },
    },
    {
      type: "Dropdown",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "dropdownOptions", displayName: "Dropdown Options" },
        ],
      },
    },
    {
      type: "Integer",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "minValue", displayName: "Minimum Value" },
          { key: "maxValue", displayName: "Maximum Value" },
        ],
      },
    },
    {
      type: "Link",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [],
      },
    },
    {
      type: "Multi-Select",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "dropdownOptions", displayName: "Multi-Select Options" },
        ],
      },
    },
    {
      type: "Number",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "minValue", displayName: "Minimum Value" },
          { key: "maxValue", displayName: "Maximum Value" },
        ],
      },
    },
    {
      type: "Steps",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [],
      },
    },
    {
      type: "Text String",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "defaultValue", displayName: "Default Value" },
        ],
      },
    },
    {
      type: "Text Long",
      options: {
        commonOptions: [
          { key: "isEnabled", displayName: "Is Enabled" },
          { key: "isRequired", displayName: "Is Required" },
          { key: "isRestricted", displayName: "Is Restricted" },
        ],
        specificOptions: [
          { key: "initialHeight", displayName: "Initial Height" },
          { key: "defaultValue", displayName: "Default Value" },
        ],
      },
    },
  ];

  await Promise.all(
    fieldTypes.map(({ type, options }) =>
      prisma.caseFieldTypes.upsert({
        where: { type },
        update: { options: JSON.stringify(options) },
        create: { type, options: JSON.stringify(options) },
      })
    )
  );
}

async function getFieldTypeIds(): Promise<{ [key: string]: number }> {
  const fieldTypes = await prisma.caseFieldTypes.findMany();
  const fieldTypeMap: { [key: string]: number } = {};
  fieldTypes.forEach((ft) => {
    fieldTypeMap[ft.type] = ft.id;
  });
  return fieldTypeMap;
}

async function seedCaseFields(fieldTypeMap: any) {
  const caseFieldsData = [
    { displayName: "Priority", systemName: "priority", typeName: "Dropdown" },
    {
      displayName: "Description",
      systemName: "description",
      typeName: "Text Long",
    },
    { displayName: "Expected", systemName: "expected", typeName: "Text Long" },
    { displayName: "Steps", systemName: "steps", typeName: "Steps" },
  ];

  await Promise.all(
    caseFieldsData.map(({ displayName, systemName, typeName }) =>
      prisma.caseFields.upsert({
        where: { systemName },
        update: { typeId: fieldTypeMap[typeName] },
        create: { displayName, systemName, typeId: fieldTypeMap[typeName] },
      })
    )
  );
  console.log("Seeded case fields.");

  // Seed priority field options
  await seedPriorityFieldOptions();
}

async function seedPriorityFieldOptions() {
  // Get the priority field
  const priorityField = await prisma.caseFields.findUnique({
    where: { systemName: "priority" },
  });

  if (!priorityField) {
    console.error("Priority field not found!");
    return;
  }

  // Get icons for different priority levels
  const icons = {
    critical: await prisma.fieldIcon.findFirst({
      where: { name: "chevrons-up" },
    }),
    high: await prisma.fieldIcon.findFirst({
      where: { name: "chevron-up" },
    }),
    medium: await prisma.fieldIcon.findFirst({
      where: { name: "minus" },
    }),
    low: await prisma.fieldIcon.findFirst({
      where: { name: "chevron-down" },
    }),
  };

  // Get colors for priority options
  const colorFamilies = {
    red: await prisma.colorFamily.findUnique({ where: { name: "Red" } }),
    orange: await prisma.colorFamily.findUnique({ where: { name: "Orange" } }),
    yellow: await prisma.colorFamily.findUnique({ where: { name: "Yellow" } }),
    blue: await prisma.colorFamily.findUnique({ where: { name: "Blue" } }),
  };

  const colors = {
    critical: await prisma.color.findFirst({
      where: { colorFamilyId: colorFamilies.red?.id, order: 3 },
    }),
    high: await prisma.color.findFirst({
      where: { colorFamilyId: colorFamilies.orange?.id, order: 3 },
    }),
    medium: await prisma.color.findFirst({
      where: { colorFamilyId: colorFamilies.yellow?.id, order: 3 },
    }),
    low: await prisma.color.findFirst({
      where: { colorFamilyId: colorFamilies.blue?.id, order: 3 },
    }),
  };

  // Define priority options
  const priorityOptions = [
    {
      name: "Critical",
      order: 1,
      isDefault: false,
      iconColorId: colors.critical?.id,
      iconId: icons.critical?.id,
    },
    {
      name: "High",
      order: 2,
      isDefault: false,
      iconColorId: colors.high?.id,
      iconId: icons.high?.id,
    },
    {
      name: "Medium",
      order: 3,
      isDefault: true, // Medium as default
      iconColorId: colors.medium?.id,
      iconId: icons.medium?.id,
    },
    {
      name: "Low",
      order: 4,
      isDefault: false,
      iconColorId: colors.low?.id,
      iconId: icons.low?.id,
    },
  ];

  // Check existing options for this field to avoid duplicates
  const existingAssignments = await prisma.caseFieldAssignment.findMany({
    where: { caseFieldId: priorityField.id },
    include: { fieldOption: true },
  });

  const existingOptionNames = new Set(
    existingAssignments.map((a) => a.fieldOption.name)
  );

  // Create field options and link them to the priority field
  for (const option of priorityOptions) {
    // Skip if option already exists for this field
    if (existingOptionNames.has(option.name)) {
      console.log(`Priority option ${option.name} already exists`);
      continue;
    }

    // First check if a field option with this name exists
    let fieldOption = await prisma.fieldOptions.findFirst({
      where: { name: option.name },
    });

    if (fieldOption) {
      // Update existing option
      fieldOption = await prisma.fieldOptions.update({
        where: { id: fieldOption.id },
        data: {
          order: option.order,
          isDefault: option.isDefault,
          iconColorId: option.iconColorId,
          iconId: option.iconId,
          isEnabled: true,
          isDeleted: false,
        },
      });
    } else {
      // Create new option
      fieldOption = await prisma.fieldOptions.create({
        data: {
          name: option.name,
          order: option.order,
          isDefault: option.isDefault,
          iconColorId: option.iconColorId,
          iconId: option.iconId,
          isEnabled: true,
          isDeleted: false,
        },
      });
    }

    // Create the assignment linking the field option to the priority case field
    await prisma.caseFieldAssignment.upsert({
      where: {
        fieldOptionId_caseFieldId: {
          fieldOptionId: fieldOption.id,
          caseFieldId: priorityField.id,
        },
      },
      update: {},
      create: {
        fieldOptionId: fieldOption.id,
        caseFieldId: priorityField.id,
      },
    });
  }

  console.log("Seeded priority field options: Critical, High, Medium, Low");
}

async function seedResultFields(fieldTypeMap: any) {
  const resultFieldsData = [
    { displayName: "Notes", systemName: "notes", typeName: "Text Long" },
  ];

  await Promise.all(
    resultFieldsData.map(({ displayName, systemName, typeName }) =>
      prisma.resultFields.upsert({
        where: { systemName },
        update: { typeId: fieldTypeMap[typeName] },
        create: { displayName, systemName, typeId: fieldTypeMap[typeName] },
      })
    )
  );
  console.log("Seeded result fields.");
}

async function seedWorkflows() {
  const workflowsData = [
    {
      order: 1,
      name: "New",
      icon: "package-plus",
      color: "Yellow",
      isEnabled: true,
      isDefault: true,
      scope: "SESSIONS",
      workflowType: "NOT_STARTED",
    },
    {
      order: 2,
      name: "In Progress",
      icon: "circle-arrow-right",
      color: "Blue",
      isEnabled: true,
      isDefault: false,
      scope: "SESSIONS",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 3,
      name: "Under Review",
      icon: "messages-square",
      color: "Violet",
      isEnabled: true,
      isDefault: false,
      scope: "SESSIONS",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 4,
      name: "Rejected",
      icon: "package-x",
      color: "Red",
      isEnabled: true,
      isDefault: false,
      scope: "SESSIONS",
      workflowType: "DONE",
    },
    {
      order: 5,
      name: "Done",
      icon: "package-check",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "SESSIONS",
      workflowType: "DONE",
    },
    {
      order: 1,
      name: "New",
      icon: "package-plus",
      color: "Yellow",
      isEnabled: true,
      isDefault: true,
      scope: "RUNS",
      workflowType: "NOT_STARTED",
    },
    {
      order: 2,
      name: "In Progress",
      icon: "circle-arrow-right",
      color: "Blue",
      isEnabled: true,
      isDefault: false,
      scope: "RUNS",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 3,
      name: "Under Review",
      icon: "messages-square",
      color: "Violet",
      isEnabled: true,
      isDefault: false,
      scope: "RUNS",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 4,
      name: "Rejected",
      icon: "package-x",
      color: "Red",
      isEnabled: true,
      isDefault: false,
      scope: "RUNS",
      workflowType: "DONE",
    },
    {
      order: 5,
      name: "Done",
      icon: "package-check",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "RUNS",
      workflowType: "DONE",
    },
    {
      order: 1,
      name: "Draft",
      icon: "message-square-dashed",
      color: "Yellow",
      isEnabled: true,
      isDefault: true,
      scope: "CASES",
      workflowType: "NOT_STARTED",
    },
    {
      order: 2,
      name: "Under Review",
      icon: "messages-square",
      color: "Violet",
      isEnabled: true,
      isDefault: false,
      scope: "CASES",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 3,
      name: "Rejected",
      icon: "list-x",
      color: "Red",
      isEnabled: true,
      isDefault: false,
      scope: "CASES",
    },
    {
      order: 4,
      name: "Active",
      icon: "list-checks",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "CASES",
      workflowType: "IN_PROGRESS",
    },
    {
      order: 5,
      name: "Done",
      icon: "package-check",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "CASES",
      workflowType: "DONE",
    },
    {
      order: 6,
      name: "Archived",
      icon: "archive",
      color: "Black",
      isEnabled: true,
      isDefault: false,
      scope: "CASES",
      workflowType: "DONE",
    },
  ];

  for (const workflow of workflowsData) {
    const icon = await prisma.fieldIcon.findUnique({
      where: { name: workflow.icon },
    });
    const colorFamily = await prisma.colorFamily.findUnique({
      where: { name: workflow.color },
    });
    const color = await prisma.color.findFirst({
      where: {
        colorFamilyId: colorFamily?.id,
        order: 3, // 4th color in the family (index 3)
      },
    });

    if (icon && color) {
      const existingWorkflow = await prisma.workflows.findFirst({
        where: {
          name: workflow.name,
          scope: workflow.scope as WorkflowScope,
        },
      });

      if (existingWorkflow) {
        await prisma.workflows.update({
          where: { id: existingWorkflow.id },
          data: {
            order: workflow.order,
            iconId: icon.id,
            colorId: color.id,
            isEnabled: workflow.isEnabled,
            isDefault: workflow.isDefault,
          },
        });
      } else {
        await prisma.workflows.create({
          data: {
            order: workflow.order,
            name: workflow.name,
            iconId: icon.id,
            colorId: color.id,
            isEnabled: workflow.isEnabled,
            isDefault: workflow.isDefault,
            scope: workflow.scope as WorkflowScope,
          },
        });
      }
    }
  }
}

async function assignWorkflowsToAllProjects() {
  // Get all projects
  const allProjects = await prisma.projects.findMany({
    where: { isDeleted: false },
  });

  // Get all workflows
  const allWorkflows = await prisma.workflows.findMany({
    where: { isDeleted: false, isEnabled: true },
  });

  console.log(
    `Assigning ${allWorkflows.length} workflows to ${allProjects.length} projects...`
  );

  // Create assignments for each project-workflow combination
  for (const project of allProjects) {
    for (const workflow of allWorkflows) {
      const existingAssignment =
        await prisma.projectWorkflowAssignment.findUnique({
          where: {
            workflowId_projectId: {
              workflowId: workflow.id,
              projectId: project.id,
            },
          },
        });

      if (!existingAssignment) {
        await prisma.projectWorkflowAssignment.create({
          data: {
            workflowId: workflow.id,
            projectId: project.id,
          },
        });
      }
    }
  }
  console.log("Workflow assignments completed for all projects.");
}

async function seedMilestoneTypes() {
  const milestoneTypes = [
    { id: 1, name: "Cycle", iconName: "refresh-cw", isDefault: true },
    { id: 2, name: "Feature", iconName: "box" },
    { id: 3, name: "Iteration", iconName: "iteration-cw" },
    { id: 4, name: "Plan", iconName: "notebook-text" },
    { id: 5, name: "Release", iconName: "rocket" },
    { id: 6, name: "Sprint", iconName: "goal" },
    { id: 7, name: "Version", iconName: "file-stack" },
  ];

  const iconPromises = milestoneTypes.map(async (type) => {
    const icon = await prisma.fieldIcon.findUnique({
      where: { name: type.iconName },
      select: { id: true },
    });

    return {
      ...type,
      iconId: icon ? icon.id : null,
    };
  });

  const milestoneTypesWithIconIds = await Promise.all(iconPromises);

  const milestoneTypePromises = milestoneTypesWithIconIds.map((type) =>
    prisma.milestoneTypes.upsert({
      where: { id: type.id },
      update: {
        name: type.name,
        iconId: type.iconId,
        isDefault: type.isDefault || false,
      },
      create: {
        id: type.id,
        name: type.name,
        iconId: type.iconId,
        isDefault: type.isDefault || false,
      },
    })
  );

  await Promise.all(milestoneTypePromises);
}

// --- Seed Default Template ---
async function seedDefaultTemplate() {
  console.log("Seeding default template...");

  // Ensure no other template is marked as default
  await prisma.templates.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  // Fetch standard case and result fields
  const priorityField = await prisma.caseFields.findUnique({
    where: { systemName: "priority" },
  });
  const descriptionField = await prisma.caseFields.findUnique({
    where: { systemName: "description" },
  });
  const stepsField = await prisma.caseFields.findUnique({
    where: { systemName: "steps" },
  });
  const expectedField = await prisma.caseFields.findUnique({
    where: { systemName: "expected" },
  });
  const notesField = await prisma.resultFields.findUnique({
    where: { systemName: "notes" },
  });

  if (
    !priorityField ||
    !descriptionField ||
    !stepsField ||
    !expectedField ||
    !notesField
  ) {
    console.error(
      "Error: Could not find all required standard fields for default template."
    );
    return;
  }

  // Create the default template
  const defaultTemplate = await prisma.templates.upsert({
    where: { templateName: "Default Template" }, // Using name as a unique identifier for upsert
    update: { isDefault: true, isEnabled: true }, // Ensure it's default and enabled if it exists
    create: {
      templateName: "Default Template",
      isDefault: true,
      isEnabled: true,
    },
  });

  // Assign case fields in specific order
  const caseAssignments = [
    { caseFieldId: priorityField.id, templateId: defaultTemplate.id, order: 1 },
    {
      caseFieldId: descriptionField.id,
      templateId: defaultTemplate.id,
      order: 2,
    },
    { caseFieldId: stepsField.id, templateId: defaultTemplate.id, order: 3 },
    { caseFieldId: expectedField.id, templateId: defaultTemplate.id, order: 4 },
  ];

  // Use deleteMany + createMany for idempotency in case fields change
  await prisma.templateCaseAssignment.deleteMany({
    where: { templateId: defaultTemplate.id },
  });
  await prisma.templateCaseAssignment.createMany({
    data: caseAssignments,
  });

  // Assign result field
  const resultAssignments = [
    { resultFieldId: notesField.id, templateId: defaultTemplate.id, order: 1 },
  ];

  // Use deleteMany + createMany for idempotency
  await prisma.templateResultAssignment.deleteMany({
    where: { templateId: defaultTemplate.id },
  });
  await prisma.templateResultAssignment.createMany({
    data: resultAssignments,
  });

  console.log(
    `Seeded default template (ID: ${defaultTemplate.id}) with standard fields.`
  );
}

async function seedAppConfig() {
  const appConfigExists = await prisma.appConfig.findUnique({
    where: { key: "E2E_EDIT_TEST" },
  });
  if (!appConfigExists) {
    await prisma.appConfig.create({
      data: {
        key: "E2E_EDIT_TEST",
        value: "Test Value",
      },
    });
    console.log("Seeded AppConfig entry for E2E edit test.");
  } else {
    console.log("AppConfig for E2E edit test already exists.");
  }
}

async function seedBulkEditTestData() {
  console.log("Seeding bulk edit test data...");

  // Use the existing E2E Test Project (331) instead of creating a new one
  const existingProject = await prisma.projects.findUnique({
    where: { id: 331 },
    include: { repositories: true },
  });

  if (!existingProject) {
    console.log(
      "E2E Test Project (331) not found. Skipping bulk edit test data."
    );
    return;
  }

  // Check if we already have bulk edit test data
  const bulkEditTestCases = await prisma.repositoryCases.findMany({
    where: {
      projectId: 331,
      name: {
        startsWith: "Test Case Alpha",
      },
    },
  });

  if (bulkEditTestCases.length > 0) {
    console.log("Bulk edit test data already exists in project 331.");
    return;
  }

  // Get necessary references
  const adminUser = await prisma.user.findUnique({
    where: { email: "admin@testplanit.com" },
  });

  const regularUser = await prisma.user.findUnique({
    where: { email: "testuser@example.com" },
  });

  if (!adminUser || !regularUser) {
    console.error("Required users not found for bulk edit test data.");
    return;
  }

  // Get workflows - use default if specific ones don't exist
  const defaultCaseWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDefault: true },
  });

  const caseWorkflowDraft =
    (await prisma.workflows.findFirst({
      where: { scope: WorkflowScope.CASES, name: "Draft" },
    })) || defaultCaseWorkflow;

  const caseWorkflowActive =
    (await prisma.workflows.findFirst({
      where: { scope: WorkflowScope.CASES, name: "Active" },
    })) || defaultCaseWorkflow;

  const caseWorkflowDone =
    (await prisma.workflows.findFirst({
      where: { scope: WorkflowScope.CASES, name: "Done" },
    })) || defaultCaseWorkflow;

  if (!defaultCaseWorkflow) {
    console.error("No default case workflow found for bulk edit test data.");
    return;
  }

  // Create project-workflow assignments if they don't exist
  const allCaseWorkflows = await prisma.workflows.findMany({
    where: { scope: WorkflowScope.CASES, isDeleted: false, isEnabled: true },
  });

  for (const workflow of allCaseWorkflows) {
    const existingAssignment =
      await prisma.projectWorkflowAssignment.findUnique({
        where: {
          workflowId_projectId: {
            workflowId: workflow.id,
            projectId: 331,
          },
        },
      });

    if (!existingAssignment) {
      await prisma.projectWorkflowAssignment.create({
        data: {
          workflowId: workflow.id,
          projectId: 331,
        },
      });
    }
  }
  console.log("Created project-workflow assignments for project 331.");

  // Get default integration
  const integration = await prisma.integration.findFirst({
    where: {
      provider: "SIMPLE_URL",
      isDeleted: false,
    },
  });

  // Use existing project's repository
  const projectRepository = existingProject.repositories[0];
  if (!projectRepository) {
    console.log(
      "No repository found for project 331. Skipping bulk edit test data."
    );
    return;
  }

  // Create custom field types if they don't exist
  const textStringType = await prisma.caseFieldTypes.findFirst({
    where: { type: "Text String" },
  });

  const textLongType = await prisma.caseFieldTypes.findFirst({
    where: { type: "Text Long" },
  });

  const linkType = await prisma.caseFieldTypes.findFirst({
    where: { type: "Link" },
  });

  // Create templates with custom fields
  let template1 = await prisma.templates.findFirst({
    where: { templateName: "Bulk Edit Template 1" },
  });

  if (!template1) {
    template1 = await prisma.templates.create({
      data: {
        templateName: "Bulk Edit Template 1",
        isDefault: false,
        isEnabled: true,
      },
    });
  }

  let template2 = await prisma.templates.findFirst({
    where: { templateName: "Bulk Edit Template 2" },
  });

  if (!template2) {
    template2 = await prisma.templates.create({
      data: {
        templateName: "Bulk Edit Template 2",
        isDefault: false,
        isEnabled: true,
      },
    });
  }

  // Create custom fields for template 1
  let descriptionField = await prisma.caseFields.findFirst({
    where: { systemName: "bulk_edit_description" },
  });

  if (!descriptionField) {
    descriptionField = await prisma.caseFields.create({
      data: {
        displayName: "Description",
        systemName: "bulk_edit_description",
        isRequired: false,
        isRestricted: false,
        typeId: textStringType!.id,
      },
    });
  }

  let testDataField = await prisma.caseFields.findFirst({
    where: { systemName: "bulk_edit_test_data" },
  });

  if (!testDataField) {
    testDataField = await prisma.caseFields.create({
      data: {
        displayName: "Test Data",
        systemName: "bulk_edit_test_data",
        isRequired: false,
        isRestricted: false,
        typeId: textLongType!.id,
      },
    });
  }

  let referenceUrlField = await prisma.caseFields.findFirst({
    where: { systemName: "bulk_edit_reference_url" },
  });

  if (!referenceUrlField) {
    referenceUrlField = await prisma.caseFields.create({
      data: {
        displayName: "Reference URL",
        systemName: "bulk_edit_reference_url",
        isRequired: false,
        isRestricted: false,
        typeId: linkType!.id,
      },
    });
  }

  // Create custom fields for template 2 (different fields)
  let summaryField = await prisma.caseFields.findFirst({
    where: { systemName: "bulk_edit_summary" },
  });

  if (!summaryField) {
    summaryField = await prisma.caseFields.create({
      data: {
        displayName: "Summary",
        systemName: "bulk_edit_summary",
        isRequired: true, // Required field for validation testing
        isRestricted: false,
        typeId: textStringType!.id,
      },
    });
  }

  let notesField = await prisma.caseFields.findFirst({
    where: { systemName: "bulk_edit_notes" },
  });

  if (!notesField) {
    notesField = await prisma.caseFields.create({
      data: {
        displayName: "Notes",
        systemName: "bulk_edit_notes",
        isRequired: false,
        isRestricted: true, // Restricted field for permission testing
        typeId: textLongType!.id,
      },
    });
  }

  // Assign fields to templates
  await prisma.templateCaseAssignment.createMany({
    data: [
      { templateId: template1.id, caseFieldId: descriptionField.id, order: 1 },
      { templateId: template1.id, caseFieldId: testDataField.id, order: 2 },
      { templateId: template1.id, caseFieldId: referenceUrlField.id, order: 3 },
      { templateId: template2.id, caseFieldId: summaryField.id, order: 1 },
      { templateId: template2.id, caseFieldId: notesField.id, order: 2 },
    ],
    skipDuplicates: true,
  });

  // Get or create tags
  let regressionTag = await prisma.tags.findFirst({
    where: { name: "Regression" },
  });
  if (!regressionTag) {
    regressionTag = await prisma.tags.create({
      data: { name: "Regression" },
    });
  }

  let smokeTag = await prisma.tags.findFirst({
    where: { name: "Smoke" },
  });
  if (!smokeTag) {
    smokeTag = await prisma.tags.create({
      data: { name: "Smoke" },
    });
  }

  let e2eTag = await prisma.tags.findFirst({
    where: { name: "E2E" },
  });
  if (!e2eTag) {
    e2eTag = await prisma.tags.create({
      data: { name: "E2E" },
    });
  }

  // Get or create issues
  let issue1 = await prisma.issue.findFirst({
    where: { externalId: "BUG-123" },
  });
  if (!issue1) {
    issue1 = await prisma.issue.create({
      data: {
        name: "BUG-123",
        title: "BUG-123",
        externalId: "BUG-123",
        integrationId: integration!.id,
        projectId: existingProject.id,
        createdById: adminUser.id,
      },
    });
  }

  let issue2 = await prisma.issue.findFirst({
    where: { externalId: "BUG-456" },
  });
  if (!issue2) {
    issue2 = await prisma.issue.create({
      data: {
        name: "BUG-456",
        title: "BUG-456",
        externalId: "BUG-456",
        integrationId: integration!.id,
        projectId: existingProject.id,
        createdById: adminUser.id,
      },
    });
  }

  // Get or create root folder for test cases
  let bulkEditRootFolder = await prisma.repositoryFolders.findFirst({
    where: {
      name: "root",
      projectId: 331,
      repositoryId: projectRepository.id,
    },
  });

  if (!bulkEditRootFolder) {
    bulkEditRootFolder = await prisma.repositoryFolders.create({
      data: {
        name: "root",
        projectId: 331,
        repositoryId: projectRepository.id,
        creatorId: adminUser.id,
      },
    });
  }

  // Create test cases with template 1
  const testCases = [];

  // Create specific test cases for each test scenario to avoid parallel test interference
  const testScenarios = [
    // For "should open bulk edit modal and display selected cases count" test
    { prefix: "Test Case Alpha", indices: [1, 2, 3], template: template1 },
    // For "should update state for multiple test cases" test
    { prefix: "State Update Case", indices: [1, 2], template: template1 },
    // For "should perform search and replace on test case names" test
    {
      prefix: "Search Replace Test Case",
      indices: [1, 2, 3],
      template: template1,
    },
    // For "should handle regex search and replace with capture groups" test
    { prefix: "Regex Test Case", indices: [1, 2], template: template1 },
    // For "should update custom text fields" test
    { prefix: "Custom Field Case", indices: [1, 2], template: template1 },
    // For "should handle rich text fields with search and replace" test
    { prefix: "Rich Text Case", indices: [1, 2], template: template1 },
    // For "should update tags for multiple test cases" test
    { prefix: "Tag Update Case", indices: [1, 2, 3], template: template1 },
    // For "should handle bulk delete operation" test (specific deletion cases)
    {
      prefix: "Deletion Test Case",
      indices: [1, 2, 3, 4, 5],
      template: template1,
    },
    // For "should show validation error for empty required fields" test
    { prefix: "Validation Test Case", indices: [1], template: template2 },
    // For "should show warning for test cases with different templates" test
    { prefix: "Template Warning Case", indices: [1, 2], template: template1 },
    // For "should handle case sensitivity in search and replace" test
    { prefix: "Case Sensitive Test", indices: [1, 2], template: template1 },
    // For "should disable save button when no fields are edited" test
    { prefix: "Save Button Test Case", indices: [1, 2], template: template1 },
    // For "should preserve field values when switching between cases in preview" test
    { prefix: "Preview Test Case", indices: [1, 2, 3], template: template1 },
  ];

  // Keep original Test Case Alpha for basic tests
  for (let i = 1; i <= 5; i++) {
    const testCase = await prisma.repositoryCases.create({
      data: {
        name: `Test Case Alpha ${i}`,
        projectId: 331,
        repositoryId: projectRepository.id,
        templateId: template1.id,
        stateId: caseWorkflowDraft!.id,
        creatorId: adminUser.id,
        folderId: bulkEditRootFolder.id,
        automated: i % 2 === 0,
        estimate: i * 60,
        source: i === 3 ? "JUNIT" : "MANUAL",
        tags: {
          connect:
            i === 1
              ? [{ id: regressionTag.id }]
              : i === 2
                ? [{ id: smokeTag.id }, { id: e2eTag.id }]
                : [],
        },
        issues: {
          connect: i === 1 ? [{ id: issue1.id }] : [],
        },
      },
    });

    // Create field values
    await prisma.caseFieldValues.createMany({
      data: [
        {
          testCaseId: testCase.id,
          fieldId: descriptionField.id,
          value: `This is a test case ${i} for login functionality`,
        },
        {
          testCaseId: testCase.id,
          fieldId: testDataField.id,
          value: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: `Username: testuser${i}@example.com` },
                ],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: `Password: Test${i}23!` }],
              },
            ],
          }),
        },
        {
          testCaseId: testCase.id,
          fieldId: referenceUrlField.id,
          value: `https://example.com/test-case-${i}`,
        },
      ],
    });

    testCases.push(testCase);
  }

  // Create test cases with template 2 (different template for warning testing)
  const testCase = await prisma.repositoryCases.create({
    data: {
      name: `Test Case Beta 1`,
      projectId: 331,
      repositoryId: projectRepository.id,
      templateId: template2.id,
      stateId: caseWorkflowDraft!.id,
      creatorId: regularUser.id,
      folderId: bulkEditRootFolder.id,
      automated: false,
      estimate: 60,
      source: "MANUAL",
    },
  });

  // Create field values
  await prisma.caseFieldValues.createMany({
    data: [
      {
        testCaseId: testCase.id,
        fieldId: summaryField.id,
        value: `Summary for test case 1`,
      },
      {
        testCaseId: testCase.id,
        fieldId: notesField.id,
        value: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Note: This is test case 1 with restricted field`,
                },
              ],
            },
          ],
        }),
      },
    ],
  });

  testCases.push(testCase);

  // Create specific test cases for each scenario
  for (const scenario of testScenarios) {
    for (const index of scenario.indices) {
      const caseData = {
        name: `${scenario.prefix} ${index}`,
        projectId: 331,
        repositoryId: projectRepository.id,
        templateId: scenario.template.id,
        stateId: caseWorkflowDraft!.id,
        creatorId:
          scenario.prefix.includes("Validation") ||
          (scenario.prefix.includes("Template Warning") && index === 2)
            ? regularUser.id
            : adminUser.id,
        folderId: bulkEditRootFolder.id,
        automated: index % 2 === 0,
        estimate: index * 60,
        source: "MANUAL" as const,
        tags:
          scenario.prefix === "Tag Update Case" && index === 1
            ? { connect: [{ id: regressionTag.id }] }
            : {},
        issues:
          scenario.prefix === "Tag Update Case" && index === 2
            ? { connect: [{ id: issue1.id }] }
            : {},
      };

      const testCase = await prisma.repositoryCases.create({ data: caseData });

      // Create field values based on template
      if (scenario.template.id === template1.id) {
        await prisma.caseFieldValues.createMany({
          data: [
            {
              testCaseId: testCase.id,
              fieldId: descriptionField.id,
              value: scenario.prefix.includes("Custom Field")
                ? `Description for ${scenario.prefix} ${index}`
                : `This is a test case ${index} for ${scenario.prefix}`,
            },
            {
              testCaseId: testCase.id,
              fieldId: testDataField.id,
              value: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: scenario.prefix.includes("Rich Text")
                          ? `Username: richtext${index}@example.com`
                          : `Username: testuser${index}@example.com`,
                      },
                    ],
                  },
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: `Password: Test${index}23!` },
                    ],
                  },
                ],
              }),
            },
            {
              testCaseId: testCase.id,
              fieldId: referenceUrlField.id,
              value: `https://example.com/${scenario.prefix.toLowerCase().replace(/\s+/g, "-")}-${index}`,
            },
          ],
        });
      } else if (scenario.template.id === template2.id) {
        await prisma.caseFieldValues.createMany({
          data: [
            {
              testCaseId: testCase.id,
              fieldId: summaryField.id,
              value: `Summary for ${scenario.prefix} ${index}`,
            },
            {
              testCaseId: testCase.id,
              fieldId: notesField.id,
              value: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: `Note: This is ${scenario.prefix} ${index} with restricted field`,
                      },
                    ],
                  },
                ],
              }),
            },
          ],
        });
      }

      testCases.push(testCase);
    }
  }

  console.log(
    `Seeded ${testCases.length} test cases for bulk edit testing in project 331.`
  );
  console.log("Bulk edit test data includes:");
  console.log("- 2 different templates with custom fields");
  console.log("- Mix of automated and manual test cases");
  console.log("- Various states, tags, and issues");
  console.log("- Required and restricted fields for validation testing");
  console.log("- Rich text fields for search/replace testing");
}

// --- Seed Date Range Test Data ---
async function seedDateRangeTestData() {
  console.log("Seeding comprehensive date range test data...");

  const adminUser = await prisma.user.findUnique({
    where: { email: "admin@testplanit.com" },
  });

  const regularUser = await prisma.user.findUnique({
    where: { email: "testuser@example.com" },
  });

  if (!adminUser || !regularUser) {
    console.error("Required users not found for date range test data");
    return;
  }

  // Get project 331
  const project = await prisma.projects.findUnique({
    where: { id: 331 },
    include: {
      repositories: true,
    },
  });

  if (!project) {
    console.error("Project 331 not found for date range test data");
    return;
  }

  // Get required entities
  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
  });

  const defaultCaseWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDefault: true },
  });

  const defaultRunWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDefault: true },
  });

  const rootFolder = await prisma.repositoryFolders.findFirst({
    where: {
      projectId: project.id,
      parentId: null,
    },
  });

  const passedStatus = await prisma.status.findFirst({
    where: { name: "Passed" },
  });

  const failedStatus = await prisma.status.findFirst({
    where: { name: "Failed" },
  });

  const skippedStatus = await prisma.status.findFirst({
    where: { name: "Skipped" },
  });

  if (
    !defaultTemplate ||
    !defaultCaseWorkflow ||
    !defaultRunWorkflow ||
    !rootFolder ||
    !passedStatus ||
    !failedStatus
  ) {
    console.error("Required entities not found for date range test data");
    return;
  }

  // Create comprehensive date ranges
  const now = new Date();
  now.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues

  // Helper functions for date calculations
  const subDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  };

  const subMonths = (date: Date, months: number) => {
    const result = new Date(date);
    result.setMonth(result.getMonth() - months);
    return result;
  };

  const startOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  };

  const endOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  };

  const startOfQuarter = (date: Date) => {
    const quarter = Math.floor(date.getMonth() / 3);
    return new Date(date.getFullYear(), quarter * 3, 1);
  };

  const endOfQuarter = (date: Date) => {
    const quarter = Math.floor(date.getMonth() / 3);
    return new Date(date.getFullYear(), quarter * 3 + 3, 0);
  };

  const dateRanges = [
    // Historical data (for custom range testing)
    { label: "1 year ago", date: subMonths(now, 12) },
    { label: "9 months ago", date: subMonths(now, 9) },
    { label: "6 months ago", date: subMonths(now, 6) },

    // Previous quarter dates (testing "Previous Quarter" filter)
    {
      label: "Previous quarter start",
      date: startOfQuarter(subMonths(now, 3)),
    },
    { label: "Previous quarter middle", date: subMonths(now, 4) },
    { label: "Previous quarter end", date: endOfQuarter(subMonths(now, 3)) },

    // Current quarter but older than 30 days
    { label: "Current quarter start", date: startOfQuarter(now) },
    { label: "45 days ago", date: subDays(now, 45) },
    { label: "35 days ago", date: subDays(now, 35) },

    // Previous month dates (testing "Previous Month" filter)
    { label: "Previous month start", date: startOfMonth(subMonths(now, 1)) },
    {
      label: "Previous month middle",
      date: new Date(now.getFullYear(), now.getMonth() - 1, 15),
    },
    { label: "Previous month end", date: endOfMonth(subMonths(now, 1)) },

    // Last 30 days range (testing "Last 30 days" filter)
    { label: "30 days ago", date: subDays(now, 30) },
    { label: "29 days ago", date: subDays(now, 29) },
    { label: "25 days ago", date: subDays(now, 25) },
    { label: "20 days ago", date: subDays(now, 20) },
    { label: "15 days ago", date: subDays(now, 15) },
    { label: "10 days ago", date: subDays(now, 10) },
    { label: "8 days ago", date: subDays(now, 8) },

    // Last 7 days range (testing "Last 7 days" filter)
    { label: "7 days ago", date: subDays(now, 7) },
    { label: "6 days ago", date: subDays(now, 6) },
    { label: "5 days ago", date: subDays(now, 5) },
    { label: "4 days ago", date: subDays(now, 4) },
    { label: "3 days ago", date: subDays(now, 3) },
    { label: "2 days ago", date: subDays(now, 2) },
    { label: "Yesterday", date: subDays(now, 1) },
    {
      label: "Today morning",
      date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0),
    },
    { label: "Today noon", date: now },
    {
      label: "Today evening",
      date: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        18,
        0,
        0
      ),
    },
  ];

  // Create repository cases across different dates
  const testCases = [];
  for (const [index, range] of dateRanges.entries()) {
    const testCase = await prisma.repositoryCases.create({
      data: {
        name: `DR Test Case ${index + 1} - ${range.label}`,
        projectId: project.id,
        repositoryId: project.repositories[0]!.id,
        creatorId: index % 2 === 0 ? adminUser.id : regularUser.id,
        folderId: rootFolder.id,
        templateId: defaultTemplate.id,
        stateId: defaultCaseWorkflow.id,
        automated: index % 3 === 0, // Every third case is automated
        createdAt: range.date,
      },
    });
    testCases.push(testCase);
  }

  // Create test runs with comprehensive coverage
  const testRuns = [];
  const runIndices = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]; // Select specific date indices for runs

  for (const [idx, rangeIndex] of runIndices.entries()) {
    if (rangeIndex >= dateRanges.length) continue;
    const range = dateRanges[rangeIndex];

    const testRun = await prisma.testRuns.create({
      data: {
        name: `DR Test Run ${idx + 1} - ${range.label}`,
        projectId: project.id,
        stateId: defaultRunWorkflow.id,
        createdById: idx % 2 === 0 ? adminUser.id : regularUser.id,
        createdAt: range.date,
        completedAt: idx % 4 !== 0 ? range.date : null, // Some runs not completed
      },
    });
    testRuns.push(testRun);

    // Add test cases to runs
    const numCases = 3 + (idx % 3); // Vary number of cases per run (3-5)
    const startIndex = Math.min(rangeIndex, testCases.length - numCases);
    const casesToAdd = testCases.slice(startIndex, startIndex + numCases);

    for (const [caseIndex, testCase] of casesToAdd.entries()) {
      const testRunCase = await prisma.testRunCases.create({
        data: {
          testRunId: testRun.id,
          repositoryCaseId: testCase.id,
          order: caseIndex + 1,
        },
      });

      // Create multiple test results with varied execution times throughout the day
      const numResults = 1 + (caseIndex % 3); // 1-3 results per case
      for (let resultIdx = 0; resultIdx < numResults; resultIdx++) {
        const resultDate = new Date(range.date);
        resultDate.setHours(9 + resultIdx * 4 + caseIndex); // Stagger execution times (9am, 1pm, 5pm)

        const statusOptions = [passedStatus.id, failedStatus.id];
        if (skippedStatus) statusOptions.push(skippedStatus.id);
        const statusId =
          statusOptions[(caseIndex + resultIdx) % statusOptions.length];

        await prisma.testRunResults.create({
          data: {
            testRunId: testRun.id,
            testRunCaseId: testRunCase.id,
            statusId: statusId,
            executedById:
              (idx + resultIdx) % 2 === 0 ? adminUser.id : regularUser.id,
            executedAt: resultDate,
            elapsed: 60000 + resultIdx * 30000 + caseIndex * 15000, // 1-3 minutes varied by position
            notes: {
              text: `Execution ${resultIdx + 1} at ${resultDate.toLocaleTimeString()}`,
            },
          },
        });
      }
    }
  }

  // Create sessions with comprehensive date coverage
  const sessionWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.SESSIONS, isDefault: true },
  });

  if (sessionWorkflow) {
    const sessionIndices = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]; // Different indices than runs

    for (const [idx, rangeIndex] of sessionIndices.entries()) {
      if (rangeIndex >= dateRanges.length) continue;
      const range = dateRanges[rangeIndex];

      const session = await prisma.sessions.create({
        data: {
          name: `DR Session ${idx + 1} - ${range.label}`,
          projectId: project.id,
          templateId: defaultTemplate.id,
          stateId: sessionWorkflow.id,
          createdById: idx % 2 === 0 ? adminUser.id : regularUser.id,
          assignedToId: idx % 2 === 0 ? regularUser.id : adminUser.id, // Cross-assignment
          estimate: 3600000 * (1 + (idx % 3)), // 1-3 hours
          elapsed: 1800000 + idx * 600000, // 30 minutes + incremental
          isCompleted: idx % 3 !== 2, // Every 3rd session not completed
          createdAt: range.date,
          completedAt: idx % 3 !== 2 ? range.date : null,
        },
      });

      // Create session results
      if (session.isCompleted && passedStatus && failedStatus) {
        const numSessionResults = 1 + (idx % 2); // 1-2 results per session
        for (let resIdx = 0; resIdx < numSessionResults; resIdx++) {
          await prisma.sessionResults.create({
            data: {
              sessionId: session.id,
              statusId:
                (idx + resIdx) % 2 === 0 ? passedStatus.id : failedStatus.id,
              createdById: idx % 2 === 0 ? adminUser.id : regularUser.id,
              createdAt: new Date(range.date.getTime() + resIdx * 3600000), // 1 hour apart
              elapsed: 900000 + resIdx * 300000, // 15-20 minutes
              resultData: { details: `Session result ${resIdx + 1}` },
            },
          });
        }
      }
    }
  }

  // Create issues across dates for comprehensive issue reporting
  // Issues now use integrations, not issue configs directly
  const simpleUrlIntegration = await prisma.integration.findFirst({
    where: {
      provider: "SIMPLE_URL",
      isDeleted: false,
    },
  });

  if (simpleUrlIntegration) {
    const issueIndices = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29]; // Different pattern

    for (const [idx, rangeIndex] of issueIndices.entries()) {
      if (rangeIndex >= dateRanges.length) continue;
      const range = dateRanges[rangeIndex];

      await prisma.issue.create({
        data: {
          name: `DR Issue ${idx + 1} - ${range.label}`,
          title: `DR Issue ${idx + 1} - ${range.label}`,
          note: {
            text: `Issue reported on ${range.date.toLocaleDateString()}`,
          },
          integrationId: simpleUrlIntegration.id,
          projectId: 331, // Use the test project ID
          createdById: idx % 2 === 0 ? regularUser.id : adminUser.id,
          createdAt: range.date,
        },
      });
    }
  }

  console.log(
    `✅ Seeded ${testCases.length} test cases spanning ${dateRanges.length} different dates`
  );
  console.log(
    `✅ Seeded ${testRuns.length} test runs with multiple results across different times`
  );
  console.log(
    `✅ Created sessions and issues with comprehensive date coverage`
  );
  console.log(`📅 Date ranges include:`);
  console.log(`   - Historical: 1 year, 6 months, 3 months ago`);
  console.log(`   - Previous Quarter: start, middle, end`);
  console.log(`   - Previous Month: start, middle, end`);
  console.log(`   - Last 30 days: multiple data points`);
  console.log(`   - Last 7 days: daily data points`);
  console.log(`   - Today: morning, noon, evening`);
}

// --- Seed SSO Provider Test Data ---
async function seedSsoProviderTestData() {
  console.log("Seeding SSO provider test data...");

  // Create Google OAuth provider (disabled by default, needs configuration)
  const googleProvider = await prisma.ssoProvider.upsert({
    where: {
      id: "test-google-oauth-provider",
    },
    update: {
      name: "Google OAuth",
      type: "GOOGLE",
      enabled: false,
      config: {},
    },
    create: {
      id: "test-google-oauth-provider",
      name: "Google OAuth",
      type: "GOOGLE",
      enabled: false,
      config: {},
    },
  });
  console.log(`Created Google OAuth provider (disabled - needs configuration)`);

  // Create Apple Sign In provider (disabled by default, needs configuration)
  const appleProvider = await prisma.ssoProvider.upsert({
    where: {
      id: "test-apple-signin-provider",
    },
    update: {
      name: "Apple Sign In",
      type: "APPLE",
      enabled: false,
      config: {},
    },
    create: {
      id: "test-apple-signin-provider",
      name: "Apple Sign In",
      type: "APPLE",
      enabled: false,
      config: {},
    },
  });
  console.log(
    `Created Apple Sign In provider (disabled - needs configuration)`
  );

  // Create SAML provider (disabled by default, needs configuration)
  const samlProvider = await prisma.ssoProvider.upsert({
    where: {
      id: "test-saml-provider",
    },
    update: {
      name: "SAML Provider",
      type: "SAML",
      enabled: false,
      config: {},
    },
    create: {
      id: "test-saml-provider",
      name: "SAML Provider",
      type: "SAML",
      enabled: false,
      config: {},
    },
  });
  console.log(`Created SAML provider (disabled - needs configuration)`);

  // Create Magic Link provider (enabled but NOT forced in test mode to allow password auth)
  const magicLinkProvider = await prisma.ssoProvider.upsert({
    where: {
      id: "test-magic-link-provider",
    },
    update: {
      name: "Magic Link",
      type: "MAGIC_LINK",
      enabled: true,
      forceSso: false, // Do NOT force SSO in test mode - allow password authentication
      config: {},
    },
    create: {
      id: "test-magic-link-provider",
      name: "Magic Link",
      type: "MAGIC_LINK",
      enabled: true,
      forceSso: false, // Do NOT force SSO in test mode - allow password authentication
      config: {},
    },
  });
  console.log(
    `Created Magic Link provider with forceSso=false (allows password auth in tests)`
  );
}

// --- Seed Domain Restriction Test Data ---
async function seedDomainRestrictionTestData() {
  console.log("Seeding domain restriction test data...");

  // Create registration settings with domain restriction enabled
  const registrationSettings = await prisma.registrationSettings.upsert({
    where: { id: "test-registration-settings" },
    update: {
      restrictEmailDomains: true,
      allowOpenRegistration: true,
    },
    create: {
      id: "test-registration-settings",
      restrictEmailDomains: true,
      allowOpenRegistration: true,
    },
  });

  console.log(`Created registration settings with domain restriction enabled`);

  // Create allowed email domains
  const testDomains = ["testplanit.com", "example.org", "allowed-domain.net"];

  for (const domain of testDomains) {
    await prisma.allowedEmailDomain.upsert({
      where: { domain },
      update: {
        enabled: true,
      },
      create: {
        domain,
        enabled: true,
      },
    });
    console.log(`Created allowed email domain: ${domain}`);
  }

  // Create one disabled domain for testing
  await prisma.allowedEmailDomain.upsert({
    where: { domain: "disabled-domain.com" },
    update: {
      enabled: false,
    },
    create: {
      domain: "disabled-domain.com",
      enabled: false,
    },
  });
  console.log(`Created disabled email domain: disabled-domain.com`);
}

async function seedNotificationTestData() {
  console.log("Seeding notification test data...");

  // Create global notification settings in AppConfig
  const notificationConfig = await prisma.appConfig.findUnique({
    where: { key: "notificationSettings" },
  });
  if (!notificationConfig) {
    await prisma.appConfig.create({
      data: {
        key: "notificationSettings",
        value: {
          defaultMode: "IN_APP_EMAIL_IMMEDIATE",
        },
      },
    });
    console.log("Created global notification settings in AppConfig");
  }

  // Create test users for notification tests
  const testUsers = [
    {
      email: "testuser1@example.com",
      name: "Test User 1",
      password: "password123",
    },
    {
      email: "testuser2@example.com",
      name: "Test User 2",
      password: "password123",
    },
    {
      email: "testuser3@example.com",
      name: "Test User 3",
      password: "password123",
    },
    {
      email: "userWithNotifications@example.com",
      name: "User With Notifications",
      password: "password123",
    },
    {
      email: "userWithoutNotifications@example.com",
      name: "User Without Notifications",
      password: "password123",
    },
  ];

  const userRole = await prisma.roles.findUnique({ where: { name: "user" } });

  for (const userData of testUsers) {
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (!existingUser && userRole) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      await prisma.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          password: hashedPassword,
          roleId: userRole.id,
          emailVerified: new Date().toISOString(),
          isActive: true,
          access: "USER",
          userPreferences: {
            create: {
              itemsPerPage: "P10",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              theme: "Light",
              locale: "en_US",
              hasCompletedWelcomeTour: true,
              hasCompletedInitialPreferencesSetup: true,
              notificationMode:
                userData.email === "userWithoutNotifications@example.com"
                  ? "NONE"
                  : "USE_GLOBAL",
            },
          },
        },
      });
      console.log(`Created test user: ${userData.email}`);
    }
  }

  // Get admin user first
  const adminUser = await prisma.user.findUnique({
    where: { email: "admin@testplanit.com" },
  });

  // Create test project for notification E2E tests
  let notificationProject = await prisma.projects.findUnique({
    where: { name: "E2E Notification Test Project" },
  });

  if (!notificationProject && adminUser) {
    notificationProject = await prisma.projects.create({
      data: {
        name: "E2E Notification Test Project",
        createdBy: adminUser.id,
      },
    });
    console.log("Created E2E notification test project");
  }

  const testUser1 = await prisma.user.findUnique({
    where: { email: "testuser1@example.com" },
  });

  const testUser2 = await prisma.user.findUnique({
    where: { email: "testuser2@example.com" },
  });

  const testUser3 = await prisma.user.findUnique({
    where: { email: "testuser3@example.com" },
  });

  const userWithNotifications = await prisma.user.findUnique({
    where: { email: "userWithNotifications@example.com" },
  });

  if (
    adminUser &&
    testUser1 &&
    testUser2 &&
    testUser3 &&
    userWithNotifications &&
    notificationProject
  ) {
    // Add users to project
    const usersToAdd = [
      adminUser,
      testUser1,
      testUser2,
      testUser3,
      userWithNotifications,
    ];

    for (const user of usersToAdd) {
      const existingMembership = await prisma.projectAssignment.findUnique({
        where: {
          userId_projectId: {
            userId: user.id,
            projectId: notificationProject.id,
          },
        },
      });

      if (!existingMembership) {
        await prisma.projectAssignment.create({
          data: {
            userId: user.id,
            projectId: notificationProject.id,
          },
        });
      }
    }

    // Create test cases for notification testing
    const defaultTemplate = await prisma.templates.findFirst({
      where: { isDefault: true },
    });
    const testCaseWorkflow = await prisma.workflows.findFirst({
      where: { scope: "CASES", isDefault: true },
    });
    const defaultRepository = await prisma.repositories.findFirst({
      where: { projectId: notificationProject.id },
    });

    // Create repository if it doesn't exist
    let repository = defaultRepository;
    if (!repository) {
      repository = await prisma.repositories.create({
        data: {
          projectId: notificationProject.id,
        },
      });
    }

    if (defaultTemplate && testCaseWorkflow && repository) {
      // Create or find root folder
      let rootFolder = await prisma.repositoryFolders.findFirst({
        where: {
          projectId: notificationProject.id,
          repositoryId: repository.id,
          parentId: null,
        },
      });

      if (!rootFolder) {
        rootFolder = await prisma.repositoryFolders.create({
          data: {
            name: "Root",
            projectId: notificationProject.id,
            repositoryId: repository.id,
            creatorId: adminUser.id,
          },
        });
      }

      // Create test case for assignment
      const existingTestCase = await prisma.repositoryCases.findFirst({
        where: {
          projectId: notificationProject.id,
          name: "Test Case for Assignment",
        },
      });

      if (!existingTestCase) {
        await prisma.repositoryCases.create({
          data: {
            name: "Test Case for Assignment",
            projectId: notificationProject.id,
            repositoryId: repository.id,
            folderId: rootFolder.id,
            templateId: defaultTemplate.id,
            stateId: testCaseWorkflow.id,
            creatorId: adminUser.id,
          },
        });
      }

      // Create additional test cases for bulk assignment
      const bulkTestCases = [
        "Bulk Test Case 1",
        "Bulk Test Case 2",
        "Bulk Test Case 3",
      ];

      for (const testCaseName of bulkTestCases) {
        const existing = await prisma.repositoryCases.findFirst({
          where: {
            projectId: notificationProject.id,
            name: testCaseName,
          },
        });

        if (!existing) {
          await prisma.repositoryCases.create({
            data: {
              name: testCaseName,
              projectId: notificationProject.id,
              repositoryId: repository.id,
              folderId: rootFolder.id,
              templateId: defaultTemplate.id,
              stateId: testCaseWorkflow.id,
              creatorId: adminUser.id,
            },
          });
        }
      }
    }

    // Create session for assignment
    const existingSession = await prisma.sessions.findFirst({
      where: {
        projectId: notificationProject.id,
        name: "Session for Assignment",
      },
    });

    if (!existingSession) {
      // Get default template and workflow for sessions
      const defaultTemplate = await prisma.templates.findFirst({
        where: { isDefault: true },
      });
      const sessionWorkflow = await prisma.workflows.findFirst({
        where: { scope: "SESSIONS", isDefault: true },
      });

      if (defaultTemplate && sessionWorkflow) {
        await prisma.sessions.create({
          data: {
            name: "Session for Assignment",
            projectId: notificationProject.id,
            templateId: defaultTemplate.id,
            stateId: sessionWorkflow.id,
            createdById: adminUser.id,
          },
        });
      }
    }

    // Create test runs for notification testing
    const testRunWorkflow = await prisma.workflows.findFirst({
      where: { scope: WorkflowScope.RUNS, isDefault: true },
    });

    if (testRunWorkflow) {
      // Check if test run already exists
      const existingTestRun = await prisma.testRuns.findFirst({
        where: {
          projectId: notificationProject.id,
          name: "Test Run for Notifications",
        },
      });

      if (!existingTestRun) {
        // Create test run
        const testRun = await prisma.testRuns.create({
          data: {
            name: "Test Run for Notifications",
            projectId: notificationProject.id,
            createdById: adminUser.id,
            stateId: testRunWorkflow.id,
          },
        });

        // Get all test cases for this project
        const testCases = await prisma.repositoryCases.findMany({
          where: {
            projectId: notificationProject.id,
          },
        });

        // Add test cases to the test run
        for (const testCase of testCases) {
          await prisma.testRunCases.create({
            data: {
              testRunId: testRun.id,
              repositoryCaseId: testCase.id,
              // status field is not needed - test run cases default to untested
              order: testCase.id, // Use ID as order for simplicity
            },
          });
        }

        console.log("Created test run with test cases for notifications");
      }
    }

    // Create existing notifications for userWithNotifications
    const notificationData = [
      {
        type: "WORK_ASSIGNED",
        title: "Test Case Assignment",
        message: "You have been assigned to test case 'Existing Test 1'",
        isRead: false,
      },
      {
        type: "WORK_ASSIGNED",
        title: "Test Case Assignment",
        message: "You have been assigned to test case 'Existing Test 2'",
        isRead: false,
      },
      {
        type: "SESSION_ASSIGNED",
        title: "Session Assignment",
        message: "You have been assigned to session 'Existing Session 1'",
        isRead: true,
      },
    ];

    for (const notif of notificationData) {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: userWithNotifications.id,
          title: notif.title,
          message: notif.message,
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            userId: userWithNotifications.id,
            type: notif.type as any,
            title: notif.title,
            message: notif.message,
            isRead: notif.isRead,
            isDeleted: false,
          },
        });
      }
    }

    console.log("Created sample notifications for userWithNotifications");

    // Ensure userWithNotifications has preferences set
    await prisma.userPreferences.upsert({
      where: { userId: userWithNotifications.id },
      update: {},
      create: {
        userId: userWithNotifications.id,
        notificationMode: "USE_GLOBAL",
      },
    });
  }

  console.log("Notification test data seeding complete");
}

// --- Advanced Search Test Data ---
async function seedAdvancedSearchData() {
  console.log("Seeding advanced search test data...");

  // Find or create John Doe user
  let johnDoe = await prisma.user.findUnique({
    where: { email: "john.doe@example.com" },
  });

  if (!johnDoe) {
    const hashedPassword = await bcrypt.hash("password123", 10);
    const userRole = await prisma.roles.findUnique({
      where: { name: "user" },
    });
    if (userRole) {
      johnDoe = await prisma.user.create({
        data: {
          name: "John Doe",
          email: "john.doe@example.com",
          password: hashedPassword,
          roleId: userRole.id,
          emailVerified: new Date().toISOString(),
          isActive: true,
          access: "USER",
          userPreferences: {
            create: {
              itemsPerPage: "P10",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              theme: "Light",
              locale: "en_US",
              hasCompletedWelcomeTour: true,
              hasCompletedInitialPreferencesSetup: true,
            },
          },
        },
      });
      console.log("Created John Doe user for search tests");
    }
  }

  if (!johnDoe) {
    console.error("Failed to create John Doe user");
    return;
  }

  // Create or find MyProject
  let myProject = await prisma.projects.findFirst({
    where: { name: "MyProject" },
  });

  if (!myProject) {
    myProject = await prisma.projects.create({
      data: {
        name: "MyProject",
        createdBy: johnDoe.id,
        iconUrl: null,
        isCompleted: false,
        isDeleted: false,
        docs: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Project for advanced search testing. Contains various login-related test cases, runs, and sessions.",
                },
              ],
            },
          ],
        }),
      },
    });
    console.log("Created MyProject with ID:", myProject.id);
  } else {
    console.log("Found existing MyProject with ID:", myProject.id);
  }

  // Assign John Doe to the project
  await prisma.userProjectPermission.upsert({
    where: {
      userId_projectId: {
        userId: johnDoe.id,
        projectId: myProject.id,
      },
    },
    update: {},
    create: {
      userId: johnDoe.id,
      projectId: myProject.id,
      accessType: ProjectAccessType.SPECIFIC_ROLE,
      roleId: (await prisma.roles.findUnique({ where: { name: "user" } }))?.id,
    },
  });

  // Create repository for MyProject
  let repository = await prisma.repositories.findFirst({
    where: { projectId: myProject.id },
  });

  if (!repository) {
    repository = await prisma.repositories.create({
      data: {
        projectId: myProject.id,
      },
    });
  }

  // Create tags
  const smokeTag = await prisma.tags.upsert({
    where: { name: "smoke" },
    update: {},
    create: { name: "smoke", isDeleted: false },
  });

  const regressionTag = await prisma.tags.upsert({
    where: { name: "regression" },
    update: {},
    create: { name: "regression", isDeleted: false },
  });

  const negativeTag = await prisma.tags.upsert({
    where: { name: "negative" },
    update: {},
    create: { name: "negative", isDeleted: false },
  });

  // Get the default workflow state for cases
  let readyState = await prisma.workflows.findFirst({
    where: {
      scope: WorkflowScope.CASES,
      isDefault: true,
    },
  });

  if (!readyState) {
    // Try to find any workflow state for cases
    readyState = await prisma.workflows.findFirst({
      where: {
        scope: WorkflowScope.CASES,
      },
    });

    if (!readyState) {
      console.error("No workflow states found for test cases");
      return;
    }
  }

  // Get default template
  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
  });

  if (!defaultTemplate) {
    console.error("Default template not found");
    return;
  }

  // Create root folder first
  let rootFolder = await prisma.repositoryFolders.findFirst({
    where: {
      name: "root",
      repositoryId: repository.id,
      parentId: null,
    },
  });

  if (!rootFolder) {
    rootFolder = await prisma.repositoryFolders.create({
      data: {
        name: "root",
        repositoryId: repository.id,
        projectId: myProject.id,
        creatorId: johnDoe.id,
        order: 0,
        isDeleted: false,
      },
    });
  }

  // Create folder structure: root > Authentication > Login Tests
  let authFolder = await prisma.repositoryFolders.findFirst({
    where: {
      name: "Authentication",
      repositoryId: repository.id,
      parentId: rootFolder.id,
    },
  });

  if (!authFolder) {
    authFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Authentication",
        repositoryId: repository.id,
        projectId: myProject.id,
        creatorId: johnDoe.id,
        parentId: rootFolder.id,
        order: 1,
        isDeleted: false,
      },
    });
  }

  let loginTestsFolder = await prisma.repositoryFolders.findFirst({
    where: {
      name: "Login Tests",
      repositoryId: repository.id,
      parentId: authFolder.id,
    },
  });

  if (!loginTestsFolder) {
    loginTestsFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Login Tests",
        repositoryId: repository.id,
        projectId: myProject.id,
        creatorId: johnDoe.id,
        parentId: authFolder.id,
        order: 1,
        isDeleted: false,
      },
    });
  }

  // Create test cases with "login" in the name
  const testCases = [
    {
      name: "Login with valid credentials",
      tags: [smokeTag.id, regressionTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Login page is displayed",
        },
        {
          step: "Enter valid username and password",
          expectedResult: "Credentials are accepted",
        },
        {
          step: "Click login button",
          expectedResult: "User is logged in successfully",
        },
      ],
    },
    {
      name: "Login with invalid password",
      tags: [negativeTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Login page is displayed",
        },
        {
          step: "Enter valid username but wrong password",
          expectedResult: "Password field accepts input",
        },
        {
          step: "Click login button",
          expectedResult: "Error message is displayed",
        },
      ],
    },
    {
      name: "Login with empty credentials",
      tags: [negativeTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Login page is displayed",
        },
        {
          step: "Leave username and password fields empty",
          expectedResult: "Fields remain empty",
        },
        {
          step: "Click login button",
          expectedResult: "Validation error is displayed",
        },
      ],
    },
    {
      name: "Login session timeout handling",
      tags: [regressionTag.id],
      steps: [
        { step: "Login successfully", expectedResult: "User is logged in" },
        { step: "Wait for session timeout", expectedResult: "Session expires" },
        {
          step: "Try to perform an action",
          expectedResult: "User is redirected to login page",
        },
      ],
    },
    {
      name: "Remember me login functionality",
      tags: [smokeTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Login page is displayed",
        },
        {
          step: "Enter credentials and check 'Remember me'",
          expectedResult: "Checkbox is selected",
        },
        {
          step: "Login and close browser",
          expectedResult: "User session is preserved",
        },
      ],
    },
    {
      name: "Social login integration",
      tags: [regressionTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Social login options are visible",
        },
        {
          step: "Click on Google login",
          expectedResult: "Google auth page opens",
        },
        {
          step: "Complete Google authentication",
          expectedResult: "User is logged in via Google",
        },
      ],
    },
    {
      name: "Password reset from login",
      tags: [smokeTag.id],
      steps: [
        {
          step: "Navigate to login page",
          expectedResult: "Login page is displayed",
        },
        {
          step: "Click 'Forgot password' link",
          expectedResult: "Password reset page opens",
        },
        {
          step: "Enter email and submit",
          expectedResult: "Reset email is sent",
        },
      ],
    },
    {
      name: "Multi-factor authentication login",
      tags: [smokeTag.id, regressionTag.id],
      steps: [
        {
          step: "Enter username and password",
          expectedResult: "Credentials accepted",
        },
        { step: "Enter MFA code", expectedResult: "MFA prompt appears" },
        {
          step: "Submit valid MFA code",
          expectedResult: "Login successful with MFA",
        },
      ],
    },
  ];

  // Create test cases
  const createdTestCases = [];
  console.log(
    "Creating test cases for project ID:",
    myProject.id,
    "repository ID:",
    repository.id,
    "folder ID:",
    loginTestsFolder.id
  );

  // Check if test cases already exist
  const existingTestCases = await prisma.repositoryCases.count({
    where: {
      projectId: myProject.id,
      name: {
        contains: "login",
        mode: "insensitive",
      },
    },
  });

  if (existingTestCases > 0) {
    console.log(
      `Found ${existingTestCases} existing test cases with "login" in the name. Skipping test case creation.`
    );
    // Get existing test cases for later use
    const existing = await prisma.repositoryCases.findMany({
      where: {
        projectId: myProject.id,
        name: {
          contains: "login",
          mode: "insensitive",
        },
      },
    });
    createdTestCases.push(...existing);
  } else {
    for (const testCaseData of testCases) {
      const testCase = await prisma.repositoryCases.create({
        data: {
          name: testCaseData.name,
          repositoryId: repository.id,
          projectId: myProject.id,
          folderId: loginTestsFolder.id,
          templateId: defaultTemplate.id,
          stateId: readyState.id,
          creatorId: johnDoe.id,
          className: testCaseData.name.toLowerCase().replace(/\s+/g, "_"),
          estimate: Math.floor(Math.random() * 600) + 300, // 5-15 minutes
          forecastManual: 0,
          forecastAutomated: 0,
          automated: false,
          isArchived: false,
          isDeleted: false,
          source: "MANUAL",
          tags: {
            connect: testCaseData.tags.map((tagId) => ({ id: tagId })),
          },
        },
      });

      // Create steps
      for (let i = 0; i < testCaseData.steps.length; i++) {
        const stepData = testCaseData.steps[i];
        await prisma.steps.create({
          data: {
            testCaseId: testCase.id,
            order: i + 1,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: stepData.step }],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: stepData.expectedResult }],
                },
              ],
            }),
          },
        });
      }

      createdTestCases.push(testCase);
    }
  }

  // Create test runs with "login" in the name
  let runReadyState = await prisma.workflows.findFirst({
    where: {
      scope: WorkflowScope.RUNS,
      isDefault: true,
    },
  });

  if (!runReadyState) {
    // Try to find any workflow state for runs
    runReadyState = await prisma.workflows.findFirst({
      where: {
        scope: WorkflowScope.RUNS,
      },
    });
  }

  if (runReadyState) {
    // Check if test runs already exist
    const existingRuns = await prisma.testRuns.count({
      where: {
        projectId: myProject.id,
        name: {
          contains: "Login",
        },
      },
    });

    if (existingRuns > 0) {
      console.log(
        `Found ${existingRuns} existing test runs with "Login" in the name. Skipping test run creation.`
      );
    } else {
      const testRuns = [
        { name: "Login Feature - Smoke Test Run", isCompleted: true },
        { name: "Login Security Test Suite", isCompleted: true },
        { name: "Login Performance Testing", isCompleted: false },
        { name: "Login Regression Suite v2.1", isCompleted: true },
      ];

      for (const runData of testRuns) {
        const testRun = await prisma.testRuns.create({
          data: {
            name: runData.name,
            projectId: myProject.id,
            stateId: runReadyState.id,
            createdById: johnDoe.id,
            isCompleted: runData.isCompleted,
            completedAt: runData.isCompleted ? new Date() : null,
            elapsed: runData.isCompleted
              ? Math.floor(Math.random() * 7200) + 1800
              : 0, // 30-150 minutes
            testRunType: "REGULAR",
            isDeleted: false,
            note: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: `Testing login functionality - ${runData.name}`,
                    },
                  ],
                },
              ],
            }),
          },
        });

        // Add some test cases to the run
        const casesToAdd = createdTestCases.slice(
          0,
          Math.floor(Math.random() * 4) + 2
        );
        for (const testCase of casesToAdd) {
          await prisma.testRunCases.create({
            data: {
              testRunId: testRun.id,
              repositoryCaseId: testCase.id,
              order: testCase.id,
            },
          });
        }
      }
    }
  }

  // Create sessions with "login" in the name
  let sessionNewState = await prisma.workflows.findFirst({
    where: {
      scope: WorkflowScope.SESSIONS,
      isDefault: true,
    },
  });

  if (!sessionNewState) {
    // Try to find any workflow state for sessions
    sessionNewState = await prisma.workflows.findFirst({
      where: {
        scope: WorkflowScope.SESSIONS,
      },
    });
  }

  const sessionTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
  });

  if (sessionNewState && sessionTemplate) {
    const sessions = [
      {
        name: "Exploratory Testing - Login Flow",
        mission:
          "Explore edge cases in the login flow that might not be covered by scripted tests",
        isCompleted: false,
      },
      {
        name: "Login Usability Testing Session",
        mission: "Test the login experience from a new user perspective",
        isCompleted: true,
      },
      {
        name: "Mobile Login Testing",
        mission:
          "Test login functionality on various mobile devices and browsers",
        isCompleted: false,
      },
    ];

    for (const sessionData of sessions) {
      await prisma.sessions.create({
        data: {
          name: sessionData.name,
          projectId: myProject.id,
          templateId: sessionTemplate.id,
          stateId: sessionNewState.id,
          createdById: johnDoe.id,
          assignedToId: johnDoe.id,
          isCompleted: sessionData.isCompleted,
          completedAt: sessionData.isCompleted ? new Date() : null,
          estimate: 3600, // 1 hour
          elapsed: sessionData.isCompleted ? 3300 : 0,
          mission: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: sessionData.mission }],
              },
            ],
          }),
          isDeleted: false,
        },
      });
    }
  }

  // Create a shared step group for login
  await prisma.sharedStepGroup.create({
    data: {
      name: "Standard Login Steps",
      projectId: myProject.id,
      createdById: johnDoe.id,
      isDeleted: false,
      items: {
        create: [
          {
            order: 1,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Open the application login page" },
                  ],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Login page loads successfully" },
                  ],
                },
              ],
            }),
          },
          {
            order: 2,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Enter username in the username field",
                    },
                  ],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Username is entered correctly" },
                  ],
                },
              ],
            }),
          },
          {
            order: 3,
            step: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Enter password in the password field",
                    },
                  ],
                },
              ],
            }),
            expectedResult: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Password is masked and entered" },
                  ],
                },
              ],
            }),
          },
        ],
      },
    },
  });

  // Create some milestones
  const milestoneType = await prisma.milestoneTypes.findFirst({
    where: { name: "Release" },
  });

  if (milestoneType) {
    await prisma.milestones.create({
      data: {
        name: "Login Feature Enhancement v2.0",
        projectId: myProject.id,
        milestoneTypesId: milestoneType.id,
        createdBy: johnDoe.id,
        isCompleted: false,
        isDeleted: false,
        note: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Major improvements to login functionality including MFA support",
                },
              ],
            },
          ],
        }),
      },
    });
  }

  // Create an issue
  const defaultIntegration = await prisma.integration.findFirst({
    where: {
      provider: "SIMPLE_URL",
      isDeleted: false,
    },
  });

  if (defaultIntegration) {
    // Get a project for the issue
    const issueProject = await prisma.projects.findFirst({
      where: {
        isDeleted: false,
        assignedUsers: {
          some: { userId: johnDoe.id },
        },
      },
    });

    if (issueProject) {
      await prisma.issue.create({
        data: {
          name: "Login button not responsive on mobile",
          title: "Login button not responsive on mobile",
          integrationId: defaultIntegration.id,
          projectId: issueProject.id,
          createdById: johnDoe.id,
          externalId: "BUG-1234",
          data: JSON.stringify({
            url: "https://jira.example.com/browse/BUG-1234",
          }),
          isDeleted: false,
          note: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "The login button does not respond to taps on iOS Safari",
                  },
                ],
              },
            ],
          }),
        },
      });
    }
  }

  console.log("Advanced search test data seeding complete");
}

// --- Access Control E2E Test Data ---
async function seedAccessControlE2EData() {
  console.log("Seeding access control E2E test data...");

  // Step 1: Create distinct roles with non-overlapping permissions
  const roles = {
    projectAdmin: await prisma.roles.upsert({
      where: { name: "Project Admin" },
      update: {},
      create: { name: "Project Admin", isDefault: false },
    }),
    manager: await prisma.roles.upsert({
      where: { name: "Manager" },
      update: {},
      create: { name: "Manager", isDefault: false },
    }),
    tester: await prisma.roles.upsert({
      where: { name: "Tester" },
      update: {},
      create: { name: "Tester", isDefault: false },
    }),
    viewer: await prisma.roles.upsert({
      where: { name: "Viewer" },
      update: {},
      create: { name: "Viewer", isDefault: false },
    }),
    contributor: await prisma.roles.upsert({
      where: { name: "Contributor" },
      update: {},
      create: { name: "Contributor", isDefault: false },
    }),
    documentation: await prisma.roles.upsert({
      where: { name: "Documentation" },
      update: {},
      create: { name: "Documentation", isDefault: false },
    }),
  };

  // Define role permissions with clear distinctions
  const rolePermissions: Record<
    string,
    Partial<
      Record<
        ApplicationArea,
        { canAddEdit: boolean; canDelete: boolean; canClose: boolean }
      >
    >
  > = {
    projectAdmin: {
      // Full permissions for everything
      [ApplicationArea.Documentation]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.Milestones]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestCaseRepository]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestCaseRestrictedFields]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestRuns]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.ClosedTestRuns]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestRunResults]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestRunResultRestrictedFields]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.Sessions]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.SessionsRestrictedFields]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.ClosedSessions]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.SessionResults]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.Tags]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.SharedSteps]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
    },
    manager: {
      // Can manage test runs, sessions, milestones but NOT edit repository
      [ApplicationArea.Documentation]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.Milestones]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestCaseRepository]: {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      }, // NO repository edit
      [ApplicationArea.TestRuns]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.TestRunResults]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.Sessions]: {
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      },
      [ApplicationArea.SessionResults]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.Tags]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
    },
    tester: {
      // Can create/edit test cases and results but NOT sessions
      [ApplicationArea.TestCaseRepository]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.TestRuns]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.TestRunResults]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.Sessions]: {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      }, // NO sessions
      [ApplicationArea.SessionResults]: {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.Tags]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.SharedSteps]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
    },
    viewer: {
      // Read-only access to everything
      // All areas default to false
    },
    contributor: {
      // Can only add test results, no case creation
      [ApplicationArea.TestCaseRepository]: {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      }, // NO case creation
      [ApplicationArea.TestRunResults]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      [ApplicationArea.SessionResults]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
    },
    documentation: {
      // Can only edit project docs, no test access
      [ApplicationArea.Documentation]: {
        canAddEdit: true,
        canDelete: false,
        canClose: false,
      },
      // Everything else defaults to false
    },
  };

  // Create role permissions
  for (const [roleName, role] of Object.entries(roles)) {
    const permissions =
      rolePermissions[roleName as keyof typeof rolePermissions] || {};
    for (const area of Object.values(ApplicationArea)) {
      const permission = permissions[area] || {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      };
      await prisma.rolePermission.upsert({
        where: { roleId_area: { roleId: role.id, area } },
        update: permission,
        create: { roleId: role.id, area, ...permission },
      });
    }
  }

  // Step 2: Create test users with distinct system access levels
  const hashedPassword = await bcrypt.hash("Test123!", 10);

  const users = {
    admin: await prisma.user.upsert({
      where: { email: "ac_admin@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_admin@test.com",
        name: "AC Admin",
        password: hashedPassword,
        access: "ADMIN",
        roleId: roles.projectAdmin.id,
        emailVerified: new Date(),
        isActive: true,
        userPreferences: {
          create: {
            itemsPerPage: "P10",
            dateFormat: "MM_DD_YYYY_DASH",
            timeFormat: "HH_MM_A",
            theme: "Light",
            locale: "en_US",
            hasCompletedWelcomeTour: true,
            hasCompletedInitialPreferencesSetup: true,
          },
        },
      },
    }),
    projectAdmin: await prisma.user.upsert({
      where: { email: "ac_projectadmin@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_projectadmin@test.com",
        name: "AC Project Admin",
        password: hashedPassword,
        access: "PROJECTADMIN",
        roleId: roles.projectAdmin.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    userManager: await prisma.user.upsert({
      where: { email: "ac_user_manager@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_user_manager@test.com",
        name: "AC User Manager",
        password: hashedPassword,
        access: "USER",
        roleId: roles.manager.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    userTester: await prisma.user.upsert({
      where: { email: "ac_user_tester@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_user_tester@test.com",
        name: "AC User Tester",
        password: hashedPassword,
        access: "USER",
        roleId: roles.tester.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    none: await prisma.user.upsert({
      where: { email: "ac_none@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_none@test.com",
        name: "AC None",
        password: hashedPassword,
        access: "NONE",
        roleId: roles.viewer.id, // Has a role but NONE access
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    explicitDenied: await prisma.user.upsert({
      where: { email: "ac_explicit_denied@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_explicit_denied@test.com",
        name: "AC Explicit Denied",
        password: hashedPassword,
        access: "USER",
        roleId: roles.viewer.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    revokedAccess: await prisma.user.upsert({
      where: { email: "ac_revoked_access@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_revoked_access@test.com",
        name: "AC Revoked Access",
        password: hashedPassword,
        access: "NONE",
        roleId: roles.viewer.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    groupOnly: await prisma.user.upsert({
      where: { email: "ac_group_only@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_group_only@test.com",
        name: "AC Group Only",
        password: hashedPassword,
        access: "USER",
        roleId: roles.viewer.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    mixedOverride: await prisma.user.upsert({
      where: { email: "ac_mixed_override@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_mixed_override@test.com",
        name: "AC Mixed Override",
        password: hashedPassword,
        access: "USER",
        roleId: roles.contributor.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    creator: await prisma.user.upsert({
      where: { email: "ac_creator@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_creator@test.com",
        name: "AC Creator",
        password: hashedPassword,
        access: "USER",
        roleId: roles.viewer.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
    unassigned: await prisma.user.upsert({
      where: { email: "ac_unassigned@test.com" },
      update: {
        password: hashedPassword,
      },
      create: {
        email: "ac_unassigned@test.com",
        name: "AC Unassigned",
        password: hashedPassword,
        access: "USER",
        roleId: roles.manager.id,
        emailVerified: new Date(),
        isActive: true,
      },
    }),
  };

  // Step 3: Create test groups
  const groups = {
    projectAdmins: await prisma.groups.upsert({
      where: { name: "AC_Group_ProjectAdmins" },
      update: {},
      create: { name: "AC_Group_ProjectAdmins" },
    }),
    contributors: await prisma.groups.upsert({
      where: { name: "AC_Group_Contributors" },
      update: {},
      create: { name: "AC_Group_Contributors" },
    }),
    documentation: await prisma.groups.upsert({
      where: { name: "AC_Group_Documentation" },
      update: {},
      create: { name: "AC_Group_Documentation" },
    }),
  };

  // Assign users to groups
  await prisma.groupAssignment.upsert({
    where: {
      userId_groupId: {
        userId: users.groupOnly.id,
        groupId: groups.projectAdmins.id,
      },
    },
    update: {},
    create: { userId: users.groupOnly.id, groupId: groups.projectAdmins.id },
  });

  await prisma.groupAssignment.upsert({
    where: {
      userId_groupId: {
        userId: users.revokedAccess.id,
        groupId: groups.projectAdmins.id,
      },
    },
    update: {},
    create: {
      userId: users.revokedAccess.id,
      groupId: groups.projectAdmins.id,
    },
  });

  await prisma.groupAssignment.upsert({
    where: {
      userId_groupId: {
        userId: users.mixedOverride.id,
        groupId: groups.contributors.id,
      },
    },
    update: {},
    create: { userId: users.mixedOverride.id, groupId: groups.contributors.id },
  });

  await prisma.groupAssignment.upsert({
    where: {
      userId_groupId: {
        userId: users.userManager.id,
        groupId: groups.documentation.id,
      },
    },
    update: {},
    create: { userId: users.userManager.id, groupId: groups.documentation.id },
  });

  // Step 4: Create test projects with different default access types
  const projects = {
    noAccess: await prisma.projects.create({
      data: {
        name: "AC_NoAccess_Default",
        createdBy: users.admin.id,
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
    }),
    globalRole: await prisma.projects.create({
      data: {
        name: "AC_GlobalRole_Default",
        createdBy: users.admin.id,
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: null,
      },
    }),
    specificRole: await prisma.projects.create({
      data: {
        name: "AC_SpecificRole_Default",
        createdBy: users.admin.id,
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: roles.viewer.id, // Default to Viewer role
      },
    }),
    groupPriority: await prisma.projects.create({
      data: {
        name: "AC_GroupPriority_Test",
        createdBy: users.admin.id,
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
    }),
    overridePriority: await prisma.projects.create({
      data: {
        name: "AC_Override_Priority",
        createdBy: users.admin.id,
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: null,
      },
    }),
    creatorTest: await prisma.projects.create({
      data: {
        name: "AC_Creator_Test",
        createdBy: users.creator.id, // Created by ac_creator
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
    }),
  };

  // Step 5: Configure user and group permissions per project

  // Project 1: AC_NoAccess_Default
  await prisma.userProjectPermission.create({
    data: {
      userId: users.userManager.id,
      projectId: projects.noAccess.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.tester.id, // Different from their global Manager role
    },
  });

  await prisma.userProjectPermission.create({
    data: {
      userId: users.explicitDenied.id,
      projectId: projects.noAccess.id,
      accessType: "NO_ACCESS",
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.projectAdmins.id,
      projectId: projects.noAccess.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.projectAdmin.id,
    },
  });

  // Project 2: AC_GlobalRole_Default
  await prisma.projectAssignment.create({
    data: {
      userId: users.projectAdmin.id,
      projectId: projects.globalRole.id,
    },
  });

  await prisma.projectAssignment.create({
    data: {
      userId: users.none.id,
      projectId: projects.globalRole.id,
    },
  });

  // Don't assign users to GLOBAL_ROLE projects - they get access through their global role

  await prisma.userProjectPermission.create({
    data: {
      userId: users.explicitDenied.id,
      projectId: projects.globalRole.id,
      accessType: "NO_ACCESS",
    },
  });

  await prisma.userProjectPermission.create({
    data: {
      userId: users.none.id,
      projectId: projects.globalRole.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.manager.id, // Grants Manager despite NONE system access
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.contributors.id,
      projectId: projects.globalRole.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.contributor.id,
    },
  });

  // Create repositories and folders for test projects that need repository access
  const globalRoleRepo = await prisma.repositories.create({
    data: {
      projectId: projects.globalRole.id,
    },
  });

  await prisma.repositoryFolders.create({
    data: {
      name: "Test Folder",
      projectId: projects.globalRole.id,
      repositoryId: globalRoleRepo.id,
      creatorId: users.admin.id,
    },
  });

  const noAccessRepo = await prisma.repositories.create({
    data: {
      projectId: projects.noAccess.id,
    },
  });

  await prisma.repositoryFolders.create({
    data: {
      name: "Test Folder",
      projectId: projects.noAccess.id,
      repositoryId: noAccessRepo.id,
      creatorId: users.admin.id,
    },
  });

  const specificRoleRepo = await prisma.repositories.create({
    data: {
      projectId: projects.specificRole.id,
    },
  });

  await prisma.repositoryFolders.create({
    data: {
      name: "Test Folder",
      projectId: projects.specificRole.id,
      repositoryId: specificRoleRepo.id,
      creatorId: users.admin.id,
    },
  });

  // Project 3: AC_SpecificRole_Default
  await prisma.userProjectPermission.create({
    data: {
      userId: users.userTester.id,
      projectId: projects.specificRole.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.documentation.id, // Very different from default Viewer
    },
  });

  await prisma.userProjectPermission.create({
    data: {
      userId: users.mixedOverride.id,
      projectId: projects.specificRole.id,
      accessType: "GLOBAL_ROLE", // Uses their Contributor role
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.documentation.id,
      projectId: projects.specificRole.id,
      accessType: "NO_ACCESS", // Denies group access
    },
  });

  // Project 4: AC_GroupPriority_Test (only group permissions)
  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.projectAdmins.id,
      projectId: projects.groupPriority.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.projectAdmin.id,
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.contributors.id,
      projectId: projects.groupPriority.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.contributor.id,
    },
  });

  // Project 5: AC_Override_Priority
  await prisma.userProjectPermission.create({
    data: {
      userId: users.groupOnly.id,
      projectId: projects.overridePriority.id,
      accessType: "NO_ACCESS", // Explicit denial overrides group
    },
  });

  await prisma.userProjectPermission.create({
    data: {
      userId: users.mixedOverride.id,
      projectId: projects.overridePriority.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.manager.id,
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: groups.projectAdmins.id,
      projectId: projects.overridePriority.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.projectAdmin.id,
    },
  });

  // Project 6: AC_Creator_Test
  await prisma.userProjectPermission.create({
    data: {
      userId: users.userTester.id,
      projectId: projects.creatorTest.id,
      accessType: "SPECIFIC_ROLE",
      roleId: roles.contributor.id, // Different from their Tester role
    },
  });

  // Step 6: Add test data to projects
  for (const project of Object.values(projects)) {
    // Create repository
    const repository = await prisma.repositories.create({
      data: {
        projectId: project.id,
        isActive: true,
      },
    });

    // Create folders
    const rootFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Root",
        projectId: project.id,
        repositoryId: repository.id,
        creatorId: users.admin.id,
        order: 0,
      },
    });

    const testFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Test Cases",
        projectId: project.id,
        repositoryId: repository.id,
        parentId: rootFolder.id,
        creatorId: users.admin.id,
        order: 1,
      },
    });

    // Get default workflow and template
    const defaultWorkflow = await prisma.workflows.findFirst({
      where: { scope: "CASES", isDefault: true },
    });

    const defaultTemplate = await prisma.templates.findFirst({
      where: { isDefault: true },
    });

    if (!defaultWorkflow || !defaultTemplate) {
      console.error("Default workflow or template not found");
      continue;
    }

    // Create test cases
    for (let i = 1; i <= 5; i++) {
      await prisma.repositoryCases.create({
        data: {
          name: `${project.name} - Test Case ${i}`,
          projectId: project.id,
          repositoryId: repository.id,
          folderId: testFolder.id,
          templateId: defaultTemplate.id,
          stateId: defaultWorkflow.id,
          creatorId: users.admin.id,
          order: i,
          estimate: 300, // 5 minutes
        },
      });
    }

    // Create test runs
    const activeRun = await prisma.testRuns.create({
      data: {
        name: `${project.name} - Active Run`,
        projectId: project.id,
        stateId: defaultWorkflow.id,
        createdById: users.admin.id,
        isCompleted: false,
      },
    });

    const completedRun = await prisma.testRuns.create({
      data: {
        name: `${project.name} - Completed Run`,
        projectId: project.id,
        stateId: defaultWorkflow.id,
        createdById: users.admin.id,
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    // Create sessions
    const activeSession = await prisma.sessions.create({
      data: {
        name: `${project.name} - Active Session`,
        projectId: project.id,
        templateId: defaultTemplate.id,
        stateId: defaultWorkflow.id,
        createdById: users.admin.id,
        isCompleted: false,
      },
    });

    const completedSession = await prisma.sessions.create({
      data: {
        name: `${project.name} - Completed Session`,
        projectId: project.id,
        templateId: defaultTemplate.id,
        stateId: defaultWorkflow.id,
        createdById: users.admin.id,
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    // Create milestone
    const milestoneType = await prisma.milestoneTypes.findFirst({
      where: { isDefault: true },
    });

    if (milestoneType) {
      await prisma.milestones.create({
        data: {
          name: `${project.name} - Milestone 1`,
          projectId: project.id,
          milestoneTypesId: milestoneType.id,
          createdBy: users.admin.id,
        },
      });
    }
  }

  // Step 6: Assign workflows to all access control projects
  console.log("Assigning workflows to access control projects...");

  // Get all available workflows
  const caseWorkflows = await prisma.workflows.findMany({
    where: { scope: WorkflowScope.CASES },
  });
  const runWorkflows = await prisma.workflows.findMany({
    where: { scope: WorkflowScope.RUNS },
  });
  const sessionWorkflows = await prisma.workflows.findMany({
    where: { scope: WorkflowScope.SESSIONS },
  });

  // Assign workflows to each project
  for (const [key, project] of Object.entries(projects)) {
    // Assign all case workflows to the project
    for (const workflow of caseWorkflows) {
      await prisma.projectWorkflowAssignment.upsert({
        where: {
          workflowId_projectId: {
            workflowId: workflow.id,
            projectId: project.id,
          },
        },
        update: {},
        create: {
          projectId: project.id,
          workflowId: workflow.id,
        },
      });
    }

    // Assign all run workflows to the project
    for (const workflow of runWorkflows) {
      await prisma.projectWorkflowAssignment.upsert({
        where: {
          workflowId_projectId: {
            workflowId: workflow.id,
            projectId: project.id,
          },
        },
        update: {},
        create: {
          projectId: project.id,
          workflowId: workflow.id,
        },
      });
    }

    // Assign all session workflows to the project
    for (const workflow of sessionWorkflows) {
      await prisma.projectWorkflowAssignment.upsert({
        where: {
          workflowId_projectId: {
            workflowId: workflow.id,
            projectId: project.id,
          },
        },
        update: {},
        create: {
          projectId: project.id,
          workflowId: workflow.id,
        },
      });
    }
  }
  console.log(
    `Assigned workflows to ${Object.keys(projects).length} access control projects`
  );

  // Step 6.5: Assign templates to all access control projects
  console.log("Assigning templates to access control projects...");

  // Get all available templates
  const templates = await prisma.templates.findMany();

  // Assign all templates to each project
  for (const [key, project] of Object.entries(projects)) {
    for (const template of templates) {
      await prisma.templateProjectAssignment.upsert({
        where: {
          templateId_projectId: {
            templateId: template.id,
            projectId: project.id,
          },
        },
        update: {},
        create: {
          templateId: template.id,
          projectId: project.id,
        },
      });
    }
  }
  console.log(
    `Assigned ${templates.length} templates to ${Object.keys(projects).length} access control projects`
  );

  // Step 7: Create repository case versions for existing test cases
  console.log(
    "Creating repository case versions for access control projects..."
  );

  // Get default workflow for reference
  const defaultCaseWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.CASES, isDefault: true },
  });

  // Create repository case versions for each project's test cases
  for (const [key, project] of Object.entries(projects)) {
    // Get the repository and test cases created in Step 6
    const repository = await prisma.repositories.findFirst({
      where: { projectId: project.id },
    });

    if (!repository) continue;

    const testCases = await prisma.repositoryCases.findMany({
      where: {
        projectId: project.id,
        repositoryId: repository.id,
      },
      include: {
        folder: true,
        template: true,
        state: true,
      },
    });

    // Create versions for the first 3 test cases if they don't have versions yet
    for (let i = 0; i < Math.min(3, testCases.length); i++) {
      const testCase = testCases[i];

      // Check if version already exists
      const existingVersion = await prisma.repositoryCaseVersions.findFirst({
        where: {
          repositoryCaseId: testCase.id,
          version: 1,
        },
      });

      if (!existingVersion) {
        await prisma.repositoryCaseVersions.create({
          data: {
            repositoryCaseId: testCase.id,
            version: 1,
            projectId: project.id,
            staticProjectId: project.id,
            staticProjectName: project.name,
            repositoryId: repository.id,
            folderId: testCase.folderId,
            folderName: testCase.folder?.name || "Root",
            templateId: testCase.templateId,
            templateName: testCase.template?.templateName || "Default",
            name: testCase.name,
            stateId: testCase.stateId,
            stateName: testCase.state?.name || "Draft",
            creatorId: users.admin.id,
            creatorName: users.admin.name || users.admin.email,
          },
        });
      }
    }
  }

  // Create test runs, sessions, and milestones for access control projects
  console.log("Creating test data for access control projects...");

  // Get default template and workflows
  const defaultTemplate = await prisma.templates.findFirst({
    where: { templateName: "Default" },
  });

  const sessionWorkflow = await prisma.workflows.findFirst({
    where: {
      scope: WorkflowScope.SESSIONS,
      isDefault: true,
    },
  });

  const testRunWorkflow = await prisma.workflows.findFirst({
    where: {
      scope: WorkflowScope.RUNS,
      isDefault: true,
    },
  });

  // Create or get milestone type
  let milestoneType = await prisma.milestoneTypes.findFirst({
    where: { name: "Release" },
  });

  if (!milestoneType) {
    // Get or create icon for milestone type
    let icon = await prisma.fieldIcon.findFirst({
      where: { name: "rocket" },
    });

    if (!icon) {
      icon = await prisma.fieldIcon.create({
        data: { name: "rocket" },
      });
    }

    milestoneType = await prisma.milestoneTypes.create({
      data: {
        name: "Release",
        iconId: icon.id,
      },
    });
  }

  // Create test runs for each access control project
  for (const [key, project] of Object.entries(projects)) {
    // Create a milestone
    await prisma.milestones.create({
      data: {
        name: `${project.name} - Milestone 1`,
        projectId: project.id,
        milestoneTypesId: milestoneType.id,
        createdBy: users.admin.id,
        startedAt: new Date(),
        isCompleted: false,
        isDeleted: false,
      },
    });

    // Create a session
    if (defaultTemplate && sessionWorkflow) {
      await prisma.sessions.create({
        data: {
          name: `${project.name} - Test Session`,
          projectId: project.id,
          templateId: defaultTemplate.id,
          stateId: sessionWorkflow.id,
          createdById: users.admin.id,
          isCompleted: false,
          isDeleted: false,
        },
      });
    }

    // Create a test run for each project
    if (testRunWorkflow) {
      const testRun = await prisma.testRuns.create({
        data: {
          name: `${project.name} - Active Run`,
          projectId: project.id,
          stateId: testRunWorkflow.id,
          createdById: users.admin.id,
          isCompleted: false,
          isDeleted: false,
        },
      });

      // Get test cases for this project
      const repository = await prisma.repositories.findFirst({
        where: { projectId: project.id },
      });

      if (repository) {
        const testCases = await prisma.repositoryCases.findMany({
          where: {
            projectId: project.id,
            repositoryId: repository.id,
          },
          take: 3, // Add first 3 test cases to the run
        });

        // Add test cases to the run
        for (const testCase of testCases) {
          await prisma.testRunCases.create({
            data: {
              testRunId: testRun.id,
              repositoryCaseId: testCase.id,
            },
          });
        }
      }

      // Create a completed test run as well
      await prisma.testRuns.create({
        data: {
          name: `${project.name} - Completed Run`,
          projectId: project.id,
          stateId: testRunWorkflow.id,
          createdById: users.admin.id,
          isCompleted: true,
          isDeleted: false,
          completedAt: new Date(),
        },
      });
    }
  }

  console.log("Access control E2E test data seeding complete");
}

// --- Main Execution ---
async function main() {
  try {
    await seedCoreData();

    // Always create magic link SSO provider for production environments
    if (process.env.NODE_ENV === "production") {
      console.log("Seeding production SSO provider...");
      // Create Magic Link provider (enabled by default for production)
      const magicLinkProvider = await prisma.ssoProvider.upsert({
        where: {
          id: "magic-link-provider",
        },
        update: {
          name: "Magic Link",
          type: "MAGIC_LINK",
          enabled: true,
          forceSso: true, // Force SSO-only authentication (magic link only)
          config: {},
        },
        create: {
          id: "magic-link-provider",
          name: "Magic Link",
          type: "MAGIC_LINK",
          enabled: true,
          forceSso: true, // Force SSO-only authentication (magic link only)
          config: {},
        },
      });
      console.log(
        `✓ Created Magic Link provider with forceSso=true (magic link only authentication)`
      );
    }

    // NODE_ENV is set to "test" by the e2e test script
    if (process.env.NODE_ENV === "test") {
      await seedTestData();
      await seedBulkEditTestData();
      await seedDateRangeTestData();
      await seedNotificationTestData();
      await seedSsoProviderTestData();
      await seedDomainRestrictionTestData();
      await seedAdvancedSearchData();
      await seedAccessControlE2EData();
      // Assign workflows to all projects including the newly created access control test projects
      await assignWorkflowsToAllProjects();
    } else {
      // For production environments, still assign workflows to any existing projects
      await assignWorkflowsToAllProjects();
    }
  } catch (error) {
    console.error("Error in main execution:", error);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedJUnitTestData() {
  console.log("Seeding JUnit test data for permission testing...");

  const adminUser = await prisma.user.findUnique({
    where: { email: "admin@testplanit.com" },
  });

  const regularUser = await prisma.user.findUnique({
    where: { email: "testuser@example.com" },
  });

  if (!adminUser || !regularUser) {
    console.log("Required users not found for JUnit seeding");
    return;
  }

  // Get project 331
  const project = await prisma.projects.findUnique({
    where: { id: 331 },
    include: {
      repositories: true,
    },
  });

  if (!project || !project.repositories[0]) {
    console.log("Project 331 or its repository not found");
    return;
  }

  // Get a test run to add JUnit data to
  const testRun = await prisma.testRuns.findFirst({
    where: {
      projectId: 331,
      isDeleted: false,
    },
  });

  if (!testRun) {
    console.log("No test run found for JUnit data");
    return;
  }

  // Create JUnit test suite (created by admin)
  const testSuite = await prisma.jUnitTestSuite.create({
    data: {
      name: "E2E Permission Test Suite",
      testRunId: testRun.id,
      createdById: adminUser.id,
      time: 45.5,
      tests: 10,
      failures: 2,
      errors: 1,
      skipped: 1,
      timestamp: new Date("2025-06-01T10:00:00Z"),
      file: "e2e/permissions.test.js",
      systemOut: "Test suite output logs",
      systemErr: "Some warning messages",
    },
  });

  console.log(`Created JUnit test suite: ${testSuite.name}`);

  // Get some repository cases to link JUnit results to
  const repoCases = await prisma.repositoryCases.findMany({
    where: {
      projectId: 331,
      isDeleted: false,
    },
    take: 5,
  });

  if (repoCases.length === 0) {
    console.log("No repository cases found for JUnit results");
    return;
  }

  // Get status IDs
  const passedStatus = await prisma.status.findFirst({
    where: { name: "Passed" },
  });

  const failedStatus = await prisma.status.findFirst({
    where: { name: "Failed" },
  });

  // Create JUnit test results (mix of creators)
  for (let i = 0; i < Math.min(repoCases.length, 4); i++) {
    const creator = i % 2 === 0 ? adminUser : regularUser;
    const status = i < 2 ? passedStatus : failedStatus;

    const testResult = await prisma.jUnitTestResult.create({
      data: {
        type: i < 2 ? "PASSED" : i === 2 ? "FAILURE" : "ERROR",
        message:
          i >= 2 ? `Test failed: Assertion error at line ${i * 10}` : null,
        content: i >= 2 ? `Expected: true, Actual: false` : null,
        repositoryCaseId: repoCases[i]!.id,
        testSuiteId: testSuite.id,
        createdById: creator.id,
        statusId: status?.id,
        time: 2.5 + i,
        executedAt: new Date(`2025-06-01T10:0${i}:00Z`),
        file: `tests/test${i + 1}.js`,
        line: i >= 2 ? i * 10 : null,
        systemOut: `Test ${i + 1} output`,
        assertions: 5 + i,
      },
    });

    // Create JUnit properties for some results
    if (i < 2) {
      await prisma.jUnitProperty.create({
        data: {
          name: `property${i + 1}`,
          value: `value${i + 1}`,
          testSuiteId: testSuite.id,
          createdById: creator.id,
        },
      });

      // Add property linked to repository case
      await prisma.jUnitProperty.create({
        data: {
          name: `case-property${i + 1}`,
          value: `case-value${i + 1}`,
          repositoryCaseId: repoCases[i]!.id,
          createdById: creator.id,
        },
      });
    }

    // Create JUnit attachments for some cases
    if (i === 0 || i === 2) {
      await prisma.jUnitAttachment.create({
        data: {
          name: `screenshot${i + 1}.png`,
          value: `base64-encoded-image-data-${i + 1}`,
          type: "FILE",
          repositoryCaseId: repoCases[i]!.id,
          createdById: creator.id,
        },
      });
    }

    // Create JUnit test steps for some cases
    if (i < 3) {
      const stepStatus = i === 0 ? passedStatus : failedStatus;
      await prisma.jUnitTestStep.create({
        data: {
          name: `Step ${i + 1}: ${i === 0 ? "Setup" : i === 1 ? "Execute" : "Verify"}`,
          content: `Step ${i + 1} detailed content and expectations`,
          statusId: stepStatus?.id,
          repositoryCaseId: repoCases[i]!.id,
          createdById: creator.id,
        },
      });
    }
  }

  // Create a nested test suite (child suite)
  const childSuite = await prisma.jUnitTestSuite.create({
    data: {
      name: "Integration Tests",
      parentId: testSuite.id,
      testRunId: testRun.id,
      createdById: regularUser.id,
      time: 15.3,
      tests: 3,
      failures: 0,
      errors: 0,
      skipped: 0,
      timestamp: new Date("2025-06-01T10:30:00Z"),
      file: "integration/api.test.js",
    },
  });

  console.log(`Created child JUnit test suite: ${childSuite.name}`);

  // Add a result to the child suite
  if (repoCases[4]) {
    await prisma.jUnitTestResult.create({
      data: {
        type: "PASSED",
        repositoryCaseId: repoCases[4].id,
        testSuiteId: childSuite.id,
        createdById: regularUser.id,
        statusId: passedStatus?.id,
        time: 3.2,
        executedAt: new Date("2025-06-01T10:31:00Z"),
        file: "integration/api.test.js",
        assertions: 8,
      },
    });
  }

  console.log("JUnit test data seeding complete");
  console.log("- Created test suites with parent-child relationship");
  console.log(
    "- Created test results with mixed creators (admin and regular user)"
  );
  console.log("- Created JUnit properties, attachments, and test steps");
  console.log(
    "This data will be used to test permission inheritance for JUnit models"
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
