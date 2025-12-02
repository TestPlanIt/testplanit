"use server";
import type { TestRunCases, RepositoryCases } from "@prisma/client";
import { prisma } from "~/lib/prismaBase";

// Define a type for the structure returned by the findMany query
type TestRunCaseWithForecast = TestRunCases & {
  repositoryCase: {
    forecastManual: number | null;
    forecastAutomated: number | null;
  } | null;
};

/**
 * Calculates the total forecast (sum of group-averaged forecasts) for a TestRun based on its associated RepositoryCases
 * and updates the forecast fields on the TestRun record.
 *
 * @param testRunId The ID of the TestRun to update.
 */
export async function updateTestRunForecast(testRunId: number): Promise<void> {
  try {
    // Fetch the TestRunCases and their associated RepositoryCase forecasts
    const testRunCases: TestRunCaseWithForecast[] =
      await prisma.testRunCases.findMany({
        where: { testRunId: testRunId },
        include: {
          repositoryCase: {
            select: {
              forecastManual: true,
              forecastAutomated: true,
            },
          },
        },
      });

    // Calculate the total forecasts, treating null as 0
    const totalForecastManual = testRunCases.reduce(
      (sum: number, testRunCase: any) => {
        const forecast = testRunCase.repositoryCase?.forecastManual ?? 0;
        return sum + forecast;
      },
      0
    );
    const totalForecastAutomated = testRunCases.reduce(
      (sum: number, testRunCase: any) => {
        const forecast = testRunCase.repositoryCase?.forecastAutomated ?? 0;
        return sum + forecast;
      },
      0
    );

    // Update the TestRun record
    await prisma.testRuns.update({
      where: { id: testRunId },
      data: {
        forecastManual: totalForecastManual,
        forecastAutomated: totalForecastAutomated,
      },
    });

    console.log(
      `Updated forecast for TestRun ${testRunId} to forecastManual=${totalForecastManual}, forecastAutomated=${totalForecastAutomated}`
    );
  } catch (error) {
    console.error(`Error updating forecast for TestRun ${testRunId}:`, error);
    // Depending on requirements, you might want to re-throw the error
    // or implement more specific error handling.
  }
}
