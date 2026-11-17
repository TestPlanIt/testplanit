import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import { filterEligibleCaseIds } from "~/lib/services/runCaseEligibility";

/**
 * Keeps Not Started cases out of runs for projects that ask for it.
 *
 * `Projects.excludeNotStartedFromRuns` used to be enforced only in the
 * browser: the run dialog dropped such cases before saving and the picker
 * hid them. Any API client (the MCP server included) could add them anyway.
 * This guard applies the rule to every write that puts a case into a run:
 * a batch drops the ineligible cases, as the dialog did; a single-case write
 * is refused with a message naming the case.
 */

export type EligibilityClient = {
  projects: { findUnique: (args: any) => Promise<any> };
  repositoryCases: { findMany: (args: any) => Promise<any[]> };
  testRuns: {
    findUnique(args: {
      where: { id: number };
      select: { projectId: true };
    }): Promise<{ projectId: number } | null>;
  };
  testRunCases: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; repositoryCaseId: true; testRunId: true };
    }): Promise<
      Array<{ id: number; repositoryCaseId: number; testRunId: number }>
    >;
  };
};

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const reject = (caseId: number): never => {
  const error = new ORMError(
    ORMErrorReason.INVALID_INPUT,
    `Test case ${caseId} is in a Not Started workflow state and this project keeps such cases out of test runs.`
  );
  error.model = "TestRunCases";
  throw error;
};

function caseIdOf(row: Record<string, unknown>): number | undefined {
  return (
    idOf(row.repositoryCaseId) ??
    idOf((row.repositoryCase as { connect?: { id?: unknown } })?.connect?.id)
  );
}

function runIdOf(row: Record<string, unknown>): number | undefined {
  return (
    idOf(row.testRunId) ??
    idOf((row.testRun as { connect?: { id?: unknown } })?.connect?.id)
  );
}

async function projectOfRun(
  client: EligibilityClient,
  runId: number
): Promise<number | undefined> {
  const run = await client.testRuns.findUnique({
    where: { id: runId },
    select: { projectId: true },
  });
  return run?.projectId;
}

const ineligibleOf = async (
  client: EligibilityClient,
  projectId: number,
  caseIds: number[]
): Promise<Set<number>> => {
  const unique = Array.from(new Set(caseIds));
  if (unique.length === 0) return new Set();
  const eligible = new Set(
    await filterEligibleCaseIds(client as any, {
      projectId,
      repositoryCaseIds: unique,
    })
  );
  return new Set(unique.filter((id) => !eligible.has(id)));
};

/**
 * Call before a TestRunCases or TestRuns write. Mutates the args so the
 * write adds or restores only eligible cases.
 */
export async function applyRunCaseEligibility(
  model: string,
  operation: string,
  args: unknown,
  client: EligibilityClient
): Promise<void> {
  if (model === "TestRunCases") {
    await guardRunCaseWrite(operation, args, client);
  } else if (model === "TestRuns") {
    await guardNestedRunCases(operation, args, client);
  }
}

async function guardRunCaseWrite(
  operation: string,
  args: unknown,
  client: EligibilityClient
): Promise<void> {
  const payload = args as {
    where?: Record<string, unknown>;
    data?: unknown;
    update?: unknown;
    create?: unknown;
  };

  if (operation === "create" || operation === "createMany") {
    const rows = (
      Array.isArray(payload?.data) ? payload.data : [payload?.data]
    ).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    const byRun = new Map<number, number[]>();
    for (const row of rows) {
      const runId = runIdOf(row);
      const caseId = caseIdOf(row);
      if (runId === undefined || caseId === undefined) continue;
      byRun.set(runId, [...(byRun.get(runId) ?? []), caseId]);
    }
    const drop = new Set<number>();
    for (const [runId, caseIds] of byRun) {
      const projectId = await projectOfRun(client, runId);
      if (projectId === undefined) continue;
      for (const id of await ineligibleOf(client, projectId, caseIds))
        drop.add(id);
    }
    if (drop.size === 0) return;
    if (operation === "create") {
      reject(caseIdOf(rows[0]!)!);
    }
    payload.data = rows.filter((row) => {
      const caseId = caseIdOf(row);
      return caseId === undefined || !drop.has(caseId);
    });
    return;
  }

  const branch =
    operation === "upsert"
      ? (payload?.update as Record<string, unknown> | undefined)
      : (payload?.data as Record<string, unknown> | undefined);
  const restoring =
    (operation === "update" ||
      operation === "updateMany" ||
      operation === "upsert") &&
    branch?.isDeleted === false;
  if (!restoring) {
    if (operation === "upsert") await guardUpsertCreate(payload, client);
    return;
  }

  const targeted = await client.testRunCases.findMany({
    where: { AND: [payload.where ?? {}, { isDeleted: true }] },
    select: { id: true, repositoryCaseId: true, testRunId: true },
  });
  if (targeted.length === 0) {
    // Nothing exists to restore; an upsert will create instead.
    if (operation === "upsert") await guardUpsertCreate(payload, client);
    return;
  }
  const byRun = new Map<number, typeof targeted>();
  for (const row of targeted) {
    byRun.set(row.testRunId, [...(byRun.get(row.testRunId) ?? []), row]);
  }
  const blocked: number[] = [];
  for (const [runId, rows] of byRun) {
    const projectId = await projectOfRun(client, runId);
    if (projectId === undefined) continue;
    const bad = await ineligibleOf(
      client,
      projectId,
      rows.map((r) => r.repositoryCaseId)
    );
    for (const row of rows)
      if (bad.has(row.repositoryCaseId)) blocked.push(row.id);
  }
  if (blocked.length === 0) return;
  if (operation === "updateMany") {
    payload.where = { AND: [payload.where ?? {}, { id: { notIn: blocked } }] };
    return;
  }
  const caseId = targeted.find((r) => blocked.includes(r.id))!.repositoryCaseId;
  reject(caseId);
}

