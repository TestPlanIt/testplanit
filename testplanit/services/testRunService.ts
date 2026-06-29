"use server";
import type { TestRunCases } from "~/zenstack/models";
import { rawDb } from "~/lib/rawDb";

// Define a type for the structure returned by the findMany query
type TestRunCaseWithForecast = TestRunCases & {
  repositoryCase: {
    isDeleted: boolean;
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
    // Fetch the TestRunCases and their associated RepositoryCase forecasts.
    // Exclude soft-deleted run memberships (cases removed from the run) so
    // their forecast never counts toward the run total.
    const testRunCases: TestRunCaseWithForecast[] =
      await rawDb.testRunCases.findMany({
        where: { testRunId: testRunId, isDeleted: false },
        include: {
          repositoryCase: {
            select: {
              isDeleted: true,
              forecastManual: true,
              forecastAutomated: true,
            },
          },
        },
      });

    // Drop cases whose repository case has been soft-deleted from the
    // repository (a stale membership may still reference it).
    const liveTestRunCases = testRunCases.filter(
      (trc) => trc.repositoryCase && !trc.repositoryCase.isDeleted
    );

    // Calculate the total forecasts, treating null as 0
    const totalForecastManual = liveTestRunCases.reduce(
      (sum: number, testRunCase: any) => {
        const forecast = testRunCase.repositoryCase?.forecastManual ?? 0;
        return sum + forecast;
      },
      0
    );
    const totalForecastAutomated = liveTestRunCases.reduce(
      (sum: number, testRunCase: any) => {
        const forecast = testRunCase.repositoryCase?.forecastAutomated ?? 0;
        return sum + forecast;
      },
      0
    );

    // Update the TestRun record
    await rawDb.testRuns.update({
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
