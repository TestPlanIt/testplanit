import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  security?: Array<Record<string, string[]>>;
}

// Define API categories for splitting
// Tag names must match exactly what's in the ZenStack-generated spec
export const API_CATEGORIES = {
  custom: {
    title: "Custom API Endpoints",
    description:
      "Authentication, file uploads, imports, and other custom endpoints",
    tags: [
      "Authentication",
      "File Upload",
      "JUnit Import",
      "Search",
      "Admin",
      "User Management",
    ],
  },
  projects: {
    title: "Projects & Folders",
    description: "Project and folder management",
    tags: [
      "projects",
      "repositories",
      "repositoryFolders",
      "projectAssignment",
      "projectIntegration",
      "projectLlmIntegration",
      "projectStatusAssignment",
      "projectWorkflowAssignment",
    ],
  },
  testCases: {
    title: "Test Cases & Repository",
    description: "Test case management and repository operations",
    tags: [
      "repositoryCases",
      "repositoryCaseVersions",
      "repositoryCaseLink",
      "steps",
      "sharedStepGroup",
      "sharedStepItem",
      "caseFields",
      "caseFieldTypes",
      "caseFieldAssignment",
      "caseFieldValues",
      "caseFieldVersionValues",
      "fieldOptions",
      "fieldIcon",
      "templates",
      "templateCaseAssignment",
      "templateProjectAssignment",
      "templateResultAssignment",
    ],
  },
  testRuns: {
    title: "Test Runs & Execution",
    description: "Test run management and execution tracking",
    tags: [
      "testRuns",
      "testRunCases",
      "testRunResults",
      "testRunStepResults",
      "sessions",
      "sessionVersions",
      "sessionResults",
      "sessionFieldValues",
      "resultFields",
      "resultFieldAssignment",
      "resultFieldValues",
      "jUnitTestSuite",
      "jUnitTestResult",
      "jUnitTestStep",
      "jUnitProperty",
      "jUnitAttachment",
    ],
  },
  planning: {
    title: "Planning & Organization",
    description: "Milestones, configurations, tags, workflows, and statuses",
    tags: [
      "milestones",
      "milestoneTypes",
      "milestoneTypesAssignment",
      "configurations",
      "configCategories",
      "configVariants",
      "configurationConfigVariant",
      "tags",
      "workflows",
      "status",
      "statusScope",
      "statusScopeAssignment",
      "color",
      "colorFamily",
    ],
  },
  users: {
    title: "Users & Accounts",
    description: "User management, roles, groups, and account settings",
    tags: [
      "user",
      "account",
      "userPreferences",
      "userIntegrationAuth",
      "userProjectPermission",
      "roles",
      "rolePermission",
      "groups",
      "groupAssignment",
      "groupProjectPermission",
      "allowedEmailDomain",
      "appConfig",
      "registrationSettings",
      "notification",
    ],
  },
  integrations: {
    title: "Integrations & SSO",
    description: "External integrations, SSO, and AI/LLM features",
    tags: [
      "integration",
      "issue",
      "ssoProvider",
      "samlConfiguration",
      "llmIntegration",
      "llmProviderConfig",
      "llmFeatureConfig",
      "llmPromptTemplate",
      "llmRateLimit",
      "llmUsage",
      "llmResponseCache",
      "ollamaModelRegistry",
    ],
  },
  other: {
    title: "Attachments & Other",
    description: "File attachments, comments, imports, and miscellaneous",
    tags: [
      "attachments",
      "comment",
      "commentMention",
      "testmoImportJob",
      "testmoImportDataset",
      "testmoImportMapping",
      "testmoImportStaging",
      "verificationToken",
    ],
  },
} as const;

export type ApiCategory = keyof typeof API_CATEGORIES;

/**
 * Merge multiple OpenAPI specs into a single spec
 */
