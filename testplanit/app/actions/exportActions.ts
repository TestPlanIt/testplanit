"use server";

import { prisma } from "~/lib/prisma";
import { Prisma } from "@prisma/client";
import { getServerAuthSession } from "~/server/auth";

// Define the arguments type based on Prisma generated types
interface FetchCasesArgs {
  orderBy: Prisma.RepositoryCasesOrderByWithRelationInput;
  where: Prisma.RepositoryCasesWhereInput;
  scope?: "allFiltered" | "allProject"; // Add scope indicator
  projectId?: number; // Add projectId, needed for allProject scope
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
} satisfies Prisma.RepositoryCasesSelect; // Satisfies helps ensure the select matches the type

// Define the return type based on the select clause
export type ExportCaseData = Prisma.RepositoryCasesGetPayload<{
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
    let finalWhereClause = args.where;

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
    }

    const allData = await prisma.repositoryCases.findMany({
      where: finalWhereClause, // Use the determined where clause
      orderBy: args.orderBy,
      select: exportSelectClause,
    });
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
