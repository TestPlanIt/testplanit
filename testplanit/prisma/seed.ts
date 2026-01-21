import { PrismaClient, WorkflowScope, ApplicationArea } from "@prisma/client";
import { seedFieldIcons } from "./seedFieldIcons";
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
  // Use upsert with explicit IDs to ensure consistent role IDs
  const userRole = await prisma.roles.upsert({
    where: { id: 1 },
    update: { name: "user", isDefault: true },
    create: {
      id: 1,
      name: "user",
      isDefault: true,
    },
  });
  const adminRole = await prisma.roles.upsert({
    where: { id: 2 },
    update: { name: "admin", isDefault: false },
    create: {
      id: 2,
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

    // Assign workflows to all projects
    await assignWorkflowsToAllProjects();
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