export function mergeOpenAPISpecs(specs: OpenAPISpec[]): OpenAPISpec {
  if (specs.length === 0) {
    throw new Error("At least one spec is required");
  }

  const merged: OpenAPISpec = {
    openapi: "3.0.3",
    info: {
      title: "TestPlanIt API",
      version: "1.0.0",
      description:
        "Complete API documentation for TestPlanIt, including ZenStack data models and custom endpoints",
    },
    servers: [{ url: "/api", description: "API Server" }],
    tags: [],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {},
    },
    security: [],
  };

  const seenTags = new Set<string>();
  const seenSecurity = new Set<string>();

  for (const spec of specs) {
    // Merge tags
    if (spec.tags) {
      for (const tag of spec.tags) {
        if (!seenTags.has(tag.name)) {
          seenTags.add(tag.name);
          merged.tags!.push(tag);
        }
      }
    }

    // Merge paths
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (merged.paths[path]) {
        // Merge methods for existing path
        merged.paths[path] = {
          ...(merged.paths[path] as object),
          ...(methods as object),
        };
      } else {
        merged.paths[path] = methods;
      }
    }

    // Merge component schemas
    if (spec.components?.schemas) {
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        if (!merged.components!.schemas![name]) {
          merged.components!.schemas![name] = schema;
        }
      }
    }

    // Merge security schemes
    if (spec.components?.securitySchemes) {
      for (const [name, scheme] of Object.entries(
        spec.components.securitySchemes
      )) {
        if (!merged.components!.securitySchemes![name]) {
          merged.components!.securitySchemes![name] = scheme;
        }
      }
    }

    // Merge security requirements
    if (spec.security) {
      for (const secReq of spec.security) {
        const key = JSON.stringify(secReq);
        if (!seenSecurity.has(key)) {
          seenSecurity.add(key);
          merged.security!.push(secReq);
        }
      }
    }
  }

  // Sort tags alphabetically
  merged.tags!.sort((a, b) => a.name.localeCompare(b.name));

  return merged;
}

/**
 * Filter a spec to only include paths matching specific tags
 */
