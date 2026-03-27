import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import {
  createBatches,
  executeBatches,
  type BatchableItem,
} from "../lib/llm/services/batch-processor";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";
import { LLM_FEATURES } from "../lib/llm/constants";
import type { LlmRequest } from "../lib/llm/types/index";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { MAGIC_SELECT_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";
import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
} from "../services/elasticsearchService";

// ─── Job data / result types ────────────────────────────────────────────────

export interface MagicSelectJobData extends MultiTenantJobData {
  projectId: number;
  userId: string;
  testRunMetadata: {
    name: string;
    description: unknown | null;
    docs: unknown | null;
    linkedIssueIds: number[];
    tags?: string[];
  };
  clarification?: string;
  excludeCaseIds?: number[];
}

export interface MagicSelectJobResult {
  suggestedCaseIds: number[];
  truncatedBatches: number[];
  reasoning: string;
  metadata: {
    totalCasesAnalyzed: number;
    repositoryTotalCount: number;
    effectiveCaseCount: number;
    suggestedCount: number;
    directlySelected: number;
    linkedCasesAdded: number;
    searchPreFiltered: boolean;
    searchKeywords?: string;
    model: string;
    tokens: { prompt: number; completion: number; total: number };
    batchCount: number;
    failedBatchCount: number;
  };
}

// ─── Helper functions (migrated from route.ts) ───────────────────────────────

// Helper to parse env var as number with fallback
const parseEnvInt = (envVar: string | undefined, defaultValue: number): number => {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const parseEnvFloat = (envVar: string | undefined, defaultValue: number): number => {
  if (!envVar) return defaultValue;
  const parsed = parseFloat(envVar);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Truncation limits for token optimization (configurable via env vars)
const TRUNCATION_LIMITS = {
  testCaseName: parseEnvInt(process.env.MAGIC_SELECT_TRUNCATE_CASE_NAME, 80),
  textLongField: parseEnvInt(process.env.MAGIC_SELECT_TRUNCATE_TEXT_LONG, 100),
  otherField: parseEnvInt(process.env.MAGIC_SELECT_TRUNCATE_OTHER_FIELD, 100),
  issueDescription: parseEnvInt(process.env.MAGIC_SELECT_TRUNCATE_ISSUE_DESC, 250),
};

// Search configuration for pre-filtering test cases (configurable via env vars)
const SEARCH_CONFIG = {
  searchPreFilterThreshold: parseEnvInt(process.env.MAGIC_SELECT_SEARCH_THRESHOLD, 250),
  minKeywordLength: parseEnvInt(process.env.MAGIC_SELECT_MIN_KEYWORD_LENGTH, 3),
  minSearchScore: parseEnvFloat(process.env.MAGIC_SELECT_MIN_SEARCH_SCORE, 50.0),
  maxSearchResults: parseEnvInt(process.env.MAGIC_SELECT_MAX_SEARCH_RESULTS, 2000),
};

// Compressed test case structure for LLM context
interface CompressedTestCase {
  id: number;
  name: string;
  folderPath: string;
  tags: string[];
  fields: Record<string, string>;
  linksTo: number[];
  linksFrom: number[];
}

// Issue data structure
interface IssueData {
  id: number;
  name: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  externalKey: string | null;
  externalUrl: string | null;
}

// Extract text content from TipTap JSON
function extractTextFromTipTap(content: unknown): string {
  if (!content) return "";

  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return extractTextFromTipTap(parsed);
    } catch {
      return content;
    }
  }

  if (typeof content !== "object") return "";

  const obj = content as Record<string, unknown>;

  if (obj.type === "text" && typeof obj.text === "string") {
    return obj.text;
  }

  if (Array.isArray(obj.content)) {
    return obj.content.map((child) => extractTextFromTipTap(child)).join(" ");
  }

  return "";
}

// Truncate string to specified length with ellipsis
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

