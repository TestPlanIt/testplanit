export interface MultiRowFieldMapping {
  csvColumn: string;
  templateField: string | null;
}

export interface AggregatedStep {
  step: string;
  expectedResult: string;
  order: number;
}

export interface AggregateDiagnostics {
  stepContentColumn: string | null;
  expectedResultColumn: string | null;
  stepNumberColumn: string | null;
  idColumn: string | null;
  nameColumn: string | null;
  inputRows: number;
  outputCases: number;
}

// Common CSV column headers for step content across exporters (TestPlanIt,
// TestRail, Testmo, Zephyr, generic). Matched case-insensitively. Generic
// names like "Description" / "Result" are intentionally excluded — they
// collide with case-level fields too often. Users with non-standard headers
// should map the column to the "steps" system field instead.
const STEP_CONTENT_ALIASES = [
  "Step Content",
  "Step",
  "Steps",
  "Action",
  "Actions",
  "Step Description",
];

const EXPECTED_RESULT_ALIASES = [
  "Expected Result",
  "Expected Results",
  "Expected",
  "Expected Outcome",
];

const STEP_NUMBER_ALIASES = ["Step #", "Step Number", "Step No", "Step Order"];

function findColumn(
  row: any,
  candidates: string[],
  excludedColumns: Set<string>
): string | null {
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row).filter((k) => !excludedColumns.has(k));
  for (const candidate of candidates) {
    const match = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

// Columns already mapped to non-step template fields shouldn't be auto-claimed
// as the step content / expected result column. "steps" and "expectedResult"
// are exempt — those are exactly the multi-row step columns this aggregator
// wants to claim from the user's explicit mapping.
function buildExcludedColumns(
  fieldMappings: MultiRowFieldMapping[]
): Set<string> {
  const excluded = new Set<string>();
  for (const m of fieldMappings) {
    if (
      m.templateField &&
      m.templateField !== "steps" &&
      m.templateField !== "expectedResult"
    ) {
      excluded.add(m.csvColumn);
    }
  }
  return excluded;
}

function nonEmpty(v: any): boolean {
  return v != null && v.toString().trim() !== "";
}

function toKey(v: any): string | null {
  if (v == null) return null;
  const s = v.toString().trim();
  return s ? s : null;
}

function parseStepOrder(raw: any, fallback: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw.toString(), 10);
  return Number.isFinite(n) ? n - 1 : fallback;
}

function detectStepContentColumn(
  row: any,
  fieldMappings: MultiRowFieldMapping[],
  excludedColumns: Set<string>
): string | null {
  // Prefer an explicit user mapping to the "steps" system field. In multi-row
  // mode each cell holds one step's content, so the user marking that column
  // as "steps" is the strongest signal.
  const stepsMapping = fieldMappings.find((m) => m.templateField === "steps");
  if (
    stepsMapping &&
    row &&
    Object.prototype.hasOwnProperty.call(row, stepsMapping.csvColumn)
  ) {
    return stepsMapping.csvColumn;
  }
  return findColumn(row, STEP_CONTENT_ALIASES, excludedColumns);
}

function detectExpectedResultColumn(
  row: any,
  fieldMappings: MultiRowFieldMapping[],
  excludedColumns: Set<string>
): string | null {
  // Mirror detectStepContentColumn: an explicit "expectedResult" user mapping
  // wins over the alias scan. This lets users surface custom column names
  // (e.g. "Outcome", "Acceptance") that wouldn't match the alias list.
  const erMapping = fieldMappings.find(
    (m) => m.templateField === "expectedResult"
  );
  if (
    erMapping &&
    row &&
    Object.prototype.hasOwnProperty.call(row, erMapping.csvColumn)
  ) {
    return erMapping.csvColumn;
  }
  return findColumn(row, EXPECTED_RESULT_ALIASES, excludedColumns);
}

/**
 * Collapses a multi-row CSV (one row per step) into one row per case. The head
 * row keeps all its existing fields; continuation rows are absorbed into the
 * head row's `_aggregatedSteps` array.
 *
 * A row is treated as a continuation when it doesn't introduce a new non-empty
 * identity in either the id-mapped or name-mapped column. That means rows with
 * blank id/name are absorbed into the previous case — the common "fill the
 * case columns only on the first row" CSV pattern.
 *
 * Column detection is forgiving: the user's mapping for the `steps` system
 * field takes precedence, then a list of common header aliases is tried
 * case-insensitively (Step Content, Step, Steps, Action, Description, ...).
 * If neither yields a step content nor expected result column, the input is
 * returned unchanged.
 */