function filterSpecByTags(
  spec: OpenAPISpec,
  allowedTags: string[],
  title: string,
  description: string
): OpenAPISpec {
  const allowedTagsLower = allowedTags.map((t) => t.toLowerCase());

  const filteredPaths: Record<string, unknown> = {};
  const usedSchemas = new Set<string>();
  const includedTags = new Set<string>();

  // Filter paths by tags
  for (const [path, methods] of Object.entries(spec.paths)) {
    const methodsObj = methods as Record<string, { tags?: string[] }>;
    const filteredMethods: Record<string, unknown> = {};

    for (const [method, operation] of Object.entries(methodsObj)) {
      if (operation.tags) {
        const hasMatchingTag = operation.tags.some((tag) =>
          allowedTagsLower.includes(tag.toLowerCase())
        );
        if (hasMatchingTag) {
          filteredMethods[method] = operation;
          operation.tags.forEach((tag) => includedTags.add(tag));

          // Track schema references
          const opStr = JSON.stringify(operation);
          const schemaRefs = opStr.match(/#\/components\/schemas\/(\w+)/g);
          if (schemaRefs) {
            schemaRefs.forEach((ref) => {
              const schemaName = ref.replace("#/components/schemas/", "");
              usedSchemas.add(schemaName);
            });
          }
        }
      }
    }

    if (Object.keys(filteredMethods).length > 0) {
      filteredPaths[path] = filteredMethods;
    }
  }

  // Filter schemas to only include used ones (and their dependencies)
  const filteredSchemas: Record<string, unknown> = {};
  if (spec.components?.schemas) {
    // Recursively find all schema dependencies
    const findSchemaDeps = (schemaName: string) => {
      if (filteredSchemas[schemaName]) return;
      const schema = spec.components!.schemas![schemaName];
      if (!schema) return;

      filteredSchemas[schemaName] = schema;

      const schemaStr = JSON.stringify(schema);
      const refs = schemaStr.match(/#\/components\/schemas\/(\w+)/g);
      if (refs) {
        refs.forEach((ref) => {
          const depName = ref.replace("#/components/schemas/", "");
          findSchemaDeps(depName);
        });
      }
    };

    usedSchemas.forEach((schemaName) => findSchemaDeps(schemaName));
  }

  // Filter tags
  const filteredTags = (spec.tags || []).filter((tag) =>
    includedTags.has(tag.name)
  );

  return {
    openapi: "3.0.3",
    info: {
      title: `TestPlanIt API - ${title}`,
      version: "1.0.0",
      description,
    },
    servers: spec.servers,
    tags: filteredTags,
    paths: filteredPaths,
    components: {
      schemas: filteredSchemas,
      securitySchemes: spec.components?.securitySchemes,
    },
    security: spec.security,
  };
}

/**
 * Load ZenStack spec
 */
function loadZenstackSpec(): OpenAPISpec | null {
  const openapiDir = join(process.cwd(), "lib", "openapi");
  const zenstackSpecPath = join(openapiDir, "zenstack-openapi.json");
  if (existsSync(zenstackSpecPath)) {
    return JSON.parse(readFileSync(zenstackSpecPath, "utf-8")) as OpenAPISpec;
  }
  return null;
}

/**
 * Load custom spec
 */
function loadCustomSpec(): OpenAPISpec | null {
  const openapiDir = join(process.cwd(), "lib", "openapi");
  const customSpecPath = join(openapiDir, "custom-openapi.json");
  if (existsSync(customSpecPath)) {
    return JSON.parse(readFileSync(customSpecPath, "utf-8")) as OpenAPISpec;
  }
  return null;
}

/**
 * Load and merge OpenAPI specs from the lib/openapi directory
 */
export function loadAndMergeSpecs(): OpenAPISpec {
  const specs: OpenAPISpec[] = [];

  const zenstackSpec = loadZenstackSpec();
  if (zenstackSpec) specs.push(zenstackSpec);

  const customSpec = loadCustomSpec();
  if (customSpec) specs.push(customSpec);

  if (specs.length === 0) {
    throw new Error("No OpenAPI specs found");
  }

  return mergeOpenAPISpecs(specs);
}

/**
 * Load a specific category of the API spec
 */
export function loadSpecByCategory(category: ApiCategory): OpenAPISpec {
  const categoryConfig = API_CATEGORIES[category];

  if (category === "custom") {
    // For custom, just return the custom spec
    const customSpec = loadCustomSpec();
    if (!customSpec) {
      throw new Error("Custom OpenAPI spec not found");
    }
    return {
      ...customSpec,
      info: {
        title: `TestPlanIt API - ${categoryConfig.title}`,
        version: "1.0.0",
        description: categoryConfig.description,
      },
    };
  }

  // For ZenStack categories, filter by tags
  const zenstackSpec = loadZenstackSpec();
  if (!zenstackSpec) {
    throw new Error("ZenStack OpenAPI spec not found");
  }

  return filterSpecByTags(
    zenstackSpec,
    categoryConfig.tags as unknown as string[],
    categoryConfig.title,
    categoryConfig.description
  );
}

/**
 * Get list of available API categories
 */
export function getApiCategories(): Array<{
  id: ApiCategory;
  title: string;
  description: string;
}> {
  return Object.entries(API_CATEGORIES).map(([id, config]) => ({
    id: id as ApiCategory,
    title: config.title,
    description: config.description,
  }));
}

/**
 * Generate the merged OpenAPI spec and write it to a file
 */
export function generateMergedSpec(): void {
  const merged = loadAndMergeSpecs();
  const outputPath = join(process.cwd(), "lib", "openapi", "openapi.json");
  writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Merged OpenAPI spec written to ${outputPath}`);
}

// Run if called directly
if (require.main === module) {
  generateMergedSpec();
}
