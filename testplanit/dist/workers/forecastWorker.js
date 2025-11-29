"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// workers/forecastWorker.ts
var forecastWorker_exports = {};
__export(forecastWorker_exports, {
  JOB_UPDATE_ALL_CASES: () => JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE: () => JOB_UPDATE_SINGLE_CASE
});
module.exports = __toCommonJS(forecastWorker_exports);
var import_bullmq = require("bullmq");

// lib/valkey.ts
var import_ioredis = __toESM(require("ioredis"));
var skipConnection = process.env.SKIP_VALKEY_CONNECTION === "true";
var valkeyUrl = process.env.VALKEY_URL;
if (!valkeyUrl && !skipConnection) {
  console.error(
    "VALKEY_URL environment variable is not set. Background jobs may fail."
  );
}
var connectionOptions = {
  maxRetriesPerRequest: null,
  // Required by BullMQ
  enableReadyCheck: false
  // Optional: Sometimes helps with startup race conditions
};
var valkeyConnection = null;
if (valkeyUrl && !skipConnection) {
  const connectionUrl = valkeyUrl.replace(/^valkey:\/\//, "redis://");
  valkeyConnection = new import_ioredis.default(connectionUrl, connectionOptions);
  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey.");
  });
  valkeyConnection.on("error", (err) => {
    console.error("Valkey connection error:", err);
  });
} else {
  console.warn("Valkey URL not provided. Valkey connection not established.");
}
var valkey_default = valkeyConnection;

// lib/queueNames.ts
var FORECAST_QUEUE_NAME = "forecast-updates";

// lib/prisma.ts
var import_client8 = require("@prisma/client");
var import_runtime = require("@zenstackhq/runtime");

// services/repositoryCaseSync.ts
var import_client = require("@prisma/client");

// services/elasticsearchService.ts
var import_elasticsearch = require("@elastic/elasticsearch");

// env.js
var import_env_nextjs = require("@t3-oss/env-nextjs");
var import_v4 = require("zod/v4");
var env = (0, import_env_nextjs.createEnv)({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: import_v4.z.string().refine(
      (str) => !str.includes("YOUR_MYSQL_URL_HERE"),
      "You forgot to change the default URL"
    ),
    NODE_ENV: import_v4.z.enum(["development", "test", "production"]).prefault("development"),
    NEXTAUTH_SECRET: process.env.NODE_ENV === "production" ? import_v4.z.string() : import_v4.z.string().optional(),
    NEXTAUTH_URL: import_v4.z.preprocess(
      // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
      // Since NextAuth.js automatically uses the VERCEL_URL if present.
      (str) => process.env.VERCEL_URL ?? str,
      // VERCEL_URL doesn't include `https` so it cant be validated as a URL
      process.env.VERCEL ? import_v4.z.string() : import_v4.z.url()
    ),
    ELASTICSEARCH_NODE: import_v4.z.url().optional()
  },
  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },
  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    ELASTICSEARCH_NODE: process.env.ELASTICSEARCH_NODE
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true
});

// services/elasticsearchService.ts
var esClient = null;
function getElasticsearchClient() {
  if (!env.ELASTICSEARCH_NODE) {
    console.warn(
      "ELASTICSEARCH_NODE environment variable not set. Elasticsearch integration disabled."
    );
    return null;
  }
  if (!esClient) {
    try {
      esClient = new import_elasticsearch.Client({
        node: env.ELASTICSEARCH_NODE,
        // Add additional configuration as needed
        maxRetries: 3,
        requestTimeout: 3e4,
        sniffOnStart: false
        // Disable sniffing for custom ports
      });
    } catch (error) {
      console.error("Failed to initialize Elasticsearch client:", error);
      return null;
    }
  }
  return esClient;
}
var REPOSITORY_CASE_INDEX = "testplanit-repository-cases";

// services/elasticsearchIndexing.ts
async function indexRepositoryCase(caseData) {
  const client = getElasticsearchClient();
  if (!client) return false;
  try {
    const searchableContent = [
      caseData.name,
      caseData.className,
      caseData.tags?.map((t) => t.name).join(" "),
      caseData.steps?.map((s) => {
        const stepContent = `${s.step} ${s.expectedResult}`;
        return s.isSharedStep && s.sharedStepGroupName ? `${stepContent} ${s.sharedStepGroupName}` : stepContent;
      }).join(" "),
      caseData.customFields?.map((cf) => cf.value).join(" ")
    ].filter(Boolean).join(" ");
    await client.index({
      index: REPOSITORY_CASE_INDEX,
      id: caseData.id.toString(),
      document: {
        ...caseData,
        searchableContent
      }
    });
    console.log(`Indexed repository case ${caseData.id} in Elasticsearch`);
    return true;
  } catch (error) {
    console.error(`Failed to index repository case ${caseData.id}:`, error);
    return false;
  }
}
async function deleteRepositoryCase(caseId) {
  const client = getElasticsearchClient();
  if (!client) return false;
  try {
    await client.delete({
      index: REPOSITORY_CASE_INDEX,
      id: caseId.toString()
    });
    console.log(`Deleted repository case ${caseId} from Elasticsearch`);
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(
        `Repository case ${caseId} not found in Elasticsearch (already deleted)`
      );
      return true;
    }
    console.error(`Failed to delete repository case ${caseId}:`, error);
    return false;
  }
}

// utils/extractTextFromJson.ts
var extractTextFromNode = (node) => {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.text && typeof node.text === "string") return node.text;
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join("");
  }
  return "";
};

