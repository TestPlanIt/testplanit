import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import type { LlmRequest } from "@/lib/llm/types";
import { ProjectAccessType } from "@prisma/client";
import { z } from "zod/v4";
import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
} from "~/services/elasticsearchService";

// Allow up to 5 minutes for LLM requests with large test case repositories
export const maxDuration = 300;

// Request validation schema
// Note: description and docs can be TipTap JSON objects or strings
const MagicSelectRequestSchema = z.object({
  projectId: z.number(),
  testRunMetadata: z.object({
    name: z.string().min(1),
    description: z.unknown().nullable(),
    docs: z.unknown().nullable(),
    linkedIssueIds: z.array(z.number()),
    tags: z.array(z.string()).optional(),
  }),
  clarification: z.string().optional(),
  excludeCaseIds: z.array(z.number()).optional(),
  // Pagination support for large repositories
  batchSize: z.number().min(1).optional(),
  batchIndex: z.number().min(0).optional(),
  // If true, only returns total case count without making LLM call
  countOnly: z.boolean().optional(),
});

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

  // Add test run name
  textParts.push(testRunMetadata.name);

  // Add description text
  const descText = extractTextFromTipTap(testRunMetadata.description);
  if (descText) textParts.push(descText);

  // Add docs text
  const docsText = extractTextFromTipTap(testRunMetadata.docs);
  if (docsText) textParts.push(docsText);

  // Add tags
  if (testRunMetadata.tags?.length) {
    textParts.push(...testRunMetadata.tags);
  }

  // Add issue titles and descriptions
  for (const issue of issues) {
    textParts.push(issue.title);
    if (issue.description) {
      const issueDesc = extractTextFromTipTap(issue.description);
      if (issueDesc) textParts.push(issueDesc);
    }
  }

  // Add clarification if provided
  if (clarification) {
    textParts.push(clarification);
  }

  // Combine all text and extract meaningful keywords
  const combinedText = textParts.join(" ");

  // Simple keyword extraction: split on whitespace and punctuation,
  // filter short words and common stop words
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "they",
    "them",
    "their",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "she",
    "him",
    "her",
    "his",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "not",
    "only",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "also",
    "now",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "test",
    "case",
    "cases",
    "run",
  ]);

  const words = combinedText
    .toLowerCase()
    .split(/[\s\-_.,;:!?()[\]{}'"<>\/\\|@#$%^&*+=~`]+/)
    .filter(
      (word) =>
        word.length >= SEARCH_CONFIG.minKeywordLength &&
        !stopWords.has(word) &&
        !/^\d+$/.test(word) // Exclude pure numbers
    );

  // Get unique keywords and limit to prevent overly long queries
  const uniqueKeywords = [...new Set(words)].slice(0, 30);

  return uniqueKeywords.join(" ");
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
            fieldOptions.find((fo) => fo.fieldOption.id === id)?.fieldOption
              .name
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
  // Format: [id, name, folder?, tags[]?, fields?, linkedTo[]?, linkedFrom[]?]
  const compressedCaseData = testCases.map((tc) => {
    const result: (
      | number
      | string
      | string[]
      | number[]
      | Record<string, string>
      | null
    )[] = [tc.id, tc.name];
    // Only include non-empty optional fields
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

  // For each selected case, add its linked cases
  for (const caseId of selectedIds) {
    const testCase = caseMap.get(caseId);
    if (testCase) {
      testCase.linksTo.forEach((linkedId) => expandedSet.add(linkedId));
      testCase.linksFrom.forEach((linkedId) => expandedSet.add(linkedId));
    }
  }

  return Array.from(expandedSet);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Log incoming request for debugging
    console.log("=== Magic Select Request Body ===");
    console.log(JSON.stringify(body, null, 2));
    console.log("=================================");

    // Validate request
    const parseResult = MagicSelectRequestSchema.safeParse(body);
    if (!parseResult.success) {
      console.log("=== Magic Select Validation Error ===");
      console.log(JSON.stringify(parseResult.error.issues, null, 2));
      console.log("=====================================");
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const {
      projectId,
      testRunMetadata,
      clarification,
      excludeCaseIds,
      batchSize,
      batchIndex,
      countOnly,
    } = parseResult.data;

    // Verify user has access to the project and check for active LLM integration
    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
            ...(isProjectAdmin
              ? [
                  {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
      include: {
        projectLlmIntegrations: {
          where: { isActive: true },
          include: {
            llmIntegration: {
              include: {
                llmProviderConfig: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const activeLlmIntegration = project.projectLlmIntegrations[0];
    if (!activeLlmIntegration) {
      return NextResponse.json(
        { error: "No active LLM integration found for this project" },
        { status: 400 }
      );
    }

    // Get total count of active test cases in repository
    const repositoryTotalCount = await prisma.repositoryCases.count({
      where: {
        projectId,
        isArchived: false,
        isDeleted: false,
      },
    });

    // Fetch linked issue details (needed for keyword extraction in both count and actual call)
    let issues: IssueData[] = [];
    if (testRunMetadata.linkedIssueIds.length > 0) {
      const issueRecords = await prisma.issue.findMany({
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

    // Use Elasticsearch to pre-filter test cases based on keywords from test run metadata
    // This significantly reduces the number of cases sent to the LLM
    let searchResultIds: number[] | null = null;
    const searchKeywords = extractSearchKeywords(
      testRunMetadata,
      issues,
      clarification
    );
    let searchPreFiltered = false;

    if (
      searchKeywords &&
      repositoryTotalCount > SEARCH_CONFIG.searchPreFilterThreshold
    ) {
      console.log("=== Magic Select Search Pre-filter ===");
      console.log("Total cases in project:", repositoryTotalCount);
      console.log("Search keywords:", searchKeywords);

      const esClient = getElasticsearchClient();
      if (!esClient) {
        console.log("Elasticsearch client not available, skipping pre-filter");
      } else {
        try {
          const indexName = getRepositoryCaseIndexName();
          console.log("Searching index:", indexName);

          // Query using text fields that support full-text search
          // Focus on the test run name words which are most relevant
          // Extract key terms from the test run name (more specific than all keywords)
          const nameTerms = testRunMetadata.name
            .toLowerCase()
            .split(/[\s\-_.,;:!?()[\]{}'"<>\/\\|@#$%^&*+=~`]+/)
            .filter((word) => word.length >= 3);
          const nameQuery = nameTerms.join(" ");

          // Build the search query
          const searchQuery = {
            bool: {
              filter: [
                { term: { projectId: projectId } },
                { term: { isArchived: false } },
              ],
              must: [
                {
                  bool: {
                    should: [
                      // Exact phrase matching on test run name (highest priority)
                      {
                        match_phrase: {
                          name: {
                            query: testRunMetadata.name,
                            boost: 20,
                          },
                        },
                      },
                      // Match on key terms from test run name
                      {
                        match: {
                          name: {
                            query: nameQuery,
                            operator: "or" as const,
                            minimum_should_match: "2", // At least 2 words must match
                            boost: 10,
                          },
                        },
                      },
                      // Searchable content with test run name terms
                      {
                        match: {
                          searchableContent: {
                            query: nameQuery,
                            operator: "or" as const,
                            minimum_should_match: "2",
                            boost: 5,
                          },
                        },
                      },
                      // Broader search with all keywords (lower priority)
                      {
                        match: {
                          searchableContent: {
                            query: searchKeywords,
                            operator: "or" as const,
                            minimum_should_match: "3", // At least 3 keywords must match
                            boost: 1,
                          },
                        },
                      },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ],
            },
          };

          console.log("Name terms for search:", nameQuery);

          // Progressive score reduction: start with configured min score, reduce if no results
          // Score thresholds to try (will stop at the first one that returns results)
          const scoreThresholds = [
            SEARCH_CONFIG.minSearchScore,
            SEARCH_CONFIG.minSearchScore * 0.5,
            SEARCH_CONFIG.minSearchScore * 0.25,
            SEARCH_CONFIG.minSearchScore * 0.1,
            1, // Very low threshold as last resort
          ];

          for (const minScore of scoreThresholds) {
            const searchResponse = await esClient.search({
              index: indexName,
              query: searchQuery,
              min_score: minScore,
              size: SEARCH_CONFIG.maxSearchResults,
              _source: false, // We only need IDs
              track_total_hits: true,
            });

            const hits = searchResponse.hits.hits;
            if (hits.length > 0) {
              searchResultIds = hits
                .filter((hit) => hit._id !== undefined)
                .map((hit) => parseInt(hit._id!, 10));
              searchPreFiltered = true;

              console.log(
                "Search returned",
                searchResultIds.length,
                "matching cases (min score:",
                minScore,
                minScore < SEARCH_CONFIG.minSearchScore
                  ? `reduced from ${SEARCH_CONFIG.minSearchScore}`
                  : "",
                ")"
              );

              // Log score distribution for debugging
              const scores = hits.map((h) => h._score ?? 0);
              console.log(
                "Score range:",
                Math.min(...scores).toFixed(2),
                "-",
                Math.max(...scores).toFixed(2)
              );
              break;
            } else if (minScore === scoreThresholds[scoreThresholds.length - 1]) {
              // Last threshold and still no results
              console.log(
                "Search returned no results even at minimum score threshold (",
                minScore,
                "), using all available cases"
              );
            } else {
              console.log(
                "No results at min_score",
                minScore,
                "- trying lower threshold..."
              );
            }
          }
        } catch (searchError) {
          console.error(
            "Elasticsearch search failed, falling back to database query:",
            searchError
          );
        }
      }

      console.log("=== End Search Pre-filter ===\n");
    }

    // Calculate the effective count (after search filtering)
    const effectiveCaseCount = searchResultIds
      ? searchResultIds.length
      : repositoryTotalCount;

    // Determine if we hit limits or found no matches
    const hitMaxSearchResults =
      searchResultIds !== null &&
      searchResultIds.length >= SEARCH_CONFIG.maxSearchResults;
    const noSearchMatches =
      searchPreFiltered &&
      searchResultIds !== null &&
      searchResultIds.length === 0;

    // If countOnly is true, return the filtered count and search info
    if (countOnly) {
      return NextResponse.json({
        success: true,
        totalCaseCount: effectiveCaseCount, // This is now the filtered count
        repositoryTotalCount, // Original total for display
        searchPreFiltered,
        searchKeywords: searchPreFiltered ? searchKeywords : undefined,
        hitMaxSearchResults, // True if search results were capped at max
        noSearchMatches, // True if search was performed but found no matches
        batchesNeeded: batchSize
          ? Math.ceil(effectiveCaseCount / batchSize)
          : 1,
      });
    }

    // Build the where clause for test cases
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

    // If we have search results, filter to only those IDs
    // Otherwise, if the total is too large, limit the query
    if (searchResultIds) {
      testCaseWhere.id = { in: searchResultIds };
    }

    // Fetch test cases (either search-filtered or all)
    const repositoryCases = await prisma.repositoryCases.findMany({
      where: testCaseWhere,
      include: {
        folder: {
          select: {
            name: true,
            parent: {
              select: {
                name: true,
                parent: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        tags: {
          select: {
            name: true,
          },
        },
        caseFieldValues: {
          include: {
            field: {
              select: {
                displayName: true,
                systemName: true,
                type: {
                  select: {
                    type: true,
                  },
                },
                fieldOptions: {
                  select: {
                    fieldOption: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        linksFrom: {
          where: { isDeleted: false },
          select: {
            caseBId: true,
          },
        },
        linksTo: {
          where: { isDeleted: false },
          select: {
            caseAId: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    if (repositoryCases.length === 0) {
      return NextResponse.json({
        success: true,
        suggestedCaseIds: [],
        reasoning: "No test cases found in the repository",
        metadata: {
          totalCasesAnalyzed: 0,
          suggestedCount: 0,
          model: "",
          tokens: { prompt: 0, completion: 0, total: 0 },
        },
      });
    }

    // Compress test cases for LLM context
    const compressedCases: CompressedTestCase[] = repositoryCases.map((tc) => {
      // Process field values - resolve IDs to names, convert TipTap to text
      const fields: Record<string, string> = {};
      for (const cfv of tc.caseFieldValues) {
        const fieldName = cfv.field?.displayName || cfv.field?.systemName;
        if (!fieldName) continue;

        const fieldType = cfv.field?.type?.type;
        const fieldOptions = cfv.field?.fieldOptions;
        const processedValue = processFieldValue(
          cfv.value,
          fieldType,
          fieldOptions
        );

        if (processedValue) {
          fields[fieldName] = processedValue;
        }
      }

      return {
        id: tc.id,
        name: truncateText(tc.name, TRUNCATION_LIMITS.testCaseName),
        folderPath: buildFolderPath(tc.folder),
        tags: tc.tags.map((t) => t.name),
        fields,
        linksTo: tc.linksFrom.map((l) => l.caseBId),
        linksFrom: tc.linksTo.map((l) => l.caseAId),
      };
    });

    const manager = LlmManager.getInstance(prisma);

    // Build the prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(
      testRunMetadata,
      issues,
      compressedCases,
      clarification
    );

    // Log the prompts for debugging
    console.log("=== Magic Select LLM Request ===");
    console.log("Project ID:", projectId);
    console.log("Test Run Name:", testRunMetadata.name);
    console.log("Total Cases:", compressedCases.length);
    console.log("Linked Issues:", issues.length);
    console.log("\n--- System Prompt ---");
    console.log(systemPrompt);
    console.log("\n--- User Prompt ---");
    console.log(userPrompt);
    console.log("=== End Magic Select LLM Request ===\n");

    // Use configured max tokens
    const configuredMaxTokens =
      activeLlmIntegration.llmIntegration.llmProviderConfig?.defaultMaxTokens ||
      4000;
    const maxTokens = Math.max(configuredMaxTokens, 2000);

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent selections
      maxTokens,
      userId: session.user.id,
      feature: "magic_select_cases",
      metadata: {
        projectId,
        testRunName: testRunMetadata.name,
        totalCases: compressedCases.length,
        linkedIssues: testRunMetadata.linkedIssueIds.length,
        timestamp: new Date().toISOString(),
      },
      // Allow up to 4 minutes for large repositories (under the 5-minute maxDuration)
      timeout: 240000,
    };

    const response = await manager.chat(
      activeLlmIntegration.llmIntegrationId,
      llmRequest
    );

    // Parse the LLM response
    let suggestedCaseIds: number[] = [];
    let reasoning = "";

    try {
      const cleanContent = response.content.trim();

      // Try to extract JSON from the response
      let jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        // Try code blocks
        const codeBlockMatch = cleanContent.match(
          /```(?:json)?\s*(\{[\s\S]*?\})\s*```/
        );
        if (codeBlockMatch) {
          jsonMatch = [codeBlockMatch[1]];
        }
      }

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (Array.isArray(parsed.caseIds)) {
          // Validate that all IDs exist in the repository
          const validIds = new Set(compressedCases.map((tc) => tc.id));
          suggestedCaseIds = parsed.caseIds.filter(
            (id: unknown) => typeof id === "number" && validIds.has(id)
          );
        }

        if (typeof parsed.reasoning === "string") {
          reasoning = parsed.reasoning;
        }
      }
    } catch (parseError) {
      console.error("Failed to parse LLM response:", parseError);
      return NextResponse.json(
        {
          error: "Failed to parse AI response",
          details:
            "The AI response was not in the expected format. Please try again.",
        },
        { status: 500 }
      );
    }

    // Expand linked cases
    const expandedCaseIds = expandLinkedCases(
      suggestedCaseIds,
      compressedCases
    );

    // Filter out any excluded cases
    const finalCaseIds = excludeCaseIds
      ? expandedCaseIds.filter((id) => !excludeCaseIds.includes(id))
      : expandedCaseIds;

    return NextResponse.json({
      success: true,
      suggestedCaseIds: finalCaseIds,
      reasoning,
      metadata: {
        totalCasesAnalyzed: compressedCases.length,
        repositoryTotalCount,
        effectiveCaseCount,
        suggestedCount: finalCaseIds.length,
        directlySelected: suggestedCaseIds.length,
        linkedCasesAdded: finalCaseIds.length - suggestedCaseIds.length,
        searchPreFiltered,
        searchKeywords: searchPreFiltered ? searchKeywords : undefined,
        model: response.model,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
        // Pagination info
        batchIndex: batchIndex ?? 0,
        batchSize: batchSize ?? effectiveCaseCount,
        totalBatches: batchSize ? Math.ceil(effectiveCaseCount / batchSize) : 1,
      },
    });
  } catch (error) {
    console.error("Magic select error:", error);

    // Extract error details for better user feedback
    const llmError = error as {
      code?: string;
      statusCode?: number;
      message?: string;
      retryable?: boolean;
    };

    // Determine appropriate status code and user-friendly message
    let statusCode = 500;
    let userMessage = "Failed to select test cases";
    let details = error instanceof Error ? error.message : "Unknown error";

    if (llmError.code) {
      switch (llmError.code) {
        case "RATE_LIMIT_EXCEEDED":
          statusCode = 429;
          userMessage = "Rate limit exceeded";
          details =
            "The AI service has reached its rate limit. Please wait a moment and try again.";
          break;
        case "AUTHENTICATION_ERROR":
          statusCode = 401;
          userMessage = "Authentication failed";
          details =
            "The AI service API key is invalid or expired. Please check your LLM integration settings.";
          break;
        case "PERMISSION_DENIED":
          statusCode = 403;
          userMessage = "Permission denied";
          details =
            "Access to the AI service was denied. Please verify your API key has the required permissions.";
          break;
        case "CONTENT_BLOCKED":
          statusCode = 400;
          userMessage = "Content filtered";
          details =
            "The request was blocked by safety filters. Try modifying the test run name or description.";
          break;
        case "MAX_TOKENS":
        case "MAX_TOKENS_EXCEEDED":
          statusCode = 400;
          userMessage = "Response too long";
          details =
            "The AI response was truncated. Try reducing the number of test cases or increase token limits in LLM settings.";
          break;
        case "TIMEOUT":
          statusCode = 408;
          userMessage = "Request timed out";
          details =
            "The AI service took too long to respond. This may happen with large test case repositories. Please try again.";
          break;
        case "SERVER_ERROR":
          statusCode = 502;
          userMessage = "AI service unavailable";
          details =
            "The AI service is temporarily unavailable. Please try again in a few minutes.";
          break;
        case "API_ERROR":
          // Generic API error - use the original message which often has useful details
          statusCode = llmError.statusCode || 500;
          userMessage = "AI service error";
          // Keep the original detailed message
          break;
        default:
          // Keep original message for unknown errors
          break;
      }
    }

    return NextResponse.json(
      {
        error: userMessage,
        details,
        code: llmError.code,
        retryable: llmError.retryable ?? false,
      },
      { status: statusCode }
    );
  }
}
