/**
 * E2E Test Database Setup Script
 *
 * This script:
 * 1. Resets the test database (drops all data)
 * 2. Runs Prisma migrations
 * 3. Seeds the database with core data
 * 4. Creates a test project with repository for E2E tests
 * 5. Ensures admin user has hasCompletedWelcomeTour = true (prevents onboarding overlay)
 *
 * Run with: pnpm test:e2e:setup-db
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// E2E Test user credentials
const E2E_ADMIN_EMAIL = "admin@example.com";
const E2E_ADMIN_PASSWORD = "admin";

// E2E Test projects - add more as needed
const E2E_PROJECTS = [
  "E2E Test Project",
  "E2E Test Project 2",
];

async function resetDatabase() {
  console.log("🗑️  Resetting database...");

  // Get all table names except _prisma_migrations, ordered by foreign key dependencies
  // We'll use TRUNCATE with CASCADE which handles FK constraints
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != '_prisma_migrations'
    ORDER BY tablename
  `;

  // Truncate all tables with CASCADE (handles foreign keys)
  // Do this in a single statement to avoid constraint issues
  const tableNames = tables.map((t) => `"public"."${t.tablename}"`).join(", ");

  if (tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
      console.log(`   Truncated ${tables.length} tables`);
    } catch (error: any) {
      // If truncate fails, try deleting from each table individually
      console.log("   TRUNCATE failed, trying DELETE approach...");
      for (const { tablename } of tables.reverse()) {
        try {
          await prisma.$executeRawUnsafe(
            `DELETE FROM "public"."${tablename}";`
          );
        } catch {
          // Ignore errors for individual tables (FK constraints)
        }
      }
      console.log(`   Deleted data from tables`);
    }
  }
}

async function seedCoreData() {
  console.log("🌱 Seeding core data...");

  // Import and run the main seed function
  // We need to run it inline since it's designed to be run as a script
  const { execSync } = await import("child_process");

  try {
    execSync("pnpm prisma db seed", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    console.error("   Failed to run prisma db seed, continuing...");
  }
}

async function ensureAdminUser() {
  console.log("👤 Ensuring admin user exists with correct settings...");

  const adminRole = await prisma.roles.findFirst({
    where: { name: "admin" },
  });

  if (!adminRole) {
    throw new Error("Admin role not found. Run seed first.");
  }

  const hashedPassword = bcrypt.hashSync(E2E_ADMIN_PASSWORD, 10);

  // Upsert admin user
  const admin = await prisma.user.upsert({
    where: { email: E2E_ADMIN_EMAIL },
    update: {
      password: hashedPassword,
      roleId: adminRole.id,
      emailVerified: new Date(),
      access: "ADMIN",
    },
    create: {
      email: E2E_ADMIN_EMAIL,
      name: "E2E Test Admin",
      password: hashedPassword,
      isApi: true,
      roleId: adminRole.id,
      emailVerified: new Date(),
      access: "ADMIN",
    },
  });

  // Ensure user preferences exist with hasCompletedWelcomeTour = true
  await prisma.userPreferences.upsert({
    where: { userId: admin.id },
    update: {
      hasCompletedWelcomeTour: true,
      hasCompletedInitialPreferencesSetup: true,
    },
    create: {
      userId: admin.id,
      itemsPerPage: "P10",
      dateFormat: "MM_DD_YYYY_DASH",
      timeFormat: "HH_MM_A",
      theme: "Light",
      locale: "en_US",
      hasCompletedWelcomeTour: true,
      hasCompletedInitialPreferencesSetup: true,
    },
  });

  console.log(`   Admin user: ${E2E_ADMIN_EMAIL} / ${E2E_ADMIN_PASSWORD}`);
  console.log(`   hasCompletedWelcomeTour: true`);

  return admin;
}

async function createTestProject(adminId: string, projectName: string) {
  console.log(`📁 Creating E2E test project: ${projectName}...`);

  // Get default template
  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true, isDeleted: false },
  });

  if (!defaultTemplate) {
    throw new Error("Default template not found. Run seed first.");
  }

  // Get default workflow for cases
  const defaultWorkflow = await prisma.workflows.findFirst({
    where: { isDefault: true, scope: "CASES", isDeleted: false },
  });

  if (!defaultWorkflow) {
    throw new Error("Default workflow not found. Run seed first.");
  }

  // Create test project
  const project = await prisma.projects.upsert({
    where: { name: projectName },
    update: {
      isDeleted: false,
    },
    create: {
      name: projectName,
      createdBy: adminId,
    },
  });

  console.log(`   Project: ${project.name} (ID: ${project.id})`);

  // Create or get repository for the project
  let repository = await prisma.repositories.findFirst({
    where: { projectId: project.id },
  });

  if (!repository) {
    repository = await prisma.repositories.create({
      data: {
        projectId: project.id,
      },
    });
  }

  console.log(`   Repository ID: ${repository.id}`);

  // Create a root folder if it doesn't exist
  let rootFolder = await prisma.repositoryFolders.findFirst({
    where: {
      projectId: project.id,
      parentId: null,
      isDeleted: false,
    },
  });

  if (!rootFolder) {
    rootFolder = await prisma.repositoryFolders.create({
      data: {
        name: "Root Folder",
        order: 0,
        project: { connect: { id: project.id } },
        repository: { connect: { id: repository.id } },
        creator: { connect: { id: adminId } },
        docs: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph" }],
        }),
      },
    });
  }

  console.log(`   Root Folder: ${rootFolder.name} (ID: ${rootFolder.id})`);

  // Assign template to project
  await prisma.templateProjectAssignment.upsert({
    where: {
      templateId_projectId: {
        templateId: defaultTemplate.id,
        projectId: project.id,
      },
    },
    update: {},
    create: {
      templateId: defaultTemplate.id,
      projectId: project.id,
    },
  });

  console.log(`   Template assigned: ${defaultTemplate.templateName}`);

  // Assign all workflows to project
  const workflows = await prisma.workflows.findMany({
    where: { isDeleted: false, isEnabled: true },
  });

  for (const workflow of workflows) {
    await prisma.projectWorkflowAssignment.upsert({
      where: {
        workflowId_projectId: {
          workflowId: workflow.id,
          projectId: project.id,
        },
      },
      update: {},
      create: {
        workflowId: workflow.id,
        projectId: project.id,
      },
    });
  }

  console.log(`   Workflows assigned: ${workflows.length}`);

  // Add admin as project member
  await prisma.projectAssignment.upsert({
    where: {
      userId_projectId: {
        userId: adminId,
        projectId: project.id,
      },
    },
    update: {},
    create: {
      userId: adminId,
      projectId: project.id,
    },
  });

  console.log(`   Admin added to project`);

  return project;
}

async function createTestProjects(adminId: string) {
  console.log(`\n📁 Creating ${E2E_PROJECTS.length} E2E test projects...\n`);

  const projects = [];
  for (const projectName of E2E_PROJECTS) {
    const project = await createTestProject(adminId, projectName);
    projects.push(project);
    console.log(""); // Empty line between projects
  }

  return projects;
}

async function clearAuthSession() {
  console.log("🔑 Clearing stale auth session...");
  const fs = await import("fs");
  const path = await import("path");
  const authFile = path.join(__dirname, ".auth", "admin.json");

  if (fs.existsSync(authFile)) {
    fs.unlinkSync(authFile);
    console.log("   Deleted old auth session");
  } else {
    console.log("   No existing auth session found");
  }
}

async function main() {
  console.log("\n🚀 E2E Test Database Setup\n");
  console.log("=" + "=".repeat(50) + "\n");

  try {
    // Step 1: Reset database
    await resetDatabase();

    // Step 2: Seed core data (this runs prisma db seed)
    await seedCoreData();

    // Step 3: Ensure admin user with correct settings
    const admin = await ensureAdminUser();

    // Step 4: Create test projects
    await createTestProjects(admin.id);

    // Step 5: Clear stale auth session (so global-setup will regenerate)
    await clearAuthSession();

    console.log("\n" + "=" + "=".repeat(50));
    console.log("✅ E2E database setup complete!\n");
    console.log("You can now run: pnpm test:e2e\n");
  } catch (error) {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
