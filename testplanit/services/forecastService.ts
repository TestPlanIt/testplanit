"use server";

import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/prisma";

type UpdateRepositoryCaseForecastOptions = {
  skipTestRunUpdate?: boolean;
  collectAffectedTestRuns?: boolean;
  prismaClient?: PrismaClient; // Optional: use provided client for multi-tenant support
};

type UpdateRepositoryCaseForecastResult = {
  updatedCaseIds: number[];
  affectedTestRunIds: number[];
};

type UpdateTestRunForecastOptions = {
  alreadyRefreshedCaseIds?: Set<number>;
  prismaClient?: PrismaClient; // Optional: use provided client for multi-tenant support
};

type GetUniqueCaseGroupIdsOptions = {
  prismaClient?: PrismaClient; // Optional: use provided client for multi-tenant support
};

/**
 * Calculates the group-averaged forecast for a repository case and all cases linked by SAME_TEST_DIFFERENT_SOURCE.
 * Updates forecastManual and forecastAutomated for all cases in the group.
 * @param repositoryCaseId The ID of the RepositoryCase to update.
 * @returns The unique RepositoryCase IDs whose forecasts were refreshed and affected TestRun IDs.
 */
export async function updateRepositoryCaseForecast(
  repositoryCaseId: number,
  options: UpdateRepositoryCaseForecastOptions = {}
): Promise<UpdateRepositoryCaseForecastResult> {
  const prisma = options.prismaClient || defaultPrisma;

  if (process.env.DEBUG_FORECAST) {
    console.log(
      `Calculating group forecast for RepositoryCase ID: ${repositoryCaseId}`
    );
  }

  try {
    // 1. Find all cases in the SAME_TEST_DIFFERENT_SOURCE link group (including itself)
    const caseAndLinks = await prisma.repositoryCases.findUnique({
      where: { id: repositoryCaseId },
      select: {
        id: true,
        source: true,
        linksFrom: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseBId: true },
        },
        linksTo: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseAId: true },
        },
      },
    });
    if (!caseAndLinks) return { updatedCaseIds: [], affectedTestRunIds: [] };
    const linkedIds = [
      caseAndLinks.id,
      ...caseAndLinks.linksFrom.map((l) => l.caseBId),
      ...caseAndLinks.linksTo.map((l) => l.caseAId),
    ];
    const uniqueCaseIds = Array.from(new Set(linkedIds));
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] Group case IDs:", uniqueCaseIds);

    // 2. Fetch all cases in the group with their source
    const allCases = await prisma.repositoryCases.findMany({
      where: { id: { in: uniqueCaseIds } },
      select: { id: true, source: true },
    });
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] allCases:", allCases);

    // 3. Gather all manual and JUNIT result durations
    // Manual: TestRunResults (isDeleted: false, elapsed > 0)
    const manualCaseIds = allCases
      .filter((c) => c.source === "MANUAL")
      .map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualCaseIds:", manualCaseIds);
    let manualResults: { elapsed: number | null }[] = [];
    if (manualCaseIds.length) {
      // 1. Find all TestRunCase IDs for these repositoryCaseIds
      const testRunCases = await prisma.testRunCases.findMany({
        where: { repositoryCaseId: { in: manualCaseIds } },
        select: { id: true },
      });
      const testRunCaseIds = testRunCases.map((trc) => trc.id);

      // 2. Find all TestRunResults for those TestRunCase IDs
      manualResults = testRunCaseIds.length
        ? await prisma.testRunResults.findMany({
            where: {
              testRunCaseId: { in: testRunCaseIds },
              isDeleted: false,
              elapsed: { gt: 0 },
            },
            select: { elapsed: true },
          })
        : [];
    }
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualResults:", manualResults);
    const manualDurations = manualResults
      .map((r) => r.elapsed)
      .filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualDurations:", manualDurations);

    // JUNIT: JUnitTestResult (statusId not null, time > 0)
    const junitCaseIds = allCases
      .filter((c) => c.source === "JUNIT")
      .map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitCaseIds:", junitCaseIds);
    const junitResults = junitCaseIds.length
      ? await prisma.jUnitTestResult.findMany({
          where: {
            repositoryCaseId: { in: junitCaseIds },
            time: { gt: 0 },
          },
          select: { time: true },
        })
      : [];
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitResults:", junitResults);
    const junitDurations = junitResults
      .map((r) => r.time)
      .filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitDurations:", junitDurations);

    // 4. Compute averages
    const avgManual =
      manualDurations.length > 0
        ? Math.round(
            manualDurations.reduce((a, b) => a + b, 0) / manualDurations.length
          )
        : null;
    const avgJunit =
      junitDurations.length > 0
        ? parseFloat(
            (
              junitDurations.reduce((a, b) => a + b, 0) / junitDurations.length
            ).toFixed(3)
          )
        : null;
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] avgManual:", avgManual, "avgJunit:", avgJunit);

    // 5. Update all cases in the group (using updateMany can reset fields to defaults, so we use individual updates)
    for (const caseId of uniqueCaseIds) {
      await prisma.repositoryCases.update({
        where: { id: caseId },
        data: {
          forecastManual: avgManual,
          forecastAutomated: avgJunit,
        },
      });
    }
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Updated forecastManual=${avgManual}, forecastAutomated=${avgJunit} for cases: [${uniqueCaseIds.join(", ")}]`
      );
    }

    // --- Update TestRun forecasts for all TestRuns affected by these case updates ---
    const affectedTestRunCases = await prisma.testRunCases.findMany({
      where: {
        repositoryCaseId: { in: uniqueCaseIds },
      },
      select: {
        testRunId: true,
      },
    });

    const uniqueAffectedTestRunIds = Array.from(
      new Set(affectedTestRunCases.map((trc) => trc.testRunId))
    );

    // If not skipping, update TestRuns now; otherwise just collect their IDs
    if (!options.skipTestRunUpdate && uniqueAffectedTestRunIds.length > 0) {
      for (const testRunId of uniqueAffectedTestRunIds) {
        await updateTestRunForecast(testRunId, {
          alreadyRefreshedCaseIds: new Set(uniqueCaseIds),
          prismaClient: prisma,
        });
      }
    }
    // --- End TestRun forecast update ---

    return {
      updatedCaseIds: uniqueCaseIds,
      affectedTestRunIds: options.collectAffectedTestRuns ? uniqueAffectedTestRunIds : [],
    };
  } catch (error) {
    console.error(
      `Error updating group forecast for RepositoryCase ID ${repositoryCaseId}:`,
      error
    );
    throw error;
  }
}

/**
 * Calculates and updates the forecast for a specific TestRun.
 * @param testRunId The ID of the TestRun to update.
 */
export async function updateTestRunForecast(
  testRunId: number,
  options: UpdateTestRunForecastOptions = {}
): Promise<void> {
  const prisma = options.prismaClient || defaultPrisma;

  if (process.env.DEBUG_FORECAST) console.log(`Updating forecast for TestRun ID: ${testRunId}`);
  try {
    // 1. Fetch all TestRunCases for this TestRun, including their status system name
    let testRunCasesWithDetails = await prisma.testRunCases.findMany({
      where: { testRunId: testRunId },
      select: {
        repositoryCaseId: true,
        status: {
          select: {
            systemName: true,
          },
        },
      },
    });

    // Ensure repository case forecasts are current before recalculating the run forecast
    if (testRunCasesWithDetails.length > 0) {
      const processedCaseIds = new Set<number>(
        options.alreadyRefreshedCaseIds
          ? Array.from(options.alreadyRefreshedCaseIds)
          : []
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
          { skipTestRunUpdate: true, prismaClient: prisma }
        );

        if (result.updatedCaseIds.length > 0) {
          refreshedAnyCase = true;
          for (const refreshedId of result.updatedCaseIds) {
            processedCaseIds.add(refreshedId);
          }
        }
      }

      if (refreshedAnyCase) {
        // Refetch to capture any status changes that may have occurred during case refresh
        testRunCasesWithDetails = await prisma.testRunCases.findMany({
          where: { testRunId: testRunId },
          select: {
            repositoryCaseId: true,
            status: {
              select: {
                systemName: true,
              },
            },
          },
        });
      }
    }

    // 2. Filter cases to include only those with no result or an "untested" status
    const repositoryCaseIdsToForecast = testRunCasesWithDetails
      .filter(
        (trc) => trc.status === null || trc.status?.systemName === "UNTESTED"
      )
      .map((trc) => trc.repositoryCaseId);

    if (!repositoryCaseIdsToForecast.length) {
      // No applicable cases in this test run, so clear its forecasts
      await prisma.testRuns.update({
        where: { id: testRunId },
        data: {
          forecastManual: null,
          forecastAutomated: null,
        },
      });
      if (process.env.DEBUG_FORECAST) {
        console.log(
          `Cleared forecasts for TestRun ID: ${testRunId} as no pending/untested cases were found`
        );
      }
      return;
    }

    // 3. Fetch the RepositoryCases for these filtered IDs
    const repositoryCases = await prisma.repositoryCases.findMany({
      where: { id: { in: repositoryCaseIdsToForecast } },
      select: { forecastManual: true, forecastAutomated: true },
    });

    // 4. Calculate the sum of forecasts
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

    // 5. Update the TestRun record
    await prisma.testRuns.update({
      where: { id: testRunId },
      data: {
        forecastManual: hasManual ? totalForecastManual : null,
        forecastAutomated: hasAutomated
          ? parseFloat(totalForecastAutomated.toFixed(3))
          : null,
      },
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

/**
 * Fetches all RepositoryCase IDs that are not deleted or archived.
 * @param options Optional options including prismaClient for multi-tenant support
 * @returns An array of active RepositoryCase IDs.
 */
export async function getActiveRepositoryCaseIds(
  options: GetUniqueCaseGroupIdsOptions = {}
): Promise<number[]> {
  const prisma = options.prismaClient || defaultPrisma;

  if (process.env.DEBUG_FORECAST) console.log("Fetching active repository case IDs...");
  try {
    const cases = await prisma.repositoryCases.findMany({
      where: {
        isDeleted: false,
        isArchived: false,
      },
      select: {
        id: true,
      },
    });
    const ids = cases.map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log(`Found ${ids.length} active repository cases.`);
    return ids;
  } catch (error) {
    console.error("Error fetching active repository case IDs:", error);
    throw error; // Propagate error
  }
}

/**
 * Fetches unique case group representatives to avoid recalculating the same linked groups.
 * For each group of cases linked by SAME_TEST_DIFFERENT_SOURCE, returns only one representative case ID.
 * Processes cases in batches to avoid hitting database bind variable limits.
 * @param options Optional options including prismaClient for multi-tenant support
 * @returns An array of representative RepositoryCase IDs, one per unique group.
 */
export async function getUniqueCaseGroupIds(
  options: GetUniqueCaseGroupIdsOptions = {}
): Promise<number[]> {
  const prisma = options.prismaClient || defaultPrisma;

  if (process.env.DEBUG_FORECAST) console.log("Fetching unique case group representatives...");
  try {
    const BATCH_SIZE = 1000;
    const processedCaseIds = new Set<number>();
    const uniqueRepresentatives: number[] = [];

    // First, get all active case IDs
    const allCaseIds = await prisma.repositoryCases.findMany({
      where: {
        isDeleted: false,
        isArchived: false,
      },
      select: {
        id: true,
      },
    });

    const totalCases = allCaseIds.length;
    if (process.env.DEBUG_FORECAST) console.log(`Processing ${totalCases} active cases in batches of ${BATCH_SIZE}...`);

    // Process in batches to avoid bind variable limit
    for (let i = 0; i < allCaseIds.length; i += BATCH_SIZE) {
      const batchIds = allCaseIds.slice(i, i + BATCH_SIZE).map((c) => c.id);

      const casesWithLinks = await prisma.repositoryCases.findMany({
        where: {
          id: { in: batchIds },
        },
        select: {
          id: true,
          linksFrom: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseBId: true },
          },
          linksTo: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseAId: true },
          },
        },
      });

      for (const caseData of casesWithLinks) {
        // Skip if we've already processed this case as part of another group
        if (processedCaseIds.has(caseData.id)) {
          continue;
        }

        // This case becomes the representative for its group
        uniqueRepresentatives.push(caseData.id);

        // Mark all cases in this group as processed
        const linkedIds = [
          caseData.id,
          ...caseData.linksFrom.map((l) => l.caseBId),
          ...caseData.linksTo.map((l) => l.caseAId),
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

// Optional: Disconnect Prisma client on exit (important for graceful shutdown)
// This might be better handled in the worker's shutdown process
// process.on('exit', async () => {
//   await prisma.$disconnect();
// });
