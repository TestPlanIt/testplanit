import { Client } from "@elastic/elasticsearch";
import { SearchableEntityType, CustomFieldDocument } from "~/types/search";
import { getElasticsearchClient } from "./elasticsearchService";
import { prisma as defaultPrisma } from "~/lib/prismaBase";

type PrismaClientType = typeof defaultPrisma;

// Re-export for convenience
export { getElasticsearchClient };

// Index names for each entity type
export const ENTITY_INDICES = {
  [SearchableEntityType.REPOSITORY_CASE]: "testplanit-repository-cases",
  [SearchableEntityType.SHARED_STEP]: "testplanit-shared-steps",
  [SearchableEntityType.TEST_RUN]: "testplanit-test-runs",
  [SearchableEntityType.SESSION]: "testplanit-sessions",
  [SearchableEntityType.PROJECT]: "testplanit-projects",
  [SearchableEntityType.ISSUE]: "testplanit-issues",
  [SearchableEntityType.MILESTONE]: "testplanit-milestones",
} as const;

// Base mapping for all entities
const baseMapping = {
  properties: {
    id: { type: "integer" as const },
    projectId: { type: "integer" as const },
    projectName: { type: "keyword" as const },
    projectIconUrl: { type: "keyword" as const },
    createdAt: { type: "date" as const },
    updatedAt: { type: "date" as const },
    createdById: { type: "keyword" as const },
    createdByName: { type: "keyword" as const },
    createdByImage: { type: "keyword" as const },
    searchableContent: {
      type: "text" as const,
      analyzer: "standard",
      fields: {
        keyword: {
          type: "keyword" as const,
          ignore_above: 256,
        },
      },
    },
    customFields: {
      type: "nested" as const,
      properties: {
        fieldId: { type: "integer" as const },
        fieldName: { type: "keyword" as const },
        fieldType: { type: "keyword" as const },
        value: { type: "text" as const },
        valueKeyword: { type: "keyword" as const },
        valueNumeric: { type: "double" as const },
        valueBoolean: { type: "boolean" as const },
        valueDate: { type: "date" as const },
        valueArray: { type: "keyword" as const },
        fieldOption: {
          type: "object" as const,
          properties: {
            id: { type: "integer" as const },
            name: { type: "keyword" as const },
            icon: {
              type: "object" as const,
              properties: {
                name: { type: "keyword" as const },
              },
            },
            iconColor: {
              type: "object" as const,
              properties: {
                value: { type: "keyword" as const },
              },
            },
          },
        },
        fieldOptions: {
          type: "nested" as const,
          properties: {
            id: { type: "integer" as const },
            name: { type: "keyword" as const },
            icon: {
              type: "object" as const,
              properties: {
                name: { type: "keyword" as const },
              },
            },
            iconColor: {
              type: "object" as const,
              properties: {
                value: { type: "keyword" as const },
              },
            },
          },
        },
      },
    },
  },
};

