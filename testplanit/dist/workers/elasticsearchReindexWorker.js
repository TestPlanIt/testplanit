"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// lib/prismaBase.ts
var prismaBase_exports = {};
__export(prismaBase_exports, {
  prisma: () => prisma
});
var import_client, prismaClient, prisma;
var init_prismaBase = __esm({
  "lib/prismaBase.ts"() {
    "use strict";
    import_client = require("@prisma/client");
    if (process.env.NODE_ENV === "production") {
      prismaClient = new import_client.PrismaClient({
        errorFormat: "pretty"
      });
    } else {
      if (!global.prismaBase) {
        global.prismaBase = new import_client.PrismaClient({
          errorFormat: "colorless"
        });
      }
      prismaClient = global.prismaBase;
    }
    prisma = prismaClient;
  }
});

// workers/elasticsearchReindexWorker.ts
var elasticsearchReindexWorker_exports = {};
__export(elasticsearchReindexWorker_exports, {
  default: () => elasticsearchReindexWorker_default
});
module.exports = __toCommonJS(elasticsearchReindexWorker_exports);
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
var ELASTICSEARCH_REINDEX_QUEUE_NAME = "elasticsearch-reindex";

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
init_prismaBase();
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
var repositoryCaseMapping = {
  properties: {
    id: { type: "integer" },
    projectId: { type: "integer" },
    projectName: { type: "keyword" },
    projectIconUrl: { type: "keyword" },
    repositoryId: { type: "integer" },
    folderId: { type: "integer" },
    folderPath: { type: "keyword" },
    templateId: { type: "integer" },
    templateName: { type: "keyword" },
    name: {
      type: "text",
      analyzer: "standard",
      fields: {
        keyword: { type: "keyword" },
        suggest: { type: "completion" }
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
    createdAt: { type: "date" },
    creatorId: { type: "keyword" },
    creatorName: { type: "text" },
    tags: {
      type: "nested",
      properties: {
        id: { type: "integer" },
        name: { type: "keyword" }
      }
    },
    customFields: {
      type: "nested",
      properties: {
        fieldId: { type: "integer" },
        fieldName: { type: "keyword" },
        fieldType: { type: "keyword" },
        value: { type: "text" }
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
    },
    // Full-text search field combining multiple fields
    searchableContent: { type: "text" }
  }
};
async function getElasticsearchSettings(prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  try {
    const config = await prisma2.appConfig.findUnique({
      where: { key: "elasticsearch_replicas" }
    });
    return {
      numberOfReplicas: config?.value ? config.value : 0
    };
  } catch (error) {
    console.warn("Failed to get Elasticsearch settings from database, using defaults:", error);
    return { numberOfReplicas: 0 };
  }
}
async function createRepositoryCaseIndex(prismaClient2) {
  const client = getElasticsearchClient();
  if (!client) return false;
  try {
    const settings = await getElasticsearchSettings(prismaClient2);
    const exists = await client.indices.exists({
      index: REPOSITORY_CASE_INDEX
    });
    if (!exists) {
      await client.indices.create({
        index: REPOSITORY_CASE_INDEX,
        settings: {
          number_of_shards: 1,
          number_of_replicas: settings.numberOfReplicas,
          analysis: {
            analyzer: {
              standard: {
                type: "standard",
                stopwords: "_english_"
              }
            }
          }
        },
        mappings: repositoryCaseMapping
      });
    } else {
    }
    return true;
  } catch (error) {
    console.error("Failed to create/update Elasticsearch index:", error);
    return false;
  }
}

// services/elasticsearchIndexing.ts
async function bulkIndexRepositoryCases(cases) {
  const client = getElasticsearchClient();
  if (!client || cases.length === 0) return false;
  try {
    const operations = cases.flatMap((caseData) => {
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
      return [
        {
          index: { _index: REPOSITORY_CASE_INDEX, _id: caseData.id.toString() }
        },
        { ...caseData, searchableContent }
      ];
    });
    const bulkResponse = await client.bulk({
      operations,
      refresh: true
    });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter((item) => item.index?.error);
      console.error("Bulk indexing errors:", errorItems);
      errorItems.forEach((item) => {
        if (item.index?.error) {
          console.error(`Failed to index document ${item.index._id}:`);
          console.error(`  Error type: ${item.index.error.type}`);
          console.error(`  Error reason: ${item.index.error.reason}`);
        }
      });
      return false;
    }
    console.log(
      `Bulk indexed ${cases.length} repository cases in Elasticsearch`
    );
    return true;
  } catch (error) {
    console.error("Failed to bulk index repository cases:", error);
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
init_prismaBase();
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
async function getElasticsearchSettings2(prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  try {
    const config = await prisma2.appConfig.findUnique({
      where: { key: "elasticsearch_replicas" }
    });
    return {
      numberOfReplicas: config?.value ? config.value : 0
    };
  } catch (error) {
    console.warn("Failed to get Elasticsearch settings from database, using defaults:", error);
    return { numberOfReplicas: 0 };
  }
}
async function createEntityIndex(entityType, prismaClient2) {
  const client = getElasticsearchClient();
  if (!client) return false;
  const indexName = ENTITY_INDICES[entityType];
  const mapping = ENTITY_MAPPINGS[entityType];
  try {
    const settings = await getElasticsearchSettings2(prismaClient2);
    const indexExists = await client.indices.exists({ index: indexName });
    if (!indexExists) {
      await client.indices.create({
        index: indexName,
        mappings: mapping,
        settings: {
          number_of_shards: 1,
          number_of_replicas: settings.numberOfReplicas,
          analysis: {
            analyzer: {
              standard: {
                type: "standard",
                stopwords: "_english_"
              }
            }
          }
        }
      });
      return true;
    }
    return true;
  } catch (error) {
    console.error(`Failed to create index for ${entityType}:`, error);
    return false;
  }
}
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
init_prismaBase();
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
async function buildRepositoryCaseDocument(caseId, prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  const repoCase = await prisma2.repositoryCases.findUnique({
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
  const folderPath = await buildFolderPath(repoCase.folderId, prisma2);
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
async function buildFolderPath(folderId, prisma2 = prisma) {
  const folder = await prisma2.repositoryFolders.findUnique({
    where: { id: folderId },
    include: { parent: true }
  });
  if (!folder) return "/";
  const path = [folder.name];
  let current = folder;
  while (current.parent) {
    path.unshift(current.parent.name);
    const nextParent = await prisma2.repositoryFolders.findUnique({
      where: { id: current.parent.id },
      include: { parent: true }
    });
    if (!nextParent) break;
    current = nextParent;
  }
  return "/" + path.join("/");
}
async function syncProjectCasesToElasticsearch(projectId, batchSize = 100, progressCallback, prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  try {
    await createRepositoryCaseIndex(prisma2);
    const totalCases = await prisma2.repositoryCases.count({
      where: {
        projectId,
        isArchived: false
        // Only exclude archived, include deleted items
      }
    });
    const message = `Syncing ${totalCases} cases for project ${projectId}...`;
    console.log(message);
    if (progressCallback) {
      await progressCallback(0, totalCases, message);
    }
    let processed = 0;
    let hasMore = true;
    while (hasMore) {
      const cases = await prisma2.repositoryCases.findMany({
        where: {
          projectId,
          isArchived: false
          // Only exclude archived, include deleted items
        },
        skip: processed,
        take: batchSize,
        orderBy: { id: "asc" }
      });
      if (cases.length === 0) {
        hasMore = false;
        break;
      }
      const documents = [];
      for (const caseItem of cases) {
        const doc = await buildRepositoryCaseDocument(caseItem.id, prisma2);
        if (doc) {
          documents.push(doc);
        }
      }
      if (documents.length > 0) {
        const success = await bulkIndexRepositoryCases(documents);
        if (!success) {
          console.error(`Failed to index batch starting at ${processed}`);
          return false;
        }
      }
      processed += cases.length;
      const progressMessage = `Indexed ${processed}/${totalCases} cases...`;
      console.log(progressMessage);
      if (progressCallback) {
        await progressCallback(processed, totalCases, progressMessage);
      }
    }
    const finalMessage = `Successfully synced ${processed} cases to Elasticsearch`;
    console.log(finalMessage);
    if (progressCallback) {
      await progressCallback(processed, totalCases, finalMessage);
    }
    return true;
  } catch (error) {
    console.error("Error syncing project cases to Elasticsearch:", error);
    return false;
  }
}
async function initializeElasticsearchIndexes(prismaClient2) {
  try {
    const created = await createRepositoryCaseIndex(prismaClient2);
    if (created) {
      console.log("Elasticsearch indexes initialized successfully");
    }
  } catch (error) {
    console.error("Failed to initialize Elasticsearch indexes:", error);
  }
}

// services/sharedStepSearch.ts
init_prismaBase();
async function buildSharedStepDocument(stepGroupId, prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  const stepGroup = await prisma2.sharedStepGroup.findUnique({
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
async function syncProjectSharedStepsToElasticsearch(projectId, batchSize = 100, prismaClient2) {
  const prisma2 = prismaClient2 || prisma;
  try {
    await createEntityIndex("shared_step" /* SHARED_STEP */, prisma2);
    const totalSteps = await prisma2.sharedStepGroup.count({
      where: {
        projectId
        // Include deleted items (filtering happens at search time based on admin permissions)
      }
    });
    console.log(
      `Syncing ${totalSteps} shared steps for project ${projectId}...`
    );
    let processed = 0;
    let hasMore = true;
    while (hasMore) {
      const steps = await prisma2.sharedStepGroup.findMany({
        where: {
          projectId
          // Include deleted items (filtering happens at search time based on admin permissions)
        },
        skip: processed,
        take: batchSize,
        orderBy: { id: "asc" }
      });
      if (steps.length === 0) {
        hasMore = false;
        break;
      }
      for (const step of steps) {
        const doc = await buildSharedStepDocument(step.id, prisma2);
        if (doc) {
          await indexSharedStep(doc);
        }
      }
      processed += steps.length;
      console.log(`Indexed ${processed}/${totalSteps} shared steps...`);
    }
    console.log(
      `Successfully synced ${processed} shared steps to Elasticsearch`
    );
    return true;
  } catch (error) {
    console.error(
      "Error syncing project shared steps to Elasticsearch:",
      error
    );
    return false;
  }
}

// services/testRunSearch.ts
init_prismaBase();
async function syncProjectTestRunsToElasticsearch(projectId, db) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }
  console.log(`Starting test run sync for project ${projectId}`);
  const testRuns = await db.testRuns.findMany({
    where: {
      projectId
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      project: true,
      createdBy: true,
      state: true,
      configuration: true,
      milestone: true,
      tags: true
    }
  });
  if (testRuns.length === 0) {
    console.log("No test runs to index");
    return;
  }
  const bulkBody = [];
  for (const testRun of testRuns) {
    const noteText = testRun.note ? extractTextFromNode(testRun.note) : "";
    const docsText = testRun.docs ? extractTextFromNode(testRun.docs) : "";
    const searchableContent = [
      testRun.name,
      noteText,
      docsText,
      testRun.tags.map((t) => t.name).join(" ")
    ].join(" ");
    bulkBody.push({
      index: {
        _index: ENTITY_INDICES["test_run" /* TEST_RUN */],
        _id: testRun.id.toString()
      }
    });
    bulkBody.push({
      id: testRun.id,
      projectId: testRun.projectId,
      projectName: testRun.project.name,
      name: testRun.name,
      note: noteText,
      docs: docsText,
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
    });
  }
  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      errorItems.slice(0, 10).forEach((item) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(`Successfully indexed ${testRuns.length} test runs`);
    }
  } catch (error) {
    console.error("Failed to bulk index test runs:", error);
    throw error;
  }
}

// services/sessionSearch.ts
init_prismaBase();
async function syncProjectSessionsToElasticsearch(projectId, db) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }
  const sessions = await db.sessions.findMany({
    where: {
      projectId
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
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
  if (sessions.length === 0) {
    return;
  }
  const bulkBody = [];
  for (const session of sessions) {
    const noteText = session.note ? extractTextFromNode(session.note) : "";
    const missionText = session.mission ? extractTextFromNode(session.mission) : "";
    const searchableContent = [
      session.name,
      noteText,
      missionText,
      session.tags.map((t) => t.name).join(" ")
    ].join(" ");
    bulkBody.push({
      index: {
        _index: ENTITY_INDICES["session" /* SESSION */],
        _id: session.id.toString()
      }
    });
    bulkBody.push({
      id: session.id,
      projectId: session.projectId,
      projectName: session.project.name,
      templateId: session.templateId,
      templateName: session.template.templateName,
      name: session.name,
      note: noteText,
      mission: missionText,
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
    });
  }
  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      errorItems.slice(0, 10).forEach((item) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(`Successfully indexed ${sessions.length} sessions`);
    }
  } catch (error) {
    console.error("Failed to bulk index sessions:", error);
    throw error;
  }
}

// services/issueSearch.ts
init_prismaBase();
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
async function syncProjectIssuesToElasticsearch(projectId, db) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }
  console.log(`Starting issue sync for project ${projectId}`);
  const issues = await db.issue.findMany({
    where: {
      // Include deleted items (filtering happens at search time based on admin permissions)
      OR: [
        // Direct project relationship (preferred)
        { projectId, project: { isDeleted: false } },
        // Fallback: Find through relationships
        { repositoryCases: { some: { projectId, project: { isDeleted: false } } } },
        { sessions: { some: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        { testRuns: { some: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        { sessionResults: { some: { session: { projectId, isDeleted: false, project: { isDeleted: false } } } } },
        { testRunResults: { some: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } } },
        {
          testRunStepResults: {
            some: { testRunResult: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } }
          }
        }
      ]
    },
    include: {
      createdBy: true,
      integration: true,
      // Include direct project relationship (preferred)
      project: true,
      // Fallback relationships
      repositoryCases: {
        where: { projectId, project: { isDeleted: false } },
        take: 1,
        include: { project: true }
      },
      sessions: {
        where: { projectId, isDeleted: false, project: { isDeleted: false } },
        take: 1,
        include: { project: true }
      },
      testRuns: {
        where: { projectId, isDeleted: false, project: { isDeleted: false } },
        take: 1,
        include: { project: true }
      },
      sessionResults: {
        where: { session: { projectId, isDeleted: false, project: { isDeleted: false } } },
        take: 1,
        include: {
          session: {
            include: { project: true }
          }
        }
      },
      testRunResults: {
        where: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } },
        take: 1,
        include: {
          testRun: {
            include: { project: true }
          }
        }
      },
      testRunStepResults: {
        where: { testRunResult: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        take: 1,
        include: {
          testRunResult: {
            include: {
              testRun: {
                include: { project: true }
              }
            }
          }
        }
      }
    }
  });
  if (issues.length === 0) {
    console.log("No issues to index");
    return;
  }
  const bulkBody = [];
  let skippedCount = 0;
  for (const issue of issues) {
    const projectInfo = getProjectFromIssue(issue);
    if (!projectInfo) {
      console.warn(`Issue ${issue.id} has no linked project, skipping`);
      skippedCount++;
      continue;
    }
    const noteText = issue.note ? extractTextFromNode(issue.note) : "";
    const searchableContent = [
      issue.name,
      issue.title,
      issue.description || "",
      issue.externalId || "",
      noteText,
      issue.integration?.name || ""
    ].join(" ");
    bulkBody.push({
      index: {
        _index: ENTITY_INDICES["issue" /* ISSUE */],
        _id: issue.id.toString()
      }
    });
    bulkBody.push({
      id: issue.id,
      projectId: projectInfo.id,
      projectName: projectInfo.name,
      projectIconUrl: projectInfo.iconUrl,
      name: issue.name,
      title: issue.title,
      description: issue.description,
      externalId: issue.externalId,
      note: noteText,
      url: issue.data?.url,
      issueSystem: issue.integration?.name || "Unknown",
      isDeleted: issue.isDeleted,
      createdAt: issue.createdAt,
      createdById: issue.createdById,
      createdByName: issue.createdBy.name,
      createdByImage: issue.createdBy.image,
      searchableContent
    });
  }
  if (bulkBody.length === 0) {
    console.log(
      `No valid issues to index (${skippedCount} orphaned issues skipped)`
    );
    return;
  }
  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      errorItems.slice(0, 10).forEach((item) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(
        `Successfully indexed ${bulkBody.length / 2} issues (${skippedCount} orphaned issues skipped)`
      );
    }
  } catch (error) {
    console.error("Failed to index issues:", error);
  }
}

// services/milestoneSearch.ts
init_prismaBase();
async function syncProjectMilestonesToElasticsearch(projectId, db) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }
  console.log(`Starting milestone sync for project ${projectId}`);
  const milestones = await db.milestones.findMany({
    where: {
      projectId
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
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
  if (milestones.length === 0) {
    console.log("No milestones to index");
    return;
  }
  const bulkBody = [];
  for (const milestone of milestones) {
    const noteText = milestone.note ? extractTextFromNode(milestone.note) : "";
    const docsText = milestone.docs ? extractTextFromNode(milestone.docs) : "";
    const searchableContent = [
      milestone.name,
      noteText,
      docsText
    ].join(" ");
    bulkBody.push({
      index: {
        _index: ENTITY_INDICES["milestone" /* MILESTONE */],
        _id: milestone.id.toString()
      }
    });
    bulkBody.push({
      id: milestone.id,
      projectId: milestone.projectId,
      projectName: milestone.project.name,
      projectIconUrl: milestone.project.iconUrl,
      name: milestone.name,
      note: noteText,
      docs: docsText,
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
      createdByName: milestone.createdBy.name,
      createdByImage: milestone.createdBy.image,
      searchableContent
    });
  }
  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      errorItems.slice(0, 10).forEach((item) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(`Successfully indexed ${milestones.length} milestones`);
    }
  } catch (error) {
    console.error("Failed to index milestones:", error);
  }
}

// services/projectSearch.ts
init_prismaBase();
async function syncAllProjectsToElasticsearch(prismaClient2) {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }
  const prisma2 = prismaClient2 || prisma;
  console.log("Starting project sync");
  const projects = await prisma2.projects.findMany({
    where: {
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      creator: true
    }
  });
  if (projects.length === 0) {
    console.log("No projects to index");
    return;
  }
  const bulkBody = [];
  for (const project of projects) {
    const searchableContent = [
      project.name,
      project.note ? extractTextFromNode(project.note) : "",
      project.docs ? extractTextFromNode(project.docs) : ""
    ].join(" ");
    bulkBody.push({
      index: {
        _index: ENTITY_INDICES["project" /* PROJECT */],
        _id: project.id.toString()
      }
    });
    bulkBody.push({
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
    });
  }
  try {
    const response = await client.bulk({ body: bulkBody, refresh: true });
    if (response.errors) {
      console.error("Bulk indexing errors:", response.errors);
    }
    console.log(`Successfully indexed ${projects.length} projects`);
  } catch (error) {
    console.error("Failed to index projects:", error);
  }
}

// workers/elasticsearchReindexWorker.ts
var import_node_url = require("node:url");

// lib/multiTenantPrisma.ts
var import_client2 = require("@prisma/client");
var fs = __toESM(require("fs"));
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
}
var tenantClients = /* @__PURE__ */ new Map();
var tenantConfigs = null;
var TENANT_CONFIG_FILE = process.env.TENANT_CONFIG_FILE || "/config/tenants.json";
function loadTenantsFromFile(filePath) {
  const configs = /* @__PURE__ */ new Map();
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      for (const [tenantId, config] of Object.entries(parsed)) {
        configs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex
        });
      }
      console.log(`Loaded ${configs.size} tenant configurations from ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to load tenant configs from ${filePath}:`, error);
  }
  return configs;
}
function reloadTenantConfigs() {
  tenantConfigs = null;
  return loadTenantConfigs();
}
function loadTenantConfigs() {
  if (tenantConfigs) {
    return tenantConfigs;
  }
  tenantConfigs = /* @__PURE__ */ new Map();
  const fileConfigs = loadTenantsFromFile(TENANT_CONFIG_FILE);
  for (const [tenantId, config] of fileConfigs) {
    tenantConfigs.set(tenantId, config);
  }
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson);
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex
        });
      }
      console.log(`Loaded ${Object.keys(configs).length} tenant configurations from TENANT_CONFIGS env var`);
    } catch (error) {
      console.error("Failed to parse TENANT_CONFIGS:", error);
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TENANT_([A-Z0-9_]+)_DATABASE_URL$/);
    if (match && value) {
      const tenantId = match[1].toLowerCase();
      if (!tenantConfigs.has(tenantId)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: value,
          elasticsearchNode: process.env[`TENANT_${match[1]}_ELASTICSEARCH_NODE`],
          elasticsearchIndex: process.env[`TENANT_${match[1]}_ELASTICSEARCH_INDEX`]
        });
      }
    }
  }
  if (tenantConfigs.size === 0) {
    console.warn("No tenant configurations found. Multi-tenant mode will not work without configurations.");
  }
  return tenantConfigs;
}
function getTenantConfig(tenantId) {
  const configs = loadTenantConfigs();
  return configs.get(tenantId);
}
function createTenantPrismaClient(config) {
  const client = new import_client2.PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl
      }
    },
    errorFormat: "pretty"
  });
  return client;
}
function getTenantPrismaClient(tenantId) {
  let client = tenantClients.get(tenantId);
  if (client) {
    return client;
  }
  let config = getTenantConfig(tenantId);
  if (!config) {
    console.log(`Tenant ${tenantId} not found in cache, reloading configurations...`);
    reloadTenantConfigs();
    config = getTenantConfig(tenantId);
  }
  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }
  client = createTenantPrismaClient(config);
  tenantClients.set(tenantId, client);
  console.log(`Created Prisma client for tenant: ${tenantId}`);
  return client;
}
function getPrismaClientForJob(jobData) {
  if (!isMultiTenantMode()) {
    const { prisma: prisma2 } = (init_prismaBase(), __toCommonJS(prismaBase_exports));
    return prisma2;
  }
  if (!jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
  return getTenantPrismaClient(jobData.tenantId);
}
async function disconnectAllTenantClients() {
  const disconnectPromises = [];
  for (const [tenantId, client] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(client.$disconnect());
  }
  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant Prisma clients disconnected");
}
function validateMultiTenantJobData(jobData) {
  if (isMultiTenantMode() && !jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
}

// workers/elasticsearchReindexWorker.ts
var import_meta = {};
var processor = async (job) => {
  console.log(`Processing Elasticsearch reindex job ${job.id}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
  const { entityType, projectId } = job.data;
  try {
    const esClient2 = getElasticsearchClient();
    if (!esClient2) {
      throw new Error("Elasticsearch is not configured or unavailable");
    }
    await job.updateProgress(0);
    await job.log("Starting reindex operation...");
    if (entityType === "all" || entityType === "repositoryCases") {
      await job.updateProgress(5);
      await job.log("Initializing Elasticsearch indexes...");
      await initializeElasticsearchIndexes(prisma2);
    }
    const projects = projectId ? await prisma2.projects.findMany({
      where: { id: projectId, isDeleted: false }
    }) : await prisma2.projects.findMany({
      where: { isDeleted: false }
    });
    await job.updateProgress(10);
    await job.log(`Found ${projects.length} projects to process`);
    const results = {
      projects: 0,
      repositoryCases: 0,
      sharedSteps: 0,
      testRuns: 0,
      sessions: 0,
      issues: 0,
      milestones: 0
    };
    const totalCounts = {};
    for (const project of projects) {
      if (entityType === "all" || entityType === "repositoryCases") {
        totalCounts.repositoryCases = (totalCounts.repositoryCases || 0) + await prisma2.repositoryCases.count({
          where: { projectId: project.id, isDeleted: false, isArchived: false }
        });
      }
      if (entityType === "all" || entityType === "sharedSteps") {
        totalCounts.sharedSteps = (totalCounts.sharedSteps || 0) + await prisma2.sharedStepGroup.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "testRuns") {
        totalCounts.testRuns = (totalCounts.testRuns || 0) + await prisma2.testRuns.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "sessions") {
        totalCounts.sessions = (totalCounts.sessions || 0) + await prisma2.sessions.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "issues") {
        totalCounts.issues = (totalCounts.issues || 0) + await prisma2.issue.count({
          where: { isDeleted: false, testRuns: { some: { projectId: project.id } } }
        });
      }
      if (entityType === "all" || entityType === "milestones") {
        totalCounts.milestones = (totalCounts.milestones || 0) + await prisma2.milestones.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
    }
    const totalDocuments = Object.values(totalCounts).reduce((a, b) => a + b, 0);
    let processedDocuments = 0;
    let currentProgress = 10;
    const progressPerProject = 80 / projects.length;
    if (entityType === "all" || entityType === "projects") {
      await job.updateProgress(currentProgress);
      await job.log("Indexing projects...");
      await syncAllProjectsToElasticsearch(prisma2);
      results.projects = await prisma2.projects.count({
        where: { isDeleted: false }
      });
    }
    for (const project of projects) {
      const projectStart = currentProgress;
      await job.updateProgress(currentProgress);
      await job.log(`Processing project: ${project.name}`);
      if (entityType === "all" || entityType === "repositoryCases") {
        const count = await prisma2.repositoryCases.count({
          where: {
            projectId: project.id,
            isDeleted: false,
            isArchived: false
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} repository cases for project ${project.name}`);
          const progressCallback = async (processed, total, message) => {
            processedDocuments = results.repositoryCases + processed;
            const overallProgress = 10 + processedDocuments / totalDocuments * 80;
            await job.updateProgress(Math.min(overallProgress, 90));
            await job.log(message);
          };
          await syncProjectCasesToElasticsearch(project.id, 100, progressCallback, prisma2);
          results.repositoryCases += count;
          processedDocuments = results.repositoryCases;
        }
      }
      if (entityType === "all" || entityType === "sharedSteps") {
        const count = await prisma2.sharedStepGroup.count({
          where: {
            projectId: project.id,
            isDeleted: false
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} shared steps for project ${project.name}`);
          await syncProjectSharedStepsToElasticsearch(project.id, 100, prisma2);
          results.sharedSteps += count;
        }
      }
      if (entityType === "all" || entityType === "testRuns") {
        const count = await prisma2.testRuns.count({
          where: {
            projectId: project.id,
            isDeleted: false
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} test runs for project ${project.name}`);
          await syncProjectTestRunsToElasticsearch(project.id, prisma2);
          results.testRuns += count;
        }
      }
      if (entityType === "all" || entityType === "sessions") {
        const count = await prisma2.sessions.count({
          where: {
            projectId: project.id,
            isDeleted: false
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} sessions for project ${project.name}`);
          await syncProjectSessionsToElasticsearch(project.id, prisma2);
          results.sessions += count;
        }
      }
      if (entityType === "all" || entityType === "issues") {
        const count = await prisma2.issue.count({
          where: {
            isDeleted: false,
            testRuns: {
              some: {
                projectId: project.id
              }
            }
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} issues for project ${project.name}`);
          await syncProjectIssuesToElasticsearch(project.id, prisma2);
          results.issues += count;
        }
      }
      if (entityType === "all" || entityType === "milestones") {
        const count = await prisma2.milestones.count({
          where: {
            projectId: project.id,
            isDeleted: false
          }
        });
        if (count > 0) {
          await job.log(`Syncing ${count} milestones for project ${project.name}`);
          await syncProjectMilestonesToElasticsearch(project.id, prisma2);
          results.milestones += count;
        }
      }
      currentProgress = projectStart + progressPerProject;
      await job.updateProgress(Math.min(currentProgress, 90));
      await job.log(`Completed project: ${project.name}`);
    }
    await job.updateProgress(100);
    await job.log("Reindex completed successfully!");
    const finalTotalDocuments = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`Reindex job ${job.id} completed. Indexed ${finalTotalDocuments} documents.`);
    return {
      success: true,
      results,
      totalDocuments: finalTotalDocuments
    };
  } catch (error) {
    console.error(`Reindex job ${job.id} failed:`, error);
    await job.log(`Error: ${error.message}`);
    throw error;
  }
};
var worker = null;
var startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Elasticsearch reindex worker starting in MULTI-TENANT mode");
  } else {
    console.log("Elasticsearch reindex worker starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    worker = new import_bullmq.Worker(ELASTICSEARCH_REINDEX_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 2,
      // Process 2 reindex jobs at a time
      lockDuration: 36e5,
      // 1 hour - allows for very large reindex operations
      maxStalledCount: 1,
      // Reduce automatic stalled job retries
      stalledInterval: 3e5
      // Check for stalled jobs every 5 minutes
    });
    worker.on("completed", (job) => {
      console.log(`Elasticsearch reindex job ${job.id} completed successfully.`);
    });
    worker.on("failed", (job, err) => {
      console.error(`Elasticsearch reindex job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("Elasticsearch reindex worker error:", err);
    });
    console.log(`Elasticsearch reindex worker started for queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Elasticsearch reindex worker not started.");
  }
  process.on("SIGINT", async () => {
    console.log("Shutting down Elasticsearch reindex worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || (typeof import_meta === "undefined" || import_meta.url === void 0)) {
  console.log("Elasticsearch reindex worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start Elasticsearch reindex worker:", err);
    process.exit(1);
  });
}
var elasticsearchReindexWorker_default = worker;
//# sourceMappingURL=elasticsearchReindexWorker.js.map