// services/unifiedElasticsearchService.ts
var ENTITY_INDICES = {
  ["repository_case" /* REPOSITORY_CASE */]: "testplanit-repository-cases",
  ["shared_step" /* SHARED_STEP */]: "testplanit-shared-steps",
  ["test_run" /* TEST_RUN */]: "testplanit-test-runs",
  ["session" /* SESSION */]: "testplanit-sessions",
  ["project" /* PROJECT */]: "testplanit-projects",
  ["issue" /* ISSUE */]: "testplanit-issues",
  ["milestone" /* MILESTONE */]: "testplanit-milestones"
};
var baseMapping = {
  properties: {
    id: { type: "integer" },
    projectId: { type: "integer" },
    projectName: { type: "keyword" },
    projectIconUrl: { type: "keyword" },
    createdAt: { type: "date" },
    updatedAt: { type: "date" },
    createdById: { type: "keyword" },
    createdByName: { type: "keyword" },
    createdByImage: { type: "keyword" },
    searchableContent: {
      type: "text",
      analyzer: "standard",
      fields: {
        keyword: {
          type: "keyword",
          ignore_above: 256
        }
      }
    },
    customFields: {
      type: "nested",
      properties: {
        fieldId: { type: "integer" },
        fieldName: { type: "keyword" },
        fieldType: { type: "keyword" },
        value: { type: "text" },
        valueKeyword: { type: "keyword" },
        valueNumeric: { type: "double" },
        valueBoolean: { type: "boolean" },
        valueDate: { type: "date" },
        valueArray: { type: "keyword" },
        fieldOption: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "keyword" },
            icon: {
              type: "object",
              properties: {
                name: { type: "keyword" }
              }
            },
            iconColor: {
              type: "object",
              properties: {
                value: { type: "keyword" }
              }
            }
          }
        },
        fieldOptions: {
          type: "nested",
          properties: {
            id: { type: "integer" },
            name: { type: "keyword" },
            icon: {
              type: "object",
              properties: {
                name: { type: "keyword" }
              }
            },
            iconColor: {
              type: "object",
              properties: {
                value: { type: "keyword" }
              }
            }
          }
        }
      }
    }
  }
};
var ENTITY_MAPPINGS = {
  ["repository_case" /* REPOSITORY_CASE */]: {
    properties: {
      ...baseMapping.properties,
      repositoryId: { type: "integer" },
      folderId: { type: "integer" },
      folderPath: { type: "keyword" },
      templateId: { type: "integer" },
      templateName: { type: "keyword" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      className: { type: "keyword" },
      source: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      estimate: { type: "integer" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      automated: { type: "boolean" },
      isArchived: { type: "boolean" },
      isDeleted: { type: "boolean" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      },
      steps: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" },
          isSharedStep: { type: "boolean" },
          sharedStepGroupId: { type: "integer" },
          sharedStepGroupName: { type: "text" }
        }
      }
    }
  },
  ["shared_step" /* SHARED_STEP */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      isDeleted: { type: "boolean" },
      items: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" }
        }
      }
    }
  },
  ["test_run" /* TEST_RUN */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      docs: { type: "text" },
      configId: { type: "integer" },
      configurationName: { type: "keyword" },
      milestoneId: { type: "integer" },
      milestoneName: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      elapsed: { type: "integer" },
      isCompleted: { type: "boolean" },
      isDeleted: { type: "boolean" },
      completedAt: { type: "date" },
      testRunType: { type: "keyword" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      }
    }
  },
  ["session" /* SESSION */]: {
    properties: {
      ...baseMapping.properties,
      templateId: { type: "integer" },
      templateName: { type: "keyword" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      mission: { type: "text" },
      configId: { type: "integer" },
      configurationName: { type: "keyword" },
      milestoneId: { type: "integer" },
      milestoneName: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      assignedToId: { type: "keyword" },
      assignedToName: { type: "keyword" },
      assignedToImage: { type: "keyword" },
      estimate: { type: "integer" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      elapsed: { type: "integer" },
      isCompleted: { type: "boolean" },
      isDeleted: { type: "boolean" },
      completedAt: { type: "date" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      }
    }
  },
  ["project" /* PROJECT */]: {
    properties: {
      id: { type: "integer" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      iconUrl: { type: "keyword" },
      note: { type: "text" },
      docs: { type: "text" },
      isDeleted: { type: "boolean" },
      createdAt: { type: "date" },
      createdById: { type: "keyword" },
      createdByName: { type: "keyword" },
      createdByImage: { type: "keyword" },
      searchableContent: { type: "text" }
    }
  },
  ["issue" /* ISSUE */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      title: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      description: { type: "text" },
      externalId: { type: "keyword" },
      note: { type: "text" },
      url: { type: "keyword" },
      issueSystem: { type: "text" },
      isDeleted: { type: "boolean" }
    }
  },
  ["milestone" /* MILESTONE */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      docs: { type: "text" },
      milestoneTypeId: { type: "integer" },
      milestoneTypeName: { type: "keyword" },
      milestoneTypeIcon: { type: "keyword" },
      parentId: { type: "integer" },
      parentName: { type: "keyword" },
      dueDate: { type: "date" },
      isCompleted: { type: "boolean" },
      completedAt: { type: "date" },
      isDeleted: { type: "boolean" }
    }
  }
};
function transformCustomFieldValue(fieldType, value) {
  const base = {};
  switch (fieldType) {
    case "Checkbox":
      base.valueBoolean = Boolean(value);
      base.value = String(value);
      break;
    case "Date":
      if (value) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          base.valueDate = date.toISOString();
          base.value = date.toISOString();
        }
      }
      break;
    case "Number":
      base.valueNumeric = Number(value);
      base.value = String(value);
      break;
    case "Multi-Select":
      if (Array.isArray(value)) {
        base.valueArray = value.map((v) => String(v));
        base.value = value.join(" ");
      } else if (value) {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            base.valueArray = parsed.map((v) => String(v));
            base.value = parsed.join(" ");
          }
        } catch {
          base.value = String(value);
        }
      }
      break;
    case "Select":
      base.valueKeyword = String(value);
      base.value = String(value);
      break;
    case "Text String":
    case "Link":
      base.valueKeyword = String(value);
      base.value = String(value);
      break;
    case "Text Long":
      if (value) {
        try {
          const content = typeof value === "string" ? JSON.parse(value) : value;
          const textContent = extractTextFromTipTap(content);
          base.value = textContent;
        } catch {
          base.value = String(value);
        }
      }
      break;
    case "Steps":
      if (value) {
        base.value = String(value);
      }
      break;
    default:
      base.value = String(value);
  }
  return base;
}
function extractTextFromTipTap(content) {
  if (!content || !content.content) return "";
  let text = "";
  function extractFromNode(node) {
    if (node.text) {
      text += node.text + " ";
    }
    if (node.content) {
      node.content.forEach(extractFromNode);
    }
  }
  content.content.forEach(extractFromNode);
  return text.trim();
}
function buildCustomFieldDocuments(fieldValues) {
  return fieldValues.map((cfv) => {
    const fieldType = cfv.field.type?.type || cfv.field.systemName;
    const transformed = transformCustomFieldValue(fieldType, cfv.value);
    const doc = {
      fieldId: cfv.fieldId,
      fieldName: cfv.field.displayName,
      fieldType,
      ...transformed
    };
    if (cfv.value && cfv.field.fieldOptions && (fieldType === "Select" || fieldType === "Dropdown")) {
      const selectedOption = cfv.field.fieldOptions.find(
        (fo) => fo.fieldOption.id === cfv.value
      );
      if (selectedOption) {
        doc.fieldOption = {
          id: selectedOption.fieldOption.id,
          name: selectedOption.fieldOption.name,
          icon: selectedOption.fieldOption.icon,
          iconColor: selectedOption.fieldOption.iconColor
        };
      }
    }
    if (cfv.field.fieldOptions && fieldType === "Multi-Select") {
      doc.fieldOptions = cfv.field.fieldOptions.map((fo) => ({
        id: fo.fieldOption.id,
        name: fo.fieldOption.name,
        icon: fo.fieldOption.icon,
        iconColor: fo.fieldOption.iconColor
      }));
    }
    return doc;
  });
}

