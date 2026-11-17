import { getServerTranslation } from "~/lib/server-translations";
import { formatFilterChipText } from "~/lib/repository/filterChipText";
import {
  BOOLEAN_VALUE_LABEL_KEYS,
  CHECKBOX_VALUE_LABEL_KEYS,
  DIMENSION_LABEL_KEYS,
  chipOperatorLabelKey,
} from "~/lib/repository/filterDimensionLabels";
import {
  IN_REVIEW_DIMENSION,
  type FilterDimension,
} from "~/lib/repository/filterDimensions";
import {
  compileRepoPredicates,
  extractPostFetchFilters,
} from "~/lib/repository/filterWhereCompiler";
import {
  loadPendingReviewCaseIds,
  loadProjectFilterRegistry,
} from "~/lib/repository/projectFilterRegistry";
import { matchesPostFetchFilters } from "~/lib/repositoryCaseFieldMatchers";
import {
  parseFilterPredicates,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

/** Stored text a webhook writes is in the default locale; it has no viewer. */
const NOTE_LOCALE = "en_US";
const t = (key: string) => getServerTranslation(NOTE_LOCALE, key);

/**
 * Keep the cases a Create test run rule's test case filters match, in the
 * order given. The filters are the repository's own predicates, read the
 * way a saved repository view is: one on a field the project no longer has
 * is skipped and the rest still apply, so an empty result means the cases
 * failed a filter, never that a filter failed to parse.
 */
export async function applyCaseFilter(
  db: any,
  projectId: number,
  caseIds: number[],
  raw: unknown
): Promise<number[]> {
  if (caseIds.length === 0) return [];
  const { registry } = await loadProjectFilterRegistry(db, projectId);
  const predicates = parseFilterPredicates(raw, registry);
  if (predicates.length === 0) return caseIds;

  const inReviewCaseIds = predicates.some(
    (predicate) => predicate.dimension === IN_REVIEW_DIMENSION
  )
    ? await loadPendingReviewCaseIds(db, projectId)
    : [];
  const fragments = compileRepoPredicates(predicates, registry, {
    inReviewCaseIds,
  });
  const postFetch = extractPostFetchFilters(predicates, registry);
  const textFieldIds = [
    ...new Set(
      postFetch.filter((f) => f.type !== "steps").map((f) => f.fieldId)
    ),
  ];
  const needsSteps = postFetch.some((f) => f.type === "steps");

  const rows: { id: number }[] = await db.repositoryCases.findMany({
    where: { AND: [{ id: { in: caseIds }, projectId }, ...fragments] },
    select: {
      id: true,
      ...(textFieldIds.length > 0
        ? {
            caseFieldValues: {
              where: { fieldId: { in: textFieldIds } },
              select: { fieldId: true, value: true },
            },
          }
        : {}),
      ...(needsSteps
        ? { steps: { where: { isDeleted: false }, select: { id: true } } }
        : {}),
    },
  });
  const kept = new Set(
    rows
      .filter(
        (row) =>
          postFetch.length === 0 || matchesPostFetchFilters(row, postFetch)
      )
      .map((row) => row.id)
  );
  return caseIds.filter((id) => kept.has(id));
}

async function nameRows(
  db: any,
  model: string,
  ids: number[],
  nameField: string
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows: Record<string, unknown>[] = await db[model]
    .findMany({
      where: { id: { in: ids } },
      select: { id: true, [nameField]: true },
    })
    .catch(() => []);
  for (const row of rows) names.set(String(row.id), String(row[nameField]));
  return names;
}

async function userNames(db: any, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows: { id: string; name: string | null }[] = await db.user
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    .catch(() => []);
  for (const row of rows) if (row.name) names.set(row.id, row.name);
  return names;
}

const ID_LOOKUPS: Record<string, { model: string; nameField: string }> = {
  templates: { model: "templates", nameField: "templateName" },
  states: { model: "workflows", nameField: "name" },
  tags: { model: "tags", nameField: "name" },
  issues: { model: "issue", nameField: "name" },
};

function numericIds(predicates: FilterPredicate[], dimension: string) {
  return [
    ...new Set(
      predicates
        .filter((p) => p.dimension === dimension)
        .flatMap((p) => p.values)
        .filter((v): v is number => typeof v === "number")
    ),
  ];
}

/**
 * The filters as the repository's chips name them, for a run's description:
 * "Priority: Any of High, Critical; Automation: Is Automated". Ids are
 * replaced by the names they have now; one on a field the project no longer
 * has is left out. Null when nothing applies.
 */
export async function describeCaseFilter(
  db: any,
  projectId: number,
  raw: unknown
): Promise<string | null> {
  const { registry, fieldLabels } = await loadProjectFilterRegistry(
    db,
    projectId
  );
  const predicates = parseFilterPredicates(raw, registry);
  if (predicates.length === 0) return null;

  const optionIds = [
    ...new Set(
      predicates
        .filter((p) => registry.get(p.dimension)?.valueType === "options")
        .flatMap((p) => p.values)
        .filter((v): v is number => typeof v === "number")
    ),
  ];
  const [names, users, options] = await Promise.all([
    Promise.all(
      Object.entries(ID_LOOKUPS).map(
        async ([dimension, lookup]) =>
          [
            dimension,
            await nameRows(
              db,
              lookup.model,
              numericIds(predicates, dimension),
              lookup.nameField
            ),
          ] as const
      )
    ).then((entries) => new Map(entries)),
    userNames(db, [
      ...new Set(
        predicates
          .filter((p) => p.dimension === "creators")
          .flatMap((p) => p.values.map(String))
      ),
    ]),
    nameRows(db, "fieldOptions", optionIds, "name"),
  ]);

  const valueNames = async (
    dimension: FilterDimension
  ): Promise<{ id: string | number; name: string }[]> => {
    if (dimension.valueType === "boolean") {
      const keys =
        BOOLEAN_VALUE_LABEL_KEYS[dimension.key] ?? CHECKBOX_VALUE_LABEL_KEYS;
      return [
        { id: 1, name: await t(keys.true) },
        { id: 0, name: await t(keys.false) },
      ];
    }
    if (dimension.valueType === "options") {
      return [...options].map(([id, name]) => ({ id, name }));
    }
    if (dimension.key === "creators") {
      return [...users].map(([id, name]) => ({ id, name }));
    }
    const lookup = names.get(dimension.key);
    return lookup ? [...lookup].map(([id, name]) => ({ id, name })) : [];
  };

  const parts: string[] = [];
  for (const predicate of predicates) {
    const dimension = registry.get(predicate.dimension);
    if (!dimension) continue;
    const labelKey = DIMENSION_LABEL_KEYS[dimension.key];
    parts.push(
      formatFilterChipText({
        dimension,
        predicate,
        label: labelKey
          ? await t(labelKey)
          : (fieldLabels[dimension.key] ?? dimension.key),
        operatorLabel: await t(
          chipOperatorLabelKey(predicate.operator, predicate.values.length)
        ),
        options: await valueNames(dimension),
      })
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}
