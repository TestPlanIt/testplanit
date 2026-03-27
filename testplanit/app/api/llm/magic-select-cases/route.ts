import { prisma } from "@/lib/prisma";
import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authOptions } from "~/server/auth";
import {
  getElasticsearchClient,
  getRepositoryCaseIndexName
} from "~/services/elasticsearchService";

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
  // If true, only returns total case count without making LLM call
  countOnly: z.boolean().optional(),
});

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

// Search configuration for pre-filtering test cases (configurable via env vars)
const SEARCH_CONFIG = {
  searchPreFilterThreshold: parseEnvInt(process.env.MAGIC_SELECT_SEARCH_THRESHOLD, 250),
  minKeywordLength: parseEnvInt(process.env.MAGIC_SELECT_MIN_KEYWORD_LENGTH, 3),
  minSearchScore: parseEnvFloat(process.env.MAGIC_SELECT_MIN_SEARCH_SCORE, 50.0),
  maxSearchResults: parseEnvInt(process.env.MAGIC_SELECT_MAX_SEARCH_RESULTS, 2000),
};

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
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
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
                            minimum_should_match: "1",
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
                            minimum_should_match: "1",
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
                            minimum_should_match: "1",
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
      });
    }

    // Full analysis has moved to the background worker.
    // Use POST /api/llm/magic-select-cases/submit to start a job.
    return NextResponse.json(
      { error: "Full analysis has been moved to background processing. Use /api/llm/magic-select-cases/submit to start a job." },
      { status: 410 }
    );
  } catch (error) {
    console.error("Magic select error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

