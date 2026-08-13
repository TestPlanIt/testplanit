"use server";

import type {
  RepositoryCasesFindManyArgs,
  RepositoryCasesGetPayload,
  RepositoryCasesSelect,
  RepositoryCasesWhereInput,
} from "~/zenstack/input";
import { baseDb } from "~/lib/db";
import {
  filterOrphanedFieldValues,
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "~/lib/repositoryCaseFieldMatchers";
import { reviveWhereFromTransport } from "~/lib/repository/whereTransport";
import { resolveSharedSteps } from "~/lib/utils/resolveSharedSteps";
import { getServerAuthSession } from "~/server/auth";

// Define the arguments type based on Prisma generated types
interface FetchCasesArgs {
  orderBy: NonNullable<RepositoryCasesFindManyArgs["orderBy"]>;
  where: RepositoryCasesWhereInput;
  scope?: "allFiltered" | "allProject"; // Add scope indicator
  projectId?: number; // Add projectId, needed for allProject scope
  // Active text/link/steps operator filters — SQL can only pre-filter these
  // (value-not-null); the real row selection happens via the shared matchers,
  // exactly as the table hooks apply them.
  postFetchFilters?: PostFetchFilter[];
  // Elasticsearch id set of an active search. "All filtered" must mean the
  // intersection the table shows, never the un-searched superset.
  searchCaseIds?: number[];
}

// Define the precise select clause to match the client-side query
const exportSelectClause = {
  id: true,
  projectId: true,
  project: true,
  creator: true,
  folder: true,
  repositoryId: true,
  folderId: true,
  templateId: true,
  name: true,
  className: true,
  source: true,
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
    orderBy: { createdAt: "desc" as const }, // Use 'as const' for literals in orderBy
    where: { isDeleted: false },
  },
  steps: {
    where: { isDeleted: false },
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      step: true,
      expectedResult: true,
      order: true,
      isDeleted: true,
      sharedStepGroupId: true,
    },
  },
  caseTags: {
    where: {
      tag: {
        isDeleted: false,
      },
    },
    include: {
      tag: true,
    },
  },
  caseIssues: {
    where: {
      issue: {
        isDeleted: false,
      },
    },
    include: {
      issue: true,
    },
  },
  // Include the testRuns relation for export
  testRuns: {
    select: {
      id: true, // Include TestRunCases id
      testRun: {
        select: {
          id: true, // Include TestRuns id
          name: true,
        },
      },
    },
  },
  // Add linksFrom and linksTo for linked cases
  linksFrom: {
    select: {
      caseB: { select: { name: true, isDeleted: true } },
      isDeleted: true,
    },
  },
  linksTo: {
    select: {
      caseA: { select: { name: true, isDeleted: true } },
      isDeleted: true,
    },
  },
} satisfies RepositoryCasesSelect; // Satisfies helps ensure the select matches the type

// Define the return type based on the select clause
export type ExportCaseData = RepositoryCasesGetPayload<{
  select: typeof exportSelectClause;
}>;

// Define a new response type for the fetchAllCasesForExport function
export type FetchCasesResponse =
  | { success: true; data: ExportCaseData[] }
  | { success: false; error: string; data: [] }; // Ensure data is empty array on error

/**
 * Fetches repository cases matching the given criteria for export.
 * Handles fetching either a filtered list or all cases in the project.
 * @param args - Object containing orderBy, where, scope, and projectId.
 * @returns An array of repository cases matching the criteria, or an empty array on error.
 */
export async function fetchAllCasesForExport(
  args: FetchCasesArgs
): Promise<FetchCasesResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated", data: [] };
  }

  try {
    // The client's where carries ZenStack's Json-null sentinels, which React
    // Flight cannot encode — without this they arrive as opaque temporary
    // references and ZenStack rejects the whole query, so every export with a
    // custom-field filter active came back empty.
    let finalWhereClause = reviveWhereFromTransport(args.where);

    // If scope is allProject, override the where clause
    if (args.scope === "allProject") {
      if (!args.projectId) {
        console.error(
          "Server Action Error: projectId is required for 'allProject' scope."
        );
        return { success: false, error: "projectId is required", data: [] };
      }
      finalWhereClause = {
        projectId: args.projectId,
        isDeleted: false, // Ensure basic filters are applied
        isArchived: false, // Might want to include archived? Check requirements.
        // Add any other essential base conditions if needed
      };
      // console.log(
      //   "Server Action: Fetching ALL project cases. Overriding where clause to:",
      //   finalWhereClause
      // );
    } else {
      // console.log(
      //   "Server Action: Fetching FILTERED cases for export with where clause:",
      //   args.where
      // );
      if (args.searchCaseIds) {
        finalWhereClause = {
          AND: [finalWhereClause, { id: { in: args.searchCaseIds } }],
        };
      }
    }

    let allDataRaw = await baseDb.repositoryCases.findMany({
      where: finalWhereClause, // Use the determined where clause
      orderBy: args.orderBy,
      select: exportSelectClause,
    });
    // Apply the table's post-fetch text/link/steps matchers so the export row
    // set matches what the filtered table shows. Runs BEFORE shared-step
    // expansion: steps filters count shared-group placeholders as one step,
    // like the table's steps select. "allProject" scope ignores filters, same
    // as it ignores the where clause. Matching is done against the
    // orphan-filtered view of each row (as the table hooks do) without
    // altering the exported row content.
    if (
      args.scope !== "allProject" &&
      args.postFetchFilters &&
      args.postFetchFilters.length > 0
    ) {
      const postFetchFilters = args.postFetchFilters;
      allDataRaw = allDataRaw.filter((row: any) =>
        matchesPostFetchFilters(
          filterOrphanedFieldValues(row),
          postFetchFilters
        )
      );
    }
    // Resolve shared step references (expand placeholders into actual step items)
    const allData = await resolveSharedSteps(allDataRaw);
    // Cast source to RepositoryCaseSource for type safety
    const mappedData = await Promise.all(
      allData.map(async (item: any) => {
        // Collect all linked case names (not deleted)
        const fromNames = (item.linksFrom || [])
          .filter((l: any) => !l.isDeleted && l.caseB && !l.caseB.isDeleted)
          .map((l: any) => l.caseB.name);
        const toNames = (item.linksTo || [])
          .filter((l: any) => !l.isDeleted && l.caseA && !l.caseA.isDeleted)
          .map((l: any) => l.caseA.name);
        const allNames = Array.from(new Set([...fromNames, ...toNames])).filter(
          Boolean
        );
        return {
          ...item,
          source: item.source as any,
          linkedCases: allNames.join(", ") || "",
        };
      })
    );
    return { success: true, data: mappedData }; // Return success response
  } catch (error) {
    console.error(
      "Server Action Error: Failed to fetch cases for export:",
      error
    );
    // Return error response
    return {
      success: false,
      error: "Failed to fetch cases for export",
      data: [],
    };
  }
}