// services/repositoryCaseSync.ts
var prisma = new import_client.PrismaClient();
function extractStepText(stepData) {
  if (!stepData) return "";
  try {
    if (typeof stepData === "string") {
      const parsed = JSON.parse(stepData);
      return extractTextFromNode(parsed);
    }
    return extractTextFromNode(stepData);
  } catch (error) {
    return typeof stepData === "string" ? stepData : "";
  }
}
async function buildRepositoryCaseDocument(caseId) {
  const repoCase = await prisma.repositoryCases.findUnique({
    where: { id: caseId },
    include: {
      project: true,
      folder: true,
      template: true,
      state: {
        include: {
          icon: true,
          color: true
        }
      },
      creator: true,
      tags: true,
      steps: {
        orderBy: { order: "asc" },
        include: {
          sharedStepGroup: {
            include: {
              items: {
                orderBy: { order: "asc" }
              }
            }
          }
        }
      },
      caseFieldValues: {
        include: {
          field: {
            include: {
              type: true,
              fieldOptions: {
                include: {
                  fieldOption: {
                    include: {
                      icon: true,
                      iconColor: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
  if (!repoCase) return null;
  const folderPath = await buildFolderPath(repoCase.folderId);
  return {
    id: repoCase.id,
    projectId: repoCase.projectId,
    projectName: repoCase.project.name,
    projectIconUrl: repoCase.project.iconUrl,
    repositoryId: repoCase.repositoryId,
    folderId: repoCase.folderId,
    folderPath,
    templateId: repoCase.templateId,
    templateName: repoCase.template.templateName,
    name: repoCase.name,
    className: repoCase.className,
    source: repoCase.source,
    stateId: repoCase.stateId,
    stateName: repoCase.state.name,
    stateIcon: repoCase.state.icon.name,
    stateColor: repoCase.state.color.value,
    estimate: repoCase.estimate,
    forecastManual: repoCase.forecastManual,
    forecastAutomated: repoCase.forecastAutomated,
    automated: repoCase.automated,
    isArchived: repoCase.isArchived,
    isDeleted: repoCase.isDeleted,
    createdAt: repoCase.createdAt,
    creatorId: repoCase.creatorId,
    creatorName: repoCase.creator.name,
    creatorImage: repoCase.creator.image,
    tags: repoCase.tags.map((tag) => ({
      id: tag.id,
      name: tag.name
    })),
    customFields: buildCustomFieldDocuments(
      repoCase.caseFieldValues.map((cfv) => ({
        fieldId: cfv.fieldId,
        field: {
          displayName: cfv.field.displayName,
          systemName: cfv.field.systemName,
          type: cfv.field.type ? { type: cfv.field.type.type } : void 0,
          fieldOptions: cfv.field.fieldOptions?.map((fo) => ({
            fieldOption: {
              id: fo.fieldOption.id,
              name: fo.fieldOption.name,
              icon: fo.fieldOption.icon ? { name: fo.fieldOption.icon.name } : void 0,
              iconColor: fo.fieldOption.iconColor ? { value: fo.fieldOption.iconColor.value } : void 0
            }
          }))
        },
        value: cfv.value
      }))
    ).filter(
      (cf) => cf.value !== null && cf.value !== void 0 && cf.value !== ""
    ).map((cf) => ({
      fieldId: cf.fieldId,
      fieldName: cf.fieldName,
      fieldType: cf.fieldType,
      value: cf.value || ""
      // Ensure value is always present
    })),
    steps: repoCase.steps.flatMap((step) => {
      if (step.sharedStepGroupId && step.sharedStepGroup) {
        return step.sharedStepGroup.items.map((item, index) => ({
          id: step.id * 1e3 + index,
          // Generate unique ID for each shared step item
          order: step.order,
          step: extractStepText(item.step),
          expectedResult: extractStepText(item.expectedResult),
          isSharedStep: true,
          sharedStepGroupId: step.sharedStepGroupId,
          sharedStepGroupName: step.sharedStepGroup?.name
        }));
      }
      return [
        {
          id: step.id,
          order: step.order,
          step: extractStepText(step.step),
          expectedResult: extractStepText(step.expectedResult),
          isSharedStep: false,
          sharedStepGroupId: void 0,
          sharedStepGroupName: void 0
        }
      ];
    })
  };
}
async function buildFolderPath(folderId) {
  const folder = await prisma.repositoryFolders.findUnique({
    where: { id: folderId },
    include: { parent: true }
  });
  if (!folder) return "/";
  const path = [folder.name];
  let current = folder;
  while (current.parent) {
    path.unshift(current.parent.name);
    const nextParent = await prisma.repositoryFolders.findUnique({
      where: { id: current.parent.id },
      include: { parent: true }
    });
    if (!nextParent) break;
    current = nextParent;
  }
  return "/" + path.join("/");
}
async function syncRepositoryCaseToElasticsearch(caseId) {
  const doc = await buildRepositoryCaseDocument(caseId);
  if (!doc) {
    await deleteRepositoryCase(caseId);
    return true;
  }
  if (doc.isArchived) {
    await deleteRepositoryCase(caseId);
    return true;
  }
  return await indexRepositoryCase(doc);
}

// services/testRunSearch.ts
var import_client2 = require("@prisma/client");
var prisma2 = new import_client2.PrismaClient();
async function indexTestRun(testRun) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const searchableContent = [
    testRun.name,
    testRun.note ? extractTextFromNode(testRun.note) : "",
    testRun.docs ? extractTextFromNode(testRun.docs) : "",
    testRun.tags.map((t) => t.name).join(" ")
  ].join(" ");
  const document = {
    id: testRun.id,
    projectId: testRun.projectId,
    projectName: testRun.project.name,
    name: testRun.name,
    note: testRun.note,
    docs: testRun.docs,
    configId: testRun.configId,
    configurationName: testRun.configuration?.name,
    milestoneId: testRun.milestoneId,
    milestoneName: testRun.milestone?.name,
    stateId: testRun.stateId,
    stateName: testRun.state.name,
    forecastManual: testRun.forecastManual,
    forecastAutomated: testRun.forecastAutomated,
    elapsed: testRun.elapsed,
    isCompleted: testRun.isCompleted,
    isDeleted: testRun.isDeleted,
    completedAt: testRun.completedAt,
    testRunType: testRun.testRunType,
    createdAt: testRun.createdAt,
    createdById: testRun.createdById,
    createdByName: testRun.createdBy.name,
    tags: testRun.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    searchableContent
  };
  await client.index({
    index: ENTITY_INDICES["test_run" /* TEST_RUN */],
    id: testRun.id.toString(),
    document,
    refresh: true
  });
}
async function syncTestRunToElasticsearch(testRunId) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const testRun = await prisma2.testRuns.findUnique({
      where: { id: testRunId },
      include: {
        project: true,
        createdBy: true,
        state: true,
        configuration: true,
        milestone: true,
        tags: true
      }
    });
    if (!testRun) {
      console.warn(`Test run ${testRunId} not found`);
      return false;
    }
    await indexTestRun(testRun);
    return true;
  } catch (error) {
    console.error(`Failed to sync test run ${testRunId}:`, error);
    return false;
  }
}

// services/sessionSearch.ts
var import_client3 = require("@prisma/client");
var prisma3 = new import_client3.PrismaClient();
async function indexSession(session) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const searchableContent = [
    session.name,
    session.note ? extractTextFromNode(session.note) : "",
    session.mission ? extractTextFromNode(session.mission) : "",
    session.tags.map((t) => t.name).join(" ")
  ].join(" ");
  const document = {
    id: session.id,
    projectId: session.projectId,
    projectName: session.project.name,
    templateId: session.templateId,
    templateName: session.template.templateName,
    name: session.name,
    note: session.note,
    mission: session.mission,
    configId: session.configId,
    configurationName: session.configuration?.name,
    milestoneId: session.milestoneId,
    milestoneName: session.milestone?.name,
    stateId: session.stateId,
    stateName: session.state.name,
    assignedToId: session.assignedToId,
    assignedToName: session.assignedTo?.name,
    estimate: session.estimate,
    forecastManual: session.forecastManual,
    forecastAutomated: session.forecastAutomated,
    elapsed: session.elapsed,
    isCompleted: session.isCompleted,
    isDeleted: session.isDeleted,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    createdById: session.createdById,
    createdByName: session.createdBy.name,
    tags: session.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    searchableContent
  };
  await client.index({
    index: ENTITY_INDICES["session" /* SESSION */],
    id: session.id.toString(),
    document,
    refresh: true
  });
}
async function syncSessionToElasticsearch(sessionId) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const session = await prisma3.sessions.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
        createdBy: true,
        assignedTo: true,
        state: true,
        template: true,
        configuration: true,
        milestone: true,
        tags: true
      }
    });
    if (!session) {
      console.warn(`Session ${sessionId} not found`);
      return false;
    }
    await indexSession(session);
    return true;
  } catch (error) {
    console.error(`Failed to sync session ${sessionId}:`, error);
    return false;
  }
}

// services/sharedStepSearch.ts
var import_client4 = require("@prisma/client");
var prisma4 = new import_client4.PrismaClient();
async function buildSharedStepDocument(stepGroupId) {
  const stepGroup = await prisma4.sharedStepGroup.findUnique({
    where: { id: stepGroupId },
    include: {
      project: true,
      createdBy: true,
      items: {
        orderBy: { order: "asc" }
      }
    }
  });
  if (!stepGroup) return null;
  const searchableContent = [
    stepGroup.name,
    ...stepGroup.items.map((item) => {
      let stepText = "";
      let expectedResultText = "";
      if (typeof item.step === "string") {
        try {
          const parsed = JSON.parse(item.step);
          stepText = extractTextFromNode(parsed);
        } catch {
          stepText = item.step;
        }
      } else if (item.step) {
        stepText = extractTextFromNode(item.step);
      }
      if (typeof item.expectedResult === "string") {
        try {
          const parsed = JSON.parse(item.expectedResult);
          expectedResultText = extractTextFromNode(parsed);
        } catch {
          expectedResultText = item.expectedResult;
        }
      } else if (item.expectedResult) {
        expectedResultText = extractTextFromNode(item.expectedResult);
      }
      return `${stepText} ${expectedResultText}`;
    })
  ].join(" ");
  return {
    id: stepGroup.id,
    name: stepGroup.name,
    projectId: stepGroup.projectId,
    projectName: stepGroup.project.name,
    projectIconUrl: stepGroup.project.iconUrl,
    createdAt: stepGroup.createdAt,
    createdById: stepGroup.createdById,
    createdByName: stepGroup.createdBy.name,
    createdByImage: stepGroup.createdBy.image,
    isDeleted: stepGroup.isDeleted,
    items: stepGroup.items.map((item) => ({
      id: item.id,
      order: item.order,
      step: typeof item.step === "object" ? JSON.stringify(item.step) : String(item.step),
      expectedResult: typeof item.expectedResult === "object" ? JSON.stringify(item.expectedResult) : String(item.expectedResult)
    })),
    searchableContent
  };
}
async function indexSharedStep(stepData) {
  const client = getElasticsearchClient();
  if (!client) return false;
  try {
    await client.index({
      index: ENTITY_INDICES["shared_step" /* SHARED_STEP */],
      id: stepData.id.toString(),
      document: stepData
    });
    console.log(`Indexed shared step ${stepData.id} in Elasticsearch`);
    return true;
  } catch (error) {
    console.error(`Failed to index shared step ${stepData.id}:`, error);
    return false;
  }
}
async function syncSharedStepToElasticsearch(stepId) {
  const doc = await buildSharedStepDocument(stepId);
  if (!doc) return false;
  return await indexSharedStep(doc);
}

// services/issueSearch.ts
var import_client5 = require("@prisma/client");
var prisma5 = new import_client5.PrismaClient();
function getProjectFromIssue(issue) {
  if (issue.project) {
    return issue.project;
  }
  if (issue.repositoryCases?.[0]?.project) {
    return issue.repositoryCases[0].project;
  }
  if (issue.sessions?.[0]?.project) {
    return issue.sessions[0].project;
  }
  if (issue.testRuns?.[0]?.project) {
    return issue.testRuns[0].project;
  }
  if (issue.sessionResults?.[0]?.session?.project) {
    return issue.sessionResults[0].session.project;
  }
  if (issue.testRunResults?.[0]?.testRun?.project) {
    return issue.testRunResults[0].testRun.project;
  }
  if (issue.testRunStepResults?.[0]?.testRunResult?.testRun?.project) {
    return issue.testRunStepResults[0].testRunResult.testRun.project;
  }
  return null;
}
async function indexIssue(issue) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const projectInfo = getProjectFromIssue(issue);
  if (!projectInfo) {
    console.warn(`Issue ${issue.id} (${issue.name}) has no linked project, skipping indexing`);
    return;
  }
  const searchableContent = [
    issue.name,
    issue.title,
    issue.description || "",
    issue.externalId || "",
    issue.note ? extractTextFromNode(issue.note) : "",
    issue.integration?.name || ""
  ].join(" ");
  const document = {
    id: issue.id,
    projectId: projectInfo.id,
    projectName: projectInfo.name,
    projectIconUrl: projectInfo.iconUrl,
    name: issue.name,
    title: issue.title,
    description: issue.description,
    externalId: issue.externalId,
    note: issue.note,
    url: issue.data?.url,
    issueSystem: issue.integration?.name || "Unknown",
    isDeleted: issue.isDeleted,
    createdAt: issue.createdAt,
    createdById: issue.createdById,
    createdByName: issue.createdBy.name,
    createdByImage: issue.createdBy.image,
    searchableContent
  };
  await client.index({
    index: ENTITY_INDICES["issue" /* ISSUE */],
    id: issue.id.toString(),
    document,
    refresh: true
  });
}
async function syncIssueToElasticsearch(issueId) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const issue = await prisma5.issue.findUnique({
      where: { id: issueId },
      include: {
        createdBy: true,
        integration: true,
        // Include direct project relationship (preferred)
        project: true,
        // Fallback: Check all possible relationships to find project
        repositoryCases: {
          take: 1,
          include: {
            project: true
          }
        },
        sessions: {
          take: 1,
          include: {
            project: true
          }
        },
        testRuns: {
          take: 1,
          include: {
            project: true
          }
        },
        sessionResults: {
          take: 1,
          include: {
            session: {
              include: {
                project: true
              }
            }
          }
        },
        testRunResults: {
          take: 1,
          include: {
            testRun: {
              include: {
                project: true
              }
            }
          }
        },
        testRunStepResults: {
          take: 1,
          include: {
            testRunResult: {
              include: {
                testRun: {
                  include: {
                    project: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!issue) {
      console.warn(`Issue ${issueId} not found`);
      return false;
    }
    await indexIssue(issue);
    return true;
  } catch (error) {
    console.error(`Failed to sync issue ${issueId}:`, error);
    return false;
  }
}

// services/milestoneSearch.ts
var import_client6 = require("@prisma/client");
var prisma6 = new import_client6.PrismaClient();
async function indexMilestone(milestone) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const searchableContent = [
    milestone.name,
    milestone.note ? extractTextFromNode(milestone.note) : "",
    milestone.docs ? extractTextFromNode(milestone.docs) : ""
  ].join(" ");
  const document = {
    id: milestone.id,
    projectId: milestone.projectId,
    projectName: milestone.project.name,
    projectIconUrl: milestone.project.iconUrl,
    name: milestone.name,
    note: milestone.note,
    docs: milestone.docs,
    milestoneTypeId: milestone.milestoneTypesId,
    milestoneTypeName: milestone.milestoneType.name,
    milestoneTypeIcon: milestone.milestoneType.icon?.name,
    parentId: milestone.parentId,
    parentName: milestone.parent?.name,
    isCompleted: milestone.isCompleted,
    completedAt: milestone.completedAt,
    isDeleted: milestone.isDeleted,
    createdAt: milestone.createdAt,
    createdById: milestone.createdBy,
    createdByName: milestone.creator.name,
    createdByImage: milestone.creator.image,
    searchableContent
  };
  await client.index({
    index: ENTITY_INDICES["milestone" /* MILESTONE */],
    id: milestone.id.toString(),
    document,
    refresh: true
  });
}
async function syncMilestoneToElasticsearch(milestoneId) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const milestone = await prisma6.milestones.findUnique({
      where: { id: milestoneId },
      include: {
        project: true,
        creator: true,
        milestoneType: {
          include: {
            icon: true
          }
        },
        parent: true
      }
    });
    if (!milestone) {
      console.warn(`Milestone ${milestoneId} not found`);
      return false;
    }
    await indexMilestone(milestone);
    return true;
  } catch (error) {
    console.error(`Failed to sync milestone ${milestoneId}:`, error);
    return false;
  }
}

// services/projectSearch.ts
var import_client7 = require("@prisma/client");
var prisma7 = new import_client7.PrismaClient();
async function indexProject(project) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const searchableContent = [
    project.name,
    project.note ? extractTextFromNode(project.note) : "",
    project.docs ? extractTextFromNode(project.docs) : ""
  ].join(" ");
  const document = {
    id: project.id,
    name: project.name,
    iconUrl: project.iconUrl,
    note: project.note,
    docs: project.docs,
    isDeleted: project.isDeleted,
    createdAt: project.createdAt,
    createdById: project.createdBy,
    createdByName: project.creator.name,
    createdByImage: project.creator.image,
    searchableContent
  };
  await client.index({
    index: ENTITY_INDICES["project" /* PROJECT */],
    id: project.id.toString(),
    document,
    refresh: true
  });
}
async function syncProjectToElasticsearch(projectId) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const project = await prisma7.projects.findUnique({
      where: { id: projectId },
      include: {
        creator: true
      }
    });
    if (!project) {
      console.warn(`Project ${projectId} not found`);
      return false;
    }
    await indexProject(project);
    return true;
  } catch (error) {
    console.error(`Failed to sync project ${projectId}:`, error);
    return false;
  }
}

// lib/prisma.ts
var prismaClient;
var dbClient;
function createPrismaClient(errorFormat) {
  const baseClient = new import_client8.PrismaClient({ errorFormat });
  const client = baseClient.$extends({
    query: {
      repositoryCases: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch after delete:`, error);
            });
          }
          return result;
        }
      },
      testRuns: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync test run ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync test run ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      },
      sessions: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      },
      sharedStepGroups: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync shared step ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync shared step ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      },
      issues: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync issue ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync issue ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      },
      milestones: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync milestone ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync milestone ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      },
      projects: {
        async create({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync project ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error) => {
              console.error(`Failed to sync project ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        }
      }
    }
  });
  return client;
}
if (process.env.NODE_ENV === "production") {
  prismaClient = createPrismaClient("pretty");
  dbClient = (0, import_runtime.enhance)(prismaClient);
} else {
  if (!global.prisma) {
    global.prisma = createPrismaClient("colorless");
    global.db = (0, import_runtime.enhance)(global.prisma);
  }
  prismaClient = global.prisma;
  dbClient = global.db;
}
var prisma8 = prismaClient;

