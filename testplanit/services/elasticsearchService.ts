import { Client } from "@elastic/elasticsearch";
import { env } from "../env.js";
import { prisma } from "../lib/prismaBase";

// Create singleton instance
let esClient: Client | null = null;

/**
 * Get or create Elasticsearch client instance
 */
export function getElasticsearchClient(): Client | null {
  if (!env.ELASTICSEARCH_NODE) {
    console.warn(
      "ELASTICSEARCH_NODE environment variable not set. Elasticsearch integration disabled."
    );
    return null;
  }

  if (!esClient) {
    try {
      esClient = new Client({
        node: env.ELASTICSEARCH_NODE,
        // Add additional configuration as needed
        maxRetries: 3,
        requestTimeout: 30000,
        sniffOnStart: false, // Disable sniffing for custom ports
      });

    } catch (error) {
      console.error("Failed to initialize Elasticsearch client:", error);
      return null;
    }
  }

  return esClient;
}

/**
 * Test Elasticsearch connection
 */
export async function testElasticsearchConnection(): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    const response = await client.ping();
    return true;
  } catch (error) {
    console.error("Elasticsearch connection failed:", error);
    return false;
  }
}

/**
 * Repository Case index configuration
 */
export const REPOSITORY_CASE_INDEX = "testplanit-repository-cases";

/**
 * Repository Case mapping for Elasticsearch
 */
export const repositoryCaseMapping = {
  properties: {
    id: { type: "integer" as const },
    projectId: { type: "integer" as const },
    projectName: { type: "keyword" as const },
    projectIconUrl: { type: "keyword" as const },
    repositoryId: { type: "integer" as const },
    folderId: { type: "integer" as const },
    folderPath: { type: "keyword" as const },
    templateId: { type: "integer" as const },
    templateName: { type: "keyword" as const },
    name: {
      type: "text" as const,
      analyzer: "standard",
      fields: {
        keyword: { type: "keyword" as const },
        suggest: { type: "completion" as const },
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
    createdAt: { type: "date" as const },
    creatorId: { type: "keyword" as const },
    creatorName: { type: "text" as const },
    tags: {
      type: "nested" as const,
      properties: {
        id: { type: "integer" as const },
        name: { type: "keyword" as const },
      },
    },
    customFields: {
      type: "nested" as const,
      properties: {
        fieldId: { type: "integer" as const },
        fieldName: { type: "keyword" as const },
        fieldType: { type: "keyword" as const },
        value: { type: "text" as const },
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
    // Full-text search field combining multiple fields
    searchableContent: { type: "text" as const },
  },
};

/**
 * Get Elasticsearch replica settings from database
 */
async function getElasticsearchSettings() {
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
 * Create or update the repository cases index
 */
export async function createRepositoryCaseIndex(): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    // Get settings from database
    const settings = await getElasticsearchSettings();
    
    // Check if index exists
    const exists = await client.indices.exists({
      index: REPOSITORY_CASE_INDEX,
    });

    if (!exists) {
      // Create index with mapping
      await client.indices.create({
        index: REPOSITORY_CASE_INDEX,
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
        mappings: repositoryCaseMapping,
      });
    } else {
      // Index already exists, skip update to avoid field type conflicts
    }

    return true;
  } catch (error) {
    console.error("Failed to create/update Elasticsearch index:", error);
    return false;
  }
}

/**
 * Interface for indexing repository case data
 */
export interface RepositoryCaseDocument {
  id: number;
  projectId: number;
  projectName: string;
  projectIconUrl?: string | null;
  repositoryId: number;
  folderId: number;
  folderPath: string;
  templateId: number;
  templateName: string;
  name: string;
  className?: string | null;
  source: string;
  stateId: number;
  stateName: string;
  stateIcon?: string;
  stateColor?: string;
  estimate?: number | null;
  forecastManual?: number | null;
  forecastAutomated?: number | null;
  automated: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  creatorId: string;
  creatorName: string;
  creatorImage?: string | null;
  tags?: Array<{ id: number; name: string }>;
  customFields?: Array<{
    fieldId: number;
    fieldName: string;
    fieldType: string;
    value: any;
  }>;
  steps?: Array<{
    id: number;
    order: number;
    step: string;
    expectedResult: string;
    isSharedStep?: boolean;
    sharedStepGroupId?: number;
    sharedStepGroupName?: string;
  }>;
  searchableContent?: string;
}
