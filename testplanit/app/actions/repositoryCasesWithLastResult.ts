"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { Prisma } from "@prisma/client";
import { computeLastTestResult } from "~/lib/utils/computeLastTestResult";

// Re-export types from the utility for convenience
export type { LastTestResult } from "~/lib/utils/computeLastTestResult";

/**
 * Arguments for fetching repository cases with computed last test result.
 */
export interface FetchCasesWithLastResultArgs {
  where: Prisma.RepositoryCasesWhereInput;
  orderBy?: Prisma.RepositoryCasesOrderByWithRelationInput;
  skip?: number;
  take?: number;
  /** When set, sorts results by lastTestResult.executedAt instead of orderBy */
  sortByLastResult?: "asc" | "desc";
}

/**
 * Response type for the server action.
 */
export type FetchCasesWithLastResultResponse =
  | { success: true; data: any[] }
  | { success: false; error: string; data: [] };

/**
 * Select clause for fetching repository cases with all fields needed for display,
 * plus the testRuns and junitResults needed to compute lastTestResult.
 */
const repositoryCaseSelectClause = {
  id: true,
  projectId: true,
  project: true,
  creator: true,
  folder: true,
  repositoryId: true,
  folderId: true,
  templateId: true,
  name: true,
  stateId: true,
  estimate: true,
  forecastManual: true,
  forecastAutomated: true,
  order: true,
  createdAt: true,
  creatorId: true,
  automated: true,
  isArchived: true,
  isDeleted: true,
  currentVersion: true,
  source: true,
  state: {
    select: {
      id: true,
      name: true,
      icon: {
        select: {
          name: true,
        },
      },
      color: {
        select: {
          value: true,
        },
      },
    },
  },
  template: {
    select: {
      id: true,
      templateName: true,
      caseFields: {
        select: {
          caseField: {
            select: {
              id: true,
              defaultValue: true,
              displayName: true,
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
                      icon: true,
                      iconColor: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  caseFieldValues: {
    select: {
      id: true,
      value: true,
      fieldId: true,
      field: {
        select: {
          id: true,
          displayName: true,
          type: {
            select: {
              type: true,
            },
          },
        },
      },
    },
    where: { field: { isEnabled: true, isDeleted: false } },
  },
  attachments: {
    orderBy: { createdAt: "desc" as const },
    where: { isDeleted: false },
  },
  steps: {
    where: {
      isDeleted: false,
      OR: [{ sharedStepGroupId: null }, { sharedStepGroup: { isDeleted: false } }],
    },
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      order: true,
      step: true,
      expectedResult: true,
      sharedStepGroupId: true,
      sharedStepGroup: {
        select: {
          name: true,
        },
      },
    },
  },
  tags: {
    where: {
      isDeleted: false,
    },
  },
  issues: {
    where: {
      isDeleted: false,
    },
    include: {
      integration: true,
    },
  },
  // For computing lastTestResult - fetch latest result from each test run
  testRuns: {
    select: {
      id: true,
      testRun: {
        select: {
          id: true,
          name: true,
          projectId: true,
          isDeleted: true,
          isCompleted: true,
        },
      },
      results: {
        select: {
          id: true,
          executedAt: true,
          status: {
            select: {
              id: true,
              name: true,
              color: {
                select: {
                  value: true,
                },
              },
            },
          },
        },
        where: {
          isDeleted: false,
        },
        orderBy: {
          executedAt: "desc" as const,
        },
        take: 1,
      },
    },
  },
  linksFrom: {
    select: {
      caseBId: true,
      type: true,
      isDeleted: true,
    },
  },
  linksTo: {
    select: {
      caseAId: true,
      type: true,
      isDeleted: true,
    },
  },
  // For computing lastTestResult - fetch latest JUnit result
  junitResults: {
    select: {
      id: true,
      executedAt: true,
      status: {
        select: {
          id: true,
          name: true,
          color: {
            select: {
              value: true,
            },
          },
        },
      },
      testSuite: {
        select: {
          id: true,
          testRun: {
            select: {
              id: true,
              name: true,
              isDeleted: true,
            },
          },
        },
      },
    },
    orderBy: {
      executedAt: "desc" as const,
    },
    take: 1,
  },
  _count: {
    select: {
      comments: {
        where: {
          isDeleted: false,
        },
      },
    },
  },
} satisfies Prisma.RepositoryCasesSelect;

/**
 * Fetches repository cases with computed last test result.
 * This moves the lastTestResult computation from client-side to server-side,
 * enabling server-side sorting by last result date.
 *
 * @param args - Query arguments including where, orderBy, pagination, and sortByLastResult
 * @returns Promise resolving to success/error response with cases data
 */
export async function fetchRepositoryCasesWithLastResult(
  args: FetchCasesWithLastResultArgs
): Promise<FetchCasesWithLastResultResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: [] };
  }

  try {
    // When sorting by lastTestResult, we need to fetch all results first,
    // then sort, then apply pagination. This is because lastTestResult is computed.
    const shouldFetchAll = !!args.sortByLastResult;

    const cases = await prisma.repositoryCases.findMany({
      where: args.where,
      orderBy: args.sortByLastResult ? undefined : args.orderBy,
      skip: shouldFetchAll ? undefined : args.skip,
      take: shouldFetchAll ? undefined : args.take,
      select: repositoryCaseSelectClause,
    });

    // Compute lastTestResult for each case
    const casesWithLastResult = cases.map((caseItem) => {
      const lastTestResult = computeLastTestResult(caseItem);
      return { ...caseItem, lastTestResult };
    });

    // If sorting by last result, sort server-side then apply pagination
    if (args.sortByLastResult) {
      casesWithLastResult.sort((a, b) => {
        const aDate = a.lastTestResult?.executedAt?.getTime() ?? 0;
        const bDate = b.lastTestResult?.executedAt?.getTime() ?? 0;
        return args.sortByLastResult === "asc" ? aDate - bDate : bDate - aDate;
      });

      // Apply pagination after sorting
      const skip = args.skip ?? 0;
      const take = args.take;
      if (take !== undefined) {
        return {
          success: true,
          data: casesWithLastResult.slice(skip, skip + take),
        };
      }
    }

    return { success: true, data: casesWithLastResult };
  } catch (error) {
    console.error("Failed to fetch cases with last result:", error);
    return { success: false, error: "Failed to fetch cases", data: [] };
  }
}

/**
 * Counts repository cases matching the given where clause.
 * Used for pagination when sorting by lastTestResult.
 *
 * @param where - Prisma where clause for filtering cases
 * @returns Promise resolving to the count
 */
export async function countRepositoryCasesWithLastResult(
  where: Prisma.RepositoryCasesWhereInput
): Promise<{ success: true; count: number } | { success: false; error: string; count: 0 }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", count: 0 };
  }

  try {
    const count = await prisma.repositoryCases.count({ where });
    return { success: true, count };
  } catch (error) {
    console.error("Failed to count cases:", error);
    return { success: false, error: "Failed to count cases", count: 0 };
  }
}
