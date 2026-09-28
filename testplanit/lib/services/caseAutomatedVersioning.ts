import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";

/**
 * Version snapshots for changes to `RepositoryCases.automated`.
 *
 * Automation Trends does not read the live `automated` flag. It reconstructs
 * each case's state for every period from the `RepositoryCaseVersions`
 * timeline (`utils/automationTrendsUtils.ts`, `automatedStateAt`), and only
 * falls back to the flag for a case with no version rows at all. A write that
 * flips the flag without leaving a snapshot therefore makes the case count as
 * its OLD state in the report indefinitely, while the repository view (which
 * reads the flag) shows the new one.
 *
 * Two entry points, one implementation:
 *
 *   - `snapshotAutomatedFlip` runs AFTER the flag has been written. It bumps
 *     `currentVersion` and snapshots the row as it now stands. This is what
 *     the ORM side-effects plugin calls for every hooked-client update that
 *     changed `automated` (RPC from the reporter SDK, the MCP server and the
 *     UI, plus `baseDb` / policy-client writes in routes).
 *   - `setCaseAutomated` is for writers on the plugin-free raw client (workers,
 *     scripts), where no hook fires. It writes the flag and, only on a real
 *     change, the snapshot.
 *
 * `copyFieldValues` is always on: without it the snapshot carries no
 * `CaseFieldVersionValues` and the history UI renders every custom field as
 * deleted at the flip.
 */

/** The subset of a transaction client the helpers need. */
export type AutomatedVersioningClient = {
  repositoryCases: {
    findUnique(args: {
      where: { id: number };
      select: { automated: true };
    }): Promise<{ automated: boolean } | null>;
    update(args: {
      where: { id: number };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

/**
 * Record a flip of `automated` that has already been written to the case row.
 * Bumps `currentVersion` first because the version service snapshots the row
 * as it stands in the transaction and uses that number.
 */
export async function snapshotAutomatedFlip(
  tx: AutomatedVersioningClient,
  caseId: number
): Promise<void> {
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: { currentVersion: { increment: 1 } },
  });
  await createTestCaseVersionInTransaction(tx, caseId, {
    copyFieldValues: true,
  });
}

/**
 * Write `automated` (plus any `extraData` for the same row) and snapshot the
 * change when the value actually flips. A write that leaves the flag as it was
 * is a plain update: re-importing an already-automated case must not churn
 * versions.
 *
 * Returns whether a snapshot was written.
 */
export async function setCaseAutomated(
  tx: AutomatedVersioningClient,
  caseId: number,
  automated: boolean,
  extraData: Record<string, unknown> = {}
): Promise<boolean> {
  const current = await tx.repositoryCases.findUnique({
    where: { id: caseId },
    select: { automated: true },
  });
  if (!current) {
    throw new Error(`Test case ${caseId} not found`);
  }
  const flips = current.automated !== automated;
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: {
      ...extraData,
      automated,
      ...(flips ? { currentVersion: { increment: 1 } } : {}),
    },
  });
  if (flips) {
    await createTestCaseVersionInTransaction(tx, caseId, {
      copyFieldValues: true,
    });
  }
  return flips;
}
