import { ApplicationArea, PrismaClient, WorkflowScope } from "@prisma/client";
import bcrypt from "bcrypt";
import { seedDemoProject } from "./seedDemoProject";
import { seedFieldIcons } from "./seedFieldIcons";
import { seedDefaultPromptConfig } from "./seedPromptConfig";
import { seedTestData } from "./seedTestData";

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
  const userRole = await prisma.roles.upsert({
    where: { name: "user" },
    update: { isDefault: true },
    create: {
      name: "user",
      isDefault: true,
    },
  });
  const adminRole = await prisma.roles.upsert({
    where: { name: "admin" },
    update: { isDefault: false },
    create: {
      name: "admin",
      isDefault: false,
    },
  });

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

  // --- Notification Settings ---
  await prisma.appConfig.upsert({
    where: { key: "notificationSettings" },
    update: {},
    create: {
      key: "notificationSettings",
      value: {
        defaultMode: "IN_APP_EMAIL_DAILY",
      },
    },
  });
  console.log("Seeded notification settings config.");

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
          theme: "Purple",
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
        specificOptions: [
          { key: "defaultValue", displayName: "Default Value" },
        ],
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
      name: "Done",
      icon: "package-check",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "SESSIONS",
      workflowType: "DONE",
    },
    {
      order: 5,
      name: "Rejected",
      icon: "package-x",
      color: "Red",
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
      name: "Done",
      icon: "package-check",
      color: "Green",
      isEnabled: true,
      isDefault: false,
      scope: "RUNS",
      workflowType: "DONE",
    },
    {
      order: 5,
      name: "Rejected",
      icon: "package-x",
      color: "Red",
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
      workflowType: "IN_PROGRESS",
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
            workflowType: workflow.workflowType as
              | "NOT_STARTED"
              | "IN_PROGRESS"
              | "DONE",
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

// --- Seed Case Export Templates ---
async function seedCaseExportTemplates() {
  console.log("Seeding case export templates...");

  const playwrightHeader = `import { test, expect } from "@playwright/test";`;

  const playwrightBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
test.describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  test("Step {{order}} - {{step}}", async ({ page }) => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const cypressHeader = `/// <reference types="cypress" />`;

  const cypressBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const webdriverioBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const webdriverioTsHeader = `import { browser, $ } from "@wdio/globals";`;

  const webdriverioTsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const markdownBody = `# {{{name}}}

| Field | Value |
|-------|-------|
| **ID** | {{{id}}} |
| **State** | {{{state}}} |
| **Folder** | {{{folder}}} |
| **Estimate** | {{{estimate}}} |
| **Automated** | {{{automated}}} |
| **Tags** | {{{tags}}} |
| **Created by** | {{{createdBy}}} |
| **Created at** | {{{createdAt}}} |

## Steps

{{#steps}}
### Step {{{order}}}

**Action:** {{{step}}}

**Expected Result:** {{{expectedResult}}}

{{/steps}}
`;

  const playwrightPythonBody = `"""
Test Case: {{{name}}}
ID: {{{id}}}
State: {{{state}}}
Tags: {{{tags}}}
Created by: {{{createdBy}}}
"""
import pytest
from playwright.sync_api import Page, expect


class Test{{{id}}}:
    """{{{name}}}"""

{{#steps}}
    def test_step_{{{order}}}(self, page: Page):
        """Step {{{order}}}: {{{step}}}"""
        # Expected: {{{expectedResult}}}
        # TODO: Implement test logic
        pass

{{/steps}}
`;

  const playwrightJavaHeader = `import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;`;

  const playwrightJavaBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {
    static Playwright playwright;
    static Browser browser;
    BrowserContext context;
    Page page;

    @BeforeAll
    static void launchBrowser() {
        playwright = Playwright.create();
        browser = playwright.chromium().launch();
    }

    @BeforeEach
    void createContextAndPage() {
        context = browser.newContext();
        page = context.newPage();
    }

    @AfterEach
    void closeContext() {
        context.close();
    }

    @AfterAll
    static void closeBrowser() {
        playwright.close();
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  const playwrightCsharpHeader = `using Microsoft.Playwright;
using NUnit.Framework;`;

  const playwrightCsharpBody = `/// <summary>
/// Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
/// </summary>
[TestFixture]
public class Test{{{id}}}
{
    private IPlaywright _playwright;
    private IBrowser _browser;
    private IPage _page;

    [OneTimeSetUp]
    public async Task Setup()
    {
        _playwright = await Playwright.CreateAsync();
        _browser = await _playwright.Chromium.LaunchAsync();
        _page = await _browser.NewPageAsync();
    }

    [OneTimeTearDown]
    public async Task Teardown()
    {
        await _browser.CloseAsync();
        _playwright.Dispose();
    }

{{#steps}}
    [Test]
    public async Task Step{{{order}}}_{{{order}}}()
    {
        // Step {{{order}}}: {{{step}}}
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  const cypressTsHeader = `/// <reference types="cypress" />`;

  const cypressTsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const seleniumJavaHeader = `import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.junit.jupiter.api.*;`;

  const seleniumJavaBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {
    private WebDriver driver;

    @BeforeEach
    void setUp() {
        driver = new ChromeDriver();
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  const seleniumPythonBody = `"""
Test Case: {{{name}}}
ID: {{{id}}}
State: {{{state}}}
Tags: {{{tags}}}
Created by: {{{createdBy}}}
"""
import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By


class Test{{{id}}}:
    """{{{name}}}"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.driver = webdriver.Chrome()
        yield
        self.driver.quit()

{{#steps}}
    def test_step_{{{order}}}(self):
        """Step {{{order}}}: {{{step}}}"""
        # Expected: {{{expectedResult}}}
        # TODO: Implement test logic
        pass

{{/steps}}
`;

  const jestTsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const pytestBody = `"""
Test Case: {{{name}}}
ID: {{{id}}}
State: {{{state}}}
Tags: {{{tags}}}
Created by: {{{createdBy}}}
"""
import pytest


class Test{{{id}}}:
    """{{{name}}}"""

{{#steps}}
    def test_step_{{{order}}}(self):
        """Step {{{order}}}: {{{step}}}"""
        # Expected: {{{expectedResult}}}
        # TODO: Implement test logic
        pass

{{/steps}}
`;

  const junitHeader = `import org.junit.jupiter.api.*;`;

  const junitBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  const gherkinBody = `Feature: {{{name}}}
  As a tester
  I want to verify {{{name}}}
  So that the expected behavior is confirmed

  # ID: {{{id}}}
  # State: {{{state}}}
  # Tags: {{{tags}}}
  # Created by: {{{createdBy}}}

  Scenario: {{{name}}}
{{#steps}}
    # Step {{{order}}}
    Given the preconditions for step {{{order}}} are met
    When I {{{step}}}
    Then {{{expectedResult}}}
{{/steps}}
`;

  const restAssuredHeader = `import io.restassured.RestAssured;
import org.junit.jupiter.api.*;
import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;`;

  const restAssuredBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {

    @BeforeAll
    static void setup() {
        RestAssured.baseURI = "http://localhost";
        RestAssured.port = 8080;
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
        given()
            .when()
            .get("/api/endpoint")
            .then()
            .statusCode(200);
    }

{{/steps}}
}
`;

  const supertestHeader = `import request from "supertest";
import { describe, it, expect } from "vitest";

const API_URL = process.env.API_URL || "http://localhost:3000";`;

  const supertestBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    const response = await request(API_URL)
      .get("/api/endpoint");
    expect(response.status).toBe(200);
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const k6Header = `import http from "k6/http";
import { check, sleep } from "k6";`;

  const k6Body = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */

export const options = {
  vus: 10,
  duration: "30s",
};

export default function () {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  {
    const res = http.get("http://localhost:3000/api/endpoint");
    check(res, {
      "Step {{order}} - status is 200": (r) => r.status === 200,
    });
  }

{{/steps}}
  sleep(1);
}
`;

  // --- k6 TypeScript ---
  const k6TsHeader = `import http, { RefinedResponse, ResponseType } from "k6/http";
import { check, sleep } from "k6";
import { Options } from "k6/options";`;

  const k6TsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */

export const options: Options = {
  vus: 10,
  duration: "30s",
};

export default function (): void {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  {
    const res: RefinedResponse<ResponseType> = http.get("http://localhost:3000/api/endpoint");
    check(res, {
      "Step {{order}} - status is 200": (r) => r.status === 200,
    });
  }

{{/steps}}
  sleep(1);
}
`;

  const robotFrameworkBody = `*** Settings ***
Documentation    Test Case: {{{name}}}
...              ID: {{{id}}}
...              State: {{{state}}}
...              Tags: {{{tags}}}
...              Created by: {{{createdBy}}}
Library          SeleniumLibrary

*** Variables ***
\${BROWSER}    chrome
\${URL}        http://localhost:3000

*** Test Cases ***
{{#steps}}
Step {{{order}}} - {{{step}}}
    [Documentation]    Expected: {{{expectedResult}}}
    Log    TODO: Implement test logic

{{/steps}}
`;

  // --- Playwright API Testing ---
  const playwrightApiTsHeader = `import { test, expect } from "@playwright/test";`;

  const playwrightApiTsBody = `/**
 * API Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
test.describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  test("Step {{order}} - {{step}}", async ({ request }) => {
    const response = await request.get("/api/endpoint");
    expect(response.ok()).toBeTruthy();
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const playwrightApiJsBody = `/**
 * API Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
test.describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  test("Step {{order}} - {{step}}", async ({ request }) => {
    const response = await request.get("/api/endpoint");
    expect(response.ok()).toBeTruthy();
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  const playwrightApiPythonBody = `"""
API Test Case: {{{name}}}
ID: {{{id}}}
State: {{{state}}}
Tags: {{{tags}}}
Created by: {{{createdBy}}}
"""
import pytest
from playwright.sync_api import Playwright, APIRequestContext


@pytest.fixture(scope="session")
def api_request_context(playwright: Playwright) -> APIRequestContext:
    return playwright.request.new_context(base_url="http://localhost:3000")


class Test{{{id}}}:
    """{{{name}}}"""

{{#steps}}
    def test_step_{{{order}}}(self, api_request_context: APIRequestContext):
        """Step {{{order}}}: {{{step}}}"""
        # Expected: {{{expectedResult}}}
        response = api_request_context.get("/api/endpoint")
        assert response.ok
        # TODO: Implement test logic

{{/steps}}
`;

  const playwrightApiJavaHeader = `import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;`;

  const playwrightApiJavaBody = `/**
 * API Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {
    static Playwright playwright;
    static APIRequestContext request;

    @BeforeAll
    static void setup() {
        playwright = Playwright.create();
        request = playwright.request().newContext(
            new APIRequest.NewContextOptions()
                .setBaseURL("http://localhost:3000")
        );
    }

    @AfterAll
    static void teardown() {
        if (request != null) request.dispose();
        if (playwright != null) playwright.close();
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        APIResponse response = request.get("/api/endpoint");
        Assertions.assertTrue(response.ok());
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  const playwrightApiCsharpHeader = `using Microsoft.Playwright;
using NUnit.Framework;`;

  const playwrightApiCsharpBody = `/// <summary>
/// API Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
/// </summary>
[TestFixture]
public class Test{{{id}}}
{
    private IPlaywright _playwright;
    private IAPIRequestContext _request;

    [OneTimeSetUp]
    public async Task Setup()
    {
        _playwright = await Playwright.CreateAsync();
        _request = await _playwright.APIRequest.NewContextAsync(new()
        {
            BaseURL = "http://localhost:3000"
        });
    }

    [OneTimeTearDown]
    public async Task Teardown()
    {
        if (_request != null) await _request.DisposeAsync();
        _playwright.Dispose();
    }

{{#steps}}
    [Test]
    public async Task Step{{{order}}}_{{{order}}}()
    {
        // Step {{{order}}}: {{{step}}}
        // Expected: {{{expectedResult}}}
        var response = await _request.GetAsync("/api/endpoint");
        Assert.That(response.Ok, Is.True);
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- TestCafe ---
  const testcafeHeader = `import { Selector, ClientFunction } from "testcafe";`;

  const testcafeBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
fixture\`{{{name}}}\`.page\`http://localhost:3000\`;

{{#steps}}
// Step {{{order}}}: {{{step}}}
// Expected: {{{expectedResult}}}
test("Step {{order}} - {{step}}", async (t) => {
  // TODO: Implement test logic
});

{{/steps}}
`;

  // --- Vitest ---
  const vitestHeader = `import { describe, it, expect } from "vitest";`;

  const vitestBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- Go Test ---
  const goTestHeader = `package tests

import "testing"`;

  const goTestBody = `// Test Case: {{{name}}}
// ID: {{{id}}}
// State: {{{state}}}
// Tags: {{{tags}}}
// Created by: {{{createdBy}}}

{{#steps}}
func TestStep{{{order}}}(t *testing.T) {
\t// Step {{{order}}}: {{{step}}}
\t// Expected: {{{expectedResult}}}
\tt.Skip("TODO: Implement test logic")
}

{{/steps}}
`;

  // --- xUnit C# ---
  const xunitHeader = `using Xunit;`;

  const xunitBody = `/// <summary>
/// Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
/// </summary>
public class Test{{{id}}}
{
{{#steps}}
    [Fact]
    public void Step{{{order}}}()
    {
        // Step {{{order}}}: {{{step}}}
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Mocha ---
  const mochaJsHeader = `const { expect } = require("chai");`;

  const mochaTsHeader = `import { expect } from "chai";`;

  const mochaBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", function () {
{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", function () {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- Postman Test Script ---
  const postmanBody = `// Postman Test Script for: {{{name}}}
// ID: {{{id}}}
// State: {{{state}}}
// Tags: {{{tags}}}
// Created by: {{{createdBy}}}

{{#steps}}
// Step {{{order}}}: {{{step}}}
pm.test("Step {{order}} - {{step}}", function () {
    // Expected: {{{expectedResult}}}
    // TODO: Implement test assertions
    pm.response.to.have.status(200);
});

{{/steps}}
`;

  // --- Karate ---
  const karateBody = `Feature: {{{name}}}
  # ID: {{{id}}}
  # State: {{{state}}}
  # Tags: {{{tags}}}
  # Created by: {{{createdBy}}}

  Background:
    * url 'https://api.example.com'

{{#steps}}
  Scenario: Step {{{order}}} - {{{step}}}
    # Expected: {{{expectedResult}}}
    Given path '/api/endpoint'
    When method get
    Then status 200

{{/steps}}
`;

  // --- Appium Java ---
  const appiumJavaHeader = `import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;
import org.junit.jupiter.api.*;
import java.net.URL;`;

  const appiumJavaBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
public class Test{{{id}}} {
    private AndroidDriver driver;

    @BeforeEach
    void setUp() throws Exception {
        UiAutomator2Options options = new UiAutomator2Options()
            .setDeviceName("emulator-5554")
            .setApp("/path/to/app.apk");
        driver = new AndroidDriver(new URL("http://127.0.0.1:4723"), options);
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    void testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Appium Python ---
  const appiumPythonBody = `"""
Test Case: {{{name}}}
ID: {{{id}}}
State: {{{state}}}
Tags: {{{tags}}}
Created by: {{{createdBy}}}
"""
import pytest
from appium import webdriver
from appium.options import UiAutomator2Options


class Test{{{id}}}:
    """{{{name}}}"""

    @pytest.fixture(autouse=True)
    def setup(self):
        options = UiAutomator2Options()
        options.device_name = "emulator-5554"
        options.app = "/path/to/app.apk"
        self.driver = webdriver.Remote("http://127.0.0.1:4723", options=options)
        yield
        self.driver.quit()

{{#steps}}
    def test_step_{{{order}}}(self):
        """Step {{{order}}}: {{{step}}}"""
        # Expected: {{{expectedResult}}}
        # TODO: Implement test logic
        pass

{{/steps}}
`;

  // --- Appium JavaScript ---
  const appiumJsHeader = `const { remote } = require("webdriverio");`;

  const appiumJsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
  let driver;

  before(async () => {
    driver = await remote({
      hostname: "127.0.0.1",
      port: 4723,
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": "emulator-5554",
        "appium:app": "/path/to/app.apk",
      },
    });
  });

  after(async () => {
    if (driver) {
      await driver.deleteSession();
    }
  });

{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- Appium TypeScript ---
  const appiumTsHeader = `import { remote, Browser } from "webdriverio";`;

  const appiumTsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{name}}", () => {
  let driver: Browser;

  before(async () => {
    driver = await remote({
      hostname: "127.0.0.1",
      port: 4723,
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": "emulator-5554",
        "appium:app": "/path/to/app.apk",
      },
    });
  });

  after(async () => {
    if (driver) {
      await driver.deleteSession();
    }
  });

{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- XCUITest Swift ---
  const xcuiTestHeader = `import XCTest`;

  const xcuiTestBody = `/// Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
class Test{{{id}}}: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

{{#steps}}
    /// Step {{{order}}}: {{{step}}}
    func testStep{{{order}}}() throws {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Appium (Kotlin) ---
  const appiumKotlinHeader = `import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.options.UiAutomator2Options
import org.junit.jupiter.api.*
import java.net.URL`;

  const appiumKotlinBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
class Test{{{id}}} {
    private lateinit var driver: AndroidDriver

    @BeforeEach
    fun setUp() {
        val options = UiAutomator2Options()
            .setDeviceName("emulator-5554")
            .setApp("/path/to/app.apk")
        driver = AndroidDriver(URL("http://127.0.0.1:4723"), options)
    }

    @AfterEach
    fun tearDown() {
        driver.quit()
    }

{{#steps}}
    @Test
    @DisplayName("Step {{order}} - {{step}}")
    fun testStep{{{order}}}() {
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Espresso (Java) ---
  const espressoJavaHeader = `import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.espresso.Espresso;
import androidx.test.espresso.action.ViewActions;
import androidx.test.espresso.assertion.ViewAssertions;
import androidx.test.espresso.matcher.ViewMatchers;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;`;

  const espressoJavaBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
@RunWith(AndroidJUnit4.class)
public class Test{{{id}}} {

    @Rule
    public ActivityScenarioRule<MainActivity> activityRule =
            new ActivityScenarioRule<>(MainActivity.class);

{{#steps}}
    @Test
    public void testStep{{{order}}}() {
        // Step {{{order}}}: {{{step}}}
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Espresso (Kotlin) ---
  const espressoKotlinHeader = `import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith`;

  const espressoKotlinBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
@RunWith(AndroidJUnit4::class)
class Test{{{id}}} {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

{{#steps}}
    @Test
    fun testStep{{{order}}}() {
        // Step {{{order}}}: {{{step}}}
        // Expected: {{{expectedResult}}}
        // TODO: Implement test logic
    }

{{/steps}}
}
`;

  // --- Detox (JavaScript) ---
  const detoxJsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{{name}}}", () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- Detox (TypeScript) ---
  const detoxTsBody = `/**
 * Test Case: {{{name}}}
 * ID: {{{id}}}
 * State: {{{state}}}
 * Tags: {{{tags}}}
 * Created by: {{{createdBy}}}
 */
describe("{{{name}}}", () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

{{#steps}}
  // Step {{{order}}}: {{{step}}}
  // Expected: {{{expectedResult}}}
  it("Step {{order}} - {{step}}", async () => {
    // TODO: Implement test logic
  });

{{/steps}}
});
`;

  // --- Maestro (YAML) ---
  const maestroBody = `# Test Case: {{{name}}}
# ID: {{{id}}}
# State: {{{state}}}
# Tags: {{{tags}}}
# Created by: {{{createdBy}}}
appId: com.example.app
---
{{#steps}}
# Step {{{order}}}: {{{step}}}
# Expected: {{{expectedResult}}}
- tapOn: "TODO: element identifier"

{{/steps}}
`;

  // --- Flutter Integration Test (Dart) ---
  const flutterTestHeader = `import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:your_app/main.dart' as app;`;

  const flutterTestBody = `/// Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group("{{{name}}}", () {
    testWidgets("setup", (tester) async {
      app.main();
      await tester.pumpAndSettle();
    });

{{#steps}}
    // Step {{{order}}}: {{{step}}}
    // Expected: {{{expectedResult}}}
    testWidgets("Step {{order}} - {{step}}", (tester) async {
      // TODO: Implement test logic
      await tester.pumpAndSettle();
    });

{{/steps}}
  });
}
`;

  // --- Earl Grey (Swift) ---
  const earlGreyHeader = `import XCTest`;

  const earlGreyBody = `/// Test Case: {{{name}}}
/// ID: {{{id}}}
/// State: {{{state}}}
/// Tags: {{{tags}}}
/// Created by: {{{createdBy}}}
class Test{{{id}}}: XCTestCase {

  override func setUp() {
    super.setUp()
    continueAfterFailure = false
  }

  override func tearDown() {
    super.tearDown()
  }

{{#steps}}
  /// Step {{{order}}}: {{{step}}}
  func testStep{{{order}}}() {
    // Expected: {{{expectedResult}}}
    // TODO: Implement test logic using EarlGrey matchers
    // EarlGrey.selectElement(with: grey_accessibilityID("elementId"))
    //   .perform(grey_tap())
    //   .assert(grey_sufficientlyVisible())
  }

{{/steps}}
}
`;

  const templates = [
    // --- Browser E2E ---
    {
      name: "Playwright (TypeScript)",
      description:
        "Generates Playwright test stubs in TypeScript with test.describe and test blocks for each step.",
      category: "Browser E2E",
      framework: "Playwright",
      headerBody: playwrightHeader,
      templateBody: playwrightBody,
      footerBody: null as string | null,
      fileExtension: ".spec.ts",
      language: "typescript",
      isDefault: true,
    },
    {
      name: "Playwright (JavaScript)",
      description:
        "Generates Playwright test stubs in JavaScript with test.describe and test blocks for each step.",
      category: "Browser E2E",
      framework: "Playwright",
      headerBody: playwrightHeader.replace(
        'import { test, expect } from "@playwright/test";',
        'const { test, expect } = require("@playwright/test");'
      ),
      templateBody: playwrightBody,
      footerBody: null as string | null,
      fileExtension: ".spec.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Playwright (Python)",
      description:
        "Generates Playwright test stubs in Python using pytest-playwright with sync API.",
      category: "Browser E2E",
      framework: "Playwright",
      headerBody: null as string | null,
      templateBody: playwrightPythonBody,
      footerBody: null as string | null,
      fileExtension: ".py",
      language: "python",
      isDefault: false,
    },
    {
      name: "Playwright (Java)",
      description:
        "Generates Playwright test stubs in Java with JUnit 5 and browser lifecycle management.",
      category: "Browser E2E",
      framework: "Playwright",
      headerBody: playwrightJavaHeader,
      templateBody: playwrightJavaBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Playwright (C#)",
      description:
        "Generates Playwright test stubs in C# with NUnit and async/await patterns.",
      category: "Browser E2E",
      framework: "Playwright",
      headerBody: playwrightCsharpHeader,
      templateBody: playwrightCsharpBody,
      footerBody: null as string | null,
      fileExtension: ".cs",
      language: "csharp",
      isDefault: false,
    },
    {
      name: "Cypress (JavaScript)",
      description:
        "Generates Cypress test stubs in JavaScript with describe and it blocks for each step.",
      category: "Browser E2E",
      framework: "Cypress",
      headerBody: cypressHeader,
      templateBody: cypressBody,
      footerBody: null as string | null,
      fileExtension: ".cy.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Cypress (TypeScript)",
      description:
        "Generates Cypress test stubs in TypeScript with describe and it blocks for each step.",
      category: "Browser E2E",
      framework: "Cypress",
      headerBody: cypressTsHeader,
      templateBody: cypressTsBody,
      footerBody: null as string | null,
      fileExtension: ".cy.ts",
      language: "typescript",
      isDefault: false,
    },
    {
      name: "Selenium (Java)",
      description:
        "Generates Selenium WebDriver test stubs in Java with JUnit 5 and ChromeDriver setup.",
      category: "Browser E2E",
      framework: "Selenium",
      headerBody: seleniumJavaHeader,
      templateBody: seleniumJavaBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Selenium (Python)",
      description:
        "Generates Selenium WebDriver test stubs in Python with pytest fixtures and Chrome driver.",
      category: "Browser E2E",
      framework: "Selenium",
      headerBody: null as string | null,
      templateBody: seleniumPythonBody,
      footerBody: null as string | null,
      fileExtension: ".py",
      language: "python",
      isDefault: false,
    },
    {
      name: "WebdriverIO (JavaScript)",
      description:
        "Generates WebdriverIO test stubs in JavaScript with describe and it blocks for each step.",
      category: "Browser E2E",
      framework: "WebdriverIO",
      headerBody: null as string | null,
      templateBody: webdriverioBody,
      footerBody: null as string | null,
      fileExtension: ".test.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "WebdriverIO (TypeScript)",
      description:
        "Generates WebdriverIO test stubs in TypeScript with describe and it blocks for each step.",
      category: "Browser E2E",
      framework: "WebdriverIO",
      headerBody: webdriverioTsHeader,
      templateBody: webdriverioTsBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Unit Testing ---
    {
      name: "Jest (TypeScript)",
      description:
        "Generates Jest test stubs in TypeScript with describe and it blocks.",
      category: "Unit Testing",
      framework: "Jest",
      headerBody: null as string | null,
      templateBody: jestTsBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    {
      name: "pytest",
      description:
        "Generates pytest test stubs in Python with class-based test organization.",
      category: "Unit Testing",
      framework: "pytest",
      headerBody: null as string | null,
      templateBody: pytestBody,
      footerBody: null as string | null,
      fileExtension: ".py",
      language: "python",
      isDefault: false,
    },
    {
      name: "JUnit 5 (Java)",
      description:
        "Generates JUnit 5 test stubs in Java with @Test and @DisplayName annotations.",
      category: "Unit Testing",
      framework: "JUnit",
      headerBody: junitHeader,
      templateBody: junitBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    // --- BDD ---
    {
      name: "Gherkin Feature File",
      description:
        "Generates Gherkin .feature files with Given/When/Then steps for Cucumber, SpecFlow, or Behave.",
      category: "BDD",
      framework: "Cucumber",
      headerBody: null as string | null,
      templateBody: gherkinBody,
      footerBody: null as string | null,
      fileExtension: ".feature",
      language: "gherkin",
      isDefault: false,
    },
    // --- API Testing ---
    {
      name: "Playwright API (TypeScript)",
      description:
        "Generates Playwright API test stubs in TypeScript using APIRequestContext for HTTP endpoint testing.",
      category: "API Testing",
      framework: "Playwright",
      headerBody: playwrightApiTsHeader,
      templateBody: playwrightApiTsBody,
      footerBody: null as string | null,
      fileExtension: ".api.spec.ts",
      language: "typescript",
      isDefault: false,
    },
    {
      name: "Playwright API (JavaScript)",
      description:
        "Generates Playwright API test stubs in JavaScript using APIRequestContext for HTTP endpoint testing.",
      category: "API Testing",
      framework: "Playwright",
      headerBody: playwrightApiTsHeader.replace(
        'import { test, expect } from "@playwright/test";',
        'const { test, expect } = require("@playwright/test");'
      ),
      templateBody: playwrightApiJsBody,
      footerBody: null as string | null,
      fileExtension: ".api.spec.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Playwright API (Python)",
      description:
        "Generates Playwright API test stubs in Python using APIRequestContext with pytest fixtures.",
      category: "API Testing",
      framework: "Playwright",
      headerBody: null as string | null,
      templateBody: playwrightApiPythonBody,
      footerBody: null as string | null,
      fileExtension: ".py",
      language: "python",
      isDefault: false,
    },
    {
      name: "Playwright API (Java)",
      description:
        "Generates Playwright API test stubs in Java using APIRequestContext with JUnit 5.",
      category: "API Testing",
      framework: "Playwright",
      headerBody: playwrightApiJavaHeader,
      templateBody: playwrightApiJavaBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Playwright API (C#)",
      description:
        "Generates Playwright API test stubs in C# using IAPIRequestContext with NUnit.",
      category: "API Testing",
      framework: "Playwright",
      headerBody: playwrightApiCsharpHeader,
      templateBody: playwrightApiCsharpBody,
      footerBody: null as string | null,
      fileExtension: ".cs",
      language: "csharp",
      isDefault: false,
    },
    {
      name: "REST Assured (Java)",
      description:
        "Generates REST Assured API test stubs in Java with JUnit 5.",
      category: "API Testing",
      framework: "REST Assured",
      headerBody: restAssuredHeader,
      templateBody: restAssuredBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Supertest (TypeScript)",
      description:
        "Generates Supertest API test stubs in TypeScript with Vitest.",
      category: "API Testing",
      framework: "Supertest",
      headerBody: supertestHeader,
      templateBody: supertestBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Performance ---
    {
      name: "k6 (JavaScript)",
      description:
        "Generates k6 performance test scripts in JavaScript with configurable VUs and duration.",
      category: "Performance",
      framework: "k6",
      headerBody: k6Header,
      templateBody: k6Body,
      footerBody: null as string | null,
      fileExtension: ".js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "k6 (TypeScript)",
      description:
        "Generates k6 performance test scripts in TypeScript with typed options and configurable VUs.",
      category: "Performance",
      framework: "k6",
      headerBody: k6TsHeader,
      templateBody: k6TsBody,
      footerBody: null as string | null,
      fileExtension: ".ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Robot Framework ---
    {
      name: "Robot Framework",
      description:
        "Generates Robot Framework test cases with keyword-driven format and SeleniumLibrary.",
      category: "Robot Framework",
      framework: "Robot Framework",
      headerBody: null as string | null,
      templateBody: robotFrameworkBody,
      footerBody: null as string | null,
      fileExtension: ".robot",
      language: "robotframework",
      isDefault: false,
    },
    // --- Generic ---
    {
      name: "Generic Markdown",
      description:
        "Exports test case details as a Markdown document with metadata table and step sections.",
      category: "Generic",
      framework: "Generic",
      headerBody: null as string | null,
      templateBody: markdownBody,
      footerBody: null as string | null,
      fileExtension: ".md",
      language: "markdown",
      isDefault: false,
    },
    // --- TestCafe ---
    {
      name: "TestCafe (JavaScript)",
      description:
        "Generates TestCafe test stubs in JavaScript with fixture and test blocks.",
      category: "Browser E2E",
      framework: "TestCafe",
      headerBody: testcafeHeader,
      templateBody: testcafeBody,
      footerBody: null as string | null,
      fileExtension: ".test.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "TestCafe (TypeScript)",
      description:
        "Generates TestCafe test stubs in TypeScript with fixture and test blocks.",
      category: "Browser E2E",
      framework: "TestCafe",
      headerBody: testcafeHeader,
      templateBody: testcafeBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Vitest ---
    {
      name: "Vitest (TypeScript)",
      description:
        "Generates Vitest test stubs in TypeScript with describe and it blocks.",
      category: "Unit Testing",
      framework: "Vitest",
      headerBody: vitestHeader,
      templateBody: vitestBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Go Test ---
    {
      name: "Go Test",
      description:
        "Generates Go test stubs using the standard testing package.",
      category: "Unit Testing",
      framework: "Go",
      headerBody: goTestHeader,
      templateBody: goTestBody,
      footerBody: null as string | null,
      fileExtension: "_test.go",
      language: "go",
      isDefault: false,
    },
    // --- xUnit C# ---
    {
      name: "xUnit (C#)",
      description:
        "Generates xUnit.net test stubs in C# with [Fact] attributes.",
      category: "Unit Testing",
      framework: "xUnit",
      headerBody: xunitHeader,
      templateBody: xunitBody,
      footerBody: null as string | null,
      fileExtension: ".cs",
      language: "csharp",
      isDefault: false,
    },
    // --- Mocha ---
    {
      name: "Mocha (JavaScript)",
      description:
        "Generates Mocha test stubs in JavaScript with describe and it blocks using Chai assertions.",
      category: "Unit Testing",
      framework: "Mocha",
      headerBody: mochaJsHeader,
      templateBody: mochaBody,
      footerBody: null as string | null,
      fileExtension: ".test.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Mocha (TypeScript)",
      description:
        "Generates Mocha test stubs in TypeScript with describe and it blocks using Chai assertions.",
      category: "Unit Testing",
      framework: "Mocha",
      headerBody: mochaTsHeader,
      templateBody: mochaBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    // --- Postman ---
    {
      name: "Postman Test Script",
      description:
        "Generates Postman test scripts with pm.test blocks for use in the Tests tab.",
      category: "API Testing",
      framework: "Postman",
      headerBody: null as string | null,
      templateBody: postmanBody,
      footerBody: null as string | null,
      fileExtension: ".js",
      language: "javascript",
      isDefault: false,
    },
    // --- Karate ---
    {
      name: "Karate",
      description:
        "Generates Karate API test stubs with Feature/Scenario format and HTTP request templates.",
      category: "API Testing",
      framework: "Karate",
      headerBody: null as string | null,
      templateBody: karateBody,
      footerBody: null as string | null,
      fileExtension: ".feature",
      language: "karate",
      isDefault: false,
    },
    // --- Mobile Testing ---
    {
      name: "Appium (Java)",
      description:
        "Generates Appium test stubs in Java with JUnit 5 and UiAutomator2 driver setup.",
      category: "Mobile Testing",
      framework: "Appium",
      headerBody: appiumJavaHeader,
      templateBody: appiumJavaBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Appium (Python)",
      description:
        "Generates Appium test stubs in Python with pytest and UiAutomator2 driver setup.",
      category: "Mobile Testing",
      framework: "Appium",
      headerBody: null as string | null,
      templateBody: appiumPythonBody,
      footerBody: null as string | null,
      fileExtension: ".py",
      language: "python",
      isDefault: false,
    },
    {
      name: "Appium (JavaScript)",
      description:
        "Generates Appium test stubs in JavaScript with WebdriverIO remote driver setup.",
      category: "Mobile Testing",
      framework: "Appium",
      headerBody: appiumJsHeader,
      templateBody: appiumJsBody,
      footerBody: null as string | null,
      fileExtension: ".test.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Appium (TypeScript)",
      description:
        "Generates Appium test stubs in TypeScript with WebdriverIO remote driver setup.",
      category: "Mobile Testing",
      framework: "Appium",
      headerBody: appiumTsHeader,
      templateBody: appiumTsBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    {
      name: "Appium (Kotlin)",
      description:
        "Generates Appium test stubs in Kotlin with JUnit 5 and UiAutomator2 driver setup.",
      category: "Mobile Testing",
      framework: "Appium",
      headerBody: appiumKotlinHeader,
      templateBody: appiumKotlinBody,
      footerBody: null as string | null,
      fileExtension: ".kt",
      language: "kotlin",
      isDefault: false,
    },
    {
      name: "XCUITest (Swift)",
      description:
        "Generates XCUITest stubs in Swift with XCTestCase and XCUIApplication setup.",
      category: "Mobile Testing",
      framework: "XCUITest",
      headerBody: xcuiTestHeader,
      templateBody: xcuiTestBody,
      footerBody: null as string | null,
      fileExtension: ".swift",
      language: "swift",
      isDefault: false,
    },
    {
      name: "Espresso (Java)",
      description:
        "Generates Espresso test stubs in Java with ActivityScenarioRule and JUnit 4.",
      category: "Mobile Testing",
      framework: "Espresso",
      headerBody: espressoJavaHeader,
      templateBody: espressoJavaBody,
      footerBody: null as string | null,
      fileExtension: ".java",
      language: "java",
      isDefault: false,
    },
    {
      name: "Espresso (Kotlin)",
      description:
        "Generates Espresso test stubs in Kotlin with ActivityScenarioRule and JUnit 4.",
      category: "Mobile Testing",
      framework: "Espresso",
      headerBody: espressoKotlinHeader,
      templateBody: espressoKotlinBody,
      footerBody: null as string | null,
      fileExtension: ".kt",
      language: "kotlin",
      isDefault: false,
    },
    {
      name: "Detox (JavaScript)",
      description:
        "Generates Detox test stubs in JavaScript for React Native apps.",
      category: "Mobile Testing",
      framework: "Detox",
      headerBody: null as string | null,
      templateBody: detoxJsBody,
      footerBody: null as string | null,
      fileExtension: ".test.js",
      language: "javascript",
      isDefault: false,
    },
    {
      name: "Detox (TypeScript)",
      description:
        "Generates Detox test stubs in TypeScript for React Native apps.",
      category: "Mobile Testing",
      framework: "Detox",
      headerBody: null as string | null,
      templateBody: detoxTsBody,
      footerBody: null as string | null,
      fileExtension: ".test.ts",
      language: "typescript",
      isDefault: false,
    },
    {
      name: "Maestro",
      description:
        "Generates Maestro flow files in YAML for cross-platform mobile testing (Android, iOS, React Native, Flutter).",
      category: "Mobile Testing",
      framework: "Maestro",
      headerBody: null as string | null,
      templateBody: maestroBody,
      footerBody: null as string | null,
      fileExtension: ".yaml",
      language: "yaml",
      isDefault: false,
    },
    {
      name: "Flutter Integration Test (Dart)",
      description:
        "Generates Flutter integration test stubs in Dart with IntegrationTestWidgetsFlutterBinding.",
      category: "Mobile Testing",
      framework: "Flutter",
      headerBody: flutterTestHeader,
      templateBody: flutterTestBody,
      footerBody: null as string | null,
      fileExtension: "_test.dart",
      language: "dart",
      isDefault: false,
    },
    {
      name: "Earl Grey (Swift)",
      description:
        "Generates Earl Grey test stubs in Swift for iOS UI testing with EarlGrey matchers.",
      category: "Mobile Testing",
      framework: "Earl Grey",
      headerBody: earlGreyHeader,
      templateBody: earlGreyBody,
      footerBody: null as string | null,
      fileExtension: ".swift",
      language: "swift",
      isDefault: false,
    },
  ];

  for (const tmpl of templates) {
    await prisma.caseExportTemplate.upsert({
      where: { name: tmpl.name },
      update: {
        description: tmpl.description,
        category: tmpl.category,
        framework: tmpl.framework,
        headerBody: tmpl.headerBody,
        templateBody: tmpl.templateBody,
        footerBody: tmpl.footerBody,
        fileExtension: tmpl.fileExtension,
        language: tmpl.language,
      },
      create: tmpl,
    });
  }

  console.log("Case export templates seeded successfully.");
}

// --- Main Execution ---
async function main() {
  try {
    await seedCoreData();
    await seedCaseExportTemplates();

    // Always create magic link SSO provider for production environments
    // But keep it disabled by default to prevent unwanted email sending
    if (process.env.NODE_ENV === "production") {
      try {
        console.log("Seeding production SSO provider...");
        // Create Magic Link provider (disabled by default to prevent unwanted emails)
        await prisma.ssoProvider.upsert({
          where: {
            name: "Magic Link",
          },
          update: {
            type: "MAGIC_LINK",
            enabled: false, // Disabled by default - must be manually enabled
            forceSso: false, // Allow both SSO and regular signup
            config: {},
          },
          create: {
            name: "Magic Link",
            type: "MAGIC_LINK",
            enabled: false, // Disabled by default - must be manually enabled
            forceSso: false, // Allow both SSO and regular signup
            config: {},
          },
        });
        console.log(
          `✓ Created Magic Link provider (disabled by default - must be manually enabled in admin settings)`
        );
      } catch (error) {
        console.error("Error seeding SSO provider (continuing):", error);
      }
    }

    // Seed default prompt configuration (must run before demo project)
    try {
      await seedDefaultPromptConfig(prisma);
    } catch (error) {
      console.error("Error seeding prompt config (continuing):", error);
    }

    // Seed demo project with sample data for new users
    try {
      await seedDemoProject();
    } catch (error) {
      console.error("Error seeding demo project (continuing):", error);
    }

    // Assign workflows to all projects (must run after demo project is created)
    try {
      await assignWorkflowsToAllProjects();
    } catch (error) {
      console.error("Error assigning workflows (continuing):", error);
    }

    // Seed test data only when explicitly requested (e.g., E2E test setup)
    if (process.env.SEED_TEST_DATA === "true") {
      console.log("\n--- Seeding E2E Test Data ---");
      await seedTestData();
    }
  } catch (error) {
    console.error("Error in main execution:", error);
  } finally {
    await prisma.$disconnect();
  }
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