// Process field value based on field type
function processFieldValue(
  value: unknown,
  fieldType: string | undefined,
  fieldOptions: Array<{ fieldOption: { id: number; name: string } }> | undefined
): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Handle Select/Dropdown - resolve ID to name
  if (fieldType === "Select" || fieldType === "Dropdown") {
    if (typeof value === "number" && fieldOptions) {
      const option = fieldOptions.find((fo) => fo.fieldOption.id === value);
      return option?.fieldOption.name || null;
    }
    return null;
  }

  // Handle Multi-Select - resolve IDs to names
  if (fieldType === "Multi-Select") {
    let ids: number[] = [];
    if (Array.isArray(value)) {
      ids = value;
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        return null;
      }
    }
    if (ids.length > 0 && fieldOptions) {
      const names = ids
        .map(
          (id) =>
            fieldOptions.find((fo) => fo.fieldOption.id === id)?.fieldOption.name
        )
        .filter(Boolean);
      return names.length > 0 ? names.join(", ") : null;
    }
    return null;
  }

  // Handle Text Long (TipTap JSON) - extract plain text and truncate
  if (fieldType === "Text Long") {
    const textContent = extractTextFromTipTap(value);
    return textContent
      ? truncateText(textContent, TRUNCATION_LIMITS.textLongField)
      : null;
  }

  // Handle other types - return as string (truncated for brevity)
  const strValue = String(value);
  return truncateText(strValue, TRUNCATION_LIMITS.otherField);
}

// Build folder path from folder hierarchy
function buildFolderPath(
  folder: {
    name: string;
    parent?: { name: string; parent?: { name: string } | null } | null;
  } | null
): string {
  if (!folder) return "/";

  const parts: string[] = [];
  let current: typeof folder | null = folder;

  while (current) {
    parts.unshift(current.name);
    current = current.parent ?? null;
  }

  return "/" + parts.join("/");
}

