/**
 * Shared grouping for the test-execution metric aggregates.
 *
 * Every test-execution metric (count, pass rate, elapsed, unique cases/runs)
 * groups the same raw `TestRunResults` rows by the same set of dimension
 * fields and differs only in how it accumulates. This module owns the grouping
 * so each metric supplies just an accumulator, and so the two multi-valued
 * dimensions live in one place:
 *
 * - **tag**: a case can carry many tags, so a result fans out into one group
 *   per linked tag (or a single "None" group when it has none).
 * - **folder** with descendants enabled: a result counts toward its own folder
 *   and every ancestor folder, so a parent folder rolls up its subtree.
 *
 * The grouped rows carry each dimension's `groupBy` field as a scalar property
 * (e.g. `folderId`, `tagId`, `statusId`) exactly like the hand-rolled reducers
 * did, so `reportApiUtils` can map them back to display values unchanged.
 */

type RawResult = Record<string, any>;

interface FieldValue {
  // Stable string used to build the group key.
  key: string;
  // Scalar written onto the grouped row under the field name.
  value: unknown;
}

export interface GroupingOptions {
  // folderId -> [self, parent, grandparent, ...]. Present only when the folder
  // dimension is grouped with descendants enabled.
  folderAncestors?: Map<number, number[]>;
}

/**
 * An accumulator turns the results that fall into one group into that group's
 * metric value(s). `create` makes the per-group state, `add` folds in one
 * result, `finalize` produces the metric properties merged onto the row.
 */
export interface GroupAccumulator<A> {
  create: () => A;
  add: (acc: A, result: RawResult) => void;
  finalize: (acc: A) => Record<string, unknown>;
}

function normalizeDay(value: unknown): string {
  const date = new Date(value as string);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Returns the value(s) a result contributes for one dimension field. Single
 * valued for every dimension except tag, and folder when descendants roll up.
 */
function fieldValues(
  result: RawResult,
  field: string,
  options: GroupingOptions
): FieldValue[] {
  const single = (value: unknown): FieldValue[] => [
    { key: String(value ?? "unknown"), value: value ?? null },
  ];

  switch (field) {
    case "executedAt": {
      if (!result.executedAt) return [{ key: "unknown", value: null }];
      const iso = normalizeDay(result.executedAt);
      return [{ key: iso, value: iso }];
    }
    case "createdAt": {
      // Repository-stats groups cases by creation day.
      if (!result.createdAt) return [{ key: "unknown", value: null }];
      const iso = normalizeDay(result.createdAt);
      return [{ key: iso, value: iso }];
    }
    case "executedById":
      return single(result.executedById);
    case "statusId":
      return single(result.statusId);
    case "testRunId":
      return single(result.testRunId);
    case "testRunCaseId":
      return single(result.testRunCaseId);
    case "repositoryCaseId":
      return single(result.testRunCase?.repositoryCaseId);
    case "projectId":
      // Test-execution rows nest the project under testRun; repository-stats
      // rows carry projectId at the top.
      return single(result.testRun?.projectId ?? result.projectId);
    case "configId":
      return single(result.testRun?.configId);
    case "milestoneId":
      return single(result.testRun?.milestoneId);
    case "folderId": {
      // Test-execution rows carry the case under testRunCase.repositoryCase;
      // repository-stats rows are the case itself, with folderId at the top.
      const folderId =
        result.testRunCase?.repositoryCase?.folderId ?? result.folderId ?? null;
      if (folderId !== null && options.folderAncestors) {
        const chain = options.folderAncestors.get(folderId);
        if (chain && chain.length > 0) {
          return chain.map((id) => ({ key: String(id), value: id }));
        }
      }
      return single(folderId);
    }
    case "tagId": {
      const caseTags: Array<{ tag: { id: number } }> =
        result.testRunCase?.repositoryCase?.caseTags ?? result.caseTags ?? [];
      const tags: Array<{ id: number }> = caseTags.map((ct) => ct.tag);
      if (tags.length === 0) return [{ key: "null", value: null }];
      return tags.map((tag) => ({ key: String(tag.id), value: tag.id }));
    }
    default:
      // Scalar fields that live directly on the row (repository-stats:
      // templateId, creatorId, stateId, source, id).
      return single(result[field]);
  }
}

/**
 * Cartesian product of each dimension's contributed values. With only
 * single-valued dimensions this yields exactly one combination per result; tag
 * and rolled-up folder expand it.
 */
function combine(valueLists: FieldValue[][]): FieldValue[][] {
  return valueLists.reduce<FieldValue[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])),
    [[]]
  );
}

/**
 * Groups raw results by `groupBy` and reduces each group with `accumulator`.
 * Returns one row per group: the dimension scalars plus the accumulator's
 * finalized metric properties.
 */
export function groupResults<A>(
  results: RawResult[],
  groupBy: string[],
  accumulator: GroupAccumulator<A>,
  options: GroupingOptions = {}
): Record<string, unknown>[] {
  const groups = new Map<string, { dims: Record<string, unknown>; acc: A }>();

  for (const result of results) {
    const valueLists = groupBy.map((field) =>
      fieldValues(result, field, options)
    );

    for (const combo of combine(valueLists)) {
      const key = combo.map((fv) => fv.key).join("|");
      let entry = groups.get(key);
      if (!entry) {
        const dims: Record<string, unknown> = {};
        groupBy.forEach((field, index) => {
          dims[field] = combo[index].value;
        });
        entry = { dims, acc: accumulator.create() };
        groups.set(key, entry);
      }
      accumulator.add(entry.acc, result);
    }
  }

  return Array.from(groups.values()).map((entry) => ({
    ...entry.dims,
    ...accumulator.finalize(entry.acc),
  }));
}

/**
 * Builds a folderId -> [self, ...ancestors] map for a project (or all projects
 * for cross-project reports), used to roll a case up into its ancestor folders
 * when the folder dimension is grouped with descendants enabled. A single
 * round trip; the chain is walked in memory with a depth guard against cycles.
 */
export async function buildFolderAncestorMap(
  prisma: any,
  projectId: number | undefined,
  isProjectSpecific: boolean
): Promise<Map<number, number[]>> {
  const folders: Array<{ id: number; parentId: number | null }> =
    await prisma.repositoryFolders.findMany({
      where: {
        ...(isProjectSpecific && projectId
          ? { projectId: Number(projectId) }
          : {}),
        isDeleted: false,
      },
      select: { id: true, parentId: true },
    });

  const parentOf = new Map<number, number | null>();
  for (const folder of folders) {
    parentOf.set(folder.id, folder.parentId);
  }

  const ancestorsOf = new Map<number, number[]>();
  for (const folder of folders) {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current: number | null = folder.id;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    ancestorsOf.set(folder.id, chain);
  }

  return ancestorsOf;
}

/**
 * Returns the folder plus all of its descendant folder ids (single recursive
 * CTE). Used by drill-down so that clicking a rolled-up parent folder shows the
 * results from its whole subtree, matching the displayed count.
 */
export async function getFolderSubtreeIds(
  prisma: any,
  folderId: number
): Promise<number[]> {
  const rows: Array<{ id: number }> = await prisma.$queryRaw`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "RepositoryFolders"
      WHERE id = ${folderId} AND "isDeleted" = false
      UNION ALL
      SELECT f.id FROM "RepositoryFolders" f
      INNER JOIN subtree s ON f."parentId" = s.id
      WHERE f."isDeleted" = false
    )
    SELECT id FROM subtree
  `;
  return rows.map((row) => row.id);
}