/** An upsert whose row does not exist yet creates it: check that branch. */
async function guardUpsertCreate(
  payload: { where?: Record<string, unknown>; create?: unknown },
  client: EligibilityClient
): Promise<void> {
  if (!payload?.create || typeof payload.create !== "object") return;
  const row = payload.create as Record<string, unknown>;
  const key = payload.where?.testRunId_repositoryCaseId as
    { testRunId?: unknown; repositoryCaseId?: unknown } | undefined;
  const runId = runIdOf(row) ?? idOf(key?.testRunId);
  const caseId = caseIdOf(row) ?? idOf(key?.repositoryCaseId);
  if (runId === undefined || caseId === undefined) return;
  const projectId = await projectOfRun(client, runId);
  if (projectId === undefined) return;
  const bad = await ineligibleOf(client, projectId, [caseId]);
  if (bad.size > 0) reject(caseId);
}

async function guardNestedRunCases(
  operation: string,
  args: unknown,
  client: EligibilityClient
): Promise<void> {
  const payload = args as {
    where?: { id?: unknown };
    data?: Record<string, unknown>;
    update?: Record<string, unknown>;
    create?: Record<string, unknown>;
  };
  const branches: Array<Record<string, unknown> | undefined> =
    operation === "create"
      ? [payload?.data]
      : operation === "upsert"
        ? [payload?.update, payload?.create]
        : operation === "update"
          ? [payload?.data]
          : [];
  for (const data of branches) {
    const nested = data?.testCases as Record<string, unknown> | undefined;
    if (!nested) continue;
    let projectId =
      idOf(data?.projectId) ??
      idOf((data?.project as { connect?: { id?: unknown } })?.connect?.id);
    if (projectId === undefined) {
      const runId = idOf(payload?.where?.id);
      if (runId === undefined) continue;
      projectId = await projectOfRun(client, runId);
      if (projectId === undefined) continue;
    }
    const pid = projectId;
    const entryCase = (e: unknown): number | undefined => {
      if (!e || typeof e !== "object") return undefined;
      const entry = e as Record<string, unknown>;
      const create =
        (entry.create as Record<string, unknown> | undefined) ?? entry;
      return (
        caseIdOf(create) ??
        idOf(
          (
            (entry.where as Record<string, unknown>)
              ?.testRunId_repositoryCaseId as any
          )?.repositoryCaseId
        )
      );
    };
    for (const key of ["create", "upsert", "connectOrCreate"] as const) {
      const list = nested[key];
      if (list === undefined) continue;
      const entries = [list].flat();
      const caseIds = entries
        .map(entryCase)
        .filter((id): id is number => id !== undefined);
      const bad = await ineligibleOf(client, pid, caseIds);
      if (bad.size === 0) continue;
      const kept = entries.filter((e) => {
        const id = entryCase(e);
        return id === undefined || !bad.has(id);
      });
      nested[key] = Array.isArray(list) ? kept : kept[0];
      if (!Array.isArray(list) && kept.length === 0) delete nested[key];
    }
  }
}