export function aggregateMultiRowSteps(
  rows: any[],
  fieldMappings: MultiRowFieldMapping[]
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const excluded = buildExcludedColumns(fieldMappings);
  const stepContentCol = detectStepContentColumn(
    rows[0],
    fieldMappings,
    excluded
  );
  const expectedCol = detectExpectedResultColumn(
    rows[0],
    fieldMappings,
    excluded
  );
  const stepNumberCol = findColumn(rows[0], STEP_NUMBER_ALIASES, excluded);

  if (!stepContentCol && !expectedCol) return rows;

  const idMapping = fieldMappings.find((m) => m.templateField === "id");
  const nameMapping = fieldMappings.find((m) => m.templateField === "name");

  if (!idMapping && !nameMapping) return rows;

  const aggregated: any[] = [];

  for (const row of rows) {
    const id = idMapping ? toKey(row[idMapping.csvColumn]) : null;
    const name = nameMapping ? toKey(row[nameMapping.csvColumn]) : null;

    const stepText = stepContentCol ? row[stepContentCol] : "";
    const expectedText = expectedCol ? row[expectedCol] : "";
    const stepNumRaw = stepNumberCol ? row[stepNumberCol] : "";
    const hasStep = nonEmpty(stepText) || nonEmpty(expectedText);

    const prev = aggregated[aggregated.length - 1];
    const prevId = prev && idMapping ? toKey(prev[idMapping.csvColumn]) : null;
    const prevName =
      prev && nameMapping ? toKey(prev[nameMapping.csvColumn]) : null;

    // A row continues the previous case unless it introduces a new non-empty
    // identity (different id or different name). Blank id/name on a row is
    // treated as "continuation", matching the common CSV shape where case
    // columns are filled only on the first row.
    const idStartsNewCase = idMapping && id != null && id !== prevId;
    const nameStartsNewCase = nameMapping && name != null && name !== prevName;
    const isContinuation = !!prev && !idStartsNewCase && !nameStartsNewCase;

    if (isContinuation) {
      if (hasStep) {
        if (!prev._aggregatedSteps) prev._aggregatedSteps = [];
        prev._aggregatedSteps.push({
          step: (stepText ?? "").toString(),
          expectedResult: (expectedText ?? "").toString(),
          order: parseStepOrder(stepNumRaw, prev._aggregatedSteps.length),
        });
      }
      continue;
    }

    const newRow: any = { ...row };
    if (hasStep) {
      newRow._aggregatedSteps = [
        {
          step: (stepText ?? "").toString(),
          expectedResult: (expectedText ?? "").toString(),
          order: parseStepOrder(stepNumRaw, 0),
        },
      ];
    }
    aggregated.push(newRow);
  }

  return aggregated;
}

/**
 * Returns what the aggregator would detect for the given rows + mappings,
 * without actually aggregating. Used by the import wizard to surface a
 * "X rows → Y cases" banner and warn when no step column is detected.
 */
export function inspectMultiRowAggregation(
  rows: any[],
  fieldMappings: MultiRowFieldMapping[]
): AggregateDiagnostics {
  const inputRows = Array.isArray(rows) ? rows.length : 0;
  const sample = inputRows > 0 ? rows[0] : null;
  const idMapping = fieldMappings.find((m) => m.templateField === "id");
  const nameMapping = fieldMappings.find((m) => m.templateField === "name");
  const excluded = buildExcludedColumns(fieldMappings);
  const stepContentColumn = sample
    ? detectStepContentColumn(sample, fieldMappings, excluded)
    : null;
  const expectedResultColumn = sample
    ? detectExpectedResultColumn(sample, fieldMappings, excluded)
    : null;
  const stepNumberColumn = sample
    ? findColumn(sample, STEP_NUMBER_ALIASES, excluded)
    : null;

  const aggregated = aggregateMultiRowSteps(rows, fieldMappings);

  return {
    stepContentColumn,
    expectedResultColumn,
    stepNumberColumn,
    idColumn: idMapping?.csvColumn ?? null,
    nameColumn: nameMapping?.csvColumn ?? null,
    inputRows,
    outputCases: aggregated.length,
  };
}