// Entity-specific mappings
export const ENTITY_MAPPINGS = {
  [SearchableEntityType.REPOSITORY_CASE]: {
    properties: {
      ...baseMapping.properties,
      repositoryId: { type: "integer" as const },
      folderId: { type: "integer" as const },
      folderPath: { type: "keyword" as const },
      templateId: { type: "integer" as const },
      templateName: { type: "keyword" as const },
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      className: { type: "keyword" as const },
      source: { type: "keyword" as const },
      stateId: { type: "integer" as const },
      stateName: { type: "keyword" as const },
      stateIcon: { type: "keyword" as const },
      stateColor: { type: "keyword" as const },
      estimate: { type: "integer" as const },
      forecastManual: { type: "integer" as const },
      forecastAutomated: { type: "float" as const },
      automated: { type: "boolean" as const },
      isArchived: { type: "boolean" as const },
      isDeleted: { type: "boolean" as const },
      tags: {
        type: "nested" as const,
        properties: {
          id: { type: "integer" as const },
          name: { type: "keyword" as const },
        },
      },
      steps: {
        type: "nested" as const,
        properties: {
          id: { type: "integer" as const },
          order: { type: "integer" as const },
          step: { type: "text" as const },
          expectedResult: { type: "text" as const },
          isSharedStep: { type: "boolean" as const },
          sharedStepGroupId: { type: "integer" as const },
          sharedStepGroupName: { type: "text" as const },
        },
      },
    },
  },
  [SearchableEntityType.SHARED_STEP]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      isDeleted: { type: "boolean" as const },
      items: {
        type: "nested" as const,
        properties: {
          id: { type: "integer" as const },
          order: { type: "integer" as const },
          step: { type: "text" as const },
          expectedResult: { type: "text" as const },
        },
      },
    },
  },
  [SearchableEntityType.TEST_RUN]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      note: { type: "text" as const },
      docs: { type: "text" as const },
      configId: { type: "integer" as const },
      configurationName: { type: "keyword" as const },
      milestoneId: { type: "integer" as const },
      milestoneName: { type: "keyword" as const },
      stateId: { type: "integer" as const },
      stateName: { type: "keyword" as const },
      stateIcon: { type: "keyword" as const },
      stateColor: { type: "keyword" as const },
      forecastManual: { type: "integer" as const },
      forecastAutomated: { type: "float" as const },
      elapsed: { type: "integer" as const },
      isCompleted: { type: "boolean" as const },
      isDeleted: { type: "boolean" as const },
      completedAt: { type: "date" as const },
      testRunType: { type: "keyword" as const },
      tags: {
        type: "nested" as const,
        properties: {
          id: { type: "integer" as const },
          name: { type: "keyword" as const },
        },
      },
    },
  },
  [SearchableEntityType.SESSION]: {
    properties: {
      ...baseMapping.properties,
      templateId: { type: "integer" as const },
      templateName: { type: "keyword" as const },
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      note: { type: "text" as const },
      mission: { type: "text" as const },
      configId: { type: "integer" as const },
      configurationName: { type: "keyword" as const },
      milestoneId: { type: "integer" as const },
      milestoneName: { type: "keyword" as const },
      stateId: { type: "integer" as const },
      stateName: { type: "keyword" as const },
      stateIcon: { type: "keyword" as const },
      stateColor: { type: "keyword" as const },
      assignedToId: { type: "keyword" as const },
      assignedToName: { type: "keyword" as const },
      assignedToImage: { type: "keyword" as const },
      estimate: { type: "integer" as const },
      forecastManual: { type: "integer" as const },
      forecastAutomated: { type: "float" as const },
      elapsed: { type: "integer" as const },
      isCompleted: { type: "boolean" as const },
      isDeleted: { type: "boolean" as const },
      completedAt: { type: "date" as const },
      tags: {
        type: "nested" as const,
        properties: {
          id: { type: "integer" as const },
          name: { type: "keyword" as const },
        },
      },
    },
  },
  [SearchableEntityType.PROJECT]: {
    properties: {
      id: { type: "integer" as const },
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      iconUrl: { type: "keyword" as const },
      note: { type: "text" as const },
      docs: { type: "text" as const },
      isDeleted: { type: "boolean" as const },
      createdAt: { type: "date" as const },
      createdById: { type: "keyword" as const },
      createdByName: { type: "keyword" as const },
      createdByImage: { type: "keyword" as const },
      searchableContent: { type: "text" as const },
    },
  },
  [SearchableEntityType.ISSUE]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      title: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      description: { type: "text" as const },
      externalId: { type: "keyword" as const },
      note: { type: "text" as const },
      url: { type: "keyword" as const },
      issueSystem: { type: "text" as const },
      isDeleted: { type: "boolean" as const },
    },
  },
  [SearchableEntityType.MILESTONE]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text" as const,
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword" as const,
            ignore_above: 256,
          },
        },
      },
      note: { type: "text" as const },
      docs: { type: "text" as const },
      milestoneTypeId: { type: "integer" as const },
      milestoneTypeName: { type: "keyword" as const },
      milestoneTypeIcon: { type: "keyword" as const },
      parentId: { type: "integer" as const },
      parentName: { type: "keyword" as const },
      dueDate: { type: "date" as const },
      isCompleted: { type: "boolean" as const },
      completedAt: { type: "date" as const },
      isDeleted: { type: "boolean" as const },
    },
  },
};

/**
 * Get Elasticsearch replica settings from database
 */
async function getElasticsearchSettings(prismaClient?: PrismaClientType) {
  const prisma = prismaClient || defaultPrisma;
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: "elasticsearch_replicas" }
    });

    // Default to 0 for single-node clusters
    return {
      numberOfReplicas: config?.value ? (config.value as number) : 0
    };
  } catch (error) {
    console.warn("Failed to get Elasticsearch settings from database, using defaults:", error);
    return { numberOfReplicas: 0 };
  }
}

/**
 * Create index for a specific entity type
 */
export async function createEntityIndex(
  entityType: SearchableEntityType,
  prismaClient?: PrismaClientType
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  const indexName = ENTITY_INDICES[entityType];
  const mapping = ENTITY_MAPPINGS[entityType];

  try {
    // Get settings from database
    const settings = await getElasticsearchSettings(prismaClient);
    
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
                stopwords: "_english_",
              },
            },
          },
        },
      });

      return true;
    }

    return true;
  } catch (error) {
    console.error(`Failed to create index for ${entityType}:`, error);
    return false;
  }
}

/**
 * Create all entity indices
 */
export async function createAllEntityIndices(prismaClient?: PrismaClientType): Promise<void> {
  const entityTypes = Object.values(SearchableEntityType);

  for (const entityType of entityTypes) {
    await createEntityIndex(entityType, prismaClient);
  }
}

/**
 * Transform custom field values based on field type
 */
export function transformCustomFieldValue(
  fieldType: string,
  value: any
): Partial<CustomFieldDocument> {
  const base: Partial<CustomFieldDocument> = {};

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
        // Handle case where value might be a JSON string
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
      // Extract text from TipTap JSON
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
      // Steps are handled separately in the steps array
      if (value) {
        base.value = String(value);
      }
      break;

    default:
      base.value = String(value);
  }

  return base;
}

