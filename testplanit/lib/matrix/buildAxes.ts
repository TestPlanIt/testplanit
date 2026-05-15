/**
 * Pure shape builder for the Matrix view.
 *
 * Assembles the `AxesShape` payload that both the dedicated Matrix page
 * and the report-builder preset render. No DB, no IO, no module-level
 * state — caller passes pre-fetched data.
 *
 * Per-case sub-axis math (cell count): `Σ paramRows[c].length × configCount`.
 * Each case row visually expands into N sub-rows — one per parameter
 * row in that case's resolved iteration source. Non-parameterized
 * cases get a single synthetic sub-row labeled "(no parameters)".
 *
 * Also exports the `cartesianProduct` helper, which subsumes the two
 * duplicate implementations previously inlined at:
 *   - app/api/report-builder/route.ts:1228
 *   - app/api/report-builder/session-analysis/route.ts:719
 */

import type {
  AxesShape,
  CaseAxisItem,
  CellSummary,
  ConfigAxisItem,
  ParamRowAxisItem,
  StatusMapEntry,
} from "./types";
import { cellKey } from "./types";

/** Sentinel sub-row for non-parameterized cases (PARAM-07). */
const NO_PARAMS_ROW: ParamRowAxisItem = {
  index: 0,
  label: "(no parameters)",
  values: {},
};

export interface BuildAxesInput {
  cases: Array<{
    caseId: number;
    caseName: string;
    hasParameters: boolean;
    parameters:
      | Array<{ name: string; type: string; sensitive: boolean }>
      | null;
  }>;
  configs: ConfigAxisItem[];
  cells: CellSummary[];
  paramRowsByCaseId: Map<number, ParamRowAxisItem[]>;
  statusMap: Record<number, StatusMapEntry>;
}

/**
 * Build the matrix `AxesShape` from pre-fetched inputs. Pure: no DB,
 * no IO, no module-level state.
 *
 * The `cells` Map is keyed by `cellKey(caseId, configId, rowIndex)` for
 * O(1) lookup at virtualization render time.
 *
 * `cellCount` is computed from the per-case sub-axis math
 * (`Σ paramRows[c].length × configCount`), NOT the global axis math
 * (`caseCount × maxRows × configCount`). For non-parameterized cases
 * the synthetic "(no parameters)" sub-row contributes 1 to each
 * case×config slot.
 */
export function buildAxes(input: BuildAxesInput): AxesShape {
  const caseAxis: CaseAxisItem[] = input.cases.map((c) => {
    const explicit = input.paramRowsByCaseId.get(c.caseId);
    const paramRows: ParamRowAxisItem[] =
      explicit && explicit.length > 0 ? explicit : [NO_PARAMS_ROW];
    const item: CaseAxisItem = {
      caseId: c.caseId,
      caseName: c.caseName,
      hasParameters: c.hasParameters,
      paramRows,
    };
    if (c.parameters) {
      item.parameters = c.parameters;
    }
    return item;
  });

  const configAxis = input.configs;

  const cells = new Map<string, CellSummary>();
  for (const cell of input.cells) {
    cells.set(cellKey(cell.caseId, cell.configId, cell.rowIndex), cell);
  }

  // Per-case sub-axis: each case contributes (paramRows.length × configCount)
  // cells. Empty configAxis collapses to 1 (the "(none)" sentinel column).
  const configCount = Math.max(1, configAxis.length);
  let cellCount = 0;
  for (const item of caseAxis) {
    cellCount += item.paramRows.length * configCount;
  }

  return {
    caseAxis,
    configAxis,
    cells,
    cellCount,
    statusMap: input.statusMap,
  };
}

/**
 * Cartesian product of N arrays. Generic over T.
 *
 * Examples:
 *   cartesianProduct([])           -> [[]]
 *   cartesianProduct([[1,2],[3,4]]) -> [[1,3],[1,4],[2,3],[2,4]]
 *   cartesianProduct([[1],[2],[3]]) -> [[1,2,3]]
 *
 * If any inner array is empty the product is `[]` (no combinations).
 *
 * Subsumes:
 *   - app/api/report-builder/route.ts:1228 `cartesianProduct`
 *   - app/api/report-builder/session-analysis/route.ts:719 `_cartesianProduct`
 */
export function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((d) => curr.map((e) => [...d, e])),
    [[]],
  );
}
