import type { Prisma } from "@prisma/client";

/**
 * Maintains the denormalized RepositoryCases.hasParameters flag.
 *
 * Call inside the SAME transaction as any TestCaseParameter create / delete /
 * type-change mutation. Computes the count of NON-SOFT-DELETED parameters
 * for the case and writes the boolean result back to the case row.
 *
 * The helper is idempotent — invoking it repeatedly with the same DB state
 * produces the same write. It accepts the caller's transaction client so the
 * count and the update happen in the same atomic unit; do NOT open a new
 * transaction inside the helper.
 *
 * @param caseId The RepositoryCases.id whose hasParameters flag should be recomputed.
 * @param tx     The Prisma transaction client (caller-owned).
 */
export async function updateHasParameters(
  caseId: number,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const count = await tx.testCaseParameter.count({
    where: { testCaseId: caseId, isDeleted: false },
  });
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: { hasParameters: count > 0 },
  });
}