/**
 * Extract plain text from TipTap JSON content
 */
function extractTextFromTipTap(content: any): string {
  if (!content || !content.content) return "";

  let text = "";

  function extractFromNode(node: any) {
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

/**
 * Build custom field documents for indexing
 */
export function buildCustomFieldDocuments(
  fieldValues: Array<{
    fieldId: number;
    field: {
      displayName: string;
      systemName: string;
      type?: { type: string };
      fieldOptions?: Array<{
        fieldOption: {
          id: number;
          name: string;
          icon?: { name: string };
          iconColor?: { value: string };
        };
      }>;
    };
    value: any;
  }>
): CustomFieldDocument[] {
  return fieldValues.map((cfv) => {
    const fieldType = cfv.field.type?.type || cfv.field.systemName;
    const transformed = transformCustomFieldValue(fieldType, cfv.value);

    const doc: CustomFieldDocument = {
      fieldId: cfv.fieldId,
      fieldName: cfv.field.displayName,
      fieldType: fieldType,
      ...transformed,
    };

    // For single select/dropdown fields, find the selected option
    if (
      cfv.value &&
      cfv.field.fieldOptions &&
      (fieldType === "Select" || fieldType === "Dropdown")
    ) {
      const selectedOption = cfv.field.fieldOptions.find(
        (fo) => fo.fieldOption.id === cfv.value
      );
      if (selectedOption) {
        doc.fieldOption = {
          id: selectedOption.fieldOption.id,
          name: selectedOption.fieldOption.name,
          icon: selectedOption.fieldOption.icon,
          iconColor: selectedOption.fieldOption.iconColor,
        };
      }
    }

    // Add all field options for multi-select fields
    if (cfv.field.fieldOptions && fieldType === "Multi-Select") {
      doc.fieldOptions = cfv.field.fieldOptions.map((fo) => ({
        id: fo.fieldOption.id,
        name: fo.fieldOption.name,
        icon: fo.fieldOption.icon,
        iconColor: fo.fieldOption.iconColor,
      }));
    }

    return doc;
  });
}

/**
 * Get all indices for a list of entity types
 */
export function getIndicesForEntityTypes(
  entityTypes?: SearchableEntityType[]
): string[] {
  if (!entityTypes || entityTypes.length === 0) {
    return Object.values(ENTITY_INDICES);
  }

  return entityTypes.map((type) => ENTITY_INDICES[type]);
}

/**
 * Build aggregations for faceted search
 */
export function buildAggregations(
  facets: string[],
  entityTypes?: SearchableEntityType[]
): Record<string, any> {
  const aggs: Record<string, any> = {};

  // Common facets
  if (facets.includes("projects") || facets.includes("projectId")) {
    aggs.projects = {
      terms: {
        field: "projectId",
        size: 100,
      },
    };
  }

  if (facets.includes("states") || facets.includes("stateId")) {
    aggs.states = {
      terms: {
        field: "stateId",
        size: 50,
      },
    };
  }

  if (facets.includes("tags") || facets.includes("tagIds")) {
    aggs.tags = {
      terms: {
        field: "tagIds",
        size: 100,
      },
    };
  }

  if (facets.includes("creators") || facets.includes("creatorId")) {
    aggs.creators = {
      terms: {
        field: "createdById.keyword",
        size: 100,
      },
    };
  }

  // Entity-specific aggregations
  if (
    !entityTypes ||
    entityTypes.includes(SearchableEntityType.REPOSITORY_CASE)
  ) {
    if (facets.includes("folders") || facets.includes("folderId")) {
      aggs.folders = {
        terms: {
          field: "folderId",
          size: 50,
        },
      };
    }

    if (facets.includes("templates") || facets.includes("templateId")) {
      aggs.templates = {
        terms: {
          field: "templateId",
          size: 50,
        },
      };
    }

    if (facets.includes("automated")) {
      aggs.automated = {
        terms: {
          field: "automated",
        },
      };
    }
  }

  if (!entityTypes || entityTypes.includes(SearchableEntityType.TEST_RUN)) {
    if (
      facets.includes("configurations") ||
      facets.includes("configurationId")
    ) {
      aggs.configurations = {
        terms: {
          field: "configurationId",
          size: 50,
        },
      };
    }

    if (facets.includes("milestones") || facets.includes("milestoneId")) {
      aggs.milestones = {
        terms: {
          field: "milestoneId",
          size: 50,
        },
      };
    }

    if (facets.includes("testRunType")) {
      aggs.testRunType = {
        terms: {
          field: "testRunType",
        },
      };
    }
  }

  if (!entityTypes || entityTypes.includes(SearchableEntityType.SESSION)) {
    if (facets.includes("assignedTo") || facets.includes("assignedToId")) {
      aggs.assignedTo = {
        terms: {
          field: "assignedToId.keyword",
          size: 100,
        },
      };
    }
  }

  // Entity type counts
  aggs.entityTypes = {
    terms: {
      field: "_index",
      size: 10,
    },
  };

  return aggs;
}
