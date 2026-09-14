/**
 * Shapes shared between the Latest Results column and the service that fills
 * it.
 *
 * Deliberately free of imports: the service module pulls in the database
 * client, so a client component importing anything from it would drag the whole
 * server stack (down to `async_hooks`) into the browser bundle.
 */

/** Slots shown by the Latest Results column. */
export const LATEST_RESULTS_COUNT = 5;

/** One execution of a test case, manual or automated. */
export interface TestResultExecution {
  /**
   * Which table this execution came from. `resultId` is only unique WITHIN a
   * source -- TestRunResults and JUnitTestResult are separate id spaces -- so a
   * caller that hydrates further detail must read this first.
   */
  executionSource: "manual" | "automated";
  resultId: number;
  testRunId: number | null;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}
