import { ORMError, ORMErrorReason } from "@zenstackhq/orm";

/** The read the guard needs, on a client without plugins. */
export type CompletedRunReader = {
  testRuns: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: number } | null>;
  };
};

const REOPENING_OPERATIONS = new Set(["update", "updateMany", "upsert"]);

/**
 * Reject a write that would reopen a completed test run. The web UI offers no
 * way back from completion, so API clients (the MCP server included) can't
 * set `isCompleted: false` on a run that is already completed. Clearing the
 * flag on a run that was never completed stays a no-op.
 */
export async function assertRunNotReopened(
  model: string,
  operation: string,
  args: unknown,
  reader: CompletedRunReader
): Promise<void> {
  if (model !== "TestRuns" || !REOPENING_OPERATIONS.has(operation)) return;
  const payload = args as {
    where?: Record<string, unknown>;
    data?: { isCompleted?: unknown };
    update?: { isCompleted?: unknown };
  };
  const data = operation === "upsert" ? payload?.update : payload?.data;
  if (data?.isCompleted !== false) return;

  const completed = await reader.testRuns.findFirst({
    where: { AND: [payload.where ?? {}, { isCompleted: true }] },
    select: { id: true },
  });
  if (!completed) return;

  const error = new ORMError(
    ORMErrorReason.INVALID_INPUT,
    `Test run ${completed.id} is completed and cannot be reopened.`
  );
  error.model = "TestRuns";
  throw error;
}
