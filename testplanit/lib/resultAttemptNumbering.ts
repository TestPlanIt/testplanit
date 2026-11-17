/** The read the numbering needs, on a client without plugins. */
export type AttemptReader = {
  testRunResults: {
    findMany(args: {
      where: { testRunCaseId: number; iterationId: number | null };
      select: { attempt: true };
    }): Promise<Array<{ attempt: number }>>;
  };
};

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

function runCaseOf(row: Record<string, unknown>): number | undefined {
  return (
    idOf(row.testRunCaseId) ??
    idOf((row.testRunCase as { connect?: { id?: unknown } })?.connect?.id)
  );
}

function iterationOf(row: Record<string, unknown>): number | null {
  return (
    idOf(row.iterationId) ??
    idOf((row.iteration as { connect?: { id?: unknown } })?.connect?.id) ??
    null
  );
}

/**
 * Number the attempt of every test result being created so the numbers are
 * unique per run case and iteration, whichever client writes the row.
 *
 * The web UI's result dialog sends "highest existing attempt + 1", its quick
 * status buttons send 1, the MCP server counted live rows (so a removed
 * result's number was reused), and `@testplanit/api` sent 1 by default. A
 * missing number, or one that an existing result (removed or not) already
 * carries, becomes the next free number; a free number the client chose is
 * kept.
 */
export async function assignResultAttempts(
  model: string,
  operation: string,
  args: unknown,
  reader: AttemptReader
): Promise<void> {
  if (model !== "TestRunResults") return;
  if (operation !== "create" && operation !== "createMany") return;
  const data = (args as { data?: unknown } | undefined)?.data;
  const rows = (Array.isArray(data) ? data : data ? [data] : []).filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object"
  );
  if (rows.length === 0) return;

  // Attempts already taken, per (run case, iteration), read once per group.
  const taken = new Map<string, Set<number>>();
  for (const row of rows) {
    const testRunCaseId = runCaseOf(row);
    if (testRunCaseId === undefined) continue;
    const iterationId = iterationOf(row);
    const key = `${testRunCaseId}:${iterationId ?? ""}`;
    let used = taken.get(key);
    if (!used) {
      const existing = await reader.testRunResults.findMany({
        where: { testRunCaseId, iterationId },
        select: { attempt: true },
      });
      used = new Set(existing.map((r) => r.attempt));
      taken.set(key, used);
    }
    const requested = idOf(row.attempt);
    let attempt = requested;
    if (attempt === undefined || attempt < 1 || used.has(attempt)) {
      attempt = used.size === 0 ? 1 : Math.max(...used) + 1;
    }
    used.add(attempt);
    row.attempt = attempt;
  }
}