// Extract keywords from test run metadata for search pre-filtering
function extractSearchKeywords(
  testRunMetadata: {
    name: string;
    description: unknown;
    docs: unknown;
    tags?: string[];
  },
  issues: IssueData[],
  clarification?: string
): string {
  const textParts: string[] = [];

  textParts.push(testRunMetadata.name);

  const descText = extractTextFromTipTap(testRunMetadata.description);
  if (descText) textParts.push(descText);

  const docsText = extractTextFromTipTap(testRunMetadata.docs);
  if (docsText) textParts.push(docsText);

  if (testRunMetadata.tags?.length) {
    textParts.push(...testRunMetadata.tags);
  }

  for (const issue of issues) {
    textParts.push(issue.title);
    if (issue.description) {
      const issueDesc = extractTextFromTipTap(issue.description);
      if (issueDesc) textParts.push(issueDesc);
    }
  }

  if (clarification) {
    textParts.push(clarification);
  }

  const combinedText = textParts.join(" ");

  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "this", "that",
    "these", "those", "it", "its", "they", "them", "their", "we", "us", "our",
    "you", "your", "he", "she", "him", "her", "his", "all", "each", "every",
    "both", "few", "more", "most", "other", "some", "such", "no", "not",
    "only", "same", "so", "than", "too", "very", "just", "also", "now",
    "here", "there", "when", "where", "why", "how", "what", "which", "who",
    "whom", "whose", "test", "case", "cases", "run",
  ]);

  const words = combinedText
    .toLowerCase()
    .split(/[\s\-_.,;:!?()[\]{}'"<>\/\\|@#$%^&*+=~`]+/)
    .filter(
      (word) =>
        word.length >= SEARCH_CONFIG.minKeywordLength &&
        !stopWords.has(word) &&
        !/^\d+$/.test(word)
    );

  const uniqueKeywords = [...new Set(words)].slice(0, 30);
  return uniqueKeywords.join(" ");
}

// Build system prompt for magic select
function buildSystemPrompt(): string {
  return `You are an expert QA engineer selecting test cases for a test run.
Your task is to analyze the test run context and select the most relevant test cases from the repository.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no comments, no text before or after the JSON.

JSON structure (EXACT format required):
{
  "caseIds": [1, 2, 3],
  "reasoning": "Brief explanation of why these test cases were selected"
}

SELECTION CRITERIA:
- Match test cases to the test run name, description, documentation, linked issues, and tags
- Include all test scenarios that may need to be executed to validate the test run's purpose
- Consider test case tags and folder organization for relevance
- Prioritize test cases that directly relate to the functionality being tested
- Include both positive and negative test scenarios when applicable
- ONLY return IDs from the provided repository - never invent case IDs

IMPORTANT:
- If no test cases match the criteria, return an empty array: {"caseIds": [], "reasoning": "No matching test cases found"}
- Be thorough but selective - include cases that are truly relevant, not just tangentially related
- Consider the folder structure as context for what area of functionality a test case covers

Return ONLY the JSON.`;
}

// Build user prompt with test run context and repository cases
function buildUserPrompt(
  testRunMetadata: {
    name: string;
    description: unknown;
    docs: unknown;
    linkedIssueIds: number[];
    tags?: string[];
  },
  issues: IssueData[],
  testCases: CompressedTestCase[],
  clarification?: string
): string {
  let prompt = `TEST RUN TO CREATE:
Name: ${testRunMetadata.name}`;

  const descriptionText = extractTextFromTipTap(testRunMetadata.description);
  if (descriptionText) {
    prompt += `\n\nDescription:\n${descriptionText}`;
  }

  const docsText = extractTextFromTipTap(testRunMetadata.docs);
  if (docsText) {
    prompt += `\n\nDocumentation:\n${docsText}`;
  }

  if (testRunMetadata.tags && testRunMetadata.tags.length > 0) {
    prompt += `\n\nTags: ${testRunMetadata.tags.join(", ")}`;
  }

  if (issues.length > 0) {
    prompt += `\n\nLINKED ISSUES:`;
    issues.forEach((issue, i) => {
      prompt += `\n${i + 1}. ${issue.externalKey || issue.name}: ${issue.title}`;
      if (issue.description) {
        const issueDesc = extractTextFromTipTap(issue.description);
        if (issueDesc) {
          prompt += `\n   Description: ${truncateText(issueDesc, TRUNCATION_LIMITS.issueDescription)}`;
        }
      }
      if (issue.status) {
        prompt += `\n   Status: ${issue.status}`;
      }
      if (issue.priority) {
        prompt += ` | Priority: ${issue.priority}`;
      }
    });
  }

  if (clarification) {
    prompt += `\n\nADDITIONAL CONTEXT FROM USER:\n${clarification}`;
  }

  // Compress test case data to reduce token usage
  const compressedCaseData = testCases.map((tc) => {
    const result: (
      | number
      | string
      | string[]
      | number[]
      | Record<string, string>
      | null
    )[] = [tc.id, tc.name];
    if (tc.folderPath !== "/") result.push(tc.folderPath);
    else result.push(null);

    if (tc.tags.length > 0) result.push(tc.tags);
    else result.push(null);

    if (Object.keys(tc.fields).length > 0) result.push(tc.fields);
    else result.push(null);

    if (tc.linksTo.length > 0) result.push(tc.linksTo);
    else result.push(null);

    if (tc.linksFrom.length > 0) result.push(tc.linksFrom);
    else result.push(null);

    // Trim trailing nulls
    while (result.length > 2 && result[result.length - 1] === null) {
      result.pop();
    }
    return result;
  });

  prompt += `\n\nAVAILABLE TEST CASES (${testCases.length} cases):
Format: [id, name, folder?, tags[]?, fields?, linkedTo[]?, linkedFrom[]?]
${JSON.stringify(compressedCaseData)}

Select all relevant test cases by their IDs. Consider names, folders, tags, custom fields, and linked cases.`;

  return prompt;
}

// Expand linked cases - add any cases linked to/from selected cases
function expandLinkedCases(
  selectedIds: number[],
  allCases: CompressedTestCase[]
): number[] {
  const expandedSet = new Set(selectedIds);
  const caseMap = new Map(allCases.map((tc) => [tc.id, tc]));

  for (const caseId of selectedIds) {
    const testCase = caseMap.get(caseId);
    if (testCase) {
      testCase.linksTo.forEach((linkedId) => expandedSet.add(linkedId));
      testCase.linksFrom.forEach((linkedId) => expandedSet.add(linkedId));
    }
  }

  return Array.from(expandedSet);
}

// ─── Cancellation key helper ─────────────────────────────────────────────────

function _cancelKey(jobId: string | undefined): string {
  return `magic-select:cancel:${jobId}`;
}

// ─── Redis cancellation key helper ──────────────────────────────────────────

function cancelKey(jobId: string | undefined): string {
  return `magic-select:cancel:${jobId}`;
}

// ─── Processor ──────────────────────────────────────────────────────────────

export const processor = async (
  job: Job<MagicSelectJobData>
): Promise<MagicSelectJobResult> => {
  console.log(
    `Processing magic select job ${job.id} for project ${job.data.projectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  const { projectId, testRunMetadata, clarification, excludeCaseIds } = job.data;

  // Report initial setup phase
  await job.updateProgress({ phase: "setup", message: "resolving_integration" });

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelled = await redis.get(cancelKey(job.id));
  if (cancelled) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 3. Get tenant-specific Prisma client
  const prisma = getPrismaClientForJob(job.data);

  // 4. Create worker-safe LlmManager (fresh instance per job, not singleton)
  const llmManager = LlmManager.createForWorker(prisma as any, job.data.tenantId);
  const promptResolver = new PromptResolver(prisma as any);

  // 4. TOKEN-04 — Fetch provider config for token limits and retry settings
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.MAGIC_SELECT_CASES,
    projectId
  );

  let maxTokensPerRequest = 4096;
  let maxTokens = 2000;
  let retryOptions: { maxRetries?: number; baseDelayMs?: number } | undefined;

  if (resolved) {
    const llmProviderConfig = await (prisma as any).llmProviderConfig.findFirst({
      where: { llmIntegrationId: resolved.integrationId },
    });
    if (llmProviderConfig) {
      maxTokensPerRequest = llmProviderConfig.maxTokensPerRequest ?? 4096;
      maxTokens = llmProviderConfig.defaultMaxTokens ?? 2000;
      retryOptions = { maxRetries: llmProviderConfig.retryAttempts ?? 3 };
    }
  }

  // 5. Resolve prompt from database (falls back to hard-coded default)
  const resolvedPrompt = await promptResolver.resolve(
    LLM_FEATURES.MAGIC_SELECT_CASES,
    projectId
  );

  // 6. Use resolved system prompt if from DB, otherwise use built-in
  const systemPrompt =
    resolvedPrompt.source !== "fallback"
      ? resolvedPrompt.systemPrompt
      : buildSystemPrompt();

  await job.updateProgress({ phase: "setup", message: "fetching_cases" });

  // 7. Fetch linked issue details
  let issues: IssueData[] = [];
  if (testRunMetadata.linkedIssueIds.length > 0) {
    const issueRecords = await (prisma as any).issue.findMany({
      where: {
        id: { in: testRunMetadata.linkedIssueIds },
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        externalKey: true,
        externalUrl: true,
      },
    });
    issues = issueRecords;
  }

  // 8. Elasticsearch pre-filter logic
  let searchResultIds: number[] | null = null;
  const searchKeywords = extractSearchKeywords(testRunMetadata, issues, clarification);
  let searchPreFiltered = false;

  const repositoryTotalCount = await (prisma as any).repositoryCases.count({
    where: {
      projectId,
      isArchived: false,
      isDeleted: false,
    },
  });

  if (searchKeywords && repositoryTotalCount > SEARCH_CONFIG.searchPreFilterThreshold) {
    console.log(`[magic-select] job ${job.id} running ES pre-filter (${repositoryTotalCount} cases, keywords: "${searchKeywords}")`);

    const esClient = getElasticsearchClient();
    if (!esClient) {
      console.log("[magic-select] Elasticsearch client not available, skipping pre-filter");
    } else {
      try {
        const indexName = getRepositoryCaseIndexName(job.data.tenantId);
        const nameTerms = testRunMetadata.name
          .toLowerCase()
          .split(/[\s\-_.,;:!?()[\]{}'"<>\/\\|@#$%^&*+=~`]+/)
          .filter((word) => word.length >= 3);
        const nameQuery = nameTerms.join(" ");

        const searchQuery = {
          bool: {
            filter: [
              { term: { projectId } },
              { term: { isArchived: false } },
            ],
            must: [
              {
                bool: {
                  should: [
                    { match_phrase: { name: { query: testRunMetadata.name, boost: 20 } } },
                    { match: { name: { query: nameQuery, operator: "or" as const, minimum_should_match: "1", boost: 10 } } },
                    { match: { searchableContent: { query: nameQuery, operator: "or" as const, minimum_should_match: "1", boost: 5 } } },
                    { match: { searchableContent: { query: searchKeywords, operator: "or" as const, minimum_should_match: "1", boost: 1 } } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        };

        const scoreThresholds = [
          SEARCH_CONFIG.minSearchScore,
          SEARCH_CONFIG.minSearchScore * 0.5,
          SEARCH_CONFIG.minSearchScore * 0.25,
          SEARCH_CONFIG.minSearchScore * 0.1,
          1,
        ];

        for (const minScore of scoreThresholds) {
          const searchResponse = await esClient.search({
            index: indexName,
            query: searchQuery,
            min_score: minScore,
            size: SEARCH_CONFIG.maxSearchResults,
            _source: false,
            track_total_hits: true,
          });

          const hits = searchResponse.hits.hits;
          if (hits.length > 0) {
            searchResultIds = hits
              .filter((hit) => hit._id !== undefined)
              .map((hit) => parseInt(hit._id!, 10));
            searchPreFiltered = true;
            console.log(`[magic-select] ES returned ${searchResultIds.length} cases (min_score: ${minScore})`);
            break;
          } else if (minScore === scoreThresholds[scoreThresholds.length - 1]) {
            console.log("[magic-select] ES returned no results at minimum threshold, using all cases");
          }
        }
      } catch (searchError) {
        console.error("[magic-select] Elasticsearch search failed, falling back to database query:", searchError);
      }
    }
  }

  const effectiveCaseCount = searchResultIds ? searchResultIds.length : repositoryTotalCount;

  // 9. Fetch repository cases from DB
  const testCaseWhere: {
    projectId: number;
    isArchived: boolean;
    isDeleted: boolean;
    id?: { in: number[] };
  } = {
    projectId,
    isArchived: false,
    isDeleted: false,
  };

  if (searchResultIds) {
    testCaseWhere.id = { in: searchResultIds };
  }

  const repositoryCases = await (prisma as any).repositoryCases.findMany({
    where: testCaseWhere,
    include: {
      folder: {
        select: {
          name: true,
          parent: {
            select: {
              name: true,
              parent: { select: { name: true } },
            },
          },
        },
      },
      tags: { select: { name: true } },
      caseFieldValues: {
        include: {
          field: {
            select: {
              displayName: true,
              systemName: true,
              type: { select: { type: true } },
              fieldOptions: {
                select: {
                  fieldOption: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      linksFrom: { where: { isDeleted: false }, select: { caseBId: true } },
      linksTo: { where: { isDeleted: false }, select: { caseAId: true } },
    },
    orderBy: { name: "asc" },
  });

  if (repositoryCases.length === 0) {
    return {
      suggestedCaseIds: [],
      truncatedBatches: [],
      reasoning: "No test cases found in the repository",
      metadata: {
        totalCasesAnalyzed: 0,
        repositoryTotalCount,
        effectiveCaseCount,
        suggestedCount: 0,
        directlySelected: 0,
        linkedCasesAdded: 0,
        searchPreFiltered,
        searchKeywords: searchPreFiltered ? searchKeywords : undefined,
        model: "",
        tokens: { prompt: 0, completion: 0, total: 0 },
        batchCount: 0,
        failedBatchCount: 0,
      },
    };
  }

  // 10. Compress test cases for LLM context
  const compressedCases: CompressedTestCase[] = repositoryCases.map((tc: any) => {
    const fields: Record<string, string> = {};
    for (const cfv of tc.caseFieldValues) {
      const fieldName = cfv.field?.displayName || cfv.field?.systemName;
      if (!fieldName) continue;
      const fieldType = cfv.field?.type?.type;
      const fieldOptions = cfv.field?.fieldOptions;
      const processedValue = processFieldValue(cfv.value, fieldType, fieldOptions);
      if (processedValue) {
        fields[fieldName] = processedValue;
      }
    }

    return {
      id: tc.id,
      name: truncateText(tc.name, TRUNCATION_LIMITS.testCaseName),
      folderPath: buildFolderPath(tc.folder),
      tags: tc.tags.map((t: any) => t.name),
      fields,
      linksTo: tc.linksFrom.map((l: any) => l.caseBId),
      linksFrom: tc.linksTo.map((l: any) => l.caseAId),
    };
  });

  if (!resolved) {
    throw new Error("No active LLM integration found for this project");
  }

  // 11. Estimate tokens for fixed parts (system + test run context overhead)
  const testRunContext = buildUserPrompt(testRunMetadata, issues, [], clarification);
  const systemPromptTokens =
    Math.ceil(systemPrompt.length / 4) + Math.ceil(testRunContext.length / 4);

  // 12. Convert compressed cases to batchable items with token estimates
  const batchableItems: (CompressedTestCase & BatchableItem)[] = compressedCases.map((tc) => {
    const serialized = JSON.stringify([
      tc.id,
      tc.name,
      tc.folderPath !== "/" ? tc.folderPath : null,
      tc.tags.length > 0 ? tc.tags : null,
      Object.keys(tc.fields).length > 0 ? tc.fields : null,
      tc.linksTo.length > 0 ? tc.linksTo : null,
      tc.linksFrom.length > 0 ? tc.linksFrom : null,
    ]);
    return {
      ...tc,
      estimatedTokens: Math.ceil(serialized.length / 4),
    };
  });

  // 13. Create batches using token-aware batch processor
  const batches = createBatches(batchableItems, {
    maxTokensPerRequest,
    systemPromptTokens,
  });

  console.log(`[magic-select] job ${job.id} — ${compressedCases.length} cases, ${batches.length} batches`);

  await job.updateProgress({
    phase: "ai",
    message: "waiting_for_ai",
    analyzed: 0,
    total: compressedCases.length,
    batchesCompleted: 0,
    batchesTotal: batches.length,
    selectedSoFar: 0,
  });

  // 14. RETRY-05 — Execute batches with truncation tracking
  const truncatedBatches: number[] = [];
  const allSuggestedIds: number[] = [];
  const allReasonings: string[] = [];
  let totalTokens = { prompt: 0, completion: 0, total: 0 };
  let model = "";

  const batchResult = await executeBatches({
    batches,
    processBatch: async (batch, batchIndex) => {
      // Check cancellation before each batch
      const isCancelled = await redis.get(cancelKey(job.id));
      if (isCancelled) {
        await redis.del(cancelKey(job.id));
        throw new Error("Job cancelled by user");
      }

      const batchCases: CompressedTestCase[] = batch;
      const userPrompt = buildUserPrompt(testRunMetadata, issues, batchCases, clarification);

      const llmRequest: LlmRequest = {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: resolvedPrompt.temperature,
        maxTokens,
        userId: job.data.userId,
        feature: "magic_select_cases",
        ...(resolved.model ? { model: resolved.model } : {}),
        metadata: {
          projectId,
          testRunName: testRunMetadata.name,
          totalCases: batchCases.length,
          linkedIssues: testRunMetadata.linkedIssueIds.length,
          timestamp: new Date().toISOString(),
        },
        timeout: 240000,
      };

      const response = await llmManager.chat(resolved.integrationId, llmRequest, retryOptions);

      if (response.finishReason === "length") {
        console.warn(
          `[magic-select] job ${job.id} batch ${batchIndex} truncated (finishReason=length); ` +
            `${batchCases.length} cases in batch may have incomplete selection`
        );
        truncatedBatches.push(batchIndex);
      }

      totalTokens.prompt += response.promptTokens;
      totalTokens.completion += response.completionTokens;
      totalTokens.total += response.totalTokens;
      model = response.model || model;

      // Parse the LLM response
      const cleanContent = response.content.trim();
      let jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        const codeBlockMatch = cleanContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          jsonMatch = [codeBlockMatch[1]];
        }
      }

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validIds = new Set(batchCases.map((tc) => tc.id));

        if (Array.isArray(parsed.caseIds)) {
          const validSuggestions = parsed.caseIds.filter(
            (id: unknown) => typeof id === "number" && validIds.has(id)
          );
          allSuggestedIds.push(...validSuggestions);
        }

        if (typeof parsed.reasoning === "string") {
          allReasonings.push(parsed.reasoning);
        }
      }
    },
    onBatchComplete: async (processed, total) => {
      await job.updateProgress({
        phase: "ai",
        message: "analyzing",
        analyzed: processed,
        total,
        batchesCompleted: Math.min(processed, batches.length),
        batchesTotal: batches.length,
        selectedSoFar: allSuggestedIds.length,
      });
    },
  });

  // 15. Deduplicate, expand linked cases, filter excluded
  const uniqueSuggestedIds = [...new Set(allSuggestedIds)];
  const expandedCaseIds = expandLinkedCases(uniqueSuggestedIds, compressedCases);
  const finalCaseIds = excludeCaseIds
    ? expandedCaseIds.filter((id) => !excludeCaseIds.includes(id))
    : expandedCaseIds;

  const reasoning =
    allReasonings.length === 1
      ? allReasonings[0]
      : allReasonings.map((r, i) => `Batch ${i + 1}: ${r}`).join("\n");

  return {
    suggestedCaseIds: finalCaseIds,
    truncatedBatches,
    reasoning: reasoning || "",
    metadata: {
      totalCasesAnalyzed: compressedCases.length,
      repositoryTotalCount,
      effectiveCaseCount,
      suggestedCount: finalCaseIds.length,
      directlySelected: uniqueSuggestedIds.length,
      linkedCasesAdded: finalCaseIds.length - uniqueSuggestedIds.length,
      searchPreFiltered,
      searchKeywords: searchPreFiltered ? searchKeywords : undefined,
      model,
      tokens: totalTokens,
      batchCount: batchResult.batchCount,
      failedBatchCount: batchResult.failedBatchCount,
    },
  };
};

// ─── Worker setup ───────────────────────────────────────────────────────────

let worker: Worker<MagicSelectJobData, MagicSelectJobResult> | null = null;

export function startMagicSelectWorker() {
  if (isMultiTenantMode()) {
    console.log("Magic select worker starting in MULTI-TENANT mode");
  } else {
    console.log("Magic select worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<MagicSelectJobData, MagicSelectJobResult>(
    MAGIC_SELECT_QUEUE_NAME,
    processor,
    { connection: valkeyConnection as any, concurrency: 1 }
  );

  worker.on("completed", (job) =>
    console.log(`Magic select job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Magic select job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Magic select worker error:", err);
  });

  console.log(`Magic select worker started for queue "${MAGIC_SELECT_QUEUE_NAME}".`);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down magic select worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down magic select worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  return worker;
}

// Run the worker if this file is executed directly
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  console.log("Magic select worker running...");
  startMagicSelectWorker();
}

export default worker;