// services/forecastService.ts
async function updateRepositoryCaseForecast(repositoryCaseId, options = {}) {
  if (process.env.DEBUG_FORECAST) {
    console.log(
      `Calculating group forecast for RepositoryCase ID: ${repositoryCaseId}`
    );
  }
  try {
    const caseAndLinks = await prisma8.repositoryCases.findUnique({
      where: { id: repositoryCaseId },
      select: {
        id: true,
        source: true,
        linksFrom: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseBId: true }
        },
        linksTo: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseAId: true }
        }
      }
    });
    if (!caseAndLinks) return { updatedCaseIds: [], affectedTestRunIds: [] };
    const linkedIds = [
      caseAndLinks.id,
      ...caseAndLinks.linksFrom.map((l) => l.caseBId),
      ...caseAndLinks.linksTo.map((l) => l.caseAId)
    ];
    const uniqueCaseIds = Array.from(new Set(linkedIds));
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] Group case IDs:", uniqueCaseIds);
    const allCases = await prisma8.repositoryCases.findMany({
      where: { id: { in: uniqueCaseIds } },
      select: { id: true, source: true }
    });
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] allCases:", allCases);
    const manualCaseIds = allCases.filter((c) => c.source === "MANUAL").map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualCaseIds:", manualCaseIds);
    let manualResults = [];
    if (manualCaseIds.length) {
      const testRunCases = await prisma8.testRunCases.findMany({
        where: { repositoryCaseId: { in: manualCaseIds } },
        select: { id: true }
      });
      const testRunCaseIds = testRunCases.map((trc) => trc.id);
      manualResults = testRunCaseIds.length ? await prisma8.testRunResults.findMany({
        where: {
          testRunCaseId: { in: testRunCaseIds },
          isDeleted: false,
          elapsed: { gt: 0 }
        },
        select: { elapsed: true }
      }) : [];
    }
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualResults:", manualResults);
    const manualDurations = manualResults.map((r) => r.elapsed).filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualDurations:", manualDurations);
    const junitCaseIds = allCases.filter((c) => c.source === "JUNIT").map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitCaseIds:", junitCaseIds);
    const junitResults = junitCaseIds.length ? await prisma8.jUnitTestResult.findMany({
      where: {
        repositoryCaseId: { in: junitCaseIds },
        time: { gt: 0 }
      },
      select: { time: true }
    }) : [];
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitResults:", junitResults);
    const junitDurations = junitResults.map((r) => r.time).filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitDurations:", junitDurations);
    const avgManual = manualDurations.length > 0 ? Math.round(
      manualDurations.reduce((a, b) => a + b, 0) / manualDurations.length
    ) : null;
    const avgJunit = junitDurations.length > 0 ? parseFloat(
      (junitDurations.reduce((a, b) => a + b, 0) / junitDurations.length).toFixed(3)
    ) : null;
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] avgManual:", avgManual, "avgJunit:", avgJunit);
    for (const caseId of uniqueCaseIds) {
      await prisma8.repositoryCases.update({
        where: { id: caseId },
        data: {
          forecastManual: avgManual,
          forecastAutomated: avgJunit
        }
      });
    }
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Updated forecastManual=${avgManual}, forecastAutomated=${avgJunit} for cases: [${uniqueCaseIds.join(", ")}]`
      );
    }
    const affectedTestRunCases = await prisma8.testRunCases.findMany({
      where: {
        repositoryCaseId: { in: uniqueCaseIds }
      },
      select: {
        testRunId: true
      }
    });
    const uniqueAffectedTestRunIds = Array.from(
      new Set(affectedTestRunCases.map((trc) => trc.testRunId))
    );
    if (!options.skipTestRunUpdate && uniqueAffectedTestRunIds.length > 0) {
      for (const testRunId of uniqueAffectedTestRunIds) {
        await updateTestRunForecast(testRunId, {
          alreadyRefreshedCaseIds: new Set(uniqueCaseIds)
        });
      }
    }
    return {
      updatedCaseIds: uniqueCaseIds,
      affectedTestRunIds: options.collectAffectedTestRuns ? uniqueAffectedTestRunIds : []
    };
  } catch (error) {
    console.error(
      `Error updating group forecast for RepositoryCase ID ${repositoryCaseId}:`,
      error
    );
    throw error;
  }
}
async function updateTestRunForecast(testRunId, options = {}) {
  if (process.env.DEBUG_FORECAST) console.log(`Updating forecast for TestRun ID: ${testRunId}`);
  try {
    let testRunCasesWithDetails = await prisma8.testRunCases.findMany({
      where: { testRunId },
      select: {
        repositoryCaseId: true,
        status: {
          select: {
            systemName: true
          }
        }
      }
    });
    if (testRunCasesWithDetails.length > 0) {
      const processedCaseIds = new Set(
        options.alreadyRefreshedCaseIds ? Array.from(options.alreadyRefreshedCaseIds) : []
      );
      const repositoryCaseIdsInRun = Array.from(
        new Set(testRunCasesWithDetails.map((trc) => trc.repositoryCaseId))
      );
      let refreshedAnyCase = false;
      for (const repositoryCaseId of repositoryCaseIdsInRun) {
        if (processedCaseIds.has(repositoryCaseId)) {
          continue;
        }
        const result = await updateRepositoryCaseForecast(
          repositoryCaseId,
          { skipTestRunUpdate: true }
        );
        if (result.updatedCaseIds.length > 0) {
          refreshedAnyCase = true;
          for (const refreshedId of result.updatedCaseIds) {
            processedCaseIds.add(refreshedId);
          }
        }
      }
      if (refreshedAnyCase) {
        testRunCasesWithDetails = await prisma8.testRunCases.findMany({
          where: { testRunId },
          select: {
            repositoryCaseId: true,
            status: {
              select: {
                systemName: true
              }
            }
          }
        });
      }
    }
    const repositoryCaseIdsToForecast = testRunCasesWithDetails.filter(
      (trc) => trc.status === null || trc.status?.systemName === "UNTESTED"
    ).map((trc) => trc.repositoryCaseId);
    if (!repositoryCaseIdsToForecast.length) {
      await prisma8.testRuns.update({
        where: { id: testRunId },
        data: {
          forecastManual: null,
          forecastAutomated: null
        }
      });
      if (process.env.DEBUG_FORECAST) {
        console.log(
          `Cleared forecasts for TestRun ID: ${testRunId} as no pending/untested cases were found`
        );
      }
      return;
    }
    const repositoryCases = await prisma8.repositoryCases.findMany({
      where: { id: { in: repositoryCaseIdsToForecast } },
      select: { forecastManual: true, forecastAutomated: true }
    });
    let totalForecastManual = 0;
    let totalForecastAutomated = 0;
    let hasManual = false;
    let hasAutomated = false;
    for (const rc of repositoryCases) {
      if (rc.forecastManual !== null) {
        totalForecastManual += rc.forecastManual;
        hasManual = true;
      }
      if (rc.forecastAutomated !== null) {
        totalForecastAutomated += rc.forecastAutomated;
        hasAutomated = true;
      }
    }
    await prisma8.testRuns.update({
      where: { id: testRunId },
      data: {
        forecastManual: hasManual ? totalForecastManual : null,
        forecastAutomated: hasAutomated ? parseFloat(totalForecastAutomated.toFixed(3)) : null
      }
    });
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Updated TestRun ID ${testRunId} with forecastManual=${totalForecastManual}, forecastAutomated=${totalForecastAutomated}`
      );
    }
  } catch (error) {
    console.error(
      `Error updating forecast for TestRun ID ${testRunId}:`,
      error
    );
    throw error;
  }
}
async function getUniqueCaseGroupIds() {
  if (process.env.DEBUG_FORECAST) console.log("Fetching unique case group representatives...");
  try {
    const BATCH_SIZE = 1e3;
    const processedCaseIds = /* @__PURE__ */ new Set();
    const uniqueRepresentatives = [];
    const allCaseIds = await prisma8.repositoryCases.findMany({
      where: {
        isDeleted: false,
        isArchived: false
      },
      select: {
        id: true
      }
    });
    const totalCases = allCaseIds.length;
    if (process.env.DEBUG_FORECAST) console.log(`Processing ${totalCases} active cases in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < allCaseIds.length; i += BATCH_SIZE) {
      const batchIds = allCaseIds.slice(i, i + BATCH_SIZE).map((c) => c.id);
      const casesWithLinks = await prisma8.repositoryCases.findMany({
        where: {
          id: { in: batchIds }
        },
        select: {
          id: true,
          linksFrom: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseBId: true }
          },
          linksTo: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseAId: true }
          }
        }
      });
      for (const caseData of casesWithLinks) {
        if (processedCaseIds.has(caseData.id)) {
          continue;
        }
        uniqueRepresentatives.push(caseData.id);
        const linkedIds = [
          caseData.id,
          ...caseData.linksFrom.map((l) => l.caseBId),
          ...caseData.linksTo.map((l) => l.caseAId)
        ];
        for (const linkedId of linkedIds) {
          processedCaseIds.add(linkedId);
        }
      }
      if (process.env.DEBUG_FORECAST) {
        console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalCases / BATCH_SIZE)}: ${uniqueRepresentatives.length} unique groups so far`);
      }
    }
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Found ${uniqueRepresentatives.length} unique case groups (from ${totalCases} total active cases)`
      );
    }
    return uniqueRepresentatives;
  } catch (error) {
    console.error("Error fetching unique case group IDs:", error);
    throw error;
  }
}

// workers/forecastWorker.ts
var import_node_url = require("node:url");
var import_meta = {};
var JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
var JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
var processor = async (job) => {
  console.log(`Processing job ${job.id} of type ${job.name}`);
  let successCount = 0;
  let failCount = 0;
  switch (job.name) {
    case JOB_UPDATE_SINGLE_CASE:
      const singleData = job.data;
      if (!singleData || typeof singleData.repositoryCaseId !== "number") {
        throw new Error(
          `Invalid data for job ${job.id}: repositoryCaseId missing or not a number.`
        );
      }
      try {
        await updateRepositoryCaseForecast(singleData.repositoryCaseId);
        successCount = 1;
        console.log(
          `Job ${job.id} completed: Updated forecast for case ${singleData.repositoryCaseId}`
        );
      } catch (error) {
        failCount = 1;
        console.error(
          `Job ${job.id} failed for case ${singleData.repositoryCaseId}`,
          error
        );
        throw error;
      }
      break;
    case JOB_UPDATE_ALL_CASES:
      console.log(`Job ${job.id}: Starting update for all active cases.`);
      successCount = 0;
      failCount = 0;
      const caseIds = await getUniqueCaseGroupIds();
      const affectedTestRunIds = /* @__PURE__ */ new Set();
      for (const caseId of caseIds) {
        try {
          const result = await updateRepositoryCaseForecast(caseId, {
            skipTestRunUpdate: true,
            collectAffectedTestRuns: true
          });
          for (const testRunId of result.affectedTestRunIds) {
            affectedTestRunIds.add(testRunId);
          }
          successCount++;
        } catch (error) {
          console.error(
            `Job ${job.id}: Failed to update forecast for case ${caseId}`,
            error
          );
          failCount++;
        }
      }
      console.log(
        `Job ${job.id}: Processed ${caseIds.length} unique case groups. Success: ${successCount}, Failed: ${failCount}`
      );
      console.log(
        `Job ${job.id}: Filtering ${affectedTestRunIds.size} affected test runs...`
      );
      const activeTestRuns = await prisma8.testRuns.findMany({
        where: {
          id: { in: Array.from(affectedTestRunIds) },
          isCompleted: false
        },
        select: { id: true }
      });
      const activeTestRunIds = activeTestRuns.map((tr) => tr.id);
      const skippedCompletedCount = affectedTestRunIds.size - activeTestRunIds.length;
      console.log(
        `Job ${job.id}: Updating ${activeTestRunIds.length} active test runs (skipped ${skippedCompletedCount} completed)...`
      );
      let testRunSuccessCount = 0;
      let testRunFailCount = 0;
      for (const testRunId of activeTestRunIds) {
        try {
          await updateTestRunForecast(testRunId);
          testRunSuccessCount++;
        } catch (error) {
          console.error(
            `Job ${job.id}: Failed to update forecast for test run ${testRunId}`,
            error
          );
          testRunFailCount++;
        }
      }
      console.log(
        `Job ${job.id} completed: Updated ${testRunSuccessCount} test runs. Failed: ${testRunFailCount}. Skipped ${skippedCompletedCount} completed.`
      );
      if (failCount > 0 || testRunFailCount > 0) {
        console.warn(
          `Job ${job.id} finished with ${failCount} case failures and ${testRunFailCount} test run failures.`
        );
      }
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
  return { status: "completed", successCount, failCount };
};
async function startWorker() {
  if (valkey_default) {
    const worker = new import_bullmq.Worker(FORECAST_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 1e3
      }
    });
    worker.on("completed", (job, result) => {
      console.info(
        `Worker: Job ${job.id} (${job.name}) completed successfully. Result:`,
        result
      );
    });
    worker.on("failed", (job, err) => {
      console.error(
        `Worker: Job ${job?.id} (${job?.name}) failed with error:`,
        err
      );
    });
    worker.on("error", (err) => {
      console.error("Worker encountered an error:", err);
    });
    console.log("Forecast worker started and listening for jobs...");
    const shutdown = async () => {
      console.log("Shutting down forecast worker...");
      await worker.close();
      console.log("Forecast worker shut down gracefully.");
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    console.warn(
      "Valkey connection not available. Forecast worker cannot start."
    );
    process.exit(1);
  }
}
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || typeof import_meta === "undefined" || import_meta.url === void 0) {
  startWorker().catch((err) => {
    console.error("Failed to start worker:", err);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE
});
//# sourceMappingURL=forecastWorker.js.map
