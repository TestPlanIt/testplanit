export interface MultiRowFieldMapping {
  csvColumn: string;
  templateField: string | null;
}

export interface AggregatedStep {
  step: string;
  expectedResult: string;
  order: number;
}

// CSV column names emitted by the exporter in multi-row mode.
const STEP_CONTENT_COLUMNS = ["Step Content"];
const EXPECTED_RESULT_COLUMNS = ["Expected Result"];
const STEP_NUMBER_COLUMNS = ["Step #", "Step Number"];

function findColumn(row: any, candidates: string[]): string | null {
  if (!row || typeof row !== "object") return null;
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return candidate;
    }
  }
  return null;
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

/**
 * Collapses an exporter-style multi-row CSV (one row per step, with `Step #`,
 * `Step Content`, `Expected Result` columns) into one row per case. The head
 * row keeps all its existing fields; continuation rows are absorbed into the
 * head row's `_aggregatedSteps` array.
 *
 * A row is considered a continuation when it shares the same value as the
 * previous head row in the `id`-mapped column (or, if no id mapping, the
 * `name`-mapped column). Rows that don't match any previous head become new
 * head rows.
 *
 * If no step-content / expected-result column is present, the input is
 * returned unchanged.
 */
export function aggregateMultiRowSteps(
  rows: any[],
  fieldMappings: MultiRowFieldMapping[]
): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const stepContentCol = findColumn(rows[0], STEP_CONTENT_COLUMNS);
  const expectedCol = findColumn(rows[0], EXPECTED_RESULT_COLUMNS);
  const stepNumberCol = findColumn(rows[0], STEP_NUMBER_COLUMNS);

  if (!stepContentCol && !expectedCol) return rows;

  const idMapping = fieldMappings.find((m) => m.templateField === "id");
  const nameMapping = fieldMappings.find((m) => m.templateField === "name");

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

    const isContinuation =
      prev &&
      ((id != null && id === prevId) ||
        (id == null && name != null && name === prevName));

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
