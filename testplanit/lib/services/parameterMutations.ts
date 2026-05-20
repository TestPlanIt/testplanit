/**
 * Transactional helpers that wrap every TestCaseParameter mutation site
 * with the Phase 1 / Phase 2 invariants:
 *
 *   1. The CRUD on `tx.testCaseParameter` (NEVER hard delete — soft delete
 *      via `update({ data: { isDeleted: true } })`).
 *   2. `updateHasParameters(caseId, tx)` — Phase 1 carry-forward (the
 *      denormalized `RepositoryCases.hasParameters` flag must stay in sync).
 *   3. `RepositoryCases.currentVersion` increment.
 *   4. `createTestCaseVersionInTransaction` snapshot — PARAM-06: every
 *      schema change bumps the test-case version.
 *   5. For renames: `rewriteParameterReferences` rewrites every Tiptap step
 *      reference and every DataSet row key in the same transaction.
 *
 * Every helper accepts a transaction client (`tx`) so the caller controls
 * atomicity (open the `$transaction` at the route boundary).
 */

import { updateHasParameters } from "~/lib/services/parameterMaintenance";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { rewriteParameterReferences } from "~/lib/services/parameterReferences";

export interface ParameterMutationSession {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface ParameterCreateData {
  testCaseId: number;
  name: string;
  description?: string | null;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  defaultValue?: unknown;
  order?: number;
  required?: boolean;
  sensitive?: boolean;
  allowedValuesJson?: unknown;
  lookupDataSetId?: number | null;
}

export interface ParameterUpdateData {
  name?: string;
  description?: string | null;
  type?: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  defaultValue?: unknown;
  order?: number;
  required?: boolean;
  sensitive?: boolean;
  allowedValuesJson?: unknown;
  lookupDataSetId?: number | null;
}

function creatorMeta(session: ParameterMutationSession) {
  return {
    creatorId: session.id,
    creatorName: session.name ?? session.email ?? "",
  };
}

async function bumpVersionAndSnapshot(
  tx: any,
  caseId: number,
  session: ParameterMutationSession
) {
  await tx.repositoryCases.update({
    where: { id: caseId },
    data: { currentVersion: { increment: 1 } },
  });
  await createTestCaseVersionInTransaction(tx, caseId, creatorMeta(session));
}

export async function createParameterInTransaction(
  tx: any,
  caseId: number,
  data: ParameterCreateData,
  session: ParameterMutationSession
): Promise<unknown> {
  const created = await tx.testCaseParameter.create({ data });
  await updateHasParameters(caseId, tx);
  await bumpVersionAndSnapshot(tx, caseId, session);
  return created;
}

export async function updateParameterInTransaction(
  tx: any,
  caseId: number,
  paramId: number,
  data: ParameterUpdateData,
  session: ParameterMutationSession
): Promise<unknown> {
  const existing = await tx.testCaseParameter.findFirst({
    where: { id: paramId, testCaseId: caseId, isDeleted: false },
  });
  if (!existing) {
    throw new Error(`Parameter ${paramId} not found on case ${caseId}`);
  }

  const renaming =
    typeof data.name === "string" &&
    data.name.length > 0 &&
    data.name !== existing.name;

  if (renaming) {
    await rewriteParameterReferences(tx, caseId, existing.name, data.name!);
  }

  const updated = await tx.testCaseParameter.update({
    where: { id: paramId },
    data,
  });
  await updateHasParameters(caseId, tx);
  await bumpVersionAndSnapshot(tx, caseId, session);
  return updated;
}

export async function softDeleteParameterInTransaction(
  tx: any,
  caseId: number,
  paramId: number,
  session: ParameterMutationSession
): Promise<void> {
  await tx.testCaseParameter.update({
    where: { id: paramId },
    data: { isDeleted: true },
  });
  await updateHasParameters(caseId, tx);
  await bumpVersionAndSnapshot(tx, caseId, session);
}
